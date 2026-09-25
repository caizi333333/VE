import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { HttpError } from './auth';
import type { Assessment, Checkpoint, ExperimentConfig, PracticeTaskView, RubricItem, TeacherDiagnosisView, TeacherListView } from './api-types';
import { readJson, stableCheckpoints, toAttemptView, type DiagnosisRecord, type PublishedPayload } from './ticket-view';
import { labGuide } from './lab-guides';

export async function ownedClassroom(teacherId: string, classroomId: string) {
  const classroom = await prisma.classroom.findFirst({ where: { id: classroomId, teacherId } });
  if (!classroom) throw new HttpError(404, '班级不存在或无访问权限');
  return classroom;
}
export function toTeacherDiagnosis(record: DiagnosisRecord, experimentName = '', learnerNumber = ''): TeacherDiagnosisView {
  const latest = [...(record.revisions ?? [])].filter((r) => r.round === record.round && r.action !== 'verify').sort((a,b) => b.version-a.version)[0];
  const draft = latest ? readJson<PublishedPayload | null>(latest.payloadJson, null) : null;
  const legacyReview = !latest && record.dataSource === 'legacy_unknown' ? record.review : null;
  const original = { checkpoints: stableCheckpoints(readJson<Checkpoint[]>(record.checkpoints, []), record.round), bridging_task: record.bridgingTask };
  return {
    id: record.id, ticket: record.ticket, status: record.status, version: record.version, round: record.round,
    published_version: record.publishedVersion, created_at: record.createdAt.toISOString(), classroom_id: record.classroomId,
    experiment_id: record.experimentId,
    experiment_name: experimentName || (/^lab-[1-8]$/.test(record.faultChainId ?? '') ? `实验${record.faultChainId!.slice(4)} · ${labGuide(Number(record.faultChainId!.slice(4)))?.title ?? ''}` : ''),
    learner_number: learnerNumber,
    bench_label: record.benchLabel, data_source: record.dataSource, symptom: record.symptomText, code: record.codeText,
    classification: record.classification, review_notes: readJson<string[]>(record.reviewNotes, []),
    checkpoints: draft?.checkpoints ?? (legacyReview ? stableCheckpoints(readJson<Checkpoint[]>(legacyReview.checkpoints, []), record.round) : original.checkpoints), bridging_task: draft?.bridging_task ?? legacyReview?.bridgingTask ?? original.bridging_task,
    tasks: draft?.tasks ?? readJson<PracticeTaskView[]>(record.taskPackJson, []),
    assessments: draft?.assessments ?? readJson<Assessment[]>(record.assessmentJson, []),
    ai_assessments: readJson<Assessment[]>(record.assessmentJson, []), rubric: readJson<RubricItem[]>(record.rubricSnapshot, []),
    comment: draft?.comment ?? legacyReview?.comment ?? '', original, attempts: (record.attempts ?? []).map(toAttemptView),
    revisions: (record.revisions ?? []).map((r) => ({ version: r.version, action: r.action, created_at: r.createdAt.toISOString(), payload: readJson<unknown>(r.payloadJson, {}) })),
    rounds: readJson<unknown[]>(record.roundsJson, []), config: readJson<ExperimentConfig>(record.configSnapshot, {}),
    completed_at: record.completedAt?.toISOString() ?? null,
  };
}
export async function teacherDiagnoses(teacherId: string, params: URLSearchParams): Promise<TeacherListView> {
  const classroomId = params.get('classroom_id');
  if (!classroomId) throw new HttpError(400, '请选择班级');
  const classroom = await ownedClassroom(teacherId, classroomId);
  // A terminated model call cannot strand a classroom record permanently in generating.
  const stale = await prisma.generationRequest.findMany({where:{status:'processing',updatedAt:{lt:new Date(Date.now()-5*60*1000)}},select:{key:true,diagnosisId:true}});
  if(stale.length) {
    const owned = await prisma.diagnosis.findMany({where:{classroomId,status:'generating',id:{in:stale.flatMap(g=>g.diagnosisId?[g.diagnosisId]:[])}},select:{id:true}});
    const ownedIds=new Set(owned.map(d=>d.id));
    if(ownedIds.size) await prisma.$transaction(async tx=>{
      await tx.diagnosis.updateMany({where:{id:{in:[...ownedIds]},status:'generating'},data:{status:'manual_pending',reviewNotes:JSON.stringify(['内容生成中断，请教师人工处理'])}});
      await tx.generationRequest.updateMany({where:{key:{in:stale.filter(g=>g.diagnosisId && ownedIds.has(g.diagnosisId)).map(g=>g.key)},status:'processing'},data:{status:'manual_pending',errorCode:'generation_interrupted'}});
    });
  }
  const page = Math.max(1, Number(params.get('page') || 1));
  if (!Number.isSafeInteger(page) || page > 100000) throw new HttpError(400, '页码不合法');
  const pageSize = 20;
  const status = params.get('status');
  if (status && !['needs_action','needs_verification','generating','pending_review','manual_pending','released','rejected'].includes(status)) throw new HttpError(400, '状态不合法');
  const query = (params.get('q') || '').trim().slice(0,100);
  const labId = params.get('lab_id');
  if (labId && !/^[1-8]$/.test(labId)) throw new HttpError(400, '实验编号不合法');
  if (labId && params.get('experiment_id')) throw new HttpError(400, '请只选择一项实验');
  const matchingLearners=query ? await prisma.learner.findMany({where:{classroomId,number:{contains:query}},select:{id:true}}) : [];
  const verificationCandidates = status === 'needs_action' || status === 'needs_verification'
    ? await prisma.diagnosis.findMany({where:{classroomId,dataSource:classroom.dataSource,status:'released',attempts:{some:{status:'submitted',outcome:'resolved'}}},select:{id:true,publishedVersion:true,attempts:{where:{status:'submitted',outcome:'resolved'},select:{publishedVersion:true}}}})
    : [];
  const verificationIds = verificationCandidates.filter(record=>record.attempts.some(attempt=>attempt.publishedVersion===record.publishedVersion)).map(record=>record.id);
  const where: Prisma.DiagnosisWhereInput = {
    classroomId,
    ...(status === 'needs_action' || status === 'needs_verification' ? { dataSource: classroom.dataSource } : {}),
    ...(params.get('experiment_id') ? { experimentId: params.get('experiment_id')! } : {}),
    ...(labId ? { faultChainId: `lab-${labId}` } : {}),
    ...(status === 'needs_action' ? { OR: [{status:{in:['pending_review','manual_pending']}},{id:{in:verificationIds}}] } : status === 'needs_verification' ? {id:{in:verificationIds}} : status ? { status } : {}),
    ...(query ? { AND: [{ OR: [{ ticket: { contains: query.toUpperCase() } }, { benchLabel: { contains: query } }, { learnerId:{in:matchingLearners.map(l=>l.id)} }] }] } : {}),
  };
  const [total, records, experiments, learners] = await Promise.all([
    prisma.diagnosis.count({ where }),
    prisma.diagnosis.findMany({ where, include: { review:true, revisions: { orderBy: { version:'desc' } }, attempts: { orderBy: { createdAt:'desc' } } }, orderBy: [{ createdAt:'desc' }, { id:'desc' }], skip: (page-1)*pageSize, take:pageSize }),
    prisma.experiment.findMany({ where:{classroomId},select:{id:true,name:true} }),
    prisma.learner.findMany({ where:{classroomId},select:{id:true,number:true} }),
  ]);
  const names = new Map(experiments.map((e)=>[e.id,e.name]));
  const numbers = new Map(learners.map((l)=>[l.id,l.number]));
  return { items: records.map((record)=>toTeacherDiagnosis(record,names.get(record.experimentId ?? '') ?? '',numbers.get(record.learnerId ?? '') ?? '')), total, page, page_size:pageSize };
}
