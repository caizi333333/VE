import { LAB2_GROUP_LED_ASM, LAB3_ORIGINAL_TIMER_ASM, LAB5_SCAN_ASM, LAB5_SCAN_CORRECTED_ASM, LAB6_INTERMITTENT_ASM, LAB6_TWO_TONE_ASM, LAB7_CLOCK_ALARM_ASM, LAB7_CLOCK_ASM, LAB8_ABSTRACT_STEPPER_ASM, LAB8_PWM_70_ASM } from './assembly-presets';

/** Eight editable 8051 exercises, with source-backed historical variants where available. */
export interface AssemblyLab {
  id: number;
  title: string;
  source: string;
  purpose: string;
  observation: string;
  code: string;
  port?: 'P0' | 'P1' | 'P2' | 'P3';
  activeLow?: boolean;
  key?: { port: 'P3'; bit: number; label: string };
  variants?: readonly { id: string; title: string; source: string; code: string; port?: 'P0' | 'P1' | 'P2' | 'P3' }[];
}

export const ASSEMBLY_LABS: readonly AssemblyLab[] = [
  { id: 1, title: '指令与堆栈单步', source: '按原实验报告实验一及备课 EG2.asm 整理的教学摘录', purpose: '单步观察 A、SP 和内部 RAM 30H。', observation: 'PUSH 后 SP 增加，POP 后恢复；RAM 30H 回到 7FH。', code: `ORG 0000H
MOV A,#58H
MOV 30H,#7FH
MOV SP,#40H
PUSH ACC
PUSH 30H
MOV A,#00H
MOV 30H,#00H
POP 30H
POP ACC
SJMP $
END` },
  { id: 2, title: 'P1 流水灯', source: '按原实验报告实验二及备课 S21.ASM 整理的短延时教学摘录', purpose: '运行后观察 P1 位移；切换2025备课分组程序可看交替、四位和全亮全灭模式。', observation: '低电平为点亮示意，先从 P1.0 向 P1.7 移动。原始分组程序延时很长，需累计推进较多指令。', port: 'P1', activeLow: true, code: `ORG 0000H
MOV A,#0FEH
LOOP: MOV P1,A
LCALL DELAY
RL A
SJMP LOOP
DELAY: MOV R7,#20
WAIT: DJNZ R7,WAIT
RET
END`, variants: [{ id: 'group-2025', title: '2025备课：分组与全亮全灭', source: 'S22.asm 原指令与常量；旧编码损坏的注释已去除，未改程序逻辑', code: LAB2_GROUP_LED_ASM, port: 'P1' }] },
  { id: 3, title: 'T0 与 P0.0 翻转', source: '按原实验报告实验三及备课 SHIYAN1.ASM 改写的教学摘录；12 MHz、经典12T、10 ms计数初值', purpose: '观察 T0 每次溢出后累计 100 次，再翻转 P0.0；两次翻转为完整 2 s 周期。', observation: '初值 0xD8F0 对应理想 10 ms；中断入口、重装和循环均有软件开销，真实完整周期须实测校准。', port: 'P0', activeLow: false, code: `ORG 0000H
LJMP MAIN
ORG 000BH
LJMP T0_ISR
ORG 0040H
MAIN: MOV TMOD,#01H
MOV TH0,#0D8H
MOV TL0,#0F0H
MOV R6,#100
SETB ET0
SETB EA
SETB TR0
WAIT: SJMP WAIT
T0_ISR: MOV TH0,#0D8H
MOV TL0,#0F0H
DJNZ R6,DONE
MOV R6,#100
CPL P0.0
DONE:
RETI
END`, variants: [{ id: 'timer-2025', title: '2025备课：20ms×50累计', source: 'SHIYAN1.ASM 原指令及定时常量，按12 MHz经典12T运行', code: LAB3_ORIGINAL_TIMER_ASM, port: 'P0' }] },
  { id: 4, title: 'INT0 按键中断', source: '按原实验报告实验四的 P3.2/INT0 要求编写的教学示例；备课 SHIYAN41.ASM 实为 INT1，未照搬', purpose: '点击按键，观察 P1 计数变化和 30H。', observation: '本示例只验证中断进入与计数；数码管段码及实物消抖另需确认。', port: 'P1', activeLow: false, key: { port: 'P3', bit: 2, label: '按一次 P3.2 / INT0' }, code: `ORG 0000H
LJMP MAIN
ORG 0003H
LJMP INT0_ISR
ORG 0040H
MAIN: MOV 30H,#00H
MOV P1,#00H
SETB IT0
SETB EX0
SETB EA
WAIT: SJMP WAIT
INT0_ISR: INC 30H
MOV P1,30H
RETI
END` },
  { id: 5, title: '数码管段码与位选', source: '按原实验报告实验五及2025备课端口用法编写的教学示例', purpose: '观察 P0 段码、P1 位选；切换到历史扫描程序可调试 0–7 轮显。', observation: '历史程序采用 P0 段码、P1 低有效位选；仍需按本班实物核对极性与引脚。', port: 'P0', activeLow: false, code: `ORG 0000H
MOV P0,#3FH
MOV P1,#0FEH
LOOP: SJMP LOOP
END`, variants: [{ id: 'scan-fixed', title: '校正版：0–7轮显与递减间隔', source: '根据报告任务修正2025年 xm2.asm 的索引8、9越界访问；保留原程序供对照', code: LAB5_SCAN_CORRECTED_ASM, port: 'P0' }, { id: 'scan-2025', title: '历史原文：xm2.asm（含越界现象）', source: '原始 xm2.asm；R1设为10导致表索引8及9越界，供定位错误', code: LAB5_SCAN_ASM, port: 'P0' }] },
  { id: 6, title: '蜂鸣器翻转', source: '按原实验报告实验六及备课 S62.asm 整理的短延时教学摘录', purpose: '观察 P2.0 翻转；可切换到原始两音程序比较两个翻转节奏。', observation: '控制脚的翻转能核对两段频率；是否可听、音色和有源/无源器件行为仍取决于实物。', port: 'P2', activeLow: false, code: `ORG 0000H
MAIN: CPL P2.0
LCALL DELAY
SJMP MAIN
DELAY: MOV R6,#20
LOOP: DJNZ R6,LOOP
RET
END`, variants: [{ id: 'intermittent-2025', title: '2025备课：间断发声', source: '原始 S61.asm，控制脚高低状态的持续时间不同', code: LAB6_INTERMITTENT_ASM, port: 'P2' }, { id: 'two-tone-2025', title: '2025备课：双音交替', source: '原始 S62.asm，包含两段不同延时的 P2.0 翻转', code: LAB6_TWO_TONE_ASM, port: 'P2' }] },
  { id: 7, title: '电子时钟进位', source: '按原实验报告实验七的秒→分→时逻辑编写的最小单步示例', purpose: '观察进位逻辑；可切换至2025年 Keil 编译记录中的八位扫描程序。', observation: '历史八位程序可观察 P0 段码、P1 位选和 RAM 31H–38H；它未包含每分钟蜂鸣器报警。', code: `ORG 0000H
MOV 30H,#58
MOV 31H,#59
MOV 32H,#12
TICK: INC 30H
MOV A,30H
CJNE A,#60,NEXT
MOV 30H,#0
INC 31H
MOV A,31H
CJNE A,#60,NEXT
MOV 31H,#0
INC 32H
NEXT: SJMP TICK
END`, variants: [{ id: 'clock-2025', title: '2025备课：八位电子时钟', source: '从 S71.lst 的源代码列恢复；重编译机器码与 S7.hex 逐地址一致', code: LAB7_CLOCK_ASM, port: 'P0' }, { id: 'clock-alarm', title: '扩展示例：时钟＋分钟蜂鸣', source: '以已核对 S71 程序为基础新增 T1/P2.0 报警；并非原始备课源码，按经典12T虚拟配置演示', code: LAB7_CLOCK_ALARM_ASM, port: 'P0' }] },
  { id: 8, title: '电机 PWM 输出', source: '按原实验报告实验八占空比 0.3/0.7 要求编写的端口教学示例', purpose: '观察 P1.0 高低电平的指令步距；修改高低段循环值比较占比。', observation: '仅模拟端口开关，不推断实际电机转速；步进电机驱动须确认 ULN2003 或 TC1508S 后选对应相序。', port: 'P1', activeLow: false, code: `ORG 0000H
LOOP: SETB P1.0
MOV R7,#30
HIGH: DJNZ R7,HIGH
CLR P1.0
MOV R7,#70
LOW: DJNZ R7,LOW
SJMP LOOP
END`, variants: [{ id: 'pwm-70', title: 'PWM高电平约70%对照', source: '按报告0.7占空比目标生成；只验证控制脚，不推断电机转速', code: LAB8_PWM_70_ASM, port: 'P1' }, { id: 'stepper-abstract', title: 'A–AB–B–BC–C–CD–D–DA 抽象相序', source: '按报告相序生成，A/B/C/D暂映射到P1.0–P1.3；不是ULN2003或TC1508S实物接线码', code: LAB8_ABSTRACT_STEPPER_ASM, port: 'P1' }] },
];

