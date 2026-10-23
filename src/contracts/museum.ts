import { z } from 'zod';
import { sourceSegmentsSchema } from './ai';
import { successResponseSchema } from './errors';
import { captionSchema, eraSchema, exhibitNameSchema, idSchema, modelKeySchema,
  slotIndexSchema, textSchema, timestampSchema, versionSchema } from './primitives';

const museumFields = {
  title: textSchema(1, 120),
  description: textSchema(0, 2_000),
};

const exhibitFields = {
  name: exhibitNameSchema,
  era: eraSchema,
  slotIndex: slotIndexSchema,
  modelKey: modelKeySchema,
  caption: captionSchema,
  photoAssetId: idSchema.nullable(),
  audioAssetId: idSchema.nullable(),
  approximation: textSchema(1, 500),
  sourceNotice: textSchema(1, 1_000),
};

const draftFields = {
  ...exhibitFields,
  rawStory: z.string().refine((value) => Array.from(value).length <= 12_000, '原始讲述不能超过 12000 字。'),
  transcript: z.string().refine((value) => Array.from(value).length <= 12_000, '录音整理文本不能超过 12000 字。').nullable(),
  sourceSegments: sourceSegmentsSchema,
};

export const createMuseumInputSchema = z.strictObject(museumFields);
export const updateMuseumInputSchema = z.strictObject({
  ...museumFields,
  expectedVersion: versionSchema,
});
export const versionInputSchema = z.strictObject({ expectedVersion: versionSchema });

// Saves are complete, explicit editable values. Null clears a media reference;
// omission is invalid, so a partial form can never silently clear saved content.
export const createExhibitInputSchema = z.strictObject({
  ...draftFields,
  expectedMuseumVersion: versionSchema,
});
export const updateExhibitInputSchema = z.strictObject({
  ...draftFields,
  expectedVersion: versionSchema,
});

export const confirmExhibitInputSchema = z.strictObject({
  expectedVersion: versionSchema,
  confirmationNote: textSchema(1, 2_000),
});

export const exhibitDraftSchema = z.strictObject({
  ...draftFields,
  id: idSchema,
  museumId: idSchema,
  version: versionSchema,
  confirmedVersion: versionSchema.nullable(),
  confirmationNote: textSchema(1, 2_000).nullable(),
  confirmedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).refine((exhibit) => exhibit.confirmedVersion === null
  ? exhibit.confirmationNote === null && exhibit.confirmedAt === null
  : exhibit.confirmedVersion === exhibit.version && exhibit.confirmationNote !== null && exhibit.confirmedAt !== null,
  '确认记录必须完整并对应当前版本，失效后应清除。');

export const museumSummarySchema = z.strictObject({
  ...museumFields,
  id: idSchema,
  version: versionSchema,
  publishedVersion: versionSchema.nullable(),
  shareEnabled: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const museumDraftSchema = museumSummarySchema.extend({
  exhibits: z.array(exhibitDraftSchema).max(6)
    .refine((exhibits) => new Set(exhibits.map(({ slotIndex }) => slotIndex)).size === exhibits.length,
      '同一柜格不能放置多件展品。'),
});

export const publicExhibitSchema = z.strictObject({
  ...exhibitFields,
  id: idSchema,
  caption: textSchema(1, 120),
}).refine((exhibit) => exhibit.modelKey !== 'photo-plane' || exhibit.photoAssetId !== null,
  '实拍薄片展品必须关联展示图片。');

export const publicMuseumSchema = z.strictObject({
  ...museumFields,
  id: idSchema,
  version: versionSchema,
  publishedAt: timestampSchema,
  exhibits: z.array(publicExhibitSchema).min(1).max(6)
    .refine((exhibits) => new Set(exhibits.map(({ slotIndex }) => slotIndex)).size === exhibits.length,
      '同一柜格不能放置多件展品。')
    .refine((exhibits) => new Set(exhibits.map(({ id }) => id)).size === exhibits.length,
      '展品 ID 不得重复。'),
});

/** Explicit projection prevents internal text or future draft fields leaking. */
export function toPublicExhibit(exhibit: ExhibitDraft): PublicExhibit {
  return publicExhibitSchema.parse({
    id: exhibit.id,
    name: exhibit.name,
    era: exhibit.era,
    slotIndex: exhibit.slotIndex,
    modelKey: exhibit.modelKey,
    caption: exhibit.caption,
    photoAssetId: exhibit.photoAssetId,
    audioAssetId: exhibit.audioAssetId,
    approximation: exhibit.approximation,
    sourceNotice: exhibit.sourceNotice,
  });
}

export const museumListResponseSchema = successResponseSchema(z.array(museumSummarySchema));
export const museumDraftResponseSchema = successResponseSchema(museumDraftSchema);
export const exhibitDraftResponseSchema = successResponseSchema(exhibitDraftSchema);
export const publicMuseumResponseSchema = successResponseSchema(publicMuseumSchema);

export type CreateMuseumInput = z.infer<typeof createMuseumInputSchema>;
export type UpdateMuseumInput = z.infer<typeof updateMuseumInputSchema>;
export type VersionInput = z.infer<typeof versionInputSchema>;
export type CreateExhibitInput = z.infer<typeof createExhibitInputSchema>;
export type UpdateExhibitInput = z.infer<typeof updateExhibitInputSchema>;
export type ConfirmExhibitInput = z.infer<typeof confirmExhibitInputSchema>;
export type ExhibitDraft = z.infer<typeof exhibitDraftSchema>;
export type MuseumSummary = z.infer<typeof museumSummarySchema>;
export type MuseumDraft = z.infer<typeof museumDraftSchema>;
export type PublicExhibit = z.infer<typeof publicExhibitSchema>;
export type PublicMuseum = z.infer<typeof publicMuseumSchema>;
