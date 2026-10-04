"use client";
import { useEffect, useRef, useState } from "react";
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
  isa: [
    "把常数 58H 直接写进累加器 A——操作数就在指令里，这叫立即寻址。",
    "常数 7FH 写进 RAM 30H 单元——立即数作源、直接地址作目的。",
    "把栈底定在 40H：之后 PUSH/POP 都围着 SP 转。",
    "PUSH：SP 先加 1 指向 41H，再把 A 存进去。SP=41H，栈顶就是 41H。",
    "再压 30H：SP=42H，41H、42H 里依次是 A 和 30H 的值。",
    "故意把 A 清零，模拟“主程序用掉了这个寄存器”。",
    "30H 也被改写——两个现场都丢了，只能靠栈找回来。",
    "POP 30H：最后进栈的 42H 内容先出来。后进先出，30H 恢复 7FH。",
    "POP ACC：A 恢复 58H，SP 回到 40H。弹栈顺序必须与压栈相反。",
    "SJMP $ 原地循环；寄存器不再变化。现场完整恢复——这就是保护现场。",
  ],
  buzzer: ["P2.0 按程序节奏翻转；蜂鸣器听到什么，取决于器件类型。", "有源蜂鸣器内置振荡：加电就响，程序只能改“响多久、停多久”的节奏。", "无源蜂鸣器要等方波：翻转频率就是音高，两段不同延时就是两个音。", "仿真只到控制脚。能否驱动、声音大小，以本班器件与接线实测为准。"],
};

/** 实验一示例程序的逐步状态（与实验页默认示例同源）。 */
const ISA_STEPS = [
  { code: "MOV A,#58H", mode: "立即寻址", changed: ["A"], regs: { a: 0x58, sp: 0x07, r30: 0x00, r41: 0x00, r42: 0x00 } },
  { code: "MOV 30H,#7FH", mode: "立即→直接", changed: ["30H"], regs: { a: 0x58, sp: 0x07, r30: 0x7f, r41: 0x00, r42: 0x00 } },
  { code: "MOV SP,#40H", mode: "立即寻址", changed: ["SP"], regs: { a: 0x58, sp: 0x40, r30: 0x7f, r41: 0x00, r42: 0x00 } },
  { code: "PUSH ACC", mode: "栈操作", changed: ["SP", "41H"], regs: { a: 0x58, sp: 0x41, r30: 0x7f, r41: 0x58, r42: 0x00 } },
  { code: "PUSH 30H", mode: "栈操作", changed: ["SP", "42H"], regs: { a: 0x58, sp: 0x42, r30: 0x7f, r41: 0x58, r42: 0x7f } },
  { code: "MOV A,#00H", mode: "立即寻址", changed: ["A"], regs: { a: 0x00, sp: 0x42, r30: 0x7f, r41: 0x58, r42: 0x7f } },
  { code: "MOV 30H,#00H", mode: "立即→直接", changed: ["30H"], regs: { a: 0x00, sp: 0x42, r30: 0x00, r41: 0x58, r42: 0x7f } },
  { code: "POP 30H", mode: "栈操作", changed: ["30H", "SP"], regs: { a: 0x00, sp: 0x41, r30: 0x7f, r41: 0x58, r42: 0x7f } },
  { code: "POP ACC", mode: "栈操作", changed: ["A", "SP"], regs: { a: 0x58, sp: 0x40, r30: 0x7f, r41: 0x58, r42: 0x7f } },
  { code: "SJMP $", mode: "相对寻址", changed: [], regs: { a: 0x58, sp: 0x40, r30: 0x7f, r41: 0x58, r42: 0x7f } },
] as const;

