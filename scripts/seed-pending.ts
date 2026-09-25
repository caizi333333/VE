/**
 * 插入一条待复核诊疗，供界面联调，不调模型。
 *
 * 用法：npx tsx scripts/seed-pending.ts
 */

import '../src/lib/load-env';
import { prisma } from '../src/lib/db';
import { allocateTicket } from '../src/lib/ticket';

async function main(): Promise<void> {
  const ticket = await allocateTicket();
  const saved = await prisma.diagnosis.create({
    data: {
      ticket,
      benchLabel: 'A3',
      symptomText: '联调：中断进不去（不调模型，只用来验证老师下发能否写回学生端）。',
      codeText: 'EA = 1;\nTR0 = 1;',
      redactionLog: '[]',
      faultChainId: 'timer-isr-not-entered',
      chainPointIds: JSON.stringify(['5.2.2', '6.1.3']),
      provider: 'glm',
      model: 'ui-seed',
      classification: '落在 5.2.2 中断允许寄存器',
      checkpoints: JSON.stringify([
        { point_id: '5.2.2', instruction: '（模型初稿）请检查 ET0 开了没有。' },
      ]),
      bridgingTask: '（模型初稿）先确认能进中断。',
      reviewNotes: JSON.stringify(['此条为界面联调种子，不是课堂实测。']),
      rawResponse: '{}',
    },
  });
  console.log(saved.ticket);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
