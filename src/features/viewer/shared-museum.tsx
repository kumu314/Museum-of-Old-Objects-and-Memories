'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { publicMuseumSchema, type PublicExhibit, type PublicMuseum } from '../../contracts/museum';
import { shareNotFoundMessage } from '../../contracts/errors';
import type { AssetStatus, SurfaceStatus, mountCabinetStage } from '../cabinet/cabinet-stage';
import { ApiFailure, apiRequest } from '../studio/api';
import { createInspectionController } from './inspection-controller';
import { publicStageItems, shareAssetUrl } from './public-stage-items';
import styles from './shared-museum.module.css';

type ShareState = { status: 'ready'; museum: PublicMuseum } | { status: 'failed'; message: string };

export function SharedMuseum({ token, initialMuseum }: { token: string; initialMuseum: PublicMuseum }) {
  const [share, setShare] = useState<ShareState>({ status: 'ready', museum: initialMuseum });
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    try {
      const museum = await apiRequest(`/api/share/${encodeURIComponent(token)}`, publicMuseumSchema,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      if (!controller.signal.aborted) setShare((current) => current.status === 'ready'
        && current.museum.version === museum.version && current.museum.publishedAt === museum.publishedAt
        ? current : { status: 'ready', museum });
    } catch (error: unknown) {
      if (!controller.signal.aborted) setShare({ status: 'failed', message: error instanceof ApiFailure && error.failure.code === 'SHARE_NOT_FOUND'
        ? shareNotFoundMessage : '暂时无法读取展馆，请检查网络后重试。' });
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

  if (share.status === 'failed') return <main className={styles.unavailable}><p>拾物馆</p><h1>{share.message}</h1><p>请向制作人员核对当前链接，或重新读取。</p><button disabled={checking} onClick={() => void refresh()}>{checking ? '正在读取…' : '重新读取展馆'}</button></main>;
  return <MuseumViewer key={`${share.museum.id}:${share.museum.version}:${share.museum.publishedAt}`} museum={share.museum} token={token} checking={checking} onRefresh={() => void refresh()} />;
}

function MuseumViewer({ museum, token, checking, onRefresh }: { museum: PublicMuseum; token: string; checking: boolean; onRefresh: () => void }) {
  const [controller] = useState(() => createInspectionController(museum.exhibits.map(({ id }) => id)));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const items = useMemo(() => publicStageItems(museum.exhibits, token), [museum.exhibits, token]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const story = useRef<HTMLElement>(null);
  const stage = useRef<ReturnType<typeof mountCabinetStage> | null>(null);
  const [surface, setSurface] = useState<SurfaceStatus | 'loading'>('loading');
  const [assets, setAssets] = useState<ReadonlyMap<string, AssetStatus>>(() => new Map());
  const selected = museum.exhibits.find(({ id }) => id === state.selectedId);
  const selectedStatus = selected ? assets.get(selected.id) : undefined;
  const hasSelection = state.phase !== 'overview';

  useEffect(() => {
    let disposed = false;
    const element = canvas.current;
    void import('../cabinet/cabinet-stage').then(({ mountCabinetStage: mount }) => {
      if (disposed || element === null) return;
      stage.current = mount(element, items, controller, {
        inspectionInset: () => story.current !== null && getComputedStyle(story.current).position === 'absolute' ? story.current.getBoundingClientRect().width : 0,
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

  const phaseText = { overview: '展柜总览', focusing: '正在取出', inspecting: '拖动旋转 · 双指或按钮缩放', returning: '正在放回' };
  return <main className={styles.museum}>
    <header className={styles.header}><div><p className={styles.eyebrow}>拾物馆 · 旧物纪念展</p><h1>{museum.title}</h1>{museum.description && <p className={styles.description}>{museum.description}</p>}</div><button className={styles.refresh} disabled={checking} onClick={onRefresh}>{checking ? '正在核对…' : '重新读取展馆'}</button></header>
    <section className={styles.exhibition} aria-label="旧物展柜" data-phase={state.phase}>
      <div className={styles.stage}>
        <canvas ref={canvas} className={styles.canvas} style={{ visibility: surface === 'ready' ? 'visible' : 'hidden' }} tabIndex={0} aria-label="三维展柜；选择旧物取出，方向键旋转，加减键缩放，Esc 放回" />
        <div className={styles.stageToolbar}>{hasSelection && <button onClick={() => controller.returnToOverview()}>← 放回展柜</button>}<span role="status">{surface !== 'ready' ? '可从下方目录查看实拍与故事' : selectedStatus === 'failed' ? '模型载入失败，实拍与故事仍可查看' : selectedStatus === 'loading' ? '模型载入中…' : phaseText[state.phase]}</span>{state.phase === 'inspecting' && surface === 'ready' && selectedStatus === 'ready' && <div className={styles.zoomControls}><button aria-label="缩小模型" onClick={() => stage.current?.zoomBy(1 / 1.12)}>− 缩小</button><button aria-label="放大模型" onClick={() => stage.current?.zoomBy(1.12)}>＋ 放大</button></div>}</div>
        {surface !== 'ready' && <div className={styles.surfaceNotice}><h2>{surface === 'loading' ? '正在准备展柜…' : surface === 'context-lost' ? '三维展示已中断' : '三维展示暂不可用'}</h2><p>实拍、展签与原声仍可通过下方展品目录查看。</p>{surface !== 'loading' && <button onClick={() => stage.current ? stage.current.retry() : window.location.reload()}>重试三维展示</button>}</div>}
        {state.phase === 'inspecting' && surface === 'ready' && <button className={styles.reset} onClick={() => { stage.current?.resetView(); canvas.current?.focus(); }}>重置角度</button>}
      </div>
      {selected && <aside ref={story} className={styles.story} aria-label="展品故事"><StoryPanel key={selected.id} exhibit={selected} token={token} active={state.phase !== 'returning'} />{selectedStatus === 'failed' && <button onClick={() => stage.current?.retryModel(selected.id)}>重新加载模型</button>}</aside>}
    </section>
    <p className={styles.guide}>{hasSelection ? '拖动旋转 · 双指、按钮或滚轮缩放 · 按 Esc 或“放回展柜”返回' : '点击展柜中的旧物，取出查看立体细节并倾听物主讲述'}</p>
    <nav className={styles.catalog} aria-label="展品目录">{[...museum.exhibits].sort((a, b) => a.slotIndex - b.slotIndex).map((exhibit) => <button key={exhibit.id} aria-pressed={exhibit.id === state.selectedId} onClick={() => controller.select(exhibit.id)}><span className={styles.slot}>{String(exhibit.slotIndex + 1).padStart(2, '0')}</span><span><strong>{exhibit.name}</strong><small>{exhibit.era}</small></span><span aria-hidden="true">↗</span></button>)}</nav>
    <footer className={styles.footer}>持有链接即可访问 · 请按物主允许的范围分享</footer>
  </main>;
}

function StoryPanel({ exhibit, token, active }: { exhibit: PublicExhibit; token: string; active: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  useEffect(() => {
    const element = audio.current;
    return () => element?.pause();
  }, []);
  useEffect(() => { if (!active && audio.current) { audio.current.pause(); audio.current.currentTime = 0; } }, [active]);
  return <>
    <p className={styles.eyebrow}>第 {exhibit.slotIndex + 1} 格 · {exhibit.era}</p><h2>{exhibit.name}</h2>
    <p className={styles.caption}>{exhibit.caption}</p>
    {exhibit.photoAssetId !== null ? <figure className={styles.photo}>{!photoFailed && <Image src={shareAssetUrl(token, exhibit.photoAssetId)} alt={`${exhibit.name}的实拍`} width={960} height={640} unoptimized onError={() => setPhotoFailed(true)} />}{photoFailed ? <><p role="alert">实拍暂时无法读取，请检查网络或核对分享状态。</p><button onClick={() => setPhotoFailed(false)}>重试实拍</button></> : <figcaption>实拍图片</figcaption>}</figure> : <p className={styles.mediaNote}>此展品尚未提供实拍。</p>}
    {exhibit.audioAssetId !== null ? <div className={styles.audio}><label htmlFor={`audio-${exhibit.id}`}>听听物主讲述</label><audio id={`audio-${exhibit.id}`} ref={audio} src={shareAssetUrl(token, exhibit.audioAssetId)} controls preload="none" onError={() => setAudioFailed(true)} aria-label={`${exhibit.name}的原声`} />{audioFailed && <><p role="alert">原声暂时无法播放，请检查网络、核对分享状态或更换浏览器。</p><button onClick={() => { setAudioFailed(false); audio.current?.load(); }}>重新加载原声</button></>}</div> : <p className={styles.mediaNote}>此展品尚未提供原声。</p>}
    <details className={styles.sources}><summary>模型说明与素材来源</summary><p>{exhibit.approximation}</p><p>{exhibit.sourceNotice}</p>{exhibit.modelKey === 'photo-plane' && <p>三维展示为实拍照片薄片，背面为示意。</p>}</details>
  </>;
}
