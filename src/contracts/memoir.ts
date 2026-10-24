import { z } from 'zod';
import { idSchema, textSchema, timestampSchema, versionedOperationInputSchema, versionSchema } from './primitives';
import { successResponseSchema } from './errors';

// Source offsets refer to original Unicode code points, so never trim these values.
const originalText = (max: number) => z.string().refine(
  (value) => value.trim().length > 0 && Array.from(value).length <= max,
  `请输入非空正文，最多 ${max} 个字符。`,
);
const uniqueIds = z.array(idSchema).max(100).refine(
  (ids) => new Set(ids).size === ids.length, '标识不得重复。',
);
export const memoirAnswerTextSchema = originalText(6_000);
export const interviewQuestionTextSchema = originalText(300).refine(
  (text) => (text.match(/[?？]/gu)?.length ?? 0) <= 1, '每轮只提供一个问题。',
);
export const memoirTitleSchema = textSchema(1, 120);
export const memoirSchema = z.strictObject({
  id: idSchema,
  ownerId: idSchema,
  museumId: idSchema.nullable(),
  title: memoirTitleSchema,
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const createMemoirInputSchema = z.strictObject({
  operationId: idSchema,
  title: memoirTitleSchema,
  museumId: idSchema.nullable(),
});
export const memoirMutationInputSchema = versionedOperationInputSchema;
export const deleteMemoirInputSchema = memoirMutationInputSchema.extend({
  confirmOnlineDeletion: z.literal(true),
});
export const memoirExportFormatSchema = z.enum(['markdown', 'json']);

export const interviewTopicSchema = z.strictObject({
  id: idSchema,
  title: textSchema(1, 80),
  disposition: z.enum(['open', 'skipped', 'refused', 'completed']),
});
export const interviewQuestionSchema = z.strictObject({
  id: idSchema,
  sessionId: idSchema,
  topicId: idSchema,
  kind: z.enum(['opening', 'followup']),
  text: interviewQuestionTextSchema,
  basedOnAnswerRevisionIds: uniqueIds,
  createdAt: timestampSchema,
}).refine((question) => question.kind === 'opening'
  ? question.basedOnAnswerRevisionIds.length === 0
  : question.basedOnAnswerRevisionIds.length > 0, '追问必须有来源，开场不引用回答。');
const sessionFields = {
  id: idSchema,
  memoirId: idSchema,
  topic: interviewTopicSchema,
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};
export const interviewSessionSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...sessionFields, state: z.literal('active'), currentQuestionId: idSchema }),
  z.strictObject({ ...sessionFields, state: z.literal('paused'), currentQuestionId: idSchema.nullable() }),
  z.strictObject({ ...sessionFields, state: z.literal('completed'), currentQuestionId: z.null() }),
]).refine((session) => session.state !== 'active' || session.topic.disposition === 'open',
  '跳过、拒绝或完成的话题不能处于继续追问状态。');
export const memoirAnswerRevisionSchema = z.strictObject({
  id: idSchema,
  answerId: idSchema,
  memoirId: idSchema,
  sessionId: idSchema.nullable(),
  questionId: idSchema.nullable(),
  revision: versionSchema,
  kind: z.enum(['interview', 'user_supplement']),
  text: memoirAnswerTextSchema,
  createdAt: timestampSchema,
}).refine((answer) => answer.kind === 'interview'
  ? answer.sessionId !== null && answer.questionId !== null
  : answer.sessionId === null && answer.questionId === null, '补充资料与访谈回答须明确区分。');
export const saveInterviewAnswerInputSchema = memoirMutationInputSchema.extend({
  questionId: idSchema,
  answerId: idSchema.nullable(),
  text: memoirAnswerTextSchema,
});
export const saveMemoirSupplementInputSchema = memoirMutationInputSchema.extend({
  answerId: idSchema.nullable(),
  text: memoirAnswerTextSchema,
});
export const interviewActionSchema = z.enum(['next', 'skip', 'refuse', 'pause', 'resume', 'complete']);
export const interviewActionInputSchema = memoirMutationInputSchema.extend({ action: interviewActionSchema });

