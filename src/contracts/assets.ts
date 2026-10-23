import { z } from 'zod';
import { successResponseSchema } from './errors';
import { idSchema, textSchema, timestampSchema } from './primitives';

export const uploadLimits = {
  imageBytes: 10_485_760,
  audioBytes: 20_971_520,
  imageDimension: 8_192,
  imagePixels: 32_000_000,
} as const;

export const imageMediaTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const audioMediaTypeSchema = z.enum(['audio/mpeg', 'audio/mp4', 'audio/wav']);
export const assetKindSchema = z.enum(['image', 'audio']);

const assetFields = {
  id: idSchema,
  museumId: idSchema,
  byteSize: z.number().int().positive(),
  originalName: textSchema(1, 255),
  createdAt: timestampSchema,
};

// Only safe metadata crosses HTTP. Storage keys and original file paths stay server-side.
export const assetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...assetFields,
    kind: z.literal('image'),
    contentType: imageMediaTypeSchema,
    width: z.number().int().positive().max(uploadLimits.imageDimension),
    height: z.number().int().positive().max(uploadLimits.imageDimension),
  }).refine((asset) => asset.width * asset.height <= uploadLimits.imagePixels,
    '图片总像素不能超过 32000000。'),
  z.strictObject({
    ...assetFields,
    kind: z.literal('audio'),
    contentType: audioMediaTypeSchema,
  }),
]);

export const assetResponseSchema = successResponseSchema(assetSchema);
export type Asset = z.infer<typeof assetSchema>;
export type AssetKind = z.infer<typeof assetKindSchema>;
