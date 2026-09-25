import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, hashToken, HttpError, requireLearner, withErrors } from '@/lib/auth';
import { normalizeTicket } from '@/lib/ticket';
import { publishedPayload } from '@/lib/ticket-view';
import { redactSubmission } from '@/lib/redact';
export const dynamic='force-dynamic';
const schema=z.object({published_version:z.number().int().nonnegative(),ticks:z.array(z.string().max(80)).max(8),outcome:z.enum(['checking','stuck','resolved']),observation:z.string().trim().min(1,'请填写实际观察结果').max(4000),code:z.string().max(8000).default(''),level:z.number().int().min(1).max(3),idempotency_key:z.string().min(8).max(128)});
export async function POST(request:Request,context:{params:Promise<{ticket:string}>}) {
  return withErrors(async(request:Request)=>{
    assertSameOrigin(request);
    const learner=await requireLearner(request);
    const parsed=schema.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message ?? '回执参数不合法');
    const input=parsed.data;
    const ticket=normalizeTicket((await context.params).ticket);
    const record=await prisma.diagnosis.findFirst({where:{ticket,learnerId:learner.id,classroomId:learner.classroomId},include:{revisions:true}});
    if(!record)throw new HttpError(404,'诊疗记录不存在或不属于当前学习编号');
    const key=hashToken(`${learner.id}:${record.id}:${input.idempotency_key}`);
    const redacted=redactSubmission(input.observation,input.code);
    async function replay() {
      const prior=await prisma.taskAttempt.findUnique({where:{idempotencyKey:key}});
      if(!prior)return false;
      if(prior.publishedVersion!==input.published_version || prior.level!==input.level || prior.outcome!==input.outcome || prior.observation!==redacted.symptom || prior.codeText!==redacted.code || prior.ticksJson!==JSON.stringify(input.ticks))throw new HttpError(409,'重复提交标识对应的回执内容不同');
      return true;
    }
    if(await replay())return NextResponse.json({ok:true});
    const published=publishedPayload(record);
    if(!published || record.publishedVersion!==input.published_version)throw new HttpError(409,'指导内容尚未下发或已有更新，请刷新后重试');
    if(input.level>record.activeTaskLevel || !published.payload.tasks.some(t=>t.level===input.level))throw new HttpError(409,'请先完成前一级任务并等待教师验证');
    const checkpointIds=new Set(published.payload.checkpoints.map(cp=>cp.id));
    if(new Set(input.ticks).size!==input.ticks.length || input.ticks.some(id=>!checkpointIds.has(id)))throw new HttpError(400,'检查点标识与发布版本不一致');
    try {
      await prisma.$transaction(async tx=>{
        const changed=await tx.diagnosis.updateMany({where:{id:record.id,status:'released',publishedVersion:input.published_version,version:record.version},data:{studentTicks:JSON.stringify(input.ticks),studentOutcome:input.outcome}});
        if(!changed.count)throw new HttpError(409,'指导内容已有更新，请刷新后重试');
        const attempt=await tx.taskAttempt.create({data:{diagnosisId:record.id,learnerId:learner.id,publishedVersion:input.published_version,level:input.level,ticksJson:JSON.stringify(input.ticks),observation:redacted.symptom,codeText:redacted.code,outcome:input.outcome,idempotencyKey:key}});
        await tx.activityEvent.create({data:{classroomId:record.classroomId,learnerId:learner.id,diagnosisId:record.id,dataSource:record.dataSource,kind:input.outcome==='stuck'?'help':'attempt_submitted',payloadJson:JSON.stringify({attempt_id:attempt.id,published_version:input.published_version,level:input.level,experiment_id:record.experimentId})}});
      });
    }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002' && await replay())return NextResponse.json({ok:true});throw error;}
    return NextResponse.json({ok:true});
  })(request);
}
