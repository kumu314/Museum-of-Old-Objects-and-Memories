import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { modelManifest, type CabinetModelKey } from '../model-manifest';
import { defaultModelPlacement, type ModelPlacement } from '../model-placement';
import { ModelPreview, type ModelSelection } from '../../viewer/model-preview';
import './model-preview.css';

function PreviewDemo() {
  const [key, setKey] = useState<CabinetModelKey>('cassette');
  const [version, setVersion] = useState(1);
  const [failure, setFailure] = useState(false);
  const [placement, setPlacement] = useState<ModelPlacement>(defaultModelPlacement);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const model = modelManifest[key];
  return <main><header><p className="eyebrow">拾物馆 / 制作预览</p><h1>让旧物找到合适的角度</h1><p>动态 GLB 接入样例 · 使用已有演示模型，尚未连接照片生成服务。当前调整仅用于本页演示。</p></header>
    <nav aria-label="测试样例"><label>演示模型 <select value={key} onChange={(event) => { const key = event.target.value; if (key === 'camera-01' || key === 'cassette' || key === 'ticket') { setKey(key); setPlacement(defaultModelPlacement()); setSelection(null); setFailure(false); } }}>
      <option value="cassette">手录磁带</option><option value="camera-01">复古相机</option><option value="ticket">旧车票</option></select></label>
      <button type="button" onClick={() => { setVersion((value) => value + 1); setSelection(null); }}>替换为新版本</button>
      <button type="button" aria-pressed={failure} onClick={() => { setFailure(!failure); setSelection(null); }}>{failure ? '恢复模型地址' : '模拟模型不可用'}</button>
      <a href={new URL('./index.html', document.baseURI).href}>查看完整展柜</a></nav>
    <ModelPreview source={{ assetId: `demo-${key}`, version: String(version), url: failure ? '/missing-preview-model.glb' : model.path }}
      label={model.displayName} value={placement} onChange={(placement) => { setPlacement(placement); setSelection(null); }} onApply={setSelection}
      fallback={<><p>样例资料：{model.displayName} · {model.approximation}</p><p>来源：{model.source}。正式制作页面应在这里保留实拍与故事入口。</p></>} />
    <p role="status" className="selection">{selection ? `已采用本页陈列：版本 ${selection.version}，方向 ${selection.placement.rotation.join(' / ')}°，大小 ${Math.round(selection.placement.size * 100)}%。尚未保存到服务器。` : '调整后可点击“采用当前陈列”。刷新页面会恢复初始设置。'}</p>
    <footer>操作：点击“取出查看”后拖动旋转，双指、按钮、滚轮或加减键缩放，Esc 放回。替换模型会取消旧请求并保留当前陈列设置。</footer>
  </main>;
}
const root = document.getElementById('root');
if (root === null) throw new Error('缺少模型预览挂载点');
createRoot(root).render(<PreviewDemo />);
