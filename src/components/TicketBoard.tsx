"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CodeMap from "@/components/CodeMap";
import DependencyChain from "@/components/DependencyChain";
import RegisterBits from "@/components/RegisterBits";
import {
  api,
  displayTime,
  errorText,
  statusLabel,
} from "@/components/client-api";
import { REDACTION_RULE_LABELS, type TicketView } from "@/lib/api-types";
import { redactSubmission } from "@/lib/redact";
export default function TicketBoard({
  view,
  onRefresh,
  onRevise,
}: {
  view: TicketView;
  onRefresh: (view: TicketView) => void;
  onRevise: () => void;
}) {
  const [ticks, setTicks] = useState<string[]>([]);
  const [observation, setObservation] = useState("");
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [key, setKey] = useState("");
  const [refreshPending, setRefreshPending] = useState(false);
  const identityHits = useMemo(
    () => redactSubmission(observation, code).hits,
    [observation, code],
  );
  const initialized = useRef("");
  useEffect(() => {
    const identity = `${view.id}:${view.published_version}:${view.active_task_level ?? 1}`;
    if (initialized.current === identity) return;
    initialized.current = identity;
    const latest = (view.attempts ?? [])
      .filter(
        (attempt) =>
          attempt.published_version === view.published_version &&
          attempt.level === (view.active_task_level ?? 1),
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    const validIds = new Set(
      view.released?.checkpoints.map((checkpoint) => checkpoint.id) ?? [],
    );
    setTicks((latest?.ticks ?? []).filter((id) => validIds.has(id)));
    setObservation("");
    setCode("");
    setOutcome("checking");
    setKey("");
    setRefreshPending(false);
    setMessage("");
    setError("");
  }, [
    view.id,
    view.published_version,
    view.active_task_level,
    view.attempts,
    view.released,
  ]);
  const refreshSubmittedTicket = async () => {
    const updated = await api<TicketView>(
      `/api/ticket/${encodeURIComponent(view.ticket)}`,
    );
    onRefresh(updated);
    setMessage("验证记录已提交，等待教师确认。");
    setRefreshPending(false);
    setKey("");
    setObservation("");
    setCode("");
  };
  const retryRefresh = async () => {
    setBusy(true);
    setError("");
    try {
      await refreshSubmittedTicket();
    } catch (err) {
      setError(
        `验证记录已经提交，刷新暂未成功。原填写内容已保留。${errorText(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (refreshPending) return;
    if (identityHits.length) {
      setError("检测到疑似身份信息，请删除后提交。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const id = key || crypto.randomUUID();
    setKey(id);
    let accepted = false;
    try {
      await api<{ ok: boolean }>(`/api/ticket/${view.ticket}/progress`, {
        published_version: view.published_version,
        ticks,
        outcome,
        observation,
        code,
        level: view.active_task_level ?? 1,
        idempotency_key: id,
      });
      accepted = true;
      setRefreshPending(true);
      await refreshSubmittedTicket();
    } catch (err) {
      setError(
        accepted
          ? `验证记录已经提交，刷新暂未成功。请点击“刷新已提交记录”；原填写内容已保留。${errorText(err)}`
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  };
  const released = view.status === "released" && view.released;
  const checkpoints = released ? view.released!.checkpoints : [];
  return (
    <div className="stack">
      <section className="card">
        <div className="row between">
          <div>
            <p className="muted">诊疗单号 · 第 {view.round} 轮</p>
            <p className="ticket-number">{view.ticket}</p>
          </div>
          <span
            className={`badge ${["pending_review", "manual_pending", "generating"].includes(view.status) ? "pending" : view.status === "rejected" ? "danger" : ""}`}
          >
            {statusLabel(view.status)}
          </span>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          {view.experiment_name}
          {view.bench_label ? ` · 工位 ${view.bench_label}` : ""} ·{" "}
          {displayTime(view.created_at)}
        </p>
        {!released && (
          <div className="section-rule">
            <h2>
              {view.status === "rejected"
                ? "请补充实验信息"
                : view.status === "manual_pending"
                  ? "教师将人工处理本次问题"
                  : "已收到，等待教师审核"}
            </h2>
            <p className="muted" style={{ marginTop: 8 }}>
              {view.status === "rejected"
                ? "补充现象、相关代码或已做过的检查，再提交给教师。"
                : "审核通过后，这里会显示检查顺序和实训任务。页面会自动更新，请保留单号。"}
            </p>
            {view.status === "rejected" && (
              <button
                className="btn primary"
                onClick={onRevise}
                style={{ marginTop: 16 }}
              >
                补充后重新提交
              </button>
            )}
          </div>
        )}
        {released && (
          <p className="notice" style={{ marginTop: 16 }}>
            {view.released!.reviewer} 已发布第 {view.published_version} 版指导。
            {view.released!.comment || "按以下检查点操作，并提交实际观察结果。"}
          </p>
        )}
        {view.completed_at && (
          <p className="notice" style={{ marginTop: 12 }}>
            教师已确认完成本次实验。确认时间：{displayTime(view.completed_at)}
          </p>
        )}
      </section>
      {released && (
        <>
          <section className="card">
            <div className="split-heading">
              <h2>按顺序检查</h2>
              <span className="muted">
                已检查 {ticks.length} / {checkpoints.length}
              </span>
            </div>
            <ol className="checkpoint-list">
              {checkpoints.map((p, i) => (
                <li key={p.id}>
                  <label className="checkpoint">
                    <input
                      type="checkbox"
                      disabled={busy || refreshPending}
                      checked={ticks.includes(p.id)}
                      onChange={(e) => {
                        setTicks((prev) =>
                          e.target.checked
                            ? [...prev, p.id]
                            : prev.filter((id) => id !== p.id),
                        );
                        setKey("");
                      }}
                    />
                    <span>
                      <strong>{i + 1}. </strong>
                      {p.instruction}
                      <small
                        className="muted"
                        style={{ display: "block", marginTop: 5 }}
                      >
                        关联知识点 {p.point_id}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ol>
            {view.released!.bridging_task && (
              <p className="notice">补充练习：{view.released!.bridging_task}</p>
            )}
          </section>
          {(view.practice_tasks ?? []).length > 0 && (
            <section className="card">
              <div className="split-heading">
                <h2>本阶段练习</h2>
                <span className="badge">
                  第 {view.active_task_level ?? 1} 级
                </span>
              </div>
              <div className="stack-sm">
                {(view.practice_tasks ?? [])
                  .filter((t) => t.unlocked !== false)
                  .map((t) => (
                    <article key={t.level} className="task-card">
                      <span className="eyebrow">
                        {["", "基础", "综合", "拓展"][t.level]}任务
                      </span>
                      <h3 style={{ marginTop: 6 }}>{t.title}</h3>
                      <p style={{ marginTop: 8 }}>{t.instruction}</p>
                      <dl>
                        {[
                          ["目标", t.objective],
                          ["条件", t.conditions],
                          ["提交物", t.deliverable],
                          ["验证办法", t.verification],
                        ]
                          .filter(([, v]) => v)
                          .map(([k, v]) => (
                            <div style={{ display: "contents" }} key={k}>
                              <dt>{k}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                      </dl>
                    </article>
                  ))}
              </div>
              <p className="inline-help">
                当前阶段经教师确认通过后，才能进入下一阶段。遇到困难时可提交求助记录。
              </p>
            </section>
          )}
          <section className="card">
            <h2>记录检查与修订结果</h2>
            <p className="muted" style={{ margin: "8px 0 20px" }}>
              写下实际看到的现象。勾选检查点和自报解决均不代表教师已确认完成。
            </p>
            <form onSubmit={submit} className="stack">
              <label>
                当前结果
                <select
                  value={outcome}
                  disabled={busy || refreshPending}
                  onChange={(e) => {
                    setOutcome(e.target.value);
                    setKey("");
                  }}
                >
                  <option value="checking">检查中，提交阶段记录</option>
                  <option value="stuck">仍有困难，需要教师帮助</option>
                  <option value="resolved">我已解决，申请教师验证</option>
                </select>
              </label>
              <label>
                观察与验证结果
                <textarea
                  value={observation}
                  disabled={busy || refreshPending}
                  onChange={(e) => {
                    setObservation(e.target.value);
                    setKey("");
                  }}
                  rows={3}
                  required
                  minLength={3}
                  maxLength={4000}
                  placeholder="描述检查前后变化、测量值、工具输出或仍然存在的问题。"
                />
              </label>
              <label>
                修改后的代码（如有）
                <textarea
                  className="code-input"
                  value={code}
                  disabled={busy || refreshPending}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setKey("");
                  }}
                  rows={6}
                  spellCheck={false}
                  maxLength={8000}
                  placeholder="只填写与本次修订相关的代码。"
                />
              </label>
              {identityHits.length > 0 && (
                <p className="notice error" role="alert">
                  检测到疑似身份信息：
                  {identityHits
                    .map(
                      (hit) =>
                        `${REDACTION_RULE_LABELS[hit.rule] ?? "身份信息"}（${hit.count}处）`,
                    )
                    .join("、")}
                  。请删除后提交。系统不会改写你正在编辑的内容。
                </p>
              )}
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="notice" role="status">
                  {message}
                </p>
              )}
              <div className="row">
                {refreshPending ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void retryRefresh()}
                  >
                    {busy ? "正在刷新…" : "刷新已提交记录"}
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    disabled={busy || identityHits.length > 0}
                  >
                    {busy ? "正在提交…" : "提交验证记录"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn quiet"
                  disabled={busy || refreshPending}
                  onClick={onRevise}
                >
                  补充问题，重新诊疗
                </button>
              </div>
            </form>
          </section>
          {!!view.released!.assessments.length && (
            <details className="card">
              <summary>教师确认的代码评价</summary>
              <div className="stack-sm" style={{ marginTop: 12 }}>
                {view.released!.assessments.map((a, i) => {
                  const criterion = view.rubric?.find(
                    (r) => r.id === a.criterion_id,
                  );
                  return (
                    <div key={`${a.criterion_id}-${i}`} className="task-card">
                      <div className="row between">
                        <strong>{criterion?.label ?? `评价项 ${i + 1}`}</strong>
                        <span className="badge neutral">
                          {a.score === null ? "暂不评分" : `${a.score} 分`}
                          {criterion ? ` / 满分 ${criterion.max_score}` : ""}
                        </span>
                      </div>
                      <p style={{ marginTop: 8 }}>{a.reason}</p>
                      {(a.line_no || a.point_id) && (
                        <p className="muted">
                          {a.line_no ? `代码第 ${a.line_no} 行　` : ""}
                          {a.point_id ? `知识点 ${a.point_id}` : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="inline-help">
                代码评价仅适用于已提交的片段；实际运行情况以验证记录为准。
              </p>
            </details>
          )}
          <details className="card">
            <summary>查看知识图谱、寄存器参考与代码定位</summary>
            <div className="stack" style={{ paddingTop: 16 }}>
              {view.constraint && (
                <DependencyChain
                  points={view.constraint.points}
                  edges={view.constraint.edges}
                  highlight_ids={checkpoints.map((c) => c.point_id)}
                />
              )}
              <RegisterBits point_ids={checkpoints.map((c) => c.point_id)} />
              <CodeMap hits={view.code_map ?? []} />
            </div>
          </details>
          {!!view.attempts?.length && (
            <details className="card" open>
              <summary>本次诊疗的验证记录（{view.attempts.length}）</summary>
              <div style={{ paddingTop: 12 }}>
                {view.attempts.map((a) => (
                  <article className="attempt" key={a.id}>
                    <div className="row between">
                      <strong>
                        第 {a.level} 级 · 指导版本 {a.published_version}
                      </strong>
                      <span
                        className={`badge ${a.status === "submitted" ? "pending" : ""}`}
                      >
                        {statusLabel(a.status)}
                      </span>
                    </div>
                    <p className="muted">
                      {displayTime(a.created_at)} ·{" "}
                      {{
                        resolved: "学生自报解决",
                        stuck: "学生求助",
                        checking: "阶段记录",
                      }[a.outcome] ?? a.outcome}
                    </p>
                    <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>
                      {a.observation}
                    </p>
                    {a.code && (
                      <details>
                        <summary>本次提交的代码</summary>
                        <pre className="code-block">{a.code}</pre>
                      </details>
                    )}
                    {a.teacher_feedback && (
                      <p className="notice" style={{ marginTop: 12 }}>
                        教师反馈：{a.teacher_feedback}
                      </p>
                    )}
                    {a.verification_evidence && (
                      <p className="muted" style={{ marginTop: 8 }}>
                        验证依据：{a.verification_evidence}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
