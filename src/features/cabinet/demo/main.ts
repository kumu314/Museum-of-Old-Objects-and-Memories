import { mountCabinetStage, type CabinetStageItem, type AssetStatus, type SurfaceStatus, type StageRenderStats } from '../cabinet-stage.ts';
import { createInspectionController } from '../../viewer/inspection-controller.ts';
import { MAX_PLAQUE_LENGTH, moveExhibitToSlot, setPlaqueText, validateArrangement, type CabinetArrangement } from '../cabinet-arrangement.ts';
import { sessionResponseSchema } from '../../../contracts/session';
import '../gallery-backdrop.css';
function element(id: string) { const value = document.getElementById(id); if (value === null) throw new Error(`Missing ${id}`); return value; }
const canvas = document.querySelector('canvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
const canvasElement = canvas;
const items = [{ id: 'camera', slot: 0, modelKey: 'camera-01' }, { id: 'cassette', slot: 1, modelKey: 'cassette' }, { id: 'ticket', slot: 4, modelKey: 'ticket' }] satisfies CabinetStageItem[];
const storageKey = 'shiwuguan.demo.arrangement.v1';
const defaultArrangement: CabinetArrangement = [
  { id: 'camera', slot: 0, plaqueText: '海鸥双反相机 · 约 1980 年代' },
  { id: 'cassette', slot: 1, plaqueText: '手录磁带 · 1996 年夏' },
  { id: 'ticket', slot: 4, plaqueText: '旧车票 · 2003 年冬' },
];
const exhibitSelectElement = element('arrangement-item');
const slotSelectElement = element('arrangement-slot');
const plaqueInputElement = element('arrangement-plaque');
if (!(exhibitSelectElement instanceof HTMLSelectElement) || !(slotSelectElement instanceof HTMLSelectElement) || !(plaqueInputElement instanceof HTMLInputElement)) throw new Error('Missing arrangement controls');
const exhibitSelect = exhibitSelectElement;
const slotSelect = slotSelectElement;
const plaqueInput = plaqueInputElement;
// HTML maxlength counts UTF-16 units; the shared validator counts visible Unicode code points.
plaqueInput.removeAttribute('maxlength');
element('plaque-help').textContent = `最多 ${MAX_PLAQUE_LENGTH} 个字符`;
// The public sample never reads or overwrites the maker's saved local arrangement.
let arrangement: CabinetArrangement = defaultArrangement;
let makerAuthorized = false;
let editingRequested = false;
let editingActive = false;

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function showArrangementStatus(message: string, failed = false): void {
  const status = element('arrangement-status');
  status.textContent = message;
  status.hidden = false;
  status.dataset.failed = String(failed);
}
function readArrangement(): CabinetArrangement {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === null) return defaultArrangement;
    const record: unknown = JSON.parse(saved);
    if (typeof record !== 'object' || record === null || !('version' in record) || record.version !== 1 || !('arrangement' in record)) throw new Error('陈列记录版本或格式不符');
    return validateArrangement(record.arrangement, items.map((item) => item.id));
  } catch (error) {
    showArrangementStatus(`本地陈列读取失败：${errorMessage(error)}。当前使用初始陈列，旧记录尚未覆盖。`, true);
    return defaultArrangement;
  }
}
function commitArrangement(next: CabinetArrangement, message: string): void {
  stage.setArrangement(next);
  arrangement = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, arrangement }));
    showArrangementStatus(`${message}，已保存到此浏览器。`);
  } catch (error) {
    showArrangementStatus(`${message}，但本地保存失败：${errorMessage(error)}。刷新后可能丢失本次修改。`, true);
  }
  refreshArrangementControls();
  update();
}
function refreshArrangementControls(): void {
  const selected = arrangement.find((item) => item.id === exhibitSelect.value);
  if (selected !== undefined) {
    slotSelect.value = String(selected.slot);
    plaqueInput.value = selected.plaqueText;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-item]')) {
    const item = arrangement.find((entry) => entry.id === button.dataset.item);
    const slot = button.querySelector('span');
    if (item !== undefined && slot !== null) slot.textContent = String(item.slot + 1).padStart(2, '0');
  }
}
function setArrangementPanel(open: boolean): void {
  element('arrangement-panel').hidden = !open;
  element('open-arrangement-panel').setAttribute('aria-expanded', String(open));
}
const descriptions: Record<string, {title:string;description:string;source:string}> = {
  camera: { title: '复古相机', description: '转动镜头与机身，观察玻璃、金属和皮革留下的细节。当前为 Poly Haven 的 CC0 演示资产；与参考图的双反型号不同，真实物主的相机尚未接入。', source:'CC0 · Rajil Jose Macatangay' },
  cassette: { title: '手录磁带', description: '纸签上的字迹、烟灰色外壳与卷轴，是这盘磁带留下的表情。模型依据参考图制作，可转动查看外壳、卷轴和背面；内部机械为示意。当前未绑定录音。', source:'自建三维模型 · 参考图标签重绘 · 非实物精确复原' },
  ticket: { title: '旧车票', description: '一张泛黄车票，写着北京到上海的旅程。纸张模型带有卷边、折痕和厚度，票面依据参考图重绘；未提供的背面保留空白示意，票面内容不作为真实物主记录。', source:'自建纸张模型 · 参考图票面重绘 · 背面示意' },
};
const controller = createInspectionController(items.map((item) => item.id));
const assets = new Map<string, AssetStatus>();
let surface: SurfaceStatus = 'unavailable';
const phaseLabels = { overview:'展柜总览', focusing:'正在取出', inspecting:'拖动旋转 · 双指、按钮或滚轮缩放', returning:'正在放回' };
// Metrics are opt-in on the local demo, never part of the visitor UI.
const samples: { cpuMs: number; interval: number }[] = [];
let previousSampleTime = 0;
const stage = mountCabinetStage(canvasElement, items, controller, {
  ...(new URLSearchParams(location.search).has('metrics') ? {
    onRenderStats(stats: StageRenderStats) {
      const interval = stats.timestamp - previousSampleTime;
      previousSampleTime = stats.timestamp;
      if (interval > 0 && interval < 100) samples.push({ cpuMs: stats.cpuMs, interval });
      if (samples.length > 240) samples.shift();
      const cpu = samples.map((sample) => sample.cpuMs).sort((a, b) => a - b);
      const frames = samples.map((sample) => sample.interval).sort((a, b) => a - b);
      canvasElement.dataset.renderStats = JSON.stringify({ ...stats, samples: samples.length,
        cpuMedian: cpu[Math.floor(cpu.length / 2)], cpuP95: cpu[Math.floor(cpu.length * 0.95)],
        intervalMedian: frames[Math.floor(frames.length / 2)], intervalP95: frames[Math.floor(frames.length * 0.95)] });
    },
  } : {}),
  inspectionInset() { const panel = element('story'); return panel.hidden || getComputedStyle(panel).position !== 'absolute' ? 0 : panel.getBoundingClientRect().width; },
  onAssetStatus(id, status) { assets.set(id, status); queueMicrotask(update); },
  onSurfaceStatus(status) { surface = status; canvasElement.style.visibility = status === 'ready' ? 'visible' : 'hidden'; element('surface-error').hidden = status === 'ready'; element('surface-message').textContent = status === 'context-lost' ? '图形上下文已中断。样例说明仍可查看，可尝试恢复。' : '浏览器无法创建三维画布。可重试，也可先查看样例说明。'; queueMicrotask(update); },
  onSlotDrop(id, targetSlot) {
    if (!editingActive) return;
    try {
      const next = moveExhibitToSlot(arrangement, id, targetSlot);
      exhibitSelect.value = id;
      commitArrangement(next, '格位已更新');
    } catch (error) { showArrangementStatus(errorMessage(error), true); }
  },
});
stage.setArrangement(arrangement);
refreshArrangementControls();
function update() {
  const state = controller.getSnapshot();
  const shouldEdit = editingRequested && state.phase === 'overview';
  if (editingActive !== shouldEdit) {
    editingActive = shouldEdit;
    stage.setEditing(editingActive);
    if (editingActive) canvasElement.focus();
  }
  element('exhibition').dataset.phase = state.phase;
  document.body.dataset.phase = state.phase;
  element('exhibition').dataset.editing = String(editingActive);
  element('edit-arrangement').textContent = editingRequested ? '完成编辑' : '编辑陈列';
  element('edit-arrangement').setAttribute('aria-pressed', String(editingRequested));
  element('edit-arrangement').hidden = !makerAuthorized;
  element('catalog').hidden = !makerAuthorized || editingRequested;
  element('exhibit-access').dataset.fallback = String(surface !== 'ready');
  element('open-arrangement-panel').hidden = !editingActive;
  if (!editingActive) setArrangementPanel(false);
  canvasElement.setAttribute('aria-label', editingActive ? '三维展柜编辑；拖动展品在六个格位之间换位，Esc 取消拖动；也可使用陈列工具选择格位' : '三维展柜；检视时方向键旋转，加减键缩放，Esc 放回');
  element('back').hidden = state.phase === 'overview';
  element('story').hidden = state.phase === 'overview';
  element('interaction-hint').hidden = state.phase !== 'inspecting';
  for (const id of ['zoom-in', 'zoom-out']) element(id).toggleAttribute('disabled', state.phase !== 'inspecting');
  const item = arrangement.find((item) => item.id === state.selectedId);
  const description = state.selectedId === null ? undefined : descriptions[state.selectedId];
  const status = state.selectedId === null ? undefined : assets.get(state.selectedId);
  if (item !== undefined && description !== undefined) { element('item-title').textContent = description.title; element('item-description').textContent = description.description; element('slot-label').textContent = String(item.slot + 1); element('model-note').textContent = description.source; }
  const retry = document.getElementById('retry-model');
  if (retry !== null) retry.hidden = status !== 'failed';
  element('state-label').textContent = surface !== 'ready' ? '三维暂不可用 · 可查看样例说明' : status === 'failed' ? '模型载入失败 · 可重试' : status === 'loading' ? '模型载入中' : phaseLabels[state.phase];
  element('guide').textContent = '点击展柜中的旧物，取出查看立体细节并倾听物主讲述';
  if (editingRequested) element('guide').textContent = editingActive ? '拖动展品换格 · 已有展品时交换 · Esc 取消拖动 · 更改仅保存在此浏览器' : '正在放回展品，完成后可拖动换位';
  if (assets.get('cabinet-material') === 'failed') element('guide').textContent = '木纹材质未能载入，可刷新重试。展品目录仍可操作。';
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-item]')) button.setAttribute('aria-pressed', String(button.dataset.item === state.selectedId));
}
const unsubscribe = controller.subscribe(update);
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-item]')) button.addEventListener('click', () => { if (editingRequested) return; const id = button.dataset.item; if (id !== undefined) { controller.select(id); const details=button.closest('details'); if (details !== null) details.open=false; } });
element('edit-arrangement').addEventListener('click', () => {
  if (!makerAuthorized) return;
  editingRequested = !editingRequested;
  if (editingRequested) {
    const catalog = element('catalog');
    if (catalog instanceof HTMLDetailsElement) catalog.open = false;
    refreshArrangementControls();
    controller.returnToOverview();
  } else {
    setArrangementPanel(false);
    if (element('arrangement-status').dataset.failed !== 'true') element('arrangement-status').hidden = true;
    canvasElement.focus();
  }
  update();
});
element('open-arrangement-panel').addEventListener('click', () => {
  const open = element('arrangement-panel').hidden !== false;
  setArrangementPanel(open);
  if (open) exhibitSelect.focus();
});
element('close-arrangement-panel').addEventListener('click', () => {
  setArrangementPanel(false);
  element('open-arrangement-panel').focus();
});
exhibitSelect.addEventListener('change', refreshArrangementControls);
element('arrangement-move-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!editingActive) return;
  try { commitArrangement(moveExhibitToSlot(arrangement, exhibitSelect.value, Number(slotSelect.value)), '格位已更新'); }
  catch (error) { showArrangementStatus(errorMessage(error), true); }
});
element('arrangement-plaque-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!editingActive) return;
  try { commitArrangement(setPlaqueText(arrangement, exhibitSelect.value, plaqueInput.value), '铭牌已更新'); }
  catch (error) { showArrangementStatus(errorMessage(error), true); }
});
element('back').addEventListener('click', () => controller.returnToOverview());
element('reset').addEventListener('click', () => { stage.resetView(); canvasElement.focus(); });
element('zoom-in').addEventListener('click', () => stage.zoomBy(1.12));
element('zoom-out').addEventListener('click', () => stage.zoomBy(1 / 1.12));
element('retry').addEventListener('click', () => stage.retry());
document.getElementById('retry-model')?.addEventListener('click', () => { const id=controller.getSnapshot().selectedId; if (id !== null) stage.retryModel(id); });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (editingRequested) {
    if (!element('arrangement-panel').hidden) {
      setArrangementPanel(false);
      element('open-arrangement-panel').focus();
    }
    return;
  }
  controller.returnToOverview();
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) { unsubscribe(); stage.destroy(); } });
update();

// This is a local-only authoring preview. Real workbench writes retain server authorization.
if (new URLSearchParams(location.search).has('studio')) {
  void (async () => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('请先在主应用登录制作账号，再打开制作预览。');
      sessionResponseSchema.parse(await response.json());
      makerAuthorized = true;
      arrangement = readArrangement(); stage.setArrangement(arrangement); refreshArrangementControls(); update();
    } catch (error: unknown) {
      showArrangementStatus(`制作预览不可用：${errorMessage(error)}`, true);
    }
  })();
}
