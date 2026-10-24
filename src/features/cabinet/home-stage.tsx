'use client';

import { useEffect, useRef, useState } from 'react';
import { mountCabinetStage, type AssetStatus, type SurfaceStatus } from './cabinet-stage.ts';
import { createInspectionController } from '../viewer/inspection-controller.ts';

type StageApi = ReturnType<typeof mountCabinetStage>;

const items = [
  { id: 'camera', slot: 0, modelKey: 'camera-01' },
  { id: 'cassette', slot: 1, modelKey: 'cassette' },
  { id: 'polaroid', slot: 2, modelKey: 'photo-plane', photoUrl: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=900&h=1200&q=80' },
] as const;

const idleStatuses: Record<string, AssetStatus> = {
  camera: 'loading', cassette: 'loading', polaroid: 'loading',
};

export function HomeCabinetStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<StageApi | null>(null);
  const [surface, setSurface] = useState<SurfaceStatus | 'loading'>('loading');
  const [assets, setAssets] = useState<Record<string, AssetStatus>>(idleStatuses);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ids = items.map((item) => item.id);
    const controller = createInspectionController(ids);
    const stage = mountCabinetStage(canvas, items, controller, {
      inspectionInset: () => 0,
      onSurfaceStatus: setSurface,
      onAssetStatus: (id, status) => setAssets((current) => ({ ...current, [id]: status })),
    });
    stageRef.current = stage;
    return () => { stage.destroy(); stageRef.current = null; };
  }, [attempt]);

  const unavailable = surface === 'unavailable' || surface === 'context-lost';
  const loading = surface === 'loading' || Object.values(assets).some((status) => status === 'loading');
  const anyFailed = Object.values(assets).some((status) => status === 'failed');

  return <div className="relative" style={{
    maskImage: 'radial-gradient(102% 98% at 50% 46%, black 40%, rgba(0,0,0,.45) 62%, transparent 80%)',
    WebkitMaskImage: 'radial-gradient(102% 98% at 50% 46%, black 40%, rgba(0,0,0,.45) 62%, transparent 80%)',
  }}>
    <canvas ref={canvasRef} className="block w-full" style={{ aspectRatio: '1.06 / 1' }} aria-label="六格木柜三维展柜：陈列相机、磁带、拍立得与信封" />
    {loading && !unavailable && <p role="status" className="absolute inset-x-0 bottom-4 text-center text-sm text-[#B7A994]">正在布置展柜…</p>}
    {unavailable && <div className="absolute inset-0 grid place-items-center rounded-xl border border-[#3A2D20] bg-[#19140F]">
      <div className="max-w-sm px-8 text-center">
        <p className="text-[15px] text-[#F0E8DA]">当前浏览器无法展示三维展柜。</p>
        <p className="mt-3 text-sm leading-7 text-[#B7A994]">旧物照片与故事仍然可以浏览。你也可以稍后重试，或直接注册开始收藏。</p>
        <div className="mt-6 flex justify-center gap-3">
          <button className="rounded-full border border-[#C8A56B]/60 px-5 py-2 text-sm text-[#F0E8DA] hover:border-[#C8A56B]" onClick={() => { setSurface('loading'); setAttempt((value) => value + 1); }}>重试</button>
          <a className="rounded-full px-5 py-2 text-sm text-[#C8A56B] underline underline-offset-4" href="/login">去注册</a>
        </div>
        {anyFailed && <p className="mt-4 text-xs text-[#7A6C5B]">部分展品素材加载失败，重试通常可以恢复。</p>}
      </div>
    </div>}
  </div>;
}
