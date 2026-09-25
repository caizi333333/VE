"use client";
import { useEffect, useRef, useState } from "react";
import { assemblyLab } from "@/lib/assembly-labs";
import { Simulator, type SimulatorState } from "@/lib/assembly-simulator";

const hex = (value: number) => `${(value & 255).toString(16).toUpperCase().padStart(2, "0")}H`;
const MAX_CODE_LENGTH = 12_000;
const supported = new Set(["MOV", "MOVC", "MOVX", "ACALL", "LCALL", "RET", "RETI", "AJMP", "LJMP", "SJMP", "JMP", "DJNZ", "CJNE", "RL", "RR", "RLC", "RRC", "SETB", "CLR", "CPL", "ADD", "ADDC", "SUBB", "DA", "SWAP", "XCH", "XCHD", "ANL", "ORL", "XRL", "PUSH", "POP", "INC", "DEC", "JZ", "JNZ", "JC", "JNC", "JB", "JNB", "JBC", "MUL", "DIV", "NOP", "END"]);
function validateCode(code: string): string | null {
  if (!code.trim()) return "请先输入汇编程序。";
  if (code.length > MAX_CODE_LENGTH) return `程序不超过 ${MAX_CODE_LENGTH} 字符。`;
  for (const [index, original] of code.split(/\r?\n/).entries()) {
    const line = original.replace(/;.*$/, "").trim();
    if (!line || /^\w+:$/.test(line) || /^\w+\s+(EQU|BIT|DATA)\s+/i.test(line)) continue;
    const mnemonic = line.replace(/^\w+:\s*/, "").split(/\s+/)[0]?.toUpperCase();
    if (!mnemonic || !supported.has(mnemonic) && !["ORG", "DB", "DW", "DS"].includes(mnemonic)) return `第 ${index + 1} 行指令 ${mnemonic || "空"} 暂不支持；请检查语法。`;
  }
  return null;
}

