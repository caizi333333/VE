import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSEMBLY_LABS, normalizeAssembly } from '../src/lib/assembly-labs';
import { compileAndSimulate, MAX_CONCURRENT_NATIVE_RUNS, NativeCapacityError, parseIntelHex, parseS51, withNativeSlot } from '../src/lib/native-8051';
import { LAB2_GROUP_LED_ASM, LAB3_ORIGINAL_TIMER_ASM, LAB5_SCAN_ASM, LAB5_SCAN_CORRECTED_ASM, LAB6_TWO_TONE_ASM, LAB7_CLOCK_ALARM_ASM, LAB7_CLOCK_ASM, LAB8_ABSTRACT_STEPPER_ASM, LAB8_PWM_70_ASM } from '../src/lib/assembly-presets';

const available = process.env.VE_NATIVE_8051_TEST === '1';

test('A51 subset conversion preserves line numbers and rejects unsafe directives', () => {
  const converted = normalizeAssembly('ORG 0000H\nSTART: MOV A,#01H ; 注释\nSJMP $\nEND');
  assert.match(converted, /\.org 0000H/);
  assert.match(converted, /__SELF_3: SJMP __SELF_3/);
  assert.equal(converted.split('\n').length, 5);
  assert.throws(() => normalizeAssembly('.INCLUDE secret'), /不接受点指令/);
  assert.throws(() => normalizeAssembly('START: NOP\nSTART: RET'), /重复/);
});

test('Intel HEX checksum rejects corrupted machine code', () => {
  assert.equal(parseIntelHex(':0100000000FF\n:00000001FF'), 1);
  assert.throws(() => parseIntelHex(':0100000000FE\n:00000001FF'), /校验和/);
});

test('ucSim parser rejects incomplete snapshots', () => {
  assert.throws(() => parseS51(''), /状态解析失败/);
});

test('native admission protects the server and releases slots after failures', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const running = Array.from({ length: MAX_CONCURRENT_NATIVE_RUNS }, () => withNativeSlot(() => gate));
  await assert.rejects(withNativeSlot(async () => undefined), NativeCapacityError);
  release();
  await Promise.all(running);
  await assert.rejects(withNativeSlot(async () => { throw new Error('tool failed'); }), /tool failed/);
  await withNativeSlot(async () => undefined);
});

test('AS31 compiles all eight extracts and ucSim runs their machine code', { skip: !available }, async () => {
  for (const lab of ASSEMBLY_LABS) {
    const result = await compileAndSimulate(lab.code, lab.id === 4 ? 300 : 20, lab.id === 4 ? [20] : [], 12_000_000, lab.port);
    assert.ok(result.code_bytes > 0, `lab ${lab.id}`);
    assert.match(result.hex, /:00000001FF/);
    assert.equal(result.steps, lab.id === 4 ? 300 : 20);
    if (lab.port) assert.ok(result.port_trace.length > 0, `trace lab ${lab.id}`);
    if (lab.id === 4) { assert.equal(result.ram['30H'], 1); assert.equal(result.registers.P1, 1); }
  }
});

test('compiled P1/P2 output traces change when the program changes', { skip: !available }, async () => {
  for (const id of [2, 6, 8]) {
    const lab = ASSEMBLY_LABS[id - 1];
    const result = await compileAndSimulate(lab.code, 500, [], 12_000_000, lab.port);
    assert.ok(new Set(result.port_trace.map(point => point.value)).size > 1, `lab ${id}`);
  }
});

test('compiled timer uses the matching 100/50-overflow accumulation for a two-second cycle', { skip: !available }, async () => {
  const code = ASSEMBLY_LABS[2].code;
  const twentyReload = code.replaceAll('#0D8H', '#0B1H').replaceAll('#0F0H', '#0E0H');
  const before = await compileAndSimulate(code, 500_000, [], 12_000_000);
  const ten = await compileAndSimulate(code, 1_000_000, [], 12_000_000);
  const wrong = await compileAndSimulate(twentyReload, 1_000_000, [], 12_000_000);
  const corrected = await compileAndSimulate(twentyReload.replaceAll('#100', '#50'), 1_000_000, [], 12_000_000);
  assert.equal(before.registers.P0 & 1, 1);
  assert.equal(ten.registers.P0 & 1, 0);
  assert.equal(wrong.registers.P0 & 1, 1);
  assert.equal(corrected.registers.P0 & 1, 0);
});

