import { prisma } from './db';
import { HttpError } from './auth';
import { ownedClassroom } from './teacher-data';
import { getPoint } from './knowledge-graph';
import { readJson, type PublishedPayload } from './ticket-view';
import type { Assessment, StatsView } from './api-types';

/** Calendar filters use the project's teaching timezone, including when deployed in UTC. */
export function parseDateRange(params:URLSearchParams) {
  function parse(value:string|null,end:boolean):Date|undefined {
    if(!value)return undefined;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new HttpError(400,'日期须为 YYYY-MM-DD');
    const check=new Date(`${value}T00:00:00Z`);
    if(Number.isNaN(check.getTime()) || check.toISOString().slice(0,10)!==value)throw new HttpError(400,'日期不存在');
    return new Date(`${value}T${end?'23:59:59.999':'00:00:00.000'}+08:00`);
  }
  const from=parse(params.get('from'),false),to=parse(params.get('to'),true);
  if(from && to && from>to)throw new HttpError(400,'结束日期不得早于开始日期');
  return {from,to,where:from||to?{...(from?{gte:from}:{}),...(to?{lte:to}:{})}:undefined};
}
export function percentile(values:number[],p:number):number|null {
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const i=(sorted.length-1)*p,lower=Math.floor(i),upper=Math.ceil(i);
  return Math.round((sorted[lower]+(sorted[upper]-sorted[lower])*(i-lower))*100)/100;
}
interface TimingEvent {id:string;kind:string;diagnosisId:string|null;payloadJson:string;createdAt:Date}
/** Re-publication in a later week never becomes a second first-response observation. */
export function firstFeedbackMinutes(history:TimingEvent[],periodEvents:TimingEvent[]):number[] {
  const started=new Map<string,number>();
  const firstRelease=new Map<string,TimingEvent>();
  const ordered=[...history].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime());
  for(const event of ordered){
    const data=readJson<{round?:number}>(event.payloadJson,{});
    const key=`${event.diagnosisId}:${data.round ?? 1}`;
    if(event.kind==='submission' && !started.has(key))started.set(key,event.createdAt.getTime());
    if(event.kind==='released' && !firstRelease.has(key))firstRelease.set(key,event);
  }
  const periodIds=new Set(periodEvents.map(event=>event.id));
  const durations:number[]=[];
  for(const [key,event] of firstRelease){
    const start=started.get(key);
    if(start!==undefined && periodIds.has(event.id) && event.createdAt.getTime()>=start)durations.push((event.createdAt.getTime()-start)/60000);
  }
  return durations;
}
export async function classroomStats(teacherId:string,params:URLSearchParams):Promise<StatsView> {
  const classroomId=params.get('classroom_id');
  if(!classroomId)throw new HttpError(400,'请选择班级');
  const classroom=await ownedClassroom(teacherId,classroomId);
  const requestedSource=params.get('data_source');
  const source=requestedSource ?? classroom.dataSource;
  if(source!==classroom.dataSource)throw new HttpError(400,'统计来源与班级来源不一致');
  const range=parseDateRange(params);
  const experimentId=params.get('experiment_id');
  const labId=params.get('lab_id');
  if(labId && !/^[1-8]$/.test(labId))throw new HttpError(400,'实验编号不合法');
  if(labId && experimentId)throw new HttpError(400,'请只选择一项实验');
  if(experimentId && !await prisma.experiment.findFirst({where:{id:experimentId,classroomId}}))throw new HttpError(404,'实验不存在');
  const [allRecords,events,learners,experiments]=await Promise.all([
    prisma.diagnosis.findMany({where:{classroomId,dataSource:source,...(experimentId?{experimentId}:{}),...(labId?{faultChainId:`lab-${labId}`}:{})},include:{revisions:true}}),
    prisma.activityEvent.findMany({where:{classroomId,dataSource:source,...(range.where?{createdAt:range.where}:{})},orderBy:{createdAt:'asc'}}),
    prisma.learner.findMany({where:{classroomId}}),
    prisma.experiment.findMany({where:{classroomId},select:{id:true,name:true}}),
  ]);
  const recordMap=new Map(allRecords.map(r=>[r.id,r]));
  const selectedEvents=events.filter(e=>e.diagnosisId && recordMap.has(e.diagnosisId));
  const eventIds=new Set(selectedEvents.flatMap(e=>e.diagnosisId?[e.diagnosisId]:[]));
  const records=range.where?allRecords.filter(r=>eventIds.has(r.id)):allRecords;
  const activeLearners=new Set(learners.filter(l=>l.active).map(l=>l.id));
  // The denominator is the teacher-verifiable class roster, including participants who have not submitted a diagnosis.
  const participants=new Set(learners.filter(l=>l.active && l.participatedAt).map(l=>l.id));
  const completedIds=range.where?new Set(selectedEvents.filter(e=>e.kind==='completed').flatMap(e=>e.diagnosisId?[e.diagnosisId]:[])):new Set(records.filter(r=>r.completedAt).map(r=>r.id));
  const completedLearners=range.where
    ? new Set(selectedEvents.filter(e=>e.kind==='completed').flatMap(e=>e.learnerId && participants.has(e.learnerId)?[e.learnerId]:[]))
    : new Set(records.filter(r=>r.completedAt).flatMap(r=>r.learnerId && participants.has(r.learnerId)?[r.learnerId]:[]));
  const nodeRecords=new Map<string,Set<string>>();
  for(const event of selectedEvents.filter(e=>e.kind==='released')) {
    const details=readJson<{point_ids?:string[]}>(event.payloadJson,{});
    for(const id of new Set(details.point_ids ?? [])) {
      if(!getPoint(id))continue;
      const set=nodeRecords.get(id) ?? new Set<string>();set.add(event.diagnosisId!);nodeRecords.set(id,set);
    }
  }
  // Include submissions outside the period when the release itself happened in the period.
  const timingEvents=await prisma.activityEvent.findMany({where:{classroomId,dataSource:source,kind:{in:['submission','released']},diagnosisId:{in:records.map(r=>r.id)}},orderBy:{createdAt:'asc'}});
  const feedback=firstFeedbackMinutes(timingEvents,selectedEvents);
  let matched=0,total=0,difference=0;
  for(const record of records){
    const revision=record.revisions.find(r=>r.version===record.publishedVersion && r.action==='release');
    if(!revision)continue;
    const published=readJson<PublishedPayload|null>(revision.payloadJson,null);
    const ai=readJson<Assessment[]>(record.assessmentJson,[]);
    for(const item of published?.assessments ?? []){
      const original=ai.find(a=>a.criterion_id===item.criterion_id);
      if(item.score===null || original?.score===null || original?.score===undefined)continue;
      total++;if(item.score===original.score)matched++;difference+=Math.abs(item.score-original.score);
    }
  }
  const names=new Map(experiments.map(e=>[e.id,e.name]));
  const numbers=new Map(learners.map(l=>[l.id,l.number]));
  return {
    classroom_id:classroomId,from:params.get('from'),to:params.get('to'),data_source:source,
    counts:{submissions:selectedEvents.filter(e=>e.kind==='submission').length,pending:records.filter(r=>['generating','pending_review','manual_pending'].includes(r.status)).length,released:selectedEvents.filter(e=>e.kind==='released').length,help:selectedEvents.filter(e=>e.kind==='help').length,verified:selectedEvents.filter(e=>e.kind==='verified').length,learners:activeLearners.size,participants:participants.size,completed_learners:completedLearners.size},
    completion_rate:classroom.participationConfirmed && participants.size>0?completedLearners.size/participants.size:null,
    participation_confirmed:classroom.participationConfirmed,
    nodes:[...nodeRecords].map(([id,ids])=>({point_id:id,name:getPoint(id)?.name ?? id,confirmed_errors:ids.size,diagnosis_ids:[...ids]})).sort((a,b)=>b.confirmed_errors-a.confirmed_errors),
    records:records.map(r=>({id:r.id,ticket:r.ticket,learner_number:numbers.get(r.learnerId ?? '') ?? '',status:r.status,experiment_name:names.get(r.experimentId ?? '') ?? (/^lab-[1-8]$/.test(r.faultChainId ?? '')?`实验${r.faultChainId!.slice(4)}`:''),completed:range.where?completedIds.has(r.id):!!r.completedAt})),
    feedback_minutes:{median:percentile(feedback,0.5),p90:percentile(feedback,0.9),count:feedback.length},
    assessment_agreement:{matched,total,rate:total?matched/total:null,mean_absolute_score_difference:total?Math.round(difference/total*100)/100:null},
  };
}
