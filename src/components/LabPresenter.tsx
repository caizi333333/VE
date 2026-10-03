"use client";
import { useEffect, useRef, useState } from "react";
import { presenterScript } from "@/lib/lab-presenter";

const SPOTLIGHT_MS = 1800;

/**
 * 课堂演示面板：教师投屏按 ←/→ 逐页推进备课脚本。
 * 每步给讲解词、现场操作、提问与预期答案；“定位”把相关页面区块
 * 滚到屏幕中央并短暂高亮。面板只呈现脚本，不代替页面上的实际操作。
 */
export default function LabPresenter({ labId, onClose }: { labId: number; onClose: () => void }) {
  const script = presenterScript(labId);
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const spotlighted = useRef<Element | null>(null);

  useEffect(() => {
    setIndex(0);
    spotlighted.current?.classList.remove("presenter-spotlight");
    spotlighted.current = null;
  }, [labId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") {
        setIndex((i) => Math.min(i + 1, (script?.steps.length ?? 1) - 1));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        setIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, script?.steps.length]);

  if (!script) return null;
  const step = script.steps[Math.min(index, script.steps.length - 1)];

  const focusTarget = () => {
    if (!step.target) return;
    const el = document.querySelector(step.target);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    spotlighted.current?.classList.remove("presenter-spotlight");
    el.classList.add("presenter-spotlight");
    spotlighted.current = el;
    window.setTimeout(() => el.classList.remove("presenter-spotlight"), SPOTLIGHT_MS);
  };

  return (
    <div className="lab-presenter" role="dialog" aria-label={`实验${labId}课堂演示脚本`} ref={panelRef}>
      <div className="lab-presenter-head">
        <span className="eyebrow">课堂演示 · 实验{labId} · 第 {index + 1} / {script.steps.length} 步</span>
        <div className="lab-presenter-head-actions">
          <button type="button" className="btn quiet" onClick={onClose} aria-label="关闭演示面板">结束演示</button>
        </div>
      </div>
      <h3 className="lab-presenter-title">{step.title}</h3>
      <p className="lab-presenter-say">{step.say}</p>
      {step.action && <p className="lab-presenter-line"><strong>操作</strong>{step.action}</p>}
      {step.ask && <p className="lab-presenter-line"><strong>提问</strong>{step.ask}</p>}
      {step.expect && <p className="lab-presenter-line"><strong>预期</strong>{step.expect}</p>}
      <div className="lab-presenter-nav">
        <button type="button" className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>← 上一步</button>
        {step.target && <button type="button" className="btn quiet" onClick={focusTarget}>定位到页面</button>}
        <button type="button" className="btn primary" disabled={index >= script.steps.length - 1} onClick={() => setIndex(index + 1)}>下一步 →</button>
      </div>
      <p className="lab-presenter-hint">←→ 方向键翻页 · Esc 结束。脚本为备课口径，操作以页面实际为准。</p>
    </div>
  );
}
