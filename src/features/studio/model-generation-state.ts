import type { ModelGenerationJob } from '../../contracts/model-generation';

export function modelResultState(job: ModelGenerationJob | null, exhibitVersion: number | null, generatedModelAssetId: string | null): 'pending' | 'adopted' | 'stale' | 'ready' {
  if (job?.status !== 'DONE') return 'pending';
  // 采纳会增加版本；当前模型引用比生成时的版本更能说明是否已入柜。
  if (job.modelAssetId !== null && job.modelAssetId === generatedModelAssetId) return 'adopted';
  return job.sourceVersion === exhibitVersion ? 'ready' : 'stale';
}
