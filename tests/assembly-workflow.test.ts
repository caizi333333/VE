import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSEMBLY_LABS } from '../src/lib/assembly-labs';
import { Simulator } from '../src/lib/assembly-simulator';
import { assemblyEvidenceFile, assemblyEvidenceText, assemblyQuickStart, isCurrentAssemblyRun, prepareAssemblyHelp, type AssemblyRun } from '../src/lib/assembly-workflow';
import { redactSubmission } from '../src/lib/redact';

const run: AssemblyRun = {
  labId: 4, presetId: 'basic', presetTitle: 'INT0 按键中断', code: ASSEMBLY_LABS[3].code,
  clockHz: 12_000_000, keySteps: [20], traceWindow: 500, tracePort: 'P1', capturedAt: '2026-09-27T06:00:00.000Z',
  result: {
    toolchain: 'AS31 + SDCC ucSim/s51', code_sha256: 'e4c98068ac380624117c3049e23ab7b37b02cd30965684213a8ae2f8187c8020',
    hex: ':0100000000FF\n:00000001FF', code_bytes: 1, steps: 45, clock_hz: 12_000_000,
    pc: 75, machine_clocks: 900, elapsed_seconds: 0.000075,
    registers: { A: 0, SP: 7, P0: 255, P1: 1, P2: 255, P3: 251, TMOD: 0, TCON: 1, TH0: 0, TL0: 0 },
    ram: { '20H': 0, '30H': 1, '31H': 0, '32H': 0, '33H': 0, '34H': 0, '35H': 0, '36H': 0, '37H': 0, '38H': 0 },
    port_trace: [{ step: 20, value: 0 }, { step: 45, value: 1 }], secondary_trace: [], tertiary_trace: [],
  },
};

test('old results cannot be reused for changed source, clock or preset', () => {
  assert.equal(isCurrentAssemblyRun(run, run.code, run.clockHz, run.presetId), true);
  assert.equal(isCurrentAssemblyRun(run, run.code + '\nNOP', run.clockHz, run.presetId), false);
  assert.equal(isCurrentAssemblyRun(run, run.code, 11_059_200, run.presetId), false);
  assert.equal(isCurrentAssemblyRun(run, run.code, run.clockHz, 'other'), false);
  assert.equal(isCurrentAssemblyRun(null, run.code, run.clockHz, run.presetId), false);
});

test('download preserves the exact execution inputs and traces without implying classroom completion', () => {
  const file = JSON.parse(assemblyEvidenceFile(run));
  assert.deepEqual(file.result, run.result);
  assert.deepEqual(file.keySteps, [20]);
  assert.equal(file.code, run.code);
  assert.equal(file.traceWindow, 500);
  assert.equal(file.evidence_type, 'student_submitted_simulation');
  assert.match(file.summary, /学生提交，待教师复核/);
  assert.match(file.summary, /不代表实物验证或教师确认完成/);
  assert.match(file.summary, /45 条/);
  assert.match(file.summary, /0.075 ms/);
});

test('help handoff preserves code, requires separate observation, and refuses oversized content', () => {
  const prepared = prepareAssemblyHelp(run, '按键后计数与预期不同');
  assert.equal(prepared.code, run.code);
  assert.equal(prepared.evidence, assemblyEvidenceText(run));
  assert.ok(prepared.evidence.length < 1000);
  assert.deepEqual(redactSubmission(prepared.evidence, prepared.code).hits, []);
  assert.throws(() => prepareAssemblyHelp({ ...run, code: 'x'.repeat(8001) }, ''), /8,000/);
  assert.throws(() => prepareAssemblyHelp(run, '现'.repeat(1900)), /合计过长/);
});

test('quick start covers every preset and the stack example reaches its stated observation', () => {
  for (const lab of ASSEMBLY_LABS) {
    for (const preset of ['basic', ...(lab.variants?.map(item => item.id) ?? [])]) {
      const guide = assemblyQuickStart(lab.id, preset);
      assert.ok(guide.steps > 0 && guide.steps <= 2_000_000);
      assert.ok(guide.instruction.length > 10);
    }
  }
  const simulator = new Simulator(ASSEMBLY_LABS[0].code);
  simulator.stepBatch(assemblyQuickStart(1, 'basic').steps);
  assert.equal(simulator.state.registers.A, 0x58);
  assert.equal(simulator.state.registers.SP, 0x40);
  assert.equal(simulator.state.ram[0x30], 0x7f);
});
