'use client';

import { Brand } from '../navigation/brand';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '../navigation/navigation-link';
import { z } from 'zod';
import { missingDisplayPhoto, museumDraftSchema, updateMuseumInputSchema, type ExhibitDraft, type MuseumDraft } from '../../contracts/museum';
import { henanCities, type RegionCity } from '../../contracts/discovery';
import { publishResultSchema, shareTokenSchema } from '../../contracts/session';
import { ApiFailure, apiRequest, describeFailure, jsonRequest } from './api';
import { CabinetPreview } from './cabinet-preview';
import { cabinetPosition, firstEmptySlot } from './cabinet-pages';
import { ExhibitEditor, type ReviewRequest } from './exhibit-editor';
import { WorkbenchDialog } from './workbench-dialog';
import { Field, Notice } from './ui';
import './workbench.css';
import './curator-workbench.css';
import './workshop-atmosphere.css';
import { FloatingDust } from '../ornaments/floating-dust';

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
  return <main className="memory-workbench"><header className="workbench-brandbar"><Link className="workbench-brand" href="/studio"><Brand /></Link></header>
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
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [panel, setPanel] = useState<'museum' | 'publish' | null>(null);
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
    if (busy || refreshRequired) return false;
    const exhibit = museum.exhibits.find((item) => item.slotIndex === slotIndex);
    if (selection === exhibit?.id || (selection === 'new' && !exhibit && slotIndex === newSlot)) return true;
    if (editorDirty && !window.confirm('当前旧物还有未保存输入。确定切换并放弃这些输入吗？')) return false;
    setSelection(exhibit?.id ?? 'new'); setNewSlot(slotIndex); setEditorDirty(false); setEditorGeneration((value) => value + 1);
    return true;
  }
  function reviewSlot(exhibit: ExhibitDraft) {
    if (!chooseSlot(exhibit.slotIndex)) return;
    setPanel(null);
    setReviewRequest((current) => ({ revision: (current?.revision ?? 0) + 1, tab: missingDisplayPhoto(exhibit) ? 'materials' : 'confirmation' }));
    requestAnimationFrame(() => document.querySelector('.workbench-toolbar')?.scrollIntoView({ block: 'start' }));
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
      setMuseum((current) => ({ ...current, publishedVersion: result.version }));
      setMessage(`发布成功，可以进入展馆查看 v${result.version}。${museum.shareEnabled ? '已有参观链接已同步更新。' : '目前仅自己可见，邀请他人参观需另行开启持链接访问。'}`);
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
  const publishReason = refreshRequired ? '展馆状态需要核对，请先重新读取。'
    : busy ? '当前操作进行中，请稍候。'
    : anyDirty ? '请先保存或处理尚未保存的资料、展签草稿和确认记录。'
    : museum.exhibits.length === 0 ? '请先收录并确认至少一件旧物。'
    : missingPhotos.length > 0 ? `还有 ${missingPhotos.length} 件旧物缺少实拍照片，请补图并保存。`
    : pendingExhibits.length > 0 ? `还有 ${pendingExhibits.length} 件旧物待确认，请逐件核对当前版本。`
    : '全部旧物已确认，可以发布当前展馆。';
  const publishing = <section className="workbench-publishing" aria-label="展馆发布与分享">
    {museum.publishedVersion !== null && <div className="workbench-published-entry">
      <div><h3>已发布 v{museum.publishedVersion}</h3><p>查看已发布的展柜、照片和展签，继续编辑可随时返回工作台。</p></div>
      <Link className="wb-primary" href="/museum/published" aria-disabled={busy} onClick={(event) => {
        if (busy || (anyDirty && !window.confirm('本页有未保存输入，仍要进入已发布展馆吗？'))) event.preventDefault();
      }}>进入展馆 →</Link>
    </div>}
    <div className="workbench-publish-heading"><span className="wb-badge">全馆已确认 {museum.exhibits.length - pendingExhibits.length} / {museum.exhibits.length} 件</span></div>
    <div className="workbench-publish-action"><p id="workbench-publish-reason" role="status">{publishReason}</p><button type="button" className="wb-primary" aria-describedby="workbench-publish-reason" disabled={publishDisabled} onClick={publish}>{action === '发布' ? '正在发布…' : '发布整座展馆'}</button></div>
    {(pendingExhibits.length > 0 || missingPhotos.length > 0) && <ul className="workbench-pending-list">{museum.exhibits.filter((item) => item.confirmedVersion !== item.version || missingDisplayPhoto(item)).map((item) => <li key={item.id}><button type="button" className="wb-secondary" disabled={busy || refreshRequired} onClick={() => reviewSlot(item)}>{missingDisplayPhoto(item) ? '待补图片' : '待确认'} · {cabinetPosition(item.slotIndex)} {item.name} →</button></li>)}</ul>}
    <p className="wb-hint">开启持链接访问后，持有效链接并登录的访客可参观已发布的旧物、照片与原声。</p>
    <p className="wb-hint">发布整个展馆的已确认版本；原始讲述、AI 草稿及确认备注不公开。后续编辑不会改变本次快照。</p>
    {shareUrl && museum.shareEnabled && <div className="workbench-share-link"><Field label="当前参观链接"><input readOnly value={shareUrl} onFocus={(event) => event.target.select()} /></Field><div className="wb-actions"><button type="button" className="wb-secondary" onClick={copyShare}>复制链接</button><a className="wb-text-link" href={shareUrl} target="_blank" rel="noreferrer">打开参观页 ↗</a></div></div>}
    {museum.shareEnabled && !shareUrl && <p className="wb-hint">分享已启用。已有链接可继续使用；如未保留，可更换链接取得新的参观地址。</p>}
    {museum.publishedVersion !== null && <div className="wb-actions"><button type="button" className="wb-text-link" disabled={busy || anyDirty || refreshRequired} onClick={rotateShare}>{museum.shareEnabled ? '更换参观链接' : '开启持链接访问'}</button>{museum.shareEnabled && <button type="button" className="wb-text-link" disabled={busy || anyDirty || refreshRequired} onClick={stopSharing}>停止分享并设为私密</button>}</div>}
  </section>;

  function toolbar(controls: ReactNode) {
    return <><header className="workbench-brandbar"><div className="workbench-brand"><Brand /><button type="button" className="workbench-museum-trigger" aria-haspopup="dialog" onClick={() => setPanel('museum')} title="编辑展馆名称与简介">{museum.title}{metadataDirty ? ' *' : ''}<span aria-hidden="true">⌄</span></button></div>
      <div className="workbench-brand-actions">{controls}<Link className="wb-text-link" href="/memoir" title="合成资料在线演示，限已登记账号" onClick={(event) => {
        if (busy || (anyDirty && !window.confirm('本页有未保存输入，仍要进入个人自传吗？'))) event.preventDefault();
      }}>个人自传</Link><button type="button" className="wb-secondary" aria-haspopup="dialog" onClick={() => setPanel('publish')}>发布展馆</button></div></header>
      <Notice error={error} message={message} />
      {refreshRequired && <p role="alert" className="wb-hint">请先重新读取并核对展馆状态。已成功的写入不会自动重试。</p>}
    </>;
  }
  return <main className="memory-workbench curator-workbench">
    <FloatingDust />
    <ExhibitEditor resetKey={`${selection}:${editorGeneration}`} museum={museum} initial={selected} slotIndex={newSlot}
      blocked={action !== null || refreshRequired} onSaved={savedExhibit} onRefreshed={setMuseum} onDeleted={deletedExhibit} onDirty={setEditorDirty} onBusy={setEditorBusy}
      cabinet={<CabinetPreview exhibits={museum.exhibits} selectedSlot={selected?.slotIndex ?? newSlot} confirmedIds={museum.exhibits.filter((item) => item.confirmedVersion === item.version).map((item) => item.id)} disabled={busy || refreshRequired} onSelectSlot={chooseSlot} assetBase={`${path}/assets`} />}
      toolbar={toolbar} reviewRequest={reviewRequest} />
    <WorkbenchDialog open={panel === 'museum'} title="展馆资料" onClose={() => setPanel(null)}>
      <form className="workbench-fields" onSubmit={saveMetadata}>
        <Field label="展馆名称"><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy || refreshRequired} /></Field>
        <Field label="展馆简介" hint="显示在展馆首页馆名下方。"><textarea rows={4} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy || refreshRequired} /></Field>
        <p className="workbench-count">{description.length} / 2000</p>
        <Field label="所在城市" hint="只用于记忆地图的城市聚合，精确到市一级。留空表示不标注，系统不会按访问来源推断位置。">
          <select value={regionCity ?? ''} onChange={(event) => setRegionCity(event.target.value === '' ? null : event.target.value as RegionCity)} disabled={busy || refreshRequired}>
            <option value="">不标注</option>
            {henanCities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
        </Field>
        <label className="workbench-discovery-consent"><input type="checkbox" checked={discoveryListed} onChange={(event) => setDiscoveryListed(event.target.checked)} disabled={busy || refreshRequired || (museum.accessMode !== 'discoverable' && !museum.discoveryListed)} />我同意将已发布展馆的名称、所选城市与累计浏览次数收录到记忆地图和榜单，供所有登录用户查看。</label>
        <p className="wb-hint">{museum.accessMode === 'discoverable'
          ? '默认不收录。取消勾选并保存后退出地图和榜单，不会关闭现有参观链接。'
          : '本馆未开启公开发现，不会进入地图和榜单。公开发现目前仅向登记的演示账号开放；已有收录标记可取消并保存，参观链接不受影响。'}</p>
        <Notice error={error} message={message} />
        <div className="wb-row"><span className="wb-hint" role="status">{action === '保存展馆' ? '正在保存…' : metadataDirty ? '有未保存修改' : '已保存'} · 再次发布后更新分享页</span><button className="wb-primary" disabled={busy || !metadataDirty || refreshRequired}>保存展馆资料</button></div>
      </form>
      <section className="workbench-museum-settings" aria-label="展馆管理"><p className="wb-hint">草稿 v{museum.version} · {museum.publishedVersion === null ? '尚未发布' : `已发布 v${museum.publishedVersion}`} · {museum.shareEnabled ? '分享已启用' : '分享未启用'}</p>
        <div className="wb-actions">{museum.exhibits.length > 0 && <Link className="wb-text-link" href="/museum" onClick={(event) => { if (busy || (anyDirty && !window.confirm('本页有未保存输入，仍要返回自己的展馆吗？'))) event.preventDefault(); }}>预览展馆</Link>}<button type="button" className="wb-secondary" disabled={busy} onClick={reload}>重新读取</button><button type="button" className="wb-secondary" disabled={busy} onClick={logout}>退出登录</button></div>
        <button type="button" className="wb-text-link wb-danger workbench-remove" disabled={busy || anyDirty || refreshRequired} onClick={removeMuseum}>删除展馆草稿并停止分享</button>
      </section>
    </WorkbenchDialog>
    <WorkbenchDialog open={panel === 'publish'} title="发布展馆" onClose={() => setPanel(null)}><Notice error={error} message={message} />{publishing}</WorkbenchDialog>
  </main>;
}
