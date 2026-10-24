'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { missingDisplayPhoto, museumDraftSchema, updateMuseumInputSchema, type ExhibitDraft, type MuseumDraft } from '../../contracts/museum';
import { henanCities, type RegionCity } from '../../contracts/discovery';
import { publishResultSchema, shareTokenSchema } from '../../contracts/session';
import { ApiFailure, apiRequest, describeFailure, jsonRequest } from './api';
import { CabinetPreview } from './cabinet-preview';
import { cabinetPosition, firstEmptySlot } from './cabinet-pages';
import { ExhibitEditor } from './exhibit-editor';
import { Field, Notice } from './ui';
import './workbench.css';

export function MuseumWorkbench({ museumId }: { museumId: string }) {
  const router = useRouter();
  const [initial, setInitial] = useState<MuseumDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest(`/api/museums/${encodeURIComponent(museumId)}`, museumDraftSchema, { signal: controller.signal })
      .then((museum) => { if (!controller.signal.aborted) { setInitial(museum); setError(null); } })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.failure.code === 'UNAUTHORIZED') router.replace('/login');
        else setError(describeFailure(failure));
      });
    return () => controller.abort();
  }, [museumId, retry, router]);
  if (initial) return <MuseumEditor key={museumId} initial={initial} />;
  return <main className="memory-workbench"><header className="workbench-brandbar"><Link className="workbench-brand" href="/studio"><strong>拾物馆</strong></Link></header>
    <div className="workbench-empty"><h1>{error ? '暂时无法读取展馆' : '正在打开你的展柜…'}</h1><Notice error={error} />
      {error && <button className="wb-secondary" onClick={() => { setError(null); setRetry((value) => value + 1); }}>重新读取</button>}
      <p><Link className="wb-text-link" href="/studio">返回我的展馆</Link></p></div></main>;
}

