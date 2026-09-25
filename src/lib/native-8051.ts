import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeAssembly } from './assembly-labs';

const execFileAsync = promisify(execFile);
const ASSEMBLER = process.env.VE_AS31_PATH || join(homedir(), '.local/bin/ve-as31');
const SIMULATOR = process.env.VE_S51_PATH || 's51';
export const MAX_NATIVE_STEPS = 2_000_000;
export const MAX_CONCURRENT_NATIVE_RUNS = 4;
let activeNativeRuns = 0;

export class NativeCapacityError extends Error {}

/** Single-process admission for native compiler/simulator children. */
export async function withNativeSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeNativeRuns >= MAX_CONCURRENT_NATIVE_RUNS) throw new NativeCapacityError('仿真服务正忙，请稍后重试');
  activeNativeRuns++;
  try { return await operation(); }
  finally { activeNativeRuns--; }
}

export interface Native8051Result {
  toolchain: 'AS31 + SDCC ucSim/s51';
  code_sha256: string;
  hex: string;
  code_bytes: number;
  steps: number;
  clock_hz: number;
  pc: number;
  machine_clocks: number;
  elapsed_seconds: number;
  registers: { A: number; SP: number; P0: number; P1: number; P2: number; P3: number; TMOD: number; TCON: number; TH0: number; TL0: number };
  ram: { '20H': number; '30H': number; '31H': number; '32H': number; '33H': number; '34H': number; '35H': number; '36H': number; '37H': number; '38H': number };
  port_trace: { step: number; value: number }[];
  secondary_trace: { step: number; value: number }[];
  tertiary_trace: { step: number; value: number }[];
}

const PORT_ADDRESS = { P0: '0x80', P1: '0x90', P2: '0xa0', P3: '0xb0' } as const;
export type TracePort = keyof typeof PORT_ADDRESS;

export function parseIntelHex(hex: string): number {
  let count = 0;
  let eof = false;
  for (const line of hex.trim().split(/\r?\n/)) {
    if (!/^:[0-9A-Fa-f]+$/.test(line) || (line.length - 1) % 2) throw new Error('汇编器输出的 HEX 格式错误');
    const bytes = Buffer.from(line.slice(1), 'hex');
    if (bytes.length < 5 || bytes[0] + 5 !== bytes.length || bytes.reduce((sum, byte) => sum + byte, 0) % 256 !== 0) throw new Error('HEX 校验和错误');
    if (bytes[3] === 0) count += bytes[0];
    if (bytes[3] === 1) eof = true;
  }
  if (!eof || count < 1 || count > 65536) throw new Error('HEX 缺少有效程序或结束记录');
  return count;
}

export async function runS51(hexPath: string, steps: number, keySteps: number[], clockHz: number, tracePort?: TracePort, secondaryPort?: TracePort, tertiaryPort?: TracePort, traceWindow?: number): Promise<string> {
  const commands: string[] = [];
  const firstTraceStep = Math.max(0, steps - (traceWindow ?? steps));
  const traceLength = steps - firstTraceStep;
  const checkpoints = tracePort && steps > 0
    ? Array.from({ length: Math.min(64, traceLength) }, (_, index) => firstTraceStep + Math.ceil((index + 1) * traceLength / Math.min(64, traceLength)))
    : [];
  const events = [
    ...keySteps.map(step => ({ step, kind: 'key' as const })),
    ...checkpoints.map(step => ({ step, kind: 'trace' as const })),
  ].sort((a, b) => a.step - b.step || (a.kind === 'key' ? -1 : 1));
  let previous = 0;
  for (const event of events) {
    if (event.step > previous) commands.push(`step ${event.step - previous}`);
    if (event.kind === 'key') commands.push('set memory sfr 0xb0 0xff', 'set memory sfr 0xb0 0xfb');
    else if (tracePort) {
      commands.push(`echo __VE_TRACE_${event.step}__`, `dump sfr ${PORT_ADDRESS[tracePort]} ${PORT_ADDRESS[tracePort]}`);
      if (secondaryPort) commands.push(`echo __VE_SECOND_${event.step}__`, `dump sfr ${PORT_ADDRESS[secondaryPort]} ${PORT_ADDRESS[secondaryPort]}`);
      if (tertiaryPort) commands.push(`echo __VE_THIRD_${event.step}__`, `dump sfr ${PORT_ADDRESS[tertiaryPort]} ${PORT_ADDRESS[tertiaryPort]}`);
    }
    previous = event.step;
  }
  if (steps > previous) commands.push(`step ${steps - previous}`);
  commands.push('echo __VE_STATE__', 'state', 'echo __VE_SFR__', 'dump sfr 0x80 0xf0', 'echo __VE_RAM__', 'dump iram 0x20 0x20', 'dump iram 0x30 0x38', 'quit');
  // A command file avoids stdin readiness interrupting long ucSim step runs.
  const commandPath = `${hexPath}.cmd`;
  await writeFile(commandPath, `${commands.join('\n')}\n`, 'ascii');
  return new Promise((resolve, reject) => {
    const child = spawn(SIMULATOR, ['-q', '-b', '-c', commandPath, '-t', '80C51', '-X', String(clockHz), hexPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('8051 仿真超时，请缩短运行步数')); }, 8000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 128_000) { child.kill('SIGKILL'); reject(new Error('8051 仿真输出过长')); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error(`8051 仿真器退出：${code}`)); });
  });
}

export function parsePortTrace(output: string, port: TracePort, marker: 'TRACE' | 'SECOND' | 'THIRD' = 'TRACE'): Native8051Result['port_trace'] {
  const address = PORT_ADDRESS[port].slice(2);
  const pattern = new RegExp(`__VE_${marker}_(\\d+)__\\s*\\r?\\n0x${address}\\s+[^\\r\\n]*?0x([0-9a-f]{2})\\b`, 'gi');
  return Array.from(output.matchAll(pattern), match => ({ step: Number(match[1]), value: parseInt(match[2], 16) }));
}

