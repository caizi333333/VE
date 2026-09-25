import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireLearner, withErrors, HttpError } from '@/lib/auth';
import { normalizeTicket } from '@/lib/ticket';
import { toTicketView } from '@/lib/ticket-view';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ticket:string}> }) {
  return withErrors(async (request: Request) => {
    const learner = await requireLearner(request);
    const ticket = normalizeTicket((await context.params).ticket);
    const record = await prisma.diagnosis.findFirst({ where: { ticket, learnerId:learner.id, classroomId:learner.classroomId }, include: { revisions:true, attempts:{orderBy:{createdAt:'desc'}} } });
    if (!record) throw new HttpError(404, '诊疗记录不存在或不属于当前学习编号');
    const experiment = record.experimentId ? await prisma.experiment.findUnique({where:{id:record.experimentId}}) : null;
    return NextResponse.json(toTicketView(record, experiment?.name));
  })(request);
}