function MuseumEditor({ initial }: { initial: MuseumDraft }) {
  const router = useRouter();
  const [museum, setMuseum] = useState(initial);
  const [metadataBase, setMetadataBase] = useState({ title: initial.title, description: initial.description, regionCity: initial.regionCity, discoveryListed: initial.discoveryListed, version: initial.version });
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  // 地区只到城市一级，空字符串表示「未标注」；系统不会按 IP 或其他线索替馆主猜一个。
  const [regionCity, setRegionCity] = useState<RegionCity | null>(initial.regionCity);
  const [discoveryListed, setDiscoveryListed] = useState(initial.discoveryListed);
  const [selection, setSelection] = useState(initial.exhibits[0]?.id ?? 'new');
  const [newSlot, setNewSlot] = useState(() => firstEmptySlot(initial.exhibits));
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const metadataDirty = title !== metadataBase.title || description !== metadataBase.description || regionCity !== metadataBase.regionCity || discoveryListed !== metadataBase.discoveryListed;
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

  function fail(failure: unknown) { setError(describeFailure(failure)); }
  async function refreshState() {
    try { setMuseum(await apiRequest(path, museumDraftSchema)); setRefreshRequired(false); }
    catch (failure) { setRefreshRequired(true); setError(`操作已完成，但展馆状态尚未刷新。请重新读取后再继续操作。${describeFailure(failure)}`); }
  }
  async function reload() {
    if (anyDirty && !window.confirm('重新读取会替换本页尚未保存的输入。请先复制要保留的内容，确定重新读取吗？')) return;
    setAction('重新读取'); setError(null); setMessage(null);
    try {
      const result = await apiRequest(path, museumDraftSchema);
      setMuseum(result); setMetadataBase({ title: result.title, description: result.description, regionCity: result.regionCity, discoveryListed: result.discoveryListed, version: result.version }); setTitle(result.title); setDescription(result.description); setRegionCity(result.regionCity); setDiscoveryListed(result.discoveryListed);
      if (!result.exhibits.some(({ id }) => id === selection)) setSelection(result.exhibits[0]?.id ?? 'new');
      setNewSlot(firstEmptySlot(result.exhibits)); setEditorGeneration((value) => value + 1);
      setEditorDirty(false); setRefreshRequired(false);
    } catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  function chooseSlot(slotIndex: number) {
    if (busy || refreshRequired) return;
    const exhibit = museum.exhibits.find((item) => item.slotIndex === slotIndex);
    if (selection === exhibit?.id || (selection === 'new' && !exhibit && slotIndex === newSlot)) return;
    if (editorDirty && !window.confirm('当前旧物还有未保存输入。确定切换并放弃这些输入吗？')) return;
    setSelection(exhibit?.id ?? 'new'); setNewSlot(slotIndex); setEditorDirty(false); setEditorGeneration((value) => value + 1);
  }
  async function savedExhibit(exhibit: ExhibitDraft) {
    setMuseum((current) => ({ ...current, exhibits: [...current.exhibits.filter(({ id }) => id !== exhibit.id), exhibit].sort((a, b) => a.slotIndex - b.slotIndex) }));
    setSelection(exhibit.id);
    await refreshState();
  }
  async function deletedExhibit() {
    setSelection('new'); setEditorDirty(false); setEditorGeneration((value) => value + 1);
    await refreshState();
  }
  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAction('保存展馆'); setError(null); setMessage(null);
    try {
      // Exhibit edits can advance the museum version without changing its metadata.
      const version = museum.title === metadataBase.title && museum.description === metadataBase.description && museum.regionCity === metadataBase.regionCity && museum.discoveryListed === metadataBase.discoveryListed
        ? museum.version : metadataBase.version;
      const result = await apiRequest(path, museumDraftSchema, jsonRequest('PATCH', updateMuseumInputSchema.parse({ title, description, regionCity, discoveryListed, expectedVersion: version })));
      setMuseum(result); setMetadataBase({ title: result.title, description: result.description, regionCity: result.regionCity, discoveryListed: result.discoveryListed, version: result.version }); setTitle(result.title); setDescription(result.description); setRegionCity(result.regionCity); setDiscoveryListed(result.discoveryListed); setMessage('展馆资料已保存。');
    } catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  async function stopSharing() {
    if (!window.confirm('停止分享后，旧链接的新请求将无法访问。确定停止吗？')) return;
    setAction('停止分享'); setError(null); setMessage(null);
    try {
      await apiRequest(`${path}/share`, z.strictObject({ ok: z.literal(true) }), jsonRequest('DELETE', { expectedVersion: museum.version }));
      setShareUrl(null); setMessage('已停止分享，旧链接的数据和素材新请求已失效。');
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
  async function publish() {
    if (busy || anyDirty || refreshRequired) return;
    setAction('发布'); setError(null); setMessage(null);
    try {
      const result = await apiRequest(`${path}/publish`, publishResultSchema, jsonRequest('POST', { expectedVersion: museum.version }));
      setMessage(`已生成发布快照 v${result.version}。${museum.shareEnabled ? '已有参观入口现在展示此快照。' : '展馆仍为私密，可另行开启持链接访问。'}`);
      await refreshState();
    } catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  async function rotateShare() {
    if (busy || anyDirty || refreshRequired) return;
    if (!window.confirm(museum.shareEnabled ? '更换链接后，旧链接的新请求将无法访问。确定更换吗？' : '开启后，持有链接并登录有效账号的人可参观已发布快照中的展品、照片与原声。确定开启持链接访问吗？')) return;
    setAction('更换链接'); setError(null); setMessage(null);
    try {
      const result = await apiRequest(`${path}/share`, z.strictObject({ token: shareTokenSchema }), jsonRequest('POST', { expectedVersion: museum.version }));
      setShareUrl(`${window.location.origin}/share/${result.token}`); setMessage(museum.shareEnabled ? '新链接已生成，旧链接已失效。' : '已开启持链接访问，请妥善选择分享对象。');
      await refreshState();
    } catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  async function copyShare() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setMessage('参观链接已复制。'); }
    catch { setError('暂时无法自动复制，请从参观链接输入框中选中并复制。'); }
  }
  async function logout() {
    if (anyDirty && !window.confirm('本页有未保存输入，仍要退出登录吗？')) return;
    setAction('退出登录'); setError(null);
    try { await apiRequest('/api/auth/logout', z.strictObject({ ok: z.literal(true) }), { method: 'POST' }); router.replace('/login'); }
    catch (failure) { fail(failure); }
    finally { setAction(null); }
  }
  const pendingExhibits = museum.exhibits.filter((item) => item.confirmedVersion !== item.version);
  const missingPhotos = museum.exhibits.filter(missingDisplayPhoto);
  const publishDisabled = busy || anyDirty || refreshRequired || museum.exhibits.length === 0 || pendingExhibits.length > 0 || missingPhotos.length > 0;
  const publishing = <section className="workbench-publishing" aria-label="展馆发布与分享"><h3>把这份回忆分享出去</h3>
    <p className="wb-hint">{museum.exhibits.length === 0 ? '从一件旧物开始。收录、核对并确认后，再发布给想念的人。' : `${museum.exhibits.length - pendingExhibits.length} / ${museum.exhibits.length} 件旧物已确认。`}</p>
    {pendingExhibits.length > 0 && <ul className="workbench-pending-list">{pendingExhibits.map((item) => <li key={item.id}><button type="button" className="wb-text-link" disabled={busy || refreshRequired} onClick={() => chooseSlot(item.slotIndex)}>待确认 · {cabinetPosition(item.slotIndex)} {item.name}</button></li>)}</ul>}
    {missingPhotos.length > 0 && <div role="status"><p className="wb-hint">以下旧物需要先补充并保存实拍照片，才能确认和发布：</p><ul className="workbench-pending-list">{missingPhotos.map((item) => <li key={item.id}><button type="button" className="wb-text-link" disabled={busy || refreshRequired} onClick={() => chooseSlot(item.slotIndex)}>待补图片 · {cabinetPosition(item.slotIndex)} {item.name}</button></li>)}</ul></div>}
    <p className="wb-hint">生成发布快照后，新馆仍为私密。另行开启持链接访问后，持有链接并登录有效账号的人可参观该快照。原始讲述和 AI 草稿不公开。</p>
    <p className="wb-hint">本次发布整座展馆的名称、简介和所有页的展品；单件展签仍显示在对应旧物旁。修改简介后，需再次发布才会更新分享页。</p>
    {anyDirty && <p className="wb-hint">请先处理本页尚未保存的输入或确认记录。</p>}
    <button type="button" className="wb-primary wb-full" disabled={publishDisabled} onClick={publish}>{action === '发布' ? '正在生成快照…' : '生成发布快照'}</button>
    {shareUrl && museum.shareEnabled && <div className="workbench-share-link"><Field label="当前参观链接"><input readOnly value={shareUrl} onFocus={(event) => event.target.select()} /></Field><div className="wb-actions"><button type="button" className="wb-secondary" onClick={copyShare}>复制链接</button><a className="wb-text-link" href={shareUrl} target="_blank" rel="noreferrer">打开参观页 ↗</a></div></div>}
    {museum.shareEnabled && !shareUrl && <p className="wb-hint">分享已启用。已有链接可继续使用；如未保留，可更换链接取得新的参观地址。</p>}
    {museum.publishedVersion !== null && <div className="wb-actions"><button type="button" className="wb-text-link" disabled={busy || anyDirty || refreshRequired} onClick={rotateShare}>{museum.shareEnabled ? '更换参观链接' : '开启持链接访问'}</button>{museum.shareEnabled && <button type="button" className="wb-text-link" disabled={busy || anyDirty || refreshRequired} onClick={stopSharing}>停止分享并设为私密</button>}</div>}
  </section>;

  return <main className="memory-workbench">
    <header className="workbench-brandbar"><div className="workbench-brand"><span className="workbench-seal" aria-hidden="true">拾</span><strong>拾物馆</strong><span className="workbench-breadcrumb">旧物收录与故事确认工作台</span></div>
      <div className="workbench-brand-actions"><span>{museum.title}</span>{museum.exhibits.length > 0 && <Link className="wb-text-link" href="/museum" onClick={(event) => { if (busy || (anyDirty && !window.confirm('本页有未保存输入，仍要返回自己的展馆吗？'))) event.preventDefault(); }}>预览我的展馆</Link>}<button className="wb-text-link" disabled={busy} onClick={reload}>重新读取</button><button className="wb-text-link" disabled={busy} onClick={logout}>退出登录</button></div></header>
    <Notice error={error} message={message} />
    {refreshRequired && <p role="alert" className="wb-hint">请先使用“重新读取”核对状态。已成功的写入不会自动重试。</p>}
    <details id="museum-introduction" className="workbench-introduction"><summary><strong>展馆名称与简介</strong><span>{museum.title}{metadataDirty ? ' · 有未保存修改' : ''}</span></summary><p className="wb-hint">简介展示在展馆首页的馆名下方，用来概括整座展馆。每件旧物的回忆和展签在下方单独收录。</p>
      <form onSubmit={saveMetadata}><Field label="展馆名称"><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy || refreshRequired} /></Field>
        <Field label="展馆简介"><textarea rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy || refreshRequired} /></Field>
        <Field label="所在城市" hint="只用于记忆地图的城市聚合，精确到市一级。留空表示不标注，系统不会按访问来源推断位置。">
          <select value={regionCity ?? ''} onChange={(event) => setRegionCity(event.target.value === '' ? null : event.target.value as RegionCity)} disabled={busy || refreshRequired}>
            <option value="">不标注</option>
            {henanCities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
        </Field>
        <label className="workbench-discovery-consent"><input type="checkbox" checked={discoveryListed} onChange={(event) => setDiscoveryListed(event.target.checked)} disabled={busy || refreshRequired} />我同意将已发布展馆的名称、所选城市与累计浏览次数收录到记忆地图和榜单，供所有登录用户查看。</label>
        <p className="wb-hint">默认不收录。取消勾选并保存后退出地图和榜单，不会关闭现有参观链接。</p>
        <div><button className="wb-secondary" disabled={busy || !metadataDirty || refreshRequired}>保存展馆资料</button></div></form></details>
    <ExhibitEditor resetKey={`${selection}:${editorGeneration}`} museum={museum} initial={selected} slotIndex={newSlot}
      blocked={action !== null || refreshRequired} onSaved={savedExhibit} onDeleted={deletedExhibit} onDirty={setEditorDirty} onBusy={setEditorBusy}
      cabinet={<CabinetPreview exhibits={museum.exhibits} selectedSlot={selected?.slotIndex ?? newSlot} disabled={busy || refreshRequired} onSelectSlot={chooseSlot} assetBase={`${path}/assets`} />}
      publishing={publishing} />
    <details className="workbench-details workbench-museum-settings"><summary>展馆管理</summary>
      <p className="wb-hint">草稿版本 {museum.version}{museum.publishedVersion !== null ? ` · 已发布版本 ${museum.publishedVersion}` : ' · 尚未发布'} · {museum.shareEnabled ? '分享已启用' : '分享未启用'}</p>
      <div className="wb-actions"><button className="wb-text-link wb-danger" disabled={busy || anyDirty || refreshRequired} onClick={removeMuseum}>删除展馆草稿并停止分享</button></div>
    </details>
  </main>;
}
