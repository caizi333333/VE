/**
 * 学生端一键填入的三类典型故障样例。
 *
 * 与申报书正文三类故障一致，方便课堂上直接点着走完「提交 → 教师下发 → 取回」。
 */

export interface SampleCase {
  id: string;
  label: string;
  hint: string;
  symptom: string;
  code: string;
}

export const SAMPLE_CASES: readonly SampleCase[] = [
  {
    id: 'timer-isr-not-entered',
    label: '中断进不去',
    hint: '漏开 ET0',
    symptom: '实验三定时器中断控制 LED 闪烁，程序能下载，但中断进不去，LED 不翻转。',
    code: [
      'void main()',
      '{',
      '    TMOD = 0x01;',
      '    TH0 = 0x3C;',
      '    TL0 = 0xB0;',
      '    EA = 1;',
      '    TR0 = 1;',
      '    while(1);',
      '}',
      '',
      'void timer0() interrupt 1',
      '{',
      '    P1_0 = ~P1_0;',
      '}',
    ].join('\n'),
  },
  {
    id: 'uart-garbled',
    label: '串口乱码',
    hint: '晶振与波特率表不一致',
    symptom: '实验四串口发送字符串到上位机，能发出去，但是显示乱码。板子晶振是 12MHz。',
    code: [
      'void uart_init()',
      '{',
      '    SCON = 0x50;',
      '    TMOD |= 0x20;',
      '    TH1 = 0xFD;',
      '    TL1 = 0xFD;',
      '    TR1 = 1;',
      '}',
    ].join('\n'),
  },
  {
    id: 'timing-inaccurate',
    label: '定时不准',
    hint: '方式1未重装初值',
    symptom: '用定时器做 50ms 闪灯，第一次间隔还行，后面越来越慢，闪得不准。',
    code: [
      'void timer0() interrupt 1',
      '{',
      '    P1_0 = ~P1_0;',
      '}',
    ].join('\n'),
  },
];