export function assemblyLab(id: number): AssemblyLab | undefined {
  return ASSEMBLY_LABS.find(lab => lab.id === id);
}


export const MAX_ASSEMBLY_CHARS = 12_000;
export const SUPPORTED_8051_MNEMONICS = new Set(['MOV', 'MOVC', 'MOVX', 'ACALL', 'LCALL', 'RET', 'RETI', 'AJMP', 'LJMP', 'SJMP', 'JMP', 'DJNZ', 'CJNE', 'RL', 'RR', 'RLC', 'RRC', 'SETB', 'CLR', 'CPL', 'ADD', 'ADDC', 'SUBB', 'DA', 'SWAP', 'XCH', 'XCHD', 'ANL', 'ORL', 'XRL', 'PUSH', 'POP', 'INC', 'DEC', 'JZ', 'JNZ', 'JC', 'JNC', 'JB', 'JNB', 'JBC', 'MUL', 'DIV', 'NOP', 'END']);

/** Convert the course's Intel/Keil-style subset to the AS31 directive spelling. */
export function normalizeAssembly(code: string): string {
  if (!code.trim()) throw new Error('请先输入汇编程序。');
  if (code.length > MAX_ASSEMBLY_CHARS) throw new Error(`程序不超过 ${MAX_ASSEMBLY_CHARS} 字符。`);
  const seen = new Set<string>();
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const converted = lines.map((original, index) => {
    const lineNumber = index + 1;
    const withoutComment = original.split(/;|\/\//, 1)[0]?.replaceAll('\t', ' ').trim() ?? '';
    if (!withoutComment) return '';
    if (/[^\x20-\x7e]/.test(withoutComment)) throw new Error(`第 ${lineNumber} 行含无法编译的字符；中文说明请放在分号后。`);
    if (withoutComment.startsWith('.')) throw new Error(`第 ${lineNumber} 行不接受点指令；请使用 ORG/DB/DW/END。`);
    const equ = withoutComment.match(/^([A-Za-z_]\w*)\s+EQU\s+(.+)$/i);
    if (equ) return `.equ ${equ[1]}, ${equ[2]}`;
    const labelMatch = withoutComment.match(/^([A-Za-z_]\w*):\s*(.*)$/);
    const label = labelMatch?.[1];
    const body = labelMatch ? labelMatch[2] : withoutComment;
    if (label) {
      const normalizedLabel = label.toUpperCase();
      if (seen.has(normalizedLabel)) throw new Error(`第 ${lineNumber} 行标签 ${label} 重复。`);
      seen.add(normalizedLabel);
    }
    if (!body) return `${label}:`;
    const mnemonic = body.split(/\s+/)[0]?.toUpperCase();
    if (!mnemonic || !SUPPORTED_8051_MNEMONICS.has(mnemonic) && !['ORG', 'DB', 'DW'].includes(mnemonic)) throw new Error(`第 ${lineNumber} 行指令 ${mnemonic || '空'} 暂不支持。`);
    const normalizedBody = ['ORG', 'DB', 'DW', 'END'].includes(mnemonic)
      ? body.replace(/^\w+/, `.${mnemonic.toLowerCase()}`)
      : body;
    if (/\bSJMP\s+\$/i.test(normalizedBody)) {
      const selfLabel = label ?? `__SELF_${lineNumber}`;
      return `${selfLabel}: ${normalizedBody.replace(/\bSJMP\s+\$/i, `SJMP ${selfLabel}`)}`;
    }
    return `${label ? `${label}: ` : ''}${normalizedBody}`;
  });
  return `${converted.join('\n')}\n`;
}
