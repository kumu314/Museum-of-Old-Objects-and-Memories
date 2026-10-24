'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AssetStatus, SurfaceStatus, mountCabinetStage } from '../cabinet/cabinet-stage';
import { createInspectionController } from '../viewer/inspection-controller';
import { cabinetItems, type CabinetExhibit } from './cabinet-items';
import { cabinetPage, cabinetPageCount, cabinetPosition, exhibitsOnPage, slotsPerPage } from './cabinet-pages';

export function CabinetPreview({ exhibits, selectedSlot, disabled, onSelectSlot, assetBase, mode = 'edit' }: {
  exhibits: readonly CabinetExhibit[]; selectedSlot: number; disabled: boolean;
  onSelectSlot: (slot: number) => void; assetBase: string; mode?: 'edit' | 'visit';
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const inspectButton = useRef<HTMLButtonElement>(null);
  const stage = useRef<ReturnType<typeof mountCabinetStage> | null>(null);
  const page = cabinetPage(selectedSlot);
  const pageCount = Math.max(cabinetPageCount(exhibits), page + 1);
  const pageExhibits = useMemo(() => exhibitsOnPage(exhibits, page), [exhibits, page]);
  const modelAssetBase = assetBase.replace(/\/assets$/, '/model-assets');
  // 模型加载失败的展品自动回退为照片展示；回退保持到用户点“重试模型”。
  const [modelFallback, setModelFallback] = useState<ReadonlySet<string>>(new Set());
  const items = useMemo(
    () => cabinetItems(pageExhibits, assetBase, modelAssetBase, modelFallback),
    [pageExhibits, assetBase, modelAssetBase, modelFallback]);
  const controller = useMemo(() => createInspectionController(items.map((item) => item.id)), [items]);
  const inspection = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [surfaceState, setSurface] = useState<{ controller: typeof controller; value: SurfaceStatus | 'loading' }>({ controller, value: 'loading' });
  const [assetState, setAssetStates] = useState<{ controller: typeof controller; values: Readonly<Record<string, AssetStatus>> }>({ controller, values: {} });
  const surface = surfaceState.controller === controller ? surfaceState.value : 'loading';
  const assetStates = useMemo(
    () => (assetState.controller === controller ? assetState.values : {}),
    [assetState, controller]);
  const [expanded, setExpanded] = useState(false);
  const [sceneRetry, setSceneRetry] = useState(0);
  const selected = exhibits.find((exhibit) => exhibit.slotIndex === selectedSlot);
  const selectedItem = items.find((item) => item.id === selected?.id);
  const adoptedId = (selected as { generatedModelAssetId?: string | null } | undefined)?.generatedModelAssetId ?? null;
  const generatedSelected = adoptedId !== null;
  const modelLoadFailed = generatedSelected && selected !== undefined && assetStates[selected.id] === 'failed';
  const modelLoading = generatedSelected && selected !== undefined && assetStates[selected.id] === 'loading';

  const selectSlot = useEffectEvent((slot: number) => { if (!disabled) onSelectSlot(slot); });

  useEffect(() => {
    let cancelled = false;
    const element = canvas.current;
    if (!element) return;
    import('../cabinet/cabinet-stage').then(({ mountCabinetStage: mount }) => {
      if (cancelled) return;
      const instance = mount(element, items, controller, {
        onSlotSelect: (slot) => selectSlot(page * slotsPerPage + slot), inspectionInset: () => 0,
        onSurfaceStatus: (value) => { if (!cancelled) setSurface({ controller, value }); },
        onAssetStatus: (id, status) => {
          if (cancelled) return;
          setAssetStates((current) => ({ controller, values: { ...(current.controller === controller ? current.values : {}), [id]: status } }));
          if (status === 'failed') {
            // 模型加载失败立即回退为照片，柜格不留空位（见 items 构造）。
            setModelFallback((current) => current.has(id) ? current : new Set([...current, id]));
          }
        },
      });
      instance.setArrangement(pageExhibits.filter((exhibit) => items.some((item) => item.id === exhibit.id))
        .map((exhibit) => ({ id: exhibit.id, slot: exhibit.slotIndex, plaqueText: Array.from(exhibit.name).slice(0, 24).join('') })));
      stage.current = instance;
    }).catch(() => { if (!cancelled) setSurface({ controller, value: 'unavailable' }); });
    return () => { cancelled = true; stage.current?.destroy(); stage.current = null; };
  }, [items, controller, pageExhibits, page, sceneRetry]);

  useEffect(() => controller.subscribe(() => {
    if (controller.getSnapshot().phase === 'overview') {
      setExpanded(false); inspectButton.current?.focus({ preventScroll: true });
    }
  }), [controller]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [expanded]);

  function inspect() {
    if (!selected || !selectedItem || disabled || surface !== 'ready' || assetStates[selected.id] !== 'ready') return;
    setExpanded(true); controller.select(selected.id); canvas.current?.focus({ preventScroll: true });
  }
  function close() {
    controller.returnToOverview();
    const current = controller.getSnapshot();
    if (surface !== 'ready' && current.phase === 'returning') controller.finishTransition(current.transitionId);
    if (controller.getSnapshot().phase === 'overview') { setExpanded(false); inspectButton.current?.focus(); }
  }

  function retrySurface() {
    if (stage.current) { stage.current.retry(); return; }
    setSurface({ controller, value: 'loading' }); setSceneRetry((value) => value + 1);
  }
  let surfaceMessage = '当前无法显示三维展柜，仍可用下方格位选择旧物。';
  if (surface === 'loading') surfaceMessage = '正在打开木质展柜…';
  if (surface === 'context-lost') surfaceMessage = '三维画面暂时中断，照片和故事仍可使用。';

  return <div className="workbench-cabinet">
    <div ref={viewport} className={`workbench-cabinet-viewport ${expanded ? 'workbench-inspection' : ''}`}
      role={expanded ? 'dialog' : 'group'} aria-modal={expanded ? true : undefined} aria-label={expanded ? `检视${selected?.name ?? '旧物'}` : '实时六格展柜'}
      onKeyDown={(event) => {
        if (!expanded) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const targets = viewport.current?.querySelectorAll<HTMLButtonElement | HTMLCanvasElement>('button:not(:disabled),canvas');
        if (!targets?.length) return;
        const list = Array.from(targets);
        const index = list.findIndex((element) => element === document.activeElement);
        const next = (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
        event.preventDefault(); list[next]?.focus();
      }}>
      <canvas ref={canvas} tabIndex={expanded ? 0 : -1} aria-label="旧物三维展柜，使用下方格位按钮选择旧物；检视时方向键旋转，加减键缩放" />
      {expanded && <><div className="workbench-inspection-controls"><button type="button" className="wb-secondary" onClick={close}>← 返回展柜</button><span>{selected?.name}</span><button type="button" className="wb-secondary" disabled={surface !== 'ready'} onClick={() => stage.current?.resetView()}>重置角度</button></div><p className="workbench-inspection-help">拖动旋转 · 滚轮缩放 · 方向键与加减键也可操作 · Esc 返回</p></>}
      {surface !== 'ready' && <div className="workbench-cabinet-status" role="status"><p>{surfaceMessage}</p>
        {surface !== 'loading' && <button type="button" className="wb-secondary" onClick={retrySurface}>重试三维展示</button>}</div>}
    </div>
    <div className="workbench-slot-grid" role="group" aria-label="选择柜格">{Array.from({ length: slotsPerPage }, (_, slot) => {
      const globalSlot = page * slotsPerPage + slot;
      const exhibit = pageExhibits.find((item) => item.slotIndex === slot);
      return <button key={slot} type="button" disabled={disabled || expanded || (mode === 'visit' && !exhibit)} aria-pressed={selectedSlot === globalSlot} onClick={() => onSelectSlot(globalSlot)}><span>第 {slot + 1} 格</span>{exhibit?.name ?? (mode === 'edit' ? '＋ 收录旧物' : '尚未收录')}</button>;
    })}</div>
    <nav className="workbench-pagination" aria-label="展柜翻页"><button type="button" className="wb-text-link" disabled={disabled || expanded || page === 0} onClick={() => onSelectSlot(exhibits.find((item) => cabinetPage(item.slotIndex) === page - 1)?.slotIndex ?? (page - 1) * slotsPerPage)}>← 上一页</button>
      <span aria-live="polite">第 {page + 1} 页 / {pageCount} 页</span><button type="button" className="wb-text-link" disabled={disabled || expanded || (page === pageCount - 1 && (mode === 'visit' || pageExhibits.length === 0))} onClick={() => onSelectSlot(exhibits.find((item) => cabinetPage(item.slotIndex) === page + 1)?.slotIndex ?? (page + 1) * slotsPerPage)}>{page === pageCount - 1 && mode === 'edit' ? '＋ 新一页' : '下一页 →'}</button></nav>
    <div className="wb-row"><p className="wb-hint">当前选中 · {cabinetPosition(selectedSlot)}</p><button ref={inspectButton} type="button" className="wb-text-link" disabled={disabled || !selected || !selectedItem || surface !== 'ready' || assetStates[selected.id] !== 'ready'} onClick={inspect}>检视模型</button></div>
    {selected && generatedSelected && modelLoading && <p className="wb-hint" role="status">正在加载生成的三维模型，文件较大，首次可能需要数十秒…</p>}
    {selected && <p className="wb-hint">{generatedSelected && !modelFallback.has(selected.id) ? '已采纳本次照片生成的模型 · 近似复原' : selected.modelKey === 'photo-plane' ? '实拍照片平面展示 · 非三维复原' : '内置演示模型 · 非本次照片生成'}</p>}
    {selected && assetStates[selected.id] === 'failed' && !generatedSelected && <p className="wb-hint" role="alert">展示素材读取失败，照片与故事仍可使用。<button type="button" className="wb-text-link" onClick={() => stage.current?.retryModel(selected.id)}>重试素材</button></p>}
    {selected && modelLoadFailed && adoptedId && <p className="wb-hint" role="alert">生成模型加载失败，已回退为照片展示。<button type="button" className="wb-text-link" onClick={() => {
      setModelFallback((current) => { const next = new Set(current); next.delete(selected.id); return next; });
      setAssetStates((current) => ({ controller, values: { ...current.values, [selected.id]: 'loading' } }));
    }}>重试模型</button></p>}
    {assetStates['cabinet-material'] === 'failed' && <p className="wb-hint">木纹材质读取失败。展品和文字仍可操作，重新读取页面后可重试。</p>}
    {inspection.phase === 'returning' && <p className="wb-hint" role="status">正在放回展柜…</p>}
  </div>;
}
