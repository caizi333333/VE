import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from './db';

const scrypt = promisify(scryptCallback);
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, encoded] = hash.split(':');
  if (!salt || !encoded || encoded.length !== 128) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(encoded, 'hex'));
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, '请从本平台页面提交');
  if (origin) {
    try { if (new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host)) return; } catch { /* invalid Origin */ }
    throw new HttpError(403, '请求来源不匹配');
  }
}
const COOKIE = { teacher: 've_teacher', learner: 've_learner' } as const;
function readCookie(request: Request, name: string): string | undefined {
  const entry = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return entry?.slice(name.length + 1);
}
async function tokenFrom(role: keyof typeof COOKIE, request?: Request): Promise<string | undefined> {
  return request ? readCookie(request, COOKIE[role]) : (await cookies()).get(COOKIE[role])?.value;
}
export async function getTeacher(request?: Request) {
  const token = await tokenFrom('teacher', request);
  if (!token || token.length > 128) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { teacher: true } });
  return session && session.expiresAt > new Date() ? session.teacher : null;
}
export async function getLearner(request?: Request) {
  const token = await tokenFrom('learner', request);
  if (!token || token.length > 128) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { learner: { include: { classroom: true } } } });
  return session && session.expiresAt > new Date() && session.learner?.active ? session.learner : null;
}
export async function requireTeacher(request?: Request) { const teacher = await getTeacher(request); if (!teacher) throw new HttpError(401, '请先登录教师账户'); return teacher; }
export async function requireLearner(request?: Request) { const learner = await getLearner(request); if (!learner) throw new HttpError(401, '请先使用匿名学习卡进入课堂'); return learner; }
export async function startSession(role: keyof typeof COOKIE, id: string, request: Request, response: NextResponse) {
  const old = await tokenFrom(role, request);
  if (old) await prisma.session.deleteMany({ where: { tokenHash: hashToken(old) } });
  const token = randomToken();
  const age = role === 'teacher' ? 12 * 3600 : 7 * 24 * 3600;
  await prisma.session.create({ data: { tokenHash: hashToken(token), [role === 'teacher' ? 'teacherId' : 'learnerId']: id, expiresAt: new Date(Date.now() + age * 1000) } });
  response.cookies.set(COOKIE[role], token, { httpOnly: true, sameSite: 'strict', secure: new URL(request.url).protocol === 'https:' || process.env.SECURE_COOKIES === 'true', path: '/', maxAge: age });
}
export async function endSessions(request: Request, response: NextResponse) {
  for (const role of ['teacher', 'learner'] as const) {
    const token = await tokenFrom(role, request);
    if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    response.cookies.set(COOKIE[role], '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  }
}
// Small pilot rate limits are kept in process; external deployment should add proxy limits.
const authBuckets = new Map<string, { count: number; expires: number }>();
export function rateLimit(key: string, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  if (authBuckets.size > 5000) for (const [k, v] of authBuckets) if (v.expires <= now) authBuckets.delete(k);
  const bucket = authBuckets.get(key);
  if (!bucket || bucket.expires <= now) { authBuckets.set(key, { count: 1, expires: now + windowMs }); return; }
  if (bucket.count >= max) throw new HttpError(429, '操作过于频繁，请稍后再试');
  bucket.count++;
}
export function withErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try { const response = await handler(...args); response.headers.set('Cache-Control', 'no-store'); return response; }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      // Never include provider bodies, credentials or submitted code in client errors/logs.
      if (status === 500) console.error('request_failed', error instanceof Error ? error.name : 'UnknownError');
      return NextResponse.json({ error: error instanceof HttpError ? error.message : '暂时无法完成，请稍后重试或联系教师' }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
