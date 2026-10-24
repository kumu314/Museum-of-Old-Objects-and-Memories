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

// Reserved paths only. Register these after task persistence, deduplication,
// provider submission recovery and result validation are implemented.
export function modelGenerationPaths(museumId: string, exhibitId: string) {
  const base = `/api/museums/${encodeURIComponent(museumId)}/exhibits/${encodeURIComponent(exhibitId)}/model`;
  return { single: `${base}/single`, multiview: `${base}/multiview` };
}
