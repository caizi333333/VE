import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTimer, calculateUart, calculateExperiment, buildTimerWaveform, timerWaveState } from '../src/lib/calculations';
import { redactSubmission, redactText } from '../src/lib/redact';
import { retrieveConstraint, MAX_INJECTED_PITFALLS } from '../src/lib/retrieval';
import { getPoint } from '../src/lib/knowledge-graph';
import { buildMessages, parseDiagnosis } from '../src/lib/prompt';
import { buildPracticePack } from '../src/lib/practice-tasks';
import { LAB_GUIDES } from '../src/lib/lab-guides';
import type { ExperimentConfig } from '../src/lib/api-types';
import type { FaultPitfall } from '../src/lib/fault-chains';

const config: ExperimentConfig = { chip: 'AT89C51', clock_hz: 11059200, clocks_per_tick: 12, timer_mode: 1, target_ms: 50 };
test('all eight report-based experiments have distinct, actionable self-checks', () => {
  assert.deepEqual(LAB_GUIDES.map((guide) => guide.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const guide of LAB_GUIDES) {
    assert.ok(guide.wiring.length > 0 && guide.code.length > 0 && guide.resultChecks.length >= 2, guide.title);
    assert.ok(guide.resultChecks.every((step) => step.length > 12), guide.title);
  }
  assert.match(LAB_GUIDES[2].resultChecks.join(' '), /翻转.*完整周期/);
  assert.match(LAB_GUIDES[3].resultChecks.join(' '), /INT0/);
  assert.match(LAB_GUIDES[7].wiring.join(' '), /实物核对/);
});
function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ classification: '检查定时器初值计算', checkpoints: [{ point_id: '[6.1.4]', instruction: '核对教师给出的晶振与计数分频' }], bridging_task: '记录一次定时器溢出对应的观察结果', review_notes: [], ...overrides });
}

test('timer: 11.0592 MHz / 12T / 50 ms gives 0x4C00, 12 MHz gives 0x3CB0', () => {
  const result = calculateTimer(config);
  assert.equal(result.status, 'ready');
  assert.equal(result.values?.counts, 46080);
  assert.equal(result.values?.initial_value, 19456);
  assert.equal(result.values?.initial_hex, '0x4C00');
  assert.equal(result.values?.th_hex, '0x4C');
  assert.equal(result.values?.tl_hex, '0x00');
  assert.equal(result.values?.actual_ms, 50);
  assert.equal(calculateTimer({ ...config, clock_hz: 12000000 }).values?.initial_hex, '0x3CB0');
});

test('timer validates missing, invalid, unsupported and range conditions without guessing', () => {
  assert.equal(calculateTimer({}).status, 'incomplete');
  assert.ok(calculateTimer({ ...config, clocks_per_tick: undefined }).missing.includes('clocks_per_tick'));
  assert.equal(calculateTimer({ ...config, clock_hz: NaN }).status, 'invalid');
  assert.equal(calculateTimer({ ...config, clocks_per_tick: 1.5 }).status, 'invalid');
  assert.equal(calculateTimer({ ...config, target_ms: -1 }).status, 'invalid');
  assert.equal(calculateTimer({ ...config, chip: 'STM32F103' }).status, 'unsupported');
  assert.equal(calculateTimer({ ...config, target_ms: 1000 }).status, 'unsupported');
  assert.equal(calculateTimer({ ...config, target_ms: 1e-20 }).status, 'unsupported');
  const mode2 = calculateTimer({ ...config, clock_hz: 12000000, timer_mode: 2, target_ms: 0.25 });
  assert.equal(mode2.values?.initial_hex, '0x06');
  assert.equal(mode2.values?.th, mode2.values?.tl);
});

test('experiment 3 waveform links overflow spacing to the manual 2 s output period', () => {
  const base = { ...config, clock_hz: 12000000, time_definition: '单次溢出间隔' } as const;
  for (const [interval, count] of [[10, 100], [20, 50], [50, 20]]) {
    const correct = buildTimerWaveform({ ...base, target_ms: interval }, 'accumulated');
    assert.equal(correct.status, 'ready');
    assert.equal(correct.overflowMs, interval);
    assert.equal(correct.overflowsPerToggle, count);
    assert.equal(correct.fullPeriodMs, 2000);
    assert.equal(correct.overflowEventsMs.length, 2000 / interval);
    assert.equal(timerWaveState(correct, 999)?.outputHigh, true);
    assert.equal(timerWaveState(correct, 1000)?.outputHigh, false);
    assert.equal(timerWaveState(correct, 2000)?.outputHigh, true);

    const wrong = buildTimerWaveform({ ...base, target_ms: interval }, 'direct');
    assert.equal(wrong.overflowsPerToggle, 1);
    assert.equal(wrong.fullPeriodMs, 2 * interval);
    assert.equal(timerWaveState(wrong, interval)?.outputHigh, false);
  }
  assert.equal(buildTimerWaveform({ ...base, target_ms: 70 }, 'accumulated').status, 'unsupported');
  assert.equal(buildTimerWaveform({ ...base, clock_hz: 11059200, target_ms: 50 }, 'accumulated').fullPeriodMs, 2000);
});

