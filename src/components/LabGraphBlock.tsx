import labGraphSlices from "@/lib/lab-graph-slices.json";

type LabGraphSliceData = (typeof labGraphSlices.labs)[keyof typeof labGraphSlices.labs];

/**
 * 实验指导页中的图谱区块：显示本实验在课程知识图谱中的锚点、
 * 直接先修关系（含课程组依据）和相关故障专项。数据来自
 * scripts/build-lab-graph.ts 生成的切片，图谱源为“芯智育才”只读导出。
 * 没有对应专项的实验如实显示说明，不暗示已覆盖。
 */
export default function LabGraphBlock({ labId }: { labId: number }) {
  const slice = labGraphSlices.labs[String(labId) as keyof typeof labGraphSlices.labs] as LabGraphSliceData | undefined;
  if (!slice?.anchor) return null;
  return (
    <details className="lab-graph">
      <summary>本实验在课程知识图谱中的位置</summary>
      <div className="lab-graph-body">
        <div className="lab-graph-anchor">
          <span className="eyebrow">锚点知识点</span>
          <strong>[{slice.anchor.id}] {slice.anchor.name}（第{slice.anchor.chapter}章）</strong>
          {slice.anchor.description && <p>{slice.anchor.description}</p>}
        </div>
        {slice.prerequisites.length > 0 && (
          <div className="lab-graph-prereqs">
            <span>先修关系（排查时先核对前置）</span>
            <ul>
              {slice.prerequisites.map((prerequisite) => (
                <li key={prerequisite.id}>
                  <strong>[{prerequisite.id}] {prerequisite.name}</strong>
                  {prerequisite.reason && <p className="muted">{prerequisite.reason}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {slice.chains.length > 0 && (
          <p className="lab-graph-chains">
            相关故障专项：{slice.chains.map((chain) => chain.name).join("、")}。遇到这类现象时，可从下方“故障专项诊疗”入口沿图谱依赖链排查。
          </p>
        )}
        {slice.note && <p className="muted">{slice.note}</p>}
        <p className="lab-graph-source muted">
          图谱来自“芯智育才”平台只读导出：{labGraphSlices.generated_from.points} 个知识点、{labGraphSlices.generated_from.prerequisite_edges} 条先修关系，导出时间 {labGraphSlices.generated_from.exported_at.slice(0, 10)}。
        </p>
      </div>
    </details>
  );
}
