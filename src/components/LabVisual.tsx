import type { ReactNode } from "react";
import { labGuide } from "@/lib/lab-guides";

type Props = { labId: number; compact?: boolean };

const ink = "#174537";
const line = "#88a99a";
const accent = "#b7783e";

function Label({ x, y, children, size = 13 }: { x: number; y: number; children: ReactNode; size?: number }) {
  return <text x={x} y={y} fill={ink} fontSize={size} fontWeight="600" fontFamily="PingFang SC, Noto Sans CJK SC, sans-serif">{children}</text>;
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <g stroke={line} strokeWidth="2" fill="none" strokeLinecap="round"><path d={`M${x1} ${y1} L${x2} ${y2}`} /><path d={`M${x2 - 7} ${y2 - 5} L${x2} ${y2} L${x2 - 7} ${y2 + 5}`} /></g>;
}

function Drawing({ id }: { id: number }) {
  switch (id) {
    case 1:
      return <>
        <Label x={28} y={39}>单步观察</Label>
        <rect x={28} y={58} width={90} height={80} rx={10} fill="#e3eee7" stroke={line} />
        <Label x={55} y={92} size={23}>A</Label><Label x={43} y={120} size={11}>累加器</Label>
        <Arrow x1={128} y1={98} x2={170} y2={98} />
        <rect x={178} y={58} width={90} height={80} rx={10} fill="#fff9ed" stroke={line} />
        <Label x={204} y={92} size={23}>SP</Label><Label x={198} y={120} size={11}>堆栈指针</Label>
        <Arrow x1={278} y1={98} x2={316} y2={98} />
        <rect x={323} y={58} width={70} height={80} rx={9} fill="#fff" stroke={line} />
        {[78,98,118].map((y) => <line key={y} x1={323} y1={y} x2={393} y2={y} stroke="#d4e0d8" />)}
        <Label x={335} y={150} size={11}>RAM / 端口</Label>
        <path d="M30 177 H392" stroke="#cad9cf" strokeWidth="2" strokeDasharray="4 5" />
        <Label x={30} y={199} size={11}>记录指令执行前后数值，再判断寻址与栈操作。</Label>
      </>;
    case 2:
      return <>
        <Label x={28} y={39}>并行 I/O · LED 顺序</Label>
        {Array.from({ length: 8 }, (_, i) => <g key={i}><circle cx={48 + i * 46} cy={93} r={15} fill={i < 4 ? "#d9e9db" : "#fff5e7"} stroke={i === 3 ? accent : line} strokeWidth="2" /><Label x={43 + i * 46} y={98} size={12}>{i + 1}</Label></g>)}
        <path d="M48 135 H370 M370 135 l-8 -6 M370 135 l-8 6" stroke={line} strokeWidth="2" fill="none" />
        <path d="M370 155 H48 M48 155 l8 -6 M48 155 l8 6" stroke={line} strokeWidth="2" fill="none" />
        <Label x={29} y={191} size={11}>往返点亮 → 高低四位交替 → 全亮／全灭</Label>
      </>;
    case 3:
      return <>
        <Label x={28} y={39}>T0 定时 · P0.0 方波</Label>
        <path d="M30 160 H400 M44 58 V177 M390 58 V177" stroke="#d1dfd5" strokeWidth="1.5" />
        <path d="M44 145 H100 V77 H186 V145 H274 V77 H390" fill="none" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
        <path d="M100 184 H274 M100 180 V188 M274 180 V188" stroke={accent} strokeWidth="2" />
        <Label x={146} y={203} size={12}>完整周期 2 s</Label>
        <Label x={303} y={155} size={11}>翻转间隔需另核对</Label>
      </>;
    case 4:
      return <>
        <Label x={28} y={39}>外部中断 0 · 按键计数</Label>
        <circle cx={69} cy={103} r={34} fill="#fff9ed" stroke={line} strokeWidth="2" />
        <path d="M52 100 H83 M60 89 L79 89 M69 89 V100" stroke={ink} strokeWidth="2.5" fill="none" />
        <Label x={58} y={155} size={11}>按键 K</Label>
        <Arrow x1={107} y1={103} x2={145} y2={103} />
        <rect x={151} y={62} width={114} height={83} rx={10} fill="#e3eee7" stroke={line} />
        <Label x={174} y={94} size={17}>P3.2</Label><Label x={171} y={121} size={14}>INT0</Label>
        <Arrow x1={273} y1={103} x2={309} y2={103} />
        <rect x={319} y={62} width={66} height={83} rx={9} fill="#fff" stroke={line} />
        <Label x={337} y={119} size={47}>0</Label>
        <Label x={284} y={171} size={11}>每次按下观察 +1</Label>
      </>;
    case 5:
      return <>
        <Label x={28} y={39}>八位数码管 · 动态扫描</Label>
        {Array.from({ length: 8 }, (_, i) => <g key={i}><rect x={27 + i * 47} y={67} width={38} height={65} rx={6} fill={i === 3 ? "#fff3dd" : "#f8fbf8"} stroke={i === 3 ? accent : line} strokeWidth="2" /><Label x={37 + i * 47} y={113} size={30}>{i}</Label></g>)}
        <path d="M28 157 H390" stroke={line} strokeWidth="2" />
        {Array.from({ length: 8 }, (_, i) => <circle key={i} cx={46 + i * 47} cy={157} r={4} fill={i === 3 ? accent : line} />)}
        <Label x={30} y={194} size={11}>逐位扫描；分开记录单个位间隔与整屏刷新。</Label>
      </>;
    case 6:
      return <>
        <Label x={28} y={39}>蜂鸣器 · 单音到双音</Label>
        <path d="M38 98 H75 L96 77 V137 L75 116 H38 Z" fill="#e3eee7" stroke={line} strokeWidth="2" />
        <path d="M114 81 Q140 105 114 129 M126 66 Q165 105 126 144" fill="none" stroke={ink} strokeWidth="2.5" />
        <path d="M190 121 H231 V83 H272 V121 H311 V73 H352 V121 H392" fill="none" stroke={accent} strokeWidth="3" strokeLinejoin="round" />
        <Label x={193} y={164} size={11}>音 1</Label><Label x={315} y={164} size={11}>音 2</Label>
        <Label x={190} y={192} size={11}>先确认能发声，再核对节奏与间歇。</Label>
      </>;
    case 7:
      return <>
        <Label x={28} y={39}>电子时钟 · 显示与进位</Label>
        <rect x={32} y={64} width={357} height={90} rx={12} fill="#183f32" />
        <text x={54} y={122} fill="#d9f2e0" fontSize="44" fontWeight="700" fontFamily="SFMono-Regular, monospace">xx–yy–zz</text>
        <path d="M75 177 H354" stroke={line} strokeWidth="2" />
        <circle cx={101} cy={177} r={4} fill={accent} /><circle cx={213} cy={177} r={4} fill={accent} /><circle cx={327} cy={177} r={4} fill={accent} />
        <Label x={83} y={202} size={11}>时</Label><Label x={200} y={202} size={11}>分</Label><Label x={314} y={202} size={11}>秒</Label>
      </>;
    case 8:
      return <>
        <Label x={28} y={39}>电机控制 · 两项任务</Label>
        <Label x={29} y={74} size={11}>直流电机 PWM</Label>
        <path d="M30 122 V89 H54 V122 H110 V89 H166 V122 H190" fill="none" stroke={ink} strokeWidth="3" />
        <Label x={46} y={146} size={11}>0.3</Label><Label x={142} y={146} size={11}>0.7</Label>
        <path d="M214 61 V161" stroke="#cad9cf" strokeWidth="1.5" />
        <Label x={235} y={74} size={11}>步进电机相序</Label>
        {['A', 'AB', 'B', 'BC'].map((phase, i) => <g key={phase}><rect x={231 + i * 42} y={91} width={36} height={35} rx={5} fill={i === 1 ? "#fff3dd" : "#e3eee7"} stroke={line} /><Label x={238 + i * 42} y={114} size={11}>{phase}</Label></g>)}
        <Label x={237} y={151} size={11}>接 C → CD → D → DA</Label>
        <Label x={29} y={192} size={11}>驱动器、电源与电机型号须按实物核对。</Label>
      </>;
    default:
      return null;
  }
}

export default function LabVisual({ labId, compact = false }: Props) {
  const guide = labGuide(labId);
  if (!guide) return null;
  return <figure className={`lab-visual ${compact ? "compact" : ""}`}>
    <div className="lab-visual-top"><span>LAB / {String(labId).padStart(2, "0")}</span><span>任务原理示意</span></div>
    <svg viewBox="0 0 420 220" role="img" aria-label={`实验${labId}${guide.title}任务原理示意，非接线图`}>
      <Drawing id={labId} />
    </svg>
    {!compact && <figcaption><span className="lab-visual-mobile-hint">左右滑动查看完整示意。 </span>依据实验指导书任务绘制。仅表示排查对象与观察顺序；具体接线、器件和参数以教师确认的本次实验为准。</figcaption>}
  </figure>;
}