test('UART uses configured SMOD and clock and reports quantization error', () => {
  const uart = { ...config, timer_mode: 2 as const, smod: 0 as const, target_baud: 9600 };
  const exact = calculateUart(uart);
  assert.equal(exact.status, 'ready');
  assert.equal(exact.values?.th_hex, '0xFD');
  assert.equal(exact.values?.actual_baud, 9600);
  assert.equal(exact.values?.error_percent, 0);
  assert.equal(calculateUart({ ...uart, smod: 1 }).values?.th_hex, '0xFA');
  const rounded = calculateUart({ ...uart, clock_hz: 12000000, tolerance_percent: 2 });
  assert.ok(Math.abs(Number(rounded.values?.error_percent) - 8.50694444444445) < 1e-8);
  assert.ok(rounded.notes.some((note) => note.includes('超出')));
  assert.equal(calculateUart({ ...uart, smod: undefined }).status, 'incomplete');
  assert.equal(calculateUart({ ...uart, timer_mode: 1 }).status, 'unsupported');
  assert.equal(calculateExperiment(uart, 'uart-garbled').length, 1);
});

test('teacher backfill cannot create an unrelated or empty retrieval hit', () => {
  const backfill: FaultPitfall[] = [{ point_id: '6.1.4', description: '按确认晶振核算初值', source: 'backfill' }];
  for (const text of ['午餐推荐', '', ' ']) {
    const result = retrieveConstraint(text, '', backfill);
    assert.equal(result.points.length, 0);
    assert.equal(result.pitfalls.length, 0);
  }
});

test('retrieval backfills remain relevant, unique and bounded; edges come from graph', () => {
  const point_id = '6.1.4';
  const backfills: FaultPitfall[] = [
    { point_id: '7.3.1', description: '不相关串口记录', source: 'backfill' },
    { point_id, description: '相同描述。', source: 'backfill' },
    { point_id, description: '相同 描述', source: 'backfill' },
    ...Array.from({ length: 20 }, (_, i) => ({ point_id, description: `第${i}项检查`, source: 'backfill' as const })),
  ];
  const result = retrieveConstraint('定时不准', '', backfills);
  assert.ok(result.pitfalls.length <= MAX_INJECTED_PITFALLS);
  assert.equal(result.pitfalls.filter((pitfall) => pitfall.description.includes('相同')).length, 1);
  assert.equal(result.pitfalls.filter((pitfall) => pitfall.description.includes('不相关')).length, 0);
  for (const edge of result.edges) assert.ok(getPoint(edge.to_id)?.prerequisites.some((item) => item.id === edge.from_id));
});

test('redacts self introductions, signatures and alphanumeric IDs without losing clock values', () => {
  const result = redactSubmission('我叫张三，学号 A202401001。晶振频率 11059200 Hz，目标50ms；联系 13800138000，邮箱 alice@example.edu', '// Author: Alice Zhang\n/* 作者：李四 */\n#define FOSC 12000000\nTH0=0x4C; TL0=0x00; // B202401002');
  const combined = result.symptom + result.code;
  for (const privateValue of ['张三', 'A202401001', '13800138000', 'alice@example.edu', 'Alice Zhang', '李四', 'B202401002']) assert.equal(combined.includes(privateValue), false, privateValue);
  for (const technical of ['11059200 Hz', '50ms', '12000000', 'TH0=0x4C', 'TL0=0x00', '*/']) assert.ok(combined.includes(technical), technical);
  assert.ok(result.hits.every((hit) => typeof hit.count === 'number' && !('value' in hit)));
  assert.ok(!redactText('My name is Alice Zhang. 串口乱码').text.includes('Alice'));
  for (const id of ['20230123A', '2024A01001']) assert.ok(!redactText(`学生编号 ${id}，串口乱码`).text.includes(id));
  assert.match(redactText('频率 11059200赫兹，TH0=0x12345678').text, /11059200赫兹/);
  assert.match(redactText('频率 11059200赫兹，TH0=0x12345678').text, /0x12345678/);
});

test('parse gates complete main code, cross-chip terminology, out-of-scope points and unsupported numbers', () => {
  assert.throws(() => parseDiagnosis(response({ bridging_task: 'void main(void) { while(1) {} }' }), ['6.1.4']), /main/);
  assert.throws(() => parseDiagnosis(response({ bridging_task: '调用 HAL_TIM_Base_Start_IT 初始化' }), ['6.1.4']), /芯片/);
  assert.throws(() => parseDiagnosis(response({ checkpoints: [{ point_id: '7.3.1', instruction: '查串口' }] }), ['6.1.4']), /范围/);
  assert.throws(() => parseDiagnosis(response({ bridging_task: '设置初值0x4C00以得到50ms' }), ['6.1.4']), /口径/);
  assert.throws(() => parseDiagnosis(response({ bridging_task: '按12T计算' }), ['6.1.4']), /口径/);
  const parsed = parseDiagnosis(response(), ['6.1.4']);
  assert.equal(parsed.checkpoints[0]?.point_id, '6.1.4');
});

