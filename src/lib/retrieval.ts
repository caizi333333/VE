/**
 * 图谱约束检索。
 *
 * 这是"知识图谱约束大模型"落地的地方：学生提问时，先把现象落到具体知识节点，
 * 再沿先修依赖链召回相关知识与已知易错点，作为参考上下文注入提示词，让模型在
 * 给定范围内给排查路径，而不是自由发挥。
 *
 * 召回顺序：故障链命中优先（依赖链已由课程组排过序），未命中再退回按文本
 * 检索节点。两条路都取不到节点时返回空约束，由上层拒绝调用模型，不硬答。
 */

import {
  collectPrerequisiteClosure,
  getPoint,
  searchPointsByText,
  type GraphPoint,
} from './knowledge-graph';
import { matchFaultChains, type FaultChain, type FaultPitfall } from './fault-chains';

export interface RetrievedConstraint {
  /** 命中的故障链；按文本兜底检索时为 null。 */
  fault_chain: FaultChain | null;
  /** 本次注入的节点，有序：入口节点在前，上溯得到的先修节点在后。 */
  points: GraphPoint[];
  /** 依赖边，用于界面显式画出"用了哪条链"。 */
  edges: { from_id: string; to_id: string; reason: string | null }[];
  /** 已知高频易错点：故障链预置的 + 教师回填的。 */
  pitfalls: FaultPitfall[];
}

/** 单次注入的节点上限。超过这个数，提示词会被稀释、模型反而抓不住重点。 */
const MAX_INJECTED_POINTS = 12;
/** Backfills are evidence attached to an already retrieved node, never search inputs. */
export const MAX_INJECTED_PITFALLS = 8;
const MAX_PITFALL_LENGTH = 800;

/**
 * 按学生输入检索图谱约束。
 *
 * @param symptom_text 现象描述
 * @param code_text 代码片段
 * @param backfilled_pitfalls 教师此前回填的易错点，参与本次召回
 * @returns 本次可用的知识约束；points 为空表示没命中，调用方应拒绝调用模型
 */
export function retrieveConstraint(
  symptom_text: string,
  code_text: string,
  backfilled_pitfalls: readonly FaultPitfall[] = [],
): RetrievedConstraint {
  const combined_text = `${symptom_text}\n${code_text}`;
  const matched_chains = matchFaultChains(combined_text);
  const primary_chain = matched_chains[0] ?? null;

  const base_points = primary_chain
    ? collectChainPoints(primary_chain)
    : collectFallbackPoints(combined_text);

  // Retrieval must succeed before teacher backfills can be considered. A backfill
  // must never manufacture a course hit for an unrelated question.
  const injected_points = base_points.slice(0, MAX_INJECTED_POINTS);
  const injected_ids = new Set(injected_points.map((point) => point.id));

  const edges = injected_points.flatMap((point) =>
    point.prerequisites
      .filter((prerequisite) => injected_ids.has(prerequisite.id))
      .map((prerequisite) => ({
        from_id: prerequisite.id,
        to_id: point.id,
        reason: prerequisite.reason,
      })),
  );

  const seen_pitfalls = new Set<string>();
  const pitfalls: FaultPitfall[] = [];
  for (const pitfall of [...(primary_chain?.known_pitfalls ?? []), ...backfilled_pitfalls]) {
    if (!injected_ids.has(pitfall.point_id)) continue;
    const description = pitfall.description.trim();
    if (!description || description.length > MAX_PITFALL_LENGTH) continue;
    const key = `${pitfall.point_id}:${description.replace(/[\s，。；、,.;]/g, '').toLowerCase()}`;
    if (seen_pitfalls.has(key)) continue;
    seen_pitfalls.add(key);
    pitfalls.push({ ...pitfall, description });
    if (pitfalls.length === MAX_INJECTED_PITFALLS) break;
  }

  return { fault_chain: primary_chain, points: injected_points, edges, pitfalls };
}

/**
 * 取故障链的依赖链节点。
 *
 * 先按课程组排好的顺序取 chain_point_ids，再从入口节点上溯一层补齐遗漏的
 * 先修节点，保证链条不断在半路。
 *
 * @param fault_chain 命中的故障链
 * @returns 有序节点
 */
function collectChainPoints(fault_chain: FaultChain): GraphPoint[] {
  const ordered_points: GraphPoint[] = [];
  const seen_ids = new Set<string>();

  for (const point_id of [...fault_chain.entry_point_ids, ...fault_chain.chain_point_ids]) {
    if (seen_ids.has(point_id)) continue;
    const point = getPoint(point_id);
    if (!point) continue;
    seen_ids.add(point_id);
    ordered_points.push(point);
  }

  for (const point of collectPrerequisiteClosure(fault_chain.entry_point_ids, 1)) {
    if (seen_ids.has(point.id)) continue;
    seen_ids.add(point.id);
    ordered_points.push(point);
  }

  return ordered_points;
}

/**
 * 未命中故障链时的兜底：按文本检索节点，再上溯一层先修。
 *
 * @param query_text 学生输入
 * @returns 有序节点；检索不到时为空数组
 */
function collectFallbackPoints(query_text: string): GraphPoint[] {
  // Empty input previously matched every node because includes('') is true.
  if (query_text.trim().length < 2) return [];
  const hit_points = searchPointsByText(query_text.trim(), 4);
  if (hit_points.length === 0) return [];
  return collectPrerequisiteClosure(
    hit_points.map((point) => point.id),
    1,
  );
}

/**
 * 把检索结果渲染成提示词里的【知识约束】段。
 *
 * 只输出模型推理允许触碰的节点、依赖关系和已知易错点；不写结论、不写答案，
 * 结论由模型在这个范围内推。
 *
 * @param constraint 检索结果
 * @returns 可直接拼进 system 提示词的文本
 */
export function formatConstraintForPrompt(constraint: RetrievedConstraint): string {
  const sections: string[] = [];

  if (constraint.fault_chain) {
    sections.push(`现象初判方向：${constraint.fault_chain.name}`);
  }

  const node_lines = constraint.points.map((point) => {
    const description = point.description ? `：${point.description}` : '';
    return `- [${point.id}] ${point.name}（第${point.chapter}章）${description}`;
  });
  sections.push(`允许推理的知识节点（超出此范围的解释一律不要输出）：\n${node_lines.join('\n')}`);

  if (constraint.edges.length > 0) {
    const edge_lines = constraint.edges.map((edge) => {
      const reason = edge.reason ? `　依据：${edge.reason}` : '';
      return `- [${edge.to_id}] 依赖 [${edge.from_id}]${reason}`;
    });
    sections.push(`先修依赖链（排查顺序应沿依赖链从底层往上走）：\n${edge_lines.join('\n')}`);
  }

  if (constraint.pitfalls.length > 0) {
    const pitfall_lines = constraint.pitfalls.map(
      (pitfall) => `- [${pitfall.point_id}] ${pitfall.description}`,
    );
    sections.push(`本课程已知高频易错点：\n${pitfall_lines.join('\n')}`);
  }

  return sections.join('\n\n');
}
