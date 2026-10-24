import { z } from 'zod';
import { successResponseSchema } from './errors';
import { idSchema, textSchema, versionSchema } from './primitives';

export const loginInputSchema = z.strictObject({
  username: textSchema(1, 80),
  // Passwords are not trimmed; spaces can be part of the credential.
  password: z.string().min(1).max(256),
});

/**
 * 自助注册比登录更严：登录要兼容历史账号，注册只约束新账号。
 * 用户名不允许空白，避免出现肉眼无法区分、也无法可靠输入的账号。
 */
export const registerUsernameSchema = textSchema(3, 40)
  .refine((value) => !/\s/.test(value), '用户名不能包含空格。');
export const registerInputSchema = z.strictObject({
  username: registerUsernameSchema,
  password: z.string().min(12, '密码至少 12 个字符。').max(256),
});
export const teamMemberSchema = z.strictObject({
  id: idSchema,
  username: textSchema(1, 80),
});
export const sessionResponseSchema = successResponseSchema(teamMemberSchema);
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
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type PublishResult = z.infer<typeof publishResultSchema>;
