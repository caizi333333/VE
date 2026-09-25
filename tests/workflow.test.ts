import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diagnosis, ReviewRevision, TaskAttempt } from '@prisma/client';
import { toTicketView, stableCheckpoints, type DiagnosisRecord, type PublishedPayload } from '../src/lib/ticket-view';
import { toTeacherDiagnosis } from '../src/lib/teacher-data';
import { firstFeedbackMinutes, parseDateRange, percentile } from '../src/lib/stats';
import { canAdmitGeneration, effectiveExperiment, GENERATION_BUDGET_MS, hasQuantitativeGuidance, MAX_CONCURRENT_GENERATIONS, modelTimeout, MODEL_REQUEST_TIMEOUT_MS } from '../src/lib/diagnosis-policy';
import { execFileSync } from 'node:child_process';
const now=new Date('2026-09-20T04:00:00Z');
const approved:PublishedPayload={reviewer:'课程教师',checkpoints:[{id:'r1-cp1',point_id:'6.1.4',instruction:'已批准的检查'}],bridging_task:'已批准基础任务',comment:'已批准说明',tasks:[1,2,3].map(level=>({level:level as 1|2|3,title:`级别${level}`,instruction:`LEVEL_${level}_SECRET`,point_id:'6.1.4'})),assessments:[]};
function revision(version:number,action='release',payload=approved):ReviewRevision{return{id:`rev${version}`,diagnosisId:'diagnosis',teacherId:'teacher',version,round:1,action,payloadJson:JSON.stringify(payload),createdAt:now};}
function record(overrides:Partial<DiagnosisRecord>={}):DiagnosisRecord {
  const base:Diagnosis={id:'diagnosis',ticket:'ABC234',createdAt:now,benchLabel:'A1',symptomText:'定时不准',codeText:'TH0 = 0;',redactionLog:'[]',faultChainId:'timing-inaccurate',chainPointIds:'["6.1.4"]',provider:'provider',model:'model',classification:'MODEL_SECRET',checkpoints:JSON.stringify([{point_id:'6.1.4',instruction:'MODEL_SECRET'}]),bridgingTask:'MODEL_SECRET',reviewNotes:'["MODEL_SECRET"]',rawResponse:'MODEL_SECRET',status:'released',studentTicks:'[]',studentOutcome:'',studentResolvedPoint:'',activeTaskLevel:1,classroomId:'class',learnerId:'learner',experimentId:'experiment',dataSource:'test',version:2,round:1,publishedVersion:1,promptVersion:'v2',graphVersion:'graph',configSnapshot:'{}',rubricSnapshot:'[]',constraintSnapshot:JSON.stringify({points:[{id:'6.1.4',name:'时钟',chapter:6}],edges:[]}),assessmentJson:'[]',taskPackJson:JSON.stringify(approved.tasks),roundsJson:'[]',completedAt:null};
  return{...base,revisions:[revision(1),revision(2,'draft',{...approved,comment:'DRAFT_SECRET'})],attempts:[],...overrides};
}

