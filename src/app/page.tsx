"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import LoopRail, { type LoopStep } from "@/components/LoopRail";
import TicketBoard from "@/components/TicketBoard";
import LabVisual from "@/components/LabVisual";
import MaterialLibrary from "@/components/MaterialLibrary";
import { api, errorText } from "@/components/client-api";
import { redactSubmission } from "@/lib/redact";
import { REDACTION_RULE_LABELS } from "@/lib/api-types";
import { LAB_GUIDES, LAB_PPT_NOTES, LAB_REPORT_TITLES, labGuide } from "@/lib/lab-guides";
import AssemblyDebugger from "@/components/AssemblyDebugger";
import { coursewareForLab } from "@/lib/courseware";
import type {
  SessionView,
  ExperimentView,
  TicketView,
  DiagnoseResponse,
} from "@/lib/api-types";
interface VoiceRecognizer {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
export default function StudentPage() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [ready, setReady] = useState(false);
  const [experiments, setExperiments] = useState<ExperimentView[]>([]);
  const [experimentId, setExperimentId] = useState("");
  const [labId, setLabId] = useState(1);
  const [issueType, setIssueType] = useState<"wiring" | "code" | "result" | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [classCode, setClassCode] = useState("");
  const [number, setNumber] = useState("");
  const [recovery, setRecovery] = useState("");
  const [symptom, setSymptom] = useState("");
  const [code, setCode] = useState("");
  const [bench, setBench] = useState("");
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [lookup, setLookup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const recognition = useRef<{ start: () => void; stop: () => void } | null>(null);
  const labNav = useRef<HTMLDivElement | null>(null);
  const guide = labGuide(labId);
  const selectLab = (id: number) => {
    if (!labGuide(id)) return;
    setLabId(id);
    setIssueType(null);
    setSymptom("");
    setCode("");
    setRequestKey("");
    const url = new URL(window.location.href);
    url.searchParams.set("lab", String(id));
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    window.requestAnimationFrame(() => document.getElementById("lab-guide")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  };
  const issueOptions = guide ? [
    { id: "wiring" as const, label: "接线或器件", checks: guide.wiring },
    { id: "code" as const, label: "代码或编译", checks: guide.code },
    { id: "result" as const, label: "结果与预期不符", checks: guide.resultChecks },
  ] : [];
  const selectedIssue = issueOptions.find((item) => item.id === issueType);
  const identityHits = useMemo(
    () => redactSubmission(symptom, code).hits,
    [symptom, code],
  );
  const experiment = experiments.find((e) => e.id === experimentId);
  useEffect(() => {
    const requestedLab = Number(new URLSearchParams(window.location.search).get("lab"));
    if (Number.isInteger(requestedLab) && labGuide(requestedLab)) setLabId(requestedLab);
  }, []);
  useEffect(() => {
    const nav = labNav.current;
    const selected = nav?.querySelector<HTMLElement>(`[data-lab-id="${labId}"]`);
    if (nav && selected) nav.scrollTo({ left: selected.offsetLeft - nav.offsetLeft - (nav.clientWidth - selected.clientWidth) / 2, behavior: "auto" });
  }, [labId, session, ready]);
  useEffect(() => {
    const browser = window as Window & {
      SpeechRecognition?: new () => VoiceRecognizer;
      webkitSpeechRecognition?: new () => VoiceRecognizer;
    };
    setVoiceSupported(Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition));
    return () => recognition.current?.stop();
  }, []);
  const toggleVoice = () => {
    if (listening) { recognition.current?.stop(); return; }
    const browser = window as Window & {
      SpeechRecognition?: new () => VoiceRecognizer;
      webkitSpeechRecognition?: new () => VoiceRecognizer;
    };
    const Engine = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Engine) return;
    try {
      const engine = new Engine();
      engine.lang = "zh-CN";
      engine.interimResults = false;
      engine.onresult = (event) => {
        const words = Array.from(event.results).map((item) => item[0]?.transcript ?? "").join("").trim();
        if (words) { setSymptom((old) => [old.trim(), words].filter(Boolean).join("；").slice(0, 2000)); setRequestKey(""); }
      };
      engine.onerror = () => { setListening(false); setError("语音识别未成功，可直接键入现象。"); };
      engine.onend = () => setListening(false);
      recognition.current = engine;
      engine.start();
      setListening(true);
    } catch { setListening(false); setError("当前浏览器无法启动语音识别，请键入现象。"); }
  };
  const current = useMemo<LoopStep>(
    () =>
      !ticket
        ? "submit"
        : ["generating", "pending_review", "manual_pending"].includes(
              ticket.status,
            )
          ? "wait"
          : ticket.status === "rejected"
            ? "submit"
            : ticket.completed_at || (ticket.active_task_level ?? 1) > 1
              ? "task"
              : ticket.attempts?.length
                ? "report"
                : "probe",
    [ticket],
  );
  const loadTicket = useCallback(async (id: string, quiet = false) => {
    try {
      const value = await api<TicketView>(
        `/api/ticket/${encodeURIComponent(id.trim().toUpperCase())}`,
      );
      setTicket(value);
      if (value.lab_id) setLabId(value.lab_id);
      if (value.experiment_id) setExperimentId(value.experiment_id);
      setLookup(value.ticket);
      setRevision(false);
      setIssueType(null);
      const url = new URL(window.location.href);
      url.searchParams.set("t", value.ticket);
      window.history.replaceState(null, "", url);
      return true;
    } catch (e) {
      if (!quiet) setError(errorText(e));
      return false;
    }
  }, []);
  const loadSession = useCallback(async () => {
    const s = await api<SessionView>("/api/session");
    setSession(s);
    if (s.learner) {
      const data = await api<{ experiments: ExperimentView[] }>(
        "/api/experiments",
      );
      setExperiments(data.experiments);
      setExperimentId((prev) =>
        data.experiments.some((e) => e.id === prev)
          ? prev
          : (data.experiments[0]?.id ?? ""),
      );
      return true;
    }
    return false;
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        if (await loadSession()) {
          const t = new URLSearchParams(window.location.search).get("t");
          if (t) await loadTicket(t);
        }
      } catch (e) {
        setError(errorText(e));
      } finally {
        setReady(true);
      }
    })();
  }, [loadSession, loadTicket]);
  const pollingTicket = ticket?.ticket;
  const pollingStatus = ticket?.status;
  useEffect(() => {
    if (
      revision ||
      !pollingTicket ||
      !pollingStatus ||
      !["generating", "pending_review", "manual_pending", "released"].includes(
        pollingStatus,
      )
    )
      return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadTicket(pollingTicket, true);
    }, 8000);
    return () => clearInterval(timer);
  }, [pollingTicket, pollingStatus, revision, loadTicket]);
  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/join", {
        class_code: classCode.trim().toUpperCase(),
        learner_number: number.trim(),
        recovery_code: recovery.trim(),
      });
      setRecovery("");
      await loadSession();
      const t = new URLSearchParams(window.location.search).get("t");
      if (t) await loadTicket(t);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      await api("/api/session", { action: "logout" });
      setSession(null);
      setTicket(null);
      setExperiments([]);
      window.history.replaceState(null, "", "/");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!guide && !experiment) return;
    const submittedSymptom = guide && selectedIssue ? `实验${guide.id}｜${selectedIssue.label}：${symptom.trim()}` : symptom.trim();
    if (submittedSymptom.length > 2000) {
      setError("现象描述过长，请精简后再提交。");
      return;
    }
    if (identityHits.length) {
      setError("检测到疑似身份信息，请删除后提交。");
      return;
    }
    setBusy(true);
    setError("");
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    try {
      const result = await api<DiagnoseResponse>(guide ? "/api/lab-help" : "/api/diagnose", {
        ...(guide ? { lab_id: guide.id } : { experiment_id: experiment!.id }),
        ...(guide && selectedIssue ? { issue_type: selectedIssue.id } : {}),
        symptom: submittedSymptom,
        code,
        bench_label: bench,
        idempotency_key: key,
        ...(revision && ticket
          ? { ticket: ticket.ticket, expected_version: ticket.version }
          : {}),
      });
      setLookup(result.ticket);
      if (await loadTicket(result.ticket, true)) {
        setRequestKey("");
        setSymptom("");
        setCode("");
      } else {
        setError(
          `诊疗 ${result.ticket} 已受理，读取暂未成功。原填写内容和提交标识已保留，可重试提交或在下方按单号查看。`,
        );
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const startNew = () => {
    setTicket(null);
    setRevision(false);
    setIssueType(null);
    setRequestKey("");
    setSymptom("");
    setCode("");
    setError("");
    window.history.replaceState(null, "", "/");
  };
  const editRevision = () => {
    if (!ticket) return;
    setRevision(true);
    setIssueType(null);
    setSymptom(ticket.symptom_text ?? "");
    setCode(ticket.code_text ?? "");
    if (ticket.experiment_id) setExperimentId(ticket.experiment_id);
    if (ticket.lab_id) setLabId(ticket.lab_id);
    setRequestKey("");
  };
  if (!ready)
    return (
      <div className="loading" role="status">
        <span className="busy-dot" />
        正在载入实验工作区…
      </div>
    );
  if (!session?.learner)
    return (
      <div className="auth-layout auth-simple">
        <section className="card form-card">
          <span className="eyebrow">学生实验台</span>
          <h1>用学习卡进入课堂</h1>
          <p className="muted auth-explainer">准备好教师发放的班级码、匿名编号和恢复码。</p>
          <form onSubmit={join} className="stack">
            <label>
              班级码
              <input
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                autoComplete="off"
                placeholder="教师提供的班级码"
                required
                maxLength={32}
              />
            </label>
            <label>
              匿名学习编号
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                autoComplete="username"
                placeholder="学习卡上的编号"
                required
                maxLength={40}
              />
            </label>
            <label>
              私密恢复码
              <input
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="学习卡上的恢复码"
                required
                maxLength={128}
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              {busy ? "正在加入…" : "进入实验台"}
            </button>
            <p className="muted">没有学习卡？请联系任课教师。恢复码请勿分享给他人。</p>
          </form>
        </section>
      </div>
    );
  return (
    <>
      <div className="page-head student-page-head">
        <div>
          <span className="eyebrow">实验学习工作区 / STUDENT LAB</span>
          <h1>{!ticket ? "八个实验指导" : ticket.status === "released" ? "按教师指导检查" : "已收到你的实验问题"}</h1>
          <p className="muted">{session.learner.classroom_name} <span aria-hidden="true">·</span> 匿名编号 {session.learner.number}</p>
        </div>
        <div className="page-head-actions">
          {ticket && (
            <button className="btn" onClick={startNew}>
              新建诊疗
            </button>
          )}
          <button className="btn quiet" onClick={logout} disabled={busy}>
            退出课堂
          </button>
        </div>
      </div>
      {ticket && <LoopRail current={current} />}
      {error && (
        <p className="notice error" role="alert" style={{ marginBottom: 20 }}>
          {error}
        </p>
      )}
      {!ticket && !revision && <section className="student-guide-workspace" aria-label="八个实验指导">
        <div className="guide-intro"><div><span className="eyebrow">实验学习路线 / 1—8</span><h2>按实验报告顺序学习</h2><p>每个实验依次看课程知识、完成任务、核对结果；需要时再向教师求助。</p></div><span className="guide-source">8 项原报告实验<span className="guide-swipe-hint"> · 左右滑动切换</span></span></div>
        <div className="lab-nav" ref={labNav} role="group" aria-label="八个实验的报告顺序，切换不代表完成">
          {LAB_GUIDES.map(lab => <button key={lab.id} data-lab-id={lab.id} type="button" className={`lab-nav-item ${labId === lab.id ? "active" : ""}`} aria-pressed={labId === lab.id} onClick={() => selectLab(lab.id)}><span>{String(lab.id).padStart(2, "0")}</span><strong>{lab.title}</strong></button>)}
        </div>
        {guide && <article className="lab-overview" id="lab-guide" key={guide.id}>
          <div className="lab-overview-main"><div className="lab-overview-copy"><span className="eyebrow">第 {guide.id} / 8 个实验 · 按报告顺序</span><h2>{LAB_REPORT_TITLES[guide.id]}</h2><p className="lab-goal"><strong>本次目标：</strong>{guide.goal}</p><p className="lab-curriculum"><strong>对应课程：</strong>{guide.ppt}</p><p className="lab-assignment"><strong>报告任务：</strong>{guide.task}</p><div className="lab-overview-actions"><a className="btn primary" href="#lab-steps">查看本实验过程</a><a className="btn quiet" href="/api/materials/original">下载原始八实验报告</a></div></div><LabVisual labId={guide.id} /></div>
          <div className="lab-guide-columns" id="lab-steps">
            <section><span>01 / 对应课程知识</span><h3>{guide.ppt}</h3><p>{LAB_PPT_NOTES[guide.id]}</p></section>
            <section><span>02 / 实验准备</span><h3>先核对器件与条件</h3><ul>{guide.wiring.map(v => <li key={v}>{v}</li>)}</ul></section>
            <section><span>03 / 编写与运行</span><h3>按报告完成程序</h3><ul>{guide.code.map(v => <li key={v}>{v}</li>)}</ul></section>
            <section><span>04 / 观察与验证</span><h3>用实际结果核对</h3><ul>{guide.resultChecks.map(v => <li key={v}>{v}</li>)}</ul><p><strong>记录：</strong>{guide.observations.join("；")}</p></section>
          </div>
          <div className="lab-after-steps"><div><strong>遇到问题？</strong><p>先按上面的顺序检查，再写下实际现象；教师复核后给出针对本实验的指导。</p></div><a className="btn primary" href="#ask-teacher">向教师求助</a></div>
          <details className="lab-guide-more"><summary>查看本实验应保留的材料与板卡参考照片</summary><div><p><strong>资料准备：</strong>{guide.evidence}</p><a href={`/api/lab-help?lab=${guide.id}`} className="btn quiet">下载本实验核对单</a><figure className="board-reference"><a href="/prechin6-board-reference.jpg" target="_blank" rel="noopener noreferrer"><Image src="/prechin6-board-reference.jpg" alt="普中-6 V1.2 手册中的开发板各功能模块照片" width={1227} height={894} /></a><figcaption>厂家手册第 3.1 节开发板功能示意照片；仅供辨认模块，不代表本班实际板型、接线或实验结果。</figcaption></figure></div></details>
          {coursewareForLab(guide.id).length > 0 && <div className="lab-courseware"><div><span className="eyebrow">可选 / 配套原理课件</span><h3>需要理解原理时再打开</h3></div><div>{coursewareForLab(guide.id).map(item => <Link key={item.slug} href={`/courseware/${item.slug}`}>{item.title}<span aria-hidden="true">↗</span></Link>)}</div></div>}
          <AssemblyDebugger labId={guide.id} />
          <MaterialLibrary classroomId={session.learner.classroom_id} labId={guide.id} />
          <div className="lab-sequence-footer"><span>实验顺序 {guide.id} / 8 · 切换只用于查看，不表示实验完成</span><div>{guide.id > 1 && <button type="button" className="btn quiet" onClick={() => selectLab(guide.id - 1)}>← 上一个实验</button>}{guide.id < 8 && <button type="button" className="btn" onClick={() => selectLab(guide.id + 1)}>查看下一个实验 →</button>}</div></div>
        </article>}
        <details className="specialty-entry"><summary>教师另行开放的故障专项诊疗</summary><button className="btn quiet" type="button" onClick={() => { setLabId(0); setIssueType(null); setSymptom(""); setCode(""); setRequestKey(""); document.getElementById("ask-teacher")?.scrollIntoView({ behavior: "smooth" }); }}>进入中断、串口或定时专项诊疗</button></details>
      </section>}
      <div className={`student-grid ${!ticket || ticket.lab_id ? "solo" : ""}`}>
        <div className="stack">
          {!ticket || revision ? (
            <section className="card student-compose" id="ask-teacher">
              <div className="compose-heading">
                <div>
                  <span className="eyebrow">02 / 需要帮助时</span>
                  <h2>{revision ? "补充本次诊疗" : "你在实验中看到了什么？"}</h2>
                  <p className="muted">当前为实验{labId} · {guide?.title ?? "故障专项"}。只需描述实际现象，教师审核后会给出指导。</p>
                </div>
                {revision && (
                  <span className="badge">
                    {ticket?.ticket} · 第 {(ticket?.round ?? 1) + 1} 轮
                  </span>
                )}
              </div>
              {!revision && <p className="selected-lab-note">本次求助：实验{labId} · {guide?.title ?? "故障专项"} <a href="#main-content">更换实验</a></p>}
              {!guide && experiments.length === 0 ? (
                <div className="empty">
                  <h3>实验尚未开放</h3>
                  <p>请等待教师完成实验配置后刷新。</p>
                  <button
                    className="btn"
                    style={{ marginTop: 16 }}
                    onClick={() => void loadSession()}
                  >
                    刷新实验
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} className="stack compose-form">
                  {!guide && <div className="field-grid">
                    <label>
                      当前实验
                      <select
                        value={experimentId}
                        onChange={(e) => {
                          setExperimentId(e.target.value);
                          setBench("");
                          setRequestKey("");
                        }}
                        disabled={revision || busy}
                      >
                        {experiments.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                            {e.confirmed ? "" : "（参数待教师确认）"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      实验工位
                      <select
                        value={bench}
                        onChange={(e) => setBench(e.target.value)}
                      >
                        <option value="">未分配</option>
                        {(experiment?.config.benches ?? []).map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>}
                  {guide && <details className="lab-triage lab-triage-optional"><summary>先自行排查或标记问题方向（可选）</summary>
                    <div className="symptom-shortcuts" role="group" aria-label="选择排查方向">
                      {issueOptions.map((item) => <button key={item.id} type="button" className={`btn ${issueType === item.id ? "selected" : "quiet"}`} aria-pressed={issueType === item.id} onClick={() => {
                        setIssueType(issueType === item.id ? null : item.id); setRequestKey("");
                      }}>{item.label}</button>)}
                    </div>
                    {selectedIssue && <div className="lab-triage-steps">
                      <strong>先核对这{selectedIssue.checks.length}点</strong>
                      <ol>{selectedIssue.checks.map((check) => <li key={check}>{check}</li>)}</ol>
                      <p>如果仍未解决，请在下方写出你实际看到的情况，教师会看到所选排查方向。</p>
                    </div>}
                  </details>}
                  <label>
                    实际观察到的情况 <span className="field-optional">必填</span>
                    <textarea
                      value={symptom}
                      disabled={busy}
                      onChange={(e) => {
                        setSymptom(e.target.value);
                        setRequestKey("");
                      }}
                      rows={4}
                      placeholder={guide ? `例如：${guide.observations[0]}与预期有什么不同？写出你亲眼观察到的现象。` : "例如：本应出现什么，实际看到什么；先不用写完整实验报告。请勿填写姓名、学号或联系方式。"}
                      required
                      minLength={6}
                      maxLength={2000}
                    />
                  </label>
                  {voiceSupported && <div className="voice-controls">
                    <button type="button" className="btn voice-button" onClick={toggleVoice} disabled={busy} aria-pressed={listening}>
                      {listening ? "停止语音输入" : "说出现象"}
                    </button>
                    <span className="inline-help">识别结果可修改；浏览器可能调用语音服务。</span>
                  </div>}
                  <details className="optional-code">
                    <summary>补充相关代码片段（可选）</summary>
                    <label>
                    相关代码片段
                    <textarea
                      className="code-input"
                      value={code}
                      disabled={busy}
                      onChange={(e) => {
                        setCode(e.target.value);
                        setRequestKey("");
                      }}
                      rows={10}
                      spellCheck={false}
                      placeholder="粘贴相关初始化、主程序或中断处理代码；保留排查所需的上下文。"
                      maxLength={8000}
                    />
                    </label>
                  </details>
                  <p className="compose-privacy">请勿填写姓名、学号或联系方式。教师审核后才会显示指导。</p>
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
                  <div className="row compose-actions">
                    <button
                      className="btn primary"
                      disabled={
                        busy || symptom.trim().length < 6 || identityHits.length > 0
                      }
                    >
                      {busy
                        ? "正在提交，请稍候…"
                        : revision
                          ? "提交补充内容"
                          : guide ? "提交给教师求助" : "提交给教师审核"}
                    </button>
                    {revision && (
                      <button
                        type="button"
                        className="btn quiet"
                        onClick={() => setRevision(false)}
                      >
                        取消补充
                      </button>
                    )}
                  </div>
                </form>
              )}
            </section>
          ) : (
            <TicketBoard
              view={ticket}
              onRefresh={setTicket}
              onRevise={editRevision}
            />
          )}
          <details className="card">
            <summary>查看已有诊疗</summary>
            <form
              className="row"
              style={{ paddingTop: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                void loadTicket(lookup);
              }}
            >
              <label style={{ flex: 1 }}>
                诊疗单号
                <input
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value.toUpperCase())}
                  placeholder="本人诊疗单号"
                  maxLength={32}
                  required
                />
              </label>
              <button className="btn" style={{ alignSelf: "end" }}>
                查看
              </button>
            </form>
            <p className="inline-help">仅可查看当前学习编号所属的记录。</p>
          </details>
        </div>
        {ticket && !ticket.lab_id && <aside className="card context-box">
          <span className="eyebrow">当前实验 / REFERENCE</span>
          <h3 style={{ marginTop: 8 }}>
            {ticket?.experiment_name || guide?.title || experiment?.name || "等待选择实验"}
          </h3>
          {guide && !ticket && <p className="context-goal">{guide.goal}</p>}
          <dl>
            <div>
              <dt>芯片</dt>
              <dd>{guide ? "按本次开发板确认" : experiment?.config.chip || "待教师配置"}</dd>
            </div>
            <div>
              <dt>晶振频率</dt>
              <dd>
                {!guide && experiment?.config.clock_hz
                  ? `${experiment.config.clock_hz / 1_000_000} MHz`
                  : "待教师确认"}
              </dd>
            </div>
            <div>
              <dt>验证方式</dt>
              <dd>
                {guide ? "按本实验核对单与教师要求" : experiment?.config.verification_method ||
                  "按教师发布的要求执行"}
              </dd>
            </div>
          </dl>
          <p className="section-rule muted">
            自报解决后，还需提交观察或修改后的代码，由教师确认验证结果。
          </p>
        </aside>}
      </div>
    </>
  );
}
