import { z } from 'zod';
import { successResponseSchema } from './errors';
import { idSchema, textSchema, versionSchema } from './primitives';

export const loginInputSchema = z.strictObject({
  username: textSchema(1, 80),
  // Passwords are not trimmed; spaces can be part of the credential.
  password: z.string().min(1).max(256),
});
// Registration is the self-service entry (方案 B): users create their own
// accounts, so the name rules here are stricter than the legacy 1–80 column.
export const registerInputSchema = z.strictObject({
  username: z.string().trim().min(2, '用户名至少 2 个字符。').max(40)
    .regex(/^[\p{L}\p{N}_-]+$/u, '用户名只能包含文字、数字、下划线或连字符。'),
  password: z.string().min(8, '密码至少 8 位。').max(256),
});
export const sessionUserSchema = z.strictObject({
  id: idSchema,
  username: textSchema(1, 80),
});
export const sessionResponseSchema = successResponseSchema(sessionUserSchema);
export const mutationSuccessSchema = successResponseSchema(z.strictObject({ ok: z.literal(true) }));

export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, '分享标识无效。');
export const publishResultSchema = z.strictObject({
  museumId: idSchema,
  snapshotId: idSchema,
  version: versionSchema,
  token: shareTokenSchema.nullable(),
});
export const publishResponseSchema = successResponseSchema(publishResultSchema);
export const shareLinkResponseSchema = successResponseSchema(z.strictObject({ token: shareTokenSchema }));
export const healthResponseSchema = successResponseSchema(z.strictObject({
  status: z.literal('ok'),
  database: z.literal('ok'),
  storage: z.literal('ok'),
}));

export type LoginInput = z.infer<typeof loginInputSchema>;
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type PublishResult = z.infer<typeof publishResultSchema>;
