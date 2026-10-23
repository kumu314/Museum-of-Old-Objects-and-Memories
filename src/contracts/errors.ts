import { z } from 'zod';
import { idSchema, textSchema } from './primitives';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'SHARE_NOT_FOUND',
  'VERSION_CONFLICT', 'NOT_CONFIRMED', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE',
  'AI_UNAVAILABLE', 'AI_TIMEOUT', 'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorHttpStatus = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SHARE_NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  NOT_CONFIRMED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  AI_UNAVAILABLE: 502,
  AI_TIMEOUT: 504,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

export const shareNotFoundMessage = '分享不可用或已停止。';

const commonFields = {
  message: textSchema(1, 240),
  requestId: textSchema(1, 128),
};

export const unconfirmedExhibitIdsSchema = z.array(idSchema).min(1).max(6)
  .refine((ids) => new Set(ids).size === ids.length, '未确认展品 ID 不得重复。');

export const apiErrorSchema = z.discriminatedUnion('code', [
  z.strictObject({
    ...commonFields,
    code: errorCodeSchema.exclude(['NOT_CONFIRMED']),
  }),
  z.strictObject({
    ...commonFields,
    code: z.literal('NOT_CONFIRMED'),
    details: z.strictObject({ unconfirmedExhibitIds: unconfirmedExhibitIdsSchema }),
  }),
]);

export const errorResponseSchema = z.strictObject({ error: apiErrorSchema });
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function successResponseSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data });
}
