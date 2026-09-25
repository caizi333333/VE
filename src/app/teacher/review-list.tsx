"use client";
import { useEffect, useRef, useState } from "react";
import type {
  Assessment,
  AttemptView,
  Checkpoint,
  PracticeTaskView,
  TeacherDiagnosisView,
  TeacherListView,
} from "@/lib/api-types";
import {
  api,
  displayTime,
  errorText,
  statusLabel,
} from "@/components/client-api";
export default function ReviewList({
  data,
  primaryQueue,
  onPage,
  onRefresh,
  teacherName,
  onDirtyChange,
}: {
  data: TeacherListView;
  primaryQueue: boolean;
  onPage: (page: number) => void;
  onRefresh: () => Promise<void>;
  teacherName: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState("");
  const detailRef = useRef<HTMLDivElement>(null);
  const goToDetail = () => {
    const detail = detailRef.current;
    if (!detail) return;
    detail.focus({ preventScroll: true });
    detail.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };
  const [dirty, setLocalDirty] = useState(false);
  const setDirty = (value: boolean) => {
    setLocalDirty(value);
    onDirtyChange(value);
  };
  const item = data.items.find((d) => d.id === selected) ?? data.items[0];
  const change = (id: string) => {
    if (
      dirty &&
      !window.confirm("当前修改尚未保存，离开后会丢失。确定切换诊疗吗？")
    )
      return;
    setDirty(false);
    setSelected(id);
  };
  if (!data.items.length)
    return (
      <div className="empty">
        <h2>{primaryQueue ? "目前没有待处理诊疗" : "没有找到符合条件的诊疗"}</h2>
        <p>{primaryQueue ? "学生提交后会出现在这里。可切换到“全部记录”查看已处理内容。" : "请调整查询词、实验或状态。"}</p>
      </div>
    );
  return (
    <div className="review-layout">
      <aside className="card review-sidebar" style={{ padding: 0 }}>
        <div className="review-sidebar-head">
          <strong>{primaryQueue ? "待处理" : "诊疗记录"}</strong>
          <span className="muted"> · 共 {data.total} 条</span>
        </div>
        <div
          className="review-list"
          role="region"
          tabIndex={0}
          aria-label="诊疗待办列表，可上下滚动"
        >
          {data.items.map((d) => (
            <button
              key={d.id}
              className={`review-item ${d.id === item.id ? "selected" : ""}`}
              onClick={() => change(d.id)}
              aria-pressed={d.id === item.id}
              aria-controls="diagnosis-review-detail"
            >
              <div className="row between">
                <strong className="font-mono">{d.ticket}</strong>
                <span
                  className={`badge ${["pending_review", "manual_pending"].includes(d.status) || d.status === "released" && d.attempts.some(a => a.status === "submitted" && a.outcome === "resolved" && a.published_version === d.published_version) ? "pending" : "neutral"}`}
                >
                  {d.status === "released" && d.attempts.some(a => a.status === "submitted" && a.outcome === "resolved" && a.published_version === d.published_version) ? "待验证修订" : statusLabel(d.status)}
                </span>
              </div>
              {d.experiment_name && <span className="review-item-experiment">{d.experiment_name}</span>}
              <p>{/^实验[1-8]/.test(d.experiment_name) ? d.symptom : d.classification || d.symptom}</p>
              <div className="meta">
                <span>
                  {d.learner_number || "历史记录"}
                  {d.bench_label ? ` · ${d.bench_label}` : ""}
                </span>
                <span>{displayTime(d.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="pagination">
          <button
            className="btn"
            disabled={data.page <= 1}
            onClick={() => {
              if (!dirty || window.confirm("修改尚未保存，确定翻页吗？")) {
                setDirty(false);
                onPage(data.page - 1);
              }
            }}
          >
            上一页
          </button>
          <span className="muted">
            {data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))}
          </span>
          <button
            className="btn"
            disabled={data.page * data.page_size >= data.total}
            onClick={() => {
              if (!dirty || window.confirm("修改尚未保存，确定翻页吗？")) {
                setDirty(false);
                onPage(data.page + 1);
              }
            }}
          >
            下一页
          </button>
        </div>
        <div className="mobile-review-jump">
          <button
            className="btn primary"
            aria-controls="diagnosis-review-detail"
            onClick={goToDetail}
          >
            前往审核 · {item.ticket}
          </button>
        </div>
      </aside>
      <div
        ref={detailRef}
        id="diagnosis-review-detail"
        className="review-detail-anchor"
        tabIndex={-1}
        role="region"
        aria-label={`诊疗 ${item.ticket} 审核详情`}
      >
        <ReviewEditor
          key={`${item.id}-${item.version}`}
          item={item}
          teacherName={teacherName}
          onSaved={async () => {
            setDirty(false);
            await onRefresh();
          }}
          onDirty={setDirty}
        />
      </div>
    </div>
  );
}
function ReviewEditor({
  item,
  onSaved,
  onDirty,
  teacherName,
}: {
  item: TeacherDiagnosisView;
  onSaved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  teacherName: string;
}) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(
    item.checkpoints,
  );
  const [bridging, setBridging] = useState(item.bridging_task);
  const [comment, setComment] = useState(item.comment);
  const [tasks, setTasks] = useState<PracticeTaskView[]>(item.tasks);
  const [assessments, setAssessments] = useState<Assessment[]>(
    item.assessments.length
      ? item.assessments
      : item.rubric.map((r) => ({
          criterion_id: r.id,
          score: null,
          reason: "",
        })),
  );
  const [backfillPoint, setBackfillPoint] = useState("");
  const [backfill, setBackfill] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mark = () => {
    setDirty(true);
    onDirty(true);
    setMessage("");
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = async (action: "draft" | "release" | "reject") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/review", {
        diagnosis_id: item.id,
        expected_version: item.version,
        action,
        checkpoints,
        bridging_task: bridging,
        comment,
        tasks,
        assessments,
        ...(action === "release" && backfillPoint.trim() && backfill.trim()
          ? {
              backfill: {
                point_id: backfillPoint.trim(),
                description: backfill.trim(),
              },
            }
          : {}),
      });
      setDirty(false);
      onDirty(false);
      setMessage(
        action === "draft"
          ? "复核稿已保存。"
          : action === "release"
            ? "教师指导已发布到学生端。"
            : "已退回，请学生补充。",
      );
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const patchTask = (level: number, patch: Partial<PracticeTaskView>) => {
    setTasks((prev) =>
      prev.map((t) => (t.level === level ? { ...t, ...patch } : t)),
    );
    mark();
  };
  const patchScore = (id: string, patch: Partial<Assessment>) => {
    setAssessments((prev) =>
      prev.map((a) => (a.criterion_id === id ? { ...a, ...patch } : a)),
    );
    mark();
  };
  return (
    <article className="card review-editor">
      <div className="editor-head">
        <div>
          <span className="eyebrow">复核工作区</span>
          <h2 style={{ marginTop: 6 }}>
            {item.ticket} · {item.experiment_name || "历史待核实"}
          </h2>
          <p className="muted">
            学习编号 {item.learner_number || "未关联"} · 第 {item.round} 轮 ·
            当前版本 {item.version}
          </p>
        </div>
        <a className="btn quiet" href={`/api/export?kind=case&id=${item.id}`}>
          导出案例
        </a>
        <span className={`badge ${dirty ? "pending" : "neutral"}`}>
          {dirty ? "尚未保存" : "已载入复核稿"}
        </span>
      </div>
      <section className="editor-section">
        <h3>学生原始提交</h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{item.symptom}</p>
        {item.code && (
          <details open>
            <summary>查看提交代码</summary>
            <pre className="code-block">{item.code}</pre>
          </details>
        )}
      </section>
      {item.review_notes.length > 0 && (
        <div className="notice warning" style={{ marginTop: 20 }}>
          <strong>请重点核实</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {item.review_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <section className="editor-section">
        <details>
          <summary>对照模型初稿</summary>
          <ol style={{ paddingLeft: 24 }}>
            {item.original.checkpoints.map((c, i) => (
              <li key={i}>
                {c.instruction}
                <span className="muted">（{c.point_id}）</span>
              </li>
            ))}
          </ol>
          <p className="muted">
            原始补充练习：{item.original.bridging_task || "无"}
          </p>
          {item.ai_assessments.map((a, i) => (
            <p key={i} className="muted">
              {a.criterion_id}：{a.score ?? "未评分"} · {a.reason}
            </p>
          ))}
        </details>
      </section>
      <section className="editor-section">
        <div className="split-heading">
          <h3 style={{ margin: 0 }}>教师检查点</h3>
          <button
            className="btn quiet"
            onClick={() => {
              setCheckpoints((p) => [
                ...p,
                { id: crypto.randomUUID(), point_id: "", instruction: "" },
              ]);
              mark();
            }}
          >
            ＋ 添加检查点
          </button>
        </div>
        <p className="muted">
          先明确检查动作，再写观察标准；数值结论应与实验参数一致。
        </p>
        {checkpoints.map((c, i) => (
          <div key={c.id} className="checkpoint-editor">
            <label>
              知识点
              <input
                value={c.point_id}
                aria-label={`检查点${i + 1}知识点`}
                onChange={(e) => {
                  setCheckpoints((p) =>
                    p.map((x, n) =>
                      n === i ? { ...x, point_id: e.target.value } : x,
                    ),
                  );
                  mark();
                }}
              />
            </label>
            <label>
              检查 {i + 1}
              <textarea
                value={c.instruction}
                rows={3}
                aria-label={`检查点${i + 1}说明`}
                onChange={(e) => {
                  setCheckpoints((p) =>
                    p.map((x, n) =>
                      n === i ? { ...x, instruction: e.target.value } : x,
                    ),
                  );
                  mark();
                }}
              />
            </label>
            <button
              className="btn quiet"
              aria-label={`删除检查点${i + 1}`}
              style={{ marginTop: 28, padding: "9px 4px" }}
              onClick={() => {
                setCheckpoints((p) => p.filter((_, n) => n !== i));
                mark();
              }}
            >
              删除
            </button>
          </div>
        ))}
      </section>
      <section className="editor-section">
        <label>
          补充练习
          <textarea
            value={bridging}
            rows={3}
            onChange={(e) => {
              setBridging(e.target.value);
              mark();
            }}
          />
        </label>
      </section>
      <section className="editor-section">
        <h3>三级任务</h3>
        {([1, 2, 3] as const).map((level) => {
          const task = tasks.find((t) => t.level === level);
          return (
            <details key={level}>
              <summary>
                {level}. {["", "基础", "综合", "拓展"][level]}任务{" "}
                {task?.title ? `· ${task.title}` : ""}
              </summary>
              {task ? (
                <div className="field-grid">
                  <label className="full">
                    任务标题
                    <input
                      value={task.title}
                      onChange={(e) =>
                        patchTask(level, { title: e.target.value })
                      }
                    />
                  </label>
                  <label className="full">
                    任务说明
                    <textarea
                      rows={3}
                      value={task.instruction}
                      onChange={(e) =>
                        patchTask(level, { instruction: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    目标
                    <textarea
                      rows={2}
                      value={task.objective ?? ""}
                      onChange={(e) =>
                        patchTask(level, { objective: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    条件
                    <textarea
                      rows={2}
                      value={task.conditions ?? ""}
                      onChange={(e) =>
                        patchTask(level, { conditions: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    提交物
                    <textarea
                      rows={2}
                      value={task.deliverable ?? ""}
                      onChange={(e) =>
                        patchTask(level, { deliverable: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    验证办法
                    <textarea
                      rows={2}
                      value={task.verification ?? ""}
                      onChange={(e) =>
                        patchTask(level, { verification: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    关联知识点
                    <input
                      value={task.point_id}
                      onChange={(e) =>
                        patchTask(level, { point_id: e.target.value })
                      }
                    />
                  </label>
                </div>
              ) : (
                <button
                  className="btn"
                  onClick={() => {
                    setTasks((p) => [
                      ...p,
                      {
                        level,
                        title: "",
                        instruction: "",
                        point_id: checkpoints[0]?.point_id ?? "",
                        objective: "",
                        conditions: "",
                        deliverable: "",
                        verification: "",
                      },
                    ]);
                    mark();
                  }}
                >
                  配置本级任务
                </button>
              )}
            </details>
          );
        })}
        <p className="inline-help">
          任务依次开放。教师确认当前阶段验证通过后，学生才能进入下一级。
        </p>
      </section>
      <section className="editor-section">
        <h3>分项评价</h3>
        {item.rubric.length === 0 ? (
          <p className="notice warning">
            本实验尚未配置评分量规。请先在班级管理中设置，当前仅可作定性指导。
          </p>
        ) : (
          item.rubric.map((r) => {
            const a = assessments.find((x) => x.criterion_id === r.id);
            return (
              <details key={r.id}>
                <summary>
                  {r.label} · 满分 {r.max_score}
                </summary>
                <p className="muted" style={{ marginBottom: 12 }}>
                  {r.criterion}
                </p>
                <div className="score-grid">
                  <label>
                    分数
                    <input
                      type="number"
                      min={0}
                      max={r.max_score}
                      step="0.5"
                      value={a?.score ?? ""}
                      onChange={(e) =>
                        patchScore(r.id, {
                          score:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    评价依据
                    <textarea
                      rows={3}
                      value={a?.reason ?? ""}
                      onChange={(e) =>
                        patchScore(r.id, { reason: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    代码行
                    <input
                      type="number"
                      min={1}
                      value={a?.line_no ?? ""}
                      onChange={(e) =>
                        patchScore(r.id, {
                          line_no: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    关联知识点
                    <input
                      value={a?.point_id ?? ""}
                      onChange={(e) =>
                        patchScore(r.id, { point_id: e.target.value })
                      }
                    />
                  </label>
                  <label className="full">
                    问题类型
                    <input
                      value={a?.issue_type ?? ""}
                      onChange={(e) =>
                        patchScore(r.id, { issue_type: e.target.value })
                      }
                    />
                  </label>
                </div>
              </details>
            );
          })
        )}
      </section>
      <section className="editor-section">
        <label>
          给学生的复核意见
          <textarea
            rows={2}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              mark();
            }}
            placeholder="明确下一步检查或退回后需要补充的内容。"
          />
        </label>
        <details>
          <summary>回填相关易错点（选填）</summary>
          <div className="field-grid">
            <label>
              知识点编号
              <input
                value={backfillPoint}
                onChange={(e) => {
                  setBackfillPoint(e.target.value);
                  mark();
                }}
                placeholder="本次涉及的知识点"
              />
            </label>
            <label>
              易错点说明
              <textarea
                rows={2}
                value={backfill}
                onChange={(e) => {
                  setBackfill(e.target.value);
                  mark();
                }}
              />
            </label>
          </div>
        </details>
      </section>
      {item.attempts.length > 0 && (
        <section className="editor-section">
          <h3>学生验证记录</h3>
          {item.attempts.map((a) => (
            <AttemptReview
              key={`${a.id}-${a.status}`}
              attempt={a}
              item={item}
              disabled={dirty || busy}
              onSaved={onSaved}
            />
          ))}
        </section>
      )}
      {item.revisions.length > 0 && (
        <section className="editor-section">
          <details>
            <summary>复核历史（{item.revisions.length}）</summary>
            <ul>
              {item.revisions.map((r, i) => (
                <li key={i}>
                  版本 {r.version} ·{" "}
                  {{
                    draft: "保存复核稿",
                    release: "发布指导",
                    reject: "退回",
                    verify: "验证结果",
                  }[r.action] ?? r.action}{" "}
                  · {displayTime(r.created_at)}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      <div className="review-actions">
        {error && (
          <p className="notice error" role="alert" style={{ marginBottom: 12 }}>
            {error}
            <button className="btn quiet" onClick={() => void onSaved()}>
              重新载入最新版本
            </button>
          </p>
        )}
        {message && (
          <p className="notice" role="status" style={{ marginBottom: 12 }}>
            {message}
          </p>
        )}
        <p className="muted" style={{ marginBottom: 10 }}>
          复核教师：{teacherName} · {dirty ? "修改尚未保存" : "当前内容已载入"}
        </p>
        <div className="row">
          <button
            className="btn"
            disabled={busy || item.status === "generating"}
            onClick={() => void save("draft")}
          >
            {busy ? "处理中…" : "保存复核稿"}
          </button>
          <button
            className="btn primary"
            disabled={
              busy || item.status === "generating" || !checkpoints.length
            }
            onClick={() => void save("release")}
          >
            确认并发布
          </button>
          <button
            className="btn danger"
            disabled={busy || item.status === "generating"}
            onClick={() => void save("reject")}
          >
            退回补充
          </button>
        </div>
      </div>
    </article>
  );
}
function AttemptReview({
  attempt,
  item,
  onSaved,
  disabled,
}: {
  attempt: AttemptView;
  item: TeacherDiagnosisView;
  onSaved: () => Promise<void>;
  disabled: boolean;
}) {
  const [feedback, setFeedback] = useState(attempt.teacher_feedback);
  const [evidence, setEvidence] = useState(attempt.verification_evidence);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verify = async (status: "confirmed" | "needs_revision") => {
    setBusy(true);
    setError("");
    try {
      await api("/api/review", {
        diagnosis_id: item.id,
        expected_version: item.version,
        action: "verify",
        attempt_id: attempt.id,
        verification: { status, feedback, evidence },
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="attempt">
      <div className="row between">
        <strong>
          第 {attempt.level} 级 · 版本 {attempt.published_version}
        </strong>
        <span className="badge neutral">{statusLabel(attempt.status)}</span>
      </div>
      <p className="muted">
        {displayTime(attempt.created_at)} ·{" "}
        {attempt.outcome === "stuck"
          ? "学生求助"
          : attempt.outcome === "resolved"
            ? "学生自报解决"
            : "阶段记录"}
      </p>
      <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>
        {attempt.observation}
      </p>
      {attempt.code && (
        <details>
          <summary>查看修订代码</summary>
          <pre className="code-block">{attempt.code}</pre>
        </details>
      )}
      {attempt.status === "submitted" ? (
        <div className="stack-sm" style={{ marginTop: 14 }}>
          <label>
            教师反馈
            <textarea
              rows={2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <label>
            实际验证依据
            <textarea
              rows={2}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="填写实际检查方式、观测值或工具结果，勿将代码阅读等同于硬件运行验证。"
            />
          </label>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {disabled && (
            <p className="muted">请先保存上方复核稿，再确认验证结果。</p>
          )}
          <div className="row">
            <button
              className="btn primary"
              disabled={
                disabled || busy || !evidence.trim() || !feedback.trim()
              }
              onClick={() => void verify("confirmed")}
            >
              确认本级通过
            </button>
            <button
              className="btn"
              disabled={
                disabled || busy || !feedback.trim() || !evidence.trim()
              }
              onClick={() => void verify("needs_revision")}
            >
              反馈并要求修订
            </button>
          </div>
        </div>
      ) : (
        <div className="section-rule">
          <p>{attempt.teacher_feedback}</p>
          <p className="muted">
            验证依据：{attempt.verification_evidence || "未提供"}
          </p>
        </div>
      )}
    </article>
  );
}
