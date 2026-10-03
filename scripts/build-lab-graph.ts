/**
 * 生成学生页"本实验在课程知识图谱中的位置"所需的切片文件。
 *
 * 用法：npm run build:lab-graph
 * 输出：src/lib/lab-graph-slices.json（提交进库）
 * 图谱或 lab-guides 的 pointId 变更后须重跑；check:kg 会校验新鲜度。
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLabGraphSlices, validateLabGraphSlices } from '../src/lib/lab-graph';

const slices = buildLabGraphSlices();
const problems = validateLabGraphSlices(slices);
if (problems.length > 0) {
  console.error(`切片校验未通过：\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const output_path = join(__dirname, '../src/lib/lab-graph-slices.json');
writeFileSync(output_path, `${JSON.stringify(slices, null, 2)}\n`);
console.log(`已写入 ${output_path}`);
for (const [lab_id, slice] of Object.entries(slices.labs)) {
  const chains = slice.chains.length > 0 ? slice.chains.map((c) => c.name).join('、') : '无专项';
  console.log(`实验${lab_id}：锚点 ${slice.anchor?.id ?? '缺失'} ${slice.anchor?.name ?? ''}，先修 ${slice.prerequisites.length} 条，专项：${chains}`);
}
