import type { CabinetExhibit } from '../../../src/features/studio/cabinet-items';
// 此处替换 WebGL 绘制，保留真实工作台的父子状态与选择回调；GPU 和视觉效果需另行验收。
export function CabinetPreview({ exhibits, disabled, onSelectSlot }: { exhibits: readonly CabinetExhibit[]; disabled: boolean; onSelectSlot: (slot: number) => void }) {
  return <div aria-label="测试展柜">{exhibits.map((item) => <button key={item.id} disabled={disabled} onClick={() => onSelectSlot(item.slotIndex)}>
    {item.name}<output data-testid={`model-${item.id}`}>{item.generatedModelAssetId ?? item.modelKey}</output>
  </button>)}</div>;
}
