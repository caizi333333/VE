import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, hashToken, HttpError, rateLimit, requireLearner, withErrors } from '@/lib/auth';
import { redactSubmission } from '@/lib/redact';
import { retrieveConstraint } from '@/lib/retrieval';
import { loadActivePitfalls } from '@/lib/pitfall-store';
import { buildMessages, parseDiagnosis, PROMPT_TEMPLATE_VERSION, type DiagnosisOutput } from '@/lib/prompt';
import { chatComplete, type ChatResult } from '@/lib/llm-provider';
import { allocateTicket, normalizeTicket } from '@/lib/ticket';
import { readJson, stableCheckpoints } from '@/lib/ticket-view';
import { buildPracticePack } from '@/lib/practice-tasks';
import { canAdmitGeneration, effectiveExperiment, GENERATION_BUDGET_MS } from '@/lib/diagnosis-policy';
import type { ExperimentConfig, RubricItem } from '@/lib/api-types';
export const maxDuration = 120;
const bodySchema = z.object({
  experiment_id:z.string().min(1), symptom:z.string().trim().min(1,'请描述观察到的现象').max(2000), code:z.string().max(8000).default(''),
  bench_label:z.string().max(16).default(''), idempotency_key:z.string().min(8).max(128),
  ticket:z.string().optional(), expected_version:z.number().int().min(0).optional(),
});
const response = (record: {id:string;ticket:string;status:string}, status=200) => NextResponse.json({id:record.id,ticket:record.ticket,status:record.status},{status});
const GENERATION_STALE_MS = 5 * 60 * 1000;

