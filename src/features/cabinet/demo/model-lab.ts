import { mountCabinetStage, type AssetStatus, type StageRenderStats } from '../cabinet-stage';
import { clearWebglProbe } from '../webgl-capability';
import { modelManifest } from '../model-manifest';
import { createInspectionController } from '../../viewer/inspection-controller';
import type { GlbModelSource } from '../glb-model';

const catalog = {
  slender: new URL('./fixtures/slender.glb', import.meta.url).href,
  flat: new URL('./fixtures/flat.glb', import.meta.url).href,
  textured: new URL('./fixtures/textured.glb', import.meta.url).href,
  empty: new URL('./fixtures/empty.glb', import.meta.url).href,
  'triangle-budget': new URL('./fixtures/triangle-budget.glb', import.meta.url).href,
  'texture-budget': new URL('./fixtures/texture-budget.glb', import.meta.url).href,
  cassette: modelManifest.cassette.path, camera: modelManifest['camera-01'].path, ticket: modelManifest.ticket.path,
};
type Key = keyof typeof catalog;
function element(id: string) { const value = document.getElementById(id); if (!value) throw new Error(`Missing lab element: ${id}`); return value; }
const area = element('area'); const status = element('status'); const report = element('report');
const id = 'lab-model'; let revision = 0;
let stage: ReturnType<typeof mountCabinetStage> | null = null;
let controller = createInspectionController([id]);
let canvas: HTMLCanvasElement;
let currentStatus: AssetStatus = 'loading'; let woodStatus: AssetStatus = 'loading';
let currentTriangles = 0; let lastError = ''; let stats: StageRenderStats | null = null;
let notifications = 0;
const records: Record<string, unknown>[] = [];
const closed = new AbortController();

// Instrument only this independent lab, never the product preview or other tabs.
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
const listeners = new Map<EventTarget, Map<string, Set<EventListenerOrEventListenerObject>>>();
function tracked(target: EventTarget) { return target === window || target === document || target instanceof HTMLCanvasElement || target instanceof MediaQueryList; }
function listenerKey(type: string, options?: boolean | AddEventListenerOptions) { return `${type}:${typeof options === 'boolean' ? options : options?.capture === true}`; }
EventTarget.prototype.addEventListener = function (type, listener, options) {
  if (listener && tracked(this)) {
    let entries = listeners.get(this); if (!entries) { entries = new Map(); listeners.set(this, entries); }
    const key = listenerKey(type, options); let callbacks = entries.get(key); if (!callbacks) { callbacks = new Set(); entries.set(key, callbacks); } callbacks.add(listener);
  }
  addListener.call(this, type, listener, options);
};
EventTarget.prototype.removeEventListener = function (type, listener, options) {
  const entries = listeners.get(this); const key = listenerKey(type, options);
  if (listener && entries) { entries.get(key)?.delete(listener); if (entries.get(key)?.size === 0) entries.delete(key); if (entries.size === 0) listeners.delete(this); }
  removeListener.call(this, type, listener, options);
};
const NativeResizeObserver = window.ResizeObserver;
const observers = new Set<ResizeObserver>();
window.ResizeObserver = class extends NativeResizeObserver {
  override observe(target: Element, options?: ResizeObserverOptions) { observers.add(this); super.observe(target, options); }
  override disconnect() { observers.delete(this); super.disconnect(); }
};
function listenerCount() { let count = 0; for (const entries of listeners.values()) for (const callbacks of entries.values()) count += callbacks.size; return count; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => boolean, message: string) {
  const deadline = performance.now() + 12_000;
  while (!check()) { closed.signal.throwIfAborted(); if (performance.now() > deadline) throw new Error(`等待超时：${message}`); await new Promise((resolve) => setTimeout(resolve, 25)); }
}
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function source(key: Key, slow = false): GlbModelSource { const url = new URL(catalog[key], document.baseURI); if (slow) url.searchParams.set('qaSlow', '1'); return { assetId: `qa-${key}`, version: String(++revision), url: url.href }; }
// 模拟无 GPU 预览机的真实形态：getContext 返回句柄，但 getContextAttributes() 为 null。
// 直接返回 null 会被预检的 no-context 分支挡下，掩盖 attributes 缺失这条更常见的路径。
function blockWebglContexts() {
  clearWebglProbe();
  const dead = { isContextLost: () => false, getContextAttributes: () => null, getExtension: () => null };
  const native = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, writable: true, value: () => dead });
  return () => {
    if (native === undefined) delete (HTMLCanvasElement.prototype as { getContext?: unknown }).getContext;
    else Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', native);
  };
}
function mount(key: Key = 'textured', blockWebgl = false) {
  assert(stage === null, '旧查看器尚未卸载');
  currentStatus = 'loading'; woodStatus = 'loading'; stats = null; lastError = '';
  canvas = document.createElement('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', '检查台三维画布'); area.replaceChildren(canvas);
  const restore = blockWebgl ? blockWebglContexts() : null;
  controller = createInspectionController([id]);
  stage = mountCabinetStage(canvas, [{ id, slot: 1, plaqueText: 'QA 测试资产', modelKey: 'glb', source: source(key) }], controller, {
    inspectionInset: () => 0,
    onSurfaceStatus(value) { canvas.style.visibility = value === 'ready' ? 'visible' : 'hidden'; },
    onAssetStatus(assetId, value) { if (assetId === id) { currentStatus = value; notifications++; } else if (assetId === 'cabinet-material') woodStatus = value; },
    onAssetError(_id, message) { lastError = message; },
    onModelStats(_id, value) { currentTriangles = value.triangles; },
    onRenderStats(value) { stats = value; },
  });
  return () => { restore?.(); };
}
async function settled() { await until(() => currentStatus === 'ready' && woodStatus === 'ready' && stage?.getDiagnostics().pendingFrame === false, '模型与渲染静止'); }async function replace(key: Key) { assert(stage, '没有查看器'); stage.setModelSource(id, source(key)); await until(() => currentStatus !== 'loading', `加载 ${key}`); }
function sample() { assert(stage && stats, '没有可用渲染记录'); return { ...stage.getDiagnostics(), cpuMs: stats.cpuMs, calls: stats.calls, renderer: stats.renderer }; }
function record(name: string, result: Record<string, unknown>) { records.push({ name, ...result }); report.textContent = JSON.stringify(records, null, 2); }
function destroy() { assert(stage, '没有查看器'); const previous = stage; stage.destroy(); stage = null; return previous; }

