'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, AmbientLight, Box3, DirectionalLight, Group, PerspectiveCamera,
  Scene, SpotLight, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { modelManifest } from './model-manifest.ts';
import { refineCameraMaterials } from './camera-materials.ts';
import { createWarmEnvironment } from './warm-environment.ts';

type ViewerApi = { dispose: () => void; resetView: () => void; setPreset: (index: number) => void };

const PRESETS = [
  { label: '角度一', yaw: 0.15, pitch: 0.05 },
  { label: '角度二', yaw: 1.05, pitch: 0.24 },
  { label: '角度三', yaw: -0.95, pitch: -0.12 },
  { label: '角度四', yaw: 2.55, pitch: 0.32 },
] as const;

const HOME_YAW = 0.35;
const HOME_PITCH = 0.08;

export function CameraStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let disposed = false;
    let created: WebGLRenderer | null = null;
    try {
      created = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      created = null;
    }
    // WebGL 不可用时延迟一拍再提示，避免在 effect 内同步 setState。
    if (created === null) {
      const timer = window.setTimeout(() => setUnavailable(true), 0);
      return () => window.clearTimeout(timer);
    }
    const renderer = created;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = SRGBColorSpace;

    const scene = new Scene();
    const camera = new PerspectiveCamera(32, 1, 0.1, 60);
    camera.position.set(0, 0.55, 3.1);

    const environment = createWarmEnvironment(renderer);
    scene.environment = environment.texture;
    const ambient = new AmbientLight(0x8a7a66, 0.5);
    const key = new SpotLight(0xffe2b4, 90, 12, 0.55, 0.5, 1.6);
    key.position.set(0.6, 3.2, 1.6);
    const rim = new DirectionalLight(0xE1C58E, 1.4);
    rim.position.set(-2.2, 1.4, -2.6);
    scene.add(ambient, key, key.target, rim);

    const holder = new Group();
    scene.add(holder);
    let yaw = HOME_YAW;
    let pitch = HOME_PITCH;
    let targetYaw = HOME_YAW;
    let targetPitch = HOME_PITCH;
    let distance = 4.4;
    let targetDistance = 4.4;

    const loader = new GLTFLoader();
    const url = modelManifest['camera-01'].path;
    let ready = false;
    loader.load(url, (gltf) => {
      if (disposed) { gltf.scene.traverse(() => undefined); return; }
      refineCameraMaterials(gltf.scene);
      const box = new Box3().setFromObject(gltf.scene);
      const center = new Vector3(); box.getCenter(center);
      const size = new Vector3(); box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      gltf.scene.position.sub(center);
      holder.add(gltf.scene);
      holder.scale.setScalar(1.5 / maxDim);
      ready = true;
      requestRender();
    }, undefined, () => { if (!disposed) setUnavailable(true); });

    let frame = 0;
    function render() {
      frame = 0;
      if (disposed) return;
      const settle = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0.14;
      const yawGap = targetYaw - yaw;
      const pitchGap = targetPitch - pitch;
      const distanceGap = targetDistance - distance;
      yaw += yawGap * settle;
      pitch += pitchGap * settle;
      distance += distanceGap * settle;
      holder.rotation.set(pitch, yaw, 0, 'YXZ');
      camera.position.set(0, distance * 0.22, distance);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      if (Math.abs(yawGap) + Math.abs(pitchGap) + Math.abs(distanceGap) > 0.0008) requestRender();
    }
    function requestRender() { if (frame === 0 && !disposed) frame = requestAnimationFrame(render); }
    function resetView() { targetYaw = HOME_YAW; targetPitch = HOME_PITCH; targetDistance = 4.4; requestRender(); }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      requestRender();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let drag: { id: number; x: number; y: number; startX: number; startY: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag !== null) return;
      canvas.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
    }
    const onPointerMove = (event: PointerEvent) => {
      if (drag === null || drag.id !== event.pointerId) return;
      targetYaw += (event.clientX - drag.x) * 0.0095;
      targetPitch = Math.max(-0.6, Math.min(0.6, targetPitch + (event.clientY - drag.y) * 0.007));
      drag.x = event.clientX; drag.y = event.clientY;
      requestRender();
    }
    // 点击展品周边（拖动距离小于阈值且不落在机身上）返回初始视角。
    const onPointerUp = (event: PointerEvent) => {
      if (drag === null || drag.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5;
      drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (moved || !ready) return;
      const rect = canvas.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = 1 - ((event.clientY - rect.top) / rect.height) * 2;
      // 展品居中且占视口约七成，周边一倍半径之外视为空白区域。
      if (Math.hypot(nx, ny) > 0.62) resetView();
    }
    const onWheel = (event: WheelEvent) => { event.preventDefault(); targetDistance = Math.max(3, Math.min(6.5, targetDistance * Math.exp(event.deltaY * 0.001))); requestRender(); }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') resetView(); }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    const api: ViewerApi = {
      dispose() {
        disposed = true;
        apiRef.current = null;
        if (frame !== 0) cancelAnimationFrame(frame);
        observer.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('keydown', onKeyDown);
        holder.traverse((node) => {
          const mesh = node as { geometry?: { dispose(): void }; material?: { dispose(): void; map?: { dispose(): void } } };
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else { material?.map?.dispose(); material?.dispose(); }
        });
        environment.dispose();
        renderer.dispose();
      },
      resetView,
      setPreset(index: number) {
        const preset = PRESETS[index];
        if (preset === undefined) return;
        targetYaw = preset.yaw; targetPitch = preset.pitch; requestRender();
      },
    };
    apiRef.current = api;
    return () => api.dispose();
  }, [attempt]);

  function callPreset(index: number) { setActive(index); apiRef.current?.setPreset(index); }
  function callReset() { setActive(0); apiRef.current?.resetView(); }

  if (unavailable) {
    return <div className="relative grid place-items-center overflow-hidden rounded-xl border border-[#3A2D20] aspect-[1.06/1] bg-[#19140F]">
      <div className="max-w-sm px-8 text-center">
        <p className="text-[15px] text-[#F0E8DA]">当前浏览器无法展示三维相机。</p>
        <p className="mt-3 text-sm leading-7 text-[#B7A994]">可以查看相机实拍照片，或稍后重试。</p>
        <button className="mt-5 rounded-full border border-[#C8A56B]/60 px-5 py-2 text-sm text-[#F0E8DA] hover:border-[#C8A56B]" onClick={() => { setUnavailable(false); setAttempt((value) => value + 1); }}>重试</button>
      </div>
    </div>;
  }

  return <div className="grid grid-cols-[1fr_auto] items-stretch gap-4">
    <div className="relative grid place-items-center aspect-[1.06/1]"
      style={{
        background: 'radial-gradient(85% 62% at 50% 16%, rgba(225,197,142,.18), transparent 60%), radial-gradient(120% 60% at 50% 112%, rgba(58,45,26,.45), transparent 60%), linear-gradient(180deg, #1D160F 0%, #140F0A 100%)',
        maskImage: 'radial-gradient(120% 118% at 50% 46%, black 58%, transparent 98%)',
        WebkitMaskImage: 'radial-gradient(120% 118% at 50% 46%, black 58%, transparent 98%)',
      }}>
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" aria-label="复古相机三维检视：拖拽旋转，滚轮缩放，点击空白处或按 Esc 返回初始视角" />
      <span className="pointer-events-none absolute left-[7%] top-[9%] -rotate-[4deg] font-serif text-[15px] tracking-[.16em]" aria-hidden="true">360° 检视</span>
      <span className="pointer-events-none absolute bottom-[13%] right-[9%] font-serif text-[17px] tracking-[.1em] text-[#C8A56B]" aria-hidden="true">360°</span>
      <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-[#7A6C5B]">拖拽旋转 · 滚轮缩放 · 点击空白处返回初始视角</p>
    </div>
    <div className="grid justify-items-center gap-3" role="group" aria-label="相机预设角度">
      <span className="mb-1 text-[10.5px] tracking-[.26em] text-[#7A6C5B] [writing-mode:vertical-rl]">A CLOSER LOOK AT MEMORIES</span>
      {PRESETS.map((preset, index) => (
        <button key={preset.label} type="button" aria-pressed={index === active} aria-label={preset.label}
          onClick={() => callPreset(index)}
          className={`h-16 w-16 overflow-hidden rounded-lg border transition ${index === active ? 'border-[#C8A56B] opacity-100 shadow-[0_0_0_1px_#C8A56B,0_10px_22px_-12px_rgba(200,165,107,.75)]' : 'border-[#3A2D20] opacity-55 hover:opacity-90'}`}>
          <img src={`https://images.unsplash.com/photo-1510127034890-ba27508e9f1c?auto=format&fit=crop&w=160&h=160&q=70`} alt="" className="h-full w-full object-cover" style={{ filter: 'sepia(.45) contrast(1.15) brightness(.6) saturate(.85)' }} />
        </button>
      ))}
      <button type="button" onClick={callReset} className="mt-1 rounded-full border border-[#C8A56B]/50 px-3 py-1.5 text-xs text-[#B7A994] hover:border-[#C8A56B] hover:text-[#F0E8DA]">返回初始视角</button>
    </div>
  </div>;
}
