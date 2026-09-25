import { NextResponse } from 'next/server';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function assertExecutable(name: string) {
  const candidates = name.includes('/') ? [name] : (process.env.PATH || '').split(delimiter).map(dir => join(dir, name));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return; } catch { /* Try the next PATH entry. */ }
  }
  throw new Error('executable unavailable');
}

export async function GET() {
  try {
    await Promise.all([
      prisma.teacher.count(),
      assertExecutable(process.env.VE_AS31_PATH || join(homedir(), '.local/bin/ve-as31')),
      assertExecutable(process.env.VE_S51_PATH || 's51'),
    ]);
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
