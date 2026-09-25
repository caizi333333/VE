/**
 * 图谱与诊疗库自检。交付前跑一遍，确保引用不悬空、脱敏规则真的生效。
 *
 * 用法：npm run check:kg
 * 任一项不通过即以非零码退出。
 */

import { FAULT_CHAINS, matchFaultChains } from '../src/lib/fault-chains';
import { redactSubmission } from '../src/lib/redact';
import { retrieveConstraint } from '../src/lib/retrieval';
import { parseDiagnosis } from '../src/lib/prompt';
import kg_data from '../data/kg-8051.json';

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

/**
 * 记录一项检查结果。
 *
 * @param name 检查项名称
 * @param passed 是否通过
 * @param detail 说明
 */
function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

const valid_point_ids = new Set(kg_data.points.map((point) => point.id));

// 1. 图谱本身：依赖边不得指向不存在的节点
const dangling_edges = kg_data.points.flatMap((point) =>
  point.prerequisites
    .filter((prerequisite) => !valid_point_ids.has(prerequisite.id))
    .map((prerequisite) => `${point.id}->${prerequisite.id}`),
);
record(
  '图谱依赖边完整',
  dangling_edges.length === 0,
  dangling_edges.length === 0
    ? `${kg_data.meta.counts.points} 节点 / ${kg_data.meta.counts.prerequisite_edges} 边`
    : `悬空边：${dangling_edges.join('、')}`,
);

// 2. 诊疗库：故障链引用的节点必须都在图谱里
const missing_refs = FAULT_CHAINS.flatMap((chain) =>
  [...chain.entry_point_ids, ...chain.chain_point_ids, ...chain.known_pitfalls.map((p) => p.point_id)]
    .filter((point_id) => !valid_point_ids.has(point_id))
    .map((point_id) => `${chain.id}:${point_id}`),
);
record(
  '故障链节点引用有效',
  missing_refs.length === 0,
  missing_refs.length === 0
    ? `${FAULT_CHAINS.length} 条故障链全部命中图谱`
    : `无效引用：${missing_refs.join('、')}`,
);

// 3. 匹配：三类故障各自的典型说法要能命中对应链
const match_samples: { text: string; expect_chain_id: string }[] = [
  { text: '定时器中断进不去，LED 不翻转', expect_chain_id: 'timer-isr-not-entered' },
  { text: '串口乱码，上位机显示乱码', expect_chain_id: 'uart-garbled' },
  { text: '定时不准，闪烁太快', expect_chain_id: 'timing-inaccurate' },
];
const match_failures = match_samples.filter(
  (sample) => matchFaultChains(sample.text)[0]?.id !== sample.expect_chain_id,
);
record(
  '典型说法能命中故障链',
  match_failures.length === 0,
  match_failures.length === 0
    ? `${match_samples.length} 条样本全部命中`
    : `未命中：${match_failures.map((f) => f.text).join('、')}`,
);

// 4. 脱敏：身份信息不得残留
const redacted = redactSubmission(
  '我是 2023010112 班的，姓名：张三，手机 13800138000',
  '// 作者：李四\nMOV TMOD, #01H',
);
const leaked_patterns = [/2023010112/, /张三/, /13800138000/, /李四/];
const leaks = leaked_patterns.filter(
  (pattern) => pattern.test(redacted.symptom) || pattern.test(redacted.code),
);
record(
  '脱敏规则生效',
  leaks.length === 0,
  leaks.length === 0
    ? `命中 ${redacted.hits.map((hit) => `${hit.rule}×${hit.count}`).join('、')}`
    : `仍有残留：${leaks.map((pattern) => pattern.source).join('、')}`,
);

// 5. 提示词自洽：注入的易错点所在节点必须都在允许推理的节点清单内。
//    否则模型照着易错点作答会被判为越出知识约束，白白重试。
const scope_failures = match_samples.flatMap((sample) => {
  const constraint = retrieveConstraint(sample.text, '');
  const injected_ids = new Set(constraint.points.map((point) => point.id));
  return constraint.pitfalls
    .filter((pitfall) => !injected_ids.has(pitfall.point_id))
    .map((pitfall) => `${sample.expect_chain_id}:${pitfall.point_id}`);
});
record(
  '易错点落点在允许范围内',
  scope_failures.length === 0,
  scope_failures.length === 0
    ? '三类故障的知识约束自洽'
    : `越界易错点：${scope_failures.join('、')}`,
);

// 6. 节点编号归一化：模型把 id 写成 [5.2.2] 时不应被判越界
let point_id_normalized = false;
try {
  const parsed = parseDiagnosis(
    JSON.stringify({
      classification: '落在 5.4.2',
      checkpoints: [{ point_id: '[5.2.2]', instruction: '检查 ET0' }],
      bridging_task: '先确认能进 ISR',
      review_notes: [],
    }),
    ['5.2.2'],
  );
  point_id_normalized = parsed.checkpoints[0]?.point_id === '5.2.2';
} catch {
  point_id_normalized = false;
}
record(
  '检查点编号去括号',
  point_id_normalized,
  point_id_normalized ? '[5.2.2] 已归一成 5.2.2' : '方括号编号仍被判越界',
);

for (const result of results) {
  console.log(`${result.passed ? '通过' : '不通过'}  ${result.name}：${result.detail}`);
}

const failed_count = results.filter((result) => !result.passed).length;
if (failed_count > 0) {
  console.error(`\n${failed_count} 项未通过`);
  process.exit(1);
}
console.log('\n全部通过');
