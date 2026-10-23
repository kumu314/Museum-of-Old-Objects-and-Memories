import { z } from 'zod';
import { successResponseSchema } from './errors';
import { captionSchema, eraSchema, exhibitNameSchema, idSchema, sourceIdSchema,
  textSchema, timestampSchema, versionSchema } from './primitives';

export const sourceSegmentSchema = z.strictObject({
  id: sourceIdSchema,
  source: z.enum(['rawStory', 'transcript']),
  text: textSchema(1, 6_000),
});

export const sourceSegmentsSchema = z.array(sourceSegmentSchema).max(40)
  .refine((segments) => new Set(segments.map(({ id }) => id)).size === segments.length,
    '讲述片段 ID 不得重复。')
  .refine((segments) => segments.reduce((total, segment) => total + Array.from(segment.text).length, 0) <= 12_000,
    '讲述片段总长度不能超过 12000 字。');

export const aiOutputSchema = z.strictObject({
  caption: textSchema(60, 120),
  questions: z.array(textSchema(1, 200)).max(2),
  sourceSegmentIds: z.array(sourceIdSchema).min(1).max(40)
    .refine((ids) => new Set(ids).size === ids.length, '来源片段 ID 不得重复。'),
});

export const aiInputSchema = z.strictObject({
  name: exhibitNameSchema,
  era: eraSchema,
  sourceVersion: versionSchema,
  sourceSegments: sourceSegmentsSchema.refine((segments) => segments.length > 0, '请先保存讲述片段。'),
});

/** This validates references only; a human must still review the factual claims. */
export function aiOutputForSourcesSchema(segments: ReadonlyArray<SourceSegment>) {
  const allowedIds = new Set(segments.map(({ id }) => id));
  return aiOutputSchema.refine((output) => output.sourceSegmentIds.every((id) => allowedIds.has(id)),
    'AI 输出引用了输入中不存在的来源片段。');
}

export const aiDraftSchema = z.strictObject({
  id: idSchema,
  exhibitId: idSchema,
  sourceVersion: versionSchema,
  output: aiOutputSchema,
  createdAt: timestampSchema,
});
export const aiDraftResponseSchema = successResponseSchema(aiDraftSchema);

export const requestAiInputSchema = z.strictObject({ expectedVersion: versionSchema });
export const adoptAiInputSchema = z.strictObject({
  expectedVersion: versionSchema,
  draftId: idSchema,
  caption: captionSchema.refine((caption) => caption.length > 0, '采纳展签不能为空。'),
});

export type SourceSegment = z.infer<typeof sourceSegmentSchema>;
export type AiInput = z.infer<typeof aiInputSchema>;
export type AiOutput = z.infer<typeof aiOutputSchema>;
export type AiDraft = z.infer<typeof aiDraftSchema>;
export type RequestAiInput = z.infer<typeof requestAiInputSchema>;
export type AdoptAiInput = z.infer<typeof adoptAiInputSchema>;
