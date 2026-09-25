/** Eight small, editable 8051 debugging exercises. These are teaching extracts, not verbatim report programs. */
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
  { id: 2, title: 'P1 流水灯', source: '按原实验报告实验二及备课 S21.ASM 整理的短延时教学摘录', purpose: '运行后观察 P1 位移；修改延时循环次数可比较达到下一盏灯所需指令数。', observation: '低电平为点亮示意，先从 P1.0 向 P1.7 移动。', port: 'P1', activeLow: true, code: `ORG 0000H
MOV A,#0FEH
LOOP: MOV P1,A
LCALL DELAY
RL A
SJMP LOOP
DELAY: MOV R7,#20
WAIT: DJNZ R7,WAIT
RET
END` },
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
END` },
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
  { id: 5, title: '数码管段码与位选', source: '按原实验报告实验五的段选/位选任务编写的教学示例', purpose: '观察 P0 段码、P2 位选；修改段码后重新运行。', observation: '3FH 为常见共阴 0 段码示例；实际共阳/共阴、驱动和引脚须按本班设备确认。', port: 'P0', activeLow: false, code: `ORG 0000H
MOV P0,#3FH
MOV P2,#0FEH
LOOP: SJMP LOOP
END` },
  { id: 6, title: '蜂鸣器翻转', source: '按原实验报告实验六及备课 S62.asm 整理的短延时教学摘录', purpose: '观察 P2.0 翻转次数；改 R6 的循环次数会改变翻转步距。', observation: '这里只表示无源蜂鸣器控制脚的翻转，不生成可听音频；有源器件另需核对。', port: 'P2', activeLow: false, code: `ORG 0000H
MAIN: CPL P2.0
LCALL DELAY
SJMP MAIN
DELAY: MOV R6,#20
LOOP: DJNZ R6,LOOP
RET
END` },
  { id: 7, title: '电子时钟进位', source: '按原实验报告实验七的秒→分→时逻辑编写的最小单步示例', purpose: '观察内部 RAM 30H 秒、31H 分、32H 时；修改初始值可检验 59→00 进位。', observation: '本例只验证进位逻辑，未模拟八位数码管扫描或一分钟报警。', code: `ORG 0000H
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
END` },
  { id: 8, title: '电机 PWM 输出', source: '按原实验报告实验八占空比 0.3/0.7 要求编写的端口教学示例', purpose: '观察 P1.0 高低电平的指令步距；修改高低段循环值比较占比。', observation: '仅模拟端口开关，不推断实际电机转速；步进电机驱动须确认 ULN2003 或 TC1508S 后选对应相序。', port: 'P1', activeLow: false, code: `ORG 0000H
LOOP: SETB P1.0
MOV R7,#30
HIGH: DJNZ R7,HIGH
CLR P1.0
MOV R7,#70
LOW: DJNZ R7,LOW
SJMP LOOP
END` },
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
