"use client";
import { useEffect, useRef, useState } from "react";
import { assemblyLab, normalizeAssembly } from "@/lib/assembly-labs";
import { api, errorText } from "@/components/client-api";
import type { Native8051Result } from "@/lib/native-8051";

const MAX_STEPS = 2_000_000;
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

export default function AssemblyDebugger({ labId }: { labId: number }) {
  const lab = assemblyLab(labId);
  const [code, setCode] = useState(lab?.variants?.find(item => item.id === defaultPreset(labId))?.code ?? lab?.code ?? "");
  const [result, setResult] = useState<Native8051Result | null>(null);
  const [steps, setSteps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [clockHz, setClockHz] = useState(12_000_000);
  const [traceWindow, setTraceWindow] = useState(defaultTraceWindow(labId));
  const [presetId, setPresetId] = useState(defaultPreset(labId));
  const keySteps = useRef<number[]>([]);
  const loadedCode = useRef("");

  useEffect(() => {
    const initialPreset = defaultPreset(lab?.id ?? 0);
    setCode(lab?.variants?.find(item => item.id === initialPreset)?.code ?? lab?.code ?? ""); setResult(null); setSteps(0); setMessage(""); setPresetId(initialPreset); setTraceWindow(defaultTraceWindow(lab?.id ?? 0));
    keySteps.current = []; loadedCode.current = "";
  }, [lab?.id, lab?.code, lab?.variants]);
  if (!lab) return null;
  const preset = lab.variants?.find(item => item.id === presetId);
  const tracePort = preset?.port ?? lab.port;
  const secondaryPort = tracePort === 'P0' && (labId === 5 || presetId === 'clock-2025') ? 'P1' : undefined;
  const displayPort = tracePort === 'P0' && presetId === 'clock-alarm' ? 'P1' : secondaryPort;
  const tertiaryPort = presetId === 'clock-alarm' ? 'P2' : undefined;

  const verify = (count: number, keys: number[]) => api<Native8051Result>("/api/assembly", {
    lab_id: labId, code, steps: count, key_steps: keys, clock_hz: clockHz, trace_port: tracePort, secondary_port: displayPort, tertiary_port: tertiaryPort, trace_window: traceWindow || undefined,
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
  const observedPort = tracePort ? result?.registers[tracePort] : undefined;

  return <details className="assembly-debugger">
    <summary><span>可选 · 真实汇编与虚拟调试</span><strong>{lab.title}</strong><em>展开代码与端口观察 ↗</em></summary>
    <div className="assembly-body">
      <p>{lab.purpose}</p>
      <p className="assembly-source">资料口径：{preset?.source ?? lab.source}。历史代码用于对照和调试；程序编译通过不等于本班实物验证通过。</p>
      {lab.variants && <label className="assembly-clock">程序版本<select value={presetId} disabled={busy} onChange={event => { const id = event.target.value; setPresetId(id); setCode(lab.variants?.find(item => item.id === id)?.code ?? lab.code); setResult(null); setSteps(0); setMessage(""); keySteps.current = []; loadedCode.current = ""; }}><option value="basic">局部基础练习</option>{lab.variants.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
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
          {tracePort && <label className="assembly-clock">下一次运行的采样范围<select value={traceWindow} disabled={busy} onChange={event => setTraceWindow(Number(event.target.value))}><option value={0}>从加载到当前</option><option value={500}>最近 500 条</option><option value={5_000}>最近 5,000 条</option><option value={50_000}>最近 50,000 条</option></select></label>}
          {message && <p className={message.startsWith("已记录") ? "notice" : "notice error"} role="alert">{message}</p>}
          {result ? <div className="assembly-native" role="status">
            <div><strong>AS31 编译 · s51 执行结果</strong><button className="btn quiet" type="button" onClick={downloadHex}>下载 HEX</button></div>
            <p>{result.code_bytes} 字节机器码 · 已执行 {steps.toLocaleString()} 条 · 模拟时间 {(result.elapsed_seconds * 1000).toFixed(3)} ms</p>
            <p>PC {result.pc.toString(16).toUpperCase().padStart(4, "0")}H · A {hex(result.registers.A)} · SP {hex(result.registers.SP)}</p>
            <div className="assembly-registers">{(["P0", "P1", "P2", "P3", "TMOD", "TCON", "TH0", "TL0"] as const).map(name => <div key={name}><span>{name}</span><strong>{hex(result.registers[name])}</strong></div>)}</div>
            {steps > 0 && (labId === 1 || labId === 4 || labId === 7 && presetId === 'basic') && <p>RAM 30H / 31H / 32H：{hex(result.ram["30H"])} / {hex(result.ram["31H"])} / {hex(result.ram["32H"])}</p>}
            {steps > 0 && labId === 5 && presetId !== 'basic' && <p>间隔变量 20H：{result.ram['20H']} 次 T0 溢出（名义每次 1 ms；软件开销另计）。</p>}
            {steps > 0 && labId === 7 && presetId !== 'basic' && <p>RAM 时刻：{result.ram['38H']}{result.ram['37H']}:{result.ram['35H']}{result.ram['34H']}:{result.ram['32H']}{result.ram['31H']}{presetId === 'clock-alarm' ? ` · 报警剩余计数 ${result.ram['30H']}` : ''}</p>}
            {tracePort && observedPort !== undefined && <div className="assembly-leds" aria-label={`${tracePort} 端口八位电平`}>{Array.from({ length: 8 }, (_, bit) => { const high = !!(observedPort & (1 << bit)); const lit = lab.activeLow ? !high : high; return <div className={lit ? "lit" : ""} key={bit}><span>{tracePort}.{bit}</span><b>{high ? "高" : "低"}</b></div>; })}</div>}
            {tracePort && result.port_trace.length > 0 && <div className="assembly-trace"><strong>{tracePort}.0 采样电平</strong><div className="assembly-trace-bars" role="img" aria-label={`${tracePort}.0 在 ${result.port_trace.length} 个采样点上的高低变化`}>{result.port_trace.map(point => <span key={point.step} className={point.value & 1 ? "high" : "low"} title={`第 ${point.step.toLocaleString()} 条：${hex(point.value)}`} />)}</div><p>按指令数均匀采样 {result.port_trace.length} 点；末 8 点端口值：{result.port_trace.slice(-8).map(point => hex(point.value)).join(" · ")}。窄脉冲可能落在采样点之间。</p>{labId === 8 && presetId !== 'stepper-abstract' && <p>本段高电平采样占比：{(100 * result.port_trace.filter(point => point.value & 1).length / result.port_trace.length).toFixed(1)}%。这是离散采样估计，不是电机端实测占空比或转速。</p>}</div>}
            {presetId === 'stepper-abstract' && result.port_trace.length > 0 && <div className="assembly-phase"><strong>采样到的相序</strong><p>{result.port_trace.map(point => point.value & 0x0f).filter((value, index, values) => index === 0 || value !== values[index - 1]).slice(-16).map(value => PHASES.get(value) ?? `?(${hex(value)})`).join(' → ')}</p><small>A/B/C/D 在此抽象练习中对应 P1.0/P1.1/P1.2/P1.3。相序正确不代表已匹配实物驱动器。</small></div>}
            {displayPort && result.secondary_trace.length > 0 && <div className="assembly-display"><strong>P0 段码 × P1 位选采样</strong><div>{(labId === 7 ? [...sampledDigits(result)].reverse() : sampledDigits(result)).map((digit, index) => <span key={index}><small>P1.{labId === 7 ? 7 - index : index}</small><b>{digit ?? '·'}</b></span>)}</div><p>按备课代码中的共阴段码及 P1 低有效位选解码；“·”表示本次采样未捕捉该位。时钟按原程序的高位到低位显示，板上实际左右方向仍须核对。</p></div>}
            {tertiaryPort && result.tertiary_trace.length > 0 && <div className="assembly-trace"><strong>P2.0 分钟报警控制信号</strong><div className="assembly-trace-bars" role="img" aria-label="P2.0 蜂鸣器控制脚采样电平">{result.tertiary_trace.map(point => <span key={point.step} className={point.value & 1 ? "high" : "low"} title={`第 ${point.step.toLocaleString()} 条：${hex(point.value)}`} />)}</div><p>报警时两种电平交替；该图不等于可听音频或蜂鸣器实物测试。</p></div>}
          </div> : <p className="assembly-empty">先编译加载，再按指令数推进；观察值来自生成的 HEX 在 s51 中执行的状态。</p>}
        </div>
      </div>
      <p className="assembly-boundary">{lab.observation} 此处读数对应经典 12T 8051 指令仿真；端口电平不等于板上器件已正常工作。电机、蜂鸣器、数码管和接线须按本班器材验证。</p>
    </div>
  </details>;
}
