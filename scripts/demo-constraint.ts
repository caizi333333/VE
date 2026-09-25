/**
 * 打印图谱约束实际组装出来的提示词，不调用模型、不需要密钥。
 *
 * 用途有两个：一是验证依赖链召回确实按课程逻辑走；二是现场演示时可以直接
 * 把这段贴给评委看"模型被允许在什么范围内说话"。
 *
 * 用法：npm run demo:constraint -- "现象描述"
 */

import { retrieveConstraint } from '../src/lib/retrieval';
import { buildSystemPrompt } from '../src/lib/prompt';

const DEFAULT_SAMPLES: { symptom: string; code: string }[] = [
  {
    symptom: '实验三定时器中断控制 LED 闪烁，程序能下载，但中断进不去，LED 不翻转。',
    code: [
      'void main() {',
      '    TMOD = 0x01;',
      '    TH0 = 0x3C; TL0 = 0xB0;',
      '    EA = 1;',
      '    TR0 = 1;',
      '    while(1);',
      '}',
    ].join('\n'),
  },
  { symptom: '串口乱码，上位机显示乱码，波特率设的 9600。', code: '' },
  { symptom: '定时不准，LED 闪烁太快，和秒表对不上。', code: '' },
];

const cli_symptom = process.argv[2];
const samples = cli_symptom ? [{ symptom: cli_symptom, code: '' }] : DEFAULT_SAMPLES;

for (const sample of samples) {
  const constraint = retrieveConstraint(sample.symptom, sample.code);

  console.log('='.repeat(78));
  console.log(`现象：${sample.symptom}`);
  console.log(
    `命中故障链：${constraint.fault_chain?.name ?? '未命中（退回文本检索）'}　` +
      `注入节点 ${constraint.points.length} 个　依赖边 ${constraint.edges.length} 条　` +
      `已知易错点 ${constraint.pitfalls.length} 条`,
  );
  console.log('-'.repeat(78));
  console.log(buildSystemPrompt(constraint));
  console.log();
}