test('parse rejects the exact faulty 0x3CB0 / 0x4CB0 case and adds deterministic review notes', () => {
  const context = { config, calculations: calculateExperiment(config, 'timing-inaccurate') };
  for (const incorrect of ['0x3CB0', '0x4CB0', '4CB0H']) {
    assert.throws(() => parseDiagnosis(response({ bridging_task: `核对初值 ${incorrect}` }), ['6.1.4'], context), /不一致/);
  }
  const correct = parseDiagnosis(response({ bridging_task: '按50ms目标核对0x4C00与TH0=76，TL0=0' }), ['6.1.4'], context);
  assert.ok(correct.review_notes.some((note) => note.includes('19456') && note.includes('教师复核')));
  assert.throws(() => parseDiagnosis(response({ bridging_task: '按12MHz晶振核对初值' }), ['6.1.4'], context), /不一致/);
  assert.throws(() => parseDiagnosis(response({ bridging_task: 'TH0=0x00，TL0=0x4C' }), ['6.1.4'], context), /不一致/);
  assert.throws(() => parseDiagnosis(response({ bridging_task: '计数次数=50000' }), ['6.1.4'], context), /不一致/);
});

test('assessment scores require actual confirmed rubric and graph references', () => {
  const rubric = [{ id: 'r1', label: '计算口径', max_score: 4, criterion: '参数和公式准确' }];
  const item = { criterion_id: 'r1', score: 2, reason: '代码未体现分频口径', point_id: '6.1.4', line_no: 3 };
  assert.throws(() => parseDiagnosis(response({ assessments: [item] }), ['6.1.4']), /量规/);
  assert.throws(() => parseDiagnosis(response({ assessments: [{ ...item, score: 5 }] }), ['6.1.4'], { rubric }), /满分/);
  assert.throws(() => parseDiagnosis(response({ assessments: [item, item] }), ['6.1.4'], { rubric }), /重复/);
  assert.equal(parseDiagnosis(response({ assessments: [item] }), ['6.1.4'], { rubric }).assessments?.[0]?.score, 2);
  assert.throws(() => parseDiagnosis(response({ assessments: [item] }), ['6.1.4'], { rubric, code_line_count: 2 }), /代码行/);
});

test('three fault task packs describe deliverables, verification and configured conditions without example defaults', () => {
  for (const fault of ['timer-isr-not-entered', 'uart-garbled', 'timing-inaccurate']) {
    const tasks = buildPracticePack(fault, '核对当前错误并记录', '6.1.4');
    assert.deepEqual(tasks.map((task) => task.level), [1, 2, 3]);
    for (const task of tasks) {
      for (const field of ['objective', 'conditions', 'deliverable', 'verification'] as const) assert.ok(task[field]);
      assert.doesNotMatch(task.instruction, /50ms|9600|11\.0592|12MHz|65ms/);
      assert.match(task.verification, /教师/);
    }
  }
  assert.match(buildPracticePack('timing-inaccurate', '观察', '6.1.4', config)[1]!.conditions, /11059200 Hz/);
});

test('model context supplies numbered code, experiment, rubric and deterministic calculation', () => {
  const messages = buildMessages(retrieveConstraint('定时不准', ''), '时间偏差', 'TH0=0;\nTL0=0;', { config, calculations: calculateExperiment(config, 'timing-inaccurate') });
  assert.match(messages[0]!.content, /0x4C00/);
  assert.match(messages[0]!.content, /未编译/);
  assert.match(messages[1]!.content, /2 \| TL0=0/);
});

// Regressions derived from the actual 80C51 lesson and HC6800 UART examples.
test('80C51 lesson chip and 4800 baud example require the actual clock', () => {
  assert.equal(calculateTimer({ ...config, chip: '80C51' }).values?.initial_hex, '0x4C00');
  assert.equal(calculateTimer({ ...config, chip: 'STM32F103' }).status, 'unsupported');
  const uart = { ...config, chip: '80C51', timer_mode: 2 as const, smod: 1 as const, target_baud: 4800 };
  assert.equal(calculateUart(uart).values?.th_hex, '0xF4');
  assert.equal(calculateUart(uart).values?.actual_baud, 4800);
  const at12MHz = calculateUart({ ...uart, clock_hz: 12000000 });
  assert.equal(at12MHz.values?.th_hex, '0xF3');
  assert.ok(Math.abs(Number(at12MHz.values?.actual_baud) - 4807.692307692308) < 1e-8);
});
