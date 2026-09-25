import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, HttpError, requireTeacher, withErrors } from '@/lib/auth';
import { ownedClassroom, toTeacherDiagnosis } from '@/lib/teacher-data';
import { publishedPayload, readJson, stableCheckpoints, type PublishedPayload } from '@/lib/ticket-view';
import { backfillPitfall } from '@/lib/pitfall-store';
import { getPoint } from '@/lib/knowledge-graph';
import { redactSubmission } from '@/lib/redact';
import { hasQuantitativeGuidance, type ExperimentSnapshot } from '@/lib/diagnosis-policy';
import type { RubricItem } from '@/lib/api-types';
const checkpoint = z.object({id:z.string().max(80).optional(),point_id:z.string().max(40),instruction:z.string().trim().max(2000)});
const task = z.object({level:z.union([z.literal(1),z.literal(2),z.literal(3)]),title:z.string().trim().max(200),instruction:z.string().trim().max(4000),point_id:z.string().max(40),objective:z.string().max(2000).optional(),conditions:z.string().max(2000).optional(),deliverable:z.string().max(2000).optional(),verification:z.string().max(2000).optional()});
const assessment = z.object({criterion_id:z.string().min(1),score:z.number().finite().nonnegative().nullable(),reason:z.string().trim().max(2000),line_no:z.number().int().positive().optional(),point_id:z.string().optional(),issue_type:z.string().max(100).optional()});
const schema = z.object({
  diagnosis_id:z.string().min(1),expected_version:z.number().int().nonnegative(),action:z.enum(['draft','release','reject','verify']),
  checkpoints:z.array(checkpoint).max(8).optional(),bridging_task:z.string().max(4000).optional(),comment:z.string().trim().max(2000).default(''),
  tasks:z.array(task).max(3).optional(),assessments:z.array(assessment).max(30).optional(),attempt_id:z.string().optional(),
  verification:z.object({status:z.enum(['confirmed','needs_revision']),feedback:z.string().trim().min(1).max(2000),evidence:z.string().trim().min(1).max(4000)}).optional(),
  backfill:z.object({point_id:z.string().min(1),description:z.string().trim().min(1).max(800)}).optional(),
});
const scrub = (text:string) => redactSubmission(text,'').symptom;
export const POST = withErrors(async(request:Request)=>{
  assertSameOrigin(request);
  const teacher = await requireTeacher(request);
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) throw new HttpError(400,parsed.error.issues[0]?.message ?? '复核参数不合法');
  const input=parsed.data;
  const record=await prisma.diagnosis.findUnique({where:{id:input.diagnosis_id},include:{revisions:true,attempts:true}});
  if(!record || !record.classroomId) throw new HttpError(404,'诊疗记录不存在或未关联当前班级');
  await ownedClassroom(teacher.id,record.classroomId);
  if(record.version!==input.expected_version) throw new HttpError(409,'此记录已被修改，请刷新后核对最新版本');
  if(record.status==='generating') {
    const generation=await prisma.generationRequest.findFirst({where:{diagnosisId:record.id,status:'processing'},orderBy:{createdAt:'desc'}});
    if(generation && Date.now()-generation.updatedAt.getTime()<5*60*1000) throw new HttpError(409,'内容正在生成，请稍后复核');
  }
  const current=toTeacherDiagnosis(record);
  let payload:PublishedPayload={
    reviewer:teacher.displayName,
    checkpoints:stableCheckpoints(input.checkpoints ?? current.checkpoints,record.round).map(cp=>({...cp,instruction:scrub(cp.instruction)})),
    bridging_task:scrub(input.bridging_task ?? current.bridging_task),comment:scrub(input.comment),
    tasks:(input.tasks ?? current.tasks).map(t=>({...t,title:scrub(t.title),instruction:scrub(t.instruction),objective:scrub(t.objective ?? ''),conditions:scrub(t.conditions ?? ''),deliverable:scrub(t.deliverable ?? ''),verification:scrub(t.verification ?? '')})),
    assessments:(input.assessments ?? current.assessments).map(a=>({...a,reason:scrub(a.reason),issue_type:a.issue_type ? scrub(a.issue_type) : undefined})),
  };
  if(input.action==='verify') {
    const published=publishedPayload(record);
    if(!published) throw new HttpError(409,'本次指导尚未发布');
    payload={...published.payload,reviewer:teacher.displayName};
  }
  const allowed=new Set(readJson<string[]>(record.chainPointIds,[]));
  if(input.action==='release' && (payload.checkpoints.some(cp=>!allowed.has(cp.point_id)) || payload.tasks.some(t=>!getPoint(t.point_id)))) throw new HttpError(400,'检查点或任务知识编号不在有效范围内');
  if(new Set(payload.checkpoints.map(cp=>cp.id)).size!==payload.checkpoints.length) throw new HttpError(400,'检查点标识不能重复');
  const snapshot=readJson<ExperimentSnapshot>(record.configSnapshot,{});
  const qualitativeOnly=snapshot.configuration_confirmed===false;
  const rubric=qualitativeOnly?[]:readJson<RubricItem[]>(record.rubricSnapshot,[]);
  if(qualitativeOnly && payload.assessments.length)throw new HttpError(400,'实验配置未确认，本轮不可发布评分；确认实验后请重新提交诊疗');
  if(new Set(payload.assessments.map(a=>a.criterion_id)).size!==payload.assessments.length || payload.assessments.some(a=>{
    const item=rubric.find(r=>r.id===a.criterion_id);
    return !item || (a.score!==null && a.score>item.max_score) || (a.point_id && !getPoint(a.point_id)) || (a.line_no && a.line_no>record.codeText.split('\n').length);
  })) throw new HttpError(400,'分项评价与本次评分量规或代码行号不一致');
  if(input.action==='release') {
    const guidance=[...payload.checkpoints.map(cp=>cp.instruction),payload.bridging_task,payload.comment,...payload.tasks.flatMap(t=>[t.title,t.instruction,t.objective,t.conditions,t.deliverable,t.verification]),input.backfill?.description].filter(Boolean).join('\n');
    if(qualitativeOnly && hasQuantitativeGuidance(guidance))throw new HttpError(400,'实验配置未确认，本轮仅可发布定性指导；确认参数后请重新提交诊疗');
    if(!payload.checkpoints.length || payload.checkpoints.some(cp=>!cp.instruction.trim()) || !payload.bridging_task.trim()) throw new HttpError(400,'下发前请补齐检查点和基础任务');
    if(payload.tasks.length!==3 || [1,2,3].some(level=>!payload.tasks.some(t=>t.level===level)) || payload.tasks.some(t=>![t.title,t.instruction,t.objective,t.conditions,t.deliverable,t.verification].every(value=>value?.trim()))) throw new HttpError(400,'下发前请补齐三个级别任务的目标、条件、提交物和验证方式');
    if(payload.assessments.length!==rubric.length || payload.assessments.some(a=>!a.reason.trim())) throw new HttpError(400,'下发前请逐项完成评分量规复核');
  }
  if(input.backfill && (!allowed.has(input.backfill.point_id) || input.action!=='release')) throw new HttpError(400,'易错点仅能随下发回填到本次相关知识节点');
  const targetAttempt = input.attempt_id ? record.attempts.find(a=>a.id===input.attempt_id) : null;
  if(input.action==='verify') {
    if(!targetAttempt || !input.verification) throw new HttpError(400,'请选择待验证记录并填写验证结果与依据');
    if(record.status!=='released' || targetAttempt.publishedVersion!==record.publishedVersion || targetAttempt.status!=='submitted') throw new HttpError(409,'此回执已处理或不属于当前发布版本');
    if(targetAttempt.level>record.activeTaskLevel) throw new HttpError(409,'请先完成前一级任务验证');
    if(input.verification.status==='confirmed' && targetAttempt.level>1 && !record.attempts.some(a=>a.publishedVersion===record.publishedVersion && a.level===targetAttempt.level-1 && a.status==='confirmed')) throw new HttpError(409,'前一级任务尚未通过教师验证');
  }
  const version=record.version+1;
  const now=new Date();
  const status=input.action==='release'?'released':input.action==='reject'?'rejected':record.status==='generating'?'manual_pending':record.status;
  await prisma.$transaction(async tx=>{
    const updated=await tx.diagnosis.updateMany({where:{id:record.id,version:input.expected_version},data:{
      version,status,
      ...(input.action==='release'?{publishedVersion:version,activeTaskLevel:1,completedAt:null,studentTicks:'[]',studentOutcome:''}:{}),
      ...(input.action==='reject'?{publishedVersion:null,completedAt:null}:{}),
      ...(input.action==='verify' && targetAttempt && input.verification?.status==='confirmed'?{activeTaskLevel:Math.min(3,Math.max(record.activeTaskLevel,targetAttempt.level+1)),...(targetAttempt.level===3?{completedAt:now}:{})}:{}),
    }});
    if(!updated.count) throw new HttpError(409,'此记录已被修改，请刷新后核对最新版本');
    await tx.reviewRevision.create({data:{diagnosisId:record.id,teacherId:teacher.id,version,round:record.round,action:input.action,payloadJson:JSON.stringify({...payload,...(input.action==='verify'?{attempt_id:input.attempt_id,verification:{...input.verification,feedback:scrub(input.verification!.feedback),evidence:scrub(input.verification!.evidence)}}:{})})}});
    if(input.action!=='verify') await tx.review.upsert({where:{diagnosisId:record.id},create:{diagnosisId:record.id,reviewer:teacher.displayName,checkpoints:JSON.stringify(payload.checkpoints),bridgingTask:payload.bridging_task,comment:payload.comment,released:input.action==='release'},update:{reviewer:teacher.displayName,checkpoints:JSON.stringify(payload.checkpoints),bridgingTask:payload.bridging_task,comment:payload.comment,released:input.action==='release',reviewedAt:now}});
    if(input.action==='verify' && targetAttempt && input.verification) {
      const checked=await tx.taskAttempt.updateMany({where:{id:targetAttempt.id,status:'submitted'},data:{status:input.verification.status,teacherFeedback:scrub(input.verification.feedback),verificationEvidence:scrub(input.verification.evidence),verifiedAt:now,verifiedBy:teacher.id}});
      if(!checked.count) throw new HttpError(409,'此回执已被其他操作处理');
    }
    if(input.backfill) await backfillPitfall({point_id:input.backfill.point_id,description:scrub(input.backfill.description),author:teacher.displayName,diagnosis_id:record.id,classroom_id:record.classroomId!},tx);
    const eventKind=input.action==='verify'?(input.verification?.status==='confirmed'?'verified':'needs_revision'):input.action==='release'?'released':input.action==='reject'?'rejected':'review_saved';
    await tx.activityEvent.create({data:{classroomId:record.classroomId,learnerId:record.learnerId,diagnosisId:record.id,dataSource:record.dataSource,kind:eventKind,payloadJson:JSON.stringify({version,round:record.round,experiment_id:record.experimentId,level:targetAttempt?.level,attempt_id:targetAttempt?.id,point_ids:input.action==='release'?payload.assessments.filter(a=>a.score!==null && a.score<(rubric.find(r=>r.id===a.criterion_id)?.max_score ?? 0)).flatMap(a=>a.point_id?[a.point_id]:[]):[]})}});
    if(input.action==='verify' && targetAttempt?.level===3 && input.verification?.status==='confirmed') await tx.activityEvent.create({data:{classroomId:record.classroomId,learnerId:record.learnerId,diagnosisId:record.id,dataSource:record.dataSource,kind:'completed',payloadJson:JSON.stringify({version,experiment_id:record.experimentId,attempt_id:targetAttempt.id})}});
  });
  return NextResponse.json({ok:true,status,version,ticket:record.ticket});
});