test('historical source is compilable but does not imply a matching lab task', { skip: !available }, async () => {
  const { readFile } = await import('node:fs/promises');
  for (let id = 1; id <= 6; id++) {
    const code = await readFile(`assets/assembly-source/lab${id}-historical.asm`, 'utf8');
    const result = await compileAndSimulate(code, 0, [], 12_000_000);
    assert.ok(result.code_bytes > 0, `historical ${id}`);
  }
});

test('report-aligned historical LED groups and timer program assemble and execute', { skip: !available }, async () => {
  const groups = await compileAndSimulate(LAB2_GROUP_LED_ASM, 20, [], 12_000_000, 'P1');
  assert.equal(groups.registers.P1, 0xaa);
  const timer = await compileAndSimulate(LAB3_ORIGINAL_TIMER_ASM, 1_000_000, [], 12_000_000, 'P0');
  assert.equal(timer.registers.P0 & 1, 0);
});

test('recovered 2025 clock source assembles to the exact Keil S7 machine-code image', { skip: !available }, async () => {
  const { readFile } = await import('node:fs/promises');
  const stored = await readFile('assets/assembly-source/lab7-s7-2025.hex', 'utf8');
  const generated = (await compileAndSimulate(LAB7_CLOCK_ASM, 0, [], 12_000_000)).hex;
  const image = (hex: string) => {
    const bytes = new Map<number, number>();
    for (const line of hex.trim().split(/\r?\n/)) {
      const record = Buffer.from(line.slice(1), 'hex');
      if (record[3] !== 0) continue;
      const address = record.readUInt16BE(1);
      for (let index = 0; index < record[0]; index++) bytes.set(address + index, record[4 + index]);
    }
    return [...bytes].sort(([a], [b]) => a - b);
  };
  assert.equal(parseIntelHex(stored), 183);
  assert.deepEqual(image(generated), image(stored));
});

test('corrected eight-digit scan removes the historical out-of-range segment lookup', { skip: !available }, async () => {
  const old = await compileAndSimulate(LAB5_SCAN_ASM, 500_000, [], 12_000_000, 'P0', 'P1');
  const fixed = await compileAndSimulate(LAB5_SCAN_CORRECTED_ASM, 500_000, [], 12_000_000, 'P0', 'P1');
  const valid = new Set([0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07]);
  assert.ok(old.port_trace.some(point => !valid.has(point.value)));
  assert.ok(fixed.port_trace.every(point => valid.has(point.value)));
  assert.equal(new Set(fixed.secondary_trace.map(point => point.value)).size, 8);
});

test('original two-tone source and derived clock alarm produce distinct real port traces', { skip: !available }, async () => {
  const edges = (values: number[]) => values.slice(1).filter((value, index) => value !== values[index]).length;
  const early = await compileAndSimulate(LAB6_TWO_TONE_ASM, 10_000, [], 12_000_000, 'P2', undefined, undefined, 5_000);
  const later = await compileAndSimulate(LAB6_TWO_TONE_ASM, 100_000, [], 12_000_000, 'P2', undefined, undefined, 5_000);
  assert.ok(edges(early.port_trace.map(point => point.value & 1)) > edges(later.port_trace.map(point => point.value & 1)));
  const before = await compileAndSimulate(LAB7_CLOCK_ALARM_ASM, 500_000, [], 12_000_000, 'P0', 'P1', 'P2', 5_000);
  const during = await compileAndSimulate(LAB7_CLOCK_ALARM_ASM, 750_000, [], 12_000_000, 'P0', 'P1', 'P2', 5_000);
  assert.equal(new Set(before.tertiary_trace.map(point => point.value)).size, 1);
  assert.equal(new Set(during.tertiary_trace.map(point => point.value)).size, 2);
  assert.equal(during.ram['31H'], 0);
});

test('report motor control variants produce 0.3/0.7 PWM contrast and all eight abstract phases', { skip: !available }, async () => {
  const low = await compileAndSimulate(ASSEMBLY_LABS[7].code, 500, [], 12_000_000, 'P1');
  const high = await compileAndSimulate(LAB8_PWM_70_ASM, 500, [], 12_000_000, 'P1');
  assert.ok(low.port_trace.filter(point => point.value & 1).length < high.port_trace.filter(point => point.value & 1).length);
  const phase = await compileAndSimulate(LAB8_ABSTRACT_STEPPER_ASM, 5_000, [], 12_000_000, 'P1');
  assert.deepEqual(new Set(phase.port_trace.map(point => point.value & 0x0f)), new Set([1, 3, 2, 6, 4, 12, 8, 9]));
});
