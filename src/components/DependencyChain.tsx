"use client";
import { useId } from "react";
import type { ConstraintEdgeView, ConstraintPointView } from "@/lib/api-types";
export default function DependencyChain({
  points,
  edges,
  highlight_ids = [],
}: {
  points: ConstraintPointView[];
  edges: ConstraintEdgeView[];
  highlight_ids?: readonly string[];
}) {
  const markerId = `edge-${useId().replace(/:/g, "")}`;
  const shown = points.slice(0, 24);
  const ids = new Set(shown.map((p) => p.id));
  const actual = edges.filter((e) => ids.has(e.from_id) && ids.has(e.to_id));
  const highlighted = new Set(highlight_ids);
  const names = new Map(points.map((p) => [p.id, p.name]));
  // Longest path in the acyclic portion. Cycles remain in a final column; only supplied edges are drawn.
  const ranks = new Map<string, number>();
  const pending = new Set(ids);
  let pass = 0;
  while (pending.size && pass++ < shown.length) {
    let advanced = false;
    for (const id of [...pending]) {
      const parents = actual.filter((e) => e.to_id === id && e.from_id !== id);
      if (parents.every((e) => ranks.has(e.from_id))) {
        ranks.set(
          id,
          parents.length
            ? Math.max(...parents.map((e) => ranks.get(e.from_id)!)) + 1
            : 0,
        );
        pending.delete(id);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  const finalRank = Math.max(0, ...ranks.values()) + 1;
  for (const id of pending) ranks.set(id, finalRank);
  const counts = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  shown.forEach((p) => {
    const r = ranks.get(p.id) ?? 0;
    const row = counts.get(r) ?? 0;
    counts.set(r, row + 1);
    positions.set(p.id, { x: 24 + r * 250, y: 24 + row * 132 });
  });
  const width = Math.max(550, Math.max(0, ...ranks.values()) * 250 + 230);
  const height = Math.max(150, Math.max(0, ...counts.values()) * 132 + 20);
  return (
    <section>
      <h2>相关知识与先修关系</h2>
      <p className="muted">
        本次涉及 {points.length} 个知识点、{edges.length} 条关系。图中显示{" "}
        {shown.length} 个节点及其间 {actual.length} 条实际关系
        {points.length > shown.length ? "，其余见关系列表" : ""}。
      </p>
      {shown.length > 0 ? (
        <div className="graph-area">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="知识依赖关系图，箭头由先修知识指向后续知识"
          >
            <defs>
              <marker
                id={markerId}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="#668675" />
              </marker>
            </defs>
            {actual.map((e, i) => {
              const a = positions.get(e.from_id)!;
              const b = positions.get(e.to_id)!;
              return (
                <path
                  key={`${e.from_id}-${e.to_id}-${i}`}
                  data-from={e.from_id}
                  data-to={e.to_id}
                  d={
                    a.x === b.x
                      ? `M${a.x + 196},${a.y + 40} C${a.x + 230},${a.y + 40} ${b.x + 230},${b.y + 65} ${b.x + 196},${b.y + 65}`
                      : `M${a.x + 196},${a.y + 44} C${a.x + 225},${a.y + 44} ${b.x - 30},${b.y + 44} ${b.x - 4},${b.y + 44}`
                  }
                  stroke="#668675"
                  strokeWidth="1.5"
                  fill="none"
                  markerEnd={`url(#${markerId})`}
                >
                  <title>
                    {names.get(e.from_id)} → {names.get(e.to_id)}：
                    {e.reason ?? "先修关系"}
                  </title>
                </path>
              );
            })}
            {shown.map((p) => {
              const at = positions.get(p.id)!;
              const on = highlighted.has(p.id);
              return (
                <g key={p.id}>
                  <title>
                    {p.id} {p.name}
                  </title>
                  <rect
                    x={at.x}
                    y={at.y}
                    width="196"
                    height="90"
                    rx="7"
                    fill={on ? "#e5f1e9" : "#fff"}
                    stroke={on ? "#366f52" : "#b6c9bb"}
                    strokeWidth={on ? 2 : 1}
                  />
                  <text
                    x={at.x + 13}
                    y={at.y + 25}
                    fontFamily="monospace"
                    fontSize="14"
                    fill="#486653"
                  >
                    {p.id}
                  </text>
                  {Array.from(
                    { length: Math.ceil(p.name.length / 12) },
                    (_, i) => p.name.slice(i * 12, (i + 1) * 12),
                  )
                    .slice(0, 3)
                    .map((t, i) => (
                      <text
                        key={i}
                        x={at.x + 13}
                        y={at.y + 47 + i * 17}
                        fontSize="14"
                        fill="#19322a"
                      >
                        {t}
                      </text>
                    ))}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <p className="muted">暂无关联节点。</p>
      )}
      <details>
        <summary>查看全部关系与节点名称</summary>
        <ul className="graph-relations">
          {edges.map((e, i) => (
            <li key={`${e.from_id}-${e.to_id}-${i}`}>
              <strong>{names.get(e.from_id) ?? e.from_id}</strong> →{" "}
              <strong>{names.get(e.to_id) ?? e.to_id}</strong>
              {e.reason && <p className="muted">{e.reason}</p>}
            </li>
          ))}
          {points
            .filter(
              (p) => !edges.some((e) => e.from_id === p.id || e.to_id === p.id),
            )
            .map((p) => (
              <li key={p.id}>
                {p.name}（{p.id}，本次无已知关系）
              </li>
            ))}
        </ul>
      </details>
    </section>
  );
}
