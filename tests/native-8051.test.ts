import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSEMBLY_LABS, normalizeAssembly } from '../src/lib/assembly-labs';
import { compileAndSimulate, parseIntelHex, parseS51 } from '../src/lib/native-8051';

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