export const memoirSourceRefSchema = z.strictObject({
  answerRevisionId: idSchema,
  start: z.number().int().nonnegative().max(6_000),
  end: z.number().int().positive().max(6_000),
}).refine((ref) => ref.start < ref.end, '来源必须引用非空片段。');
const sourceRefsSchema = z.array(memoirSourceRefSchema).min(1).max(40).refine(
  (refs) => new Set(refs.map((ref) => `${ref.answerRevisionId}:${ref.start}:${ref.end}`)).size === refs.length,
  '同一段落的来源片段不得重复。',
);
export const memoirParagraphSchema = z.strictObject({
  id: idSchema,
  text: originalText(1_000),
  sources: sourceRefsSchema,
});
export const memoirParagraphsSchema = z.array(memoirParagraphSchema).min(1).max(40)
  .refine((paragraphs) => new Set(paragraphs.map(({ id }) => id)).size === paragraphs.length, '段落 ID 不得重复。')
  .refine((paragraphs) => paragraphs.reduce((size, paragraph) => size + Array.from(paragraph.text).length, 0) <= 20_000,
    '章节正文最多 20000 个字符。');

export const memoirAiInputSchema = z.strictObject({
  memoirId: idSchema,
  sourceVersion: versionSchema,
  sources: z.array(memoirAnswerRevisionSchema).min(1).max(100),
}).superRefine((input, ctx) => {
  if (input.sources.some((source) => source.memoirId !== input.memoirId)) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: '不能引用其他自传的回答。' });
  }
  if (new Set(input.sources.map(({ id }) => id)).size !== input.sources.length) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: '回答版本不得重复。' });
  }
  if (input.sources.reduce((total, source) => total + Array.from(source.text).length, 0) > 12_000) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: '单次整理来源最多 12000 个字符。' });
  }
});

// Valid references establish traceability, not the truth of the generated prose.
export function memoirReferencesAreValid(paragraphs: ReadonlyArray<MemoirParagraph>, sources: ReadonlyArray<MemoirAnswerRevision>): boolean {
  const lengths = new Map(sources.map((source) => [source.id, Array.from(source.text).length]));
  return paragraphs.every((paragraph) => paragraph.sources.every((ref) => {
    const length = lengths.get(ref.answerRevisionId);
    return length !== undefined && ref.start >= 0 && ref.start < ref.end && ref.end <= length;
  }));
}
export function memoirParagraphsForSourcesSchema(input: MemoirAiInput) {
  const validated = memoirAiInputSchema.parse(input);
  return memoirParagraphsSchema.refine((paragraphs) => memoirReferencesAreValid(paragraphs, validated.sources),
    '引用必须属于本次选中的回答版本，且不能超过原文码点范围。');
}
export const memoirChapterOutputSchema = z.strictObject({
  title: memoirTitleSchema,
  paragraphs: memoirParagraphsSchema,
});
export function memoirChapterOutputForSourcesSchema(input: MemoirAiInput) {
  return memoirChapterOutputSchema.extend({ paragraphs: memoirParagraphsForSourcesSchema(input) });
}
export const interviewFollowupOutputSchema = z.strictObject({
  question: z.strictObject({
    text: interviewQuestionTextSchema,
    basedOnAnswerRevisionIds: uniqueIds.refine((ids) => ids.length > 0, '追问必须引用回答。'),
  }).nullable(),
});
export const memoirFollowupContextSchema = z.strictObject({
  topicTitle: textSchema(1, 80),
  currentQuestionText: interviewQuestionTextSchema,
  answeredQuestionTexts: z.array(interviewQuestionTextSchema).max(20),
});
export function interviewFollowupForSourcesSchema(input: MemoirAiInput) {
  const validated = memoirAiInputSchema.parse(input);
  const allowed = new Set(validated.sources.map(({ id }) => id));
  return interviewFollowupOutputSchema.refine((output) => output.question === null
    || output.question.basedOnAnswerRevisionIds.every((id) => allowed.has(id)), '追问引用了未选中的回答版本。');
}

