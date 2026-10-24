import { z } from 'zod';
import { sourceSegmentsSchema } from './ai';
import { museumAccessModeSchema, regionCitySchema } from './discovery';
import { modelInputSchema } from './model-generation';
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
  modelInput: modelInputSchema,
  rawStory: z.string().refine((value) => Array.from(value).length <= 12_000, '原始讲述不能超过 12000 字。'),
  transcript: z.string().refine((value) => Array.from(value).length <= 12_000, '录音整理文本不能超过 12000 字。').nullable(),
  sourceSegments: sourceSegmentsSchema,
};

export const createMuseumInputSchema = z.strictObject(museumFields);
/**
 * `regionCity` 是新增的可选属性，因此是 `optional` 而不是必填：
 * 老客户端整份保存时不会带它，语义是"不改动已选城市"；
 * 要清空必须显式传 `null`。这样不会因为加了一个展示属性就让所有旧保存失败。
 */
export const updateMuseumInputSchema = z.strictObject({
  ...museumFields,
  regionCity: regionCitySchema.nullable().optional(),
  discoveryListed: z.boolean().optional(),
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

export function missingDisplayPhoto(exhibit: Pick<CreateExhibitInput, 'modelKey' | 'photoAssetId'>): boolean {
  return exhibit.modelKey === 'photo-plane' && exhibit.photoAssetId === null;
}
export const displayPhotoRequiredMessage = '实拍照片平面展示需要图片，请先上传并保存实拍照片，再确认和发布。';

export const confirmExhibitInputSchema = z.strictObject({
  expectedVersion: versionSchema,
  confirmationNote: textSchema(1, 2_000),
});

export const exhibitDraftSchema = z.strictObject({
  ...draftFields,
  id: idSchema,
  museumId: idSchema,
  // 工作台展柜优先渲染已采纳的生成模型；公开参观页在快照支持模型前仍用照片。
  generatedModelAssetId: idSchema.nullable(),
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
  accessMode: museumAccessModeSchema,
  accessEpoch: idSchema.nullable(),
  /**
   * 地区只到城市一级，`null` 表示馆主未标注：不参与地图聚合，但仍可出现在榜单里。
   * 这里**不进** `publicMuseumSchema`（发布快照）：位置是馆的属性，不是某一版内容的属性，
   * 改城市不该要求重新发布，也不该让旧快照带着过期城市。
   */
  regionCity: regionCitySchema.nullable(),
  discoveryListed: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const museumDraftSchema = museumSummarySchema.extend({
  exhibits: z.array(exhibitDraftSchema)
    .refine((exhibits) => new Set(exhibits.map(({ slotIndex }) => slotIndex)).size === exhibits.length,
      '同一柜格不能放置多件展品。'),
});

export const publicExhibitSchema = z.strictObject({
  ...exhibitFields,
  id: idSchema,
  caption: textSchema(1, 120),
}).refine((exhibit) => !missingDisplayPhoto(exhibit), { message: displayPhotoRequiredMessage, path: ['photoAssetId'] });

export const publicMuseumSchema = z.strictObject({
  ...museumFields,
  id: idSchema,
  version: versionSchema,
  publishedAt: timestampSchema,
  exhibits: z.array(publicExhibitSchema).min(1)
    .refine((exhibits) => new Set(exhibits.map(({ slotIndex }) => slotIndex)).size === exhibits.length,
      '同一柜格不能放置多件展品。')
    .refine((exhibits) => new Set(exhibits.map(({ id }) => id)).size === exhibits.length,
      '展品 ID 不得重复。'),
});

/** Explicit projection prevents internal text or future draft fields leaking. */
function displayExhibit(exhibit: ExhibitDraft): PublicExhibit {
  return {
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
  };
}
export function toPublicExhibit(exhibit: ExhibitDraft): PublicExhibit {
  return publicExhibitSchema.parse(displayExhibit(exhibit));
}

// Owner previews allow incomplete captions/photos but serialize the same narrow
// set of presentation fields, never stories, confirmation notes or model inputs.
export type MuseumDisplayData = Pick<PublicMuseum, 'id' | 'title' | 'description' | 'version' | 'exhibits'>;
export function toMuseumDisplay(museum: MuseumDraft): MuseumDisplayData {
  return { id: museum.id, title: museum.title, description: museum.description, version: museum.version, exhibits: museum.exhibits.map(displayExhibit) };
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
