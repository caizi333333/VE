import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, endSessions, getLearner, getTeacher, hashPassword, HttpError, rateLimit, startSession, verifyPassword, withErrors } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export const GET = withErrors(async (request: Request) => {
  const [teacher, learner] = await Promise.all([getTeacher(request), getLearner(request)]);
  return NextResponse.json({ teacher: teacher ? { id: teacher.id, name: teacher.displayName, username: teacher.username } : null, learner: learner ? { id: learner.id, number: learner.number, classroom_id: learner.classroomId, classroom_name: learner.classroom.name } : null });
});
const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('login'), username: z.string().trim().min(1).max(80), password: z.string().min(1).max(256) }), z.object({ action: z.literal('logout') })]);
let dummyHash: Promise<string> | undefined;
export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, '请填写有效的账户和密码');
  const response = NextResponse.json({ ok: true });
  if (parsed.data.action === 'logout') { await endSessions(request, response); return response; }
  const { username, password } = parsed.data;
  rateLimit(`login:${username.toLowerCase()}`);
  const teacher = await prisma.teacher.findUnique({ where: { username } });
  dummyHash ??= hashPassword('unavailable-account-placeholder');
  const valid = await verifyPassword(password, teacher?.passwordHash ?? await dummyHash);
  if (!teacher || !valid) throw new HttpError(401, '账户或密码不正确');
  await startSession('teacher', teacher.id, request, response);
  return response;
});