export const memoirChapterDraftSchema = z.strictObject({
  id: idSchema,
  memoirId: idSchema,
  chapterId: idSchema,
  sourceVersion: versionSchema,
  generation: z.enum(['fixture', 'provider']),
  aiOperationId: idSchema.nullable(),
  output: memoirChapterOutputSchema,
  createdAt: timestampSchema,
}).refine((draft) => draft.generation === 'fixture' ? draft.aiOperationId === null : draft.aiOperationId !== null,
  '真实生成必须关联持久化操作；fixture 不得冒充服务调用。');
export const memoirChapterRevisionSchema = z.strictObject({
  id: idSchema,
  chapterId: idSchema,
  version: versionSchema,
  sourceVersion: versionSchema,
  title: memoirTitleSchema,
  paragraphs: memoirParagraphsSchema,
  derivedFromDraftId: idSchema.nullable(),
  createdAt: timestampSchema,
});
export const saveMemoirChapterInputSchema = memoirMutationInputSchema.extend({
  expectedSourceVersion: versionSchema,
  title: memoirTitleSchema,
  paragraphs: memoirParagraphsSchema,
  derivedFromDraftId: idSchema.nullable(),
});
export const memoirChapterConfirmationSchema = z.strictObject({
  id: idSchema,
  chapterId: idSchema,
  revisionId: idSchema,
  sourceVersion: versionSchema,
  confirmedBy: idSchema,
  confirmedAt: timestampSchema,
});
export const memoirChapterSchema = z.strictObject({
  id: idSchema,
  memoirId: idSchema,
  title: memoirTitleSchema,
  version: versionSchema,
  currentRevisionId: idSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const confirmMemoirChapterInputSchema = memoirMutationInputSchema.extend({
  revisionId: idSchema,
  expectedSourceVersion: versionSchema,
  reviewedSources: z.literal(true),
});
export const grantMemoirPublicationInputSchema = memoirMutationInputSchema.extend({
  confirmationId: idSchema,
  privacyAcknowledged: z.literal(true),
  authorizePublicChapter: z.literal(true),
});
export const publicMemoirChapterSchema = z.strictObject({
  publicationId: idSchema,
  chapterId: idSchema,
  title: memoirTitleSchema,
  paragraphs: z.array(originalText(1_000)).min(1).max(40)
    .refine((paragraphs) => paragraphs.reduce((total, paragraph) => total + Array.from(paragraph).length, 0) <= 20_000,
      '公开章节正文最多 20000 个字符。'),
  publishedAt: timestampSchema,
});
export const memoirChapterPublicationSchema = z.strictObject({
  id: idSchema,
  chapterId: idSchema,
  confirmedRevisionId: idSchema,
  confirmationId: idSchema,
  consentVersion: versionSchema,
  privacyAcknowledgedAt: timestampSchema,
  grantedAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
  publicData: publicMemoirChapterSchema,
}).refine((publication) => publication.id === publication.publicData.publicationId
  && publication.chapterId === publication.publicData.chapterId, '公开投影须属于同一章节和许可。');

export const memoirAiOperationSchema = z.strictObject({
  id: idSchema,
  memoirId: idSchema,
  kind: z.enum(['followup', 'chapter']),
  targetId: idSchema,
  sourceVersion: versionSchema,
  state: z.enum(['prepared', 'sending', 'succeeded', 'failed', 'unknown', 'superseded']),
  generation: z.enum(['fixture', 'provider']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const requestMemoirAiInputSchema = memoirMutationInputSchema.extend({
  sourceVersion: versionSchema,
  answerRevisionIds: uniqueIds.refine((ids) => ids.length > 0, '请选择回答。'),
  providerTransferConsent: z.literal(true),
});

// These original opening prompts are static product content, never AI results.
export const memoirTopicKeySchema = z.enum(['childhood', 'school', 'work', 'legacy']);
export const memoirOpeningTopics = {
  childhood: { title: '童年住处', question: '你愿意讲讲童年住处的一处细节吗？' },
  school: { title: '求学片段', question: '有没有一段求学经历是你愿意记录的？' },
  work: { title: '工作与手艺', question: '你愿意从哪一件做过的事情讲起？' },
  legacy: { title: '愿意留下的话', question: '此刻有什么是你愿意留下的？' },
} as const satisfies Record<z.infer<typeof memoirTopicKeySchema>, { title: string; question: string }>;
export const startMemoirInterviewInputSchema = memoirMutationInputSchema.extend({ topicKey: memoirTopicKeySchema });
export const createMemoirChapterInputSchema = memoirMutationInputSchema.extend({ title: memoirTitleSchema });
export const onlineMemoirSchema = z.strictObject({ memoir: memoirSchema, sourceVersion: versionSchema });
export const memoirPageInputSchema = z.strictObject({
  cursor: idSchema.nullable().default(null),
  limit: z.number().int().min(1).max(100).default(50),
});
export const memoirChapterHistoryKindSchema = z.enum(['draft', 'revision', 'confirmation', 'publication']);
export const memoirExportQuerySchema = z.strictObject({ format: memoirExportFormatSchema });
export function memoirPageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), nextCursor: idSchema.nullable() });
}
export const memoirExportSchema = z.strictObject({
  formatVersion: z.literal(1), provenance: z.literal('synthetic_online_demo'),
  exportedAt: timestampSchema, ...onlineMemoirSchema.shape,
  sessions: z.array(interviewSessionSchema), questions: z.array(interviewQuestionSchema),
  answers: z.array(memoirAnswerRevisionSchema), chapters: z.array(memoirChapterSchema),
  drafts: z.array(memoirChapterDraftSchema), revisions: z.array(memoirChapterRevisionSchema),
  confirmations: z.array(memoirChapterConfirmationSchema), publications: z.array(memoirChapterPublicationSchema),
  aiOperations: z.array(memoirAiOperationSchema),
});
export type CreateMemoirInput = z.infer<typeof createMemoirInputSchema>;
export type DeleteMemoirInput = z.infer<typeof deleteMemoirInputSchema>;
export type StartMemoirInterviewInput = z.infer<typeof startMemoirInterviewInputSchema>;
export type SaveInterviewAnswerInput = z.infer<typeof saveInterviewAnswerInputSchema>;
export type SaveMemoirSupplementInput = z.infer<typeof saveMemoirSupplementInputSchema>;
export type InterviewActionInput = z.infer<typeof interviewActionInputSchema>;
export type CreateMemoirChapterInput = z.infer<typeof createMemoirChapterInputSchema>;
export type SaveMemoirChapterInput = z.infer<typeof saveMemoirChapterInputSchema>;
export type ConfirmMemoirChapterInput = z.infer<typeof confirmMemoirChapterInputSchema>;
export type GrantMemoirPublicationInput = z.infer<typeof grantMemoirPublicationInputSchema>;
export type MemoirPageInput = z.infer<typeof memoirPageInputSchema>;
export type MemoirExport = z.infer<typeof memoirExportSchema>;
export const memoirResponseSchema = successResponseSchema(memoirSchema);
export const memoirChapterResponseSchema = successResponseSchema(publicMemoirChapterSchema);

export type Memoir = z.infer<typeof memoirSchema>;
export type InterviewTopic = z.infer<typeof interviewTopicSchema>;
export type InterviewSession = z.infer<typeof interviewSessionSchema>;
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type InterviewAction = z.infer<typeof interviewActionSchema>;
export type MemoirAnswerRevision = z.infer<typeof memoirAnswerRevisionSchema>;
export type MemoirSourceRef = z.infer<typeof memoirSourceRefSchema>;
export type MemoirParagraph = z.infer<typeof memoirParagraphSchema>;
export type MemoirAiInput = z.infer<typeof memoirAiInputSchema>;
export type MemoirFollowupContext = z.infer<typeof memoirFollowupContextSchema>;
export type MemoirChapterDraft = z.infer<typeof memoirChapterDraftSchema>;
export type MemoirChapterRevision = z.infer<typeof memoirChapterRevisionSchema>;
export type MemoirChapterConfirmation = z.infer<typeof memoirChapterConfirmationSchema>;
export type MemoirChapter = z.infer<typeof memoirChapterSchema>;
export type MemoirChapterPublication = z.infer<typeof memoirChapterPublicationSchema>;
export type PublicMemoirChapter = z.infer<typeof publicMemoirChapterSchema>;
export type MemoirAiOperation = z.infer<typeof memoirAiOperationSchema>;
