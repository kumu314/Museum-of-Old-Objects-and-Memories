import { z } from 'zod';
import { idSchema, textSchema } from './primitives';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'SHARE_NOT_FOUND',
  'VERSION_CONFLICT', 'MUSEUM_EXISTS', 'NOT_CONFIRMED', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE',
  'AI_UNAVAILABLE', 'AI_TIMEOUT', 'GENERATION_UNAVAILABLE', 'INTERNAL_ERROR',
  'DEMO_ONLY', 'COMMENTS_CLOSED', 'COMMENTING_BLOCKED', 'THREAD_UNAVAILABLE',
  'MEMOIR_NOT_CONFIRMED', 'INTERVIEW_STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT',
  'AI_OUTCOME_UNKNOWN', 'INTERVIEW_QUOTA_EXHAUSTED', 'GENERATION_QUOTA_EXHAUSTED', 'RATE_LIMITED',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorHttpStatus = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SHARE_NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  MUSEUM_EXISTS: 409,
  NOT_CONFIRMED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  AI_UNAVAILABLE: 502,
  AI_TIMEOUT: 504,
  GENERATION_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
  DEMO_ONLY: 403,
  COMMENTS_CLOSED: 403,
  COMMENTING_BLOCKED: 403,
  THREAD_UNAVAILABLE: 409,
  MEMOIR_NOT_CONFIRMED: 409,
  INTERVIEW_STATE_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  AI_OUTCOME_UNKNOWN: 409,
  INTERVIEW_QUOTA_EXHAUSTED: 403,
  GENERATION_QUOTA_EXHAUSTED: 429,
  RATE_LIMITED: 429,
} as const satisfies Record<ErrorCode, number>;

export const shareNotFoundMessage = '分享不可用或已停止。';

const commonFields = {
  message: textSchema(1, 240),
  requestId: textSchema(1, 128),
};

export const unconfirmedExhibitIdsSchema = z.array(idSchema).min(1)
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
