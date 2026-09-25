import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, getLearner, getTeacher, HttpError, rateLimit, withErrors } from '@/lib/auth';
import { compileAndSimulate, MAX_NATIVE_STEPS, NativeCapacityError, withNativeSlot } from '@/lib/native-8051';
import { assemblyLab } from '@/lib/assembly-labs';

export const runtime = 'nodejs';
const schema = z.object({
  lab_id: z.number().int().min(1).max(8),
  code: z.string().min(1).max(12_000),
  steps: z.number().int().min(0).max(MAX_NATIVE_STEPS),
  key_steps: z.array(z.number().int().min(0).max(MAX_NATIVE_STEPS)).max(8).default([]),
  clock_hz: z.number().int().min(1_000_000).max(24_000_000).default(12_000_000),
  trace_port: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  secondary_port: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  tertiary_port: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  trace_window: z.number().int().min(1).max(MAX_NATIVE_STEPS).optional(),
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
  if (parsed.data.secondary_port && (!parsed.data.trace_port || parsed.data.secondary_port === parsed.data.trace_port)) throw new HttpError(400, '双端口采样参数无效');
  if (parsed.data.tertiary_port && (!parsed.data.secondary_port || parsed.data.tertiary_port === parsed.data.trace_port || parsed.data.tertiary_port === parsed.data.secondary_port)) throw new HttpError(400, '三端口采样参数无效');
  try {
    const result = await withNativeSlot(() => compileAndSimulate(parsed.data.code, parsed.data.steps, parsed.data.key_steps, parsed.data.clock_hz, parsed.data.trace_port ?? assemblyLab(parsed.data.lab_id)?.port, parsed.data.secondary_port, parsed.data.tertiary_port, parsed.data.trace_window));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (cause) {
    if (cause instanceof NativeCapacityError) throw new HttpError(429, cause.message);
    const error = cause as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') throw new HttpError(503, '服务器尚未安装 8051 汇编或仿真工具');
    throw new HttpError(422, error.message || '8051 汇编或仿真失败');
  }
});
