import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, DirectionalLight,
  BoxGeometry, CanvasTexture, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, PlaneGeometry,
  SpotLight, Quaternion, Raycaster, RepeatWrapping, Scene,
  SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, MeshPhysicalMaterial, MeshStandardMaterial,
  type WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createInspectionController } from '../viewer/inspection-controller.ts';
import { createInspectionGesture } from '../viewer/inspection-gesture';
import { buildCabinetBody } from './cabinet-body.ts';
import { CABINET_WIDTH, CELL_SIZE, MODEL_UNITS_PER_METRE, slotRestPosition } from './cabinet-layout.ts';
import { createPlacedModel, defaultModelPlacement, modelPlacementSchema, type ModelPlacement } from './model-placement';
import { glbModelSourceSchema, loadGlbModel, type GlbModelSource, type ModelStats } from './glb-model';
import { disposeResources } from './model-resources';
import { modelManifest, type CabinetModelKey } from './model-manifest.ts';
import { refineCameraMaterials } from './camera-materials.ts';
import { createWarmEnvironment, createGlassEnvironment } from './warm-environment.ts';
import { createGallerySurroundings } from './gallery-surroundings.ts';
import { overviewOffset } from './overview-motion.ts';
import { updateBrassPlaqueText } from './brass-plaque.ts';
import type { CabinetArrangement } from './cabinet-arrangement.ts';
import { createFrameClock } from './frame-clock.ts';
import { probeWebgl2, webglFailure, type WebglFailure } from './webgl-capability.ts';

// Rendering inputs only. The public snapshot remains owned by C's shared schema.
export type CabinetStageItem = { readonly id: string; readonly slot: number; readonly plaqueText?: string } & (
  | { readonly modelKey: CabinetModelKey }
  | { readonly modelKey: 'photo-plane'; readonly photoUrl: string }
  | { readonly modelKey: 'glb'; readonly source: GlbModelSource; readonly placement?: ModelPlacement }
);
export type SurfaceStatus = 'ready' | 'unavailable' | 'context-lost';
export type AssetStatus = 'loading' | 'ready' | 'failed';
type Controller = ReturnType<typeof createInspectionController>;
export interface StageRenderStats { readonly cpuMs: number; readonly calls: number; readonly triangles: number; readonly textures: number; readonly geometries: number; readonly timestamp: number; readonly renderer: string }
interface StageOptions {
  readonly onSlotSelect?: (slot: number) => void;
  readonly onInspectionLayout?: (centerX: number, guideTop: number) => void;
  readonly onSlotDrop?: (id: string, targetSlot: number) => void;
  readonly onRenderStats?: (stats: StageRenderStats) => void;
  readonly onSurfaceStatus: (status: SurfaceStatus) => void;
  readonly inspectionInset: () => number;
  readonly onAssetStatus: (id: string, status: AssetStatus) => void;
  readonly onModelStats?: (id: string, stats: ModelStats) => void;
  readonly onAssetError?: (id: string, message: string) => void;
}
interface DisplayModel {
  item: CabinetStageItem; readonly group: Group; slot: number; status: AssetStatus | 'idle';
  placement: ModelPlacement; placed: ReturnType<typeof createPlacedModel> | null; request: AbortController | null;
}

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = { antialias: true, alpha: true, powerPreference: 'high-performance' };
// 画布与 WebGL 上下文是永久绑定的：卸载时 forceContextLoss 之后，同一张画布再 getContext
// 只会拿回那个已丢失的上下文。StrictMode 双挂载、HMR、重试都会复用同一个 canvas 元素，
// 所以把恢复句柄按画布存下来，下一次挂载才救得回来。
const lostControls = new WeakMap<HTMLCanvasElement, WEBGL_lose_context>();

