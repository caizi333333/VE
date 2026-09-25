import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, getLearner, getTeacher, HttpError, rateLimit, withErrors } from '@/lib/auth';
import { compileAndSimulate, MAX_NATIVE_STEPS } from '@/lib/native-8051';
import { assemblyLab } from '@/lib/assembly-labs';

export const runtime = 'nodejs';
const schema = z.object({
  lab_id: z.number().int().min(1).max(8),
  code: z.string().min(1).max(12_000),
  steps: z.number().int().min(0).max(MAX_NATIVE_STEPS),
  key_steps: z.array(z.number().int().min(0).max(MAX_NATIVE_STEPS)).max(8).default([]),
  clock_hz: z.number().int().min(1_000_000).max(24_000_000).default(12_000_000),
}).strict();

export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request);
  const learner = await getLearner(request);
  const teacher = await getTeacher(request);
  if (!learner && !teacher) throw new HttpError(401, '请先进入课堂或登录教师账户');
  rateLimit(`assembly:${learner?.id ?? teacher?.id}`, 30, 60_000);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, '汇编参数无效');
  if (parsed.data.key_steps.length && parsed.data.lab_id !== 4) throw new HttpError(400, '本实验未设置 INT0 按键');
  try {
    const result = await compileAndSimulate(parsed.data.code, parsed.data.steps, parsed.data.key_steps, parsed.data.clock_hz, assemblyLab(parsed.data.lab_id)?.port);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') throw new HttpError(503, '服务器尚未安装 8051 汇编或仿真工具');
    throw new HttpError(422, error.message || '8051 汇编或仿真失败');
  }
});
