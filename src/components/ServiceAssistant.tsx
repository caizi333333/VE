"use client";
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import logo from '@/app/icon.png';
type Reply = { title: string; answer: string; href: string; action: string; mode: string };
type Message = { question: string; reply: Reply };
export function WorkspaceNav() {
  const teacher = usePathname().startsWith('/teacher');
  return <nav className="workspace-switch" aria-label="当前工作区"><Link href="/" aria-current={!teacher ? 'page' : undefined}>学生实验台</Link><Link href="/teacher" aria-current={teacher ? 'page' : undefined}>教师工作台</Link></nav>;
}

export default function ServiceAssistant() {
  const pathname = usePathname();
  const teacher = pathname.startsWith('/teacher');
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [smart, setSmart] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { if (open) { dialog.current?.showModal(); input.current?.focus(); } else dialog.current?.close(); }, [open]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { tail.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);
  function close() { controller.current?.abort(); setBusy(false); setOpen(false); launcher.current?.focus(); }
  async function send(text: string) {
    if (controller.current || !text.trim()) return;
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 12000);
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, smart }), signal: abort.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '暂时无法回答，请重试');
      setMessages(prev => [...prev.slice(-9), { question: text, reply: body }]); setQuestion('');
    } catch (e) { setError(e instanceof Error && e.name !== 'AbortError' ? e.message : '请求已取消或超时，内容已保留，可重新发送。'); }
    finally { window.clearTimeout(timeout); controller.current = null; setBusy(false); }
  }
  const suggestions = teacher ? ['如何准备一堂实验课？', '如何审核发布？', '怎样查看课堂统计？'] : ['如何加入课堂？', '一直等待教师怎么办？', '卡住后如何继续？'];
  return <>
    <button ref={launcher} className="assistant-launcher" onClick={() => setOpen(true)} aria-label="打开实验助手" aria-haspopup="dialog" aria-expanded={open} aria-controls="service-assistant"><span aria-hidden="true"><Image src={logo} alt="" width={42} height={42} sizes="42px" /></span><span>实验助手<small>需要帮助？</small></span></button>
    <dialog ref={dialog} id="service-assistant" className="assistant-panel" aria-labelledby="assistant-title" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
      <header className="assistant-heading"><div><span className="eyebrow">LAB COMPANION</span><h2 id="assistant-title">实验助手</h2></div><button className="btn quiet" onClick={close} aria-label="关闭实验助手">✕</button></header>
      <div className="assistant-conversation" role="log" aria-live="polite" aria-relevant="additions">
        <div className="assistant-welcome"><span className="assistant-symbol" aria-hidden="true"><Image src={logo} alt="" width={42} height={42} sizes="42px" /></span><h3>一起找到下一步。</h3><p>帮助你操作平台、理解状态。实验诊疗与评分由教师审核。</p></div>
        {messages.map((m, i) => <section className="assistant-turn" key={i}><p className="assistant-question">{m.question}</p><h3>{m.reply.title}</h3><p>{m.reply.answer}</p><a href={m.reply.href} onClick={e => { if (m.reply.href === pathname) e.preventDefault(); close(); }}>{m.reply.action} ↗</a><small>{m.reply.mode === 'smart' ? '智能匹配 · 平台操作指引' : m.reply.mode === 'fallback' ? '智能服务暂不可用 · 已返回基础指引' : '平台操作指引'}</small></section>)}
        {busy && <p role="status" className="assistant-thinking">正在查找操作指引…</p>}<div ref={tail} />
      </div>
      <div className="assistant-prompts">{messages.length === 0 ? suggestions.map(q => <button key={q} disabled={busy} onClick={() => { setQuestion(q); void send(q); }}>{q}<span aria-hidden="true">↗</span></button>) : <button disabled={busy} onClick={() => { setMessages([]); setError(''); input.current?.focus(); }}>查看其他常见问题<span aria-hidden="true">↗</span></button>}</div>
      <form className="assistant-form" onSubmit={e => { e.preventDefault(); void send(question); }}>
        <label htmlFor="assistant-question">你卡在哪一步？</label><textarea ref={input} id="assistant-question" rows={2} maxLength={600} value={question} disabled={busy} placeholder="请勿填写姓名、密码或恢复码" onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(question); } }} />
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="row between"><label className="check-label"><input type="checkbox" checked={smart} disabled={busy} onChange={e => setSmart(e.target.checked)} />智能匹配</label><button className="btn primary" disabled={busy || !question.trim()}>{busy ? '查找中…' : '发送 ↑'}</button></div>
        <p className="muted">开启后，未匹配的问题会发给模型；需先登录。对话仅保留在当前页面。</p>
      </form>
    </dialog>
  </>;
}
