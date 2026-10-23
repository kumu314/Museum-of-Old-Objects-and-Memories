'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { museumDraftSchema, updateMuseumInputSchema, type ExhibitDraft, type MuseumDraft } from '../../contracts/museum';
import { publishResultSchema, shareTokenSchema } from '../../contracts/session';
import { ApiFailure, apiRequest, describeFailure, jsonRequest } from './api';
import { ExhibitEditor } from './exhibit-editor';
import { buttonClass, Field, inputClass, Notice, panelClass, primaryClass } from './ui';

export function MuseumWorkbench({ museumId }: { museumId: string }) {
  const router = useRouter();
  const [initial, setInitial] = useState<MuseumDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest(`/api/museums/${encodeURIComponent(museumId)}`, museumDraftSchema, { signal: controller.signal })
      .then((museum) => { if (!controller.signal.aborted) setInitial(museum); })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.failure.code === 'UNAUTHORIZED') router.replace('/login');
        else setError(describeFailure(failure));
      });
    return () => controller.abort();
  }, [museumId, retry, router]);
  if (initial) return <MuseumEditor key={museumId} initial={initial} />;
  return <main className="mx-auto max-w-5xl p-8"><Link className="text-amber-100 underline" href="/studio">返回展馆列表</Link><p className="mt-8">正在读取展馆…</p><Notice error={error} />{error && <button className={buttonClass} onClick={() => setRetry((value) => value + 1)}>重新读取</button>}</main>;
}

