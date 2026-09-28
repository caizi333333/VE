import type { Native8051Result, TracePort } from './native-8051';

/** A result and the exact inputs that produced it; never read live editor settings here. */
export interface AssemblyRun {
  labId: number;
  presetId: string;
  presetTitle: string;
  code: string;
  clockHz: number;
  keySteps: number[];
  traceWindow: number;
  tracePort?: TracePort;
  secondaryPort?: TracePort;
  tertiaryPort?: TracePort;
  capturedAt: string;
  result: Native8051Result;
}

export function isCurrentAssemblyRun(run: AssemblyRun | null, code: string, clockHz: number, presetId: string): run is AssemblyRun {
  return !!run && run.code === code && run.clockHz === clockHz && run.presetId === presetId;
}

export function assemblyStudentHint(labId: number, presetId: string): string {
  switch (labId) {
    case 1: return '先运行示例，观察出栈后 A、SP 和 RAM 30H 是否恢复；想看中间过程时再打开单步调试。';
    case 2: return presetId === 'group-2025' ? '观察 P1 的分组电平。这个历史示例延时较长，点“继续观察”后比较变化。' : '先运行示例，观察 P1 各位的高低变化，再修改延时并重新运行。';
    case 3: return '先运行，再点“继续观察”，对照 P0.0 的翻转与模拟时间。两次翻转才组成一个完整周期。';
    case 4: return '先运行程序，再按一次虚拟按键，比较计数前后的变化。每次按键都会执行后续程序并更新读数。';
    case 5: return presetId === 'basic' ? '先观察一个显示位的段码与位选；要看轮显，可在进阶调试中选择校正版程序。' : '先运行程序，对照八个显示位。“·”表示这次没有采到该位，可继续观察。';
    case 6: return '观察 P2.0 控制信号的高低变化；这里没有声音，实际蜂鸣器效果需在实验板上验证。';
    case 7: return presetId === 'basic' ? '运行示例，查看秒、分、时的进位；这个小例子用于检查进位逻辑。' : '运行后对照 RAM 时刻与显示采样，再继续观察进位和报警控制信号。';
    default: return presetId === 'stepper-abstract' ? '观察采样中的相序变化；接实物电机前先核对教师提供的驱动器和接线资料。' : '观察控制脚高低电平，比较两个 PWM 示例；此处显示控制信号，不模拟电机转速。';
  }
}

export function assemblyQuickStart(labId: number, presetId: string): { steps: number; instruction: string } {
  switch (labId) {
    case 1: return { steps: 9, instruction: '先运行 9 条，核对 A=58H、SP=40H、RAM 30H=7FH；重新加载后可逐条观察压栈和出栈。' };
    case 2: return presetId === 'group-2025'
      ? { steps: 20, instruction: '先运行 20 条查看 P1=AAH，再用 +500,000 条累计推进；历史程序首次交替需超过 100 万条。观察短延时位移也可选“局部基础练习”。' }
      : { steps: 500, instruction: '先运行 500 条，查看 P1 端口采样是否出现位移；单个最终值不能说明整段顺序。' };
    case 3: return { steps: 500_000, instruction: '先运行 50 万条，再推进 50 万条比较 P0.0 与累计模拟时间；12 MHz 下应在约 1 s 附近翻转，完整周期需观察两次翻转。' };
    case 4: return { steps: 20, instruction: '先运行 20 条完成初始化，再按一次 P3.2，继续运行 25 条，比较 RAM 30H 与 P1 计数。' };
    case 5: return presetId === 'basic'
      ? { steps: 2, instruction: '运行 2 条，核对 P0 段码 3FH 与 P1 位选 FEH；观察轮显请切换到校正版。' }
      : { steps: 500_000, instruction: '先运行 50 万条，查看 P0×P1 解码。“·”表示未采到该位；历史原文还可用于观察查表越界。' };
    case 6: return { steps: 5_000, instruction: '先运行 5,000 条观察 P2.0，再推进并比较采样窗口；高低变化是控制信号，不能据此判断实际声音。' };
    case 7: return presetId === 'basic'
      ? { steps: 20, instruction: '运行 20 条，查看 RAM 30H/31H/32H 的进位结果；该最小示例没有真实的秒定时。' }
      : { steps: 1_000_000, instruction: '先运行 100 万条，比较 RAM 时刻和八位显示采样；扩展示例还可查看 P2.0 分钟报警控制信号。' };
    default: return { steps: 5_000, instruction: '先运行 5,000 条，查看 PWM 控制脚采样或抽象相序；修改参数后重新编译，以相同条件对照。' };
  }
}

const hex = (value: number) => `${value.toString(16).toUpperCase().padStart(2, '0')}H`;

export function assemblyEvidenceText(run: AssemblyRun): string {
  const r = run.result;
  const ports = [run.tracePort, run.secondaryPort, run.tertiaryPort].filter(Boolean).join(' / ') || '未设置';
  return [
    '【虚拟调试记录｜学生提交，待教师复核】',
    `实验${run.labId} · ${run.presetTitle}（代码可能经过学生修改）`,
    `记录时间：${run.capturedAt}`,
    `工具：${r.toolchain}；经典 12T 8051；晶振 ${r.clock_hz} Hz。`,
    `已执行 ${r.steps} 条；累计模拟时间 ${(r.elapsed_seconds * 1000).toFixed(3)} ms；机器码 ${r.code_bytes} 字节。`,
    `PC=${r.pc.toString(16).toUpperCase().padStart(4, '0')}H；A=${hex(r.registers.A)}；SP=${hex(r.registers.SP)}。`,
    `P0=${hex(r.registers.P0)}；P1=${hex(r.registers.P1)}；P2=${hex(r.registers.P2)}；P3=${hex(r.registers.P3)}。`,
    `RAM 30H/31H/32H=${hex(r.ram['30H'])}/${hex(r.ram['31H'])}/${hex(r.ram['32H'])}。`,
    `INT0 输入指令位置：${run.keySteps.join('、') || '无'}。`,
    `采样端口：${ports}；范围：${run.traceWindow ? `最近 ${run.traceWindow} 条（不足时从加载开始）` : '从加载到当前'}；主端口 ${r.port_trace.length} 点。`,
    `汇编规范化源码 SHA-256：${r.code_sha256}`,
    '这是机器码仿真记录；均匀指令采样可能漏掉窄脉冲，不代表实物验证或教师确认完成。',
  ].join('\n');
}

export function assemblyEvidenceFile(run: AssemblyRun): string {
  return JSON.stringify({ schema_version: 1, evidence_type: 'student_submitted_simulation', summary: assemblyEvidenceText(run), ...run }, null, 2);
}

/** Keep the student's own observation required and never truncate code or evidence silently. */
export function prepareAssemblyHelp(run: AssemblyRun, symptom: string): { code: string; evidence: string } {
  if (run.code.length > 8000) throw new Error('当前代码超过求助表单的 8,000 字符上限。请先下载源码与调试记录，再选择相关片段提交。');
  const evidence = assemblyEvidenceText(run);
  // Reserve space for the experiment/issue prefix added on submission.
  if ([symptom.trim(), evidence].filter(Boolean).join('\n\n').length > 1950) throw new Error('现象描述与调试记录合计过长。请精简现象后重新带入，或下载调试记录交给教师。');
  return { code: run.code, evidence };
}
