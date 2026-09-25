export type LoopStep = "submit" | "wait" | "probe" | "report" | "task";
const STEPS: { id: LoopStep; label: string }[] = [
  { id: "submit", label: "提交现象" },
  { id: "wait", label: "等待教师审核" },
  { id: "probe", label: "执行检查" },
  { id: "report", label: "提交验证" },
  { id: "task", label: "进阶练习" },
];
export default function LoopRail({ current }: { current: LoopStep }) {
  const index = Math.max(
    0,
    STEPS.findIndex((s) => s.id === current),
  );
  return (
    <>
      <div className="mobile-progress">
        <span>
          第 {index + 1} / 5 步 · <strong>{STEPS[index].label}</strong>
        </span>
        <meter min={0} max={5} value={index + 1} aria-label="实验进度" />
      </div>
      <ol className="loop-rail" aria-label="实验进度">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={i === index ? "active" : i < index ? "done" : ""}
            aria-current={i === index ? "step" : undefined}
          >
            <span className="step-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    </>
  );
}
