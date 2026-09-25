"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { calculateTimer, calculateUart } from "@/lib/calculations";
import { COURSEWARE, type CoursewareSlug } from "@/lib/courseware";
import { LAB_GUIDES, LAB_REPORT_TITLES } from "@/lib/lab-guides";
import TimerWaveform from "@/components/TimerWaveform";

const descriptions: Record<CoursewareSlug, string[]> = {
  interrupt: ["按键 K 在 P3.2 / INT0 形成输入条件。", "EA 是全局中断使能；关闭时中断请求不会进入服务程序。", "EX0 开放外部中断 0；IT0 决定边沿或低电平触发方式。", "核对中断入口、按键抖动和实际显示，再判断数码管是否加 1。"],
  timer: ["先确认实际晶振与每次计数所需时钟数。", "单次计数间隔由晶振和分频共同决定。", "计数达到容量后溢出；程序需要重装初值或累计多次。", "输出翻转一次只是半个完整周期；两个同向沿之间才是完整周期。"],
  serial: ["低电平起始位通知接收端开始采样。", "方式 1 的 8 位数据按低位在前发送。", "发送端与接收端须核对波特率及数据格式。", "停止位恢复高电平；若采样节奏不一致，应先核对时钟与 TH1。"],
  port: ["先确认开发板 LED 是高电平点亮还是低电平点亮。", "端口的每一位对应一盏灯，位序须按实际接线核对。", "改变端口字节，观察单灯与相邻灯的显示。", "再用循环与延时组成往返流水和分组显示。"],
  scan: ["一次只选通一个数码管位置。", "向段线送出该位置对应的段码。", "切换到下一位，八位循环形成整屏刷新。", "比较单个位停留时间与整屏刷新周期，记录可见闪烁。"],
  pwm: ["PWM 每个周期分为高电平段与低电平段。", "占空比是高电平时长占整个周期的比例。", "步进电机相序须先按已确认的电机类型与驱动接线确定。", "方向、失步与转速需要实物观察；本页不推断运行结果。"],
};

