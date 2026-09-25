export default function RegisterBits({
  point_ids,
}: {
  point_ids: readonly string[];
}) {
  const groups = [
    {
      point: "5.2.2",
      title: "IE · 中断允许",
      bits: [
        ["EA", "总允许"],
        ["ET0", "定时器0"],
        ["ET1", "定时器1"],
        ["EX0", "外中断0"],
      ],
    },
    {
      point: "6.1.3",
      title: "TCON · 启动与溢出",
      bits: [
        ["TR0", "T0 启动"],
        ["TF0", "T0 溢出"],
        ["TR1", "T1 启动"],
        ["TF1", "T1 溢出"],
      ],
    },
    {
      point: "6.1.2",
      title: "TMOD · 工作方式",
      bits: [
        ["M1", "方式高位"],
        ["M0", "方式低位"],
        ["C/T", "定时/计数"],
        ["GATE", "门控"],
      ],
    },
  ].filter((g) => point_ids.includes(g.point));
  if (!groups.length) return null;
  return (
    <section>
      <h3>寄存器参考</h3>
      <p className="muted">
        以下为 8051 常见寄存器位示意，请结合实际芯片手册和教师指导核对。
      </p>
      <div className="register-grid">
        {groups.map((g) => (
          <div key={g.point} className="task-card">
            <strong>{g.title}</strong>
            <div className="register-bits">
              {g.bits.map(([name, hint]) => (
                <div key={name}>
                  <code>{name}</code>
                  <span>{hint}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
