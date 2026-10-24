import Image from 'next/image';
import { assetSchema, type Asset } from '../../contracts/assets';
import { apiRequest, describeFailure } from './api';

export function AssetFields({ museumId, photoAssetId, audioAssetId, busy, onAsset, onBusy, onError }: {
  museumId: string; photoAssetId: string | null; audioAssetId: string | null; busy: boolean;
  onAsset: (asset: Asset) => void; onBusy: (value: boolean) => void; onError: (message: string | null) => void;
}) {
  const assetPath = `/api/museums/${encodeURIComponent(museumId)}/assets`;
  async function upload(file: File | undefined, kind: 'image' | 'audio') {
    if (!file) return;
    onBusy(true); onError(null);
    const data = new FormData(); data.set('file', file);
    try {
      const asset = await apiRequest(assetPath, assetSchema, { method: 'POST', body: data });
      if (asset.kind !== kind) { onError('所选文件的实际类型与当前素材栏不一致，请重新选择。'); return; }
      onAsset(asset);
    } catch (failure) { onError(describeFailure(failure)); }
    finally { onBusy(false); }
  }
  return <div className="workbench-assets">
    <div><h3>留下照片</h3>{photoAssetId ? <a href={`${assetPath}/${photoAssetId}`} target="_blank" rel="noreferrer" className="workbench-photo"><Image src={`${assetPath}/${photoAssetId}`} alt="当前旧物的实拍照片，点击查看大图" width={480} height={320} unoptimized /></a>
      : <p className="workbench-photo-empty">从一张能看清旧物的照片开始</p>}
      <div className="wb-actions">
        <label className="workbench-file-button">拍照上传<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'image'); event.target.value = ''; }} /></label>
        <label className="workbench-file-button">从相册选择<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'image'); event.target.value = ''; }} /></label>
      </div><p className="wb-hint">JPEG / PNG / WebP，最大 10 MiB。上传后请保存草稿。</p></div>
    <details className="workbench-details"><summary>保留一段原声（可选）</summary><label>上传原声录音<input type="file" accept=".mp3,.m4a,.wav" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'audio'); event.target.value = ''; }} /></label>
      <p className="wb-hint">MP3 / M4A（AAC）/ WAV（PCM），最大 20 MiB。由参观者主动播放。</p>
      {audioAssetId && <audio controls preload="none" src={`${assetPath}/${audioAssetId}`} aria-label="当前旧物的原声录音" />}</details>
  </div>;
}
