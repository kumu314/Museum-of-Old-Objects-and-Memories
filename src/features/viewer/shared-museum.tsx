'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { type PublicExhibit, type PublicMuseum } from '../../contracts/museum';
import { type SharedContribution } from '../../contracts/contributors';
import { sharedVisitSchema } from '../../contracts/shared-visit';
import { shareNotFoundMessage } from '../../contracts/errors';
import type { AssetStatus, SurfaceStatus, mountCabinetStage } from '../cabinet/cabinet-stage';
import { ApiFailure, apiRequest, jsonRequest } from '../studio/api';
import { cabinetPageCount, exhibitsOnPage } from '../studio/cabinet-pages';
import { loginDestination } from '../studio/login-destination';
import { createInspectionController } from './inspection-controller';
import { publicStageItems, shareAssetUrl } from './public-stage-items';
import { groupContributions } from './shared-contributions';
import { ExhibitStory, InspectionGuide } from './inspection-ui';
import styles from './shared-museum.module.css';
import '../cabinet/gallery-backdrop.css';

type ShareState = { status: 'ready'; museum: PublicMuseum } | { status: 'unauthorized' } | { status: 'failed'; message: string };
type ContributionGroups = ReadonlyMap<string, readonly SharedContribution[]>;

export function SharedMuseum({ token, initialMuseum, initialContributions }: {
  token: string; initialMuseum: PublicMuseum; initialContributions: readonly SharedContribution[];
}) {
  const [share, setShare] = useState<ShareState>({ status: 'ready', museum: initialMuseum });
  const [contributions, setContributions] = useState<ContributionGroups>(() => groupContributions(initialContributions));
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    try {
      const { museum, contributions: currentContributions } = await apiRequest(
        `/api/share/${encodeURIComponent(token)}/visit`, sharedVisitSchema, { signal });
      if (controller.signal.aborted) return;
      setContributions(groupContributions(currentContributions));
      setShare((current) => current.status === 'ready'
        && current.museum.version === museum.version && current.museum.publishedAt === museum.publishedAt
        ? current : { status: 'ready', museum });
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        if (error instanceof ApiFailure && error.failure.code === 'UNAUTHORIZED') setShare({ status: 'unauthorized' });
        else setShare({ status: 'failed', message: error instanceof ApiFailure && error.failure.code === 'SHARE_NOT_FOUND'
          ? shareNotFoundMessage : '暂时无法读取展馆，请检查网络后重试。' });
      }
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    // A restored tab must check the live token and snapshot before continuing its visit.
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', restored);
    return () => {
      request.current?.abort();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', restored);
    };
  }, [refresh]);

  const reported = useRef(false);
  useEffect(() => {
    // 一次挂载只上报一次。这个 ref 挡的是 React StrictMode 在开发期把 effect 跑两遍，
    // 不是为了统计去重：真实的刷新与新标签页仍然各自计一次（口径见 discover 页脚）。
    if (reported.current) return;
    reported.current = true;
    // 计数失败绝不能影响参观：不设错误 UI、不重试、不提示，最多少记一次。
    void apiRequest(`/api/share/${encodeURIComponent(token)}/views`, z.strictObject({ ok: z.literal(true) }),
      jsonRequest('POST', {})).catch(() => undefined);
  }, [token]);

  if (share.status === 'unauthorized') return <main className={styles.unavailable}><p>拾物馆</p><h1>登录已失效</h1><p>请重新登录后继续参观。</p><a href={`/login?next=${encodeURIComponent(loginDestination(`/share/${token}`))}`}>重新登录并返回参观</a></main>;
  if (share.status === 'failed') return <main className={styles.unavailable}><p>拾物馆</p><h1>{share.message}</h1><p>请向制作人员核对当前链接，或重新读取。</p><button disabled={checking} onClick={() => void refresh()}>{checking ? '正在读取…' : '重新读取展馆'}</button></main>;
  return <MuseumViewer key={`${share.museum.id}:${share.museum.version}:${share.museum.publishedAt}`} museum={share.museum} token={token} checking={checking} contributions={contributions} onRefresh={() => void refresh()} />;
}

function MuseumViewer({ museum, token, checking, contributions, onRefresh }: {
  museum: PublicMuseum; token: string; checking: boolean; onRefresh: () => void; contributions: ContributionGroups;
}) {
  const [page, setPage] = useState(0);
  const pageCount = cabinetPageCount(museum.exhibits);
  const exhibits = useMemo(() => exhibitsOnPage(museum.exhibits, page), [museum.exhibits, page]);

  return <main className={styles.museum}>
    <div className="gallery-backdrop" aria-hidden="true"><div className="gallery-backdrop__vignette" /></div>
    <header className={styles.header}><div><div className={styles.brand}><p className={styles.brandTitle}>拾物馆</p><span aria-hidden="true">·</span><h1>{museum.title}</h1></div>{museum.description && <p className={styles.description}>{museum.description}</p>}</div><button className={styles.refresh} disabled={checking} onClick={onRefresh}>{checking ? '正在核对…' : '重新读取展馆'}</button></header>
    {/* Changing pages unmounts the old audio and stage, then starts a fresh overview. */}
    <MuseumCabinetPage key={page} exhibits={exhibits} token={token} contributions={contributions} />
    {pageCount > 1 && <nav className={styles.pagination} aria-label="展柜翻页">
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← 上一页</button>
      <span aria-live="polite">第 {page + 1} 页 / {pageCount} 页</span>
      <button type="button" disabled={page === pageCount - 1} onClick={() => setPage(page + 1)}>下一页 →</button>
    </nav>}
    <footer className={styles.footer}>请按物主允许的范围分享与使用</footer>
  </main>;
}