test('pending, manual, generating and rejected projections omit all model and approved guidance',()=>{
  for(const status of ['pending_review','manual_pending','generating','rejected']){
    const view=toTicketView(record({status}),'实验');
    assert.deepEqual(Object.keys(view).sort(),['id','ticket','status','version','published_version','round','created_at','bench_label','experiment_name','experiment_id'].sort());
    assert.equal(view.released,undefined);
    assert.doesNotMatch(JSON.stringify(view),/MODEL_SECRET|DRAFT_SECRET|LEVEL_/);
  }
});
test('published projection uses immutable approved revision, never latest draft or raw AI',()=>{
  const view=toTicketView(record());
  assert.equal(view.released?.comment,'已批准说明');
  assert.equal(view.released?.checkpoints[0]?.instruction,'已批准的检查');
  assert.doesNotMatch(JSON.stringify(view),/MODEL_SECRET|DRAFT_SECRET/);
});
test('locked task bodies are absent from the response, and unlock does not modify task text',()=>{
  for(const level of [1,2,3]){
    const view=toTicketView(record({activeTaskLevel:level}));
    assert.equal(view.practice_tasks?.length,level);
    for(let locked=level+1;locked<=3;locked++)assert.doesNotMatch(JSON.stringify(view),new RegExp(`LEVEL_${locked}_SECRET`));
  }
});
test('release flag alone, wrong round, malformed payload or wrong revision cannot expose guidance',()=>{
  for(const broken of [record({revisions:[]}),record({publishedVersion:2}),record({round:2}),record({revisions:[{...revision(1),payloadJson:'broken'}]})]) {
    assert.equal(toTicketView(broken).released,undefined);
    assert.equal(toTicketView(broken).practice_tasks,undefined);
  }
});
test('teacher reopens latest draft and has original separately; verify events do not reset the draft',()=>{
  const current=record();
  current.revisions!.push(revision(3,'verify',{...approved,comment:'VERIFY_SECRET'}));
  const view=toTeacherDiagnosis(current);
  assert.equal(view.comment,'DRAFT_SECRET');
  assert.equal(view.original.bridging_task,'MODEL_SECRET');
  assert.equal(view.revisions.length,3);
});
test('new round retains revision history but does not preload teacher text from prior round',()=>{
  const view=toTeacherDiagnosis(record({round:2,publishedVersion:null,roundsJson:'[{"round":1,"code":"BEFORE"}]'}));
  assert.equal(view.comment,'');
  assert.equal(view.bridging_task,'MODEL_SECRET');
  assert.equal(view.rounds.length,1);
});
test('legacy teacher edits take precedence over old AI, while student view still requires revision',()=>{
  const legacy=record({dataSource:'legacy_unknown',revisions:[],publishedVersion:null,review:{id:'review',diagnosisId:'diagnosis',reviewedAt:now,reviewer:'教师',checkpoints:JSON.stringify([{point_id:'6.1.4',instruction:'LEGACY_EDIT'}]),bridgingTask:'LEGACY_TASK',comment:'LEGACY_COMMENT',released:true}});
  const view=toTeacherDiagnosis(legacy);
  assert.equal(view.checkpoints[0]?.instruction,'LEGACY_EDIT');
  assert.equal(view.bridging_task,'LEGACY_TASK');
  assert.equal(view.comment,'LEGACY_COMMENT');
  assert.equal(toTicketView(legacy).released,undefined);
});
test('checkpoint identifiers are stable within a round and preserve teacher-provided IDs',()=>{
  const data=[{point_id:'6.1.4',instruction:'first'},{id:'persistent',point_id:'6.1.4',instruction:'second'}];
  assert.deepEqual(stableCheckpoints(data,2).map(cp=>cp.id),['r2-cp1','persistent']);
  assert.deepEqual(stableCheckpoints(data,2),stableCheckpoints(data,2));
});
test('student attempts distinguish self report from teacher verification',()=>{
  const attempt:TaskAttempt={id:'attempt',diagnosisId:'diagnosis',learnerId:'learner',publishedVersion:1,level:1,ticksJson:'["r1-cp1"]',observation:'LED仍未翻转',codeText:'',outcome:'resolved',status:'submitted',teacherFeedback:'',verificationEvidence:'',verifiedAt:null,verifiedBy:null,idempotencyKey:'key',createdAt:now};
  const view=toTicketView(record({attempts:[attempt],studentOutcome:'resolved'}));
  assert.equal(view.completed_at,null);
  assert.equal(view.attempts?.[0]?.status,'submitted');
  assert.equal(view.active_task_level,1);
});
test('date ranges use China teaching calendar and reject rollover/reversed dates',()=>{
  const range=parseDateRange(new URLSearchParams({from:'2026-09-20',to:'2026-09-21'}));
  assert.equal(range.from?.toISOString(),'2026-09-19T16:00:00.000Z');
  assert.equal(range.to?.toISOString(),'2026-09-21T15:59:59.999Z');
  for(const values of [{from:'2026-02-30'},{from:'2026-09-21',to:'2026-09-20'},{from:'yesterday'}] as Record<string,string>[])assert.throws(()=>parseDateRange(new URLSearchParams(values)));
});
test('feedback percentiles handle empty, single and even-sized samples without fabricating data',()=>{
  assert.equal(percentile([],0.5),null);
  assert.equal(percentile([4],0.9),4);
  assert.equal(percentile([1,3,5,7],0.5),4);
  assert.equal(percentile([1,3,5,7],0.9),6.4);
});


