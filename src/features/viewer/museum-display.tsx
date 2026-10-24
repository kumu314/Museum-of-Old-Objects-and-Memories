'use client';

import { Brand } from '../navigation/brand';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from '../navigation/navigation-link';
import { z } from 'zod';
import type { MuseumDisplayData } from '../../contracts/museum';
import { apiRequest, describeFailure } from '../studio/api';
import { CabinetPreview } from '../studio/cabinet-preview';
import { cabinetPosition } from '../studio/cabinet-pages';
import { Notice } from '../studio/ui';
import '../studio/workbench.css';
import './museum-visit.css';

type DisplayProps = { museum: MuseumDisplayData } & ({ mode: 'owner' | 'published-owner' } | { mode: 'share'; token: string });

export function MuseumDisplay(props: DisplayProps) {
  const { museum } = props;
  const owner = props.mode !== 'share';
  const publishedOwner = props.mode === 'published-owner';
  const router = useRouter();
  const [slot, setSlot] = useState(museum.exhibits[0]?.slotIndex ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = museum.exhibits.find((exhibit) => exhibit.slotIndex === slot);
  const assetBase = props.mode === 'share' ? `/api/share/${encodeURIComponent(props.token)}/assets` : `/api/museums/${museum.id}/assets`;
  async function logout() {
    setBusy(true); setError(null);
    try { await apiRequest('/api/auth/logout', z.strictObject({ ok: z.literal(true) }), { method: 'POST' }); router.replace('/login'); }
    catch (failure) { setError(describeFailure(failure)); }
    finally { setBusy(false); }
  }
  return <main className="memory-workbench museum-visit">
    <header className="workbench-brandbar"><Link href="/" className="workbench-brand"><Brand /></Link>
      {owner ? <div className="workbench-brand-actions"><span className="wb-badge">{publishedOwner ? `仅本人查看 · 已发布 v${museum.version}` : '仅本人预览 · 当前草稿'}</span><Link className="wb-primary" href={`/studio/${museum.id}`}>{publishedOwner ? '返回工作台' : '进入工作台'}</Link><Link className="wb-text-link" href="/memoir" title="合成资料在线演示，限已登记账号">个人自传</Link><button type="button" className="wb-text-link" disabled={busy} onClick={() => router.refresh()}>重新读取</button><button type="button" className="wb-text-link" disabled={busy} onClick={logout}>退出登录</button></div>
        : <Link className="wb-text-link" href="/studio">我的展馆</Link>}</header>
    <Notice error={error} />
    <header className="museum-visit-title"><p className="workbench-eyebrow">一个关于旧物与共同回忆的纪念展</p><h1>{museum.title}</h1>{museum.description ? <p>{museum.description}</p>
      : owner && <p><Link className="wb-text-link" href={`/studio/${museum.id}#museum-introduction`}>为整座展馆写一段简介 →</Link></p>}</header>
    <div className="museum-visit-layout">
      <section aria-label="纪念展柜"><CabinetPreview exhibits={museum.exhibits} selectedSlot={slot} disabled={false} assetBase={assetBase} mode="visit" onSelectSlot={setSlot} /></section>
      {selected ? <article key={selected.id} className="museum-visit-story" aria-label="展品故事"><p className="workbench-eyebrow">{cabinetPosition(selected.slotIndex)} · {selected.era}</p><h2>{selected.name}</h2>
        <p className="museum-visit-caption">{selected.caption || '这件旧物的展签还在整理中。'}</p>
        {selected.photoAssetId && <a className="workbench-photo" href={`${assetBase}/${selected.photoAssetId}`} target="_blank" rel="noreferrer"><Image src={`${assetBase}/${selected.photoAssetId}`} alt={`${selected.name}的实拍照片`} width={600} height={400} unoptimized /></a>}
        {selected.audioAssetId && <div className="museum-visit-audio"><h3>听一段原声</h3><audio controls preload="none" aria-label={`${selected.name}的原声录音`} src={`${assetBase}/${selected.audioAssetId}`} /></div>}
        <details className="workbench-details"><summary>展示与素材说明</summary>{selected.generatedModelAssetId && <p>由上传照片生成的近似模型，未拍摄的背面、结构与细节不代表精确复原。</p>}<p>{selected.approximation}</p><p>{selected.sourceNotice}</p></details>
      </article> : <p className="museum-visit-story">这一页还没有收录旧物。</p>}
    </div>
    <footer className="museum-visit-footer">{publishedOwner ? `这是已发布版本 v${museum.version}。后续草稿修改会在再次发布后更新这里；访客参观需在工作台另行开启持链接访问。` : owner ? `这是仅本人可见的草稿预览 v${museum.version}。修改保存后在这里查看；分享内容需在工作台明确确认并发布。` : `这是发布版本 v${museum.version} 的纪念展。持有当前链接并登录有效账号后可参观。`}</footer>
  </main>;
}