async function fixtures() {
  for (const key of ['slender', 'flat', 'textured', 'empty', 'triangle-budget', 'texture-budget'] as const) {
    await replace(key);
    const expected = key === 'empty' || key.endsWith('budget') ? 'failed' : 'ready';
    assert(currentStatus === expected, `${key} 应为 ${expected}，实际 ${currentStatus}`);
    record(`边界模型 ${key}`, { passed: true, status: currentStatus, triangles: currentStatus === 'ready' ? currentTriangles : null, error: currentStatus === 'failed' ? lastError : null });
  }
  await replace('textured'); await settled();
}

async function delayed(unmount: boolean) {
  assert(stage, '没有查看器'); const current = stage;
  const nativeFetch = window.fetch;
  const held = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>(); const finished = Promise.withResolvers<void>();
  let delayTimeout: number | null = null;
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url, document.baseURI).searchParams.has('qaSlow')) { held.resolve(); await release.promise; finished.resolve(); }
    return response;
  };
  try {
    current.setModelSource(id, source('slender', true));
    await Promise.race([held.promise, new Promise<never>((_resolve, reject) => { delayTimeout = window.setTimeout(() => reject(new Error('旧请求没有进入延迟点')), 8000); })]);
    if (unmount) destroy(); else { await replace('cassette'); await settled(); assert(currentTriangles > 12, '新模型尚未采纳'); }
    const before = notifications;
    release.resolve(); await finished.promise; await nextFrame();
    assert(notifications === before, '旧响应迟到后发出了状态更新');
    if (!unmount) assert(currentTriangles > 12 && currentStatus === 'ready', '旧模型覆盖了新模型');
    record(unmount ? '加载中退出' : '延迟旧响应', { passed: true, notificationsAfterRelease: notifications - before, diagnostics: current.getDiagnostics() });
  } finally { if (delayTimeout !== null) clearTimeout(delayTimeout); release.resolve(); window.fetch = nativeFetch; }
  if (unmount) { mount(); await settled(); }
}

async function switches() {
  assert(stage, '没有查看器'); controller.returnToOverview();
  await until(() => controller.getSnapshot().phase === 'overview', '放回展柜');
  const baseline = new Map<Key, { geometries: number; textures: number; programs: number }>();
  const results: Record<string, unknown>[] = [];
  for (let cycle = 0; cycle < 30; cycle++) {
    const key = (['cassette', 'camera', 'ticket'] as const)[cycle % 3]; assert(key, '缺少压力测试样例');
    status.textContent = `连续切换 ${cycle + 1} / 30`;
    const started = performance.now(); await replace(key); await settled(); const value = sample();
    const old = baseline.get(key);
    if (old && cycle >= 6) assert(value.geometries === old.geometries && value.textures === old.textures && value.programs === old.programs, `切换 ${key} 后 GPU 资源数量持续变化`);
    baseline.set(key, value); results.push({ key, loadMs: Math.round(performance.now() - started), ...value });
  }
  record('连续切换 30 次', { passed: true, samples: results });
}

async function mounts() {
  if (stage) destroy(); await nextFrame();
  const baselineListeners = listenerCount(); const baselineObservers = observers.size;
  const results: Record<string, unknown>[] = [];
  for (let cycle = 0; cycle < 24; cycle++) {
    status.textContent = `挂载卸载 ${cycle + 1} / 24`; mount(); await settled(); const before = sample(); const previous = destroy(); await nextFrame();
    const after = previous.getDiagnostics();
    assert(!after.pendingFrame && after.pendingRequests === 0, '卸载后仍有查看器请求或帧');
    assert(listenerCount() === baselineListeners && observers.size === baselineObservers, '卸载后监听器或观察器没有恢复基线');
    // renderer.info retains internal transmission texture counts after dispose.
    // Verify the native context is actually lost instead of falsifying those counters.
    assert(after.geometries === 0 && after.programs === 0 && after.contextLost, `卸载后 GPU 所有者没有释放：${JSON.stringify(after)}`);
    results.push({ before, after, listeners: listenerCount(), observers: observers.size });
  }
  record('挂载卸载 24 次', { passed: true, baselineListeners, baselineObservers, samples: results }); mount(); await settled();
}