export default function CoursewareStudio({ unit }: { unit: CoursewareSlug }) {
  const lesson = COURSEWARE.find(item => item.slug === unit)!;
  const maxStep = unit === "serial" ? 10 : unit === "scan" ? 8 : 4;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [clock, setClock] = useState(12_000_000);
  const [targetMs, setTargetMs] = useState(50);
  const [baud, setBaud] = useState(9600);
  const [dataByte, setDataByte] = useState(0x55);
  const [ea, setEa] = useState(true);
  const [ex0, setEx0] = useState(true);
  const [it0, setIt0] = useState(true);
  const [activeLow, setActiveLow] = useState(true);
  const [portValue, setPortValue] = useState(0xfe);
  const [dwell, setDwell] = useState(5);
  const [duty, setDuty] = useState(30);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => { setReducedMotion(preference.matches); if (preference.matches) setPlaying(false); };
    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, []);
  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setInterval(() => setStep(value => (value + 1) % maxStep), 1200);
    return () => window.clearInterval(timer);
  }, [playing, maxStep, reducedMotion]);
  const timer = calculateTimer({ chip: "80C51", clock_hz: clock, clocks_per_tick: 12, timer_mode: 1, target_ms: targetMs, time_definition: "单次溢出间隔" });
  const uart = calculateUart({ chip: "80C51", clock_hz: clock, clocks_per_tick: 12, timer_mode: 2, target_baud: baud, smod: 0 });
  const bits = [0, ...Array.from({ length: 8 }, (_, index) => (dataByte >> index) & 1), 1];
  const status = descriptions[unit][unit === "serial" ? (step === 0 ? 0 : step === 9 ? 3 : step < 5 ? 1 : 2) : Math.min(3, Math.floor(step / (maxStep / 4)))];
  const display = () => {
    if (unit === "interrupt") return <div className="cw-flow" role="img" aria-label="外部中断通路示意">
      {[["P3.2 / K", "输入", true], ["EA", ea ? "已开放" : "已关闭", ea], ["EX0", ex0 ? "已开放" : "已关闭", ex0], ["INT0 服务", ea && ex0 ? "可进入" : "通路阻断", ea && ex0]].map(([name, note, enabled], index) => <div key={String(name)} className={`cw-flow-node ${step === index ? "current" : ""} ${enabled ? "" : "off"}`}><span>{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong><small>{note}</small></div>)}
      <p className="cw-stage-note">触发方式：IT0={it0 ? "1（下降沿）" : "0（低电平）"}；按键抖动和输入波形不在示意中模拟。</p>
    </div>;
    if (unit === "timer") return <TimerWaveform clock={clock} targetMs={targetMs} initialHex={timer.status === "ready" ? String(timer.values?.initial_hex) : undefined} formula={timer.formula} />;
    if (unit === "serial") return <div className="cw-serial-stage"><div className="cw-bits">{bits.map((bit, index) => <div key={index} className={`cw-bit ${index === step ? "current" : ""}`}><small>{index === 0 ? "起始" : index === 9 ? "停止" : `D${index - 1}`}</small><strong>{bit}</strong></div>)}</div><p className="cw-stage-note">80C51 串口方式 1、8 数据位、无校验位的帧示意；按低位在前发送。{uart.status === "ready" ? `在当前示例参数下，TH1=${uart.values?.th_hex}，实际 ${Number(uart.values?.actual_baud).toFixed(1)} baud，量化误差 ${Number(uart.values?.error_percent).toFixed(2)}%。` : uart.summary}</p></div>;
    if (unit === "port") return <div className="cw-port-stage"><div className="cw-leds">{Array.from({ length: 8 }, (_, index) => { const bit = (portValue >> index) & 1; const lit = activeLow ? bit === 0 : bit === 1; return <div key={index}><span className={`cw-led ${lit ? "lit" : ""}`} aria-label={`第${index + 1}盏灯${lit ? "点亮" : "熄灭"}`} /><small>位{index}</small></div>; })}</div><p className="cw-stage-note">写入值 0x{portValue.toString(16).toUpperCase().padStart(2, "0")}；{activeLow ? "低电平点亮" : "高电平点亮"}仅为选定的示意条件。实际端口、位序与极性须以本班开发板为准。</p></div>;
    if (unit === "scan") return <div className="cw-scan-stage"><div className="cw-digits">{Array.from({ length: 8 }, (_, index) => <div key={index} className={`cw-digit ${index === step ? "current" : ""}`}><strong>{index}</strong><small>位 {index + 1}</small></div>)}</div><div className="cw-measure"><div><small>单个位停留</small><strong>{dwell} ms</strong></div><div><small>八位一轮</small><strong>{dwell * 8} ms</strong></div></div><p className="cw-stage-note">本图只显示选通顺序；实际亮度、闪烁与段码取决于驱动电路和刷新实现。</p></div>;
    return <div className="cw-pwm-stage"><div className="cw-pulses">{Array.from({ length: 4 }, (_, index) => <div className={`cw-period ${step === index ? "current" : ""}`} key={index}><span style={{ width: `${duty}%` }} /><small>{index + 1}</small></div>)}</div><div className="cw-measure"><div><small>高电平占比</small><strong>{duty / 100}</strong></div><div><small>步进相序</small><strong>待硬件确认</strong></div></div><p className="cw-stage-note">实验八同时涉及 PWM 与步进电机，但手册的电机描述与驱动器件组合尚未核实。未确认电机类型、驱动板、电源和接线前，本页不生成通电相序或运行结果。</p></div>;
  };
  return <div className="cw-layout"><aside className="cw-sidebar"><nav className="cw-index" aria-label="可视化课件">{COURSEWARE.map(item => <Link key={item.slug} href={`/courseware/${item.slug}`} aria-current={item.slug === unit ? "page" : undefined}><span>{item.number}</span><strong>{item.title}</strong></Link>)}</nav><details className="cw-lab-directory"><summary>八个实验指导 <span>1—8</span></summary><div>{LAB_GUIDES.map(lab => <Link key={lab.id} href={`/?lab=${lab.id}`}><span>{String(lab.id).padStart(2, "0")}</span>{LAB_REPORT_TITLES[lab.id]}</Link>)}</div></details></aside><article className="cw-lesson"><div className="cw-top"><span className="eyebrow">VISUAL LESSON / {lesson.number}</span><h1>{lesson.title}</h1><p>{lesson.subtitle}</p><small>依据：{lesson.source}</small></div><div className="cw-question"><strong>先想一想</strong><p>{lesson.question}</p></div><div className="cw-controls">{unit === "interrupt" && <><label><input type="checkbox" checked={ea} onChange={event => setEa(event.target.checked)} /> EA 全局允许</label><label><input type="checkbox" checked={ex0} onChange={event => setEx0(event.target.checked)} /> EX0 允许外部中断0</label><label><input type="checkbox" checked={it0} onChange={event => setIt0(event.target.checked)} /> IT0 下降沿触发</label></>}{(unit === "timer" || unit === "serial") && <label>示例晶振<select value={clock} onChange={event => setClock(Number(event.target.value))}><option value={12_000_000}>12 MHz（手册条件）</option><option value={11_059_200}>11.0592 MHz（对照）</option></select></label>}{unit === "timer" && <label>单次溢出目标<select value={targetMs} onChange={event => setTargetMs(Number(event.target.value))}>{[10,20,50,70].map(value => <option key={value} value={value}>{value} ms{value === 70 ? "（超范围示例）" : ""}</option>)}</select></label>}{unit === "serial" && <><label>示例字节<select value={dataByte} onChange={event => { setDataByte(Number(event.target.value)); setStep(0); }}><option value={0x55}>0x55</option><option value={0xA5}>0xA5</option></select></label><label>目标波特率<select value={baud} onChange={event => setBaud(Number(event.target.value))}><option value={4800}>4800 baud</option><option value={9600}>9600 baud</option></select></label></>}{unit === "port" && <><label><input type="checkbox" checked={activeLow} onChange={event => setActiveLow(event.target.checked)} /> 低电平点亮示意</label><label>端口写入值<select value={portValue} onChange={event => setPortValue(Number(event.target.value))}>{[0xfe,0xfd,0xfb,0xf7,0x01,0x55].map(value => <option key={value} value={value}>0x{value.toString(16).toUpperCase().padStart(2,"0")}</option>)}</select></label></>}{unit === "scan" && <label>单个位停留时间<select value={dwell} onChange={event => setDwell(Number(event.target.value))}>{[1,5,10,20].map(value => <option key={value} value={value}>{value} ms</option>)}</select></label>}{unit === "pwm" && <label>PWM 占空比<select value={duty} onChange={event => setDuty(Number(event.target.value))}><option value={30}>0.3</option><option value={70}>0.7</option></select></label>}</div><div className={`cw-stage ${unit === "timer" ? "cw-stage-timer" : ""}`} aria-live="polite">{display()}</div>{unit !== "timer" && <div className="cw-playback"><div><span>步骤 {step + 1} / {maxStep}</span><p>{status}</p></div><div className="cw-playback-actions"><button className="btn quiet" onClick={() => { setPlaying(false); setStep(0); }}>重来</button><button className="btn" onClick={() => setStep(value => (value + 1) % maxStep)}>下一步</button><button className="btn primary" onClick={() => setPlaying(value => !value)} aria-pressed={playing} disabled={reducedMotion} title={reducedMotion ? "系统已启用减少动态效果，请使用下一步" : undefined}>{reducedMotion ? "请手动逐步查看" : playing ? "暂停" : "自动演示"}</button></div></div>}<div className="cw-boundary"><strong>使用边界</strong><p>本课件用于理解控制关系和排查顺序。演示参数属于可切换样例；实际晶振、器件、接线、程序输出与评分须按教师确认的本次实验和测量记录判断。</p>{lesson.relatedLabs.length > 0 && <p>对应实验：{lesson.relatedLabs.map(id => `实验${id}`).join("、")}。可直接查看 {lesson.relatedLabs.map(id => <Link key={id} href={`/?lab=${id}`}>实验{id}指导</Link>)}，或返回 <Link href="/">八个实验目录</Link>。</p>}</div></article></div>;
}
