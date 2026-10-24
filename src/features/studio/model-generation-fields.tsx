import Image from 'next/image';
import { assetSchema } from '../../contracts/assets';
import { modelInputAssetIds, modelViewLabels, modelViews, type ModelInput } from '../../contracts/model-generation';
import { apiRequest, describeFailure } from './api';

export function ModelGenerationFields({ museumId, input, photoAssetId, disabled, onChange, onBusy, onError }: {
  museumId: string; input: ModelInput; photoAssetId: string | null; disabled: boolean;
  onChange: (input: ModelInput) => void; onBusy: (busy: boolean) => void; onError: (error: string | null) => void;
}) {
  const assetPath = `/api/museums/${encodeURIComponent(museumId)}/assets`;
  function mode(next: ModelInput['mode']) {
    if (next === input.mode) return;
    if (modelInputAssetIds(input).length && !window.confirm('切换模式会清空当前建模照片的关联，已上传文件仍私密保留。确定切换吗？')) return;
    onChange(next === 'single' ? { mode: 'single', imageAssetId: null }
      : { mode: 'multiview', views: { front: null, back: null, left: null, right: null } });
  }
  async function upload(file: File | undefined, assign: (id: string) => void) {
    if (!file) return;
    onBusy(true); onError(null);
    const data = new FormData(); data.set('file', file);
    try {
      const asset = await apiRequest(assetPath, assetSchema, { method: 'POST', body: data });
      if (asset.kind !== 'image') { onError('建模需要 JPEG、PNG 或 WebP 图片，请重新选择。'); return; }
      assign(asset.id);
    } catch (error) { onError(describeFailure(error)); }
    finally { onBusy(false); }
  }
  const photos = input.mode === 'single'
    ? [{ key: 'single', label: '单张照片', assetId: input.imageAssetId, assign: (id: string | null) => onChange({ mode: 'single', imageAssetId: id }) }]
    : modelViews.map((view) => ({ key: view, label: modelViewLabels[view], assetId: input.views[view], assign: (id: string | null) => onChange({ mode: 'multiview', views: { ...input.views, [view]: id } }) }));
  return <section className="workbench-model-note" aria-label="照片生成三维准备">
    <div className="wb-row"><strong>照片生成 3D</strong><span className="wb-badge">混元 · 尚未接入</span></div>
    <div className="wb-actions" role="group" aria-label="建模照片模式"><button type="button" className="wb-secondary" aria-pressed={input.mode === 'single'} disabled={disabled} onClick={() => mode('single')}>单张生成</button><button type="button" className="wb-secondary" aria-pressed={input.mode === 'multiview'} disabled={disabled} onClick={() => mode('multiview')}>四视图生成</button></div>
    <p>{input.mode === 'single' ? '准备一张主体清晰、遮挡较少的照片。' : '分别准备同一件旧物的正面、背面、左侧和右侧照片。'}当前仅保存照片准备，不会向混元发送素材。</p>
    <div className="workbench-model-photos">{photos.map((photo) => <div key={photo.key}>
      <span>{photo.label}</span>{photo.assetId && <Image src={`${assetPath}/${photo.assetId}`} alt={`${photo.label}建模照片`} width={160} height={120} unoptimized />}
      <label className="workbench-file-button">{photo.assetId ? '更换照片' : '选择照片'}<input type="file" aria-label={`上传${photo.label}建模照片`} accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { void upload(event.target.files?.[0], photo.assign); event.target.value = ''; }} /></label>
      {photo.assetId && <button type="button" className="wb-text-link" disabled={disabled} onClick={() => photo.assign(null)}>移除关联</button>}
    </div>)}</div>
    {input.mode === 'single' && photoAssetId && input.imageAssetId !== photoAssetId && <button type="button" className="wb-text-link" disabled={disabled} onClick={() => onChange({ mode: 'single', imageAssetId: photoAssetId })}>使用上方实拍照片</button>}
    <p>选择后请保存草稿。服务接入后，需另行授权、生成、预览与采纳；模型只能近似呈现，不能保证未拍摄细节准确。</p>
    <button type="button" className="wb-secondary" disabled>生成 3D 模型 · 尚未接入</button>
  </section>;
}
