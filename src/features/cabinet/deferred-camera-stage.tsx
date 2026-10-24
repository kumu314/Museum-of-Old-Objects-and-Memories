'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

function CameraPlaceholder() {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px] sm:grid-cols-[minmax(0,1fr)_64px] gap-2 pr-4 sm:gap-4" aria-label="相机展示区">
    <div className="grid aspect-[1.06/1] place-items-center text-sm text-[#B7A994]" role="status">正在准备相机展示…</div>
    <div className="w-12 sm:w-16" aria-hidden="true" />
  </div>;
}

const CameraStage = dynamic(() => import('./camera-stage').then((module) => module.CameraStage), {
  ssr: false,
  loading: CameraPlaceholder,
});

export function DeferredCameraStage() {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    // 在接近视口时启动第二个场景，避免与首屏展柜同时初始化 GPU 和模型。
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={container}>{visible ? <CameraStage /> : <CameraPlaceholder />}</div>;
}