export function mountCabinetStage(canvas: HTMLCanvasElement, items: readonly CabinetStageItem[], controller: Controller, options: StageOptions) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 100);
  const raycaster = new Raycaster();
  const pointerPosition = new Vector2();
  const resourceAbort = new AbortController();
  const ownedTextures = new Set<Texture>();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const woodMaterial = new MeshPhysicalMaterial({ color: '#756254', roughness: 0.78, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.48 });
  const innerMaterial = new MeshPhysicalMaterial({ color: '#8c7761', roughness: 0.86, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.5 });
  for (const material of [woodMaterial, innerMaterial]) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        #ifdef USE_MAP
          float grainLuma = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float contrastedGrain = max(0.012, (grainLuma - 0.19) * 1.9 + 0.19);
          diffuseColor.rgb *= contrastedGrain / max(grainLuma, 0.001);
        #endif
      `);
    };
  }
  scene.add(buildCabinetBody({ wood: woodMaterial, interior: innerMaterial }, new Map(items.map((item) => {
    const text = item.plaqueText ?? (item.modelKey === 'glb' ? '旧物模型' : item.modelKey === 'photo-plane' ? '实拍展品' : `${modelManifest[item.modelKey].displayName} · ${modelManifest[item.modelKey].eraLabel}`);
    return [item.slot, text];
  }))));
  scene.add(createGallerySurroundings());
  const backdropShade = new Mesh(new PlaneGeometry(40, 24), new MeshBasicMaterial({ color: '#080604', transparent: true, opacity: 0, depthWrite: false }));
  backdropShade.position.z = 2;
  backdropShade.visible = false;
  scene.add(backdropShade);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256; shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d');
  if (shadowContext === null) throw new Error('无法创建检视阴影');
  shadowContext.scale(1, .25);
  const shadowGradient = shadowContext.createRadialGradient(128, 128, 0, 128, 128, 128);
  shadowGradient.addColorStop(0, '#050302b3'); shadowGradient.addColorStop(1, '#05030200');
  shadowContext.fillStyle = shadowGradient; shadowContext.fillRect(0, 0, 256, 256);
  const inspectionShadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: new CanvasTexture(shadowCanvas), transparent: true, opacity: 0, depthWrite: false }));
  inspectionShadow.visible = false;
  scene.add(inspectionShadow);
  scene.add(new AmbientLight('#e5d3b5', 0.045));
  const keyLight = new DirectionalLight('#fff0da', 0.85);
  keyLight.position.set(-4, 7, 9);
  scene.add(keyLight);
  const fill = new DirectionalLight('#c8d1db', 0.14);
  fill.position.set(5, 2, 7);
  scene.add(fill);
  const slotLights = new Map<number, SpotLight>();
  for (let slot = 0; slot < 6; slot += 1) {
    const [x, floorY] = slotRestPosition(slot);
    const light = new SpotLight('#ffd09a', 17, 4.5, Math.PI / 2.8, 1, 2);
    const ceilingY = slot < 3 ? 2.48 : -0.24;
    light.position.set(x, ceilingY - 0.08, 0.15);
    light.target.position.set(x, floorY + 0.9, -0.72);
    scene.add(light, light.target);
    slotLights.set(slot, light);
  }
  const displayModels: DisplayModel[] = items.map((item) => {
    const group = new Group();
    group.position.set(...slotRestPosition(item.slot));
    scene.add(group);
    return { item, group, slot: item.slot, status: 'idle', request: null, placed: null,
      placement: item.modelKey === 'glb' ? modelPlacementSchema.parse(item.placement ?? defaultModelPlacement()) : { rotation: [0, 0, 0], size: 1 } };
  });
  const dropIndicator = new Line(new BufferGeometry().setFromPoints([
    new Vector3(-1.61, .03, 0), new Vector3(1.61, .03, 0), new Vector3(1.61, 2.2, 0),
    new Vector3(-1.61, 2.2, 0), new Vector3(-1.61, .03, 0),
  ]), new LineBasicMaterial({ color: '#ffe0a1', transparent: true, opacity: .9, depthTest: false, toneMapped: false }));
  dropIndicator.visible = false; dropIndicator.renderOrder = 20; scene.add(dropIndicator);
  let renderer: WebGLRenderer | null = null;
  let contextControl: WEBGL_lose_context | null = null;
  let failureReason: WebglFailure | 'canvas-context' | null = null;
  let glassEnvironmentTarget: WebGLRenderTarget | null = null;
  let environmentTarget: WebGLRenderTarget | null = null;
  let surfaceStatus: SurfaceStatus = 'unavailable';
  let frame = 0;
  let restoreTimer: number | null = null;
  let restoreDeadline: number | null = null;
  // 构造失败后只自动再走一次，避免在真的不可用的环境里空转。
  let retriedInitialize = false;
  const frameClock = createFrameClock();
  let destroyed = false;
  let zoom = 1;
  let yaw = 0;
  let pitch = 0;
  const gesture = createInspectionGesture();
  let editing = false;
  let slotDrag: { pointerId: number; modelId: string; startX: number; startY: number; offset: Vector3; position: Vector3; moved: boolean } | null = null;
  const dragPlane = new Plane(new Vector3(0, 0, 1), -1.35);
  const cameraTarget = new Vector3();
  const positionTarget = new Vector3();
  const rotationTarget = new Quaternion();
  const identityRotation = new Quaternion();
  const scaleTarget = new Vector3();
  const pointerOffset = new Vector2();
  const slotPlane = new Plane(new Vector3(0, 0, 1), -0.9);
  const slotIntersection = new Vector3();
  const originalCursor = canvas.style.cursor;
  let hoveredSlot: number | null = null;
  function namedMaterial(name: string) {
    const node = scene.getObjectByName(name);
    return node instanceof Mesh && node.material instanceof MeshStandardMaterial ? node.material : null;
  }
  const hoverSurfaces = Array.from({ length: 6 }, (_, slot) => ({
    slot, amount: 0, light: slotLights.get(slot),
    plaque: namedMaterial(`cabinet-plaque:${slot}`),
  }));

  function notifySurface(status: SurfaceStatus) { surfaceStatus = status; options.onSurfaceStatus(status); }
  function failWebgl(reason: WebglFailure | 'canvas-context') {
    failureReason = reason;
    // 只报结论，不把 Three 内部的 Error 对象再抛到控制台：这条路径是预期内的降级。
    console.warn(`三维展柜不可用（${reason}），已降级为静态界面`);
    renderer?.dispose(); renderer = null;
    // 手动重试时重新给一次自动重试的机会。
    retriedInitialize = false;
    notifySurface('unavailable');
  }
  function invalidate() { if (!destroyed && surfaceStatus === 'ready' && frame === 0) frame = requestAnimationFrame(render); }
  function render(time: number) {
    frame = 0;
    if (destroyed || renderer === null || surfaceStatus !== 'ready') return;
    const delta = frameClock.delta(time);
    const alpha = reducedMotion.matches ? 1 : 1 - Math.exp(-11 * delta);
    const state = controller.getSnapshot();
    const active = state.phase === 'focusing' || state.phase === 'inspecting';
    const rect = canvas.getBoundingClientRect();
    const inset = options.inspectionInset();
    const overviewDistance = 0.82 + Math.max(3.05 / 0.99, CABINET_WIDTH / (2 * 0.88 * Math.max(camera.aspect, 0.1))) / Math.tan(camera.fov * Math.PI / 360);
    const cameraDistance = active ? overviewDistance * .98 : overviewDistance;
    const focusGap = cameraDistance - 4.3;
    const overviewHeight = 0.50;
    const [offsetX, offsetY] = overviewOffset(pointerOffset.x, pointerOffset.y, state.phase, reducedMotion.matches);
    cameraTarget.set(offsetX, overviewHeight + offsetY, cameraDistance);
    camera.position.lerp(cameraTarget, alpha);
    const lookAtY = -0.32;
    camera.lookAt(0, lookAtY, 0);
    const visibleHalfWidth = Math.tan(camera.fov * Math.PI / 360) * focusGap * camera.aspect;
    const focusCenter = inset > 0 ? Math.min(.28, (rect.width - inset) / rect.width / 2) : .5;
    const focusX = (focusCenter * 2 - 1) * visibleHalfWidth;
    const visibleHeight = visibleHalfWidth * 2 / camera.aspect;
    const focusY = overviewHeight + (lookAtY - overviewHeight) * focusGap / cameraDistance - visibleHeight * .015;
    backdropShade.material.opacity += ((active ? 0.56 : 0) - backdropShade.material.opacity) * alpha;
    backdropShade.visible = backdropShade.material.opacity > 0.001;
    inspectionShadow.material.opacity += ((active ? .7 : 0) - inspectionShadow.material.opacity) * alpha;
    inspectionShadow.visible = inspectionShadow.material.opacity > .001;
    let moving = camera.position.distanceTo(cameraTarget) > 0.001 || Math.abs(backdropShade.material.opacity - (active ? 0.56 : 0)) > 0.001 || Math.abs(inspectionShadow.material.opacity - (active ? .7 : 0)) > .001;
    for (const surface of hoverSurfaces) {
      const target = state.phase === 'overview' && hoveredSlot === surface.slot ? 1 : 0;
      surface.amount += (target - surface.amount) * alpha;
      if (Math.abs(surface.amount - target) < 0.001) surface.amount = target;
      else moving = true;
      const highlight = 1 + surface.amount * 0.15;
      if (surface.light !== undefined) surface.light.intensity = 17 * highlight;
      if (surface.plaque !== null) {
        surface.plaque.envMapIntensity = 0.85 * highlight;

      }
    }
    for (const model of displayModels) {
      const focused = active && state.selectedId === model.item.id;
      const dragged = slotDrag?.modelId === model.item.id && slotDrag.moved;
      const contact = scene.getObjectByName(`cabinet-contact-shadow:${model.slot}`);
      if (contact !== undefined) contact.visible = !focused && !dragged;
      positionTarget.set(...slotRestPosition(model.slot));
      const [width, height, depth] = model.placed?.getSize() ?? CELL_SIZE;
      // Inspection fills the available foreground; cabinet placement and its restoration stay unchanged.
      const inspectionScale = Math.min(visibleHalfWidth * 2 * (rect.width - inset) / rect.width * .72 / Math.max(width, depth), visibleHeight * .62 / height);
      if (focused) positionTarget.set(focusX, focusY - height * inspectionScale * zoom / 2, 4.3);
      if (dragged && slotDrag !== null) positionTarget.copy(slotDrag.position);
      rotationTarget.copy(identityRotation);
      if (focused) {
        rotationTarget.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
        rotationTarget.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
      }
      scaleTarget.setScalar(focused ? inspectionScale * zoom : 1);
      model.group.position.lerp(positionTarget, alpha);
      model.group.quaternion.slerp(rotationTarget, alpha);
      model.group.scale.lerp(scaleTarget, alpha);
      const unsettled = model.group.position.distanceTo(positionTarget) > 0.001 || model.group.quaternion.angleTo(rotationTarget) > 0.001 || model.group.scale.distanceTo(scaleTarget) > 0.001;
      moving = moving || unsettled;
      if (!unsettled) { model.group.position.copy(positionTarget); model.group.quaternion.copy(rotationTarget); model.group.scale.copy(scaleTarget); }
      if (focused) {
        inspectionShadow.position.set(model.group.position.x, model.group.position.y - visibleHeight * .035, 4.3);
        inspectionShadow.scale.set(width * model.group.scale.x * 1.1, visibleHeight * .055, 1);
        options.onInspectionLayout?.(focusCenter * rect.width, Math.min(rect.height - 72, (.515 + height * inspectionScale / visibleHeight / 2 + .045) * rect.height));
      }
    }
    if (!moving) { camera.position.copy(cameraTarget); camera.lookAt(0, lookAtY, 0); }
    if (options.onRenderStats !== undefined) {
      renderer.info.autoReset = false;
      renderer.info.reset();
      const started = performance.now();
      renderer.render(scene, camera);
      const cpuMs = performance.now() - started;
      const gl = renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      options.onRenderStats({ cpuMs, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, timestamp: time,
        renderer: String(gl.getParameter(debug === null ? gl.RENDERER : debug.UNMASKED_RENDERER_WEBGL)) });
    } else renderer.render(scene, camera);
    if (moving) invalidate();
    else {
      frameClock.reset();
      if (state.phase === 'returning' || (state.phase === 'focusing' && displayModels.some((model) => model.item.id === state.selectedId && model.status === 'ready'))) controller.finishTransition(state.transitionId);
    }
  }
  function resize() {
    if (renderer === null) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    invalidate();
  }
  function rebuildEnvironment() {
    if (renderer === null) return;
    const next = createWarmEnvironment(renderer);
    environmentTarget?.dispose();
    environmentTarget = next;
    scene.environment = next.texture;
    scene.environmentIntensity = 0.28;
    const glassEnvironment = createGlassEnvironment(renderer);
    glassEnvironmentTarget?.dispose(); glassEnvironmentTarget = glassEnvironment;
    for (let slot = 0; slot < 6; slot++) {
      for (const name of [`cabinet-front-glass:${slot}`, `cabinet-side-glass:${slot}:-1`, `cabinet-side-glass:${slot}:1`]) {
        const pane = scene.getObjectByName(name);
        if (pane instanceof Mesh && pane.material instanceof MeshPhysicalMaterial) {
          pane.material.envMap = glassEnvironment.texture; pane.material.needsUpdate = true;
        }
      }
    }
    for (const surface of hoverSurfaces) {
      if (surface.plaque === null) continue;
      // Explicit envMap enables this material's own highlight intensity in Three.
      surface.plaque.envMap = next.texture; surface.plaque.needsUpdate = true;
    }
  }
  function initializeRenderer() {
    if (destroyed) return;
    if (renderer !== null) { contextControl?.restoreContext(); return; }
    const context = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    if (context === null) { failWebgl('no-context'); return; }
    if (context.isContextLost()) {
      // 上一次挂载丢掉了上下文。画布不能重建上下文，只能请求恢复，等 restored 事件后重走构造。
      const control = lostControls.get(canvas) ?? context.getExtension('WEBGL_lose_context');
      if (control === null) { failWebgl('context-lost'); return; }
      lostControls.set(canvas, control);
      control.restoreContext();
      // restored 是异步的；恢复不了就如实降级，别让界面停在既没画面又没提示的状态。
      if (restoreDeadline !== null) window.clearTimeout(restoreDeadline);
      restoreDeadline = window.setTimeout(() => {
        restoreDeadline = null;
        if (!destroyed && renderer === null) failWebgl('context-lost');
      }, 1500);
      return;
    }
    try {
      // 无 GPU 的预览机会返回句柄但 attributes 为 null。这条边界必须自己判掉：
      // WebGLRenderer 构造器读 attributes.alpha 会抛 TypeError，而不是给出可恢复的失败。
      const failure = webglFailure(context);
      if (failure !== null) throw new Error(`WebGL2 上下文不可用：${failure}`);
      renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true, powerPreference: 'high-performance' });
      // A lost context may stop returning extensions; retain the recovery handle now.
      contextControl = renderer.getContext().getExtension('WEBGL_lose_context');
      renderer.setClearColor(0x100c09, 0);
      renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio)));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      // Glass resamples the opaque scene; retain two physical samples per CSS pixel for lettering.
      renderer.transmissionResolutionScale = 2 / renderer.getPixelRatio();
      rebuildEnvironment();
      failureReason = null;
      retriedInitialize = false;
    } catch {
      // forceContextLoss 之后 isContextLost() 要等 webglcontextlost 事件派发完才变 true。
      // 这个窗口里构造必然失败，但上下文其实还救得回来：先等一拍重走一次，否则就会
      // 变成"首次加载降级、手动点一下重试才恢复"。
      if (!retriedInitialize) {
        retriedInitialize = true;
        // 等一拍再重走：此刻 isContextLost() 还没稳定，重试会走错分支。
        window.setTimeout(() => { if (!destroyed && renderer === null) initializeRenderer(); }, 50);
        return;
      }
      // 预检只用于归因，不参与放行：虚拟化环境下脱离文档的画布测不准，真实画布的判定为准，
      // 否则一次假阴性就会把本来能渲染的展柜判死。
      const probe = probeWebgl2();
      failWebgl(probe.supported ? 'canvas-context' : probe.reason); return;
    }
    notifySurface('ready'); resize();
  }
  // 卸载时专用：取消 lost 事件才能让这张画布上的上下文在下次挂载时被 restoreContext 要回来。
  function allowRestore(event: Event) { event.preventDefault(); }
  function onContextLost(event: Event) {
    cancelDrag();
    event.preventDefault(); if (frame !== 0) cancelAnimationFrame(frame); frame = 0;
    frameClock.reset();
    if (restoreTimer !== null) window.clearTimeout(restoreTimer); restoreTimer = null;
    notifySurface('context-lost');
  }
  function onContextRestored() {
    // The next task runs after Three's native listener has rebuilt its GL internals.
    if (restoreTimer !== null) window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(() => {
      restoreTimer = null;
      if (destroyed) return;
      if (restoreDeadline !== null) { window.clearTimeout(restoreDeadline); restoreDeadline = null; }
      // 上一次挂载丢失的上下文刚被恢复：此时还没有 renderer，要重走完整构造，而不是只重建环境贴图。
      if (renderer === null) { initializeRenderer(); return; }
      try {
        if (renderer !== null) contextControl = renderer.getContext().getExtension('WEBGL_lose_context');
        rebuildEnvironment(); notifySurface('ready'); frameClock.reset(); resize();
      }
      catch (error: unknown) { console.warn('无法恢复三维展示', error); renderer?.dispose(); renderer = null; notifySurface('unavailable'); }
    }, 0);
  }
  async function loadModel(display: DisplayModel) {
    if (destroyed || display.status === 'loading' || display.status === 'ready') return;
    const request = new AbortController(); display.request = request;
    display.status = 'loading'; options.onAssetStatus(display.item.id, 'loading');
    let model: Group | null = null;
    try {
      const signal = AbortSignal.any([resourceAbort.signal, request.signal, AbortSignal.timeout(30_000)]);
      const item = display.item;
      let stats: ModelStats | null = null;
      if (item.modelKey === 'glb') {
        const loaded = await loadGlbModel(item.source, signal);
        model = loaded.object; stats = loaded.stats;
      } else {
        const response = await fetch(item.modelKey === 'photo-plane' ? item.photoUrl : modelManifest[item.modelKey].path,
          { signal, ...(item.modelKey === 'photo-plane' ? { cache: 'no-store' } : {}) });
        if (!response.ok) throw new Error(`模型请求失败：${response.status}`);
        if (item.modelKey === 'photo-plane') {
          const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
          if (destroyed || signal.aborted) { bitmap.close(); signal.throwIfAborted(); return; }
          const texture = new Texture(bitmap);
          texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
          const width = 0.14;
          const height = width * bitmap.height / bitmap.width;
          const edge = new MeshStandardMaterial({ color: '#c5bda8', roughness: 0.9 });
          const front = new MeshStandardMaterial({ map: texture, roughness: 0.8 });
          model = new Group();
          const photograph = new Mesh(new BoxGeometry(width, height, 0.001), [edge, edge, edge, edge, front, edge]);
          photograph.position.y = height / 2;
          model.add(photograph);
        } else {
          const buffer = await response.arrayBuffer();
          signal.throwIfAborted();
          model = (await new GLTFLoader().parseAsync(buffer, '')).scene;
          if (item.modelKey === 'camera-01') refineCameraMaterials(model);
        }
      }
      signal.throwIfAborted();
      if (destroyed) { disposeResources(model); return; }
      const placed = createPlacedModel(model, CELL_SIZE, display.placement, item.modelKey === 'glb' ? undefined : MODEL_UNITS_PER_METRE);
      model.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof Texture) value.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1;
          }
        }
        // The nearly transparent scratch cover must not cast an opaque depth shadow.
        node.castShadow = materials.some((material) => !material.transparent || material.opacity >= 0.5);
        node.receiveShadow = true;
      });
      display.group.add(placed.object); display.placed = placed; model = null;
      if (stats !== null) options.onModelStats?.(item.id, stats);
      display.status = 'ready'; options.onAssetStatus(display.item.id, 'ready'); invalidate();
    } catch (error: unknown) {
      if (model !== null) disposeResources(model);
      if (!destroyed && !request.signal.aborted) {
        console.warn('展品模型载入失败', display.item.id, error); display.status = 'failed';
        options.onAssetError?.(display.item.id, error instanceof Error ? error.message : '模型无法载入，请重试。');
        options.onAssetStatus(display.item.id, 'failed'); invalidate();
      }
    } finally { if (display.request === request) display.request = null; }
  }
  async function loadWoodMaterial() {
    options.onAssetStatus('cabinet-material', 'loading');
    async function loadImage(url: URL) {
      const response = await fetch(url, { signal: AbortSignal.any([resourceAbort.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error(`材质请求失败：${response.status}`);
      const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
      if (destroyed) { bitmap.close(); throw new DOMException('Stage disposed', 'AbortError'); }
      const texture = new Texture(bitmap);
      texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping; texture.repeat.set(1, 1);
      texture.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1;
      texture.needsUpdate = true; ownedTextures.add(texture); return texture;
    }
    try {
      const [color, roughness, normal] = await Promise.all([
        loadImage(new URL('./assets/walnut-color.jpg', import.meta.url)),
        loadImage(new URL('./assets/walnut-roughness.jpg', import.meta.url)),
        loadImage(new URL('./assets/walnut-normal.jpg', import.meta.url)),
      ]);
      if (destroyed) return;
      color.colorSpace = SRGBColorSpace;
      for (const material of [woodMaterial, innerMaterial]) {
        material.map = color; material.normalMap = normal; material.normalScale.set(0.32, 0.32);
        material.roughnessMap = roughness; material.needsUpdate = true;
      }
      options.onAssetStatus('cabinet-material', 'ready'); invalidate();
    } catch (error: unknown) { if (!destroyed) { console.warn('展柜材质载入失败', error); options.onAssetStatus('cabinet-material', 'failed'); } }
  }
  function pointRay(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointerPosition.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerPosition, camera);
  }
  function slotAtPointer(event: PointerEvent) {
    pointRay(event);
    if (raycaster.ray.intersectPlane(slotPlane, slotIntersection) === null) return null;
    return Array.from({ length: 6 }, (_, slot) => slot).find((slot) => {
      const [x, y] = slotRestPosition(slot);
      return Math.abs(slotIntersection.x - x) < CELL_SIZE[0] / 2 && slotIntersection.y >= y && slotIntersection.y <= y + CELL_SIZE[1];
    }) ?? null;
  }
  function setHoveredSlot(slot: number | null) {
    canvas.style.cursor = slotDrag !== null ? 'grabbing' : slot === null ? originalCursor : editing ? 'grab' : 'pointer';
    if (hoveredSlot === slot) return;
    hoveredSlot = slot; invalidate();
  }
  function onOverviewPointerMove(event: PointerEvent) {
    if (editing || controller.getSnapshot().phase !== 'overview' || reducedMotion.matches || event.pointerType !== 'mouse') return;
    pointerOffset.set(event.clientX / window.innerWidth * 2 - 1, 1 - event.clientY / window.innerHeight * 2);
    invalidate();
  }
  function onViewportLeave() { cancelDrag(); pointerOffset.set(0, 0); setHoveredSlot(null); invalidate(); }
  function onPointerLeave() { setHoveredSlot(null); }
  function onMotionPreferenceChange() { pointerOffset.set(0, 0); invalidate(); }
  function pick(event: PointerEvent) {
    if (options.onSlotSelect && controller.getSnapshot().phase !== 'overview') return;
    if (controller.getSnapshot().phase === 'overview') {
      const slot = slotAtPointer(event);
      if (slot !== null && options.onSlotSelect) { options.onSlotSelect(slot); return; }
      const model = displayModels.find((entry) => entry.slot === slot);
      if (model !== undefined) { controller.select(model.item.id); return; }
    }
    pointRay(event);
    const hit = raycaster.intersectObjects(displayModels.map((model) => model.group), true)[0];
    if (hit === undefined) return;
    for (const model of displayModels) { let node = hit.object; while (node.parent !== null && node !== model.group) node = node.parent; if (node === model.group) { controller.select(model.item.id); return; } }
  }
  function cancelDrag() {
    for (const id of gesture.cancel()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    const previous = slotDrag; slotDrag = null; dropIndicator.visible = false;
    if (previous !== null && canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    setHoveredSlot(null); invalidate();
  }
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || slotDrag !== null) return;
    if (editing) {
      if (controller.getSnapshot().phase !== 'overview') return;
      const slot = slotAtPointer(event);
      const model = displayModels.find((entry) => entry.slot === slot && entry.status === 'ready');
      if (model === undefined || raycaster.ray.intersectPlane(dragPlane, slotIntersection) === null) return;
      canvas.setPointerCapture(event.pointerId);
      slotDrag = { pointerId: event.pointerId, modelId: model.item.id, startX: event.clientX, startY: event.clientY,
        offset: slotIntersection.clone().sub(model.group.position), position: model.group.position.clone(), moved: false };
      canvas.style.cursor = 'grabbing'; return;
    }
    canvas.setPointerCapture(event.pointerId); gesture.begin(event.pointerId, event.clientX, event.clientY, event.pointerType);
  }
  function onPointerMove(event: PointerEvent) {
    const state = controller.getSnapshot();
    if (slotDrag !== null && slotDrag.pointerId === event.pointerId) {
      slotDrag.moved ||= Math.hypot(event.clientX - slotDrag.startX, event.clientY - slotDrag.startY) >= 5;
      const targetSlot = slotAtPointer(event);
      if (raycaster.ray.intersectPlane(dragPlane, slotIntersection) !== null) {
        slotDrag.position.copy(slotIntersection).sub(slotDrag.offset); slotDrag.position.z = 1.35;
      }
      dropIndicator.visible = slotDrag.moved && targetSlot !== null;
      if (targetSlot !== null) { const [x, y] = slotRestPosition(targetSlot); dropIndicator.position.set(x, y, .98); }
      setHoveredSlot(targetSlot); invalidate(); return;
    }
    if (!gesture.has(event.pointerId)) {
      if (event.pointerType === 'mouse' && state.phase === 'overview') {
        const slot = slotAtPointer(event);
        setHoveredSlot(displayModels.some((entry) => entry.slot === slot) ? slot : null);
      }
      return;
    }
    const change = gesture.move(event.pointerId, event.clientX, event.clientY);
    if (state.phase === 'inspecting' && change) {
      yaw += change.dx * 0.009; pitch = Math.max(-0.65, Math.min(0.65, pitch + change.dy * 0.007));
      zoomBy(change.zoomFactor); invalidate();
    }
  }
  function onPointerUp(event: PointerEvent) {
    if (slotDrag !== null && slotDrag.pointerId === event.pointerId) {
      const dropped = slotDrag; const target = slotAtPointer(event); cancelDrag();
      if (dropped.moved && target !== null) options.onSlotDrop?.(dropped.modelId, target);
      return;
    }
    if (!gesture.has(event.pointerId)) return;
    const click = gesture.end(event.pointerId, event.clientX, event.clientY);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (click && !editing) pick(event);
  }
  function onPointerCancel(event: PointerEvent) {
    if (gesture.has(event.pointerId) || slotDrag?.pointerId === event.pointerId) cancelDrag();
  }
  function zoomBy(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('缩放比例必须为有限正数');
    if (controller.getSnapshot().phase !== 'inspecting') return;
    zoom = Math.max(0.75, Math.min(1.45, zoom * factor)); invalidate();
  }
  function onWheel(event: WheelEvent) { if (controller.getSnapshot().phase !== 'inspecting') return; event.preventDefault(); zoomBy(Math.exp(Math.max(-1, Math.min(1, -event.deltaY * 0.001)))); }
  function resetView() { yaw = 0; pitch = 0; zoom = 1; invalidate(); }
  function onDoubleClick() { if (controller.getSnapshot().phase === 'inspecting') resetView(); }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { if (slotDrag !== null) { event.preventDefault(); event.stopPropagation(); cancelDrag(); } else controller.returnToOverview(); return; }
    if (controller.getSnapshot().phase !== 'inspecting') return;
    if (event.key === 'ArrowLeft') yaw -= 0.15; else if (event.key === 'ArrowRight') yaw += 0.15;
    else if (event.key === 'ArrowUp') pitch = Math.max(-0.65, pitch - 0.1); else if (event.key === 'ArrowDown') pitch = Math.min(0.65, pitch + 0.1);
    else if (event.key === '+' || event.key === '=') zoom = Math.min(1.45, zoom + 0.1); else if (event.key === '-') zoom = Math.max(0.75, zoom - 0.1); else return;
    event.preventDefault(); invalidate();
  }
  const unsubscribe = controller.subscribe(() => {
    cancelDrag();
    yaw = 0; pitch = 0; zoom = 1;
    pointerOffset.set(0, 0); setHoveredSlot(null);
    const state = controller.getSnapshot();
    if (surfaceStatus !== 'ready' && state.phase === 'returning') controller.finishTransition(state.transitionId);
    else invalidate();
  });
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  const events = { pointerdown: onPointerDown, pointermove: onPointerMove, pointerup: onPointerUp, pointercancel: onPointerCancel, keydown: onKeyDown };
  canvas.addEventListener('webglcontextlost', onContextLost); canvas.addEventListener('webglcontextrestored', onContextRestored);
  canvas.addEventListener('pointerdown', events.pointerdown); canvas.addEventListener('pointermove', events.pointermove); canvas.addEventListener('pointerup', events.pointerup); canvas.addEventListener('pointercancel', events.pointercancel); canvas.addEventListener('keydown', events.keydown);
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDoubleClick); canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('lostpointercapture', onPointerCancel);
  window.addEventListener('pointermove', onOverviewPointerMove); window.addEventListener('blur', onViewportLeave); document.addEventListener('mouseleave', onViewportLeave);
  reducedMotion.addEventListener('change', onMotionPreferenceChange);
  camera.position.set(0, 0.4, 16); initializeRenderer();
  for (const display of displayModels) void loadModel(display);
  void loadWoodMaterial();
  return {
    zoomBy,
    getDiagnostics() {
      return { destroyed, surface: surfaceStatus, zoom, yaw, pitch, pendingFrame: frame !== 0,
        capability: renderer === null ? failureReason : 'supported',
        contextLost: renderer?.getContext().isContextLost() ?? true,
        pendingRequests: displayModels.filter((model) => model.request !== null).length,
        geometries: renderer?.info.memory.geometries ?? 0, textures: renderer?.info.memory.textures ?? 0,
        programs: renderer?.info.programs?.length ?? 0 };
    },
    setModelPlacement(id: string, input: ModelPlacement) {
      const model = displayModels.find((entry) => entry.item.id === id);
      if (!model || model.item.modelKey !== 'glb') throw new RangeError('该展品不支持动态模型陈列调整');
      const placement = modelPlacementSchema.parse(input);
      model.placed?.setPlacement(placement); model.placement = placement; invalidate();
    },
    setModelSource(id: string, input: GlbModelSource) {
      const model = displayModels.find((entry) => entry.item.id === id);
      if (!model || model.item.modelKey !== 'glb') throw new RangeError('该展品不支持动态模型替换');
      const source = glbModelSourceSchema.parse(input);
      if (model.item.source.assetId === source.assetId && model.item.source.version === source.version && model.item.source.url === source.url) return;
      model.request?.abort(); model.request = null;
      if (model.placed !== null) { model.group.remove(model.placed.object); disposeResources(model.placed.object); model.placed = null; }
      model.item = { ...model.item, source }; model.status = 'idle';
      void loadModel(model);
    },
    setEditing(enabled: boolean) { editing = enabled; cancelDrag(); pointerOffset.set(0, 0); invalidate(); },
    setArrangement(arrangement: CabinetArrangement) {
      cancelDrag();
      for (const model of displayModels) {
        const placement = arrangement.find((entry) => entry.id === model.item.id);
        if (placement === undefined) throw new RangeError('陈列布局缺少展品');
        model.slot = placement.slot;
        // Slot edits snap to a stable resting point, so a swapped item never crosses a divider.
        if (controller.getSnapshot().phase === 'overview') model.group.position.set(...slotRestPosition(model.slot));
      }
      for (let slot = 0; slot < 6; slot++) {
        const placement = arrangement.find((entry) => entry.slot === slot);
        const model = displayModels.find((entry) => entry.slot === slot);
        const plaque = scene.getObjectByName(`cabinet-plaque-group:${slot}`);
        const marker = scene.getObjectByName(`empty-slot-marker:${slot}`);
        const shadow = scene.getObjectByName(`cabinet-contact-shadow:${slot}`);
        const ticketShadow = scene.getObjectByName(`cabinet-ticket-shadow:${slot}`);
        if (plaque !== undefined) plaque.visible = placement !== undefined;
        if (marker !== undefined) marker.visible = placement === undefined;
        if (shadow !== undefined) { shadow.visible = placement !== undefined; shadow.scale.x = model?.item.modelKey === 'camera-01' ? 1 : .68; }
        if (ticketShadow !== undefined) ticketShadow.visible = model?.item.modelKey === 'ticket';
        if (placement !== undefined) updateBrassPlaqueText(scene, slot, placement.plaqueText);
      }
      invalidate();
    },
    retry: initializeRenderer,
    retryModel(id: string) { const model = displayModels.find((entry) => entry.item.id === id); if (model === undefined) throw new RangeError('未知展品'); void loadModel(model); },
    resetView,
    destroy() {
      destroyed = true; cancelDrag(); resourceAbort.abort(); unsubscribe(); observer.disconnect(); if (frame !== 0) cancelAnimationFrame(frame); frame = 0;
      for (const model of displayModels) model.request?.abort();
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      if (restoreDeadline !== null) { window.clearTimeout(restoreDeadline); restoreDeadline = null; }
      canvas.removeEventListener('webglcontextlost', onContextLost); canvas.removeEventListener('webglcontextrestored', onContextRestored);
      canvas.removeEventListener('pointerdown', events.pointerdown); canvas.removeEventListener('pointermove', events.pointermove); canvas.removeEventListener('pointerup', events.pointerup); canvas.removeEventListener('pointercancel', events.pointercancel); canvas.removeEventListener('keydown', events.keydown);
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('dblclick', onDoubleClick); canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('lostpointercapture', onPointerCancel);
      window.removeEventListener('pointermove', onOverviewPointerMove); window.removeEventListener('blur', onViewportLeave); document.removeEventListener('mouseleave', onViewportLeave);
      reducedMotion.removeEventListener('change', onMotionPreferenceChange); canvas.style.cursor = originalCursor;
      for (const surface of hoverSurfaces) if (surface.plaque !== null) surface.plaque.envMap = null;
      disposeResources(scene, ownedTextures); environmentTarget?.dispose(); glassEnvironmentTarget?.dispose(); renderer?.dispose();
      // Three owns additional transmission targets; only context loss releases the whole owner.
      // 恢复句柄在丢失后才最需要，先存进按画布的映射，再丢上下文。
      if (renderer !== null) {
        // lost 事件不是同步派发的，卸载后原有的 onContextLost 已被移除；没有 preventDefault
        // 就等于把这张画布永久弃用，下一次挂载（StrictMode 双挂载 / HMR / 重试）只能拿到废上下文。
        canvas.addEventListener('webglcontextlost', allowRestore, { once: true });
        if (contextControl !== null) lostControls.set(canvas, contextControl);
      }
      renderer?.forceContextLoss();
    },
  };
}