export default function CoursewareStudio({ unit }: { unit: CoursewareSlug }) {
  const lesson = COURSEWARE.find(item => item.slug === unit)!;
  const maxStep = unit === "serial" ? 10 : unit === "isa" ? ISA_STEPS.length : unit === "scan" ? 8 : 4;
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
  const [buzzerDevice, setBuzzerDevice] = useState<"active" | "passive">("active");
  const [buzzerMode, setBuzzerMode] = useState<"beep" | "two-tone">("beep");
  const [buzzerP1, setBuzzerP1] = useState(400);
  const [buzzerP2, setBuzzerP2] = useState(600);
  const audioRef = useRef<AudioContext | null>(null);
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
  const status = descriptions[unit][unit === "serial" ? (step === 0 ? 0 : step === 9 ? 3 : step < 5 ? 1 : 2) : unit === "isa" ? step : Math.min(3, Math.floor(step / (maxStep / 4)))];
  /** 蜂鸣器波形分段：间断为“响/停”×2，双音为两种半周期各两拍。 */
  const buzzerSegments = buzzerMode === "beep"
    ? [{ level: 1, ms: buzzerP1, tone: 1 }, { level: 0, ms: buzzerP2, tone: 1 }, { level: 1, ms: buzzerP1, tone: 1 }, { level: 0, ms: buzzerP2, tone: 1 }]
    : [{ level: 1, ms: buzzerP1, tone: 1 }, { level: 0, ms: buzzerP1, tone: 1 }, { level: 1, ms: buzzerP1, tone: 1 }, { level: 0, ms: buzzerP1, tone: 1 }, { level: 1, ms: buzzerP2, tone: 2 }, { level: 0, ms: buzzerP2, tone: 2 }, { level: 1, ms: buzzerP2, tone: 2 }, { level: 0, ms: buzzerP2, tone: 2 }];
  const buzzerTotal = buzzerSegments.reduce((sum, seg) => sum + seg.ms, 0);
  const buzzerWave = (() => {
    const W = 620, H = 70, mid = 12, low = H - 10;
    let x = 0;
    const pts: string[] = [`0,${buzzerSegments[0].level ? mid : low}`];
    buzzerSegments.forEach((seg) => { const nx = x + (seg.ms / buzzerTotal) * W; pts.push(`${x},${seg.level ? mid : low}`, `${nx},${seg.level ? mid : low}`); x = nx; });
    pts.push(`${W},${buzzerSegments[buzzerSegments.length - 1].level ? mid : low}`);
    return pts.join(" ");
  })();
  const playBuzzer = () => {
    try {
      audioRef.current ??= new AudioContext();
      const ctx = audioRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination); gain.gain.value = 0;
      let t = ctx.currentTime + 0.05;
      buzzerSegments.forEach((seg) => {
        const periodMs = buzzerMode === "beep" ? buzzerP1 + buzzerP2 : 2 * (seg.tone === 1 ? buzzerP1 : buzzerP2);
        osc.frequency.setValueAtTime(buzzerDevice === "active" ? 800 : Math.min(4000, Math.max(50, 1000 / periodMs)), t);
        gain.gain.setValueAtTime(seg.level ? 0.12 : 0, t);
        t += Math.min(seg.ms, 600) / 1000;
      });
      gain.gain.setValueAtTime(0, t);
      osc.start(); osc.stop(t + 0.05);
    } catch { /* 无音频设备或浏览器拦截时静默 */ }
  };
  const display = () => {
    if (unit === "interrupt") return <div className="cw-flow" role="img" aria-label="外部中断通路示意">
      {[["P3.2 / K", "输入", true], ["EA", ea ? "已开放" : "已关闭", ea], ["EX0", ex0 ? "已开放" : "已关闭", ex0], ["INT0 服务", ea && ex0 ? "可进入" : "通路阻断", ea && ex0]].map(([name, note, enabled], index) => <div key={String(name)} className={`cw-flow-node ${step === index ? "current" : ""} ${enabled ? "" : "off"}`}><span>{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong><small>{note}</small></div>)}
      <p className="cw-stage-note">触发方式：IT0={it0 ? "1（下降沿）" : "0（低电平）"}；按键抖动和输入波形不在示意中模拟。</p>
    </div>;
    if (unit === "timer") return <TimerWaveform clock={clock} targetMs={targetMs} initialHex={timer.status === "ready" ? String(timer.values?.initial_hex) : undefined} formula={timer.formula} />;
    if (unit === "serial") return <div className="cw-serial-stage"><div className="cw-bits">{bits.map((bit, index) => <div key={index} className={`cw-bit ${index === step ? "current" : ""}`}><small>{index === 0 ? "起始" : index === 9 ? "停止" : `D${index - 1}`}</small><strong>{bit}</strong></div>)}</div><p className="cw-stage-note">80C51 串口方式 1、8 数据位、无校验位的帧示意；按低位在前发送。{uart.status === "ready" ? `在当前示例参数下，TH1=${uart.values?.th_hex}，实际 ${Number(uart.values?.actual_baud).toFixed(1)} baud，量化误差 ${Number(uart.values?.error_percent).toFixed(2)}%。` : uart.summary}</p></div>;
    if (unit === "port") return <div className="cw-port-stage"><div className="cw-leds">{Array.from({ length: 8 }, (_, index) => { const bit = (portValue >> index) & 1; const lit = activeLow ? bit === 0 : bit === 1; return <div key={index}><span className={`cw-led ${lit ? "lit" : ""}`} aria-label={`第${index + 1}盏灯${lit ? "点亮" : "熄灭"}`} /><small>位{index}</small></div>; })}</div><p className="cw-stage-note">写入值 0x{portValue.toString(16).toUpperCase().padStart(2, "0")}；{activeLow ? "低电平点亮" : "高电平点亮"}仅为选定的示意条件。实际端口、位序与极性须以本班开发板为准。</p></div>;
    if (unit === "scan") return <div className="cw-scan-stage"><div className="cw-digits">{Array.from({ length: 8 }, (_, index) => <div key={index} className={`cw-digit ${index === step ? "current" : ""}`}><strong>{index}</strong><small>位 {index + 1}</small></div>)}</div><div className="cw-measure"><div><small>单个位停留</small><strong>{dwell} ms</strong></div><div><small>八位一轮</small><strong>{dwell * 8} ms</strong></div></div><p className="cw-stage-note">本图只显示选通顺序；实际亮度、闪烁与段码取决于驱动电路和刷新实现。</p></div>;
    if (unit === "pwm") return <div className="cw-pwm-stage"><div className="cw-pulses">{Array.from({ length: 4 }, (_, index) => <div className={`cw-period ${step === index ? "current" : ""}`} key={index}><span style={{ width: `${duty}%` }} /><small>{index + 1}</small></div>)}</div><div className="cw-measure"><div><small>高电平占比</small><strong>{duty / 100}</strong></div><div><small>步进相序</small><strong>待硬件确认</strong></div></div><p className="cw-stage-note">实验八同时涉及 PWM 与步进电机，但手册的电机描述与驱动器件组合尚未核实。未确认电机类型、驱动板、电源和接线前，本页不生成通电相序或运行结果。</p></div>;
    if (unit === "isa") {
      const current = ISA_STEPS[step];
      const regs: [string, number][] = [["A", current.regs.a], ["SP", current.regs.sp], ["30H", current.regs.r30], ["41H", current.regs.r41], ["42H", current.regs.r42]];
      return <div className="cw-isa-stage"><div className="cw-isa-code">{ISA_STEPS.map((item, index) => <div key={item.code + index} className={`cw-isa-line ${index === step ? "current" : index < step ? "done" : ""}`}><small>{index + 1}</small><code>{item.code}</code><span>{item.mode}</span></div>)}</div><div className="cw-isa-regs">{regs.map(([name, value]) => <div key={name} className={`cw-isa-reg ${(current.changed as readonly string[]).includes(name) ? "changed" : ""}`}><small>{name}</small><strong>{value === 0 && name !== "A" && name !== "SP" ? "—" : `0x${value.toString(16).toUpperCase().padStart(2, "0")}`}</strong></div>)}<p className="cw-isa-stack-note">SP 指向栈顶；栈向高地址生长。41H、42H 是本次压栈占用的单元。</p></div><p className="cw-stage-note">与实验页默认示例同一段程序（AS31 汇编、s51 执行）；本页按指令逐步展示寄存器结果，用来先看懂，再到实验页上单步核对。</p></div>;
    }
    const segmentOffsets = (() => { let x = 0; return buzzerSegments.map((seg) => { const start = x; x += seg.ms; return start; }); })();
    const activeSegIndex = Math.min(step === 0 ? 0 : step - 1, buzzerSegments.length - 1);
    return <div className="cw-buzzer-stage"><svg viewBox="0 0 620 82" role="img" aria-label="P2.0 控制脚波形示意"><line x1="0" y1="6" x2="620" y2="6" stroke="#c9d9cd" strokeDasharray="4 4" /><line x1="0" y1="76" x2="620" y2="76" stroke="#c9d9cd" strokeDasharray="4 4" /><polyline points={buzzerWave} fill="none" stroke="#176348" strokeWidth="2.5" />{buzzerSegments.map((seg, index) => index === activeSegIndex && seg.level ? <rect key={index} x={segmentOffsets[index] / buzzerTotal * 620} y={8} width={seg.ms / buzzerTotal * 620} height={66} fill="#d97b2f22" stroke="#d97b2f" strokeDasharray="3 3" /> : null)}<text x="6" y="14" fontSize="10" fill="#53715d">高</text><text x="6" y="80" fontSize="10" fill="#53715d">低</text></svg><div className="cw-buzzer-read"><div className={step === 1 ? "current" : ""}><small>有源蜂鸣器</small><strong>只改节奏</strong><p>内置振荡，通电即响；程序的高/低段时长决定“响多久、停多久”。改延时听不到音高变化。</p></div><div className={step === 2 ? "current" : ""}><small>无源蜂鸣器</small><strong>频率定音高</strong><p>靠方波驱动；翻转周期决定音高。当前参数约 {buzzerMode === "beep" ? "间断节奏" : `${Math.round(1000 / (2 * buzzerP1))} Hz / ${Math.round(1000 / (2 * buzzerP2))} Hz 两音`}。</p></div><div className={step === 3 ? "current" : ""}><small>实物边界</small><strong>以本班为准</strong><p>器件类型、三极管驱动、电源与可闻响度都需实物核实；本页波形是控制脚示意。</p></div></div><p className="cw-stage-note">波形按所选参数绘制；总时长约 {buzzerTotal} ms（示意）。试听为简化合成音，只表达节奏/相对音高，不代表实物音色。</p></div>;
  };
  return <div className="cw-layout"><aside className="cw-sidebar"><nav className="cw-index" aria-label="可视化课件">{COURSEWARE.map(item => <Link key={item.slug} href={`/courseware/${item.slug}`} aria-current={item.slug === unit ? "page" : undefined}><span>{item.number}</span><strong>{item.title}</strong></Link>)}</nav><details className="cw-lab-directory"><summary>八个实验指导 <span>1—8</span></summary><div>{LAB_GUIDES.map(lab => <Link key={lab.id} href={`/?lab=${lab.id}`}><span>{String(lab.id).padStart(2, "0")}</span>{LAB_REPORT_TITLES[lab.id]}</Link>)}</div></details></aside><article className="cw-lesson"><div className="cw-top"><span className="eyebrow">VISUAL LESSON / {lesson.number}</span><h1>{lesson.title}</h1><p>{lesson.subtitle}</p><small>依据：{lesson.source}</small></div><div className="cw-question"><strong>先想一想</strong><p>{lesson.question}</p></div><div className="cw-controls">{unit === "interrupt" && <><label><input type="checkbox" checked={ea} onChange={event => setEa(event.target.checked)} /> EA 全局允许</label><label><input type="checkbox" checked={ex0} onChange={event => setEx0(event.target.checked)} /> EX0 允许外部中断0</label><label><input type="checkbox" checked={it0} onChange={event => setIt0(event.target.checked)} /> IT0 下降沿触发</label></>}{(unit === "timer" || unit === "serial") && <label>示例晶振<select value={clock} onChange={event => setClock(Number(event.target.value))}><option value={12_000_000}>12 MHz（手册条件）</option><option value={11_059_200}>11.0592 MHz（对照）</option></select></label>}{unit === "timer" && <label>单次溢出目标<select value={targetMs} onChange={event => setTargetMs(Number(event.target.value))}>{[10,20,50,70].map(value => <option key={value} value={value}>{value} ms{value === 70 ? "（超范围示例）" : ""}</option>)}</select></label>}{unit === "serial" && <><label>示例字节<select value={dataByte} onChange={event => { setDataByte(Number(event.target.value)); setStep(0); }}><option value={0x55}>0x55</option><option value={0xA5}>0xA5</option></select></label><label>目标波特率<select value={baud} onChange={event => setBaud(Number(event.target.value))}><option value={4800}>4800 baud</option><option value={9600}>9600 baud</option></select></label></>}{unit === "port" && <><label><input type="checkbox" checked={activeLow} onChange={event => setActiveLow(event.target.checked)} /> 低电平点亮示意</label><label>端口写入值<select value={portValue} onChange={event => setPortValue(Number(event.target.value))}>{[0xfe,0xfd,0xfb,0xf7,0x01,0x55].map(value => <option key={value} value={value}>0x{value.toString(16).toUpperCase().padStart(2,"0")}</option>)}</select></label></>}{unit === "scan" && <label>单个位停留时间<select value={dwell} onChange={event => setDwell(Number(event.target.value))}>{[1,5,10,20].map(value => <option key={value} value={value}>{value} ms</option>)}</select></label>}{unit === "pwm" && <label>PWM 占空比<select value={duty} onChange={event => setDuty(Number(event.target.value))}><option value={30}>0.3</option><option value={70}>0.7</option></select></label>}{unit === "buzzer" && <><label>器件类型<select value={buzzerDevice} onChange={event => setBuzzerDevice(event.target.value as "active" | "passive")}><option value="active">有源（内置振荡）</option><option value="passive">无源（需方波驱动）</option></select></label><label>发声模式<select value={buzzerMode} onChange={event => { const mode = event.target.value as "beep" | "two-tone"; setBuzzerMode(mode); if (mode === "two-tone") { setBuzzerP1(2); setBuzzerP2(1); } else { setBuzzerP1(400); setBuzzerP2(600); } }}><option value="beep">间断发声（对照 S61）</option><option value="two-tone">双音交替（对照 S62）</option></select></label><label>{buzzerMode === "beep" ? "响的时长" : "第一音半周期"}<select value={buzzerP1} onChange={event => setBuzzerP1(Number(event.target.value))}>{buzzerMode === "beep" ? [200, 400, 600].map(v => <option key={v} value={v}>{v} ms</option>) : [1, 2, 4].map(v => <option key={v} value={v}>{v} ms</option>)}</select></label><label>{buzzerMode === "beep" ? "停的时长" : "第二音半周期"}<select value={buzzerP2} onChange={event => setBuzzerP2(Number(event.target.value))}>{buzzerMode === "beep" ? [300, 600, 900].map(v => <option key={v} value={v}>{v} ms</option>) : [1, 2, 4].map(v => <option key={v} value={v}>{v} ms</option>)}</select></label><button className="btn quiet" type="button" onClick={playBuzzer}>试听示意音</button></>}</div><div className={`cw-stage ${unit === "timer" ? "cw-stage-timer" : ""}`} aria-live="polite">{display()}</div>{unit !== "timer" && <div className="cw-playback"><div><span>步骤 {step + 1} / {maxStep}</span><p>{status}</p></div><div className="cw-playback-actions"><button className="btn quiet" onClick={() => { setPlaying(false); setStep(0); }}>重来</button><button className="btn" onClick={() => setStep(value => (value + 1) % maxStep)}>下一步</button><button className="btn primary" onClick={() => setPlaying(value => !value)} aria-pressed={playing} disabled={reducedMotion} title={reducedMotion ? "系统已启用减少动态效果，请使用下一步" : undefined}>{reducedMotion ? "请手动逐步查看" : playing ? "暂停" : "自动演示"}</button></div></div>}<div className="cw-boundary"><strong>使用边界</strong><p>本课件用于理解控制关系和排查顺序。演示参数属于可切换样例；实际晶振、器件、接线、程序输出与评分须按教师确认的本次实验和测量记录判断。</p>{lesson.relatedLabs.length > 0 && <p>对应实验：{lesson.relatedLabs.map(id => `实验${id}`).join("、")}。可直接查看 {lesson.relatedLabs.map(id => <Link key={id} href={`/?lab=${id}`}>实验{id}指导</Link>)}，或返回 <Link href="/">八个实验目录</Link>。</p>}</div></article></div>;
}
