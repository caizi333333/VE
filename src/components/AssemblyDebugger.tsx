"use client";
import { useEffect, useRef, useState } from "react";
import { assemblyLab, MAX_ASSEMBLY_CHARS, normalizeAssembly } from "@/lib/assembly-labs";
import { api, errorText } from "@/components/client-api";
import type { Native8051Result } from "@/lib/native-8051";
import { assemblyEvidenceFile, assemblyQuickStart, assemblyStudentHint, isCurrentAssemblyRun, type AssemblyRun } from "@/lib/assembly-workflow";
import { readLabDraft, saveLabDraft } from "@/lib/lab-drafts";

const MAX_STEPS = 2_000_000;
type RetryAction = { kind: 'reset' | 'run'; count: number } | { kind: 'press' };
const hex = (value: number) => `${(value & 255).toString(16).toUpperCase().padStart(2, "0")}H`;
const SEGMENTS = new Map([[0x3f, '0'], [0x06, '1'], [0x5b, '2'], [0x4f, '3'], [0x66, '4'], [0x6d, '5'], [0x7d, '6'], [0x07, '7'], [0x7f, '8'], [0x6f, '9'], [0x40, '−']]);
const PHASES = new Map([[0x01, 'A'], [0x03, 'AB'], [0x02, 'B'], [0x06, 'BC'], [0x04, 'C'], [0x0c, 'CD'], [0x08, 'D'], [0x09, 'DA']]);
const defaultTraceWindow = (id: number) => id === 7 ? 50_000 : id === 6 ? 5_000 : 0;
const defaultPreset = (id: number) => id === 5 ? 'scan-fixed' : id === 6 ? 'two-tone-2025' : id === 7 ? 'clock-alarm' : 'basic';
function sampledDigits(result: Native8051Result): (string | null)[] {
  const digits: (string | null)[] = Array(8).fill(null);
  result.port_trace.forEach((point, index) => {
    const select = result.secondary_trace[index];
    if (!select || select.step !== point.step) return;
    const active = (~select.value) & 0xff;
    if (active && (active & (active - 1)) === 0) digits[Math.log2(active)] = SEGMENTS.get(point.value) ?? '?';
  });
  return digits;
}

