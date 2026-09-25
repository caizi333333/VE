"use client";
import { useState } from "react";
import type {
  ExperimentConfig,
  ExperimentView,
  FaultId,
  RubricItem,
} from "@/lib/api-types";
import { calculateExperiment } from "@/lib/calculations";
import { api, errorText } from "@/components/client-api";
export default function ExperimentEditor({
  classroomId,
  experiment,
  onSaved,
  onCancel,
}: {
  classroomId: string;
  experiment?: ExperimentView;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(experiment?.name ?? "");
  const [fault, setFault] = useState<FaultId>(
    experiment?.fault_chain_id ?? "timer-isr-not-entered",
  );
  const [config, setConfig] = useState<ExperimentConfig>(
    experiment?.config ?? {},
  );
  const [rubric, setRubric] = useState<RubricItem[]>(experiment?.rubric ?? []);
  const [benches, setBenches] = useState(
    (experiment?.config.benches ?? []).join(", "),
  );
  const [confirmed, setConfirmed] = useState(experiment?.confirmed ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (p: Partial<ExperimentConfig>) => {
    setConfig((c) => ({ ...c, ...p }));
    setConfirmed(false);
  };
  const number = (field: keyof ExperimentConfig, value: string) =>
    patch({ [field]: value === "" ? undefined : Number(value) });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/experiments", {
        classroom_id: classroomId,
        ...(experiment
          ? { id: experiment.id, expected_version: experiment.version }
          : {}),
        name,
        fault_chain_id: fault,
        config: {
          ...config,
          benches: benches
            .split(/[，,\s]+/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        },
        rubric,
        confirmed,
      });
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const changeRubric = (index: number, patch: Partial<RubricItem>) => {
    setRubric((r) => r.map((v, i) => (i === index ? { ...v, ...patch } : v)));
    setConfirmed(false);
  };
  return (
    <section className="card">
      <div className="split-heading">
        <h2>{experiment ? "编辑实验配置" : "配置新实验"}</h2>
        <button className="btn quiet" onClick={onCancel}>
          关闭
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 20 }}>
        参数以实验指导书、芯片资料和实物配置为依据。空项保留待确认，平台将仅提供定性排查。
      </p>
      <form onSubmit={save} className="stack">
        <div className="field-grid">
          <label>
            实验名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label>
            问题范围
            <select
              value={fault}
              onChange={(e) => {
                setFault(e.target.value as FaultId);
                setConfirmed(false);
              }}
            >
              <option value="timer-isr-not-entered">中断不触发</option>
              <option value="uart-garbled">串口乱码</option>
              <option value="timing-inaccurate">定时不准</option>
            </select>
          </label>
          <label>
            芯片型号
            <input
              value={config.chip ?? ""}
              onChange={(e) => patch({ chip: e.target.value })}
              placeholder="按实验板实际型号填写"
            />
          </label>
          <label>
            晶振频率（Hz）
            <input
              type="number"
              min={1}
              value={config.clock_hz ?? ""}
              onChange={(e) => number("clock_hz", e.target.value)}
              placeholder="例如 11059200"
            />
          </label>
          <label>
            每次计数的时钟周期数
            <input
              type="number"
              min={1}
              step={1}
              value={config.clocks_per_tick ?? ""}
              onChange={(e) => number("clocks_per_tick", e.target.value)}
              placeholder="按芯片与分频配置填写"
            />
          </label>
          <label>
            定时器工作方式
            <select
              value={config.timer_mode ?? ""}
              onChange={(e) =>
                patch({
                  timer_mode: e.target.value
                    ? (Number(e.target.value) as 1 | 2)
                    : undefined,
                })
              }
            >
              <option value="">待确认</option>
              <option value="1">方式 1（16位计数）</option>
              <option value="2">方式 2（8位自动重装）</option>
            </select>
          </label>
          {fault === "uart-garbled" ? (
            <>
              <label>
                目标波特率（baud）
                <input
                  type="number"
                  min={1}
                  value={config.target_baud ?? ""}
                  onChange={(e) => number("target_baud", e.target.value)}
                />
              </label>
              <label>
                SMOD 倍速位
                <select
                  value={config.smod ?? ""}
                  onChange={(e) =>
                    patch({
                      smod:
                        e.target.value === ""
                          ? undefined
                          : (Number(e.target.value) as 0 | 1),
                    })
                  }
                >
                  <option value="">待确认</option>
                  <option value="0">0 · 不倍速</option>
                  <option value="1">1 · 倍速</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                单次溢出间隔（ms）
                <input
                  type="number"
                  min={0.000001}
                  step="any"
                  value={config.target_ms ?? ""}
                  onChange={(e) => number("target_ms", e.target.value)}
                />
              </label>
              <label>
                时间口径
                <select
                  value={config.time_definition ?? ""}
                  onChange={(e) => patch({ time_definition: e.target.value })}
                >
                  <option value="">待确认</option>
                  <option value="单次溢出间隔">单次溢出间隔</option>
                </select>
                <span className="inline-help">
                  本轮计算只支持单次溢出间隔。完整输出周期请先按翻转次数或计数逻辑换算。
                </span>
              </label>
            </>
          )}
          <label>
            允许误差（%）
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={config.tolerance_percent ?? ""}
              onChange={(e) => number("tolerance_percent", e.target.value)}
            />
          </label>
          <label>
            编译或测量工具
            <input
              value={config.toolchain ?? ""}
              onChange={(e) => patch({ toolchain: e.target.value })}
              placeholder="名称及版本或设备型号"
            />
          </label>
          <label className="full">
            验证方式
            <textarea
              rows={2}
              value={config.verification_method ?? ""}
              onChange={(e) => patch({ verification_method: e.target.value })}
              placeholder="说明测量对象、测试方式和通过标准"
            />
          </label>
          <label className="full">
            可选工位
            <input
              value={benches}
              onChange={(e) => {
                setBenches(e.target.value);
                setConfirmed(false);
              }}
              placeholder="用逗号分隔，例如 A1, A2, B1"
            />
            <span className="inline-help">
              工位格式为大写字母加数字。未填写时，学生仅可选择未分配。
            </span>
          </label>
        </div>
        <details className="task-card" open>
          <summary>参数计算参考</summary>
          {calculateExperiment(config, fault).map((result, i) => (
            <div key={i}>
              <p>{result.summary}</p>
              {result.formula && (
                <p
                  className="muted"
                  style={{ overflowWrap: "anywhere", marginTop: 10 }}
                >
                  {result.formula}
                </p>
              )}
              <ul className="muted" style={{ paddingLeft: 22, marginTop: 10 }}>
                {result.notes.map((n, j) => (
                  <li key={j}>{n}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
        <section>
          <div className="split-heading">
            <h3>
              评分量规 · 满分合计 {rubric.reduce((n, r) => n + r.max_score, 0)}
            </h3>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRubric((r) => [
                  ...r,
                  {
                    id: `rubric-${crypto.randomUUID().slice(0, 8)}`,
                    label: "",
                    max_score: 0,
                    criterion: "",
                  },
                ]);
                setConfirmed(false);
              }}
            >
              ＋ 添加评价项
            </button>
          </div>
          {rubric.length === 0 && (
            <p className="notice warning">
              尚未设置量规。正式确认实验前需配置合计100分的评价项。
            </p>
          )}
          <div className="stack-sm">
            {rubric.map((r, i) => (
              <div className="task-card" key={r.id}>
                <div className="field-grid">
                  <label>
                    评价项
                    <input
                      value={r.label}
                      onChange={(e) =>
                        changeRubric(i, { label: e.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    满分
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={r.max_score}
                      onChange={(e) =>
                        changeRubric(i, { max_score: Number(e.target.value) })
                      }
                      required
                    />
                  </label>
                  <label className="full">
                    评分依据
                    <textarea
                      rows={2}
                      value={r.criterion}
                      onChange={(e) =>
                        changeRubric(i, { criterion: e.target.value })
                      }
                      required
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn quiet"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setRubric((rs) => rs.filter((_, n) => i !== n));
                    setConfirmed(false);
                  }}
                >
                  删除评价项
                </button>
              </div>
            ))}
          </div>
        </section>
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我已核对硬件参数、验证方式和评分量规，确认本实验配置
        </label>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button className="btn primary" disabled={busy}>
            {busy
              ? "正在保存…"
              : confirmed
                ? "保存并确认实验"
                : "保存为待确认配置"}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </form>
    </section>
  );
}
