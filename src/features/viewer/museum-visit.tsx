'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { publicMuseumSchema, type PublicMuseum } from '../../contracts/museum';
import { shareTokenSchema } from '../../contracts/session';
import { ApiFailure, apiRequest, describeFailure } from '../studio/api';
import { CabinetPreview } from '../studio/cabinet-preview';
import '../studio/workbench.css';
import './museum-visit.css';

export function MuseumVisit({ token }: { token: string }) {
  const [museum, setMuseum] = useState<PublicMuseum | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [reload, setReload] = useState(0);
  const validToken = shareTokenSchema.safeParse(token).success;
  useEffect(() => {
    if (!validToken) return;
    const controller = new AbortController();
    apiRequest(`/api/share/${encodeURIComponent(token)}`, publicMuseumSchema, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setMuseum(result); setError(null); } })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure : new Error(describeFailure(failure)));
      });
    return () => controller.abort();
  }, [token, reload, validToken]);

  const selected = museum?.exhibits.find((exhibit) => exhibit.slotIndex === slot) ?? museum?.exhibits[0];
  const loginRequired = error instanceof ApiFailure && error.failure.code === 'UNAUTHORIZED';
  const assetBase = `/api/share/${encodeURIComponent(token)}/assets`;
  const brand = <header className="workbench-brandbar"><Link href="/" className="workbench-brand"><span className="workbench-seal" aria-hidden="true">拾</span><strong>拾物馆</strong></Link><span className="wb-hint">旧物在这里，回忆也在这里</span></header>;
  if (!validToken || error) return <main className="memory-workbench museum-visit">{brand}
    <section className="museum-visit-unavailable" aria-label="参观链接不可用"><h1>暂时无法打开这份纪念展</h1><p role="alert">{error ? describeFailure(error) : '参观链接无效。请向分享者索取当前链接。'}</p><p className="wb-hint">{loginRequired ? '登录后可继续打开当前参观链接。' : '请检查链接，或联系分享者确认是否仍在分享。'}</p>
      {loginRequired ? <Link className="wb-secondary" href={`/login?next=${encodeURIComponent(`/share/${token}`)}`}>登录后继续参观</Link>
        : validToken && <button className="wb-secondary" onClick={() => setReload((value) => value + 1)}>重新访问</button>}</section></main>;
  if (!museum) return <main className="memory-workbench museum-visit">{brand}<p className="museum-visit-unavailable" role="status">正在打开这份回忆…</p></main>;
  return <main className="memory-workbench museum-visit">{brand}
    <header className="museum-visit-title"><p className="workbench-eyebrow">一个关于旧物与共同回忆的纪念展</p><h1>{museum.title}</h1>{museum.description && <p>{museum.description}</p>}</header>
    <div className="museum-visit-layout">
      <section aria-label="纪念展柜"><CabinetPreview exhibits={museum.exhibits} selectedSlot={selected?.slotIndex ?? 0} disabled={false} assetBase={assetBase} mode="visit"
        onSelectSlot={(next) => { if (museum.exhibits.some((exhibit) => exhibit.slotIndex === next)) setSlot(next); }} /></section>
      {selected && <article key={selected.id} className="museum-visit-story" aria-label="展品故事"><p className="workbench-eyebrow">第 {selected.slotIndex + 1} 格 · {selected.era}</p><h2>{selected.name}</h2>
        <p className="museum-visit-caption">{selected.caption}</p>
        {selected.photoAssetId && <a className="workbench-photo" href={`${assetBase}/${selected.photoAssetId}`} target="_blank" rel="noreferrer"><Image src={`${assetBase}/${selected.photoAssetId}`} alt={`${selected.name}的实拍照片`} width={600} height={400} unoptimized /></a>}
        {selected.audioAssetId && <div className="museum-visit-audio"><h3>听一段原声</h3><audio controls preload="none" aria-label={`${selected.name}的原声录音`} src={`${assetBase}/${selected.audioAssetId}`} /></div>}
        <details className="workbench-details"><summary>展示与素材说明</summary><p>{selected.approximation}</p><p>{selected.sourceNotice}</p></details>
      </article>}
    </div>
    <footer className="museum-visit-footer">这是发布版本 v{museum.version} 的纪念展。持有当前链接并登录有效账号后可参观。</footer>
  </main>;
}
