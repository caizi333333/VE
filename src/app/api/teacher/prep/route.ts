import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeacher, withErrors } from '@/lib/auth';
import { ownedClassroom } from '@/lib/teacher-data';
import type { PrepPayload } from '@/lib/lab-prep';

export const dynamic = 'force-dynamic';

export interface PrepRow {
  lab_id: number;
  learner_number: string;
  submitted_at: string;
  courseware_done: boolean;
  example_done: boolean;
  answers: { id: string; prompt: string; answer: string }[];
}

export const GET = withErrors(async (request: Request) => {
  const teacher = await requireTeacher(request);
  const classroomId = new URL(request.url).searchParams.get('classroom_id') ?? '';
  const classroom = await ownedClassroom(teacher.id, classroomId);
  const [learners, events] = await Promise.all([
    prisma.learner.findMany({ where: { classroomId: classroom.id, active: true }, select: { id: true, number: true } }),
    prisma.activityEvent.findMany({ where: { classroomId: classroom.id, kind: 'prep', dataSource: classroom.dataSource }, orderBy: { createdAt: 'desc' } }),
  ]);
  const numberById = new Map(learners.map((l) => [l.id, l.number]));
  const latest = new Map<string, PrepRow>();
  for (const e of events) {
    let p: PrepPayload | null = null;
    try { p = JSON.parse(e.payloadJson); } catch { /* skip malformed */ }
    if (!p || typeof p.lab_id !== 'number' || !e.learnerId) continue;
    const key = `${e.learnerId}:${p.lab_id}`;
    if (latest.has(key)) continue;
    latest.set(key, {
      lab_id: p.lab_id,
      learner_number: numberById.get(e.learnerId) ?? '未知编号',
      submitted_at: e.createdAt.toISOString(),
      courseware_done: !!p.courseware_done,
      example_done: !!p.example_done,
      answers: Array.isArray(p.answers) ? p.answers.map((a) => ({ id: a.id, prompt: a.prompt, answer: a.answer })) : [],
    });
  }
  return NextResponse.json({ rows: [...latest.values()].sort((a, b) => a.lab_id - b.lab_id || a.learner_number.localeCompare(b.learner_number)) });
});
