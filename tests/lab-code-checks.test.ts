import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLabCode } from '../src/lib/lab-code-checks';
import { ASSEMBLY_LABS } from '../src/lib/assembly-labs';
import { hasQuantitativeGuidance } from '../src/lib/diagnosis-policy';

const int0 = `ORG 0000H
LJMP START
ORG 0003H
LJMP HANDLER
ORG 0040H
START: SETB EX0
SETB EA
WAIT: SJMP WAIT
HANDLER: INC 30H
RETI
END`;
const findings = (code: string, lab = 4) => analyzeLabCode(lab, code).findings;

test('normal examples do not become faults or completion claims', () => {
  for (const lab of ASSEMBLY_LABS) {
    const analysis = analyzeLabCode(lab.id, lab.code);
    assert.equal(analysis.status, 'checked');
    assert.deepEqual(analysis.findings, [], lab.title);
    assert.match(analysis.summary, /不代表程序正确/);
  }
});
test('interrupt exit check points to the vector and actual RET source line', () => {
  const checks = findings(int0.replace('RETI', 'RET'));
  assert.equal(checks.length, 1);
  assert.match(checks[0].title, /INT0/);
  assert.deepEqual(checks[0].evidence, [{ line: 3, text: 'ORG 0003H' }, { line: 10, text: 'RET' }]);
  assert.match(checks[0].instruction, /再次进入/);
  assert.equal(hasQuantitativeGuidance(checks[0].instruction), false);
});
test('called helper RET is not an interrupt exit, and ordinary RET is not diagnosed', () => {
  assert.deepEqual(findings(int0.replace('HANDLER: INC 30H', 'HANDLER: LCALL HELPER').replace('END', 'HELPER: INC 30H\nRET\nEND')), []);
  assert.deepEqual(findings('ORG 0000H\nLCALL HELPER\nSJMP $\nHELPER: RET\nEND'), []);
});
test('conditional ISR exits are followed while unresolved and computed jumps are bounded', () => {
  assert.equal(findings(int0.replace('HANDLER: INC 30H\nRETI', 'HANDLER: JZ BAD\nRETI\nBAD: RET')).length, 1);
  assert.deepEqual(findings(int0.replace('LJMP HANDLER', 'JMP @A+DPTR').replace('RETI', 'RET')), []);
  assert.deepEqual(findings(int0.replace('LJMP HANDLER', 'LJMP NOT_IN_FRAGMENT').replace('RETI', 'RET')), []);
});
test('comments and quoted data cannot manufacture checks and line numbers remain original', () => {
  const code = '; ORG 0003H\n; RET\n/* CLR EA\nCLR EX0 */\n' + int0 + '\nDB "RET; CLR EA", 0';
  assert.deepEqual(findings(code), []);
  const real = findings(code.replace('RETI', 'RET'));
  assert.equal(real[0].evidence[1].line, 14);
});
test('explicit disabled enables on a straight reset path retain write and wait evidence', () => {
  const checks = findings(int0.replace('SETB EA', 'CLR EA'));
  assert.equal(checks.length, 1);
  assert.equal(checks[0].rule, 'idle-disabled-EA');
  assert.deepEqual(checks[0].evidence.map(line => line.line), [7, 8]);
  assert.match(checks[0].instruction, /若这里用于等待/);
});
test('whole IE writes and mask operations override earlier bit writes', () => {
  assert.deepEqual(findings(int0.replace('SETB EA', 'CLR EA\nMOV IE,#081H')), []);
  assert.deepEqual(findings(int0.replace('SETB EA', 'CLR EA\nORL IE,#080H')), []);
  assert.equal(findings(int0.replace('SETB EA', 'SETB EA\nANL IE,#07FH'))[0].rule, 'idle-disabled-EA');
  assert.deepEqual(findings(int0.replace('SETB EA', 'CLR EA\nMOV 0A8H,#081H')), []);
  assert.deepEqual(findings(int0.replace('SETB EA', 'CLR EA\nSETB IE.7')), []);
});
test('unknown register writes, calls and branches prevent stale initializer conclusions', () => {
  for (const change of ['MOV IE,A', 'ORL IE,A', 'ANL IE,A', 'POP IE', 'LCALL INIT', 'JZ ELSEWHERE']) {
    const checks = findings(int0.replace('SETB EA', `CLR EA\n${change}`));
    assert.ok(!checks.some(check => check.rule.startsWith('idle-disabled')), change);
  }
});
test('missing flags or vectors in a snippet do not become missing-enable faults', () => {
  assert.deepEqual(findings('ORG 0003H'), []);
  assert.deepEqual(findings(int0.replace('START: SETB EX0\nSETB EA', 'START: NOP')), []);
  assert.deepEqual(findings(int0.replace('ORG 0000H\nLJMP START\n', '').replace('SETB EA', 'CLR EA')), []);
});
test('polling timer does not require ET0 or EA, but an explicitly stopped T0 can be checked', () => {
  const code = 'ORG 0000H\nMOV TH0,#0D8H\nMOV TL0,#0F0H\nSETB TR0\nCLR EA\nCLR ET0\nWAIT: SJMP WAIT\nEND';
  assert.deepEqual(findings(code, 3), []);
  assert.equal(findings(code.replace('SETB TR0', 'CLR TR0'), 3)[0].rule, 'idle-disabled-TR0');
});
test('C, symbol aliases, conditional assembly and duplicate labels/entries are not guessed', () => {
  for (const code of ['#include <reg51.h>\nvoid main(){EA=0;}', 'EA BIT 0AFH\n' + int0, 'MASK EQU 81H\n' + int0, 'IF FEATURE\n' + int0, int0 + '\nHANDLER: RET', int0 + '\nORG 0003H\nRET']) {
    const analysis = analyzeLabCode(4, code);
    assert.equal(analysis.status, 'unsupported', code);
    assert.deepEqual(analysis.findings, []);
  }
  assert.equal(analyzeLabCode(4, '').status, 'empty');
});
test('findings are bounded and can be published as qualitative checks', () => {
  const checks = findings(int0.replace('SETB EX0', 'CLR EX0').replace('SETB EA', 'CLR EA').replace('RETI', 'RET'));
  assert.equal(checks.length, 3);
  assert.ok(checks.every(check => !hasQuantitativeGuidance(check.instruction)));
});
