/**
 * 每个实验在课程知识图谱中的位置切片。
 *
 * 仅供服务端与脚本使用，不要 import 进客户端组件——本模块会连带
 * kg-8051.json 全量数据。学生页只读取 scripts/build-lab-graph.ts 生成的
 * lab-graph-slices.json 小切片。
 *
 * 切片内容：实验锚点节点（lab-guides.pointId）、锚点的直接先修边
 * （含课程组编写的依据）、与本实验相关的故障专项。没有对应专项的实验
 * 如实写"走教师人工复核"，不虚报覆盖。
 */

import { LAB_GUIDES } from './lab-guides';
import { FAULT_CHAINS, getFaultChainById } from './fault-chains';
import { getPoint } from './knowledge-graph';
import kg_data from '../../data/kg-8051.json';

export interface LabGraphAnchor {
  id: string;
  name: string;
  chapter: number;
  description: string | null;
}

export interface LabGraphPrerequisite {
  id: string;
  name: string;
  /** 课程组编写的依赖成立依据；源数据没有就保持 null，不补写。 */
  reason: string | null;
}

export interface LabGraphSlice {
  anchor: LabGraphAnchor | null;
  prerequisites: LabGraphPrerequisite[];
  chains: { id: string; name: string }[];
  /** 该实验无对应专项时给学生的诚实说明。 */
  note: string | null;
}

export interface LabGraphSlices {
  generated_from: {
    kg_source: string;
    points: number;
    prerequisite_edges: number;
    exported_at: string;
  };
  labs: Record<string, LabGraphSlice>;
}

/** 实验与故障专项的对应关系；只写有真实关联的，未列出即无专项。 */
const LAB_RELATED_CHAINS: Readonly<Record<number, readonly string[]>> = {
  3: ['timer-isr-not-entered', 'timing-inaccurate'],
  5: ['timing-inaccurate'],
  7: ['timing-inaccurate'],
};

/** 实验四是外部中断 INT0，与 T0 定时中断是两回事，须单独说明不混判。 */
const LAB_GRAPH_NOTES: Readonly<Record<number, string>> = {
  4: '本实验是外部中断 INT0（P3.2 按键）；平台“定时器中断不触发”专项只针对 T0，不会把 INT0 误判成定时中断。本实验求助仍走教师人工复核。',
};

const NO_CHAIN_NOTE =
  '本实验暂无对应故障专项；求助进入教师待办，按所选方向生成检查点草稿，教师复核后下发。';

/**
 * 按实验生成图谱切片。
 *
 * @returns 以实验编号为键的切片表；锚点缺失时 anchor 为 null 并在校验中报出
 */
export function buildLabGraphSlices(): LabGraphSlices {
  const labs: Record<string, LabGraphSlice> = {};

  for (const guide of LAB_GUIDES) {
    const anchor_point = getPoint(guide.pointId);
    const anchor: LabGraphAnchor | null = anchor_point
      ? {
          id: anchor_point.id,
          name: anchor_point.name,
          chapter: anchor_point.chapter,
          description: anchor_point.description,
        }
      : null;

    const prerequisites: LabGraphPrerequisite[] = (anchor_point?.prerequisites ?? []).map(
      (edge) => ({
        id: edge.id,
        name: getPoint(edge.id)?.name ?? edge.id,
        reason: edge.reason,
      }),
    );

    const chains = (LAB_RELATED_CHAINS[guide.id] ?? [])
      .map((chain_id) => getFaultChainById(chain_id))
      .filter((chain): chain is NonNullable<typeof chain> => Boolean(chain))
      .map((chain) => ({ id: chain.id, name: chain.name }));

    labs[String(guide.id)] = {
      anchor,
      prerequisites,
      chains,
      note: LAB_GRAPH_NOTES[guide.id] ?? (chains.length === 0 ? NO_CHAIN_NOTE : null),
    };
  }

  return {
    generated_from: {
      kg_source: kg_data.meta.source,
      points: kg_data.meta.counts.points,
      prerequisite_edges: kg_data.meta.counts.prerequisite_edges,
      exported_at: kg_data.meta.exported_at,
    },
    labs,
  };
}

/**
 * 校验切片与源图谱、源数据一致。返回问题清单；空数组表示通过。
 *
 * @param slices 待校验的切片（通常读自已生成的 JSON 文件）
 */
export function validateLabGraphSlices(slices: LabGraphSlices): string[] {
  const problems: string[] = [];
  const fresh = buildLabGraphSlices();
  const valid_chain_ids = new Set(FAULT_CHAINS.map((chain) => chain.id));

  if (slices.generated_from.exported_at !== kg_data.meta.exported_at) {
    problems.push('切片与当前图谱导出版本不一致，需重跑 build:lab-graph');
  }

  for (const guide of LAB_GUIDES) {
    const key = String(guide.id);
    const slice = slices.labs[key];
    const expected = fresh.labs[key];
    if (!slice) {
      problems.push(`实验${key}缺切片`);
      continue;
    }
    if (JSON.stringify(slice.anchor) !== JSON.stringify(expected.anchor)) {
      problems.push(`实验${key}锚点与 lab-guides.pointId/图谱不一致`);
    }
    if (JSON.stringify(slice.prerequisites) !== JSON.stringify(expected.prerequisites)) {
      problems.push(`实验${key}先修边与图谱不一致，需重跑 build:lab-graph`);
    }
    for (const chain of slice.chains) {
      if (!valid_chain_ids.has(chain.id)) problems.push(`实验${key}引用不存在的专项 ${chain.id}`);
      if (getFaultChainById(chain.id)?.name !== chain.name) {
        problems.push(`实验${key}专项 ${chain.id} 名称与故障链库不一致`);
      }
    }
    if (guide.diagnosis && !slice.chains.some((chain) => chain.id === guide.diagnosis)) {
      problems.push(`实验${key} diagnosis=${guide.diagnosis} 未在切片专项中出现`);
    }
  }

  return problems;
}
