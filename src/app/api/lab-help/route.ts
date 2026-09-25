import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, hashToken, HttpError, rateLimit, requireLearner, withErrors } from '@/lib/auth';
import { LAB_PPT_NOTES, labGuide } from '@/lib/lab-guides';
import { getPoint } from '@/lib/knowledge-graph';
import { redactSubmission } from '@/lib/redact';
import { allocateTicket, normalizeTicket } from '@/lib/ticket';
import { readJson } from '@/lib/ticket-view';

const schema = z.object({
  lab_id: z.number().int().min(1).max(8),
  issue_type: z.enum(['wiring', 'code', 'result']).optional(),
  symptom: z.string().trim().min(3).max(2000),
  code: z.string().max(8000).default(''),
  idempotency_key: z.string().min(8).max(128),
  ticket: z.string().optional(),
  expected_version: z.number().int().min(0).optional(),
});

export const GET = withErrors(async (request: Request) => {
  await requireLearner(request);
  const raw = new URL(request.url).searchParams.get('lab');
  const guide = raw && /^[1-8]$/.test(raw) ? labGuide(Number(raw)) : undefined;
  if (!guide) throw new HttpError(400, '请选择实验一至实验八');
  const lines = [
    `# 实验${guide.id}：${guide.title} · 课堂核对单`, '',
    `目标：${guide.goal}`, `报告任务：${guide.task}`, `对应课件：${guide.ppt}`, '',
    '## 课件提醒', LAB_PPT_NOTES[guide.id], '',
    '## 接线与器件', ...guide.wiring.map((item) => `- [ ] ${item}`), '',
    '## 代码检查', ...guide.code.map((item) => `- [ ] ${item}`), '',
    '## 结果与预期不符时', ...guide.resultChecks.map((item) => `- [ ] ${item}`), '',
    '## 观察记录', ...guide.observations.map((item) => `- ${item}：________`), '',
    '## 资料准备', guide.evidence, '',
    '照片与视频需按实际板卡采集；当前平台仅接收文字与代码，影像收集方式由教师确认。',
    '本单依据课程八份实验报告及对应课件整理；实验板型号、接线和评价要求以任课教师当次配置为准。',
  ];
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="lab-${guide.id}-checklist.md"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request);
  const learner = await requireLearner(request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? '求助内容无效');
  const input = parsed.data;
  const guide = labGuide(input.lab_id);
  if (!guide || !getPoint(guide.pointId)) throw new HttpError(400, '实验指引不可用');
  if (learner.classroom.dataSource === 'classroom' && !learner.classroom.reviewReference.trim()) {
    throw new HttpError(409, '教师尚未完成课堂试用审查记录');
  }
  const redacted = redactSubmission(input.symptom, input.code);
  if (redacted.hits.length) throw new HttpError(400, '请先删除姓名、学号和其他身份信息');
  const key = hashToken(`lab-help:${learner.id}:${input.idempotency_key}`);
  const inputHash = hashToken(JSON.stringify(input));
  const existing = await prisma.generationRequest.findUnique({ where: { key } });
  if (existing) {
    if (existing.inputHash !== inputHash) throw new HttpError(409, '提交内容已变化，请重新提交');
    const record = existing.diagnosisId
      ? await prisma.diagnosis.findFirst({ where: { id: existing.diagnosisId, learnerId: learner.id } })
      : null;
    if (!record) throw new HttpError(409, '求助正在受理，请稍后重试');
    return NextResponse.json({ id: record.id, ticket: record.ticket, status: record.status });
  }
  rateLimit(`lab-help:${learner.id}`, 20, 60 * 60 * 1000);
  const original = input.ticket
    ? await prisma.diagnosis.findFirst({ where: { ticket: normalizeTicket(input.ticket), learnerId: learner.id, classroomId: learner.classroomId } })
    : null;
  if (input.ticket && !original) throw new HttpError(404, '原求助记录不存在');
  if (original && (original.faultChainId !== `lab-${guide.id}` || original.version !== input.expected_version)) {
    throw new HttpError(409, '实验或记录版本已变化，请刷新后重试');
  }
  const ticket = original?.ticket ?? await allocateTicket();
  const point = getPoint(guide.pointId)!;
  const suggestedChecks = input.issue_type === 'wiring' ? guide.wiring
    : input.issue_type === 'code' ? guide.code
    : input.issue_type === 'result' ? guide.resultChecks
    : [guide.wiring[0], guide.code[0]];
  const checkpoints = suggestedChecks.filter(Boolean).map((instruction, index) => ({
    id: `r${original ? original.round + 1 : 1}-cp${index + 1}`,
    point_id: point.id,
    instruction,
  }));
  const taskPack = [
    { level: 1, title: '基础：定位现象', instruction: `逐项执行本次的${checkpoints.length}个检查点，记录第一处与预期不符的结果。`, objective: '找出可复现的差异。', deliverable: `记录${guide.observations.join('、')}；保留相关代码或接线依据。`, verification: '教师核对检查过程与观察记录。' },
    { level: 2, title: '综合：修订并验证', instruction: '依据基础检查的结果，修订相关代码或接线，并用相同条件再次观察。', objective: '说明修订前后现象的变化。', deliverable: '修订前后代码或接线说明，以及复测记录。', verification: '教师核对修订内容与实物或仿真结果。' },
    { level: 3, title: '拓展：解释适用条件', instruction: `结合“${guide.title}”实验任务，解释本次问题在不同输入或操作条件下是否仍出现。`, objective: '说明排查结论的适用范围。', deliverable: '对照观察记录与简短解释。', verification: '教师确认解释与本次实验依据一致。' },
  ].map((task) => ({ ...task, point_id: point.id, conditions: '以教师确认的板卡、接线及实验目标为准。' }));
  try {
    const record = await prisma.$transaction(async (tx) => {
      await tx.generationRequest.create({ data: { key, learnerId: learner.id, inputHash, status: 'manual_pending' } });
      const data = {
          ticket, classroomId: learner.classroomId, learnerId: learner.id,
          dataSource: learner.classroom.dataSource, experimentId: null,
          faultChainId: `lab-${guide.id}`, symptomText: redacted.symptom,
          codeText: redacted.code, redactionLog: JSON.stringify(redacted.hits),
          chainPointIds: JSON.stringify([point.id]), provider: '', model: '',
          classification: `实验${guide.id}：${guide.title} · 待教师指导`,
          checkpoints: JSON.stringify(checkpoints), bridgingTask: `先记录${guide.observations.join('与')}，对照本次实验目标说明差异。`,
          reviewNotes: JSON.stringify(['以下为课程资料整理的待复核检查草稿；未调用模型。教师须核对实际实验板、代码及接线后再发布。', `课件对照：${LAB_PPT_NOTES[guide.id]}`]),
          rawResponse: '', status: 'manual_pending',
          promptVersion: 'manual-lab-guide-v1', graphVersion: 'manual-lab-guide-v1',
          configSnapshot: JSON.stringify({ configuration_confirmed: false, lab_id: guide.id, issue_type: input.issue_type ?? null }),
          rubricSnapshot: '[]', assessmentJson: '[]',
          constraintSnapshot: JSON.stringify({ points: [{ id: point.id, name: point.name, chapter: point.chapter }], edges: [] }),
          taskPackJson: JSON.stringify(taskPack),
          round: original ? original.round + 1 : 1, publishedVersion: null,
          activeTaskLevel: 1, completedAt: null, studentTicks: '[]', studentOutcome: '',
      };
      let created;
      if (original) {
        const updated = await tx.diagnosis.updateMany({
          where: { id: original.id, version: input.expected_version },
          data: {
            ...data, version: { increment: 1 },
            roundsJson: JSON.stringify([
              ...readJson<unknown[]>(original.roundsJson, []),
              { round: original.round, symptom: original.symptomText, code: original.codeText,
                classification: original.classification, published_version: original.publishedVersion,
                archived_at: new Date().toISOString() },
            ]),
          },
        });
        if (!updated.count) throw new HttpError(409, '记录已更新，请刷新后重试');
        created = await tx.diagnosis.findUniqueOrThrow({ where: { id: original.id } });
      } else {
        created = await tx.diagnosis.create({ data });
      }
      await tx.generationRequest.update({ where: { key }, data: { diagnosisId: created.id } });
      await tx.activityEvent.create({
        data: {
          classroomId: learner.classroomId, learnerId: learner.id, diagnosisId: created.id,
          dataSource: learner.classroom.dataSource, kind: 'submission',
          payloadJson: JSON.stringify({ lab_id: guide.id, issue_type: input.issue_type ?? null, source: 'eight-lab-guide', review_required: true, round: created.round }),
        },
      });
      return created;
    });
    return NextResponse.json({ id: record.id, ticket: record.ticket, status: record.status }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const saved = await prisma.generationRequest.findUnique({ where: { key } });
      if (saved?.inputHash === inputHash && saved.diagnosisId) {
        const record = await prisma.diagnosis.findFirst({ where: { id: saved.diagnosisId, learnerId: learner.id } });
        if (record) return NextResponse.json({ id: record.id, ticket: record.ticket, status: record.status });
      }
    }
    throw error;
  }
});
