/** Deterministic calculations for the course's 8051 timer and T1 baud generator. */
import type { ExperimentConfig } from './api-types';

export interface CalculationResult {
  kind: 'timer' | 'uart';
  status: 'ready' | 'incomplete' | 'unsupported' | 'invalid';
  missing: string[];
  summary: string;
  formula?: string;
  values?: Record<string, number | string>;
  notes: string[];
}

const TIMER_BITS = { 1: 16, 2: 8 } as const;
const UART_DIVIDER = 32;
const UART_RELOAD_RANGE = 256;
const MS_PER_SECOND = 1000;
const REVIEW_NOTE = '计算按所列教师配置执行；由任课教师复核后采纳。';
const LIMIT_NOTE = '忽略软件重装、指令和中断响应开销；实验实测值应单独记录。';
const EXPERIMENT_THREE_HALF_PERIOD_MS = 1000;
const MAX_PREVIEW_OVERFLOWS = 400;

export function isSupportedChip(chip: string): boolean {
  return /(?:^|[^a-z0-9])(?:805[12]|80[cC]5[12]|(?:at|stc)?89[cs]5[12](?:rc|rd\+?)?)(?:$|[^a-z0-9])/i.test(chip.trim());
}

function unavailable(kind: CalculationResult['kind'], status: CalculationResult['status'], summary: string, missing: string[] = []): CalculationResult {
  return { kind, status, missing, summary, notes: [REVIEW_NOTE] };
}

function validate(kind: CalculationResult['kind'], config: ExperimentConfig, fields: (keyof ExperimentConfig)[]): CalculationResult | null {
  const missing = fields.filter((field) => config[field] === undefined || config[field] === null || config[field] === '');
  if (missing.length) return unavailable(kind, 'incomplete', '实验参数未完整确认，仅进行定性排查，不生成初值或波特率结论。', missing);
  if (typeof config.chip !== 'string' || !isSupportedChip(config.chip)) {
    return unavailable(kind, 'unsupported', '当前计算仅支持课程中已确认计数时钟的 8051/8052、80C51/52、89C51/52 或 89S51/52。');
  }
  const numericFields: (keyof ExperimentConfig)[] = ['clock_hz', 'clocks_per_tick', kind === 'timer' ? 'target_ms' : 'target_baud'];
  for (const field of numericFields) {
    const value = config[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
      return unavailable(kind, 'invalid', `参数 ${field} 必须为有效正数。`);
    }
  }
  if (!Number.isSafeInteger(config.clocks_per_tick)) return unavailable(kind, 'invalid', '每次计数的时钟周期数必须为正整数。');
  if (config.timer_mode !== 1 && config.timer_mode !== 2) return unavailable(kind, 'unsupported', '当前仅支持定时器方式 1 或方式 2。');
  if (config.tolerance_percent !== undefined && (typeof config.tolerance_percent !== 'number' || !Number.isFinite(config.tolerance_percent) || config.tolerance_percent < 0)) {
    return unavailable(kind, 'invalid', '允许误差必须为有限的非负百分数。');
  }
  return null;
}

