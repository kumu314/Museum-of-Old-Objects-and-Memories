'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { assetSchema } from '../../contracts/assets';
import {
  modelAssetPath, modelGenerationJobSchema, modelGenerationPaths,
  modelInputAssetIds, modelViewLabels, modelViews,
  type ModelGenerationJob, type ModelInput,
} from '../../contracts/model-generation';
import { apiRequest, describeFailure, jsonRequest } from './api';

const STATUS_LABELS = { SUBMITTING: '提交中…', WAIT: '已受理，排队中…', RUN: '生成中…', FAIL: '失败', DONE: '已完成' } as const;

export function ModelGenerationFields({ museumId, exhibitId, exhibitVersion, dirty, input, photoAssetId, disabled, onChange, onBusy, onError, onAdopt }: {
  museumId: string; exhibitId: string | null; exhibitVersion: number | null; dirty: boolean; input: ModelInput; photoAssetId: string | null; disabled: boolean;
  onChange: (input: ModelInput) => void; onBusy: (busy: boolean) => void; onError: (error: string | null) => void;
  onAdopt: (jobId: string) => Promise<void>;
}) {
  const assetPath = `/api/museums/${encodeURIComponent(museumId)}/assets`;
  const [storedJob, setJob] = useState<ModelGenerationJob | null>(null);
  const job = storedJob?.exhibitId === exhibitId ? storedJob : null;
  const [pollError, setPollError] = useState<string | null>(null);
  const active = job !== null && (job.status === 'SUBMITTING' || job.status === 'WAIT' || job.status === 'RUN');
  const terminal = job?.status === 'FAIL' || job?.status === 'DONE';

  // 进入或刷新页面时恢复该展品的最新任务，避免“任务在跑但界面不知道”。
  useEffect(() => {
    if (exhibitId === null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const latest = await apiRequest(modelGenerationPaths(museumId, exhibitId).latest,
          modelGenerationJobSchema.nullable(), { signal: controller.signal });
        if (!controller.signal.aborted) { setJob(latest); setPollError(null); }
      } catch (error) {
        if (!controller.signal.aborted) onError(describeFailure(error));
      }
    })();
    return () => controller.abort();
  }, [museumId, exhibitId, onError]);

  const jobId = job?.id;
  // 一次请求完成后再安排下一次，慢响应不会叠加；切换展品或任务后丢弃旧结果。
  useEffect(() => {
    if (exhibitId === null || jobId === undefined || terminal) return;
    const controller = new AbortController();
    const jobPath = modelGenerationPaths(museumId, exhibitId).job(jobId);
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let finished = false;
      try {
        const next = await apiRequest(jobPath,
          modelGenerationJobSchema, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setJob(next);
        setPollError(null);
        finished = next.status === 'FAIL' || next.status === 'DONE';
        // 生成完成即已自动入柜；触发一次幂等采纳以刷新工作台，
        // 让展柜立即改为展示生成的模型。
        if (next.status === 'DONE' && next.modelAssetId !== null && exhibitId !== null) {
          void onAdopt(next.id);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPollError(`状态刷新失败，正在重试：${describeFailure(error)}`);
      } finally {
        if (!controller.signal.aborted && !finished) timer = setTimeout(() => { void poll(); }, 3_000);
      }
    }
    timer = setTimeout(() => { void poll(); }, 3_000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [museumId, exhibitId, jobId, terminal]);

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
    && !dirty && !disabled && !active;
  const generateBlockReason = input.mode !== 'single' || active ? null
    : input.imageAssetId === null ? '请先选择或关联一张建模照片。'
    : dirty || exhibitId === null || exhibitVersion === null ? '请先点击“保存草稿”（需填写素材来源说明），保存后即可生成。'
    : null;
  const submissionUnknown = job?.status === 'SUBMITTING' && job.errorCode === 'SUBMIT_UNKNOWN';
  const staleResult = job?.status === 'DONE' && job.sourceVersion !== exhibitVersion;
  const statusText = job === null ? null
    : submissionUnknown ? '提交结果未知，需由管理员核对上游任务；核对前不会再次提交。'
    : job.status === 'FAIL' ? `失败：${job.errorMessage ?? '请稍后重试。'}`
    : job.status === 'DONE' ? staleResult ? '旧版生成结果：展品已修改，此模型不对应当前版本。' : '模型已生成（已通过模型校验）'
    : STATUS_LABELS[job.status];
  return <section className="workbench-model-note" aria-label="照片生成三维准备">
    <div className="wb-row"><strong>照片生成 3D</strong><span className="wb-badge">生成任务</span></div>
    <div className="wb-actions" role="group" aria-label="建模照片模式"><button type="button" className="wb-secondary" aria-pressed={input.mode === 'single'} disabled={disabled} onClick={() => mode('single')}>单张生成</button><button type="button" className="wb-secondary" aria-pressed={input.mode === 'multiview'} disabled={disabled} onClick={() => mode('multiview')}>四视图生成</button></div>
    <p>{input.mode === 'single' ? '准备一张主体清晰、遮挡较少的照片。' : '分别准备同一件旧物的正面、背面、左侧和右侧照片。'}点击“生成”即代表允许把该照片提交给混元 3D 用于建模；模型只能近似呈现，不能保证未拍摄细节准确。</p>
    <div className="workbench-model-photos">{photos.map((photo) => <div key={photo.key}>
      <span>{photo.label}</span>{photo.assetId && <Image src={`${assetPath}/${photo.assetId}`} alt={`${photo.label}建模照片`} width={160} height={120} unoptimized />}
      <label className="workbench-file-button">{photo.assetId ? '更换照片' : '选择照片'}<input type="file" aria-label={`上传${photo.label}建模照片`} accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { void upload(event.target.files?.[0], photo.assign); event.target.value = ''; }} /></label>
      {photo.assetId && <button type="button" className="wb-text-link" disabled={disabled} onClick={() => photo.assign(null)}>移除关联</button>}
    </div>)}</div>
    {input.mode === 'single' && photoAssetId && input.imageAssetId !== photoAssetId && <button type="button" className="wb-text-link" disabled={disabled} onClick={() => onChange({ mode: 'single', imageAssetId: photoAssetId })}>使用上方实拍照片</button>}
    <p>生成前请先保存草稿；四视图生成暂未开放。生成可能消耗服务额度；已有进行中或待核对任务时不会再次提交。</p>
    {input.mode === 'multiview'
      ? <button type="button" className="wb-secondary" disabled>四视图生成 · 暂未支持</button>
      : <button type="button" className="wb-secondary" disabled={!canGenerate} onClick={() => { void generate(); }}>{submissionUnknown ? '提交结果待核对' : active && job ? STATUS_LABELS[job.status] : job?.status === 'FAIL' ? '重新生成 3D 模型' : '生成 3D 模型'}</button>}
    {!active && generateBlockReason && <p className="wb-hint">{generateBlockReason}</p>}
    {pollError && <p role="status" className="wb-hint">{pollError}</p>}
    {statusText && <p role="status">{statusText}{job?.status === 'DONE' && job.modelAssetId && <> · <a href={modelAssetPath(museumId, job.modelAssetId)} download={`model-${job.id}.glb`}>下载 GLB</a></>}</p>}
    {job?.status === 'DONE' && job.stats && <p>结果规模：{job.stats.meshCount} 网格 / {job.stats.materialCount} 材质 / {Math.round(job.stats.byteLength / 1024)} KB。</p>}
    {job?.status === 'DONE' && job.modelAssetId && <div className="wb-actions">
      <button type="button" className="wb-secondary" disabled={disabled || dirty} onClick={() => { void onAdopt(job.id); }}>采纳入柜 · 替换照片展示</button>
      {dirty && <span className="wb-hint">先保存草稿后再采纳。</span>}
    </div>}
  </section>;
}
