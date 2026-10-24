import type { PublicExhibit } from '../../contracts/museum';
import type { CabinetRenderItem } from '../cabinet/cabinet-stage';

export type CabinetExhibit = Pick<PublicExhibit, 'id' | 'name' | 'era' | 'slotIndex' | 'modelKey' | 'photoAssetId'>;

export function cabinetItems(exhibits: readonly CabinetExhibit[], assetBase: string): CabinetRenderItem[] {
  return exhibits.flatMap((exhibit): CabinetRenderItem[] => {
    if (exhibit.modelKey === 'photo-plane') {
      if (exhibit.photoAssetId === null) return [];
      return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: 'photo-plane', photoUrl: `${assetBase}/${encodeURIComponent(exhibit.photoAssetId)}` }];
    }
    return [{ id: exhibit.id, slot: exhibit.slotIndex, modelKey: exhibit.modelKey }];
  });
}
