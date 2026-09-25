import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, hashToken, HttpError, rateLimit, startSession, withErrors } from '@/lib/auth';
const schema = z.object({ class_code: z.string().trim().toUpperCase().min(4).max(20), learner_number: z.string().trim().toUpperCase().min(1).max(20), recovery_code: z.string().trim().min(8).max(128) });
export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request);
  const p = schema.safeParse(await request.json().catch(() => null));
  if (!p.success) throw new HttpError(400, '请填写学习卡上的班级码、编号和恢复码');
  const input = p.data;
  rateLimit(`join:${input.class_code}:${input.learner_number}`, 12);
  const classroom = await prisma.classroom.findUnique({ where: { joinCode: input.class_code } });
  const learner = classroom ? await prisma.learner.findUnique({ where: { classroomId_number: { classroomId: classroom.id, number: input.learner_number } } }) : null;
  if (!classroom?.joinOpen || !learner?.active || learner.recoveryHash !== hashToken(input.recovery_code)) throw new HttpError(401, '学习卡信息不正确，或课堂暂未开放');
  const response = NextResponse.json({ ok: true, learner: { id: learner.id, number: learner.number, classroom_id: classroom.id, classroom_name: classroom.name } });
  await startSession('learner', learner.id, request, response);
  return response;
});
