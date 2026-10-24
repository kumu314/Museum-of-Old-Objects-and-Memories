import { z } from 'zod';
import { demoFixtureSchema, discoveryMuseumSchema, museumAccessModeSchema, museumTagsSchema, publicAuthorSchema } from './discovery';
import { idSchema, timestampSchema, versionSchema } from './primitives';
import {
  interviewQuestionSchema, interviewSessionSchema, memoirAnswerRevisionSchema, memoirAnswerTextSchema,
  memoirChapterConfirmationSchema, memoirChapterDraftSchema, memoirChapterPublicationSchema,
  memoirChapterRevisionSchema, memoirChapterSchema, memoirParagraphsSchema, memoirReferencesAreValid, memoirSchema, memoirTitleSchema,
} from './memoir';
import { commentSettingsSchema, managedCommentSchema } from './social';

export const memoirDemoWorkspaceSchema = z.strictObject({
  memoir: memoirSchema,
  sourceVersion: versionSchema,
  currentSessionId: idSchema,
  sessions: z.array(interviewSessionSchema).min(1).max(4),
  questions: z.array(interviewQuestionSchema),
  answers: z.array(memoirAnswerRevisionSchema),
  chapter: memoirChapterSchema,
  drafts: z.array(memoirChapterDraftSchema),
  revisions: z.array(memoirChapterRevisionSchema),
  confirmations: z.array(memoirChapterConfirmationSchema),
  publications: z.array(memoirChapterPublicationSchema),
  interviewQuotaRemaining: z.number().int().nonnegative().max(100),
}).superRefine((workspace, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  const unique = (items: ReadonlyArray<{ id: string }>) => new Set(items.map(({ id }) => id)).size === items.length;
  if (![workspace.sessions, workspace.questions, workspace.answers, workspace.drafts, workspace.revisions,
    workspace.confirmations, workspace.publications].every(unique)) fail('演示资料中的记录 ID 不得重复。');
  if (workspace.chapter.memoirId !== workspace.memoir.id
    || workspace.sessions.some((session) => session.memoirId !== workspace.memoir.id)
    || workspace.answers.some((answer) => answer.memoirId !== workspace.memoir.id)) fail('演示资料不能混入其他自传。');
  const sessions = new Map(workspace.sessions.map((session) => [session.id, session]));
  const questions = new Map(workspace.questions.map((question) => [question.id, question]));
  if (!sessions.has(workspace.currentSessionId)
    || workspace.sessions.filter(({ state }) => state === 'active').length > 1
    || workspace.sessions.some((session) => session.state === 'active' && session.id !== workspace.currentSessionId)
    || new Set(workspace.sessions.map((session) => session.topic.id)).size !== workspace.sessions.length) fail('演示访谈的当前话题不一致。');
  for (const question of workspace.questions) {
    if (sessions.get(question.sessionId)?.topic.id !== question.topicId) fail('问题不属于所引用的话题。');
  }
  for (const session of workspace.sessions) {
    if (session.currentQuestionId !== null && questions.get(session.currentQuestionId)?.sessionId !== session.id) fail('当前问题不属于此访谈。');
  }
  for (const answer of workspace.answers) {
    if (answer.questionId !== null && questions.get(answer.questionId)?.sessionId !== answer.sessionId) fail('回答不属于所引用的问题。');
  }
  for (const draft of workspace.drafts) {
    if (draft.memoirId !== workspace.memoir.id || draft.chapterId !== workspace.chapter.id
      || draft.sourceVersion > workspace.sourceVersion || !memoirReferencesAreValid(draft.output.paragraphs, workspace.answers)) fail('样例草稿的章节或来源不一致。');
  }
  for (const revision of workspace.revisions) {
    if (revision.chapterId !== workspace.chapter.id || revision.sourceVersion > workspace.sourceVersion
      || !memoirReferencesAreValid(revision.paragraphs, workspace.answers)
      || (revision.derivedFromDraftId !== null && !workspace.drafts.some((draft) => draft.id === revision.derivedFromDraftId))) fail('编辑稿的章节或来源不一致。');
  }
  const revisions = new Map(workspace.revisions.map((revision) => [revision.id, revision]));
  if (workspace.chapter.currentRevisionId !== null && !revisions.has(workspace.chapter.currentRevisionId)) fail('当前编辑稿不存在。');
  for (const confirmation of workspace.confirmations) {
    if (confirmation.chapterId !== workspace.chapter.id || confirmation.confirmedBy !== workspace.memoir.ownerId
      || revisions.get(confirmation.revisionId)?.sourceVersion !== confirmation.sourceVersion) fail('确认记录不属于当前自传的编辑版本。');
  }
  for (const publication of workspace.publications) {
    const revision = revisions.get(publication.confirmedRevisionId);
    if (publication.chapterId !== workspace.chapter.id
      || !workspace.confirmations.some((confirmation) => confirmation.id === publication.confirmationId && confirmation.revisionId === publication.confirmedRevisionId)
      || revision?.title !== publication.publicData.title
      || JSON.stringify(revision.paragraphs.map(({ text }) => text)) !== JSON.stringify(publication.publicData.paragraphs)) fail('公开快照与授权的编辑版本不一致。');
  }
  if (workspace.publications.filter((publication) => publication.revokedAt === null).length > 1) fail('同一演示章节只能有一份当前公开许可。');
});
export const memoirDemoStateSchema = demoFixtureSchema(z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ready'), workspace: memoirDemoWorkspaceSchema }),
  z.strictObject({ state: z.literal('deleted'), deletedAt: timestampSchema }),
]));
const actionFields = { expectedVersion: versionSchema };
export const memoirDemoActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...actionFields, type: z.literal('save_answer'), text: memoirAnswerTextSchema }),
  z.strictObject({ ...actionFields, type: z.literal('followup_fixture') }),
  z.strictObject({ ...actionFields, type: z.literal('pause') }),
  z.strictObject({ ...actionFields, type: z.literal('resume') }),
  z.strictObject({ ...actionFields, type: z.literal('skip') }),
  z.strictObject({ ...actionFields, type: z.literal('refuse') }),
  z.strictObject({ ...actionFields, type: z.literal('next') }),
  z.strictObject({ ...actionFields, type: z.literal('select_topic'), topicIndex: z.number().int().min(0).max(3) }),
  z.strictObject({ ...actionFields, type: z.literal('chapter_fixture'), sourceVersion: versionSchema }),
  z.strictObject({ ...actionFields, type: z.literal('save_chapter'), title: memoirTitleSchema, paragraphs: memoirParagraphsSchema,
    derivedFromDraftId: idSchema.nullable(), sourceVersion: versionSchema }),
  z.strictObject({ ...actionFields, type: z.literal('confirm_chapter'), revisionId: idSchema, reviewedSources: z.literal(true) }),
  z.strictObject({ ...actionFields, type: z.literal('publish_chapter'), confirmationId: idSchema,
    privacyAcknowledged: z.literal(true), authorizePublicChapter: z.literal(true) }),
  z.strictObject({ ...actionFields, type: z.literal('revoke_chapter') }),
  z.strictObject({ ...actionFields, type: z.literal('exhaust_demo_quota') }),
  z.strictObject({ ...actionFields, type: z.literal('delete_memoir'), confirmOnlineDeletion: z.literal(true) }),
]);
export const discoveryDemoMuseumSchema = z.strictObject({
  published: discoveryMuseumSchema,
  accessMode: museumAccessModeSchema,
  draftTitle: memoirTitleSchema,
  draftTags: museumTagsSchema,
  comments: z.array(managedCommentSchema),
  settings: commentSettingsSchema,
  bannedUserIds: z.array(idSchema),
});
export const discoveryDemoStateSchema = demoFixtureSchema(z.strictObject({
  viewer: publicAuthorSchema,
  museums: z.array(discoveryDemoMuseumSchema),
  follows: z.array(z.strictObject({ followerId: idSchema, followedUserId: idSchema })),
  favorites: z.array(z.strictObject({ userId: idSchema, museumId: idSchema })),
}));
export const discoveryDemoActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('switch_actor'), userId: idSchema }),
  z.strictObject({ type: z.literal('follow'), userId: idSchema, following: z.boolean() }),
  z.strictObject({ type: z.literal('favorite'), museumId: idSchema, favorited: z.boolean() }),
  z.strictObject({ type: z.literal('comment'), museumId: idSchema, accessEpoch: idSchema,
    body: z.string(), rootId: idSchema.nullable(), replyToId: idSchema.nullable() }),
  z.strictObject({ type: z.literal('delete_comment'), museumId: idSchema, commentId: idSchema, expectedVersion: versionSchema }),
  z.strictObject({ type: z.literal('moderate_comment'), museumId: idSchema, commentId: idSchema,
    expectedVersion: versionSchema, status: z.enum(['hidden', 'visible']) }),
  z.strictObject({ type: z.literal('comment_mode'), museumId: idSchema, expectedVersion: versionSchema,
    mode: commentSettingsSchema.shape.mode }),
  z.strictObject({ type: z.literal('ban'), museumId: idSchema, commentId: idSchema, banned: z.boolean() }),
  z.strictObject({ type: z.literal('access'), museumId: idSchema, accessMode: museumAccessModeSchema }),
]);

export type MemoirDemoState = z.infer<typeof memoirDemoStateSchema>;
export type MemoirDemoWorkspace = z.infer<typeof memoirDemoWorkspaceSchema>;
export type MemoirDemoAction = z.infer<typeof memoirDemoActionSchema>;
export type DiscoveryDemoState = z.infer<typeof discoveryDemoStateSchema>;
export type DiscoveryDemoMuseum = z.infer<typeof discoveryDemoMuseumSchema>;
export type DiscoveryDemoAction = z.infer<typeof discoveryDemoActionSchema>;
