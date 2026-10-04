import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, HttpError, rateLimit, requireLearner, withErrors } from '@/lib/auth';
import { labPrep, type PrepPayload } from '@/lib/lab-prep';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  lab_id: z.number().int().min(1).max(8),
  courseware_done: z.boolean(),
  example_done: z.boolean(),
  answers: z.array(z.object({ id: z.string().max(10), answer: z.string().trim().min(1).max(600) })).max(4),
});

function parsePayload(raw: string): PrepPayload | null {
  try {
    const p = JSON.parse(raw) as PrepPayload;
    if (typeof p?.lab_id === 'number') return p;
  } catch { /* malformed event payload */ }
  return null;
}

async function latestPrep(learnerId: string, labId: number) {
  const events = await prisma.activityEvent.findMany({
    where: { learnerId, kind: 'prep' },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  for (const e of events) {
    const p = parsePayload(e.payloadJson);
    if (p?.lab_id === labId) return { submitted_at: e.createdAt.toISOString(), ...p };
  }
  return null;
}

export const GET = withErrors(async (request: Request) => {
  const learner = await requireLearner(request);
  const raw = new URL(request.url).searchParams.get('lab_id');
  const labId = raw && /^[1-8]$/.test(raw) ? Number(raw) : 0;
  if (!labId) throw new HttpError(400, '实验编号不合法');
  return NextResponse.json({ prep: await latestPrep(learner.id, labId) });
});

export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request);
  const learner = await requireLearner(request);
  rateLimit(`prep:${learner.id}`, 30);
  const input = postSchema.parse(await request.json());
  const prep = labPrep(input.lab_id);
  if (!prep) throw new HttpError(400, '实验编号不合法');
  const answers = prep.questions.map((q) => ({
    id: q.id,
    point: q.point,
    prompt: q.prompt,
    answer: input.answers.find((a) => a.id === q.id)?.answer ?? '',
  }));
  if (answers.some((a) => !a.answer)) throw new HttpError(400, '请回答全部预习问题后再提交');
  const payload: PrepPayload = { lab_id: input.lab_id, courseware_done: input.courseware_done, example_done: input.example_done, answers };
  await prisma.activityEvent.create({
    data: {
      classroomId: learner.classroomId,
      learnerId: learner.id,
      dataSource: learner.classroom.dataSource,
      kind: 'prep',
      payloadJson: JSON.stringify(payload),
    },
  });
  return NextResponse.json({ ok: true, prep: await latestPrep(learner.id, input.lab_id) });
});
