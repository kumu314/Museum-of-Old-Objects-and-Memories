import { assetSchema, type Asset } from '../../contracts/assets';
import { apiRequest, describeFailure } from './api';
import { buttonClass, inputClass } from './ui';

export function AssetFields({ museumId, photoAssetId, audioAssetId, busy, onAsset, onBusy, onError }: {
  museumId: string; photoAssetId: string | null; audioAssetId: string | null; busy: boolean;
  onAsset: (asset: Asset) => void; onBusy: (value: boolean) => void; onError: (message: string | null) => void;
}) {
  async function upload(file: File | undefined, kind: 'image' | 'audio') {
    if (!file) return;
    onBusy(true); onError(null);
    const data = new FormData(); data.set('file', file);
    try {
      const asset = await apiRequest(`/api/museums/${museumId}/assets`, assetSchema, { method: 'POST', body: data });
      if (asset.kind !== kind) { onError('所选文件的实际类型与当前素材栏不一致，请重新选择。'); return; }
      onAsset(asset);
    } catch (failure) { onError(describeFailure(failure)); }
    finally { onBusy(false); }
  }
  return <div className="grid gap-5 sm:grid-cols-2">
    <div><span className="block text-sm text-stone-300">实拍图片</span>
      <div className="mt-2 flex flex-wrap gap-3">
        {/* capture opens the device camera on phones; the plain input opens the album picker. */}
        <label className={`${buttonClass} inline-block ${busy ? 'cursor-wait opacity-40' : 'cursor-pointer'}`}>拍照上传<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'image'); event.target.value = ''; }} /></label>
        <label className={`${buttonClass} inline-block ${busy ? 'cursor-wait opacity-40' : 'cursor-pointer'}`}>从相册选择<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'image'); event.target.value = ''; }} /></label>
      </div>
      <p className="mt-2 text-xs leading-5 text-stone-500">静态 JPEG / PNG / WebP，最大 10 MiB。上传后还需保存展品。</p>{photoAssetId && <a className="mt-3 inline-block text-sm text-amber-100 underline" href={`/api/museums/${museumId}/assets/${photoAssetId}`} target="_blank" rel="noreferrer">查看当前图片</a>}</div>
    <div><label className="block text-sm text-stone-300">原声录音<input className={inputClass} type="file" accept=".mp3,.m4a,.wav" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'audio'); event.target.value = ''; }} /></label><p className="mt-2 text-xs leading-5 text-stone-500">MP3 / M4A（AAC）/ WAV（PCM），最大 20 MiB。由参观者主动播放。</p>{audioAssetId && <audio className="mt-3 w-full" controls preload="none" src={`/api/museums/${museumId}/assets/${audioAssetId}`} />}</div>
  </div>;
}

export function RemoveAssetButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" className={buttonClass} disabled={disabled} onClick={onClick}>{label}</button>;
}
