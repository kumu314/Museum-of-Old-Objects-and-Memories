'use client';

import { useEffect, useRef, useState } from 'react';
import { mountCabinetStage, type AssetStatus, type SurfaceStatus } from './cabinet-stage.ts';
import { createInspectionController } from '../viewer/inspection-controller.ts';

type StageApi = ReturnType<typeof mountCabinetStage>;

const items = [
  { id: 'camera', slot: 0, modelKey: 'camera-01' },
  { id: 'cassette', slot: 1, modelKey: 'cassette' },
  { id: 'ticket', slot: 3, modelKey: 'ticket', plaqueText: '旧信件 / 1999' },
  { id: 'polaroid', slot: 2, modelKey: 'photo-plane', photoUrl: new URL('./assets/home-landscape.webp', import.meta.url).href },
] as const;

const idleStatuses: Record<string, AssetStatus> = {
  camera: 'loading', cassette: 'loading', polaroid: 'loading', ticket: 'loading',
};

export function HomeCabinetStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageApi | null>(null);
  const [surface, setSurface] = useState<SurfaceStatus | 'loading'>('loading');
  const [assets, setAssets] = useState<Record<string, AssetStatus>>(idleStatuses);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    // 画布与 WebGL 上下文是永久绑定的：要重新初始化就只能换一张画布。
    // StrictMode 双挂载、点重试、HMR 都会重跑这里，复用同一张只会拿回已丢失的上下文。
    const canvas = document.createElement('canvas');
    canvas.className = 'block w-full';
    canvas.style.aspectRatio = '1.5 / 1';
    canvas.setAttribute('aria-label', '六格木柜三维展柜：陈列相机、磁带、相片与旧车票');
    host.prepend(canvas);
    // StrictMode 会立即清理首次 effect；在下一帧再初始化，避免创建后马上销毁整套 GPU 资源。
    let stage: StageApi | null = null;
    const frame = requestAnimationFrame(() => {
      const controller = createInspectionController(items.map((item) => item.id));
      stage = mountCabinetStage(canvas, items, controller, {
        inspectionInset: () => 0,
        homePresentation: true,
        onSurfaceStatus: setSurface,
        onAssetStatus: (id, status) => setAssets((current) => ({ ...current, [id]: status })),
      });
      stageRef.current = stage;
    });
    return () => { cancelAnimationFrame(frame); stage?.destroy(); canvas.remove(); stageRef.current = null; };
  }, [attempt]);

  const unavailable = surface === 'unavailable' || surface === 'context-lost';
  const pending = items.filter((item) => assets[item.id] === 'loading').length;
  const ready = items.filter((item) => assets[item.id] === 'ready').length;
  const loadingMessage = surface === 'loading' ? '正在准备三维展柜…'
    : pending > 0 ? (ready > 0 ? `已就绪的旧物可点击检视，还有 ${pending} 件正在加载…` : '展柜已就绪，正在加载旧物…')
    : assets['cabinet-material'] === 'loading' ? '旧物已就绪，正在加载木纹…' : null;
  const failedItems = items.filter((item) => assets[item.id] === 'failed');
  const anyFailed = Object.values(assets).some((status) => status === 'failed');

  return <div ref={hostRef} className="museum-home-cabinet relative" style={{
    marginBottom: '-3%',
    maskImage: 'radial-gradient(102% 98% at 50% 46%, black 70%, transparent 100%)',
    WebkitMaskImage: 'radial-gradient(102% 98% at 50% 46%, black 70%, transparent 100%)',
  }}>
    {loadingMessage !== null && !unavailable && <p role="status" className="absolute inset-x-0 bottom-4 text-center text-sm text-[#B7A994]">{loadingMessage}</p>}
    {anyFailed && !unavailable && <p role="status" className="absolute inset-x-0 bottom-12 text-center text-sm text-[#B7A994]">部分素材未加载，可继续检视已就绪的旧物。{failedItems.length > 0 && <button className="ml-2 underline" onClick={() => { for (const item of failedItems) stageRef.current?.retryModel(item.id); }}>重试展品</button>}</p>}
    {unavailable && <div className="absolute inset-0 grid place-items-center rounded-xl border border-[#3A2D20] bg-[#19140F]">
      <div className="max-w-sm px-8 text-center">
        <p className="text-[15px] text-[#F0E8DA]">当前浏览器无法展示三维展柜。</p>
        <p className="mt-3 text-sm leading-7 text-[#B7A994]">旧物照片与故事仍然可以浏览。你也可以稍后重试，或直接注册开始收藏。</p>
        <div className="mt-6 flex justify-center gap-3">
          <button className="rounded-full border border-[#C8A56B]/60 px-5 py-2 text-sm text-[#F0E8DA] hover:border-[#C8A56B]" onClick={() => { setSurface('loading'); setAssets(idleStatuses); setAttempt((value) => value + 1); }}>重试</button>
          <a className="rounded-full px-5 py-2 text-sm text-[#C8A56B] underline underline-offset-4" href="/login">去注册</a>
        </div>
        {anyFailed && <p className="mt-4 text-xs text-[#7A6C5B]">部分展品素材加载失败，重试通常可以恢复。</p>}
      </div>
    </div>}
  </div>;
}