function hex(value: number, width: number): string { return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`; }
function toleranceNote(error: number, tolerance?: number): string[] {
  return tolerance === undefined ? ['允许误差尚未确认，不能据此判定实验通过。']
    : [`量化误差${Math.abs(error) <= tolerance ? '在' : '超出'}教师配置的 ±${tolerance}% 范围；仍需按验证方法实测。`];
}

export function calculateTimer(config: ExperimentConfig): CalculationResult {
  if (config.time_definition && config.time_definition !== '单次溢出间隔') return unavailable('timer','unsupported','本轮只计算单次溢出间隔，不能把输出完整周期直接作为单次定时目标。');
  const invalid = validate('timer', config, ['chip', 'clock_hz', 'clocks_per_tick', 'timer_mode', 'target_ms']);
  if (invalid) return invalid;
  const frequency = config.clock_hz!;
  const divisor = config.clocks_per_tick!;
  const target = config.target_ms!;
  const bits = TIMER_BITS[config.timer_mode!];
  const capacity = 2 ** bits;
  const exactCounts = target / MS_PER_SECOND * frequency / divisor;
  const counts = Math.round(exactCounts);
  const maxSingleMs = capacity * divisor / frequency * MS_PER_SECOND;
  if (!Number.isFinite(exactCounts) || exactCounts < 1 || exactCounts > capacity) {
    return { ...unavailable('timer', 'unsupported', '目标时间超出当前方式的单次计数范围；请由教师确定分段计数方案。'), values: { max_single_ms: maxSingleMs } };
  }
  const initial = capacity - counts;
  const actualMs = counts * divisor / frequency * MS_PER_SECOND;
  const errorPercent = (actualMs - target) / target * 100;
  const th = bits === 16 ? initial >>> 8 : initial;
  const tl = bits === 16 ? initial & 0xff : initial;
  const formula = `计数次数 = round(目标毫秒 / 1000 × 晶振频率 / 每次计数时钟数) = round(${target} / 1000 × ${frequency} / ${divisor}) = ${counts}；初值 = 2^${bits} − ${counts} = ${initial} = ${hex(initial, bits / 4)}`;
  return {
    kind: 'timer', status: 'ready', missing: [], formula,
    summary: `方式 ${config.timer_mode}，${frequency} Hz，${divisor} 个时钟/计数，目标 ${target} ms：初值 ${hex(initial, bits / 4)}，TH=${hex(th, 2)}，TL=${hex(tl, 2)}。`,
    values: { clock_hz: frequency, clocks_per_tick: divisor, target_ms: target, counts, initial_value: initial, initial_hex: hex(initial, bits / 4), th, tl, th_hex: hex(th, 2), tl_hex: hex(tl, 2), actual_ms: actualMs, error_percent: errorPercent, max_single_ms: maxSingleMs },
    notes: [REVIEW_NOTE, LIMIT_NOTE, '目标时间按一次溢出间隔计算；若观察的是翻转输出完整周期，请先换算为单次间隔。', ...toleranceNote(errorPercent, config.tolerance_percent)],
  };
}

export type TimerWaveMode = 'accumulated' | 'direct';
export interface TimerWaveform {
  status: 'ready' | 'unsupported';
  reason: string;
  mode: TimerWaveMode;
  overflowMs: number;
  overflowsPerToggle: number;
  toggleMs: number;
  fullPeriodMs: number;
  windowMs: number;
  overflowEventsMs: number[];
}

/** Ideal timing logic for experiment 3, not instruction-level 80C51 emulation. */
export function buildTimerWaveform(config: ExperimentConfig, mode: TimerWaveMode): TimerWaveform {
  const calculation = calculateTimer(config);
  const unavailable = (reason: string): TimerWaveform => ({ status: 'unsupported', reason, mode, overflowMs: 0, overflowsPerToggle: 0, toggleMs: 0, fullPeriodMs: 0, windowMs: 0, overflowEventsMs: [] });
  if (calculation.status !== 'ready') return unavailable(calculation.summary);
  const overflowMs = Number(calculation.values?.actual_ms);
  const expected = EXPERIMENT_THREE_HALF_PERIOD_MS / overflowMs;
  if (mode === 'accumulated' && Math.abs(expected - Math.round(expected)) > 1e-8) {
    return unavailable('单次溢出不能整除实验三所需的 1000 ms 翻转间隔；请由教师确认分段或补偿方案。');
  }
  const overflowsPerToggle = mode === 'accumulated' ? Math.round(expected) : 1;
  const toggleMs = overflowMs * overflowsPerToggle;
  const windowMs = mode === 'accumulated' ? 2 * EXPERIMENT_THREE_HALF_PERIOD_MS : Math.max(4 * toggleMs, 200);
  const count = Math.floor(windowMs / overflowMs + 1e-8);
  if (!Number.isFinite(count) || count > MAX_PREVIEW_OVERFLOWS) return unavailable('观察窗口内的溢出事件过密，本页不绘制波形；请缩小观察范围。');
  return {
    status: 'ready', reason: '', mode, overflowMs, overflowsPerToggle, toggleMs,
    fullPeriodMs: 2 * toggleMs, windowMs,
    overflowEventsMs: Array.from({ length: count }, (_, index) => (index + 1) * overflowMs),
  };
}

export function timerWaveState(waveform: TimerWaveform, elapsedMs: number) {
  if (waveform.status !== 'ready' || !Number.isFinite(elapsedMs)) return null;
  const positionMs = Math.max(0, Math.min(waveform.windowMs, elapsedMs));
  const overflows = Math.floor(positionMs / waveform.overflowMs + 1e-8);
  const toggles = Math.floor(overflows / waveform.overflowsPerToggle);
  return {
    positionMs,
    overflows,
    countSinceToggle: overflows % waveform.overflowsPerToggle,
    outputHigh: toggles % 2 === 0,
    nextToggleMs: (toggles + 1) * waveform.toggleMs,
  };
}

export function calculateUart(config: ExperimentConfig): CalculationResult {
  const invalid = validate('uart', config, ['chip', 'clock_hz', 'clocks_per_tick', 'timer_mode', 'target_baud', 'smod']);
  if (invalid) return invalid;
  if (config.timer_mode !== 2) return unavailable('uart', 'unsupported', '当前波特率计算仅支持 T1 方式 2 为串口方式 1/3 提供时钟。');
  if (config.smod !== 0 && config.smod !== 1) return unavailable('uart', 'invalid', 'SMOD 必须为 0 或 1。');
  const frequency = config.clock_hz!;
  const divisor = config.clocks_per_tick!;
  const target = config.target_baud!;
  const factor = 2 ** config.smod;
  const idealCounts = factor * frequency / (UART_DIVIDER * divisor * target);
  if (!Number.isFinite(idealCounts) || idealCounts < 1 || idealCounts > UART_RELOAD_RANGE) return unavailable('uart', 'unsupported', '目标波特率超出当前 T1 方式 2 配置的计数范围。');
  // Select the representable count with the smallest baud-rate error.
  const candidates = [...new Set([Math.floor(idealCounts), Math.ceil(idealCounts)])].filter((count) => count >= 1 && count <= UART_RELOAD_RANGE);
  const baudFor = (count: number) => factor * frequency / (UART_DIVIDER * divisor * count);
  candidates.sort((a, b) => Math.abs(baudFor(a) - target) - Math.abs(baudFor(b) - target) || a - b);
  const counts = candidates[0]!;
  const th = UART_RELOAD_RANGE - counts;
  const actualBaud = baudFor(counts);
  const errorPercent = (actualBaud - target) / target * 100;
  const formula = `波特率 = 2^SMOD × 晶振频率 / [32 × 每次计数时钟数 × (256 − TH1)] = ${factor} × ${frequency} / [32 × ${divisor} × (256 − ${th})] = ${actualBaud}；误差 = (实际 − 目标) / 目标 × 100% = ${errorPercent}%`;
  return {
    kind: 'uart', status: 'ready', missing: [], formula,
    summary: `T1 方式 2、串口方式 1/3、SMOD=${config.smod}，目标 ${target} baud：TH1=${hex(th, 2)}，实际 ${actualBaud} baud，误差 ${errorPercent}%。`,
    values: { clock_hz: frequency, clocks_per_tick: divisor, target_baud: target, smod: config.smod, counts, th, th_hex: hex(th, 2), actual_baud: actualBaud, error_percent: errorPercent },
    notes: [REVIEW_NOTE, '限经典 8051 串口方式 1/3 的 T1 溢出分频结构；增强型芯片的独立波特率发生器不适用。', '模式 2 初始化时应核对 TH1 与 TL1；通信格式、对端设置与实测结果仍需验证。', ...toleranceNote(errorPercent, config.tolerance_percent)],
  };
}

export function calculateExperiment(config: ExperimentConfig, faultChainId?: string | null): CalculationResult[] {
  if (faultChainId === 'uart-garbled') return [calculateUart(config)];
  if (faultChainId === 'timer-isr-not-entered' || faultChainId === 'timing-inaccurate') return [calculateTimer(config)];
  return [calculateTimer(config), calculateUart(config)];
}