export function parseS51(output: string): Pick<Native8051Result, 'pc' | 'machine_clocks' | 'elapsed_seconds' | 'registers' | 'ram'> {
  const state = output.split('__VE_STATE__').at(-1)?.split('__VE_SFR__')[0] ?? '';
  const sfr = output.split('__VE_SFR__').at(-1)?.split('__VE_RAM__')[0] ?? '';
  const iram = output.split('__VE_RAM__').at(-1) ?? '';
  const pc = /CPU state=.*?PC=\s*0x([0-9a-f]+)/i.exec(state);
  const clocks = /Total time since last reset=.*?\((\d+) clks\)/i.exec(state);
  const seconds = /Total time since last reset=\s*([\d.]+) sec/i.exec(state);
  const sfrByte = (address: string): number => {
    const match = new RegExp(`^\\s*(?:\\d+>\\s*)?0x${address}\\s+[^\\n]*?0x([0-9a-f]{2})\\b`, 'im').exec(sfr);
    if (!match) throw new Error(`仿真器未返回寄存器 ${address}`);
    return parseInt(match[1], 16);
  };
  const ramLine = (address: string, count: number): number[] => {
    const match = new RegExp(`^\\s*(?:\\d+>\\s*)?0x${address}\\s+((?:[0-9a-f]{2}\\s+){${count}})`, 'im').exec(iram);
    if (!match) throw new Error(`仿真器未返回 RAM ${address}H`);
    return match[1].trim().split(/\s+/).map(value => parseInt(value, 16));
  };
  if (!pc || !clocks || !seconds) throw new Error('仿真器状态解析失败');
  const [ram20] = ramLine('20', 1);
  const ram30 = ramLine('30', 8);
  const [ram38] = ramLine('38', 1);
  return {
    pc: parseInt(pc[1], 16), machine_clocks: Number(clocks[1]), elapsed_seconds: Number(seconds[1]),
    registers: { A: sfrByte('e0'), SP: sfrByte('81'), P0: sfrByte('80'), P1: sfrByte('90'), P2: sfrByte('a0'), P3: sfrByte('b0'), TMOD: sfrByte('89'), TCON: sfrByte('88'), TH0: sfrByte('8c'), TL0: sfrByte('8a') },
    ram: { '20H': ram20, '30H': ram30[0], '31H': ram30[1], '32H': ram30[2], '33H': ram30[3], '34H': ram30[4], '35H': ram30[5], '36H': ram30[6], '37H': ram30[7], '38H': ram38 },
  };
}

export async function compileAndSimulate(code: string, steps: number, keySteps: number[], clockHz: number, tracePort?: TracePort, secondaryPort?: TracePort, tertiaryPort?: TracePort, traceWindow?: number): Promise<Native8051Result> {
  if (!Number.isInteger(steps) || steps < 0 || steps > MAX_NATIVE_STEPS) throw new Error(`运行条数须在 0—${MAX_NATIVE_STEPS} 之间`);
  if (!Number.isInteger(clockHz) || clockHz < 1_000_000 || clockHz > 24_000_000) throw new Error('晶振频率超出 1—24 MHz 范围');
  if (keySteps.length > 8 || keySteps.some(step => !Number.isInteger(step) || step < 0 || step > steps) || keySteps.some((step, index) => index > 0 && step <= keySteps[index - 1])) throw new Error('按键时序无效');
  if (traceWindow !== undefined && (!Number.isInteger(traceWindow) || traceWindow < 1 || traceWindow > MAX_NATIVE_STEPS)) throw new Error('端口观察窗口无效');
  const source = normalizeAssembly(code);
  const directory = await mkdtemp(join(tmpdir(), 've-8051-'));
  const sourcePath = join(directory, 'program.asm');
  try {
    await writeFile(sourcePath, source, 'ascii');
    try { await execFileAsync(ASSEMBLER, [sourcePath], { cwd: directory, timeout: 4000, maxBuffer: 64_000 }); }
    catch (cause) {
      const error = cause as Error & { stderr?: string };
      throw new Error(`汇编失败：${(error.stderr || error.message).replaceAll(directory, '[临时目录]').slice(0, 800)}`);
    }
    const hex = await readFile(join(directory, 'program.hex'), 'utf8');
    const codeBytes = parseIntelHex(hex);
    const output = await runS51(join(directory, 'program.hex'), steps, keySteps, clockHz, tracePort, secondaryPort, tertiaryPort, traceWindow);
    const portTrace = tracePort ? parsePortTrace(output, tracePort) : [];
    const secondaryTrace = secondaryPort ? parsePortTrace(output, secondaryPort, 'SECOND') : [];
    const tertiaryTrace = tertiaryPort ? parsePortTrace(output, tertiaryPort, 'THIRD') : [];
    if (tracePort && steps > 0 && !portTrace.length) throw new Error('端口采样失败，请缩短执行范围重试');
    if (secondaryPort && steps > 0 && secondaryTrace.length !== portTrace.length) throw new Error('双端口采样不完整，请重试');
    if (tertiaryPort && steps > 0 && tertiaryTrace.length !== portTrace.length) throw new Error('三端口采样不完整，请重试');
    return { toolchain: 'AS31 + SDCC ucSim/s51', code_sha256: createHash('sha256').update(source).digest('hex'), hex, code_bytes: codeBytes, steps, clock_hz: clockHz, port_trace: portTrace, secondary_trace: secondaryTrace, tertiary_trace: tertiaryTrace, ...parseS51(output) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
