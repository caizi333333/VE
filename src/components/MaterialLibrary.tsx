"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { api, errorText } from "@/components/client-api";

type Material = { id: string; lab_id: number; kind: string; title: string; file_name: string; mime_type: string; byte_size: number; published: boolean; version: number; url: string };
const kindLabels: Record<string, string> = { guide: "实验指导", diagram: "示意图", manual: "设备说明", report: "实验报告", other: "其他资料" };
export default function MaterialLibrary({ classroomId, labId, teacher = false }: { classroomId: string; labId: number; teacher?: boolean }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("guide");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    if (!classroomId || !labId) { setMaterials([]); return; }
    try {
      const params = new URLSearchParams({ classroom_id: classroomId, lab_id: String(labId) });
      const response = await api<{ materials: Material[] }>(`/api/materials?${params}`);
      setMaterials(response.materials);
      setError("");
    } catch (cause) { setError(errorText(cause)); }
  }, [classroomId, labId]);
  useEffect(() => { void load(); }, [load]);
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.set("classroom_id", classroomId);
      form.set("lab_id", String(labId));
      form.set("title", title.trim());
      form.set("kind", kind);
      form.set("published", "false");
      form.set("file", file);
      const response = await fetch("/api/materials", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "上传失败");
      setTitle(""); setFile(null); setMessage("已保存为未发布资料。核对内容后再向学生开放。");
      const input = document.getElementById("material-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await load();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const change = async (material: Material, action: "update" | "remove", next?: { title: string; published: boolean }) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await api("/api/materials", { action, classroom_id: classroomId, id: material.id, version: material.version, ...next });
      setMessage(action === "remove" ? "资料已从列表移除。" : next?.published ? "已向本班学生开放。" : "已保存，学生暂不可见。");
      await load();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <section className="material-library" aria-label={teacher ? "本班实验资料管理" : "本实验参考资料"}>
    <div className="material-head"><div><span className="eyebrow">SOURCE / {String(labId).padStart(2, "0")}</span><h3>{teacher ? "本实验资料" : "教师提供的参考资料"}</h3></div><span className="material-count">{materials.length} 件</span></div>
    {teacher && <form className="material-upload" onSubmit={upload}>
      <label>资料名称<input value={title} onChange={e => setTitle(e.target.value)} required minLength={2} maxLength={100} placeholder="如：本次实验板接线图" /></label>
      <label>资料类别<select value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(kindLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>选择文件<input id="material-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.pptx" onChange={e => setFile(e.target.files?.[0] ?? null)} required /></label>
      <button className="btn primary" disabled={busy || !file}>{busy ? "保存中…" : "上传并保存"}</button>
      <p className="inline-help">单件不超过 8 MB。先保存为未发布，核对板卡型号和内容后再开放。</p>
    </form>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {materials.length ? <ul className="material-list">{materials.map(item => <li key={item.id}>
      {item.mime_type.startsWith("image/") && <a className="material-thumbnail" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`查看${item.title}原图`}><Image src={item.url} alt={item.title} width={180} height={118} unoptimized /></a>}
      <div className="material-file"><span className="material-kind">{kindLabels[item.kind] ?? "资料"}</span><strong>{item.title}</strong><small>{item.file_name} · {(item.byte_size / 1024 / 1024).toFixed(2)} MB {teacher && (item.published ? "· 已向学生开放" : "· 未发布")}</small></div>
      <div className="material-actions"><a className="btn quiet" href={item.url} target="_blank" rel="noopener noreferrer">查看文件</a>{teacher && <><button className="btn quiet" disabled={busy} onClick={() => { const next = window.prompt("资料名称", item.title)?.trim(); if (next && next.length >= 2 && next.length <= 100) void change(item, "update", { title: next, published: item.published }); }}>改名</button><button className="btn" disabled={busy} onClick={() => void change(item, "update", { title: item.title, published: !item.published })}>{item.published ? "撤回" : "发布"}</button><button className="btn quiet" disabled={busy} onClick={() => { if (window.confirm(`移除“${item.title}”？已下载的副本不会被删除。`)) void change(item, "remove"); }}>移除</button></>}</div>
    </li>)}</ul> : <p className="material-empty">{teacher ? "本实验尚未上传资料。可先上传原理图、设备说明或报告模板。" : "本班教师尚未发布补充文件；本页的任务与检查要点仍可使用。"}</p>}
  </section>;
}
