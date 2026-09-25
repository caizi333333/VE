/** Isolated HTTP regression suite. No production database or model endpoint is used. */
import assert from 'node:assert/strict';
import { randomUUID, createHash, scryptSync } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { ClassroomView, ExperimentView, TeacherDiagnosisView, TicketView } from '../src/lib/api-types';
async function main(){
const root=process.cwd(); mkdirSync('tmp',{recursive:true});
const stamp=Date.now(); const database=resolve('tmp',`integration-${stamp}.db`);
const url=`file:${database}`;
const deployed=spawnSync('npx',['prisma','migrate','deploy'],{encoding:'utf8',env:{...process.env,DATABASE_URL:url}});
assert.equal(deployed.status,0,deployed.stderr);
const db=new PrismaClient({datasourceUrl:url});
const password='TestOnly-8051-Classroom';const salt='isolated-test-salt';const passwordHash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
await db.teacher.create({data:{username:'test_teacher',displayName:'试用验证教师',passwordHash}});
await db.teacher.create({data:{username:'other_teacher',displayName:'另一课堂教师',passwordHash}});
let calls=0;let failModel=false;let holdModel=false;let activeModel=0;let peakModel=0;let lastSystem='';
const pendingModel:(()=>void)[]=[];
const releaseModels=()=>{holdModel=false;for(const release of pendingModel.splice(0))release();};
const mock=createServer(async(req,res)=>{
  let raw='';for await(const part of req) raw+=part;
  const body=JSON.parse(raw);calls++;activeModel++;peakModel=Math.max(peakModel,activeModel);
  try {
    if(holdModel)await new Promise<void>(resolve=>pendingModel.push(resolve));
    if(failModel){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'simulated model outage'}}));return;}
    if(body.messages[0]?.content.startsWith('将用户的操作问题')) { res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'setup'}}]}));return; }
    const user=body.messages.filter((m:{role:string})=>m.role==='user').map((m:{content:string})=>m.content).join('\n');
    lastSystem=body.messages.find((m:{role:string})=>m.role==='system')?.content ?? '';
    const point=user.includes('串口乱码')?'7.2.3':user.includes('定时不准')?'6.1.4':'5.2.2';
    const rubricPresent=lastSystem.includes('"id":"r1"');
    const result={classification:`本次排查落在知识点[${point}]`,checkpoints:[{point_id:point,instruction:'对照实验配置检查相关寄存器，记录修改前后观察结果。'}],bridging_task:'提交一次寄存器核对记录，并说明观察到的变化。',review_notes:[],assessments:rubricPresent?[{criterion_id:'r1',score:50,reason:'请补充修改记录与实测依据。',point_id:point,issue_type:'验证依据不足'}]:[]};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
  } finally {activeModel--;}

});
await new Promise<void>(r=>mock.listen(3199,'127.0.0.1',r));
const logfile=openSync(resolve('tmp','integration-server.log'),'w');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3101','-H','127.0.0.1'],{cwd:root,detached:true,stdio:['ignore',logfile,logfile],env:{...process.env,DATABASE_URL:url,NEXT_DIST_DIR:'.next-test',LLM_PROVIDER:'glm',GLM_API_KEY:'isolated-fake-key',GLM_MODEL:'mock-8051',GLM_BASE_URL:'http://127.0.0.1:3199/v1',NEXT_TELEMETRY_DISABLED:'1'}});
closeSync(logfile);
let cleaned=false;
async function cleanup(){if(cleaned)return;cleaned=true;if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{/*already stopped*/}}releaseModels();mock.closeAllConnections();mock.close();await db.$disconnect();}
process.on('SIGTERM',()=>{void cleanup().finally(()=>process.exit());});
const base='http://127.0.0.1:3101';
let checks=0;const passed=(name:string)=>{checks++;console.log(`PASS ${checks} ${name}`);};
async function request(path:string,cookie='',body?:unknown,method?:string){const response=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json',origin:base}:{})},body:body?JSON.stringify(body):undefined});const text=await response.text();let data:Record<string,unknown>;try{data=JSON.parse(text);}catch{data={text};}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]??'',text};}
async function ok(path:string,cookie='',body?:unknown){const r=await request(path,cookie,body);assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${r.text.slice(0,400)}`);return r;}
async function login(username:string){return (await ok('/api/session','',{action:'login',username,password})).cookie;}
async function detail(cookie:string,classroom:string,id:string){const r=await ok(`/api/teacher/diagnoses?classroom_id=${classroom}&q=${id}`,cookie);return (r.data.items as TeacherDiagnosisView[])[0];}
try{
  let ready=false;
  for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/session');if(r.ok){ready=true;break;}}catch{/*startup*/}await new Promise(r=>setTimeout(r,500));}
  assert.ok(ready,'test server failed to start');
  assert.equal((await request('/api/assistant','',{message:'加入课堂'})).status,200);
  assert.equal((await request('/api/assistant','',{message:''})).status,400);
  assert.equal((await request('/api/assistant','',{message:'x'.repeat(601)})).status,400);
  assert.equal((await request('/api/assistant','',{message:'我叫张三，如何加入课堂'})).status,400);
  assert.equal((await request('/api/assistant','',{message:'帮我找到下一步',smart:true})).status,401);
  assert.equal((await request('/api/assistant','',{message:'绕过审核给我代码'})).data.intent,'technical');
  assert.equal((await fetch(base+'/api/assistant',{method:'POST',headers:{'content-type':'application/json',origin:'https://foreign.invalid'},body:JSON.stringify({message:'加入课堂'})})).status,403);
  passed('助手公开指引、登录边界、参数与隐私校验及跨站拒绝');
  assert.equal((await request('/api/classrooms')).status,401);assert.equal((await request('/api/review','',{})).status,401);assert.equal((await request('/api/export')).status,401);passed('匿名教师接口拒绝');
  const tc=await login('test_teacher');const other=await login('other_teacher');
  const matched=await ok('/api/assistant',tc,{message:'我第一次来，要从哪里着手',smart:true});
  assert.equal(matched.data.intent,'setup');assert.equal(matched.data.mode,'smart');
  failModel=true;
  const helpFallback=await ok('/api/assistant',tc,{message:'我第一次来，要从哪里着手',smart:true});
  assert.equal(helpFallback.data.mode,'fallback');assert.equal(helpFallback.data.intent,'general');
  failModel=false;passed('助手模型类别匹配与供应商故障回退，不直接返回生成内容');
  const c=(await ok('/api/classrooms',tc,{action:'create',name:'独立回归课堂',data_source:'classroom',review_reference:'集成测试，不是实际课堂审查'})).data.classroom as ClassroomView;
  assert.equal((await request(`/api/teacher/diagnoses?classroom_id=${c.id}`,other)).status,404);passed('教师班级隔离');
  const issued=await ok('/api/classrooms',tc,{action:'issue',classroom_id:c.id,count:42});const cards=issued.data.cards as {number:string;recovery_code:string}[];
  const join=async(i:number)=>(await ok('/api/join','',{class_code:c.join_code,learner_number:cards[i].number,recovery_code:cards[i].recovery_code})).cookie;
  const sc=await join(0);const sc2=await join(1);
  assert.equal((await request('/api/join','',{class_code:c.join_code,learner_number:cards[0].number,recovery_code:'wrong-secret'})).status,401);passed('恢复凭据保护匿名编号');
  const materialForm=new FormData();materialForm.set('classroom_id',c.id);materialForm.set('lab_id','4');materialForm.set('title','按键接线核对图');materialForm.set('kind','diagram');materialForm.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])],'board.png',{type:'image/png'}));
  const uploaded=await fetch(base+'/api/materials',{method:'POST',headers:{cookie:tc,origin:base},body:materialForm});assert.equal(uploaded.status,201);const material=(await uploaded.json()).material as {id:string;url:string;version:number};
  assert.equal(((await request(`/api/materials?classroom_id=${c.id}&lab_id=4`,sc)).data.materials as unknown[])?.length,0);
  assert.equal((await request(material.url,sc)).status,404);
  assert.equal((await request(`/api/materials?classroom_id=${c.id}&lab_id=4`,other)).status,404);
  assert.equal((await request('/api/materials',sc,{action:'update',classroom_id:c.id,id:material.id,version:1,title:'伪造发布',published:true})).status,401);
  await ok('/api/materials',tc,{action:'update',classroom_id:c.id,id:material.id,version:material.version,title:'按键接线核对图',published:true});
  assert.equal(((await request(`/api/materials?classroom_id=${c.id}&lab_id=4`,sc)).data.materials as unknown[])?.length,1);
  assert.equal((await request(material.url,sc)).status,200);
  assert.equal((await request('/api/materials',tc,{action:'remove',classroom_id:c.id,id:material.id,version:material.version})).status,409);
  assert.equal((await request('/api/materials/original',sc)).status,200);
  passed('实验资料上传、待发布隔离、班级权限、版本冲突与原始报告下载');
  const config={chip:'AT89C51',clock_hz:11059200,clocks_per_tick:12,timer_mode:1,target_ms:50,verification_method:'记录示波器测量和修改代码',time_definition:'单次溢出间隔',toolchain:'Keil C51 / 实物板',tolerance_percent:1,benches:['A1','A2']};
  const rubric=[{id:'r1',label:'实验验证',max_score:100,criterion:'依据修改记录和测量结果复核'}];
  const faultIds=['timer-isr-not-entered','uart-garbled','timing-inaccurate'] as const;
  const names=['中断不触发','串口乱码','定时不准'];const experiments:ExperimentView[]=[];
  for(let i=0;i<3;i++){const e=(await ok('/api/experiments',tc,{classroom_id:c.id,name:names[i],fault_chain_id:faultIds[i],config:i===1?{...config,timer_mode:2,target_baud:9600,smod:0}:config,rubric,confirmed:true})).data.experiment as ExperimentView;experiments.push(e);}
  assert.equal((await request('/api/experiments',other,{classroom_id:c.id,name:'伪造',fault_chain_id:faultIds[0],config:{},rubric:[],confirmed:false})).status,404);passed('实验配置与教师权限');
  assert.equal((await request('/api/experiments',tc,{classroom_id:c.id,name:'错误时间定义',fault_chain_id:faultIds[2],config:{...config,time_definition:'LED完整周期'},rubric,confirmed:true})).status,400);
  assert.equal((await request('/api/experiments',tc,{classroom_id:c.id,name:'误差超容限',fault_chain_id:faultIds[1],config:{...config,clock_hz:12000000,timer_mode:2,target_baud:9600,smod:0,tolerance_percent:1},rubric,confirmed:true})).status,400);
  passed('实验API拒绝错误时间定义与超容差波特率');
  await db.pitfall.create({data:{classroomId:c.id,pointId:'6.1.4',description:'检查实际晶振与计数分频',author:'测试教师'}});
  const beforeOutside=calls;
  assert.equal((await request('/api/diagnose',sc,{experiment_id:experiments[0].id,symptom:'今天的午餐推荐是什么？',code:'',idempotency_key:randomUUID()})).status,422);
  assert.equal(calls,beforeOutside);passed('存在教师回填时课程外问题仍不调用模型');
  const draftExperiment=(await ok('/api/experiments',tc,{classroom_id:c.id,name:'待确认参数实验',fault_chain_id:faultIds[0],config:{chip:'AT89C51',benches:['A1']},rubric,confirmed:false})).data.experiment as ExperimentView;
  const qualitative=await ok('/api/diagnose',sc2,{experiment_id:draftExperiment.id,symptom:'定时器中断不触发，LED不翻转',code:'EA = 1;',idempotency_key:randomUUID()});
  assert.equal(qualitative.data.status,'pending_review');
  const qualitativeRecord=await db.diagnosis.findUniqueOrThrow({where:{id:String(qualitative.data.id)}});
  const snapshot=JSON.parse(qualitativeRecord.configSnapshot);
  assert.equal(snapshot.configuration_confirmed,false);assert.equal(snapshot.chip,'AT89C51');
  for(const absent of ['clock_hz','clocks_per_tick','target_ms','timer_mode'])assert.equal(snapshot[absent],undefined);
  assert.deepEqual(JSON.parse(qualitativeRecord.rubricSnapshot),[]);assert.deepEqual(JSON.parse(qualitativeRecord.assessmentJson),[]);
  assert.match(lastSystem,/【教师实验配置】\s*\{\}/);assert.match(lastSystem,/【确认评分量规】\s*\[\]/);
  assert.ok(!lastSystem.includes('"status":"ready"'));
  const qualitativeDetail=await detail(tc,c.id,String(qualitative.data.ticket));
  const qualitativeRelease={diagnosis_id:qualitativeDetail.id,expected_version:qualitativeDetail.version,action:'release',checkpoints:qualitativeDetail.checkpoints,bridging_task:qualitativeDetail.bridging_task,tasks:qualitativeDetail.tasks,assessments:[],comment:'先完成定性检查，等待参数确认。'};
  assert.equal((await request('/api/review',tc,{...qualitativeRelease,checkpoints:qualitativeDetail.checkpoints.map(cp=>({...cp,instruction:'按50ms目标设置TH0=0x4C'}))})).status,400);
  assert.equal((await request('/api/review',tc,{...qualitativeRelease,assessments:[{criterion_id:'r1',score:50,reason:'未经确认的评分'}]})).status,400);
  await ok('/api/review',tc,qualitativeRelease);
  const qualitativeView=await ok(`/api/ticket/${qualitative.data.ticket}`,sc2);assert.deepEqual(qualitativeView.data.rubric,[]);
  passed('未确认实验可定性诊疗、不猜参数、不发布数值或评分');
  const submissions:{id:string;ticket:string}[]=[];
  for(let i=0;i<3;i++){
    const key=randomUUID();const input={experiment_id:experiments[i].id,symptom:i===0?'定时器中断不触发，LED不翻转':i===1?'串口乱码，接收显示不正确':'定时不准，闪烁太慢',code:i===1?'SCON = 0x50;\nTH1 = 0xFD;':'TMOD = 0x01;\nEA = 1;\nTR0 = 1;',bench_label:'A1',idempotency_key:key};
    const result=await ok('/api/diagnose',sc,input);submissions.push(result.data as unknown as {id:string;ticket:string});
    assert.equal(result.data.diagnosis,undefined);const oldCalls=calls;
    const again=await ok('/api/diagnose',sc,input);assert.equal(again.data.ticket,result.data.ticket);assert.equal(calls,oldCalls);
    assert.equal((await request('/api/diagnose',sc,{...input,symptom:'同一key修改输入'})).status,409);
    const view=await ok(`/api/ticket/${result.data.ticket}`,sc);assert.equal(view.data.released,undefined);assert.equal(view.data.practice_tasks,undefined);assert.equal(view.data.code_text,undefined);
  }
  passed('三类诊疗、待审无正文与持久幂等');
  const first=submissions[0];assert.equal((await request(`/api/ticket/${first.ticket}`,sc2)).status,404);assert.equal((await request(`/api/ticket/${first.ticket}`)).status,401);passed('单号不能越权读取');
  let d=await detail(tc,c.id,first.ticket);assert.ok(d.review_notes.join('').includes('0x4C00'));passed('教师端保留确定性计算结果');
  const edited=d.checkpoints.map(cp=>({...cp,instruction:'教师已修改：记录IE设置与中断观察，按实验要求验证。'}));
  const payload={diagnosis_id:d.id,expected_version:d.version,action:'release',checkpoints:edited,bridging_task:'教师确认的基础检查任务',tasks:d.tasks,assessments:d.assessments,comment:'按实际配置操作'};
  assert.equal((await request('/api/review',sc,payload)).status,401);
  assert.equal((await request('/api/review',other,payload)).status,404);
  assert.equal((await request(`/api/export?kind=case&id=${d.id}`,other)).status,404);
  assert.equal((await request(`/api/export?classroom_id=${c.id}&kind=weekly-log&from=2026-01-01&to=2027-12-31`,other)).status,404);
  passed('学生与其他班教师不能审核或导出本班记录');
  await ok('/api/review',tc,payload);assert.equal((await request('/api/review',tc,payload)).status,409);passed('审核发布与乐观并发控制');
  d=await detail(tc,c.id,first.ticket);assert.equal(d.checkpoints[0].instruction,edited[0].instruction);
  let view=(await ok(`/api/ticket/${first.ticket}`,sc)).data as unknown as TicketView;
  assert.equal(view.released?.checkpoints[0].instruction,edited[0].instruction);assert.equal(view.practice_tasks?.length,1);passed('修改刷新保留、只返回已开放任务');
  await ok('/api/review',tc,{...payload,expected_version:d.version,action:'draft',checkpoints:edited.map(cp=>({...cp,instruction:'尚未发布的修改'}))});
  view=(await ok(`/api/ticket/${first.ticket}`,sc)).data as unknown as TicketView;assert.equal(view.released?.checkpoints[0].instruction,edited[0].instruction);passed('保存新草稿不改变已发布指导');
  const ticks=view.released!.checkpoints.map(cp=>cp.id);
  const progress={published_version:view.published_version,level:1,ticks,outcome:'stuck',observation:'已逐位检查，仍未进入中断，请教师帮助。',code:'EA = 1;',idempotency_key:randomUUID()};
  assert.equal((await request(`/api/ticket/${first.ticket}/progress`,sc2,progress)).status,404);
  assert.equal((await request(`/api/ticket/${first.ticket}/progress`,sc,{...progress,ticks:['missing-checkpoint']})).status,400);
  await ok(`/api/ticket/${first.ticket}/progress`,sc,progress);await ok(`/api/ticket/${first.ticket}/progress`,sc,progress);
  view=(await ok(`/api/ticket/${first.ticket}`,sc)).data as unknown as TicketView;assert.equal(view.active_task_level,1);assert.equal(view.attempts?.length,1);passed('学生回执授权、ID校验、卡住不升级及去重');
  for(let level=1;level<=3;level++){
    view=(await ok(`/api/ticket/${first.ticket}`,sc)).data as unknown as TicketView;
    await ok(`/api/ticket/${first.ticket}/progress`,sc,{...progress,published_version:view.published_version,level,outcome:'resolved',observation:`第${level}级完成修改，记录测量和操作结果。`,idempotency_key:randomUUID()});
    d=await detail(tc,c.id,first.ticket);const attempt=d.attempts.find(a=>a.level===level&&a.outcome==='resolved'&&a.status==='submitted');assert.ok(attempt);
    if(level===1){
      const waiting=await ok(`/api/teacher/diagnoses?classroom_id=${c.id}&status=needs_verification`,tc);
      assert.ok((waiting.data.items as {ticket:string}[]).some(item=>item.ticket===first.ticket));
    }
    await ok('/api/review',tc,{diagnosis_id:d.id,expected_version:d.version,action:'verify',attempt_id:attempt.id,verification:{status:'confirmed',feedback:'按实验要求完成验证',evidence:'独立测试记录：前后代码和测量结果已核对'}});
  }
  view=(await ok(`/api/ticket/${first.ticket}`,sc)).data as unknown as TicketView;assert.ok(view.completed_at);passed('三级任务经教师验证递进并完成');
  d=await detail(tc,c.id,first.ticket);
  // Re-publish in the same round, then place the real events in separate teaching weeks.
  await ok('/api/review',tc,{diagnosis_id:d.id,expected_version:d.version,action:'release',checkpoints:d.checkpoints,bridging_task:d.bridging_task,tasks:d.tasks,assessments:d.assessments,comment:'同轮再次下发'});
  const roundOneEvents=await db.activityEvent.findMany({where:{diagnosisId:first.id},orderBy:{createdAt:'asc'}});
  let releases=0;
  for(const event of roundOneEvents){
    if(event.kind==='submission')await db.activityEvent.update({where:{id:event.id},data:{createdAt:new Date('2026-09-01T04:00:00Z')}});
    if(event.kind==='released')await db.activityEvent.update({where:{id:event.id},data:{createdAt:new Date(releases++===0?'2026-09-01T04:10:00Z':'2026-09-20T04:00:00Z')}});
    if(event.kind==='completed')await db.activityEvent.update({where:{id:event.id},data:{createdAt:new Date('2026-09-02T04:00:00Z')}});
  }
  d=await detail(tc,c.id,first.ticket);
  const newRound=await ok('/api/diagnose',sc,{experiment_id:experiments[0].id,ticket:first.ticket,expected_version:d.version,symptom:'定时器中断不触发，需要补充排查',code:'EA = 1; ET0 = 1;',idempotency_key:randomUUID()});
  assert.equal(newRound.data.ticket,first.ticket);d=await detail(tc,c.id,first.ticket);assert.equal(d.round,2);assert.ok(d.rounds.length>=1);
  assert.equal((await request(`/api/ticket/${first.ticket}/progress`,sc,{...progress,idempotency_key:randomUUID()})).status,409);passed('同单多轮记录与旧版回执失效');
  const historical=await ok(`/api/teacher/stats?classroom_id=${c.id}&experiment_id=${experiments[0].id}&from=2026-09-01&to=2026-09-07`,tc);
  assert.equal((historical.data.counts as {completed_learners:number}).completed_learners,1);
  assert.equal((historical.data.records as {id:string;completed:boolean}[]).find(r=>r.id===first.id)?.completed,true);
  assert.equal((historical.data.feedback_minutes as {count:number;median:number}).count,1);assert.equal((historical.data.feedback_minutes as {median:number}).median,10);
  const laterWeek=await ok(`/api/teacher/stats?classroom_id=${c.id}&experiment_id=${experiments[0].id}&from=2026-09-20&to=2026-09-26`,tc);
  assert.equal((laterWeek.data.feedback_minutes as {count:number}).count,0);
  passed('跨周完成事件保留、同轮再次发布不重复首次反馈计时');
  const second=submissions[1];d=await detail(tc,c.id,second.ticket);await ok('/api/review',tc,{diagnosis_id:d.id,expected_version:d.version,action:'reject',comment:'请补充串口帧格式'});
  const rejected=await ok(`/api/ticket/${second.ticket}`,sc);assert.equal(rejected.data.released,undefined);passed('退回不返回未批准正文');
  failModel=true;
  const manual=await ok('/api/diagnose',sc,{experiment_id:experiments[2].id,symptom:'定时不准，模型不可用测试',code:'TH0 = 0;',idempotency_key:randomUUID()});
  assert.equal(manual.data.status,'manual_pending');failModel=false;passed('模型故障可人工接管');
  const concurrencyCookies=await Promise.all([2,3,4,5,6].map(join));
  const beforeConcurrent=calls;holdModel=true;
  const concurrentBody=(i:number)=>({experiment_id:experiments[2].id,symptom:`定时不准，并发提交记录${i}`,code:'TH0 = 0;',idempotency_key:randomUUID()});
  const generating=concurrencyCookies.slice(0,4).map((cookie,i)=>ok('/api/diagnose',cookie,concurrentBody(i)));
  for(let i=0;i<100 && pendingModel.length<4;i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(pendingModel.length,4,'four model calls should be held by the mock');assert.equal(activeModel,4);
  const overloaded=await ok('/api/diagnose',concurrencyCookies[4],concurrentBody(5));
  assert.equal(overloaded.data.status,'manual_pending');assert.equal(calls,beforeConcurrent+4);
  const preserved=await db.diagnosis.findUniqueOrThrow({where:{id:String(overloaded.data.id)}});
  assert.match(preserved.symptomText,/并发提交记录5/);assert.equal(preserved.codeText,'TH0 = 0;');
  assert.equal((await db.generationRequest.findFirstOrThrow({where:{diagnosisId:preserved.id}})).errorCode,'model_overloaded');
  releaseModels();const completedConcurrent=await Promise.all(generating);
  assert.ok(completedConcurrent.every(r=>r.data.status==='pending_review'));assert.equal(peakModel,4);
  passed('最多4个模型并发，第5个提交保留记录并转人工');
  const seed=await db.diagnosis.findUniqueOrThrow({where:{id:submissions[2].id}});
  for(let i=0;i<35;i++){const {id:_id,ticket:_ticket,createdAt:_created,...rest}=seed;void _id;void _ticket;void _created;await db.diagnosis.create({data:{...rest,id:`extra-${i}`,ticket:`P${String(i).padStart(5,'0')}`,status:'pending_review',createdAt:new Date(Date.now()+i)}});}
  const page1=await ok(`/api/teacher/diagnoses?classroom_id=${c.id}&status=pending_review&page=1`,tc);const page2=await ok(`/api/teacher/diagnoses?classroom_id=${c.id}&status=pending_review&page=2`,tc);
  assert.ok(Number(page1.data.total)>30);assert.ok((page2.data.items as unknown[]).length>0);assert.equal((await detail(tc,c.id,submissions[2].ticket)).id,submissions[2].id);passed('超过30条的分页与旧待办查找');
  const legacy=await db.diagnosis.create({data:{...seed,id:'legacy-marker',ticket:'LEGACY',dataSource:'legacy_unknown',learnerId:null}});void legacy;
  const beforeStats=await ok(`/api/teacher/stats?classroom_id=${c.id}`,tc);assert.equal(beforeStats.data.completion_rate,null);assert.ok(!(beforeStats.data.records as {ticket:string}[]).some(r=>r.ticket==='LEGACY'));
  await ok('/api/classrooms',tc,{action:'update',classroom_id:c.id,participation_confirmed:true});
  const stats=await ok(`/api/teacher/stats?classroom_id=${c.id}`,tc);assert.equal(stats.data.participation_confirmed,true);passed('历史数据排除与参与分母确认');
  const newParticipantCookie=await join(7);
  const firstParticipationBody={experiment_id:experiments[2].id,symptom:'定时不准，首次参与编号的分母核对验证',code:'TH0 = 0;',idempotency_key:randomUUID()};
  await ok('/api/diagnose',newParticipantCookie,firstParticipationBody);
  const needsRosterConfirmation=await ok(`/api/teacher/stats?classroom_id=${c.id}`,tc);
  assert.equal(needsRosterConfirmation.data.participation_confirmed,false);assert.equal(needsRosterConfirmation.data.completion_rate,null);
  await ok('/api/classrooms',tc,{action:'update',classroom_id:c.id,participation_confirmed:true});
  const reconfirmedRoster=await ok(`/api/teacher/stats?classroom_id=${c.id}`,tc);
  assert.equal(reconfirmedRoster.data.participation_confirmed,true);assert.notEqual(reconfirmedRoster.data.completion_rate,null);
  await ok('/api/diagnose',newParticipantCookie,{...firstParticipationBody,idempotency_key:randomUUID()});
  assert.equal((await ok(`/api/teacher/stats?classroom_id=${c.id}`,tc)).data.participation_confirmed,true);
  passed('首次参与原子清除分母确认、重核后重复提交不再清除');
  // Independent sessions exercise the read path without additional model calls.
  const sessions=await Promise.all(cards.slice(2).map(async(card)=>{const learner=await db.learner.findUniqueOrThrow({where:{classroomId_number:{classroomId:c.id,number:card.number}}});const token=randomUUID();await db.session.create({data:{tokenHash:createHash('sha256').update(token).digest('hex'),learnerId:learner.id,expiresAt:new Date(Date.now()+3600000)}});return `ve_learner=${token}`;}));
  const durations:number[]=[];const load=await Promise.all(sessions.map(async(cookie)=>{const start=performance.now();const r=await request('/api/experiments',cookie);durations.push(performance.now()-start);return r.status;}));
  assert.equal(load.length,40);assert.ok(load.every(s=>s===200));durations.sort((a,b)=>a-b);
  const perf={sessions:40,failures:load.filter(s=>s!==200).length,p50_ms:Math.round(durations[19]),p95_ms:Math.round(durations[37]),max_ms:Math.round(durations[39]),scope:'authenticated experiment reads with independent student sessions; model endpoint mocked'};passed('40个独立活跃会话读取测试');
  const concurrentReview=await detail(tc,c.id,submissions[2].ticket);
  const concurrentPitfall={point_id:concurrentReview.checkpoints[0].point_id,description:'教师复核后检查计数分频的设置情况（并发测试）'};
  const reviewBefore={revisions:await db.reviewRevision.count({where:{diagnosisId:concurrentReview.id}}),releases:await db.activityEvent.count({where:{diagnosisId:concurrentReview.id,kind:'released'}}),pitfalls:await db.pitfall.count({where:{classroomId:c.id,pointId:concurrentPitfall.point_id,description:concurrentPitfall.description}})};
  assert.equal(reviewBefore.pitfalls,0);
  const concurrentReviewPayload={diagnosis_id:concurrentReview.id,expected_version:concurrentReview.version,action:'release',checkpoints:concurrentReview.checkpoints,bridging_task:concurrentReview.bridging_task,tasks:concurrentReview.tasks,assessments:concurrentReview.assessments,comment:'并发提交验证',backfill:concurrentPitfall};
  const concurrentReviews=await Promise.all([request('/api/review',tc,concurrentReviewPayload),request('/api/review',tc,concurrentReviewPayload)]);
  assert.deepEqual(concurrentReviews.map(result=>result.status).sort(),[200,409]);
  assert.equal(await db.reviewRevision.count({where:{diagnosisId:concurrentReview.id}}),reviewBefore.revisions+1);
  assert.equal(await db.activityEvent.count({where:{diagnosisId:concurrentReview.id,kind:'released'}}),reviewBefore.releases+1);
  assert.equal(await db.pitfall.count({where:{classroomId:c.id,pointId:concurrentPitfall.point_id,description:concurrentPitfall.description}}),1);
  passed('同时审核同版本仅一笔发布、修订和回填原子提交');
  const exported=await request(`/api/export?classroom_id=${c.id}&kind=weekly-log&from=2026-01-01&to=2027-12-31`,tc);assert.equal(exported.status,200);assert.ok(!exported.text.includes('LEGACY'));passed('授权导出与历史隔离');
  const labRequest={lab_id:4,issue_type:'result',symptom:'按键后数码管没有变化，已检查连线',code:'ORG 0003H',idempotency_key:randomUUID()};
  assert.equal((await request('/api/lab-help','',labRequest)).status,401);
  assert.equal((await request('/api/lab-help',sc,{...labRequest,issue_type:'other'})).status,400);
  assert.equal((await request('/api/lab-help',sc,{...labRequest,symptom:'我叫张三，按键无响应'})).status,400);
  const modelCallsBeforeLab=calls;
  const labCase=await ok('/api/lab-help',sc,labRequest);
  assert.equal(labCase.data.status,'manual_pending');
  assert.equal((await ok('/api/lab-help',sc,labRequest)).data.ticket,labCase.data.ticket);
  assert.equal(calls,modelCallsBeforeLab);
  const unseen=await ok(`/api/ticket/${labCase.data.ticket}`,sc);
  assert.equal(unseen.data.lab_id,4);assert.equal(unseen.data.released,undefined);
  assert.equal((await request(`/api/ticket/${labCase.data.ticket}`,sc2)).status,404);
  const labReview=await detail(tc,c.id,String(labCase.data.ticket));
  assert.match(labReview.experiment_name,/外部中断与按键/);
  assert.ok(labReview.checkpoints.length>=2);
  assert.match(labReview.checkpoints.map(checkpoint=>checkpoint.instruction).join(' '),/INT0 输入边沿/);
  assert.match(labReview.bridging_task,/一次按下对应的计数变化/);
  assert.ok(labReview.tasks.every(task=>task.instruction && task.deliverable && task.verification));
  for(const labId of [1,2,3,5,6,7,8]){
    const issueType=labId%3===0?'result':labId%3===1?'wiring':'code';
    const submitted=await ok('/api/lab-help',sc,{lab_id:labId,issue_type:issueType,symptom:`实验${labId}出现与报告任务不一致的现象，待核对`,code:'',idempotency_key:randomUUID()});
    const studentView=await ok(`/api/ticket/${submitted.data.ticket}`,sc);
    assert.equal(studentView.data.released,undefined);
    const teacherView=await detail(tc,c.id,String(submitted.data.ticket));
    assert.equal(teacherView.checkpoints.length>=1,true);
    assert.equal(teacherView.tasks.length,3);
    assert.ok(teacherView.tasks.every(task=>task.instruction && task.deliverable && task.verification));
  }
  assert.equal(calls,modelCallsBeforeLab);
  passed('八项实验均能生成待复核排查草稿，待审学生不可读取正文');
  const filteredLab=await ok(`/api/teacher/diagnoses?classroom_id=${c.id}&lab_id=4`,tc);
  assert.ok((filteredLab.data.items as {ticket:string}[]).some(item=>item.ticket===labCase.data.ticket));
  const labStats=await ok(`/api/teacher/stats?classroom_id=${c.id}&lab_id=4`,tc);
  assert.ok((labStats.data.records as {ticket:string;experiment_name:string}[]).some(item=>item.ticket===labCase.data.ticket && item.experiment_name==='实验4'));
  assert.equal((await request(`/api/teacher/diagnoses?classroom_id=${c.id}&lab_id=9`,tc)).status,400);
  assert.equal((await request(`/api/teacher/stats?classroom_id=${c.id}&lab_id=9`,tc)).status,400);
  const labExport=await request(`/api/export?classroom_id=${c.id}&lab_id=4&kind=weekly-log&from=2026-01-01&to=2027-12-31`,tc);
  assert.equal(labExport.status,200);assert.ok(labExport.text.includes(String(labCase.data.ticket)));
  passed('八项实验可按编号筛选教师待办、统计和日志');
  await ok('/api/review',tc,{diagnosis_id:labReview.id,expected_version:labReview.version,action:'release',
    checkpoints:[{point_id:'5.3.3',instruction:'记录按键前后数码管显示和连线观察'}],
    bridging_task:'核对实际按键与显示的观察记录后再修订',tasks:labReview.tasks,assessments:[],comment:'请按实际板卡逐项核对'});
  const approved=await ok(`/api/ticket/${labCase.data.ticket}`,sc);
  assert.equal((approved.data.released as {checkpoints:unknown[]}).checkpoints.length,1);
  const updatedLab=await detail(tc,c.id,String(labCase.data.ticket));
  const nextLab=await ok('/api/lab-help',sc,{...labRequest,ticket:labCase.data.ticket,expected_version:updatedLab.version,symptom:'按键后偶尔计数两次',idempotency_key:randomUUID()});
  assert.equal(nextLab.data.ticket,labCase.data.ticket);
  assert.equal((await ok(`/api/ticket/${labCase.data.ticket}`,sc)).data.released,undefined);
  passed('八项实验人工求助：匿名权限、脱敏、幂等、教师下发和同单修订');
  const actionable=await ok(`/api/teacher/diagnoses?classroom_id=${c.id}&status=needs_action`,tc);
  const actionItems=actionable.data.items as {ticket:string;status:string}[];
  assert.ok(actionItems.some(item=>item.ticket===labCase.data.ticket));
  assert.ok(actionItems.every(item=>['pending_review','manual_pending','released'].includes(item.status)));
  const pendingCount=await db.diagnosis.count({where:{classroomId:c.id,dataSource:'classroom',status:{in:['pending_review','manual_pending']}}});
  const releasedCandidates=await db.diagnosis.findMany({where:{classroomId:c.id,dataSource:'classroom',status:'released'},select:{publishedVersion:true,attempts:{where:{status:'submitted',outcome:'resolved'},select:{publishedVersion:true}}}});
  const verificationCount=releasedCandidates.filter(record=>record.attempts.some(attempt=>attempt.publishedVersion===record.publishedVersion)).length;
  assert.equal(actionable.data.total,pendingCount+verificationCount);
  assert.equal((await request(`/api/teacher/diagnoses?classroom_id=${c.id}&status=unknown`,tc)).status,400);
  passed('教师默认待办只含本课堂待复核、人工处理和待验证修订');
  const metadata={checks,perf,database,base,teacher_username:'test_teacher',teacher_password:password,classroom_id:c.id,class_code:c.join_code,student:cards[0],ticket:submissions[2].ticket,server_pid:child.pid,runner_pid:process.pid};
  writeFileSync('tmp/test-access.json',JSON.stringify(metadata,null,2),{mode:0o600});
  writeFileSync('tmp/integration-results.json',JSON.stringify({checks,perf,at:new Date().toISOString()},null,2));
  console.log('INTEGRATION_OK',JSON.stringify({checks,perf}));
  if(process.env.KEEP_TEST_SERVER==='1'){console.log('TEST_SERVER_READY http://127.0.0.1:3101');await new Promise(()=>{});}
}catch(error){console.error(error);process.exitCode=1;}finally{await cleanup();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
