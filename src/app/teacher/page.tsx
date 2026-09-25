"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  ClassroomView,
  SessionView,
  StatsView,
  TeacherListView,
} from "@/lib/api-types";
import { api, errorText } from "@/components/client-api";
import ReviewList from "./review-list";
import ClassroomManager from "@/components/ClassroomManager";
import ClassPortrait from "@/components/ClassPortrait";
import MaterialLibrary from "@/components/MaterialLibrary";
import { LAB_GUIDES } from "@/lib/lab-guides";
type Tab = "review" | "classroom" | "materials" | "stats";
export default function TeacherPage() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [classrooms, setClassrooms] = useState<ClassroomView[]>([]);
  const [classroomId, setClassroomId] = useState("");
  const [experimentId, setExperimentId] = useState("");
  const [status, setStatus] = useState("needs_action");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("review");
  const [materialLab, setMaterialLab] = useState(1);
  const [data, setData] = useState<TeacherListView | null>(null);
  const [stats, setStats] = useState<StatsView | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const classroom = classrooms.find((c) => c.id === classroomId);
  const loadClasses = useCallback(async () => {
    const value = await api<{ classrooms: ClassroomView[] }>("/api/classrooms");
    setClassrooms(value.classrooms);
    setClassroomId((id) =>
      value.classrooms.some((c) => c.id === id)
        ? id
        : (value.classrooms.find((c) => c.data_source === "classroom")?.id ??
          value.classrooms[0]?.id ??
          ""),
    );
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const s = await api<SessionView>("/api/session");
        setSession(s);
        if (s.teacher) await loadClasses();
      } catch (e) {
        setError(errorText(e));
      } finally {
        setReady(true);
      }
    })();
  }, [loadClasses]);
  const loadData = useCallback(async () => {
    if (!session?.teacher || !classroomId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ classroom_id: classroomId });
      if (experimentId.startsWith("lab-")) params.set("lab_id", experimentId.slice(4));
      else if (experimentId) params.set("experiment_id", experimentId);
      if (tab === "review") {
        if (status) params.set("status", status);
        if (search) params.set("q", search);
        params.set("page", String(page));
        setData(await api<TeacherListView>(`/api/teacher/diagnoses?${params}`));
      } else if (tab === "stats") {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        setStats(await api<StatsView>(`/api/teacher/stats?${params}`));
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [
    session?.teacher,
    classroomId,
    experimentId,
    tab,
    status,
    search,
    page,
    from,
    to,
  ]);
  useEffect(() => {
    void loadData();
  }, [loadData]);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/session", { action: "login", username, password });
      setPassword("");
      setSession(await api<SessionView>("/api/session"));
      await loadClasses();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const canLeave = () =>
    !dirty || window.confirm("复核稿尚未保存，切换后修改会丢失。确认继续吗？");
  const changeTab = (next: Tab) => {
    if (!canLeave()) return;
    setDirty(false);
    setTab(next);
    setError("");
  };
  const chooseClass = (id: string) => {
    if (!canLeave()) return;
    setDirty(false);
    setClassroomId(id);
    setExperimentId("");
    setPage(1);
    setData(null);
    setStats(null);
  };
  const exportQuery = new URLSearchParams({
    kind: "weekly-log",
    classroom_id: classroomId,
    ...(experimentId.startsWith("lab-") ? { lab_id: experimentId.slice(4) } : experimentId ? { experiment_id: experimentId } : {}),
    from,
    to,
  });
  if (!ready)
    return (
      <div className="loading" role="status">
        正在载入教师工作台…
      </div>
    );
  if (!session?.teacher)
    return (
      <div className="auth-layout auth-simple">
        <section className="card form-card">
          <span className="eyebrow">教师工作台</span>
          <h1>登录后处理学生求助</h1>
          <p className="muted auth-explainer">查看待复核诊疗、确认实验记录，并发布指导。</p>
          <form onSubmit={login} className="stack">
            <label>
              教师用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              {busy ? "正在登录…" : "进入教师工作台"}
            </button>
            <p className="muted">教师账号由平台管理员创建；班级码用于学生加入课堂。</p>
          </form>
        </section>
      </div>
    );
  return (
    <>
      <div className="page-head teacher-page-head">
        <div>
          <span className="eyebrow">教师工作台 · {session.teacher.name}</span>
          <h1 style={{ marginTop: 6 }}>{tab === "review" ? "处理实验求助" : tab === "classroom" ? "管理班级与实验" : tab === "materials" ? "维护实验资料" : "查看课堂记录"}</h1>
          <p className="muted">{tab === "review" ? "先核对学生现象，再保存或发布指导。" : tab === "classroom" ? "配置课堂、发放匿名学习卡。" : tab === "materials" ? "按实验上传资料，核对后开放给本班学生。" : "按事件记录查看实际发生的教学过程。"}</p>
        </div>
        <button
          className="btn quiet"
          onClick={async () => {
            if (!canLeave()) return;
            try {
              await api("/api/session", { action: "logout" });
              setSession(null);
              setData(null);
              setStats(null);
              setDirty(false);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          退出登录
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="教师工作区">
        {(
          [
            ["review", "处理求助"],
            ["classroom", "班级设置"],
            ["materials", "实验资料"],
            ["stats", "课堂记录"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => changeTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="notice error" role="alert" style={{ marginBottom: 20 }}>
          {error}
        </p>
      )}
      {tab === "classroom" ? (
        <ClassroomManager
          classrooms={classrooms}
          selectedId={classroomId}
          onSelect={chooseClass}
          onRefresh={loadClasses}
        />
      ) : tab === "materials" ? (
        <section className="teacher-materials-workspace">
          <div className="teacher-courseware-link"><div><strong>六件原理课件</strong><span>可逐步演示中断、定时、串口等控制关系；发布前请核对本班器件与参数。</span></div><Link className="btn" href="/courseware/interrupt">预览课件 ↗</Link></div>
          <div className="teacher-materials-bar"><label>班级<select value={classroomId} onChange={e => chooseClass(e.target.value)}><option value="">选择班级</option>{classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>实验<select value={materialLab} onChange={e => setMaterialLab(Number(e.target.value))}>{LAB_GUIDES.map(lab => <option key={lab.id} value={lab.id}>实验{lab.id} · {lab.title}</option>)}</select></label></div>
          {classroomId ? <MaterialLibrary classroomId={classroomId} labId={materialLab} teacher /> : <div className="empty">先选择班级，再维护该班实验资料。</div>}
        </section>
      ) : (
        <>
          <section className="card teacher-filter-panel teacher-simple-toolbar" style={{ marginBottom: 18 }}>
            <div className="teacher-toolbar-main">
              <label>
                班级
                <select
                  value={classroomId}
                  onChange={(e) => chooseClass(e.target.value)}
                >
                  <option value="">选择班级</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（
                      {
                        {
                          classroom: "课堂",
                          demo: "演示",
                          test: "测试",
                          legacy_unknown: "历史待核实",
                        }[c.data_source]
                      }
                      ）
                    </option>
                  ))}
                </select>
              </label>
              {tab === "review" ? (
                  <form
                    className="search-field teacher-search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!canLeave()) return;
                      setDirty(false);
                      setSearch(query.trim());
                      setStatus(query.trim() ? "" : "needs_action");
                      setPage(1);
                    }}
                  >
                    <label>
                      找一条诊疗
                      <div className="search-row">
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="单号、工位或学习编号"
                        />
                        <button className="btn search-button">查询</button>
                      </div>
                    </label>
                  </form>
              ) : (
                <>
                  <label>
                    开始日期
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    结束日期
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </>
              )}
              <button
                className="btn quiet toolbar-refresh"
                disabled={loading || !classroomId}
                onClick={() => {
                  if (canLeave()) { setDirty(false); void loadData(); }
                }}
              >{loading ? "刷新中…" : "刷新"}</button>
            </div>
            {tab === "review" ? <div className="teacher-toolbar-extra">
              <div className="teacher-view-buttons" aria-label="诊疗范围">
                <button type="button" className={`btn ${status === "needs_action" && !search ? "selected" : "quiet"}`} onClick={() => {
                  if (!canLeave()) return; setDirty(false); setStatus("needs_action"); setSearch(""); setQuery(""); setPage(1);
                }}>待处理</button>
                <button type="button" className={`btn ${status === "" && !search ? "selected" : "quiet"}`} onClick={() => {
                  if (!canLeave()) return; setDirty(false); setStatus(""); setSearch(""); setQuery(""); setPage(1);
                }}>全部记录</button>
                {search && <button type="button" className="btn quiet" onClick={() => { setQuery(""); setSearch(""); setStatus("needs_action"); setPage(1); }}>清除查询</button>}
              </div>
              <details className="teacher-more-filters">
                <summary>按实验或状态筛选{experimentId ? " · 已选实验" : ""}{status && status !== "needs_action" ? " · 已选状态" : ""}</summary>
                <div className="teacher-more-fields">
                  <label>实验
                    <select value={experimentId} onChange={(e) => {
                      if (!canLeave()) return; setDirty(false); setExperimentId(e.target.value); setPage(1);
                    }}>
                      <option value="">全部实验</option>
                      {LAB_GUIDES.map((guide) => <option value={`lab-${guide.id}`} key={`lab-${guide.id}`}>实验{guide.id} · {guide.title}</option>)}
                      {classroom?.experiments.map((e) => <option value={e.id} key={e.id}>{e.name}</option>)}
                    </select>
                  </label>
                  <label>状态
                    <select value={status} onChange={(e) => {
                      if (!canLeave()) return; setDirty(false); setStatus(e.target.value); setPage(1);
                    }}>
                      <option value="needs_action">待处理</option>
                      <option value="">全部状态</option>
                      <option value="pending_review">待复核</option>
                      <option value="manual_pending">待人工处理</option>
                      <option value="needs_verification">待验证修订</option>
                      <option value="released">已发布</option>
                      <option value="rejected">已退回</option>
                      <option value="generating">生成中</option>
                    </select>
                  </label>
                </div>
              </details>
            </div> : <div className="teacher-toolbar-extra">
              <p className="muted">日期按北京时间计算；留空查看全部记录。</p>
              {from && to && <a href={`/api/export?${exportQuery}`} className="btn">导出该时段日志</a>}
            </div>}
          </section>
          {!classroomId ? (
            <div className="empty">
              <h2>先建立实验课堂</h2>
              <p>配置班级和实验，向学生发放匿名学习卡后开始试用。</p>
              <button
                className="btn primary"
                style={{ marginTop: 20 }}
                onClick={() => changeTab("classroom")}
              >
                前往班级管理
              </button>
            </div>
          ) : tab === "review" ? (
            data ? (
              <ReviewList
                data={data}
                primaryQueue={status === "needs_action" && !search}
                teacherName={session.teacher.name}
                onPage={setPage}
                onRefresh={loadData}
                onDirtyChange={setDirty}
              />
            ) : (
              <div className="loading" role="status">
                正在获取诊疗记录…
              </div>
            )
          ) : stats ? (
            <ClassPortrait
              stats={stats}
              onRecord={(ticket) => {
                setQuery(ticket);
                setSearch(ticket);
                setStatus("");
                setPage(1);
                changeTab("review");
              }}
            />
          ) : (
            <div className="loading" role="status">
              正在核算课堂记录…
            </div>
          )}
        </>
      )}
    </>
  );
}
