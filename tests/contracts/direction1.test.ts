import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commentBodySchema, createCommentInputSchema, deleteMemoirInputSchema, discoveryMuseumSchema,
  errorHttpStatus, errorResponseSchema, grantMemoirPublicationInputSchema, interviewFollowupForSourcesSchema,
  interviewSessionSchema, memoirAiInputSchema, memoirAnswerRevisionSchema, memoirChapterDraftSchema,
  memoirChapterOutputForSourcesSchema, memoirParagraphsSchema, museumAccessSchema, museumTagsSchema,
  newMuseumAccessMode, publicCommentSchema, publicMemoirChapterSchema, saveInterviewAnswerInputSchema,
} from '../../src/contracts';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const now = '2026-10-24T00:00:00.000Z';
const answer = memoirAnswerRevisionSchema.parse({
  id: id(1), answerId: id(2), memoirId: id(3), sessionId: id(4), questionId: id(5),
  revision: 1, kind: 'interview', text: '  可能是夏天。🌿\n', createdAt: now,
});
const input = memoirAiInputSchema.parse({ memoirId: id(3), sourceVersion: 1, sources: [answer] });
const paragraph = { id: id(6), text: '我记得可能是夏天。', sources: [{ answerRevisionId: answer.id, start: 0, end: Array.from(answer.text).length }] };
const comment = { id: id(8), museumId: id(9), author: { userId: id(10), nickname: 'DEMO 访客' },
  rootId: null, replyToId: null, version: 1, createdAt: now, status: 'visible', body: '这是演示留言。' };

test('回答原样保存，包括空格、换行、补充字符及不确定表达', () => {
  assert.equal(saveInterviewAnswerInputSchema.parse({ operationId: id(20), expectedVersion: 1,
    questionId: id(5), answerId: null, text: answer.text }).text, answer.text);
  for (const text of [' ', '\n\t', '字'.repeat(6_001)]) {
    assert.equal(memoirAnswerRevisionSchema.safeParse({ ...answer, text }).success, false);
  }
  assert.equal(memoirAnswerRevisionSchema.safeParse({ ...answer, text: '🌿'.repeat(6_000) }).success, true);
  assert.equal(memoirAnswerRevisionSchema.safeParse({ ...answer, kind: 'user_supplement' }).success, false);
});

test('同一自传与本次选中的回答版本才可作为来源，偏移按码点计算', () => {
  const output = memoirChapterOutputForSourcesSchema(input);
  assert.equal(output.safeParse({ title: '一个夏天', paragraphs: [paragraph] }).success, true);
  for (const source of [
    { answerRevisionId: id(99), start: 0, end: 1 },
    { answerRevisionId: answer.id, start: 1, end: 1 },
    { answerRevisionId: answer.id, start: 0, end: answer.text.length },
    { answerRevisionId: answer.id, start: -1, end: 2 },
  ]) assert.equal(output.safeParse({ title: '一个夏天', paragraphs: [{ ...paragraph, sources: [source] }] }).success, false);
  assert.equal(memoirAiInputSchema.safeParse({ ...input, memoirId: id(99) }).success, false);
  assert.equal(memoirAiInputSchema.safeParse({ ...input, sources: [answer, answer] }).success, false);
  assert.equal(output.safeParse({ title: '一个夏天', paragraphs: [{ ...paragraph, sources: [] }] }).success, false);
});

test('追问是零或一个对象，必须有本次回答来源；不接受多问题数组', () => {
  const schema = interviewFollowupForSourcesSchema(input);
  assert.equal(schema.safeParse({ question: null }).success, true);
  assert.equal(schema.safeParse({ question: { text: '你愿意补充哪一处细节？', basedOnAnswerRevisionIds: [answer.id] } }).success, true);
  assert.equal(schema.safeParse({ questions: ['一？', '二？'] }).success, false);
  assert.equal(schema.safeParse({ question: { text: '你童年住在哪里？后来去了哪里？', basedOnAnswerRevisionIds: [answer.id] } }).success, false);
  assert.equal(schema.safeParse({ question: { text: '你愿意补充吗？', basedOnAnswerRevisionIds: [id(99)] } }).success, false);
});

test('拒绝、跳过或完成的话题不能被标为活跃；结束后无当前问题', () => {
  const session = { id: id(4), memoirId: id(3), topic: { id: id(7), title: '童年的一件事', disposition: 'open' },
    state: 'active', currentQuestionId: id(5), version: 1, createdAt: now, updatedAt: now };
  assert.equal(interviewSessionSchema.safeParse(session).success, true);
  for (const disposition of ['refused', 'skipped', 'completed']) {
    assert.equal(interviewSessionSchema.safeParse({ ...session, topic: { ...session.topic, disposition } }).success, false);
  }
  assert.equal(interviewSessionSchema.safeParse({ ...session, state: 'completed' }).success, false);
});

test('人工章节预算支持长文，限制总长度与重复段落而非沿用展签字数', () => {
  const paragraphs = Array.from({ length: 20 }, (_, n) => ({ ...paragraph, id: id(100 + n), text: '文'.repeat(1_000) }));
  assert.equal(memoirParagraphsSchema.safeParse(paragraphs).success, true);
  assert.equal(memoirParagraphsSchema.safeParse([...paragraphs, { ...paragraph, id: id(200) }]).success, false);
  assert.equal(memoirParagraphsSchema.safeParse([paragraph, paragraph]).success, false);
});