export const POST = withErrors(async (request: Request) => {
  const deadlineAt=Date.now()+GENERATION_BUDGET_MS;
  assertSameOrigin(request);
  const learner = await requireLearner(request);
  const parsed = bodySchema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) throw new HttpError(400,parsed.error.issues[0]?.message ?? '提交参数不合法');
  const input = parsed.data;
  const inputHash = hashToken(JSON.stringify(input));
  const key = hashToken(`${learner.id}:${input.idempotency_key}`);
  async function existingResponse() {
    const existing = await prisma.generationRequest.findUnique({where:{key}});
    if (!existing) return null;
    if (existing.inputHash !== inputHash) throw new HttpError(409,'同一次提交标识对应的内容不同，请刷新后重新提交');
    if (!existing.diagnosisId) throw new HttpError(409,'提交正在受理，请稍后重试');
    if (existing.status === 'processing' && Date.now()-existing.updatedAt.getTime() > GENERATION_STALE_MS) {
      await prisma.$transaction(async (tx)=>{
        await tx.diagnosis.updateMany({where:{id:existing.diagnosisId!,status:'generating'},data:{status:'manual_pending',reviewNotes:JSON.stringify(['内容生成中断，请教师人工处理'])}});
        await tx.generationRequest.updateMany({where:{key,status:'processing'},data:{status:'manual_pending',errorCode:'generation_interrupted'}});
      });
    }
    const record = await prisma.diagnosis.findFirst({where:{id:existing.diagnosisId,learnerId:learner.id}});
    if (!record) throw new HttpError(409,'提交记录不可用，请联系教师');
    return response(record,record.status==='generating'?202:200);
  }
  const duplicate = await existingResponse();
  if (duplicate) return duplicate;
  rateLimit(`diagnose:${learner.id}`,20,60*60*1000);
  const experiment = await prisma.experiment.findFirst({where:{id:input.experiment_id,classroomId:learner.classroomId}});
  if (!experiment) throw new HttpError(404,'实验不存在或不属于当前班级');
  if (learner.classroom.dataSource === 'classroom' && !learner.classroom.reviewReference.trim()) throw new HttpError(409,'教师尚未完成课堂试用审查记录');
  const configured = readJson<ExperimentConfig>(experiment.configJson,{});
  const policy = effectiveExperiment(configured,readJson<RubricItem[]>(experiment.rubricJson,[]),experiment.confirmed,experiment.faultChainId,experiment.version);
  const {config,rubric,calculations}=policy;
  if (input.bench_label && !(configured.benches ?? []).includes(input.bench_label)) throw new HttpError(400,'请从本实验预设工位中选择');
  const redacted = redactSubmission(input.symptom,input.code);
  // Explicit observed symptoms take precedence over incidental keywords in code comments.
  const symptomConstraint = retrieveConstraint(redacted.symptom,'');
  const retrievalCode = symptomConstraint.fault_chain ? '' : redacted.code;
  const initial = symptomConstraint.fault_chain ? symptomConstraint : retrieveConstraint(redacted.symptom,redacted.code);
  if (!initial.points.length || !initial.fault_chain) throw new HttpError(422,'当前支持中断不触发、串口乱码和定时不准，请补充本实验的具体现象或联系教师');
  if (initial.fault_chain.id !== experiment.faultChainId) throw new HttpError(422,'描述的故障与所选实验不一致，请选择对应实验');
  const backfills = await loadActivePitfalls(learner.classroomId,initial.points.map(p=>p.id));
  const constraint = retrieveConstraint(redacted.symptom,retrievalCode,backfills);
  const pointIds = constraint.points.map(p=>p.id);
  const diagnosisContext = {config,rubric,calculations,code_line_count:redacted.code.trim()?redacted.code.split('\n').length:0};
  const original = input.ticket ? await prisma.diagnosis.findFirst({where:{ticket:normalizeTicket(input.ticket),learnerId:learner.id,classroomId:learner.classroomId},include:{revisions:true,attempts:true,review:true}}) : null;
  if (input.ticket && !original) throw new HttpError(404,'诊疗记录不存在或不属于当前学习编号');
  if (original && (input.expected_version !== original.version || original.experimentId!==experiment.id || original.status==='generating')) throw new HttpError(409,'诊疗版本已更新或实验不一致，请刷新后重试');
  const ticket = original?.ticket ?? await allocateTicket();
  const round = original ? original.round+1 : 1;
  let saved: {id:string;ticket:string;status:string;version:number};
  try {
    saved = await prisma.$transaction(async tx=>{
      // Claim the idempotency key before the admission query so the transaction owns a write lock.
      await tx.generationRequest.create({data:{key,learnerId:learner.id,inputHash}});
      const active=await tx.generationRequest.count({where:{status:'processing',key:{not:key},updatedAt:{gte:new Date(Date.now()-GENERATION_BUDGET_MS)}}});
      const admitted=canAdmitGeneration(active) && Date.now()<deadlineAt;
      const data = {
        benchLabel:input.bench_label,symptomText:redacted.symptom,codeText:redacted.code,redactionLog:JSON.stringify(redacted.hits),
        faultChainId:experiment.faultChainId,chainPointIds:JSON.stringify(pointIds),provider:'',model:'',classification:'内容生成中',
        checkpoints:'[]',bridgingTask:'',reviewNotes:JSON.stringify(admitted?[]:['生成服务繁忙，本次提交已保存，请教师人工处理']),rawResponse:'',status:admitted?'generating':'manual_pending',classroomId:learner.classroomId,
        learnerId:learner.id,experimentId:experiment.id,dataSource:learner.classroom.dataSource,promptVersion:PROMPT_TEMPLATE_VERSION,
        graphVersion:hashToken(JSON.stringify(constraint.points)).slice(0,16),configSnapshot:JSON.stringify(policy.snapshot),rubricSnapshot:JSON.stringify(rubric),
        constraintSnapshot:JSON.stringify({points:constraint.points.map(({id,name,chapter})=>({id,name,chapter})),edges:constraint.edges}),
        assessmentJson:JSON.stringify(rubric.map(item=>({criterion_id:item.id,score:null,reason:'待教师评阅'}))),taskPackJson:JSON.stringify(buildPracticePack(experiment.faultChainId,'请教师根据提交内容填写基础验证任务',pointIds[0],config)),
        round,publishedVersion:null,studentTicks:'[]',studentOutcome:'',studentResolvedPoint:'',activeTaskLevel:1,completedAt:null,
      };
      let record;
      if (original) {
        const changed = await tx.diagnosis.updateMany({where:{id:original.id,version:input.expected_version,status:{not:'generating'}},data:{...data,version:{increment:1},roundsJson:JSON.stringify([...readJson<unknown[]>(original.roundsJson,[]),{round:original.round,symptom:original.symptomText,code:original.codeText,checkpoints:readJson(original.checkpoints,[]),bridging_task:original.bridgingTask,published_version:original.publishedVersion,classification:original.classification,assessment:readJson(original.assessmentJson,[]),tasks:readJson(original.taskPackJson,[]),provider:original.provider,model:original.model,raw_response:original.rawResponse,review_notes:readJson(original.reviewNotes,[]),redaction_log:readJson(original.redactionLog,[]),config:readJson(original.configSnapshot,{}),rubric:readJson(original.rubricSnapshot,[]),constraint:readJson(original.constraintSnapshot,{}),prompt_version:original.promptVersion,graph_version:original.graphVersion,completed_at:original.completedAt?.toISOString() ?? null,archived_at:new Date().toISOString()}])}});
        if (!changed.count) throw new HttpError(409,'诊疗版本已更新，请刷新后重试');
        record = await tx.diagnosis.findUniqueOrThrow({where:{id:original.id}});
      } else record = await tx.diagnosis.create({data:{...data,ticket}});
      await tx.generationRequest.update({where:{key},data:{diagnosisId:record.id,status:admitted?'processing':'manual_pending',errorCode:admitted?null:'model_overloaded'}});
      await tx.activityEvent.create({data:{classroomId:learner.classroomId,learnerId:learner.id,diagnosisId:record.id,dataSource:record.dataSource,kind:'submission',payloadJson:JSON.stringify({round,experiment_id:experiment.id,prompt_version:PROMPT_TEMPLATE_VERSION,experiment_version:experiment.version,configuration_confirmed:experiment.confirmed})}});
      if(!admitted)await tx.activityEvent.create({data:{classroomId:learner.classroomId,learnerId:learner.id,diagnosisId:record.id,dataSource:record.dataSource,kind:'generation_failed',payloadJson:JSON.stringify({round,reason:'model_overloaded'})}});
      const firstParticipation=await tx.learner.updateMany({where:{id:learner.id,participatedAt:null},data:{participatedAt:new Date()}});
      // A newly participating identifier changes the roster denominator and needs a fresh teacher check.
      if(firstParticipation.count)await tx.classroom.update({where:{id:learner.classroomId},data:{participationConfirmed:false}});
      return record;
    });
  } catch(error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') {const replay=await existingResponse();if(replay)return replay;}
    throw error;
  }
  if(saved.status==='manual_pending')return response(saved);
  // Model retry and persistence are deliberately separate. A failed DB write never recalls the model.
  let generated: DiagnosisOutput | null = null;
  let chat: ChatResult | null = null;
  const messages = buildMessages(constraint,redacted.symptom,redacted.code,diagnosisContext);
  let retryInstruction = '';
  for(let attempt=0;attempt<2 && Date.now()<deadlineAt;attempt++) {
    try {
      chat = await chatComplete(attempt ? [...messages,{role:'user',content:retryInstruction}] : messages,{deadlineAt});
      generated = parseDiagnosis(chat.content,pointIds,diagnosisContext);
      break;
    } catch(error) {
      if (!chat) break; // Network/config failures become a manual task instead of triggering duplicate calls.
      retryInstruction = `上一版未通过校验：${error instanceof Error ? error.message.slice(0,160) : '结构错误'}。仅返回 JSON；checkpoints 为 1—3 条且 point_id 只能选 ${pointIds.join('、')}；${rubric.length ? `assessments 只能使用教师量规编号 ${rubric.map(item=>item.id).join('、')}` : '没有确认量规，assessments 必须为 []'}；不自行计算数值。`;
    }
  }
  const output = generated && chat ? {
    status:'pending_review',provider:chat.provider,model:chat.model,classification:generated.classification,
    checkpoints:JSON.stringify(stableCheckpoints(generated.checkpoints,round)),bridgingTask:generated.bridging_task,
    reviewNotes:JSON.stringify([...generated.review_notes,...(!experiment.confirmed?['实验配置尚未确认，本轮仅提供定性排查，不提供数值结论和评分。']:[])]),rawResponse:chat.content,assessmentJson:JSON.stringify(rubric.map(item=>generated!.assessments?.find(a=>a.criterion_id===item.id) ?? {criterion_id:item.id,score:null,reason:'模型未提供此项依据，待教师评阅'})),
    taskPackJson:JSON.stringify(buildPracticePack(experiment.faultChainId,generated.bridging_task,generated.checkpoints[0]?.point_id ?? pointIds[0],config)),
  } : {
    status:'manual_pending',classification:'需要教师人工处理',reviewNotes:JSON.stringify(['未取得合格的模型结果；教师可直接填写指导和三级任务。',...(!experiment.confirmed?['实验配置尚未确认，本轮仅提供定性指导，不提供数值结论和评分。']:[]),...calculations.map(c=>c.summary)]),
    taskPackJson:JSON.stringify(buildPracticePack(experiment.faultChainId,'请教师根据提交内容填写基础验证任务',pointIds[0],config)),
  };
  await prisma.$transaction(async tx=>{
    const updated = await tx.diagnosis.updateMany({where:{id:saved.id,version:saved.version,status:'generating'},data:output});
    await tx.generationRequest.update({where:{key},data:{status:generated?'complete':'manual_pending',errorCode:generated?null:'model_unavailable'}});
    if (updated.count) await tx.activityEvent.create({data:{classroomId:learner.classroomId,learnerId:learner.id,diagnosisId:saved.id,dataSource:learner.classroom.dataSource,kind:generated?'generation_completed':'generation_failed',payloadJson:JSON.stringify({round})}});
  });
  const final = await prisma.diagnosis.findUniqueOrThrow({where:{id:saved.id}});
  return response(final);
});
