import { NextResponse } from 'next/server';
import { requireTeacher, withErrors } from '@/lib/auth';
import { teacherDiagnoses } from '@/lib/teacher-data';
export const dynamic = 'force-dynamic';
export const GET = withErrors(async (request: Request) => {
  const teacher = await requireTeacher(request);
  return NextResponse.json(await teacherDiagnoses(teacher.id, new URL(request.url).searchParams));
});