test('fixture 不得关联真实操作，公开章节不接受内部来源和回答', () => {
  const draft = { id: id(21), memoirId: id(3), chapterId: id(22), sourceVersion: 1,
    generation: 'fixture', aiOperationId: null, output: { title: '夏天', paragraphs: [paragraph] }, createdAt: now };
  assert.equal(memoirChapterDraftSchema.safeParse(draft).success, true);
  assert.equal(memoirChapterDraftSchema.safeParse({ ...draft, generation: 'provider' }).success, false);
  assert.equal(memoirChapterDraftSchema.safeParse({ ...draft, aiOperationId: id(23) }).success, false);
  const published = { publicationId: id(30), chapterId: id(22), title: '夏天', paragraphs: [paragraph.text], publishedAt: now };
  assert.equal(publicMemoirChapterSchema.safeParse(published).success, true);
  for (const field of ['answers', 'rawStory', 'sourceRefs', 'confirmedBy', 'storagePath']) {
    assert.equal(publicMemoirChapterSchema.safeParse({ ...published, [field]: 'private' }).success, false);
  }
  assert.equal(publicMemoirChapterSchema.safeParse({ ...published, paragraphs: [paragraph] }).success, false);
});

test('逐章授权及在线删除要求明确确认，客户端不能提供身份或自动确认', () => {
  const mutation = { operationId: id(40), expectedVersion: 2 };
  assert.equal(grantMemoirPublicationInputSchema.safeParse({ ...mutation, confirmationId: id(41),
    privacyAcknowledged: true, authorizePublicChapter: true }).success, true);
  assert.equal(grantMemoirPublicationInputSchema.safeParse({ ...mutation, confirmationId: id(41), privacyAcknowledged: true }).success, false);
  assert.equal(deleteMemoirInputSchema.safeParse(mutation).success, false);
  assert.equal(deleteMemoirInputSchema.safeParse({ ...mutation, confirmOnlineDeletion: true }).success, true);
  assert.equal(deleteMemoirInputSchema.safeParse({ ...mutation, confirmOnlineDeletion: true, ownerId: id(99) }).success, false);
});

test('新馆默认为私密，私密馆不允许可撤销外部访问版本', () => {
  assert.equal(newMuseumAccessMode, 'private');
  const access = { museumId: id(9), version: 1, accessMode: 'private', accessEpoch: null };
  assert.equal(museumAccessSchema.safeParse(access).success, true);
  assert.equal(museumAccessSchema.safeParse({ ...access, accessEpoch: id(50) }).success, false);
  assert.equal(museumAccessSchema.safeParse({ ...access, accessMode: 'discoverable' }).success, false);
  assert.equal(museumTagsSchema.safeParse([' 手动标签 ', '手动标签']).success, false);
});

test('目录没有收藏名单、登录名、秘密分享凭据或私有自传字段', () => {
  const museum = { museumId: id(9), accessEpoch: id(50), owner: comment.author,
    title: 'DEMO 小馆', description: '', tags: ['夏天'], exhibitNames: ['旧水壶'],
    publishedAt: now, favoriteCount: 2, isFollowing: false, isFavorited: false };
  assert.equal(discoveryMuseumSchema.safeParse(museum).success, true);
  for (const key of ['favoritedBy', 'shareToken', 'tokenHash', 'rawStory', 'memoirDraft', 'username']) {
    assert.equal(discoveryMuseumSchema.safeParse({ ...museum, [key]: 'private' }).success, false);
  }
  assert.equal(discoveryMuseumSchema.safeParse({ ...museum, owner: { ...museum.owner, username: 'login-name' } }).success, false);
});

test('公开留言拒绝隐藏正文和删除正文；创建不接受冒充身份或单独回复引用', () => {
  assert.equal(publicCommentSchema.safeParse(comment).success, true);
  assert.equal(publicCommentSchema.safeParse({ ...comment, status: 'hidden' }).success, false);
  assert.equal(publicCommentSchema.safeParse({ ...comment, status: 'deleted' }).success, false);
  const { body: _body, ...deleted } = comment;
  assert.equal(_body, comment.body);
  assert.equal(publicCommentSchema.safeParse({ ...deleted, status: 'deleted' }).success, true);
  const create = { operationId: id(40), accessEpoch: id(50), rootId: null, replyToId: null, body: '演示内容' };
  assert.equal(createCommentInputSchema.safeParse(create).success, true);
  for (const extra of [{ authorId: id(99) }, { rootId: id(8) }, { isDemo: true }]) {
    assert.equal(createCommentInputSchema.safeParse({ ...create, ...extra }).success, false);
  }
  assert.equal(commentBodySchema.safeParse('🌿'.repeat(2_000)).success, true);
});

test('方向一错误码使用同一状态映射，不允许夹带正文 details', () => {
  for (const code of ['DEMO_ONLY', 'MEMOIR_NOT_CONFIRMED', 'AI_OUTCOME_UNKNOWN', 'INTERVIEW_QUOTA_EXHAUSTED'] as const) {
    const error = { code, message: '操作未完成，请核对当前状态。', requestId: 'test-direction1' };
    assert.ok(errorHttpStatus[code] >= 400);
    assert.equal(errorResponseSchema.safeParse({ error }).success, true);
    assert.equal(errorResponseSchema.safeParse({ error: { ...error, details: { answer: 'private' } } }).success, false);
  }
});
