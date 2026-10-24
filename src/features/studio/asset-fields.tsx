import Image from 'next/image';
import { useRef } from 'react';
import { NarrativeAudio } from './narrative-audio';
import { assetSchema, type Asset } from '../../contracts/assets';
import { apiRequest, describeFailure } from './api';

export function AssetFields({ museumId, photoAssetId, audioAssetId, busy, onAsset, onRemove, onBusy, onError }: {
  museumId: string; photoAssetId: string | null; audioAssetId: string | null; busy: boolean;
  onAsset: (asset: Asset) => void; onRemove: (kind: 'image' | 'audio') => void; onBusy: (value: boolean) => void; onError: (message: string | null) => void;
}) {
  const uploading = useRef(false);
  const assetPath = `/api/museums/${encodeURIComponent(museumId)}/assets`;
  async function upload(file: File | undefined, kind: 'image' | 'audio') {
    if (!file || busy || uploading.current) return;
    uploading.current = true;
    onBusy(true); onError(null);
    const data = new FormData(); data.set('file', file);
    try {
      const asset = await apiRequest(assetPath, assetSchema, { method: 'POST', body: data });
      if (asset.kind !== kind) { onError('所选文件的实际类型与当前素材栏不一致，请重新选择。'); return; }
      onAsset(asset);
    } catch (failure) { onError(describeFailure(failure)); }
    finally { uploading.current = false; onBusy(false); }
  }
  return <section className="workbench-assets" id="workbench-uploads" aria-label="原声与实拍">
    <div className="workbench-media-heading"><h3>音频叙事</h3><span>让旧物自己讲述</span>
      <label className="workbench-file-button" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void upload(event.dataTransfer.files[0], 'audio'); }}>＋ {audioAssetId ? '替换原声' : '上传原声'}<input type="file" aria-label="上传原声录音" accept=".mp3,.m4a,.wav" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'audio'); event.target.value = ''; }} /></label>
    </div>
    <NarrativeAudio key={audioAssetId ?? 'empty'} src={audioAssetId ? `${assetPath}/${audioAssetId}` : null} disabled={busy} />
    <div className="workbench-media-meta"><span>MP3 / M4A / WAV · ≤20 MiB</span>{audioAssetId && <button type="button" className="wb-text-link" disabled={busy} onClick={() => onRemove('audio')}>移除录音关联</button>}</div>
    <div className="workbench-photo-strip">
      {photoAssetId && <a className="workbench-media-photo" href={`${assetPath}/${photoAssetId}`} target="_blank" rel="noreferrer"><Image src={`${assetPath}/${photoAssetId}`} alt="当前旧物实拍照片" width={180} height={120} unoptimized /><span>当前实拍 ↗</span></a>}
      <label className="workbench-dropzone workbench-photo-upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void upload(event.dataTransfer.files[0], 'image'); }}>
        <span className="workbench-upload-symbol" aria-hidden="true">＋</span><span><strong>{photoAssetId ? '替换实拍' : '添加实拍'}</strong><small>JPG / PNG / WebP · ≤10 MiB</small></span>
        <input type="file" aria-label="上传旧物照片" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'image'); event.target.value = ''; }} />
      </label>
    </div>
    <div className="wb-actions"><label className="workbench-file-button">相机拍摄<input type="file" aria-label="拍摄旧物照片" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0], 'image'); event.target.value = ''; }} /></label>
      {photoAssetId && <button type="button" className="wb-text-link" disabled={busy} onClick={() => onRemove('image')}>移除照片关联</button>}
    </div>
  </section>;
}
