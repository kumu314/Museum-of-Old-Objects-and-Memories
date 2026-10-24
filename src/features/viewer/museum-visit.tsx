'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { publicMuseumSchema, type PublicMuseum } from '../../contracts/museum';
import { shareTokenSchema } from '../../contracts/session';
import { ApiFailure, apiRequest, describeFailure } from '../studio/api';
import { MuseumDisplay } from './museum-display';
import '../studio/workbench.css';
import './museum-visit.css';

export function MuseumVisit({ token }: { token: string }) {
  const [museum, setMuseum] = useState<PublicMuseum | null>(null);
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

  const loginRequired = error instanceof ApiFailure && error.failure.code === 'UNAUTHORIZED';
  const brand = <header className="workbench-brandbar"><Link href="/" className="workbench-brand"><span className="workbench-seal" aria-hidden="true">拾</span><strong>拾物馆</strong></Link><span className="wb-hint">旧物在这里，回忆也在这里</span></header>;
  if (!validToken || error) return <main className="memory-workbench museum-visit">{brand}
    <section className="museum-visit-unavailable" aria-label="参观链接不可用"><h1>暂时无法打开这份纪念展</h1><p role="alert">{error ? describeFailure(error) : '参观链接无效。请向分享者索取当前链接。'}</p><p className="wb-hint">{loginRequired ? '请先登录。登录后会进入你自己的展馆；如需参观这份纪念展，请再次打开原链接。' : '请检查链接，或联系分享者确认是否仍在分享。'}</p>
      {loginRequired ? <Link className="wb-secondary" href="/login">前往登录</Link>
        : validToken && <button className="wb-secondary" onClick={() => setReload((value) => value + 1)}>重新访问</button>}</section></main>;
  if (!museum) return <main className="memory-workbench museum-visit">{brand}<p className="museum-visit-unavailable" role="status">正在打开这份回忆…</p></main>;
  return <MuseumDisplay key={`${museum.id}:${museum.version}`} museum={museum} mode="share" token={token} />;
}
