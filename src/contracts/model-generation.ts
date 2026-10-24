import { z } from 'zod';
import { idSchema, versionSchema } from './primitives';

export const modelViewSchema = z.enum(['front', 'back', 'left', 'right']);
export const modelViews = modelViewSchema.options;
export const modelViewLabels = { front: '正面', back: '背面', left: '左侧', right: '右侧' } as const;
const draftViews = z.strictObject({ front: idSchema.nullable(), back: idSchema.nullable(), left: idSchema.nullable(), right: idSchema.nullable() });

// Saved preparation is separate from a paid request. Missing photos are valid
// in a draft and never represent a submitted generation task.
export const modelInputSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('single'), imageAssetId: idSchema.nullable() }),
  z.strictObject({ mode: z.literal('multiview'), views: draftViews }),
]);
export type ModelInput = z.infer<typeof modelInputSchema>;

const taskFields = { expectedVersion: versionSchema, requestId: idSchema, generationConsent: z.literal(true) };
export const singleModelRequestSchema = z.strictObject({ ...taskFields, imageAssetId: idSchema });
export const multiviewModelRequestSchema = z.strictObject({
  ...taskFields,
  views: z.strictObject({ front: idSchema, back: idSchema, left: idSchema, right: idSchema }),
}).refine(({ views }) => new Set(Object.values(views)).size === 4, '请为四个方向分别提供照片。');
export type SingleModelRequest = z.infer<typeof singleModelRequestSchema>;
export type MultiviewModelRequest = z.infer<typeof multiviewModelRequestSchema>;

export function modelInputAssetIds(input: ModelInput): string[] {
  return (input.mode === 'single' ? [input.imageAssetId] : Object.values(input.views)).filter((id): id is string => id !== null);
}

// Reserved paths. single/job/model-assets 已接入；multiview 仍保留待实现。
export function modelGenerationPaths(museumId: string, exhibitId: string) {
  const base = `/api/museums/${encodeURIComponent(museumId)}/exhibits/${encodeURIComponent(exhibitId)}/model`;
  return { single: `${base}/single`, multiview: `${base}/multiview`, job: (jobId: string) => `${base}/jobs/${encodeURIComponent(jobId)}` };
}

export function modelAssetPath(museumId: string, assetId: string) {
  return `/api/museums/${encodeURIComponent(museumId)}/model-assets/${encodeURIComponent(assetId)}`;
}

// 任务状态对齐适配器：SUBMITTING 表示已建任务但外部任务号未知（可能已消耗
// 积分，也可能未受理）；WAIT/RUN 为上游受理后的执行态；FAIL/DONE 终态。
export const modelJobStatusSchema = z.enum(['SUBMITTING', 'WAIT', 'RUN', 'FAIL', 'DONE']);

export const modelGlbStatsSchema = z.strictObject({
  byteLength: z.number().int().positive(),
  meshCount: z.number().int().nonnegative(),
  materialCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
});

export const modelGenerationJobSchema = z.strictObject({
  id: idSchema,
  exhibitId: idSchema,
  status: modelJobStatusSchema,
  sourceVersion: versionSchema,
  errorCode: z.string().max(120).nullable(),
  errorMessage: z.string().max(240).nullable(),
  modelAssetId: idSchema.nullable(),
  stats: modelGlbStatsSchema.nullable(),
  createdAt: z.string().min(1),
});
export type ModelGenerationJob = z.infer<typeof modelGenerationJobSchema>;
