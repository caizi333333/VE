import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getLearner, getTeacher, HttpError, withErrors } from '@/lib/auth';

/** Exact blank eight-experiment report supplied by the course owner. */
export const GET = withErrors(async (request: Request) => {
  if (!await getTeacher(request) && !await getLearner(request)) throw new HttpError(401, '请先进入课堂');
  const content = await readFile(join(process.cwd(), 'assets', 'eight-lab-original.docx'));
  return new Response(new Uint8Array(content), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Length': String(content.length),
    'Content-Disposition': 'attachment; filename="eight-lab-original.docx"',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  } });
});
