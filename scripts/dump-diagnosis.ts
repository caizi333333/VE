/**
 * 把指定诊疗记录的四段式结果与复核意见打到 stdout，供填写案例稿。
 *
 * 用法：npx tsx scripts/dump-diagnosis.ts [诊疗id]
 */

import '../src/lib/load-env';
import { prisma } from '../src/lib/db';

async function main(): Promise<void> {
  const requested_id = process.argv[2];
  const record = requested_id
    ? await prisma.diagnosis.findUnique({
        where: { id: requested_id },
        include: { review: true },
      })
    : await prisma.diagnosis.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { review: true },
      });

  if (!record) throw new Error('没有诊疗记录');
  console.log(
    JSON.stringify(
      {
        id: record.id,
        createdAt: record.createdAt.toISOString(),
        status: record.status,
        provider: record.provider,
        model: record.model,
        faultChainId: record.faultChainId,
        chainPointIds: JSON.parse(record.chainPointIds),
        classification: record.classification,
        checkpoints: JSON.parse(record.checkpoints),
        bridgingTask: record.bridgingTask,
        reviewNotes: JSON.parse(record.reviewNotes),
        rawResponse: record.rawResponse,
        symptomText: record.symptomText,
        codeText: record.codeText,
        redactionLog: JSON.parse(record.redactionLog),
        review: record.review
          ? {
              reviewer: record.review.reviewer,
              comment: record.review.comment,
              released: record.review.released,
              checkpoints: JSON.parse(record.review.checkpoints),
              bridgingTask: record.review.bridgingTask,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
