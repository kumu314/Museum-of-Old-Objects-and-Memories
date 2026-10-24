'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AssetStatus, SurfaceStatus, mountCabinetStage } from '../cabinet/cabinet-stage';
import type { GlbModelSource, ModelStats } from '../cabinet/glb-model';
import { defaultModelPlacement, modelPlacementSchema, type ModelPlacement } from '../cabinet/model-placement';
import { createInspectionController } from './inspection-controller';
import styles from './model-preview.module.css';

export interface ModelSelection { assetId: string; version: string; placement: ModelPlacement }
export interface ModelPreviewProps {
  source: GlbModelSource;
  label: string;
  value: ModelPlacement;
  onChange: (placement: ModelPlacement) => void;
  /** B supplies the photograph/story entry, which stays available if WebGL fails. */
  fallback: ReactNode;
  onApply?: (selection: ModelSelection) => void;
  applying?: boolean;
}
type LoadState = { identity: string; status: AssetStatus; error: string | null; stats: ModelStats | null };
const itemId = 'model-preview';

export function ModelPreview({ source, label, value, onChange, fallback, onApply, applying = false }: ModelPreviewProps) {
  const { assetId, version, url } = source;
  const [x, y, z] = value.rotation; const size = value.size;
  const stableSource = useMemo(() => ({ assetId, version, url }), [assetId, version, url]);
  const stablePlacement = useMemo<ModelPlacement>(() => ({ rotation: [x, y, z], size }), [x, y, z, size]);
  const identity = JSON.stringify([source.assetId, source.version, source.url]);
  const [controller] = useState(() => createInspectionController([itemId]));
  const inspection = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [load, setLoad] = useState<LoadState>({ identity, status: 'loading', error: null, stats: null });
  const [surface, setSurface] = useState<SurfaceStatus | 'loading'>('loading');
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<ReturnType<typeof mountCabinetStage> | null>(null);
  const latest = useRef({ source, value, identity });
  const controlId = useId();

  useEffect(() => {
    latest.current = { source: stableSource, value: stablePlacement, identity };
    stage.current?.setModelSource(itemId, stableSource);
    stage.current?.setModelPlacement(itemId, stablePlacement);
  }, [stableSource, stablePlacement, identity]);

  useEffect(() => {
    let disposed = false;
    const element = canvas.current;
    void import('../cabinet/cabinet-stage').then(({ mountCabinetStage: mount }) => {
      if (disposed || element === null) return;
      const current = latest.current;
      stage.current = mount(element, [{ id: itemId, slot: 1, plaqueText: '旧物预览', modelKey: 'glb', source: current.source, placement: current.value }], controller, {
        inspectionInset: () => 0,
        onSurfaceStatus: (status) => { if (!disposed) setSurface(status); },
        onAssetStatus: (id, status) => {
          if (disposed || id !== itemId) return;
          setLoad((previous) => ({ identity: latest.current.identity, status,
            error: status === 'loading' ? null : previous.error,
            stats: status === 'loading' ? null : previous.stats }));
        },
        onAssetError: (_id, error) => { if (!disposed) setLoad((previous) => ({ ...previous, identity: latest.current.identity, error })); },
        onModelStats: (_id, stats) => { if (!disposed) setLoad((previous) => ({ ...previous, identity: latest.current.identity, stats })); },
      });
    }).catch(() => { if (!disposed) setSurface('unavailable'); });
    return () => { disposed = true; stage.current?.destroy(); stage.current = null; };
  }, [controller]);

  const status = load.identity === identity ? load.status : 'loading';
  const ready = status === 'ready' && surface === 'ready';
  const phaseText = { overview: '展柜总览', focusing: '正在取出', inspecting: '拖动旋转 · 双指或按钮缩放', returning: '正在放回' };
  function changeRotation(axis: number, number: number) {
    const rotation: ModelPlacement['rotation'] = [...value.rotation];
    rotation[axis] = number;
    onChange(modelPlacementSchema.parse({ ...value, rotation }));
  }

  return <section className={styles.preview} aria-label={`${label}的模型预览`} data-phase={inspection.phase} data-model-status={status}
    onKeyDown={(event) => { if (event.key === 'Escape') controller.returnToOverview(); }}>
    <div className={styles.visual}>
      <canvas ref={canvas} className={styles.canvas} tabIndex={0} style={{ visibility: surface === 'ready' ? 'visible' : 'hidden' }}
        aria-label="三维模型预览；取出后拖动或用方向键旋转，双指、按钮或加减键缩放，Esc 放回" />
      <div className={styles.toolbar}>
        {inspection.phase === 'overview'
          ? <button type="button" disabled={!ready} onClick={() => { controller.select(itemId); canvas.current?.focus(); }}>取出查看</button>
          : <button type="button" onClick={() => controller.returnToOverview()}>放回展柜</button>}
        <span role="status">{surface !== 'ready' ? surface === 'loading' ? '正在准备三维展示…' : '三维展示暂不可用'
          : status === 'loading' ? '正在加载模型…' : status === 'failed' ? '模型加载失败' : phaseText[inspection.phase]}</span>
        {inspection.phase === 'inspecting' && ready && <><button type="button" aria-label="缩小模型" onClick={() => stage.current?.zoomBy(1 / 1.12)}>− 缩小</button><button type="button" aria-label="放大模型" onClick={() => stage.current?.zoomBy(1.12)}>＋ 放大</button><button type="button" onClick={() => stage.current?.resetView()}>重置观察角度</button></>}
      </div>
      {surface !== 'ready' && <div className={styles.notice}><p>{surface === 'loading' ? '正在准备展柜…' : surface === 'context-lost' ? '三维展示已中断，下方资料仍可查看。' : '三维展示暂不可用，下方资料仍可查看。'}</p>
        {surface !== 'loading' && <button type="button" onClick={() => stage.current?.retry()}>重试三维展示</button>}</div>}
      {status === 'failed' && surface === 'ready' && <div className={styles.notice} role="alert"><p>{load.error ?? '模型无法读取，请重试或更换模型。'}</p><button type="button" onClick={() => stage.current?.retryModel(itemId)}>重新加载模型</button></div>}
    </div>
    <div className={styles.controls}>
      <h2>{label}</h2><p>调整旧物在展柜中的方向与大小。拖动查看产生的观察角度不会写入陈列。</p>
      <fieldset disabled={applying}>
        <legend>陈列设置</legend>
        {(['左右朝向', '前后倾斜', '侧向倾斜'] as const).map((name, index) => {
          const axis = [1, 0, 2][index] ?? 0;
          return <label key={name} htmlFor={`${controlId}-${axis}`}>{name}<output>{value.rotation[axis]}°</output>
            <input id={`${controlId}-${axis}`} type="range" min={-180} max={180} step={5} value={value.rotation[axis]} onChange={(event) => changeRotation(axis, Number(event.target.value))} /></label>;
        })}
        <label htmlFor={`${controlId}-size`}>陈列大小<output>{Math.round(value.size * 100)}%</output><input id={`${controlId}-size`} type="range" min={25} max={100} step={1} value={Math.round(value.size * 100)} onChange={(event) => onChange(modelPlacementSchema.parse({ ...value, size: Number(event.target.value) / 100 }))} /></label>
        <div className={styles.actions}><button type="button" onClick={() => onChange(defaultModelPlacement())}>重置陈列设置</button>
          {onApply && <button type="button" className={styles.primary} disabled={!ready || applying} onClick={() => onApply({ assetId: source.assetId, version: source.version, placement: modelPlacementSchema.parse(value) })}>{applying ? '正在保存…' : '采用当前陈列'}</button>}</div>
      </fieldset>
      {load.identity === identity && load.stats && <p className={styles.stats}>模型面数 {load.stats.triangles.toLocaleString('zh-CN')} · 贴图 {load.stats.textures} 张</p>}
    </div>
    <div className={styles.fallback}>{fallback}</div>
  </section>;
}
