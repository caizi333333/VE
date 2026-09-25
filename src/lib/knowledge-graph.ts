/**
 * 课程知识图谱的读取与依赖链上溯。
 *
 * 数据来自 data/kg-8051.json，由 scripts/export-kg.ts 从芯智育才平台只读导出。
 * 本模块是"图谱约束"的实现处：先把学生现象落到具体节点，再沿 prerequisites
 * 上溯取出先修依赖链，作为大模型推理的允许范围。
 */

import kg_data from '../../data/kg-8051.json';

export interface GraphPrerequisite {
  id: string;
  name: string;
  /** 这条依赖边为什么成立，来自课程组编写的一句话机制依据。 */
  reason: string | null;
}

export interface GraphPoint {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  chapter: number;
  parent_id: string | null;
  description: string | null;
  common_mistake: string | null;
  prerequisites: GraphPrerequisite[];
  applied_in: string[];
}

export interface GraphMeta {
  source: string;
  chip: string;
  course: string;
  exported_at: string;
  counts: {
    points: number;
    prerequisite_edges: number;
    cross_chapter_edges: number;
    edges_with_reason: number;
  };
}

const graph_points = kg_data.points as GraphPoint[];
const point_index = new Map(graph_points.map((point) => [point.id, point]));

export const GRAPH_META = kg_data.meta as unknown as GraphMeta;

/**
 * 按 id 取知识节点。
 *
 * @param point_id 节点编号，如 '5.2.2'
 * @returns 节点，不存在时返回 undefined
 */
export function getPoint(point_id: string): GraphPoint | undefined {
  return point_index.get(point_id);
}

/**
 * 沿 prerequisites 上溯，取出一个节点的先修依赖闭包。
 *
 * 复杂度 O(V+E)，V、E 为可达子图的节点与边数；用 visited 集合防环。
 * 上溯深度可限，避免把整章都拉进提示词——层数越深与当前故障越无关。
 *
 * @param start_point_ids 起点节点编号
 * @param max_depth 最大上溯层数，默认 2
 * @returns 依赖闭包内的节点，按"离起点近的在前"排序
 */
export function collectPrerequisiteClosure(
  start_point_ids: readonly string[],
  max_depth = 2,
): GraphPoint[] {
  const visited = new Set<string>();
  const collected: GraphPoint[] = [];
  let current_layer = start_point_ids.filter((id) => point_index.has(id));

  for (const point_id of current_layer) {
    visited.add(point_id);
    const point = point_index.get(point_id);
    if (point) collected.push(point);
  }

  for (let depth = 0; depth < max_depth; depth += 1) {
    const next_layer: string[] = [];
    for (const point_id of current_layer) {
      const point = point_index.get(point_id);
      if (!point) continue;
      for (const prerequisite of point.prerequisites) {
        if (visited.has(prerequisite.id)) continue;
        visited.add(prerequisite.id);
        const prerequisite_point = point_index.get(prerequisite.id);
        if (prerequisite_point) {
          collected.push(prerequisite_point);
          next_layer.push(prerequisite.id);
        }
      }
    }
    if (next_layer.length === 0) break;
    current_layer = next_layer;
  }

  return collected;
}

/**
 * 取一条依赖边的成立依据。
 *
 * 源数据没有写依据的边返回 null，调用处不得自行补写理由。
 *
 * @param point_id 下游节点
 * @param prerequisite_id 上游前置节点
 * @returns 一句话机制依据，或 null
 */
export function getEdgeReason(point_id: string, prerequisite_id: string): string | null {
  const point = point_index.get(point_id);
  if (!point) return null;
  return point.prerequisites.find((edge) => edge.id === prerequisite_id)?.reason ?? null;
}

/**
 * 关键词命中知识节点，用于未匹配到故障链时的兜底检索。
 *
 * 只按节点名与描述做包含匹配，命中即返回；不做模糊扩展，避免把无关节点
 * 包装成"相关推荐"。
 *
 * @param query_text 学生输入文本
 * @param limit 最多返回几个节点
 * @returns 命中的节点
 */
export function searchPointsByText(query_text: string, limit = 6): GraphPoint[] {
  const normalized_query = query_text.toLowerCase();
  const hits: GraphPoint[] = [];

  for (const point of graph_points) {
    const haystack = `${point.name}${point.description ?? ''}`.toLowerCase();
    const name_hit = normalized_query.includes(point.name.toLowerCase()) && point.name.length >= 2;
    const term_hit = point.name.length >= 3 && haystack.includes(normalized_query.slice(0, 12));
    if (name_hit || term_hit) {
      hits.push(point);
      if (hits.length >= limit) break;
    }
  }

  return hits;
}