function MuseumEditor({ initial }: { initial: MuseumDraft }) {
  const router = useRouter();
  const [museum, setMuseum] = useState(initial);
  const [metadataBase, setMetadataBase] = useState({ title: initial.title, description: initial.description, version: initial.version });
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [selection, setSelection] = useState(initial.exhibits[0]?.id ?? 'new');
  const [newSlot, setNewSlot] = useState(0);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const metadataDirty = title !== metadataBase.title || description !== metadataBase.description;
  const anyDirty = metadataDirty || editorDirty;
  const busy = action !== null || editorBusy;
  const path = `/api/museums/${museum.id}`;
  const selected = museum.exhibits.find((exhibit) => exhibit.id === selection) ?? null;

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  function fail(failure: unknown) {
    setError(describeFailure(failure));
    if (failure instanceof ApiFailure && failure.failure.code === 'NOT_CONFIRMED') setUnconfirmed(failure.failure.details.unconfirmedExhibitIds);
  }
  async function refreshState() {
    try { setMuseum(await apiRequest(path, museumDraftSchema)); setRefreshRequired(false); }
    catch (failure) { setRefreshRequired(true); setError(`操作已完成，但展馆状态尚未刷新。请重新读取后再发布。${describeFailure(failure)}`); }
  }
  async function reload() {
    if (anyDirty && !window.confirm('重新读取会替换本页尚未保存的输入。请先复制要保留的内容，确定重新读取吗？')) return;
    setAction('重新读取'); setError(null); setMessage(null);
    try {
      const result = await apiRequest(path, museumDraftSchema);
      setMuseum(result); setMetadataBase({ title: result.title, description: result.description, version: result.version }); setTitle(result.title); setDescription(result.description);
      if (!result.exhibits.some(({ id }) => id === selection)) setSelection(result.exhibits[0]?.id ?? 'new');
      setNewSlot(Array.from({ length: 6 }, (_, index) => index).find((slot) => !result.exhibits.some((item) => item.slotIndex === slot)) ?? 0);
      setEditorGeneration((value) => value + 1); setEditorDirty(false); setRefreshRequired(false); setUnconfirmed([]);
    } catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  function choose(exhibit: ExhibitDraft | undefined, slotIndex: number) {
    if (selection === exhibit?.id || (selection === 'new' && !exhibit && slotIndex === newSlot)) return;
    if (editorDirty && !window.confirm('当前展品还有未保存输入。确定切换并放弃这些输入吗？')) return;
    setSelection(exhibit?.id ?? 'new'); setNewSlot(slotIndex); setEditorDirty(false); setEditorGeneration((value) => value + 1);
  }
  async function savedExhibit(exhibit: ExhibitDraft) {
    setMuseum((current) => ({ ...current, exhibits: [...current.exhibits.filter(({ id }) => id !== exhibit.id), exhibit].sort((a, b) => a.slotIndex - b.slotIndex) }));
    setSelection(exhibit.id); setUnconfirmed((ids) => ids.filter((id) => id !== exhibit.id));
    await refreshState();
  }
  async function deletedExhibit() {
    setSelection('new'); setEditorDirty(false); setEditorGeneration((value) => value + 1);
    await refreshState();
  }
  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAction('保存展馆'); setError(null); setMessage(null);
    try {
      // Other exhibit edits may advance the museum version without changing these fields.
      const version = museum.title === metadataBase.title && museum.description === metadataBase.description ? museum.version : metadataBase.version;
      const result = await apiRequest(path, museumDraftSchema, jsonRequest('PATCH', updateMuseumInputSchema.parse({ title, description, expectedVersion: version })));
      setMuseum(result); setMetadataBase({ title: result.title, description: result.description, version: result.version }); setTitle(result.title); setDescription(result.description); setMessage('展馆资料已保存；再次发布后参观页才更新。');
    } catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  async function share(operation: 'publish' | 'stop' | 'rotate') {
    if (operation === 'rotate' && !window.confirm('更换后旧链接立即失效。确定生成新链接吗？')) return;
    setAction(operation); setError(null); setMessage(null); setUnconfirmed([]);
    try {
      const input = { expectedVersion: museum.version };
      if (operation === 'publish') {
        const result = await apiRequest(`${path}/publish`, publishResultSchema, jsonRequest('POST', input));
        if (result.token) setToken(result.token);
        setMessage('已发布当前确认内容。之后修改草稿不会改变这份参观快照。');
      } else if (operation === 'rotate') {
        const result = await apiRequest(`${path}/share`, z.strictObject({ token: shareTokenSchema }), jsonRequest('POST', input));
        setToken(result.token); setMessage('新链接已生成，旧链接已失效。');
      } else {
        await apiRequest(`${path}/share`, z.strictObject({ ok: z.literal(true) }), jsonRequest('DELETE', input));
        setToken(null); setMessage('已停止分享，旧链接的数据和素材新请求已失效。');
      }
      await refreshState();
    } catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  async function removeMuseum() {
    if (!window.confirm(`删除展馆“${museum.title}”的草稿并停止分享？历史素材和快照不会物理清除。`)) return;
    setAction('删除展馆'); setError(null);
    try { await apiRequest(path, z.strictObject({ ok: z.literal(true) }), jsonRequest('DELETE', { expectedVersion: museum.version })); router.push('/studio'); }
    catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  return <main className="mx-auto max-w-7xl px-5 py-8 sm:px-10">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-700 pb-6"><div><Link href="/studio" className="text-sm text-amber-100/70" onClick={(event) => { if (anyDirty && !window.confirm('本页有未保存输入，仍要返回展馆列表吗？')) event.preventDefault(); }}>← 展馆列表</Link><h1 className="mt-3 font-serif text-3xl">{museum.title}</h1><p className="mt-2 text-xs text-stone-500">草稿版本 {museum.version} · {museum.shareEnabled ? '分享已启用' : '分享未启用'}{museum.publishedVersion !== null ? ` · 发布版本 ${museum.publishedVersion}` : ''}</p></div><button className={buttonClass} disabled={busy} onClick={reload}>重新读取</button></header>
    <Notice error={error} message={message} />
    {refreshRequired && <p className="mb-4 text-sm text-amber-100">请使用“重新读取”核对状态。已成功的写入不会自动重试。</p>}
    <div className="mt-7 grid items-start gap-7 xl:grid-cols-[340px_1fr]">
      <aside className="space-y-6">
        <form className={`${panelClass} space-y-4`} onSubmit={saveMetadata}><h2 className="text-lg">展馆资料</h2><Field label="展馆名称"><input className={inputClass} required value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></Field><Field label="展馆简介"><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></Field><button className={buttonClass} disabled={busy || !metadataDirty || refreshRequired}>保存展馆资料</button></form>
        <section className={panelClass}><h2 className="text-lg">六格展柜</h2><p className="mt-2 text-xs leading-5 text-stone-500">选择格位编辑。位置与参观展柜一致。</p><div className="mt-4 grid grid-cols-3 gap-2">{Array.from({ length: 6 }, (_, index) => {
          const exhibit = museum.exhibits.find((item) => item.slotIndex === index);
          const active = exhibit ? selection === exhibit.id : selection === 'new' && newSlot === index;
          return <button key={index} type="button" aria-pressed={active} disabled={busy} onClick={() => choose(exhibit, index)} className={`min-h-24 rounded-lg border p-2 text-left text-xs leading-5 transition ${active ? 'border-amber-200 bg-amber-100/10' : 'border-stone-700 hover:border-stone-400'} ${exhibit && unconfirmed.includes(exhibit.id) ? 'ring-2 ring-red-300/60' : ''}`}><span className="block text-stone-500">{index < 3 ? '上排' : '下排'} {index % 3 + 1}</span><span className="mt-1 block">{exhibit?.name ?? '＋ 收录旧物'}</span>{exhibit && <span className={`block ${exhibit.confirmedVersion === exhibit.version ? 'text-amber-100/60' : 'text-red-200/70'}`}>{exhibit.confirmedVersion === exhibit.version ? '已确认' : '待确认'}</span>}</button>;
        })}</div>{unconfirmed.length > 0 && <p className="mt-3 text-xs text-red-200">请依次处理红色标记的未确认展品。</p>}</section>
        <section className={panelClass}><h2 className="text-lg">发布与参观链接</h2><p className="mt-3 text-sm leading-6 text-stone-400">持有链接即可访问。请先保存并确认所有展品，再发布完整快照。</p>{anyDirty && <p className="mt-3 text-sm text-amber-100/70">本页有未保存内容，请先处理后再发布。</p>}<div className="mt-4 flex flex-wrap gap-3"><button className={primaryClass} disabled={busy || anyDirty || refreshRequired} onClick={() => share('publish')}>发布当前版本</button><button className={buttonClass} disabled={busy || anyDirty || refreshRequired || museum.publishedVersion === null} onClick={() => share('rotate')}>更换参观链接</button><button className={buttonClass} disabled={busy || anyDirty || refreshRequired || !museum.shareEnabled} onClick={() => share('stop')}>停止分享</button></div>
          {token && museum.shareEnabled && <div className="mt-5"><Field label="本次生成的参观链接"><input className={`${inputClass} text-xs`} readOnly value={`${window.location.origin}/share/${token}`} onFocus={(event) => event.target.select()} /></Field><a className="mt-3 inline-block text-sm text-amber-100 underline" href={`/share/${token}`} target="_blank" rel="noreferrer">在新窗口参观</a></div>}
          {!token && museum.shareEnabled && <p className="mt-4 text-xs leading-5 text-stone-500">已启用的旧链接继续有效。此处不回显历史 token；若未保存链接，可更换链接后重新交付。</p>}
        </section>
        <button className={`${buttonClass} text-red-200/70`} disabled={busy || anyDirty || refreshRequired} onClick={removeMuseum}>删除展馆草稿并停止分享</button>
      </aside>
      <ExhibitEditor key={`${selection}:${selection === 'new' ? newSlot : ''}:${editorGeneration}`} museum={museum} initial={selected} slotIndex={newSlot} onSaved={savedExhibit} onDeleted={deletedExhibit} onDirty={setEditorDirty} onBusy={setEditorBusy} />
    </div>
  </main>;
}
