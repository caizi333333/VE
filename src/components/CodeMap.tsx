import type { CodeMapHitView } from "@/lib/api-types";
export default function CodeMap({ hits }: { hits: CodeMapHitView[] }) {
  if (!hits.length) return null;
  return (
    <section>
      <h3>代码对应的知识点</h3>
      <p className="muted">依据寄存器关键词定位，不能单独判断程序是否正确。</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>位置</th>
              <th>代码</th>
              <th>知识点</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h, i) => (
              <tr key={`${h.line_no}-${h.point_id}-${i}`}>
                <td>L{h.line_no}</td>
                <td>
                  <code>{h.text}</code>
                </td>
                <td>
                  {h.point_id} {h.label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
