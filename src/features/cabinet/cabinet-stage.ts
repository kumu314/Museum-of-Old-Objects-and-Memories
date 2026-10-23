import {
  ACESFilmicToneMapping, AmbientLight, Box3, BufferGeometry, Color, DirectionalLight,
  Group, Line, LineBasicMaterial, Material, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, PlaneGeometry,
  SpotLight, Quaternion, Raycaster, RepeatWrapping, Scene,
  SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, MeshPhysicalMaterial, MeshStandardMaterial,
  type Object3D, type WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createInspectionController } from '../viewer/inspection-controller.ts';
import { buildCabinetBody } from './cabinet-body.ts';
import { CABINET_WIDTH, CELL_SIZE, MODEL_UNITS_PER_METRE, slotRestPosition } from './cabinet-layout.ts';
import { fitModelBounds } from './model-fit.ts';
import { modelManifest, type CabinetModelKey } from './model-manifest.ts';
import { refineCameraMaterials } from './camera-materials.ts';
import { createWarmEnvironment, createGlassEnvironment } from './warm-environment.ts';
import { createGallerySurroundings } from './gallery-surroundings.ts';
import { overviewOffset } from './overview-motion.ts';
import { updateBrassPlaqueText } from './brass-plaque.ts';
import type { CabinetArrangement } from './cabinet-arrangement.ts';

