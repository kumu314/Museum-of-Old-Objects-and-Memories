export {};

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing QA element: ${id}`);
  return value;
}

function input(id: string): HTMLInputElement {
  const value = element(id);
  if (!(value instanceof HTMLInputElement)) throw new TypeError(`Expected input: ${id}`);
  return value;
}

function preview(): HTMLIFrameElement {
  const value = element('preview');
  if (!(value instanceof HTMLIFrameElement)) throw new TypeError('Expected preview iframe');
  return value;
}

const frame = preview();
const area = element('preview-area');
const viewport = element('viewport');
const result = element('result');
const frameStatus = element('frame-status');
const measurement = element('frame-measurement');
const normalizedX = input('normalized-x');
const normalizedY = input('normalized-y');
const measureButton = element('measure');
if (!(measureButton instanceof HTMLButtonElement)) throw new TypeError('Expected measurement button');
const measurementButton = measureButton;
let width = 1600;
let height = 900;
let mode: 'normal' | 'reduced' = 'normal';
let documentObserved: Document | null = null;
let counters = { scheduled: 0, executed: 0 };
let contextControl: WEBGL_lose_context | null = null;
let measurementTimer: number | null = null;
let modeRevision = 0;
let htmlRequest: AbortController | null = null;
let canvasWait: number | null = null;
let canvasWaitAttempts = 0;

const capture = new URLSearchParams(location.search).has('capture');
const previewPath = new URLSearchParams(location.search).get('preview') === 'model' ? '/model-preview.html' : '/';
const blockInitialWebgl = new URLSearchParams(location.search).get('webgl') === 'blocked';
element('allow-webgl').toggleAttribute('disabled', !blockInitialWebgl);
if (previewPath !== '/') frame.src = previewPath;
if (capture) {
  document.body.classList.add('capture');
  frame.src = previewPath === '/' ? '/?metrics=1' : previewPath;
}
function resize(): void {
  const scale = capture ? 0.75 : Math.min(1, area.clientWidth / width, area.clientHeight / height);
  frame.width = String(width);
  frame.height = String(height);
  frame.style.transform = `scale(${scale})`;
  viewport.style.width = `${width * scale}px`;
  viewport.style.height = `${height * scale}px`;
}

function setViewport(nextWidth: number, nextHeight: number): void {
  width = nextWidth;
  height = nextHeight;
  element('desktop').setAttribute('aria-pressed', String(width === 1600));
  element('mobile').setAttribute('aria-pressed', String(width === 390));
  resize();
  result.textContent = `已设置 iframe：${width}×${height}`;
}

function canvas(): HTMLCanvasElement | null {
  return frame.contentDocument?.querySelector('canvas') ?? null;
}

function describeFrame(): void {
  const frameWindow = frame.contentWindow;
  const surface = canvas();
  if (frameWindow === null || surface === null) {
    frameStatus.textContent = '预览尚未就绪：未找到画布';
    return;
  }
  const matches = frameWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cursor = frameWindow.getComputedStyle(surface).cursor;
  frameStatus.textContent = `${mode === 'reduced' ? '减少动态模拟' : '普通模式'}：reduce.matches=${matches}；cursor=${cursor}；RAF 累计 调度 ${counters.scheduled} / 执行 ${counters.executed}`;
}

function cancelMeasurement(): void {
  if (measurementTimer !== null) window.clearTimeout(measurementTimer);
  measurementTimer = null;
  measurementButton.disabled = false;
}

function onFrameLoad(): void {
  if (canvasWait !== null) window.clearTimeout(canvasWait);
  canvasWait = null;
  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  const surface = canvas();
  if (frameWindow === null || frameDocument === null || surface === null) {
    // React can mount after iframe load; bound this QA-only wait to five seconds.
    if (canvasWaitAttempts++ < 100) canvasWait = window.setTimeout(onFrameLoad, 50);
    describeFrame();
    return;
  }
  canvasWaitAttempts = 0;
  if (frameDocument === documentObserved) return;
  documentObserved = frameDocument;
  cancelMeasurement();
  measurement.textContent = '预览已重载，请重新测量静止帧';
  contextControl = null;
  counters = { scheduled: 0, executed: 0 };
  const currentCounters = counters;
  const nativeRequest = frameWindow.requestAnimationFrame.bind(frameWindow);
  frameWindow.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    currentCounters.scheduled += 1;
    return nativeRequest((time) => {
      currentCounters.executed += 1;
      callback.call(frameWindow, time);
    });
  };
  surface.addEventListener('webglcontextlost', () => {
    result.textContent = '已收到 iframe 的 WebGL 中断事件';
    describeFrame();
  });
  surface.addEventListener('webglcontextrestored', () => {
    result.textContent = '已收到 iframe 的 WebGL 恢复事件';
    queueMicrotask(describeFrame);
  });
  describeFrame();
}

const reducedMotionFixture = `(() => {
  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    const native = nativeMatchMedia(query);
    if (query.replace(/\\s/g, '') !== '(prefers-reduced-motion:reduce)') return native;
    return new Proxy(native, {
      get(target, property) {
        if (property === 'matches') return true;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, property, value) { return Reflect.set(target, property, value, target); }
    });
  };
})();`;

const blockedWebglFixture = `(() => {
  const native = HTMLCanvasElement.prototype.getContext;
  let enabled = false;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    return !enabled && String(type).startsWith('webgl') ? null : Reflect.apply(native, this, [type, ...args]);
  };
  window.addEventListener('qa-enable-webgl', () => { enabled = true; });
})();`;

async function setMotionMode(nextMode: 'normal' | 'reduced'): Promise<void> {
  const revision = ++modeRevision;
  htmlRequest?.abort();
  htmlRequest = null;
  cancelMeasurement();
  measurement.textContent = '正在切换预览模式';
  mode = nextMode;
  element('motion-normal').setAttribute('aria-pressed', String(mode === 'normal'));
  element('motion-reduced').setAttribute('aria-pressed', String(mode === 'reduced'));
  if (mode === 'normal' && !blockInitialWebgl) {
    frame.src = previewPath;
    frame.removeAttribute('srcdoc');
    result.textContent = '正在重载普通模式；保留系统原生动态偏好';
    return;
  }

  const request = new AbortController();
  htmlRequest = request;
  try {
    const response = await fetch(previewPath, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw new Error(`预览 HTML 请求失败：${response.status}`);
    const document = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (revision !== modeRevision) return;
    const fixture = document.createElement('script');
    fixture.textContent = (mode === 'reduced' ? reducedMotionFixture : '') + (blockInitialWebgl ? blockedWebglFixture : '');
    // Faults are confined to this QA iframe and run before product modules.
    document.head.prepend(fixture);
    frame.srcdoc = `<!doctype html>\n${document.documentElement.outerHTML}`;
    result.textContent = blockInitialWebgl ? '首次 WebGL 初始化失败 fixture 已启用，仅影响当前 iframe' : '正在载入 iframe 的减少动态测试 fixture';
  } catch (error: unknown) {
    if (revision === modeRevision) {
      result.textContent = `模式切换失败：${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    if (htmlRequest === request) htmlRequest = null;
  }
}

