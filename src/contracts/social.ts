import { z } from 'zod';
import { discoveryCursorSchema, publicAuthorSchema } from './discovery';
import { idSchema, textSchema, timestampSchema, versionedOperationInputSchema, versionSchema } from './primitives';
import { successResponseSchema } from './errors';

const commentFields = {
  id: idSchema,
  museumId: idSchema,
  author: publicAuthorSchema,
  rootId: idSchema.nullable(),
  replyToId: idSchema.nullable(),
  version: versionSchema,
  createdAt: timestampSchema,
};
export const commentBodySchema = textSchema(1, 2_000);
const visibleCommentSchema = z.strictObject({ ...commentFields, status: z.literal('visible'), body: commentBodySchema });
const deletedCommentSchema = z.strictObject({ ...commentFields, status: z.literal('deleted') });
const hiddenCommentSchema = z.strictObject({ ...commentFields, status: z.literal('hidden'), body: commentBodySchema });
const hiddenDeletedCommentSchema = z.strictObject({ ...commentFields, status: z.literal('hidden_deleted') });
export const commentStatusSchema = z.enum(['visible', 'hidden', 'deleted', 'hidden_deleted']);
export function commentIsHidden(status: z.infer<typeof commentStatusSchema>): boolean {
  return status === 'hidden' || status === 'hidden_deleted';
}
export function deletedCommentStatus(status: z.infer<typeof commentStatusSchema>) {
  return commentIsHidden(status) ? 'hidden_deleted' as const : 'deleted' as const;
}
export function moderatedCommentStatus(status: z.infer<typeof commentStatusSchema>, hidden: boolean) {
  const deleted = status === 'deleted' || status === 'hidden_deleted';
  return hidden ? (deleted ? 'hidden_deleted' as const : 'hidden' as const)
    : (deleted ? 'deleted' as const : 'visible' as const);
}
function validReply(comment: { id: string; rootId: string | null; replyToId: string | null }): boolean {
  return comment.rootId === null ? comment.replyToId === null
    : comment.rootId !== comment.id && comment.replyToId !== null && comment.replyToId !== comment.id;
}
export const publicCommentSchema = z.discriminatedUnion('status', [visibleCommentSchema, deletedCommentSchema])
  .refine(validReply, '回复必须引用根线程及所回应留言，且不能引用自己。');
export const managedCommentSchema = z.discriminatedUnion('status', [visibleCommentSchema, deletedCommentSchema, hiddenCommentSchema, hiddenDeletedCommentSchema])
  .refine(validReply, '回复必须引用根线程及所回应留言，且不能引用自己。');
export const createCommentInputSchema = z.strictObject({
  operationId: idSchema,
  accessEpoch: idSchema,
  rootId: idSchema.nullable(),
  replyToId: idSchema.nullable(),
  body: commentBodySchema,
}).refine((input) => (input.rootId === null) === (input.replyToId === null), '回复必须同时指定线程和回应对象。');
export const commentSettingsSchema = z.strictObject({
  museumId: idSchema,
  mode: z.enum(['open', 'closed']),
  version: versionSchema,
});
export const updateCommentSettingsInputSchema = versionedOperationInputSchema.extend({ mode: commentSettingsSchema.shape.mode });
export const moderateCommentInputSchema = versionedOperationInputSchema.extend({ action: z.enum(['hide', 'restore']) });
export const commentBanInputSchema = z.strictObject({ operationId: idSchema, targetCommentId: idSchema });
export const commentPageSchema = z.strictObject({
  items: z.array(publicCommentSchema).max(100),
  mode: commentSettingsSchema.shape.mode,
  canComment: z.boolean(),
  nextCursor: discoveryCursorSchema.nullable(),
});
export const commentListInputSchema = z.strictObject({ cursor: discoveryCursorSchema.nullable(), limit: z.number().int().min(1).max(100) });
export const managedCommentPageSchema = z.strictObject({ items: z.array(managedCommentSchema).max(100), nextCursor: discoveryCursorSchema.nullable() });
export const commentResponseSchema = successResponseSchema(publicCommentSchema);
export const commentPageResponseSchema = successResponseSchema(commentPageSchema);
export type PublicComment = z.infer<typeof publicCommentSchema>;
export type ManagedComment = z.infer<typeof managedCommentSchema>;
export type CommentSettings = z.infer<typeof commentSettingsSchema>;
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
export type CommentListInput = z.infer<typeof commentListInputSchema>;
export type UpdateCommentSettingsInput = z.infer<typeof updateCommentSettingsInputSchema>;
export type ModerateCommentInput = z.infer<typeof moderateCommentInputSchema>;
export type CommentBanInput = z.infer<typeof commentBanInputSchema>;
