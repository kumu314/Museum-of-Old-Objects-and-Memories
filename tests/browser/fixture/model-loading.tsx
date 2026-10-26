import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CabinetPreview } from '../../../src/features/studio/cabinet-preview';
import type { CabinetExhibit } from '../../../src/features/studio/cabinet-items';

const initial: CabinetExhibit[] = [
  { id: 'first', name: '合成模型一', era: '待考', slotIndex: 0, modelKey: 'photo-plane', photoAssetId: 'photo', generatedModelAssetId: 'first-model' },
  { id: 'second', name: '合成模型二', era: '待考', slotIndex: 1, modelKey: 'ticket', photoAssetId: null, generatedModelAssetId: 'second-model' },
];

function Fixture() {
  const [exhibits, setExhibits] = useState(initial);
  const [selectedSlot, setSelectedSlot] = useState(0);
  // 此页检查状态和请求生命周期；较小画布减少 CI 软件光栅开销，视觉验收另用正式视口。
  return <><style>{`.workbench-cabinet-viewport { width: 320px; height: 220px; position: relative; } canvas { width: 100%; height: 100%; }`}</style>
    <button onClick={() => setExhibits((items) => items.map((item) => ({ ...item, name: `${item.name}更新` })))}>刷新资料</button>
    <button onClick={() => setExhibits((items) => items.map((item) => ({ ...item, slotIndex: item.slotIndex === 0 ? 1 : 0 })))}>交换格位</button>
    <button onClick={() => setExhibits((items) => items.map((item) => item.id === 'first' ? { ...item, generatedModelAssetId: 'new-model' } : item))}>替换模型</button>
    <button onClick={() => setExhibits((items) => items.map((item) => item.id === 'first' ? { ...item, generatedModelAssetId: 'failed-model' } : item))}>失效模型</button>
    <button onClick={() => setExhibits((items) => items.map((item) => ({ ...item, slotIndex: item.slotIndex + 6 })))}>移至下一页</button>
    <CabinetPreview exhibits={exhibits} selectedSlot={selectedSlot} disabled={false} onSelectSlot={setSelectedSlot} assetBase="/api/museums/synthetic/assets" />
  </>;
}

const root = document.getElementById('root');
if (root === null) throw new Error('缺少模型加载测试挂载点');
createRoot(root).render(<Fixture />);