function movePointer(x: number, y: number): void {
  const surface = canvas();
  if (surface === null) {
    result.textContent = '预览尚未就绪，无法发送悬停事件';
    return;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    result.textContent = 'X/Y 必须是 0 到 1 之间的数字';
    return;
  }
  const rect = surface.getBoundingClientRect();
  surface.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: rect.left + rect.width * x,
    clientY: rect.top + rect.height * y,
  }));
  result.textContent = `已发送合成 pointermove：X=${x.toFixed(2)}，Y=${y.toFixed(2)}`;
  describeFrame();
}

function measureFrames(): void {
  if (canvas() === null || documentObserved !== frame.contentDocument) {
    result.textContent = '预览尚未就绪，无法测量';
    return;
  }
  cancelMeasurement();
  const currentCounters = counters;
  const scheduled = currentCounters.scheduled;
  const executed = currentCounters.executed;
  measurementButton.disabled = true;
  measurement.textContent = '测量中：请保持预览静止 1 秒';
  measurementTimer = window.setTimeout(() => {
    measurementTimer = null;
    measurementButton.disabled = false;
    measurement.textContent = `最近 1 秒：新调度 ${currentCounters.scheduled - scheduled} 次 / 执行 ${currentCounters.executed - executed} 次`;
    describeFrame();
  }, 1000);
}

element('desktop').addEventListener('click', () => setViewport(1600, 900));
element('mobile').addEventListener('click', () => setViewport(390, 844));
element('motion-normal').addEventListener('click', () => { void setMotionMode('normal'); });
element('motion-reduced').addEventListener('click', () => { void setMotionMode('reduced'); });
element('hover-camera').addEventListener('click', () => movePointer(normalizedX.valueAsNumber, normalizedY.valueAsNumber));
element('leave-cell').addEventListener('click', () => movePointer(0.02, 0.94));
measurementButton.addEventListener('click', measureFrames);
element('lose').addEventListener('click', () => {
  const context = canvas()?.getContext('webgl2');
  contextControl = context?.getExtension('WEBGL_lose_context') ?? null;
  if (contextControl === null) {
    result.textContent = '当前画布不支持 WEBGL_lose_context，无法模拟中断';
    return;
  }
  contextControl.loseContext();
  result.textContent = '已请求中断 iframe 的 WebGL';
});
element('restore').addEventListener('click', () => {
  if (contextControl === null) {
    result.textContent = '请先通过“中断 WebGL”保存恢复句柄';
    return;
  }
  contextControl.restoreContext();
  result.textContent = '已请求恢复 iframe 的 WebGL';
});
element('allow-webgl').addEventListener('click', () => {
  frame.contentWindow?.dispatchEvent(new Event('qa-enable-webgl'));
  result.textContent = '已允许该 iframe 创建 WebGL，请点击预览中的“重试三维展示”';
});
frame.addEventListener('load', () => { canvasWaitAttempts = 0; onFrameLoad(); });
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(area);
window.addEventListener('resize', resize);
window.addEventListener('pagehide', () => {
  cancelMeasurement();
  if (canvasWait !== null) window.clearTimeout(canvasWait);
  htmlRequest?.abort();
  resizeObserver.disconnect();
}, { once: true });
resize();
if (frame.contentDocument?.readyState === 'complete') onFrameLoad();
if (blockInitialWebgl) void setMotionMode('normal');
