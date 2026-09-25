"use client";
import { useEffect, useRef, useState } from "react";
import { assemblyLab, normalizeAssembly } from "@/lib/assembly-labs";
import { api, errorText } from "@/components/client-api";
import type { Native8051Result } from "@/lib/native-8051";

const MAX_STEPS = 2_000_000;
const hex = (value: number) => `${(value & 255).toString(16).toUpperCase().padStart(2, "0")}H`;

export default function AssemblyDebugger({ labId }: { labId: number }) {
  const lab = assemblyLab(labId);
  const [code, setCode] = useState(lab?.code ?? "");
  const [result, setResult] = useState<Native8051Result | null>(null);
  const [steps, setSteps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [clockHz, setClockHz] = useState(12_000_000);
  const keySteps = useRef<number[]>([]);
  const loadedCode = useRef("");

  useEffect(() => {
    setCode(lab?.code ?? ""); setResult(null); setSteps(0); setMessage("");
    keySteps.current = []; loadedCode.current = "";
  }, [lab?.id, lab?.code]);
  if (!lab) return null;

  const verify = (count: number, keys: number[]) => api<Native8051Result>("/api/assembly", {
    lab_id: labId, code, steps: count, key_steps: keys, clock_hz: clockHz,
  });
  const reset = async () => {
    try { normalizeAssembly(code); } catch (cause) { setMessage(errorText(cause)); return; }
    setBusy(true); setMessage("");
    try {
      const next = await verify(0, []);
      loadedCode.current = code; keySteps.current = [];
      setResult(next); setSteps(0);
    } catch (cause) { setMessage(errorText(cause)); }
    finally { setBusy(false); }
  };
  const run = async (count: number) => {
    if (!result || loadedCode.current !== code) { setMessage("程序已修改，请先编译并加载。"); return; }
    if (steps + count > MAX_STEPS) { setMessage("本次最多执行 200 万条指令；请重新加载程序。"); return; }
    setBusy(true); setMessage("");
    try {
      const next = await verify(steps + count, keySteps.current);
      setResult(next); setSteps(steps + count);
    } catch (cause) { setMessage(errorText(cause)); }
    finally { setBusy(false); }
  };
  const press = () => {
    if (!lab.key || !result || loadedCode.current !== code) return;
    if (steps < 20) { setMessage("请先运行至少 20 条指令，让中断配置生效。"); return; }
    if (keySteps.current.length >= 8) { setMessage("一次调试最多记录 8 次按键，请重新加载程序。"); return; }
    if (keySteps.current.at(-1) === steps) { setMessage("请先运行几条指令，再记录下一次按键。"); return; }
    keySteps.current.push(steps);
    setMessage("已记录 P3.2 按键；继续运行后读取 INT0 结果。");
  };
  const downloadHex = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.hex], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = `lab${labId}-8051.hex`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const loaded = !!result && loadedCode.current === code;
  const observedPort = lab.port ? result?.registers[lab.port] : undefined;

  return <details className="assembly-debugger">
    <summary><span>可选 · 真实汇编与虚拟调试</span><strong>{lab.title}</strong><em>展开代码与端口观察 ↗</em></summary>
    <div className="assembly-body">
      <p>{lab.purpose}</p>
      <p className="assembly-source">资料口径：{lab.source}。这是可编辑的局部练习，不是原报告完整程序或实物运行证明。</p>
      <div className="assembly-layout">
        <div className="assembly-editor">
          <label htmlFor={`assembly-code-${labId}`}>8051 汇编代码</label>
          <textarea id={`assembly-code-${labId}`} value={code} disabled={busy} onChange={event => { setCode(event.target.value); setMessage(""); }} spellCheck={false} rows={Math.min(18, Math.max(10, code.split(/\r?\n/).length + 1))} aria-describedby={`assembly-limit-${labId}`} />
          <small id={`assembly-limit-${labId}`}>修改代码后重新编译。支持本页示例使用的 8051 指令子集；编译成功可下载 Intel HEX。</small>
        </div>
        <div className="assembly-panel">
          <div className="assembly-actions">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void reset()}>{busy ? "正在执行…" : "编译并加载"}</button>
            {[1, 500, 5_000, 50_000, 500_000].map(count => <button className="btn" type="button" key={count} disabled={!loaded || busy || steps + count > MAX_STEPS} onClick={() => void run(count)}>+{count.toLocaleString()} 条</button>)}
            {lab.key && <button className="btn quiet" type="button" disabled={!loaded || busy} onClick={press}>{lab.key.label}</button>}
          </div>
          <label className="assembly-clock">晶振条件<select value={clockHz} disabled={busy} onChange={event => { setClockHz(Number(event.target.value)); setResult(null); setSteps(0); keySteps.current = []; loadedCode.current = ""; }}><option value={12_000_000}>12 MHz（报告）</option><option value={11_059_200}>11.0592 MHz（对照）</option></select></label>
          {message && <p className={message.startsWith("已记录") ? "notice" : "notice error"} role="alert">{message}</p>}
          {result ? <div className="assembly-native" role="status">
            <div><strong>AS31 编译 · s51 执行结果</strong><button className="btn quiet" type="button" onClick={downloadHex}>下载 HEX</button></div>
            <p>{result.code_bytes} 字节机器码 · 已执行 {steps.toLocaleString()} 条 · 模拟时间 {(result.elapsed_seconds * 1000).toFixed(3)} ms</p>
            <p>PC {result.pc.toString(16).toUpperCase().padStart(4, "0")}H · A {hex(result.registers.A)} · SP {hex(result.registers.SP)}</p>
            <div className="assembly-registers">{(["P0", "P1", "P2", "P3", "TMOD", "TCON", "TH0", "TL0"] as const).map(name => <div key={name}><span>{name}</span><strong>{hex(result.registers[name])}</strong></div>)}</div>
            <p>RAM 30H / 31H / 32H：{hex(result.ram["30H"])} / {hex(result.ram["31H"])} / {hex(result.ram["32H"])}</p>
            {lab.port && observedPort !== undefined && <div className="assembly-leds" aria-label={`${lab.port} 端口八位电平`}>{Array.from({ length: 8 }, (_, bit) => { const high = !!(observedPort & (1 << bit)); const lit = lab.activeLow ? !high : high; return <div className={lit ? "lit" : ""} key={bit}><span>{lab.port}.{bit}</span><b>{high ? "高" : "低"}</b></div>; })}</div>}
            {lab.port && result.port_trace.length > 0 && <div className="assembly-trace"><strong>{lab.port}.0 采样电平</strong><div className="assembly-trace-bars" role="img" aria-label={`${lab.port}.0 在 ${result.port_trace.length} 个采样点上的高低变化`}>{result.port_trace.map(point => <span key={point.step} className={point.value & 1 ? "high" : "low"} title={`第 ${point.step.toLocaleString()} 条：${hex(point.value)}`} />)}</div><p>按指令数均匀采样 {result.port_trace.length} 点；末 8 点端口值：{result.port_trace.slice(-8).map(point => hex(point.value)).join(" · ")}。窄脉冲可能落在采样点之间。</p>{labId === 8 && <p>本段高电平采样占比：{(100 * result.port_trace.filter(point => point.value & 1).length / result.port_trace.length).toFixed(1)}%。这是离散采样估计，不是电机端实测占空比或转速。</p>}</div>}
          </div> : <p className="assembly-empty">先编译加载，再按指令数推进；观察值来自生成的 HEX 在 s51 中执行的状态。</p>}
        </div>
      </div>
      <p className="assembly-boundary">{lab.observation} 此处读数对应经典 12T 8051 指令仿真；端口电平不等于板上器件已正常工作。电机、蜂鸣器、数码管和接线须按本班器材验证。</p>
    </div>
  </details>;
}
