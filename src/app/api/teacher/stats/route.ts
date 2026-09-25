import { NextResponse } from 'next/server';
import { requireTeacher, withErrors } from '@/lib/auth';
import { classroomStats } from '@/lib/stats';
export const dynamic='force-dynamic';
export const GET=withErrors(async(request:Request)=>{
  const teacher=await requireTeacher(request);
  return NextResponse.json(await classroomStats(teacher.id,new URL(request.url).searchParams));
});
