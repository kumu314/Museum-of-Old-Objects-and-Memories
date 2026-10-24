'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { assetSchema } from '../../contracts/assets';
import {
  modelAssetPath, modelGenerationJobSchema, modelGenerationPaths,
  modelInputAssetIds, modelViewLabels, modelViews,
  type ModelGenerationJob, type ModelInput,
} from '../../contracts/model-generation';
import { apiRequest, describeFailure, jsonRequest } from './api';

const STATUS_LABELS = { SUBMITTING: '提交中…', WAIT: '已受理，排队中…', RUN: '生成中…', FAIL: '失败', DONE: '已完成' } as const;

export function ModelGenerationFields({ museumId, exhibitId, exhibitVersion, input, photoAssetId, disabled, onChange, onBusy, onError }: {
  museumId: string; exhibitId: string | null; exhibitVersion: number | null; input: ModelInput; photoAssetId: string | null; disabled: boolean;
  onChange: (input: ModelInput) => void; onBusy: (busy: boolean) => void; onError: (error: string | null) => void;
}) {
  const assetPath = `/api/museums/${encodeURIComponent(museumId)}/assets`;
  const [job, setJob] = useState<ModelGenerationJob | null>(null);
  const jobRef = useRef<ModelGenerationJob | null>(null);
  jobRef.current = job;
  const active = job !== null && (job.status === 'SUBMITTING' || job.status === 'WAIT' || job.status === 'RUN');
  const terminal = job?.status === 'FAIL' || job?.status === 'DONE';

  // 轮询任务状态；终态（FAIL/DONE）后停止。切换展品时由 resetKey 重建组件。
  useEffect(() => {
    const current = jobRef.current;
    if (!current || terminal) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void (async () => {
        try {
          const next = await apiRequest(modelGenerationPaths(museumId, current.exhibitId).job(current.id),
            modelGenerationJobSchema, { signal: controller.signal });
          setJob(next);
        } catch (error) {
          if (controller.signal.aborted) return;
          setJob((previous) => previous === null ? previous
            : { ...previous, status: 'FAIL', errorMessage: describeFailure(error) });
        }
      })();
    }, 3_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [museumId, job?.id, terminal]);

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
  async function generate() {
    if (input.mode !== 'single' || input.imageAssetId === null || exhibitId === null || exhibitVersion === null) return;
    onBusy(true); onError(null);
    try {
      const result = await apiRequest(modelGenerationPaths(museumId, exhibitId).single, modelGenerationJobSchema,
        jsonRequest('POST', {
          expectedVersion: exhibitVersion, requestId: crypto.randomUUID(),
          generationConsent: true, imageAssetId: input.imageAssetId,
        }));
      setJob(result);
    } catch (error) { onError(describeFailure(error)); }
    finally { onBusy(false); }
  }
  const photos = input.mode === 'single'
    ? [{ key: 'single', label: '单张照片', assetId: input.imageAssetId, assign: (id: string | null) => onChange({ mode: 'single', imageAssetId: id }) }]
    : modelViews.map((view) => ({ key: view, label: modelViewLabels[view], assetId: input.views[view], assign: (id: string | null) => onChange({ mode: 'multiview', views: { ...input.views, [view]: id } }) }));
  const canGenerate = input.mode === 'single' && input.imageAssetId !== null && exhibitId !== null && exhibitVersion !== null
    && !disabled && !active;
  const statusText = job === null ? null
    : job.status === 'FAIL' ? `失败：${job.errorMessage ?? '请稍后重试。'}`
    : job.status === 'DONE' ? '模型已生成（已通过加载与纹理校验）'
    : STATUS_LABELS[job.status];
  return <section className="workbench-model-note" aria-label="照片生成三维准备">
    <div className="wb-row"><strong>照片生成 3D</strong><span className="wb-badge">混元反代 · 演示链路</span></div>
    <div className="wb-actions" role="group" aria-label="建模照片模式"><button type="button" className="wb-secondary" aria-pressed={input.mode === 'single'} disabled={disabled} onClick={() => mode('single')}>单张生成</button><button type="button" className="wb-secondary" aria-pressed={input.mode === 'multiview'} disabled={disabled} onClick={() => mode('multiview')}>四视图生成</button></div>
    <p>{input.mode === 'single' ? '准备一张主体清晰、遮挡较少的照片。' : '分别准备同一件旧物的正面、背面、左侧和右侧照片。'}点击“生成”即代表允许把该照片提交给混元 3D 用于建模；模型只能近似呈现，不能保证未拍摄细节准确。</p>
    <div className="workbench-model-photos">{photos.map((photo) => <div key={photo.key}>
      <span>{photo.label}</span>{photo.assetId && <Image src={`${assetPath}/${photo.assetId}`} alt={`${photo.label}建模照片`} width={160} height={120} unoptimized />}
      <label className="workbench-file-button">{photo.assetId ? '更换照片' : '选择照片'}<input type="file" aria-label={`上传${photo.label}建模照片`} accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { void upload(event.target.files?.[0], photo.assign); event.target.value = ''; }} /></label>
      {photo.assetId && <button type="button" className="wb-text-link" disabled={disabled} onClick={() => photo.assign(null)}>移除关联</button>}
    </div>)}</div>
    {input.mode === 'single' && photoAssetId && input.imageAssetId !== photoAssetId && <button type="button" className="wb-text-link" disabled={disabled} onClick={() => onChange({ mode: 'single', imageAssetId: photoAssetId })}>使用上方实拍照片</button>}
    <p>生成前请先保存草稿；四视图生成暂未开放。生成消耗演示额度，重复点击会复用进行中的任务，不会重复扣费。</p>
    {input.mode === 'multiview'
      ? <button type="button" className="wb-secondary" disabled>四视图生成 · 暂未支持</button>
      : <button type="button" className="wb-secondary" disabled={!canGenerate} onClick={() => { void generate(); }}>{active && job ? STATUS_LABELS[job.status] : job?.status === 'FAIL' ? '重新生成 3D 模型' : '生成 3D 模型'}</button>}
    {statusText && <p role="status">{statusText}{job?.status === 'DONE' && job.modelAssetId && <> · <a href={modelAssetPath(museumId, job.modelAssetId)} download={`model-${job.id}.glb`}>下载 GLB</a></>}</p>}
    {job?.status === 'DONE' && job.stats && <p>结果规模：{job.stats.meshCount} 网格 / {job.stats.materialCount} 材质 / {Math.round(job.stats.byteLength / 1024)} KB。入柜采纳与发布接入将在后续版本开放。</p>}
  </section>;
}