test('unconfirmed experiments keep source parameters in snapshots but never use them for calculations or grading',()=>{
  const config={chip:'AT89C51',clock_hz:11059200,clocks_per_tick:12,timer_mode:1 as const,target_ms:50};
  const rubric=[{id:'r1',label:'口径',max_score:4,criterion:'确认参数和公式'}];
  const draft=effectiveExperiment(config,rubric,false,'timing-inaccurate',7);
  assert.deepEqual(draft.config,{});
  assert.deepEqual(draft.rubric,[]);
  assert.ok(draft.calculations.every(c=>c.status==='incomplete'));
  assert.equal(draft.snapshot.configuration_confirmed,false);
  assert.equal(draft.snapshot.experiment_version,7);
  assert.equal(draft.snapshot.clock_hz,11059200);
  const confirmed=effectiveExperiment(config,rubric,true,'timing-inaccurate',8);
  assert.deepEqual(confirmed.config,config);
  assert.deepEqual(confirmed.rubric,rubric);
  assert.equal(confirmed.calculations[0]?.status,'ready');
  assert.equal(confirmed.snapshot.configuration_confirmed,true);
});
test('draft experiment publication permits qualitative instructions and rejects numerical engineering conclusions',()=>{
  assert.equal(hasQuantitativeGuidance('检查点 1：查看 6.1.4 的先修知识，观察是否出现中断。'),false);
  for(const guidance of ['核对0x4C00','初值为19456','TH0=76','按12T计数','目标50毫秒','目标0.05秒','频率11.0592MHz','波特率9600bps'])assert.equal(hasQuantitativeGuidance(guidance),true,guidance);
});
test('generation admission is bounded and total budget leaves persistence time within the route limit',()=>{
  assert.equal(MAX_CONCURRENT_GENERATIONS,4);
  assert.equal(canAdmitGeneration(0),true);
  assert.equal(canAdmitGeneration(3),true);
  assert.equal(canAdmitGeneration(4),false);
  assert.equal(canAdmitGeneration(-1),false);
  assert.equal(canAdmitGeneration(NaN),false);
  assert.equal(modelTimeout(100_000,0),MODEL_REQUEST_TIMEOUT_MS);
  assert.equal(modelTimeout(1000,750),250);
  assert.equal(modelTimeout(1000,1000),0);
  assert.equal(modelTimeout(1000,2000),0);
  assert.ok(MODEL_REQUEST_TIMEOUT_MS*2<=GENERATION_BUDGET_MS);
  assert.ok(GENERATION_BUDGET_MS<120_000);
});
test('model client aborts at the remaining global deadline using a mocked transport and no real credentials',()=>{
  const script=`const assert=require('node:assert/strict');
    const {chatComplete}=require('./src/lib/llm-provider.ts');
    let calls=0;
    global.fetch=async (_url,options)=>{calls++;return new Promise((_resolve,reject)=>{
      options.signal.addEventListener('abort',()=>{const error=new Error('timeout');error.name='AbortError';reject(error);},{once:true});
    });};
    (async()=>{
      await assert.rejects(chatComplete([{role:'user',content:'test'}],{deadlineAt:Date.now()+25}),/超时/);
      assert.equal(calls,1);
      await assert.rejects(chatComplete([{role:'user',content:'test'}],{deadlineAt:Date.now()-1}),/总时限/);
      assert.equal(calls,1);
    })().catch(error=>{console.error(error);process.exitCode=1;});`;
  execFileSync(process.execPath,['--import','tsx','-e',script],{cwd:process.cwd(),env:{NODE_ENV:'test',PATH:process.env.PATH ?? '',QIANFAN_API_KEY:'unit-test-placeholder',LLM_PROVIDER:'qianfan'},timeout:10000,stdio:'pipe'});
});


test('feedback durations use the first release across all history and do not recount later republication',()=>{
  const event=(id:string,kind:string,time:string,round=1)=>({id,kind,diagnosisId:'same-ticket',createdAt:new Date(time),payloadJson:JSON.stringify({round})});
  const history=[event('submitted','submission','2026-09-01T00:00:00Z'),event('first','released','2026-09-01T00:10:00Z'),event('again','released','2026-09-20T00:00:00Z'),event('round2','submission','2026-09-20T00:20:00Z',2),event('first-round2','released','2026-09-20T00:25:00Z',2)];
  assert.deepEqual(firstFeedbackMinutes(history,history.slice(2)),[5]);
  assert.deepEqual(firstFeedbackMinutes(history,history),[10,5]);
});
