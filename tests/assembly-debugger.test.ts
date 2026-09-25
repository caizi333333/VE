import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSEMBLY_LABS } from '../src/lib/assembly-labs';
import { Simulator } from '../src/lib/assembly-simulator';

const lab = (id: number) => {
  const item = ASSEMBLY_LABS.find(candidate => candidate.id === id);
  assert.ok(item);
  return item;
};

test('eight report-aligned teaching extracts load and execute without unsupported instructions', () => {
  assert.deepEqual(ASSEMBLY_LABS.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const item of ASSEMBLY_LABS) {
    const simulator = new Simulator(item.code);
    assert.equal(simulator.stepBatch(300).executed, 300, `lab ${item.id}`);
    assert.ok(simulator.state.machineCycles >= 300, `lab ${item.id}`);
  }
});

test('lab 1 restores accumulator and RAM from stack', () => {
  const sim = new Simulator(lab(1).code);
  sim.stepBatch(14);
  assert.equal(sim.state.registers.A, 0x58);
  assert.equal(sim.state.ram[0x30], 0x7f);
  assert.equal(sim.state.registers.SP, 0x40);
});

test('lab 2 output follows source code, including a changed delay count', () => {
  const sample = lab(2).code;
  const transition = (code: string) => {
    const sim = new Simulator(code);
    let last = sim.state.portValues.P1;
    for (let i = 1; i <= 300; i++) {
      sim.stepBatch(1);
      const current = sim.state.portValues.P1;
      if (last === 0xfe && current === 0xfd) return i;
      last = current;
    }
    return -1;
  };
  const normal = transition(sample);
  const longer = transition(sample.replace('MOV R7,#20', 'MOV R7,#80'));
  assert.ok(normal > 0);
  assert.ok(longer > normal);
});

test('lab 3 T0 reload changes observed P0.0 transition spacing', () => {
  const sample = lab(3).code;
  const spacing = (code: string) => {
    const sim = new Simulator(code);
    const edges: number[] = [];
    let last = sim.state.portValues.P0 & 1;
    for (let i = 0; i < 30000 && edges.length < 2; i++) {
      sim.stepBatch(1);
      const current = sim.state.portValues.P0 & 1;
      if (current !== last) edges.push(sim.state.machineCycles);
      last = current;
    }
    assert.equal(edges.length, 2);
    return edges[1] - edges[0];
  };
  const tenMs = spacing(sample);
  const twentyMs = spacing(sample.replaceAll('#0D8H', '#0B1H').replaceAll('#0F0H', '#0E0H'));
  assert.ok(tenMs >= 9000 && tenMs <= 11000, `10ms model: ${tenMs}`);
  assert.ok(twentyMs >= 19000 && twentyMs <= 21000, `20ms model: ${twentyMs}`);
  assert.ok(twentyMs > tenMs * 1.8);
});

test('lab 4 responds to P3.2 INT0 input and increments only after a pulse', () => {
  const sim = new Simulator(lab(4).code);
  sim.stepBatch(20);
  assert.equal(sim.state.ram[0x30], 0);
  sim.pulsePortBit('P3', 2, 2);
  sim.stepBatch(25);
  assert.equal(sim.state.ram[0x30], 1);
  assert.equal(sim.state.portValues.P1, 1);
});

test('lab 5 segment code and lab 7 minute carry are visible in machine state', () => {
  const segment = new Simulator(lab(5).code);
  segment.stepBatch(2);
  assert.equal(segment.state.portValues.P0, 0x3f);
  assert.equal(segment.state.portValues.P2, 0xfe);
  const clock = new Simulator(lab(7).code);
  clock.stepBatch(20);
  assert.equal(clock.state.ram[0x30], 1);
  assert.equal(clock.state.ram[0x31], 0);
  assert.equal(clock.state.ram[0x32], 13);
});

test('unsupported mnemonics fail visibly instead of silently advancing PC', () => {
  const sim = new Simulator('ORG 0000H\nFAKE A,#01H\nEND');
  assert.throws(() => sim.stepBatch(1), /暂不支持指令 FAKE/);
});
