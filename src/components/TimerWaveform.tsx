"use client";

import { useEffect, useMemo, useState } from "react";
import { buildTimerWaveform, timerWaveState, type TimerWaveMode } from "@/lib/calculations";

const AXIS_LEFT = 36;
const AXIS_WIDTH = 688;
const HIGH_Y = 126;
const LOW_Y = 183;

function compactMs(value: number) { return Number(value.toFixed(4)).toString(); }

export default function TimerWaveform({ clock, targetMs, initialHex, formula }: { clock: number; targetMs: number; initialHex?: string; formula?: string }) {
  const [mode, setMode] = useState<TimerWaveMode>("accumulated");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const waveform = useMemo(() => buildTimerWaveform({ chip: "80C51", clock_hz: clock, clocks_per_tick: 12, timer_mode: 1, target_ms: targetMs, time_definition: "单次溢出间隔" }, mode), [clock, targetMs, mode]);

  useEffect(() => { setElapsedMs(0); setRunning(false); }, [clock, targetMs, mode]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setReducedMotion(preference.matches); if (preference.matches) setRunning(false); };
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!running || reducedMotion || waveform.status !== "ready") return;
    const interval = window.setInterval(() => setElapsedMs(value => value >= waveform.windowMs ? 0 : Math.min(waveform.windowMs, value + waveform.windowMs / 80)), 70);
    return () => window.clearInterval(interval);
  }, [running, reducedMotion, waveform]);

  const state = timerWaveState(waveform, elapsedMs);
  const x = (ms: number) => AXIS_LEFT + ms / waveform.windowMs * AXIS_WIDTH;
  let outputPath = `M ${AXIS_LEFT} ${HIGH_Y}`;
  if (waveform.status === "ready") {
    for (let time = waveform.toggleMs, high = false; time <= waveform.windowMs + 1e-8; time += waveform.toggleMs, high = !high) {
      outputPath += ` H ${x(time)} V ${high ? HIGH_Y : LOW_Y}`;
    }
    outputPath += ` H ${AXIS_LEFT + AXIS_WIDTH}`;
  }

  return <div className="cw-scope">
    <div className="cw-scope-head"><div><span className="cw-scope-kicker">T0 · 方式 1 / 12T</span><h2>定时事件与 P0.0 输出</h2><p>实验三要求完整方波周期 2 s；以下按手册条件演示理想计时逻辑。</p></div><span className="cw-scope-badge">教学时序模型</span></div>
    <div className="cw-scope-modes" role="group" aria-label="P0.0 翻转逻辑">
      <button type="button" className={mode === "accumulated" ? "selected" : ""} aria-pressed={mode === "accumulated"} onClick={() => setMode("accumulated")}>累计溢出至 1 s 翻转</button>
      <button type="button" className={mode === "direct" ? "selected warning" : ""} aria-pressed={mode === "direct"} onClick={() => setMode("direct")}>错误对照：每次溢出就翻转</button>
    </div>
    {waveform.status !== "ready" ? <div className="cw-scope-unavailable" role="status"><strong>当前条件不能绘制可靠波形</strong><p>{waveform.reason}</p><p>例如 70 ms 超过当前 12 MHz、方式 1 的单次计数范围；不能直接拿一个不存在的初值演示。</p></div> : <>
      <div className="cw-scope-metrics"><div><small>单次溢出</small><strong>{compactMs(waveform.overflowMs)} <em>ms</em></strong><span>初值 {initialHex}</span></div><div><small>每次翻转需累计</small><strong>{waveform.overflowsPerToggle} <em>次</em></strong><span>{mode === "direct" ? "错误写法：无累计" : `目标间隔 ${compactMs(waveform.toggleMs)} ms`}</span></div><div><small>完整方波周期</small><strong>{compactMs(waveform.fullPeriodMs)} <em>ms</em></strong><span>{mode === "direct" ? "不符合实验三的 2 s 要求" : "符合实验三的理论目标"}</span></div></div>
      <div className="cw-scope-chart"><svg viewBox="0 0 760 226" role="img" aria-label={`观察窗口 ${waveform.windowMs} 毫秒；每 ${compactMs(waveform.overflowMs)} 毫秒一次溢出；P0.0 完整周期 ${compactMs(waveform.fullPeriodMs)} 毫秒`}>
        <text x="36" y="25" className="scope-axis-title">溢出事件</text><text x="36" y="109" className="scope-axis-title">P0.0</text>
        {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1={x(waveform.windowMs * fraction)} x2={x(waveform.windowMs * fraction)} y1="39" y2="190" className="scope-grid" /><text x={x(waveform.windowMs * fraction)} y="214" className="scope-axis-label" textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}>{compactMs(waveform.windowMs * fraction)} ms</text></g>)}
        <line x1={AXIS_LEFT} x2={AXIS_LEFT + AXIS_WIDTH} y1="65" y2="65" className="scope-rail" />
        {waveform.overflowEventsMs.map((time, index) => <line key={index} x1={x(time)} x2={x(time)} y1={time % waveform.toggleMs < 1e-8 ? 48 : 55} y2="77" className={time <= elapsedMs ? "scope-tick passed" : "scope-tick"} />)}
        <path d={outputPath} className="scope-wave" /><line x1={x(state!.positionMs)} x2={x(state!.positionMs)} y1="39" y2="190" className="scope-cursor" /><circle cx={x(state!.positionMs)} cy={state!.outputHigh ? HIGH_Y : LOW_Y} r="6" className="scope-point" />
        <text x="7" y={HIGH_Y + 4} className="scope-level">1</text><text x="7" y={LOW_Y + 4} className="scope-level">0</text>
      </svg></div>
      <div className="cw-scope-transport"><label htmlFor="timer-playhead">观察时刻 <strong>{compactMs(state!.positionMs)} ms</strong><input id="timer-playhead" type="range" min="0" max={waveform.windowMs} step="1" value={elapsedMs} onChange={event => { setRunning(false); setElapsedMs(Number(event.target.value)); }} /></label><button type="button" onClick={() => setRunning(value => !value)} disabled={reducedMotion}>{reducedMotion ? "手动拖动查看" : running ? "暂停" : "播放波形"}</button></div>
      <div className="cw-scope-readout" aria-live="polite"><span><i className={state!.outputHigh ? "high" : "low"} />P0.0 模型电平：<strong>{state!.outputHigh ? "高" : "低"}</strong></span><span>累计溢出：<strong>{state!.countSinceToggle} / {waveform.overflowsPerToggle}</strong></span><span>下一次翻转：<strong>{compactMs(state!.nextToggleMs)} ms</strong></span></div>
      <p className={mode === "direct" ? "cw-scope-explain warning" : "cw-scope-explain"}>{mode === "direct" ? `这是故意设置的错误写法。${targetMs} ms 每溢出一次就翻转，完整周期变为 ${compactMs(waveform.fullPeriodMs)} ms，不能完成实验三。` : `切换 10 / 20 / 50 ms 时，下方溢出刻线疏密和累计次数会改变；由于翻转间隔仍累计到 1000 ms，P0.0 的 2 s 完整周期应保持不变。`}</p>
      <details className="cw-scope-formula"><summary>查看计数初值与计算边界</summary><p>{formula}</p><p>实验三使用 P0.0 输出；该引脚的实物电平还受开发板上拉与接线条件影响。此处忽略中断响应、重装初值、指令执行和晶振误差；本页未运行汇编程序，也未连接实物板。课堂结论须以程序与示波器或逻辑分析仪记录核验。</p></details>
    </>}
  </div>;
}
