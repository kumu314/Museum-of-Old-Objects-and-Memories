import type { PublicExhibit } from '../../contracts/museum';
import type { CabinetStageItem } from '../cabinet/cabinet-stage';

export function shareAssetUrl(token: string, assetId: string): string {
  return `/api/share/${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}`;
}

export function publicStageItems(exhibits: readonly PublicExhibit[], token: string): CabinetStageItem[] {
  const short = (text: string, length: number) => Array.from(text).length > length ? `${Array.from(text).slice(0, length - 1).join('')}…` : text;
  return exhibits.map((exhibit) => {
    const base = { id: exhibit.id, slot: exhibit.slotIndex, plaqueText: `${short(exhibit.name, 12)} · ${short(exhibit.era, 9)}` };
    if (exhibit.generatedModelAssetId) return { ...base, modelKey: 'glb', source: {
      assetId: exhibit.generatedModelAssetId, version: exhibit.generatedModelAssetId,
      url: `/api/share/${encodeURIComponent(token)}/model-assets/${encodeURIComponent(exhibit.generatedModelAssetId)}`,
    } };
    if (exhibit.modelKey !== 'photo-plane') return { ...base, modelKey: exhibit.modelKey };
    // The public schema requires a processed photograph for this model kind.
    if (exhibit.photoAssetId === null) throw new Error('实拍薄片缺少展示图片。');
    return { ...base, modelKey: 'photo-plane', photoUrl: shareAssetUrl(token, exhibit.photoAssetId) };
  });
}
