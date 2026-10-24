import type { PublicExhibit } from '../../contracts/museum';
import type { CabinetStageItem } from '../cabinet/cabinet-stage';

export type CabinetExhibit = Pick<PublicExhibit, 'id' | 'name' | 'era' | 'slotIndex' | 'modelKey' | 'photoAssetId'>
  & { readonly generatedModelAssetId?: string | null };

export function cabinetItems(
  exhibits: readonly CabinetExhibit[],
  assetBase: string,
  modelAssetBase?: string,
): CabinetStageItem[] {
  return exhibits.flatMap((exhibit): CabinetStageItem[] => {
    // 已采纳生成模型时优先渲染三维模型；照片仍保留为公开页与失败回退。
    if (exhibit.generatedModelAssetId && modelAssetBase !== undefined) {
      return [{
        id: exhibit.id, slot: exhibit.slotIndex, modelKey: 'glb',
        source: { assetId: exhibit.generatedModelAssetId, version: exhibit.generatedModelAssetId,
          url: `${modelAssetBase}/${encodeURIComponent(exhibit.generatedModelAssetId)}` },
      }];
    }
    if (exhibit.modelKey === 'photo-plane') {
      if (exhibit.photoAssetId === null) return [];
      return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: 'photo-plane', photoUrl: `${assetBase}/${encodeURIComponent(exhibit.photoAssetId)}` }];
    }
    return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: exhibit.modelKey }];
  });
}
