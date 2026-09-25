"use client";
import { useState } from "react";
import type {
  ClassroomView,
  DataSource,
  ExperimentView,
} from "@/lib/api-types";
import { api, errorText } from "@/components/client-api";
import ExperimentEditor from "@/components/ExperimentEditor";
const sourceLabel: Record<DataSource, string> = {
  classroom: "课堂数据",
  demo: "演示数据",
  test: "测试数据",
  legacy_unknown: "历史待核实",
};
export default function ClassroomManager({
  classrooms,
  selectedId,
  onSelect,
  onRefresh,
}: {
  classrooms: ClassroomView[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"classroom" | "demo">("demo");
  const [reviewReference, setReviewReference] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ExperimentView | "new" | null>(null);
  const selected = classrooms.find((c) => c.id === selectedId);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ classroom: ClassroomView }>("/api/classrooms", {
        action: "create",
        name,
        data_source: source,
        review_reference: reviewReference,
      });
      await onRefresh();
      onSelect(r.classroom.id);
      setName("");
      setReviewReference("");
      setCreateOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="row between">
        <label style={{ maxWidth: 400, flex: 1 }}>
          管理班级
          <select
            value={selectedId}
            onChange={(e) => {
              onSelect(e.target.value);
              setEditing(null);
            }}
          >
            <option value="">选择班级</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {sourceLabel[c.data_source]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn primary"
          onClick={() => setCreateOpen(!createOpen)}
        >
          {createOpen ? "收起新建" : "＋ 新建班级"}
        </button>
      </div>
      {createOpen && (
        <form className="card stack" onSubmit={create}>
          <h2>建立实验课堂</h2>
          <div className="field-grid">
            <label>
              班级名称
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </label>
            <label>
              数据用途
              <select
                value={source}
                onChange={(e) =>
                  setSource(e.target.value as "classroom" | "demo")
                }
              >
                <option value="demo">演示 · 试用功能，不计课堂成效</option>
                <option value="classroom">课堂 · 真实教学记录</option>
              </select>
            </label>
            <label className="full">
              内容审查记录
              <textarea
                rows={2}
                value={reviewReference}
                onChange={(e) => setReviewReference(e.target.value)}
                placeholder="真实课堂请填写学院要求的审查记录编号、日期或材料说明"
              />
            </label>
          </div>
          <p className="muted">
            演示和课堂数据分别记录。真实课堂在填写内容审查记录后才允许提交诊疗。
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn primary"
            disabled={busy}
            style={{ alignSelf: "start" }}
          >
            {busy ? "正在创建…" : "创建班级"}
          </button>
        </form>
      )}
      {selected ? (
        <>
          <ClassroomDetail
            key={selected.id}
            classroom={selected}
            onRefresh={onRefresh}
          />
          <section className="card">
            <div className="split-heading">
              <div>
                <h2>实验配置</h2>
                <p className="muted">每个实验独立确认硬件参数和评分量规。</p>
              </div>
              <button className="btn" onClick={() => setEditing("new")}>
                ＋ 配置实验
              </button>
            </div>
            {selected.experiments.length ? (
              <div className="stack-sm">
                {selected.experiments.map((e) => (
                  <div className="task-card" key={e.id}>
                    <div className="row between">
                      <div>
                        <strong>{e.name}</strong>
                        <p className="muted">
                          {e.config.chip || "芯片待确认"} · 版本 {e.version}
                        </p>
                      </div>
                      <div className="row">
                        <span
                          className={`badge ${e.confirmed ? "" : "pending"}`}
                        >
                          {e.confirmed ? "已确认" : "待确认"}
                        </span>
                        <button className="btn" onClick={() => setEditing(e)}>
                          编辑配置
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">还没有实验。请配置中断、串口或定时实验。</p>
            )}
          </section>
          {editing && (
            <ExperimentEditor
              key={editing === "new" ? `new-${selected.id}` : editing.id}
              classroomId={selected.id}
              experiment={editing === "new" ? undefined : editing}
              onSaved={async () => {
                await onRefresh();
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </>
      ) : (
        !createOpen && (
          <div className="empty">
            <h2>建立你的第一个实验课堂</h2>
            <p>先以演示用途试用平台；准备好配置和审查材料后再建立真实课堂。</p>
          </div>
        )
      )}
    </div>
  );
}
function ClassroomDetail({
  classroom: c,
  onRefresh,
}: {
  classroom: ClassroomView;
  onRefresh: () => Promise<void>;
}) {
  const [review, setReview] = useState(c.review_reference);
  const [count, setCount] = useState(1);
  const [cards, setCards] = useState<
    { number: string; recovery_code: string }[]
  >([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const action = async (body: unknown) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/classrooms", body);
      await onRefresh();
      setMessage("班级设置已更新。");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const issue = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await api<{
        cards: { number: string; recovery_code: string }[];
        class_code: string;
      }>("/api/classrooms", { action: "issue", classroom_id: c.id, count });
      setCards(r.cards);
      setCode(r.class_code);
      await onRefresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const content =
      "班级码,匿名学习编号,私密恢复码\n" +
      cards.map((x) => `${code},${x.number},${x.recovery_code}`).join("\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "learning-cards.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <section className="card">
        <div className="split-heading">
          <div>
            <h2>{c.name}</h2>
            <p className="muted">
              班级码 <strong className="font-mono">{c.join_code}</strong> ·{" "}
              <span className="badge neutral">
                {sourceLabel[c.data_source]}
              </span>
            </p>
          </div>
          <span className={`badge ${c.join_open ? "" : "pending"}`}>
            {c.join_open ? "允许加入" : "已关闭加入"}
          </span>
        </div>
        <div className="row">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void action({
                action: "update",
                classroom_id: c.id,
                join_open: !c.join_open,
              })
            }
          >
            {c.join_open ? "关闭加入" : "开放加入"}
          </button>
          <button
            className="btn quiet"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "更换后，旧班级码不能用于再次加入。已登录会话不受影响。确认更换吗？",
                )
              )
                void action({
                  action: "update",
                  classroom_id: c.id,
                  rotate_code: true,
                });
            }}
          >
            更换班级码
          </button>
        </div>
        <div className="section-rule">
          <label>
            学院内容审查记录
            <textarea
              value={review}
              rows={2}
              onChange={(e) => setReview(e.target.value)}
              placeholder="审查记录编号、日期及材料说明；请填写真实已完成的审查。"
            />
          </label>
          <button
            className="btn"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() =>
              void action({
                action: "update",
                classroom_id: c.id,
                review_reference: review,
              })
            }
          >
            保存审查记录
          </button>
        </div>
        {error && (
          <p className="notice error" role="alert" style={{ marginTop: 16 }}>
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status" style={{ marginTop: 16 }}>
            {message}
          </p>
        )}
      </section>
      <section className="card">
        <div className="split-heading">
          <div>
            <h2>匿名学习卡</h2>
            <p className="muted">
              每位实际参与者一张。私密恢复码仅在发放时显示，下载后分别交给对应学生。
            </p>
          </div>
        </div>
        <div className="row">
          <label style={{ width: 145 }}>
            本次发放数量
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button
            className="btn primary"
            disabled={busy || count < 1 || count > 200 || cards.length > 0}
            style={{ alignSelf: "end" }}
            onClick={() => void issue()}
          >
            生成学习卡
          </button>
          <p className="muted" style={{ alignSelf: "end", paddingBottom: 10 }}>
            已发放 {c.learners.length} 张
          </p>
        </div>
        {cards.length > 0 && (
          <div className="section-rule">
            <div className="notice warning">
              以下恢复码仅显示本次。请先下载保存，再关闭。不要将包含所有恢复码的文件公开给学生。
            </div>
            <div className="row" style={{ margin: "16px 0" }}>
              <button className="btn primary" onClick={download}>
                下载学习卡 CSV
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (
                    window.confirm(
                      "确认已安全保存本次恢复码？关闭后无法再次查看。",
                    )
                  )
                    setCards([]);
                }}
              >
                已保存，关闭恢复码
              </button>
            </div>
            <div className="secret-cards">
              {cards.map((card) => (
                <div className="secret-card" key={card.number}>
                  <strong>{card.number}</strong>
                  <br />
                  班级码：{code}
                  <br />
                  恢复码：
                  <span style={{ overflowWrap: "anywhere" }}>
                    {card.recovery_code}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <div className="split-heading">
          <div>
            <h2>参与情况核对</h2>
            <p className="muted">
              有效参与人数只统计“启用且实际参与”的编号。核对完毕后再确认分母。
            </p>
          </div>
          <span
            className={`badge ${c.participation_confirmed ? "" : "pending"}`}
          >
            {c.participation_confirmed ? "已核对" : "待核对"}
          </span>
        </div>
        {c.learners.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>学习编号</th>
                    <th>启用</th>
                    <th>实际参与</th>
                  </tr>
                </thead>
                <tbody>
                  {c.learners.map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono">{l.number}</td>
                      <td>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            aria-label={`${l.number}启用`}
                            checked={l.active}
                            disabled={busy}
                            onChange={(e) =>
                              void action({
                                action: "learner",
                                classroom_id: c.id,
                                learner_id: l.id,
                                active: e.target.checked,
                              })
                            }
                          />
                          {l.active ? "有效" : "停用"}
                        </label>
                      </td>
                      <td>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            aria-label={`${l.number}实际参与`}
                            checked={l.participated}
                            disabled={busy}
                            onChange={(e) =>
                              void action({
                                action: "learner",
                                classroom_id: c.id,
                                learner_id: l.id,
                                participated: e.target.checked,
                              })
                            }
                          />
                          {l.participated ? "已参与" : "未确认"}
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <span>
                有效参与{" "}
                {c.learners.filter((l) => l.active && l.participated).length} 人
              </span>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void action({
                    action: "update",
                    classroom_id: c.id,
                    participation_confirmed: true,
                  })
                }
              >
                确认参与人数
              </button>
            </div>
          </>
        ) : (
          <p className="empty">发放学习卡后，可在这里核对实际参与情况。</p>
        )}
      </section>
    </>
  );
}