// Rendering inputs only. The public snapshot remains owned by C's shared schema.
export interface CabinetStageItem { readonly id: string; readonly slot: number; readonly modelKey: CabinetModelKey }
export type SurfaceStatus = 'ready' | 'unavailable' | 'context-lost';
export type AssetStatus = 'loading' | 'ready' | 'failed';
type Controller = ReturnType<typeof createInspectionController>;
export interface StageRenderStats { readonly cpuMs: number; readonly calls: number; readonly triangles: number; readonly textures: number; readonly geometries: number; readonly timestamp: number; readonly renderer: string }
interface StageOptions {
  readonly onSlotDrop?: (id: string, targetSlot: number) => void;
  readonly onRenderStats?: (stats: StageRenderStats) => void;
  readonly onSurfaceStatus: (status: SurfaceStatus) => void;
  readonly inspectionInset: () => number;
  readonly onAssetStatus: (id: string, status: AssetStatus) => void;
}
interface DisplayModel { readonly item: CabinetStageItem; readonly group: Group; slot: number; status: AssetStatus | 'idle' }

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
    const model = modelManifest[item.modelKey];
    return [item.slot, `${model.displayName} · ${model.eraLabel}`];
  }))));
  scene.add(createGallerySurroundings());
  // Fade a restrained reflection into the transparent canvas, with no floor horizon.
  const reflection = new Reflector(new PlaneGeometry(18, 12), {
    color: '#e2cdb5', textureWidth: 512, textureHeight: 512, clipBias: 0.003,
    shader: {
      uniforms: { color: { value: new Color() }, tDiffuse: { value: null }, textureMatrix: { value: new Matrix4() } },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 reflectionUv; varying vec2 groundPosition; varying vec4 reflectionClip;
        void main() { reflectionUv = textureMatrix * vec4(position, 1.0); groundPosition = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          reflectionClip = gl_Position; }`,
      fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 reflectionUv; varying vec2 groundPosition; varying vec4 reflectionClip;
        void main() { vec2 uv = reflectionUv.xy / reflectionUv.w;
          vec3 reflected = vec3(0.0);
          for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
            reflected += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * 0.004).rgb / 25.0;
          }
          float fade = (1.0 - smoothstep(4.5, 8.5, abs(groundPosition.x))) * (1.0 - smoothstep(0.6, 6.0, abs(groundPosition.y)));
          gl_FragColor = vec4(reflected * color, fade * 0.38 * smoothstep(0.0, 0.035, reflectionClip.y / reflectionClip.w * 0.5 + 0.5));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  });
  for (const material of Array.isArray(reflection.material) ? reflection.material : [reflection.material]) {
    material.transparent = true;
    material.depthWrite = false;
  }
  reflection.rotation.x = -Math.PI / 2;
  reflection.position.y = -3.212;
  // Reflector's nested render must not overwrite the main camera's transmission buffer.
  const reflectScene = reflection.onBeforeRender;
  const glazing = Array.from({ length: 6 }, (_, slot) => scene.getObjectByName(`cabinet-front-glass:${slot}`));
  reflection.onBeforeRender = (...args) => {
    for (const pane of glazing) if (pane !== undefined) pane.visible = false;
    try { reflectScene.apply(reflection, args); }
    finally { for (const pane of glazing) if (pane !== undefined) pane.visible = true; }
  };
  scene.add(reflection);
  const backdropShade = new Mesh(new PlaneGeometry(40, 24), new MeshBasicMaterial({ color: '#080604', transparent: true, opacity: 0, depthWrite: false }));
  backdropShade.position.z = 2;
  backdropShade.visible = false;
  scene.add(backdropShade);
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
    return { item, group, slot: item.slot, status: 'idle' };
  });
  const dropIndicator = new Line(new BufferGeometry().setFromPoints([
    new Vector3(-1.61, .03, 0), new Vector3(1.61, .03, 0), new Vector3(1.61, 2.2, 0),
    new Vector3(-1.61, 2.2, 0), new Vector3(-1.61, .03, 0),
  ]), new LineBasicMaterial({ color: '#ffe0a1', transparent: true, opacity: .9, depthTest: false, toneMapped: false }));
  dropIndicator.visible = false; dropIndicator.renderOrder = 20; scene.add(dropIndicator);
  let renderer: WebGLRenderer | null = null;
  let contextControl: WEBGL_lose_context | null = null;
  let glassEnvironmentTarget: WebGLRenderTarget | null = null;
  let environmentTarget: WebGLRenderTarget | null = null;
  let surfaceStatus: SurfaceStatus = 'unavailable';
  let frame = 0;
  let restoreTimer: number | null = null;
  let lastTime = 0;
  let destroyed = false;
  let zoom = 1;
  let yaw = 0;
  let pitch = 0;
  let drag: { pointerId: number; x: number; y: number; startX: number; startY: number; selectedId: string | null } | null = null;
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
  function invalidate() { if (!destroyed && surfaceStatus === 'ready' && frame === 0) frame = requestAnimationFrame(render); }
  function render(time: number) {
    frame = 0;
    if (destroyed || renderer === null || surfaceStatus !== 'ready') return;
    const delta = lastTime === 0 ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    const alpha = reducedMotion.matches ? 1 : 1 - Math.exp(-11 * delta);
    const state = controller.getSnapshot();
    const active = state.phase === 'focusing' || state.phase === 'inspecting';
    const rect = canvas.getBoundingClientRect();
    const inset = options.inspectionInset();
    const focusGap = Math.max(4.3, CELL_SIZE[0] * 0.55 / Math.tan(camera.fov * Math.PI / 360) / Math.max((rect.width - inset) / rect.height, 0.1));
    const overviewDistance = 0.82 + Math.max(3.05 / 0.99, CABINET_WIDTH / (2 * 0.88 * Math.max(camera.aspect, 0.1))) / Math.tan(camera.fov * Math.PI / 360);
    const overviewHeight = 0.50;
    const [offsetX, offsetY] = overviewOffset(pointerOffset.x, pointerOffset.y, state.phase, reducedMotion.matches);
    cameraTarget.set(offsetX, (active ? 0.25 : overviewHeight) + offsetY, active ? 4.3 + focusGap : overviewDistance);
    camera.position.lerp(cameraTarget, alpha);
    const lookAtY = active ? -0.02 : -0.32;
    camera.lookAt(0, lookAtY, 0);
    const visibleHalfWidth = Math.tan(camera.fov * Math.PI / 360) * focusGap * camera.aspect;
    const focusX = -(inset / rect.width) * visibleHalfWidth;
    backdropShade.material.opacity += ((active ? 0.52 : 0) - backdropShade.material.opacity) * alpha;
    backdropShade.visible = backdropShade.material.opacity > 0.001;
    let moving = camera.position.distanceTo(cameraTarget) > 0.001 || Math.abs(backdropShade.material.opacity - (active ? 0.52 : 0)) > 0.001;
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
      if (focused) positionTarget.set(focusX, -0.7, 4.3);
      if (dragged && slotDrag !== null) positionTarget.copy(slotDrag.position);
      rotationTarget.copy(identityRotation);
      if (focused) {
        rotationTarget.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
        rotationTarget.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
      }
      scaleTarget.setScalar(focused ? zoom : 1);
      model.group.position.lerp(positionTarget, alpha);
      model.group.quaternion.slerp(rotationTarget, alpha);
      model.group.scale.lerp(scaleTarget, alpha);
      const unsettled = model.group.position.distanceTo(positionTarget) > 0.001 || model.group.quaternion.angleTo(rotationTarget) > 0.001 || model.group.scale.distanceTo(scaleTarget) > 0.001;
      moving = moving || unsettled;
      if (!unsettled) { model.group.position.copy(positionTarget); model.group.quaternion.copy(rotationTarget); model.group.scale.copy(scaleTarget); }
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
    else if (state.phase === 'returning' || (state.phase === 'focusing' && displayModels.some((model) => model.item.id === state.selectedId && model.status === 'ready'))) controller.finishTransition(state.transitionId);
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
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
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
    } catch (error: unknown) {
      console.warn('无法初始化三维展示', error);
      renderer?.dispose(); renderer = null;
      notifySurface('unavailable'); return;
    }
    notifySurface('ready'); resize();
  }
  function onContextLost(event: Event) {
    cancelDrag();
    event.preventDefault(); if (frame !== 0) cancelAnimationFrame(frame); frame = 0;
    if (restoreTimer !== null) window.clearTimeout(restoreTimer); restoreTimer = null;
    notifySurface('context-lost');
  }
  function onContextRestored() {
    // The next task runs after Three's native listener has rebuilt its GL internals.
    if (restoreTimer !== null) window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(() => {
      restoreTimer = null;
      if (destroyed) return;
      try {
        if (renderer !== null) contextControl = renderer.getContext().getExtension('WEBGL_lose_context');
        rebuildEnvironment(); notifySurface('ready'); lastTime = 0; resize();
      }
      catch (error: unknown) { console.warn('无法恢复三维展示', error); renderer?.dispose(); renderer = null; notifySurface('unavailable'); }
    }, 0);
  }
  async function loadModel(display: DisplayModel) {
    if (destroyed || display.status === 'loading' || display.status === 'ready') return;
    display.status = 'loading'; options.onAssetStatus(display.item.id, 'loading');
    let model: Group | null = null;
    try {
      const signal = AbortSignal.any([resourceAbort.signal, AbortSignal.timeout(15000)]);
      const definition = modelManifest[display.item.modelKey];
      const response = await fetch(definition.path, { signal });
      if (!response.ok) throw new Error(`模型请求失败：${response.status}`);
      const buffer = await response.arrayBuffer();
      signal.throwIfAborted();
      model = (await new GLTFLoader().parseAsync(buffer, '')).scene;
      if (definition.modelKey === 'camera-01') refineCameraMaterials(model);
      signal.throwIfAborted();
      if (destroyed) { disposeResources(model); return; }
      model.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(model, true);
      const fit = fitModelBounds({ min: [bounds.min.x, bounds.min.y, bounds.min.z], max: [bounds.max.x, bounds.max.y, bounds.max.z] }, CELL_SIZE, 0.9, MODEL_UNITS_PER_METRE);
      model.scale.setScalar(fit.scale);
      model.position.set(...fit.offset);
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
      display.group.add(model); model = null;
      display.status = 'ready'; options.onAssetStatus(display.item.id, 'ready'); invalidate();
    } catch (error: unknown) {
      if (model !== null) disposeResources(model);
      if (!destroyed) { console.warn('展品模型载入失败', display.item.id, error); display.status = 'failed'; options.onAssetStatus(display.item.id, 'failed'); invalidate(); }
    }
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
    if (controller.getSnapshot().phase === 'overview') {
      const slot = slotAtPointer(event);
      const model = displayModels.find((entry) => entry.slot === slot);
      if (model !== undefined) { controller.select(model.item.id); return; }
    }
    pointRay(event);
    const hit = raycaster.intersectObjects(displayModels.map((model) => model.group), true)[0];
    if (hit === undefined) return;
    for (const model of displayModels) { let node = hit.object; while (node.parent !== null && node !== model.group) node = node.parent; if (node === model.group) { controller.select(model.item.id); return; } }
  }
  function cancelDrag() {
    const inspectionDrag = drag; drag = null;
    if (inspectionDrag !== null && canvas.hasPointerCapture(inspectionDrag.pointerId)) canvas.releasePointerCapture(inspectionDrag.pointerId);
    const previous = slotDrag; slotDrag = null; dropIndicator.visible = false;
    if (previous !== null && canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    setHoveredSlot(null); invalidate();
  }
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || slotDrag !== null || drag !== null) return;
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
    canvas.setPointerCapture(event.pointerId); drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, selectedId: controller.getSnapshot().selectedId };
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
    if (drag === null) {
      if (event.pointerType === 'mouse' && state.phase === 'overview') {
        const slot = slotAtPointer(event);
        setHoveredSlot(displayModels.some((entry) => entry.slot === slot) ? slot : null);
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    if (state.phase === 'inspecting' && state.selectedId === drag.selectedId) { yaw += (event.clientX - drag.x) * 0.009; pitch = Math.max(-0.65, Math.min(0.65, pitch + (event.clientY - drag.y) * 0.007)); invalidate(); }
    drag.x = event.clientX; drag.y = event.clientY;
  }
  function onPointerUp(event: PointerEvent) {
    if (slotDrag !== null && slotDrag.pointerId === event.pointerId) {
      const dropped = slotDrag; const target = slotAtPointer(event); cancelDrag();
      if (dropped.moved && target !== null) options.onSlotDrop?.(dropped.modelId, target);
      return;
    }
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const click = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5;
    drag = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (click && !editing) pick(event);
  }
  function onPointerCancel(event: PointerEvent) {
    if (drag?.pointerId === event.pointerId || slotDrag?.pointerId === event.pointerId) cancelDrag();
  }
  function onWheel(event: WheelEvent) { if (controller.getSnapshot().phase !== 'inspecting') return; event.preventDefault(); zoom = Math.max(0.75, Math.min(1.45, zoom * Math.exp(-event.deltaY * 0.001))); invalidate(); }
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
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('lostpointercapture', onPointerCancel);
  window.addEventListener('pointermove', onOverviewPointerMove); window.addEventListener('blur', onViewportLeave); document.addEventListener('mouseleave', onViewportLeave);
  reducedMotion.addEventListener('change', onMotionPreferenceChange);
  camera.position.set(0, 0.4, 16); initializeRenderer();
  for (const display of displayModels) void loadModel(display);
  void loadWoodMaterial();
  return {
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
    resetView() { yaw = 0; pitch = 0; zoom = 1; invalidate(); },
    destroy() {
      destroyed = true; resourceAbort.abort(); unsubscribe(); observer.disconnect(); if (frame !== 0) cancelAnimationFrame(frame);
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      canvas.removeEventListener('webglcontextlost', onContextLost); canvas.removeEventListener('webglcontextrestored', onContextRestored);
      canvas.removeEventListener('pointerdown', events.pointerdown); canvas.removeEventListener('pointermove', events.pointermove); canvas.removeEventListener('pointerup', events.pointerup); canvas.removeEventListener('pointercancel', events.pointercancel); canvas.removeEventListener('keydown', events.keydown);
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('lostpointercapture', onPointerCancel);
      window.removeEventListener('pointermove', onOverviewPointerMove); window.removeEventListener('blur', onViewportLeave); document.removeEventListener('mouseleave', onViewportLeave);
      reducedMotion.removeEventListener('change', onMotionPreferenceChange); canvas.style.cursor = originalCursor;
      for (const surface of hoverSurfaces) if (surface.plaque !== null) surface.plaque.envMap = null;
      disposeResources(scene, ownedTextures); reflection.dispose(); environmentTarget?.dispose(); glassEnvironmentTarget?.dispose(); renderer?.dispose();
    },
  };
}
function disposeResources(root: Object3D, additionalTextures: ReadonlySet<Texture> = new Set()) {
  const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>(); const textures = new Set(additionalTextures);
  root.traverse((node) => {
    if (!(node instanceof Mesh) && !(node instanceof Line)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      const values: readonly unknown[] = Object.values(material);
      for (const value of values) if (value instanceof Texture) textures.add(value);
    }
  });
  const images = new Set<ImageBitmap>();
  for (const texture of textures) { const image: unknown = texture.source.data; if (image instanceof ImageBitmap) images.add(image); texture.dispose(); }
  for (const material of materials) material.dispose(); for (const geometry of geometries) geometry.dispose(); for (const image of images) image.close();
}
