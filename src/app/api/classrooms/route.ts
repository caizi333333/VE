import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, hashToken, HttpError, randomToken, requireTeacher, withErrors } from '@/lib/auth';
import { classroomView } from '@/lib/classroom-view';
const includes = { experiments: { orderBy: { createdAt: 'asc' as const } }, learners: { orderBy: { number: 'asc' as const } } };
export const GET = withErrors(async (request: Request) => {
  const t = await requireTeacher(request);
  const classrooms = await prisma.classroom.findMany({ where: { teacherId: t.id }, include: includes, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ classrooms: classrooms.map(classroomView) });
});
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(80), data_source: z.enum(['classroom', 'demo']).default('classroom'), review_reference: z.string().trim().max(1000).default('') }),
  z.object({ action: z.literal('issue'), classroom_id: z.string().min(1), count: z.number().int().min(1).max(200) }),
  z.object({ action: z.literal('learner'), classroom_id: z.string().min(1), learner_id: z.string().min(1), active: z.boolean().optional(), participated: z.boolean().optional() }),
  z.object({ action: z.literal('update'), classroom_id: z.string().min(1), join_open: z.boolean().optional(), rotate_code: z.boolean().optional(), review_reference: z.string().trim().max(1000).optional(), participation_confirmed: z.boolean().optional() }),
]);
const joinCode = () => randomBytes(5).toString('hex').toUpperCase();
export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request); const teacher = await requireTeacher(request);
  const p = schema.safeParse(await request.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? '参数无效');
  const input = p.data;
  if (input.action === 'create') {
    const c = await prisma.classroom.create({ data: { name: input.name, teacherId: teacher.id, joinCode: joinCode(), dataSource: input.data_source, reviewReference: input.review_reference }, include: includes });
    return NextResponse.json({ classroom: classroomView(c) });
  }
  const c = await prisma.classroom.findFirst({ where: { id: input.classroom_id, teacherId: teacher.id } });
  if (!c) throw new HttpError(404, '课堂不存在');
  if (input.action === 'learner') {
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.learner.updateMany({ where: { id: input.learner_id, classroomId: c.id }, data: { active: input.active, participatedAt: input.participated === undefined ? undefined : input.participated ? new Date() : null } });
      if (!result.count) throw new HttpError(404, '学习编号不存在');
      await tx.classroom.update({ where: { id: c.id }, data: { participationConfirmed: false } });
      return tx.classroom.findUniqueOrThrow({ where: { id: c.id }, include: includes });
    });
    return NextResponse.json({ classroom: classroomView(updated) });
  }
  if (input.action === 'issue') {
    const cards = await prisma.$transaction(async tx => {
      const count = await tx.learner.count({ where: { classroomId: c.id } });
      const results: { number: string; recovery_code: string }[] = [];
      for (let i = 1; i <= input.count; i++) {
        const number = `L${String(count + i).padStart(3, '0')}`;
        const recovery_code = randomToken();
        await tx.learner.create({ data: { classroomId: c.id, number, recoveryHash: hashToken(recovery_code) } });
        results.push({ number, recovery_code });
      }
      await tx.classroom.update({ where: { id: c.id }, data: { participationConfirmed: false } });
      return results;
    });
    return NextResponse.json({ cards, class_code: c.joinCode });
  }
  const updated = await prisma.classroom.update({ where: { id: c.id }, data: { joinOpen: input.join_open, joinCode: input.rotate_code ? joinCode() : undefined, reviewReference: input.review_reference, participationConfirmed: input.participation_confirmed }, include: includes });
  return NextResponse.json({ classroom: classroomView(updated) });
});