function MuseumCabinetPage({ exhibits, token, contributions }: {
  exhibits: readonly PublicExhibit[]; token: string; contributions: ContributionGroups;
}) {
  const [controller] = useState(() => createInspectionController(exhibits.map(({ id }) => id)));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const items = useMemo(() => publicStageItems(exhibits, token), [exhibits, token]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const story = useRef<HTMLElement>(null);
  const inspectionGuide = useRef<HTMLDivElement>(null);
  const stage = useRef<ReturnType<typeof mountCabinetStage> | null>(null);
  const [surface, setSurface] = useState<SurfaceStatus | 'loading'>('loading');
  const [assets, setAssets] = useState<ReadonlyMap<string, AssetStatus>>(() => new Map());
  const selected = exhibits.find(({ id }) => id === state.selectedId);
  const selectedStatus = selected ? assets.get(selected.id) : undefined;
  const hasSelection = state.phase !== 'overview';

  useEffect(() => {
    let disposed = false;
    const element = canvas.current;
    void import('../cabinet/cabinet-stage').then(({ mountCabinetStage: mount }) => {
      if (disposed || element === null) return;
      stage.current = mount(element, items, controller, {
        onInspectionLayout(centerX, guideTop) { if (inspectionGuide.current) { inspectionGuide.current.style.left = `${centerX}px`; inspectionGuide.current.style.top = `${guideTop}px`; } },
        inspectionInset: () => story.current !== null && getComputedStyle(story.current).position === 'absolute' && canvas.current !== null
          ? canvas.current.getBoundingClientRect().right - story.current.getBoundingClientRect().left : 0,
        onSurfaceStatus: setSurface,
        onAssetStatus: (id, status) => setAssets((current) => new Map(current).set(id, status)),
      });
    }).catch(() => { if (!disposed) setSurface('unavailable'); });
    return () => { disposed = true; stage.current?.destroy(); stage.current = null; };
  }, [items, controller]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') controller.returnToOverview(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [controller]);

  useEffect(() => { story.current?.scrollTo({ top: 0 }); }, [state.selectedId]);

  const phaseText = { overview: '展柜总览', focusing: '正在取出', inspecting: '', returning: '正在放回' };
  return <>
    <section className={styles.exhibition} aria-label="旧物展柜" data-phase={state.phase}>
      <div className={styles.stage}>
        <canvas ref={canvas} className={styles.canvas} style={{ visibility: surface === 'ready' ? 'visible' : 'hidden' }} tabIndex={0} aria-label="三维展柜；选择旧物取出，方向键旋转，加减键缩放，Esc 放回" />
        <div className={styles.stageToolbar}>{hasSelection && <button className={styles.back} onClick={() => controller.returnToOverview()}>← 放回展柜 (Esc)</button>}<span role="status">{surface !== 'ready' ? '可从下方目录查看实拍与故事' : selectedStatus === 'failed' ? '模型载入失败，实拍与故事仍可查看' : selectedStatus === 'loading' ? '模型载入中…' : phaseText[state.phase]}</span></div>
        {surface !== 'ready' && <div className={styles.surfaceNotice}><h2>{surface === 'loading' ? '正在准备展柜…' : surface === 'context-lost' ? '三维展示已中断' : '三维展示暂不可用'}</h2><p>实拍、展签与原声仍可通过下方展品目录查看。</p>{surface !== 'loading' && <button onClick={() => stage.current ? stage.current.retry() : window.location.reload()}>重试三维展示</button>}</div>}
        <div ref={inspectionGuide} className={styles.inspectionGuide} hidden={state.phase !== 'inspecting' || surface !== 'ready' || selectedStatus !== 'ready'}><InspectionGuide /></div>
      </div>
      {selected && <aside ref={story} className={`${styles.story} inspection-card`} aria-label="展品故事"><ExhibitStory key={selected.id} exhibit={selected} photoUrl={selected.photoAssetId === null ? null : shareAssetUrl(token, selected.photoAssetId)} audioUrl={selected.audioAssetId === null ? null : shareAssetUrl(token, selected.audioAssetId)} contributions={contributions.get(selected.id) ?? []} active={state.phase !== 'returning'} />{selectedStatus === 'failed' && <button onClick={() => stage.current?.retryModel(selected.id)}>重新加载模型</button>}</aside>}
    </section>
    <p className={styles.guide} data-inspecting={state.phase === 'inspecting'}>点击展柜中的旧物，取出查看立体细节并倾听物主讲述</p>
    <nav className={styles.catalog} data-fallback={surface !== 'ready'} aria-label="选择展品">{[...exhibits].sort((a, b) => a.slotIndex - b.slotIndex).map((exhibit) => <button key={exhibit.id} aria-pressed={exhibit.id === state.selectedId} onClick={() => controller.select(exhibit.id)}><span className={styles.slot}>{String(exhibit.slotIndex + 1).padStart(2, '0')}</span><span><strong>{exhibit.name}</strong><small>{exhibit.era}</small></span><span aria-hidden="true">↗</span></button>)}</nav>
  </>;
}
