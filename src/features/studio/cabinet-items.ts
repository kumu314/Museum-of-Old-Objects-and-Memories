import type { PublicExhibit } from '../../contracts/museum';
import type { CabinetStageItem } from '../cabinet/cabinet-stage';

export type CabinetExhibit = Pick<PublicExhibit, 'id' | 'name' | 'era' | 'slotIndex' | 'modelKey' | 'photoAssetId'>;

export function cabinetItems(exhibits: readonly CabinetExhibit[], assetBase: string): CabinetStageItem[] {
  return exhibits.flatMap((exhibit): CabinetStageItem[] => {
    if (exhibit.modelKey === 'photo-plane') {
      if (exhibit.photoAssetId === null) return [];
      return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: 'photo-plane', photoUrl: `${assetBase}/${encodeURIComponent(exhibit.photoAssetId)}` }];
    }
    return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: exhibit.modelKey }];
  });
}
