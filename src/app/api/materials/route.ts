import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, getLearner, getTeacher, HttpError, rateLimit, requireTeacher, withErrors } from '@/lib/auth';

const MAX_BYTES = 8 * 1024 * 1024;
const formats: Record<string, { mime: string; signature: (bytes: Buffer) => boolean; inline: boolean }> = {
  pdf: { mime: 'application/pdf', signature: b => b.subarray(0, 5).toString() === '%PDF-', inline: true },
  png: { mime: 'image/png', signature: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), inline: true },
  jpg: { mime: 'image/jpeg', signature: b => b[0] === 255 && b[1] === 216 && b[2] === 255, inline: true },
  jpeg: { mime: 'image/jpeg', signature: b => b[0] === 255 && b[1] === 216 && b[2] === 255, inline: true },
  webp: { mime: 'image/webp', signature: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP', inline: true },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: b => b.subarray(0, 2).toString() === 'PK' && b.includes(Buffer.from('word/document.xml')), inline: false },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', signature: b => b.subarray(0, 2).toString() === 'PK' && b.includes(Buffer.from('ppt/presentation.xml')), inline: false },
  asm: { mime: 'text/plain; charset=utf-8', signature: b => !b.includes(0) && b.length <= 256 * 1024, inline: false },
  a51: { mime: 'text/plain; charset=utf-8', signature: b => !b.includes(0) && b.length <= 256 * 1024, inline: false },
  hex: { mime: 'text/plain; charset=utf-8', signature: b => b.length <= 256 * 1024 && b.toString('ascii').split(/\r?\n/).filter(Boolean).every(line => /^:[0-9A-Fa-f]+$/.test(line)), inline: false },
};
const kinds = ['guide', 'diagram', 'manual', 'report', 'other'] as const;
const labId = (value: string | null) => {
  const number = Number(value);
  if (!value || !Number.isInteger(number) || number < 1 || number > 8) throw new HttpError(400, '请选择实验一至实验八');
  return number;
};
const view = (item: { id: string; classroomId: string; labId: number; kind: string; title: string; originalName: string; mimeType: string; byteSize: number; sha256: string; published: boolean; version: number; createdAt: Date }) => ({
  id: item.id, lab_id: item.labId, kind: item.kind, title: item.title,
  file_name: item.originalName, mime_type: item.mimeType, byte_size: item.byteSize,
  sha256: item.sha256, published: item.published, version: item.version,
  created_at: item.createdAt.toISOString(), url: `/api/materials?classroom_id=${encodeURIComponent(item.classroomId)}&file=${encodeURIComponent(item.id)}`,
});

export const GET = withErrors(async (request: Request) => {
  const teacher = await getTeacher(request);
  const learner = await getLearner(request);
  if (!teacher && !learner) throw new HttpError(401, '请先进入课堂或登录教师账户');
  const params = new URL(request.url).searchParams;
  const classroomId = params.get('classroom_id') ?? learner?.classroomId;
  if (!classroomId) throw new HttpError(400, '请选择班级');
  const teacherOwnsClass = !!(teacher && await prisma.classroom.findFirst({ where: { id: classroomId, teacherId: teacher.id }, select: { id: true } }));
  const learnerBelongsToClass = learner?.classroomId === classroomId;
  if (!teacherOwnsClass && !learnerBelongsToClass) throw new HttpError(404, '班级不存在');
  const file = params.get('file');
  const where = { classroomId, active: true, ...(teacherOwnsClass ? {} : { published: true }) };
  if (file) {
    const item = await prisma.courseMaterial.findFirst({ where: { ...where, id: file } });
    if (!item) throw new HttpError(404, '资料不存在或尚未发布');
    const extension = item.originalName.split('.').at(-1)?.toLowerCase() ?? '';
    const format = formats[extension];
    return new Response(new Uint8Array(item.content), { headers: {
      'Content-Type': item.mimeType,
      'Content-Length': String(item.byteSize),
      'Content-Disposition': `${format?.inline ? 'inline' : 'attachment'}; filename="material-${item.id}.${extension}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    } });
  }
  const id = labId(params.get('lab_id'));
  const materials = await prisma.courseMaterial.findMany({
    where: { ...where, labId: id },
    select: { id: true, classroomId: true, labId: true, kind: true, title: true, originalName: true, mimeType: true, byteSize: true, sha256: true, published: true, version: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ materials: materials.map(view) });
});

const update = z.object({ action: z.literal('update'), classroom_id: z.string().min(1), id: z.string().min(1), version: z.number().int().min(1), title: z.string().trim().min(2).max(100), published: z.boolean() });
const remove = z.object({ action: z.literal('remove'), classroom_id: z.string().min(1), id: z.string().min(1), version: z.number().int().min(1) });
export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request);
  const teacher = await requireTeacher(request);
  rateLimit(`materials:${teacher.id}`, 60, 60 * 60 * 1000);
  if (request.headers.get('content-type')?.includes('application/json')) {
    const parsed = z.union([update, remove]).safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, '资料更新参数无效');
    const input = parsed.data;
    const classroom = await prisma.classroom.findFirst({ where: { id: input.classroom_id, teacherId: teacher.id }, select: { id: true } });
    if (!classroom) throw new HttpError(404, '班级不存在');
    const changed = await prisma.courseMaterial.updateMany({
      where: { id: input.id, classroomId: classroom.id, teacherId: teacher.id, active: true, version: input.version },
      data: input.action === 'remove' ? { active: false, published: false, version: { increment: 1 } } : { title: input.title, published: input.published, version: { increment: 1 } },
    });
    if (!changed.count) throw new HttpError(409, '资料已变化，请刷新后重试');
    return NextResponse.json({ ok: true });
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES + 20_000) throw new HttpError(413, '单个文件不能超过8 MB');
  const form = await request.formData().catch(() => { throw new HttpError(400, '上传内容无效'); });
  const classroomId = String(form.get('classroom_id') ?? '');
  const classroom = await prisma.classroom.findFirst({ where: { id: classroomId, teacherId: teacher.id }, select: { id: true } });
  if (!classroom) throw new HttpError(404, '班级不存在');
  const id = labId(String(form.get('lab_id') ?? ''));
  const title = String(form.get('title') ?? '').trim();
  const kind = String(form.get('kind') ?? '');
  if (title.length < 2 || title.length > 100 || !kinds.includes(kind as typeof kinds[number])) throw new HttpError(400, '请填写资料名称并选择类别');
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) throw new HttpError(413, '请选择不超过8 MB的文件');
  const originalName = file.name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180);
  const extension = originalName.split('.').at(-1)?.toLowerCase() ?? '';
  const format = formats[extension];
  if (!format) throw new HttpError(400, '只支持 PDF、PNG、JPG、WebP、DOCX 或 PPTX');
  const content = Buffer.from(await file.arrayBuffer());
  if (!format.signature(content)) throw new HttpError(400, '文件内容与扩展名不符');
  const count = await prisma.courseMaterial.count({ where: { classroomId, active: true } });
  if (count >= 80) throw new HttpError(409, '本班资料已达80件，请先停用旧资料');
  const item = await prisma.courseMaterial.create({ data: {
    classroomId, teacherId: teacher.id, labId: id, title, kind, originalName,
    mimeType: format.mime, content, byteSize: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    published: form.get('published') === 'true',
  } });
  return NextResponse.json({ material: view(item) }, { status: 201 });
});
