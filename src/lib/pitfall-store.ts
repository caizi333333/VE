/** Backfills are scoped to a classroom and attach only to independently retrieved nodes. */
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from './db';
import type { FaultPitfall } from './fault-chains';

export async function loadActivePitfalls(classroomId?: string, pointIds?: string[]): Promise<FaultPitfall[]> {
  // Legacy unowned backfills never enter a classroom prompt.
  if (!classroomId || !pointIds?.length) return [];
  const records = await prisma.pitfall.findMany({ where: { active:true, classroomId, pointId:{in:pointIds} }, orderBy:{createdAt:'desc'}, take:40 });
  return records.map((record)=>({point_id:record.pointId,description:record.description,source:'backfill' as const}));
}
export async function backfillPitfall(params: {point_id:string;description:string;author:string;diagnosis_id?:string;classroom_id?:string}, tx: Prisma.TransactionClient = prisma): Promise<void> {
  if (!params.classroom_id) throw new Error('回填必须关联班级');
  const normalized = params.description.replace(/[\s，。；、,.;]/g,'').toLowerCase();
  const dedupeKey = createHash('sha256').update(`${params.classroom_id}:${params.point_id}:${normalized}`).digest('hex');
  await tx.pitfall.upsert({where:{dedupeKey},create:{pointId:params.point_id,description:params.description,author:params.author,diagnosisId:params.diagnosis_id ?? null,classroomId:params.classroom_id,dedupeKey},update:{active:true}});
}
export async function countPitfallsByPoint(classroomId?: string): Promise<{point_id:string;count:number}[]> {
  if (!classroomId) return [];
  const grouped = await prisma.pitfall.groupBy({by:['pointId'],where:{active:true,classroomId},_count:{pointId:true}});
  return grouped.map((entry)=>({point_id:entry.pointId,count:entry._count.pointId})).sort((a,b)=>b.count-a.count);
}
