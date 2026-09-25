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
  { id: 3, title: 'T0 与 P0.0 翻转', source: '按原实验报告实验三及备课 SHIYAN1.ASM 改写的教学摘录；初值为 12 MHz 理想条件下 10 ms', purpose: '观察 T0 溢出后是否进入中断并翻转 P0.0；TH0/TL0 改动会影响指令模型中的翻转步距。', observation: '模型按指令计数，实际毫秒与波形周期需按晶振和指令周期重新核算及实测。', port: 'P0', activeLow: false, code: `ORG 0000H
LJMP MAIN
ORG 000BH
LJMP T0_ISR
ORG 0040H
MAIN: MOV TMOD,#01H
MOV TH0,#0D8H
MOV TL0,#0F0H
SETB ET0
SETB EA
SETB TR0
WAIT: SJMP WAIT
T0_ISR: MOV TH0,#0D8H
MOV TL0,#0F0H
CPL P0.0
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