export default function AssemblyDebugger({ labId }: { labId: number }) {
  const lab = assemblyLab(labId);
  const [code, setCode] = useState(lab?.code ?? "");
  const [snapshot, setSnapshot] = useState<SimulatorState | null>(null);
  const [steps, setSteps] = useState(0);
  const [changes, setChanges] = useState<string[]>([]);
  const [error, setError] = useState("");
  const simRef = useRef<Simulator | null>(null);
  const loadedCode = useRef("");
  useEffect(() => { setCode(lab?.code ?? ""); setSnapshot(null); setSteps(0); setChanges([]); setError(""); simRef.current = null; loadedCode.current = ""; }, [lab?.id, lab?.code]);
  if (!lab) return null;

  const reset = () => {
    const invalid = validateCode(code);
    if (invalid) { setError(invalid); return; }
    try {
      const sim = new Simulator(code);
      simRef.current = sim;
      loadedCode.current = code;
      setSnapshot(sim.getState()); setSteps(0); setChanges([]); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "程序加载失败"); }
  };
  const run = (count: number) => {
    if (!simRef.current || loadedCode.current !== code) { setError("程序已修改，请先点“加载程序”再运行。"); return; }
    const sim = simRef.current;
    const port = lab.port;
    const nextChanges: string[] = [];
    let executed = 0;
    try {
      for (let i = 0; i < count && !sim.state.terminated; i++) {
        const before = port ? sim.state.portValues[port] : null;
        sim.stepBatch(1);
        executed++;
        if (port && before !== sim.state.portValues[port] && nextChanges.length < 16) {
          nextChanges.push(`第 ${steps + executed} 条：${port} ${hex(sim.state.portValues[port])}`);
        }
      }
      setSteps(value => value + executed);
      setChanges(old => [...old, ...nextChanges].slice(-16));
      setSnapshot(sim.getState());
      setError("");
    } catch (cause) { setSnapshot(sim.getState()); setError(cause instanceof Error ? cause.message : "运行中断"); }
  };
  const press = () => {
    if (!simRef.current || !lab.key) return;
    simRef.current.pulsePortBit(lab.key.port, lab.key.bit, 2);
    setSnapshot(simRef.current.getState());
  };
  const lines = code.split(/\r?\n/);
  const observedPort = lab.port ? snapshot?.portValues[lab.port] : undefined;
  return <details className="assembly-debugger">
    <summary><span>可选 · 汇编单步调试</span><strong>{lab.title}</strong><em>展开代码与端口观察 ↗</em></summary>
    <div className="assembly-body">
      <p>{lab.purpose}</p><p className="assembly-source">资料口径：{lab.source}。这是可编辑的局部练习，并非原报告完整程序或实物运行证明。</p>
      <div className="assembly-layout">
        <div className="assembly-editor"><label htmlFor={`assembly-code-${labId}`}>8051 汇编代码</label><textarea id={`assembly-code-${labId}`} value={code} onChange={event => setCode(event.target.value)} spellCheck={false} rows={Math.min(18, Math.max(10, lines.length + 1))} aria-describedby={`assembly-limit-${labId}`} /><small id={`assembly-limit-${labId}`}>修改代码后重新加载。支持本页示例使用的 8051 指令子集；不产生 HEX 文件。</small></div>
        <div className="assembly-panel"><div className="assembly-actions"><button className="btn primary" type="button" onClick={reset}>加载程序</button><button className="btn" type="button" disabled={!snapshot || !!error} onClick={() => run(1)}>单步</button><button className="btn" type="button" disabled={!snapshot || !!error} onClick={() => run(500)}>运行 500 条</button><button className="btn" type="button" disabled={!snapshot || !!error} onClick={() => run(5000)}>运行 5000 条</button>{lab.key && <button className="btn quiet" type="button" disabled={!snapshot || !!error} onClick={press}>{lab.key.label}</button>}</div>
        {error && <p className="notice error" role="alert">{error}</p>}
        {snapshot ? <><p className="assembly-counter">已执行 {steps.toLocaleString()} 条指令 · 机器周期 {snapshot.machineCycles.toLocaleString()} · PC {snapshot.pc.toString(16).toUpperCase().padStart(4, "0")}H · 当前源代码第 {snapshot.currentLine >= 0 ? snapshot.currentLine + 1 : "—"} 行{snapshot.terminated ? " · 已停止" : ""}</p><div className="assembly-registers">{["A", "SP", "R0", "R6", "R7"].map(name => <div key={name}><span>{name}</span><strong>{hex(snapshot.registers[name] ?? 0)}</strong></div>)}{["P0", "P1", "P2", "P3"].map(name => <div key={name}><span>{name}</span><strong>{hex(snapshot.portValues[name as keyof typeof snapshot.portValues])}</strong></div>)}</div><p className="assembly-ram">RAM 30H / 31H / 32H：{[0x30, 0x31, 0x32].map(addr => hex(snapshot.ram[addr])).join(" / ")} · T0 溢出 {snapshot.timers.overflowCount0} 次</p>{lab.port && <div className="assembly-leds" aria-label={`${lab.port} 端口八位电平`}>
          {Array.from({ length: 8 }, (_, bit) => { const high = !!(observedPort! & (1 << bit)); const lit = lab.activeLow ? !high : high; return <div className={lit ? "lit" : ""} key={bit}><span>{lab.port}.{bit}</span><b>{high ? "高" : "低"}</b></div>; })}</div>}{changes.length > 0 && <div className="assembly-events"><strong>程序引起的端口变化</strong><ol>{changes.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol></div>}</> : <p className="assembly-empty">先加载程序，再单步或连续运行；观察值由汇编指令执行得到。</p>}</div>
      </div><p className="assembly-boundary">{lab.observation} 本内核来自“芯智育才”项目：端口与中断可按代码观察，定时器按经典 12T 指令机器周期计数，仍不包含板卡时钟误差和全部外设行为；不等于真实 8051 机器周期、编译结果或硬件接线验证。</p>
    </div>
  </details>;
}