export default function AssemblyDebugger({ labId, learnerScope, expanded, onExpandedChange, onAskTeacher }: { labId: number; learnerScope: string; expanded: boolean; onExpandedChange: (open: boolean) => void; onAskTeacher?: (run: AssemblyRun) => void }) {
  const lab = assemblyLab(labId);
  const [code, setCode] = useState(lab?.variants?.find(item => item.id === defaultPreset(labId))?.code ?? lab?.code ?? "");
  const [result, setResult] = useState<Native8051Result | null>(null);
  const [steps, setSteps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retryAction, setRetryAction] = useState<RetryAction | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [clockHz, setClockHz] = useState(12_000_000);
  const [traceWindow, setTraceWindow] = useState(defaultTraceWindow(labId));
  const [presetId, setPresetId] = useState(defaultPreset(labId));
  const [snapshot, setSnapshot] = useState<AssemblyRun | null>(null);
  const [hydratedScope, setHydratedScope] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const keySteps = useRef<number[]>([]);
  const loadedCode = useRef("");

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setWaitSeconds(0);
    const timer = window.setInterval(() => setWaitSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const initialPreset = defaultPreset(lab?.id ?? 0);
    let draft = null;
    try { draft = readLabDraft(window.localStorage, learnerScope, labId); }
    catch { setDraftStatus("自动保存不可用，请下载源码保留修改。"); }
    setCode(draft?.code ?? lab?.variants?.find(item => item.id === initialPreset)?.code ?? lab?.code ?? "");
    setPresetId(draft?.presetId ?? initialPreset); setClockHz(draft?.clockHz ?? 12_000_000); setTraceWindow(draft?.traceWindow ?? defaultTraceWindow(labId));
    setResult(null); setSteps(0); setMessage(""); setRetryAction(null);
    keySteps.current = []; loadedCode.current = "";
    setSnapshot(null); setHydratedScope(`${learnerScope}:${labId}`);
  }, [labId, learnerScope, lab?.id, lab?.code, lab?.variants]);
  useEffect(() => {
    if (!expanded || hydratedScope !== `${learnerScope}:${labId}`) return;
    try {
      saveLabDraft(window.localStorage, learnerScope, { version: 1, labId, presetId, code, clockHz, traceWindow });
      setDraftStatus("代码已保存到此浏览器。刷新或切换实验可继续；退出课堂后清除，请先下载源码。");
    } catch { setDraftStatus("自动保存不可用，请下载源码保留修改。"); }
  }, [expanded, hydratedScope, learnerScope, labId, presetId, code, clockHz, traceWindow]);
  if (!lab) return null;
  const preset = lab.variants?.find(item => item.id === presetId);
  const tracePort = preset?.port ?? lab.port;
  const secondaryPort = tracePort === 'P0' && (labId === 5 || presetId === 'clock-2025') ? 'P1' : undefined;
  const displayPort = tracePort === 'P0' && presetId === 'clock-alarm' ? 'P1' : secondaryPort;
  const tertiaryPort = presetId === 'clock-alarm' ? 'P2' : undefined;
  const quickStart = assemblyQuickStart(labId, presetId);
  const capture = (next: Native8051Result, keys: number[]) => {
    setSnapshot({ labId, presetId, presetTitle: preset?.title ?? lab.title, code, clockHz,
      keySteps: [...keys], traceWindow, tracePort, secondaryPort: displayPort, tertiaryPort,
      capturedAt: new Date().toISOString(), result: next });
  };

  const verify = (count: number, keys: number[]) => api<Native8051Result>("/api/assembly", {
    lab_id: labId, code, steps: count, key_steps: keys, clock_hz: clockHz, trace_port: tracePort, secondary_port: displayPort, tertiary_port: tertiaryPort, trace_window: traceWindow || undefined,
  });
  const reset = async (count = 0) => {
    setRetryAction(null);
    try { normalizeAssembly(code); } catch (cause) { setMessage(errorText(cause)); return; }
    setBusy(true); setMessage(""); setResult(null); setSnapshot(null); loadedCode.current = "";
    try {
      const next = await verify(count, []);
      loadedCode.current = code; keySteps.current = [];
      setResult(next); setSteps(count); capture(next, []);
    } catch (cause) { setMessage(errorText(cause)); setRetryAction({ kind: 'reset', count }); }
    finally { setBusy(false); }
  };
  const run = async (count: number) => {
    if (!result || loadedCode.current !== code) { setMessage("程序已修改，请先编译并加载。"); return; }
    if (steps + count > MAX_STEPS) { setMessage("本次最多执行 200 万条指令；请重新加载程序。"); return; }
    setBusy(true); setMessage(""); setRetryAction(null);
    try {
      const next = await verify(steps + count, keySteps.current);
      setResult(next); setSteps(steps + count); capture(next, keySteps.current);
    } catch (cause) { setMessage(errorText(cause)); setRetryAction({ kind: 'run', count }); }
    finally { setBusy(false); }
  };
  const press = async () => {
    if (!lab.key || !result || loadedCode.current !== code) return;
    if (steps < 20) { setMessage("请先运行至少 20 条指令，让中断配置生效。"); return; }
    if (keySteps.current.length >= 8) { setMessage("一次调试最多记录 8 次按键，请重新加载程序。"); return; }
    if (steps + 25 > MAX_STEPS) { setMessage("本次运行已接近上限，请在进阶调试中重新加载程序。"); return; }
    const keys = [...keySteps.current, steps];
    setBusy(true); setMessage(""); setRetryAction(null);
    try {
      const next = await verify(steps + 25, keys);
      keySteps.current = keys; setResult(next); setSteps(steps + 25); capture(next, keys);
    } catch (cause) { setMessage(errorText(cause)); setRetryAction({ kind: 'press' }); }
    finally { setBusy(false); }
  };
  const download = (content: string, extension: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: extension === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
    const link = document.createElement("a"); link.href = url; link.download = `lab${labId}-8051.${extension}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const loaded = isCurrentAssemblyRun(snapshot, code, clockHz, presetId);
  const canUseEvidence = loaded && !busy;
  const continueSteps = labId === 2 && presetId === 'group-2025' ? 500_000 : quickStart.steps;
  const advance = () => !loaded || steps >= MAX_STEPS ? reset(quickStart.steps) : run(Math.min(continueSteps, MAX_STEPS - steps));
  const observedPort = tracePort ? result?.registers[tracePort] : undefined;
  const focusCode = () => {
    const editor = document.getElementById(`assembly-code-${labId}`);
    editor?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    editor?.focus({ preventScroll: true });
  };
  const retry = () => {
    if (!retryAction || busy) return;
    if (retryAction.kind === 'press') void press();
    else if (retryAction.kind === 'reset') void reset(retryAction.count);
    else void run(retryAction.count);
  };
  const restoreExample = () => {
    if (!window.confirm('恢复示例会替换当前代码和草稿。请先下载源码保留修改。仍要恢复吗？')) return;
    setCode(preset?.code ?? lab.code); setResult(null); setSnapshot(null); setSteps(0); setMessage(''); setRetryAction(null);
    keySteps.current = []; loadedCode.current = '';
    focusCode();
  };

  return <details className="assembly-debugger" id="lab-workbench" open={expanded} onToggle={event => onExpandedChange(event.currentTarget.open)}>
    <summary><span>动手实验 · 代码与观察</span><strong>{lab.title}</strong><em>{expanded ? '收起实验台' : '展开实验台 ↗'}</em></summary>
    <div className="assembly-body">
      <ol className="assembly-journey" aria-label="实验操作顺序"><li aria-current={!loaded ? 'step' : undefined}><span>1</span>运行程序</li><li aria-current={loaded ? 'step' : undefined}><span>2</span>对照读数</li><li><span>3</span>记录或求助</li></ol>
      <p>{lab.purpose}</p>
      <div className="assembly-guide"><strong>先运行，再对照变化</strong><p>{assemblyStudentHint(labId, presetId)}</p><small>当前程序：{preset?.title ?? lab.title} · 晶振 {clockHz / 1_000_000} MHz。恢复的代码须重新运行，读数才会更新。</small></div>
          <div className="assembly-actions assembly-primary-actions">
            <button className="btn primary" id="run-program" type="button" disabled={busy || hydratedScope !== `${learnerScope}:${labId}`} onClick={() => void advance()}>{busy ? "正在运行…" : !loaded ? "运行程序" : steps >= MAX_STEPS ? "重新运行程序" : "继续观察"}</button>
            {lab.key && <button className="btn" type="button" disabled={!loaded || busy} onClick={() => void press()}>{lab.key.label}并观察</button>}
          </div>
      {busy && <div className="assembly-wait" role="status" aria-live="polite"><span className="busy-dot" aria-hidden="true" /><div><strong>正在编译并执行程序 · 已等待 {waitSeconds} 秒</strong><p>{waitSeconds >= 8 ? '本次执行仍在等待服务返回。请勿重复点击；可以下载源码保留当前修改。' : '结果返回后会更新下方读数。这里显示实际等待时间。'}</p></div></div>}
      <div className="assembly-layout">
        <div className="assembly-panel">
          <details className="assembly-advanced"><summary>进阶调试：程序版本、单步与运行参数</summary>
          <p className="assembly-source">资料口径：{preset?.source ?? lab.source}。历史代码用于对照和调试；程序编译通过不等于本班实物验证通过。</p>
          {lab.variants && <label className="assembly-clock">程序版本<select value={presetId} disabled={busy} onChange={event => { const id = event.target.value; if (code !== (preset?.code ?? lab.code) && !window.confirm('切换版本将替换当前代码和草稿。请先下载源码保存。仍要切换吗？')) return; setPresetId(id); setCode(lab.variants?.find(item => item.id === id)?.code ?? lab.code); setResult(null); setSnapshot(null); setSteps(0); setMessage(""); setRetryAction(null); keySteps.current = []; loadedCode.current = ""; }}><option value="basic">局部基础练习</option>{lab.variants.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          <p>{quickStart.instruction}</p>
          <div className="assembly-actions">
            <button className="btn quiet" type="button" disabled={busy} onClick={() => void reset()}>重新编译并加载（从头调试）</button>
            {[1, 500, 5_000, 50_000, 500_000].map(count => <button className="btn quiet" type="button" key={count} disabled={!loaded || busy || steps + count > MAX_STEPS} onClick={() => void run(count)}>+{count.toLocaleString()} 条</button>)}
          </div>
          <label className="assembly-clock">晶振条件<select value={clockHz} disabled={busy} onChange={event => { setClockHz(Number(event.target.value)); setResult(null); setSnapshot(null); setSteps(0); setMessage(""); setRetryAction(null); keySteps.current = []; loadedCode.current = ""; }}><option value={12_000_000}>12 MHz（报告）</option><option value={11_059_200}>11.0592 MHz（对照）</option></select></label>
          {tracePort && <label className="assembly-clock">下一次运行的采样范围<select value={traceWindow} disabled={busy} onChange={event => setTraceWindow(Number(event.target.value))}><option value={0}>从加载到当前</option><option value={500}>最近 500 条</option><option value={5_000}>最近 5,000 条</option><option value={50_000}>最近 50,000 条</option></select></label>}
          </details>
          {message && <div className="assembly-recovery"><p className="notice error" role="alert">{message}</p><div className="assembly-actions">{retryAction && <button className="btn" type="button" disabled={busy} onClick={retry}>{retryAction.kind === 'press' ? '重试本次按键' : '重试本次运行'}</button>}<button className="btn quiet" type="button" disabled={busy} onClick={focusCode}>检查代码</button></div><small>当前源码仍保留。失败的运行或按键不会计入成功记录。</small></div>}
          {result && !loaded && <p className="notice error" role="status">代码已修改，下方是上一版程序的结果。请重新编译；旧结果暂不能下载或带入求助。</p>}
          {result ? <div className="assembly-native" role="status">
            <strong>本次运行的观察结果{!loaded ? '（上一版）' : ''}</strong>
            {loaded && <div className="assembly-next-step"><strong>下一步</strong><p>{labId === 4 && keySteps.current.length === 0 ? '按一次虚拟 P3.2，比较按键前后的 RAM 30H 计数。' : '对照上方观察提示与本次读数；可继续观察，或只修改一处代码再运行，比较变化。'}</p><button className="btn quiet" type="button" disabled={busy} onClick={focusCode}>修改代码，比较变化</button></div>}
            <p>累计模拟时间 {(result.elapsed_seconds * 1000).toFixed(3)} ms · 已执行 {steps.toLocaleString()} 条指令</p>
            {labId === 1 && <p>累加器 A：{hex(result.registers.A)} · 栈指针 SP：{hex(result.registers.SP)}</p>}
            {labId === 4 && steps > 0 && <p>已执行 {keySteps.current.length} 次虚拟按键 · RAM 30H 计数：{result.ram['30H']}</p>}
            <details className="assembly-advanced"><summary>查看寄存器、采样条件与 HEX</summary>
            <div><strong>AS31 编译 · s51 执行</strong><button className="btn quiet" type="button" disabled={!canUseEvidence} onClick={() => download(result.hex, 'hex')}>下载 HEX</button></div>
            <p>{result.code_bytes} 字节机器码 · 已执行 {steps.toLocaleString()} 条 · 模拟时间 {(result.elapsed_seconds * 1000).toFixed(3)} ms</p>
            {snapshot && <p>本次结果：{result.clock_hz.toLocaleString()} Hz · 采样范围 {snapshot.traceWindow ? `最近 ${snapshot.traceWindow.toLocaleString()} 条` : '从加载到当前'}。更改上方采样范围后，下次运行才生效。</p>}
            <p>PC {result.pc.toString(16).toUpperCase().padStart(4, "0")}H · A {hex(result.registers.A)} · SP {hex(result.registers.SP)}</p>
            <div className="assembly-registers">{(["P0", "P1", "P2", "P3", "TMOD", "TCON", "TH0", "TL0"] as const).map(name => <div key={name}><span>{name}</span><strong>{hex(result.registers[name])}</strong></div>)}</div>
            </details>
            {steps > 0 && (labId === 1 || labId === 4 || labId === 7 && presetId === 'basic') && <p>RAM 30H / 31H / 32H：{hex(result.ram["30H"])} / {hex(result.ram["31H"])} / {hex(result.ram["32H"])}</p>}
            {steps > 0 && labId === 5 && presetId !== 'basic' && <p>间隔变量 20H：{result.ram['20H']} 次 T0 溢出（名义每次 1 ms；软件开销另计）。</p>}
            {steps > 0 && labId === 7 && presetId !== 'basic' && <p>RAM 时刻：{result.ram['38H']}{result.ram['37H']}:{result.ram['35H']}{result.ram['34H']}:{result.ram['32H']}{result.ram['31H']}{presetId === 'clock-alarm' ? ` · 报警剩余计数 ${result.ram['30H']}` : ''}</p>}
            {tracePort && observedPort !== undefined && <div className="assembly-leds" aria-label={`${tracePort} 端口八位电平`}>{Array.from({ length: 8 }, (_, bit) => { const high = !!(observedPort & (1 << bit)); const lit = lab.activeLow ? !high : high; return <div className={lit ? "lit" : ""} key={bit}><span>{tracePort}.{bit}</span><b>{high ? "高" : "低"}</b></div>; })}</div>}
            {tracePort && result.port_trace.length > 0 && <div className="assembly-trace"><strong>{tracePort}.0 采样电平</strong><div className="assembly-trace-bars" role="img" aria-label={`${tracePort}.0 在 ${result.port_trace.length} 个采样点上的高低变化`}>{result.port_trace.map(point => <span key={point.step} className={point.value & 1 ? "high" : "low"} title={`第 ${point.step.toLocaleString()} 条：${hex(point.value)}`} />)}</div><p>按指令数均匀采样 {result.port_trace.length} 点；末 8 点端口值：{result.port_trace.slice(-8).map(point => hex(point.value)).join(" · ")}。窄脉冲可能落在采样点之间。</p>{labId === 8 && presetId !== 'stepper-abstract' && <p>本段高电平采样占比：{(100 * result.port_trace.filter(point => point.value & 1).length / result.port_trace.length).toFixed(1)}%。这是离散采样估计，不是电机端实测占空比或转速。</p>}</div>}
            {presetId === 'stepper-abstract' && result.port_trace.length > 0 && <div className="assembly-phase"><strong>采样到的相序</strong><p>{result.port_trace.map(point => point.value & 0x0f).filter((value, index, values) => index === 0 || value !== values[index - 1]).slice(-16).map(value => PHASES.get(value) ?? `?(${hex(value)})`).join(' → ')}</p><small>A/B/C/D 在此抽象练习中对应 P1.0/P1.1/P1.2/P1.3。相序正确不代表已匹配实物驱动器。</small></div>}
            {displayPort && result.secondary_trace.length > 0 && <div className="assembly-display"><strong>P0 段码 × P1 位选采样</strong><div>{(labId === 7 ? [...sampledDigits(result)].reverse() : sampledDigits(result)).map((digit, index) => <span key={index}><small>P1.{labId === 7 ? 7 - index : index}</small><b>{digit ?? '·'}</b></span>)}</div><p>按备课代码中的共阴段码及 P1 低有效位选解码；“·”表示本次采样未捕捉该位。时钟按原程序的高位到低位显示，板上实际左右方向仍须核对。</p></div>}
            {tertiaryPort && result.tertiary_trace.length > 0 && <div className="assembly-trace"><strong>P2.0 分钟报警控制信号</strong><div className="assembly-trace-bars" role="img" aria-label="P2.0 蜂鸣器控制脚采样电平">{result.tertiary_trace.map(point => <span key={point.step} className={point.value & 1 ? "high" : "low"} title={`第 ${point.step.toLocaleString()} 条：${hex(point.value)}`} />)}</div><p>报警时两种电平交替；该图不等于可听音频或蜂鸣器实物测试。</p></div>}
          </div> : <p className="assembly-empty">点“运行程序”，这里会显示本次仿真的实际读数。无需先选择运行步数。</p>}
          {snapshot && <div className="assembly-evidence-actions"><button className="btn" type="button" disabled={!canUseEvidence} onClick={() => download(assemblyEvidenceFile(snapshot), 'json')}>下载调试记录</button>{onAskTeacher && <button className="btn primary" type="button" disabled={!canUseEvidence} onClick={() => onAskTeacher(snapshot)}>带入代码与记录，向教师求助</button>}<small>记录包含本次源码、晶振、按键、寄存器及采样值。带入后还需填写实际问题，由你提交。</small></div>}
        </div>
        <div className="assembly-editor">
          <label htmlFor={`assembly-code-${labId}`}>8051 汇编代码</label>
          <textarea id={`assembly-code-${labId}`} value={code} disabled={busy} maxLength={MAX_ASSEMBLY_CHARS} onChange={event => { setCode(event.target.value); setMessage(""); setRetryAction(null); }} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !busy && hydratedScope === `${learnerScope}:${labId}`) { event.preventDefault(); void advance(); } }} spellCheck={false} rows={Math.min(18, Math.max(10, code.split(/\r?\n/).length + 1))} aria-describedby={`assembly-limit-${labId}`} />
          <small id={`assembly-limit-${labId}`}>可以先运行示例，再修改代码。修改后点击“运行程序”更新结果。支持本页示例使用的 8051 指令子集。</small>
          <small className="assembly-draft-status" role="status">{draftStatus}</small>
          <small>在代码框内按 ⌘ / Ctrl + Enter，可运行或继续观察。</small>
          <div className="assembly-actions"><button className="btn quiet" type="button" disabled={!code.trim()} onClick={() => download(code, 'asm')}>下载当前源码</button><button className="btn quiet" type="button" disabled={busy || code === (preset?.code ?? lab.code)} onClick={restoreExample}>恢复当前版本示例</button></div>
        </div>
      </div>
      <p className="assembly-boundary">{lab.observation} 此处读数对应经典 12T 8051 指令仿真；端口电平不等于板上器件已正常工作。电机、蜂鸣器、数码管和接线须按本班器材验证。</p>
    </div>
  </details>;
}
