/**
 * 从芯智育才平台只读导出 8051 课程知识图谱，作为本项目的图谱约束底座。
 *
 * 迁移底座口径（申报书）：已有平台不重复建设，只取其课程知识数据；
 * 本脚本全程只读，不写入、不修改源仓库任何文件。
 *
 * 用法：npm run export:kg
 * 输出：data/kg-8051.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  knowledgePoints,
  getPrerequisiteReason,
  knowledgePointStats,
  knowledgeRelationStats,
  type KnowledgePoint,
} from '../../../../EduCog-Micro/src/lib/knowledge-points.ts';

const SOURCE_REPO = 'EduCog-Micro/src/lib/knowledge-points.ts';
const script_dir = dirname(fileURLToPath(import.meta.url));
const output_path = resolve(script_dir, '../data/kg-8051.json');

/** 导出后的依赖边：指向前置节点，并带上这条边为什么成立。 */
interface ExportedPrerequisite {
  id: string;
  name: string;
  /** 课程组编写的一句话机制依据；源数据没有就留空，不在这里编。 */
  reason: string | null;
}

interface ExportedPoint {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  chapter: number;
  parent_id: string | null;
  description: string | null;
  /** 学生常踩的坑，来自源数据 tutor.commonMistake。 */
  common_mistake: string | null;
  prerequisites: ExportedPrerequisite[];
  applied_in: string[];
}

/**
 * 把一个源知识点转成导出格式，并逐条解析其前置依赖的成立依据。
 *
 * @param point 源知识点
 * @param name_by_id 全量 id→名称索引，用于给依赖边补可读名称
 * @returns 导出格式的知识点
 */
function toExportedPoint(
  point: KnowledgePoint,
  name_by_id: ReadonlyMap<string, string>,
): ExportedPoint {
  const prerequisites = (point.prerequisites ?? []).map((prereq_id) => ({
    id: prereq_id,
    name: name_by_id.get(prereq_id) ?? prereq_id,
    reason: getPrerequisiteReason(point.id, prereq_id) ?? null,
  }));

  return {
    id: point.id,
    name: point.name,
    level: point.level,
    chapter: point.chapter,
    parent_id: point.parentId ?? null,
    description: point.description ?? null,
    common_mistake: point.tutor?.commonMistake ?? null,
    prerequisites,
    applied_in: [...(point.appliedIn ?? [])],
  };
}

function main(): void {
  const name_by_id = new Map(knowledgePoints.map((point) => [point.id, point.name]));
  const exported_points = knowledgePoints.map((point) => toExportedPoint(point, name_by_id));

  const dangling_edges = exported_points.flatMap((point) =>
    point.prerequisites
      .filter((prereq) => !name_by_id.has(prereq.id))
      .map((prereq) => `${point.id} -> ${prereq.id}`),
  );
  if (dangling_edges.length > 0) {
    throw new Error(`依赖边指向不存在的节点：${dangling_edges.join(', ')}`);
  }

  const edges_with_reason = exported_points.reduce(
    (sum, point) => sum + point.prerequisites.filter((prereq) => prereq.reason !== null).length,
    0,
  );

  const payload = {
    meta: {
      source: SOURCE_REPO,
      source_access: 'read-only',
      chip: '89C51 / 8051',
      course: '微控制器原理及应用技术',
      exported_at: new Date().toISOString(),
      counts: {
        points: knowledgePointStats.total,
        level1: knowledgePointStats.level1,
        level2: knowledgePointStats.level2,
        level3: knowledgePointStats.level3,
        prerequisite_edges: knowledgeRelationStats.prerequisiteEdges,
        cross_chapter_edges: knowledgeRelationStats.crossChapterEdges,
        edges_with_reason: edges_with_reason,
      },
    },
    points: exported_points,
  };

  mkdirSync(dirname(output_path), { recursive: true });
  writeFileSync(output_path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`已导出 ${payload.meta.counts.points} 个知识点 -> ${output_path}`);
  console.log(
    `依赖边 ${payload.meta.counts.prerequisite_edges} 条，其中 ${edges_with_reason} 条带课程逻辑依据，` +
      `跨章 ${payload.meta.counts.cross_chapter_edges} 条`,
  );
}

main();