async function initialWebgl() {
  if (stage) destroy(); await nextFrame();
  const allow = mount('textured', true); assert(stage, '初始化失败测试没有查看器');
  await until(() => currentStatus === 'ready' && woodStatus === 'ready', '失败界面保留模型资料');
  assert(stage.getDiagnostics().surface === 'unavailable', '未模拟首次 WebGL 失败');
  const listenersBefore = listenerCount();
  for (let i = 0; i < 3; i++) stage.retry();
  assert(listenerCount() === listenersBefore, '初始化失败重试增加了监听器');
  allow(); stage.retry(); await settled();
  assert(stage.getDiagnostics().surface === 'ready', '首次失败后没有恢复');
  record('首次 WebGL 失败与三次重试', { passed: true, listenersBefore, listenersAfterRecovery: listenerCount(), diagnostics: stage.getDiagnostics() });
}

async function touch() {
  assert(stage, '没有查看器'); controller.select(id); await until(() => controller.getSnapshot().phase === 'inspecting', '进入检视');
  const current = stage; current.resetView(); const before = current.getDiagnostics();
  const nativeSet = canvas.setPointerCapture; const nativeRelease = canvas.releasePointerCapture; const nativeHas = canvas.hasPointerCapture;
  const captures = new Set<number>();
  canvas.setPointerCapture = (id) => { captures.add(id); }; canvas.releasePointerCapture = (id) => { captures.delete(id); }; canvas.hasPointerCapture = (id) => captures.has(id);
  const rect = canvas.getBoundingClientRect(); const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
  const send = (type: string, pointerId: number, x: number) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0, clientX: x, clientY: y }));
  try {
    send('pointerdown', 1, x - 50); send('pointerdown', 2, x + 50); send('pointermove', 2, x + 100); send('pointerup', 2, x + 100); send('pointerup', 1, x - 50);
    const after = current.getDiagnostics();
    assert(after.zoom > before.zoom && after.yaw === before.yaw && after.pitch === before.pitch, '双指缩放没有正确隔离旋转');
    assert(controller.getSnapshot().phase === 'inspecting' && captures.size === 0, '多指结束误选或没有释放指针');
    record('合成双指缩放', { passed: true, before, after, note: '合成 PointerEvent，不代替手机实机验收' });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true }));
    const adjusted = current.getDiagnostics();
    assert(adjusted.yaw > after.yaw && adjusted.zoom < after.zoom, '方向键或滚轮缩放失效');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
    assert(current.getDiagnostics().zoom > adjusted.zoom, '加号键没有放大');
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const reset = current.getDiagnostics();
    assert(reset.zoom === 1 && reset.yaw === 0 && reset.pitch === 0, '双击没有恢复初始检视角度与缩放');
    record('方向键、滚轮、键盘缩放与双击复位', { passed: true, adjusted, reset });
    send('pointerdown', 3, x); destroy();
    assert(captures.size === 0 && !current.getDiagnostics().pendingFrame, '拖动中卸载没有释放指针或动画');
    record('拖动中卸载', { passed: true, diagnostics: current.getDiagnostics() });
  } finally { canvas.setPointerCapture = nativeSet; canvas.releasePointerCapture = nativeRelease; canvas.hasPointerCapture = nativeHas; }
  mount(); await settled();
}

const actions = { fixtures, delay: () => delayed(false), unmount: () => delayed(true), switches, mounts, touch, initial: initialWebgl,
  all: async () => { await fixtures(); await delayed(false); await delayed(true); await switches(); await mounts(); await touch(); await initialWebgl(); } };
for (const [name, action] of Object.entries(actions)) element(name).addEventListener('click', () => {
  const buttons = document.querySelectorAll('button'); buttons.forEach((button) => { button.disabled = true; }); status.textContent = '检查中…';
  void action().then(() => { status.textContent = '检查通过，详细记录见下方'; }).catch((error: unknown) => {
    status.textContent = `检查失败：${error instanceof Error ? error.message : String(error)}`;
    record(name, { passed: false, error: error instanceof Error ? error.message : String(error) });
  }).finally(() => { buttons.forEach((button) => { button.disabled = false; }); });
});
window.addEventListener('pagehide', () => { closed.abort(); if (stage) destroy(); EventTarget.prototype.addEventListener = addListener; EventTarget.prototype.removeEventListener = removeListener; window.ResizeObserver = NativeResizeObserver; });
mount(); void settled().then(() => { status.textContent = '检查台就绪'; }).catch((error: unknown) => { status.textContent = `检查台初始化失败：${String(error)}`; });
