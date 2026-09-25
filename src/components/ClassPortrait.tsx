"use client";
import type { StatsView } from "@/lib/api-types";
import { statusLabel } from "@/components/client-api";
export default function ClassPortrait({
  stats,
  onRecord,
}: {
  stats: StatsView;
  onRecord: (ticket: string) => void;
}) {
  const c = stats.counts;
  const metrics = [
    [
      "诊疗提交",
      c.submissions,
      "筛选期间内发生的提交事件数，包含同一诊疗的多轮提交。",
    ],
    ["待审核", c.pending, "当前等待复核或人工处理的诊疗数。"],
    ["指导下发", c.released, "筛选期间内的教师下发事件数。"],
    ["学生求助", c.help, "筛选期间内学生提交的求助事件数。"],
    ["验证通过", c.verified, "筛选期间教师确认的任务验证次数。"],
    [
      "有效参与编号",
      c.participants,
      "班级内启用且已确认实际参与的匿名学习编号数。",
    ],
    [
      "教师确认完成",
      c.completed_learners,
      "已完成三级任务并经教师确认的有效学习编号数，按编号去重。",
    ],
    [
      "完成比例",
      stats.completion_rate === null
        ? "待核对"
        : `${(stats.completion_rate * 100).toFixed(1)}%`,
      `${c.completed_learners} 个教师确认完成编号 ÷ ${c.participants} 个有效参与编号。`,
    ],
  ] as const;
  return (
    <div className="stack">
      <div className="notice">
        统计口径：当前班级
        {stats.from ? `，${stats.from} 至 ${stats.to ?? "当前"}` : "，全部时间"}
        。
        {stats.data_source === "classroom"
          ? "来源为课堂记录。"
          : `来源为${{ demo: "演示", test: "测试", legacy_unknown: "历史待核实" }[stats.data_source] ?? stats.data_source}记录，不作为真实课堂成效。`}
        提交次数、任务验证次数和去重编号分别统计。
      </div>
      <dl className="stat-grid">
        {metrics.map(([label, value, definition]) => (
          <div className="stat" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <details>
              <summary className="muted">查看口径</summary>
              <p className="muted">{definition}</p>
            </details>
          </div>
        ))}
      </dl>
      {!stats.participation_confirmed && (
        <p className="notice warning">
          参与人数尚未由教师核对，完成比例暂不发布。请先在班级管理中核对实际参与编号。
        </p>
      )}
      <div className="grid-two">
        <section className="card">
          <h2>指导等待时间</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            以提交至首次教师下发的时间差计算；样本{" "}
            {stats.feedback_minutes.count} 条。
          </p>
          <p style={{ marginTop: 16 }}>
            中位数：
            <strong>
              {stats.feedback_minutes.median === null
                ? "暂无"
                : `${stats.feedback_minutes.median.toFixed(1)} 分钟`}
            </strong>
          </p>
          <p>
            90%分位：
            <strong>
              {stats.feedback_minutes.p90 === null
                ? "暂无"
                : `${stats.feedback_minutes.p90.toFixed(1)} 分钟`}
            </strong>
          </p>
        </section>
        <section className="card">
          <h2>教师与初评的一致情况</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            基于有对应分项分数的初评与教师复核，共{" "}
            {stats.assessment_agreement.total} 项。
          </p>
          <p style={{ marginTop: 16 }}>
            同分项：{stats.assessment_agreement.matched} /{" "}
            {stats.assessment_agreement.total}
          </p>
          <p>
            平均绝对分差：
            {stats.assessment_agreement.mean_absolute_score_difference === null
              ? "暂无"
              : stats.assessment_agreement.mean_absolute_score_difference.toFixed(
                  2,
                )}{" "}
            分
          </p>
          <p className="inline-help">
            此项反映评分一致情况，不表示代码运行正确率。
          </p>
        </section>
      </div>
      <section className="card">
        <h2>教师确认的知识点问题</h2>
        <p className="muted" style={{ margin: "8px 0 16px" }}>
          只依据教师确认的评价问题统计；不使用检索频次推断掌握程度。
        </p>
        {stats.nodes.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>知识点</th>
                  <th>确认问题数</th>
                  <th>对应诊疗</th>
                </tr>
              </thead>
              <tbody>
                {stats.nodes.map((n) => (
                  <tr key={n.point_id}>
                    <td>
                      {n.name} <span className="muted">{n.point_id}</span>
                    </td>
                    <td>{n.confirmed_errors}</td>
                    <td>
                      {n.diagnosis_ids.map((id) => {
                        const record = stats.records.find((r) => r.id === id);
                        return record ? (
                          <button
                            key={id}
                            className="record-link"
                            style={{ marginRight: 12 }}
                            onClick={() => onRecord(record.ticket)}
                          >
                            {record.ticket}
                          </button>
                        ) : (
                          <span key={id} className="muted">
                            记录 {id.slice(-6)}{" "}
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">暂没有教师确认的知识点问题记录。</p>
        )}
      </section>
      <section className="card">
        <h2>统计范围内的诊疗记录</h2>
        <p className="muted" style={{ margin: "8px 0 16px" }}>
          共 {stats.records.length} 条诊疗，按单号回查原始内容与验证结果。
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>单号</th>
                <th>学习编号</th>
                <th>实验</th>
                <th>当前状态</th>
                <th>教师确认完成</th>
              </tr>
            </thead>
            <tbody>
              {stats.records.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="record-link font-mono"
                      onClick={() => onRecord(r.ticket)}
                    >
                      {r.ticket}
                    </button>
                  </td>
                  <td>{r.learner_number || "未关联"}</td>
                  <td>{r.experiment_name}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td>{r.completed ? "已确认" : "尚未确认"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
