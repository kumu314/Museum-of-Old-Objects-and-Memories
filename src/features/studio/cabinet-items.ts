import type { PublicExhibit } from '../../contracts/museum';
import type { CabinetStageItem } from '../cabinet/cabinet-stage';

export type CabinetExhibit = Pick<PublicExhibit, 'id' | 'name' | 'era' | 'slotIndex' | 'modelKey' | 'photoAssetId' | 'generatedModelAssetId'>;

export function cabinetItems(
  exhibits: readonly CabinetExhibit[],
  assetBase: string,
  modelAssetBase?: string,
  failedModelAssetIds?: ReadonlySet<string>,
): CabinetStageItem[] {
  return exhibits.flatMap((exhibit): CabinetStageItem[] => {
    // 已采纳生成模型时优先渲染三维模型；加载失败（或明确回退）时退回照片，
    // 保证柜格不会变成空位，照片始终是公开页与失败的兜底。
    if (exhibit.generatedModelAssetId && modelAssetBase !== undefined
      && !(failedModelAssetIds?.has(exhibit.generatedModelAssetId) ?? false)) {
      return [{
        id: exhibit.id, slot: exhibit.slotIndex, modelKey: 'glb',
        source: { assetId: exhibit.generatedModelAssetId, version: exhibit.generatedModelAssetId,
          url: `${modelAssetBase}/${encodeURIComponent(exhibit.generatedModelAssetId)}` },
      }];
    }
    if (exhibit.modelKey === 'photo-plane'
      || (exhibit.generatedModelAssetId && failedModelAssetIds?.has(exhibit.generatedModelAssetId) && exhibit.photoAssetId !== null)) {
      if (exhibit.photoAssetId === null) return [];
      return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: 'photo-plane', photoUrl: `${assetBase}/${encodeURIComponent(exhibit.photoAssetId)}` }];
    }
    return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: exhibit.modelKey }];
  });
}
