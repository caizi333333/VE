/** Three teaching levels: progression is authorized by verified attempts in the workflow. */
import type { ExperimentConfig } from './api-types';

export interface PracticeTask {
  level: 1 | 2 | 3;
  title: string;
  instruction: string;
  point_id: string;
  objective: string;
  conditions: string;
  deliverable: string;
  verification: string;
}

type TaskTemplate = Omit<PracticeTask, 'conditions' | 'verification'>;
const TASKS: Record<string, readonly TaskTemplate[]> = {
  'timer-isr-not-entered': [
    { level: 2, title: '综合：中断通路检查', point_id: '5.4.2', objective: '解释启动、溢出和中断响应之间的条件，并验证修订。', instruction: '先确认使用 T0 还是 T1，再对应核对 EA、ET0/ET1、TR0/TR1、TH0/TL0 或 TH1/TL1、TMOD 对应半字节与中断入口；初始化和重装必须属于同一定时器。核对溢出条件；逐项记录状态与观察依据，保持定时中断方案。', deliverable: '寄存器状态表、修改前后代码片段、进入中断的观察记录。' },
    { level: 3, title: '拓展：定时重装与实测', point_id: '6.2.2', objective: '将中断通路与教师指定定时目标结合，解释理论与实测差异。', instruction: '根据已确认的工作方式判断是否需要重装，使用实验晶振、计数分频和目标间隔核算初值；记录软件重装和中断响应对观察结果的影响。', deliverable: '参数表、计算过程、相关代码、实测间隔与误差解释。' },
  ],
  'uart-garbled': [
    { level: 2, title: '综合：串口格式与收发', point_id: '7.2.1', objective: '核对两端通信配置并定位乱码或丢失环节。', instruction: '核对 SM0/SM1、REN、发送接收标志、数据格式及对端设置；先按实验约定发送可辨认的 ASCII 或十六进制测试字节，记录原始字节与显示内容；区分 HEX/文本显示和字符编码，再逐项验证差异。', deliverable: '两端配置对照、修改前后代码、发送内容与实际接收记录。' },
    { level: 3, title: '拓展：波特率量化误差', point_id: '7.2.3', objective: '按实际参数计算可实现波特率，判断是否满足实验允许误差。', instruction: '使用教师确认的晶振、计数分频、T1 模式和 SMOD，计算目标波特率对应的重装值与实际误差；与对端允许误差和实测收发结果比较。', deliverable: '参数与公式、重装值、理论误差、收发验证记录和适用限制。' },
  ],
  'timing-inaccurate': [
    { level: 2, title: '综合：计数周期与初值', point_id: '6.1.4', objective: '区分晶振周期、计数周期和目标观察时间，完成一次定时验证。', instruction: '依次写出实际时钟、每次计数的时钟数、所需计数次数与初值；说明观察的是单次溢出、输出翻转间隔还是完整周期。参数未确认时先补齐，不能套用示例板数值。', deliverable: '计算过程、时间定义、代码修改和实际测量结果。' },
    { level: 3, title: '拓展：长定时与误差', point_id: '6.3.5', objective: '按当前硬件的单次计数范围设计软件累计方案并验证。', instruction: '先算当前模式可实现的最长单次间隔，再按教师目标决定是否分段累计；记录累计次数、余数处理、重装开销和实际误差，不预设固定的毫秒上限。', deliverable: '分段方案、相关代码、预期与实测时间、误差来源说明。' },
  ],
};

function conditions(config: ExperimentConfig): string {
  const parts = [config.chip ? `芯片 ${config.chip}` : '芯片待教师确认', config.clock_hz ? `晶振 ${config.clock_hz} Hz` : '晶振待教师确认', config.clocks_per_tick ? `每次计数 ${config.clocks_per_tick} 个时钟` : '计数分频待教师确认'];
  if (config.timer_mode) parts.push(`定时器方式 ${config.timer_mode}`);
  if (config.target_ms) parts.push(`目标单次间隔 ${config.target_ms} ms`);
  if (config.target_baud) parts.push(`目标波特率 ${config.target_baud} baud`);
  return parts.join('；');
}

export function buildPracticePack(fault_chain_id: string | null, bridging_task: string, level_one_point: string, config: ExperimentConfig = {}): PracticeTask[] {
  const shared = {
    conditions: conditions(config),
    verification: config.verification_method?.trim() || '提交可复查的观察记录、修订代码和验证依据，由教师确认本级完成后开放下一级；自报解决或卡住不直接通过。',
  };
  const base: PracticeTask = { level: 1, title: '基础：验证当前排查环节', instruction: bridging_task, point_id: level_one_point, objective: '针对当前故障验证一个具体条件，记录代码与现象变化。', deliverable: '本次观察、修改后的代码片段及对应验证记录；未解决时说明停在哪一步。', ...shared };
  return [base, ...(fault_chain_id ? TASKS[fault_chain_id] ?? [] : []).map((task) => ({ ...task, ...shared }))];
}
