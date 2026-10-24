import assert from 'node:assert/strict';
import test from 'node:test';
import { memoirDemoStateSchema, type MemoirDemoAction, type MemoirDemoState, type MemoirDemoWorkspace } from '../../src/contracts';
import { DemoRuleError } from '../../src/features/direction1/demo-error';
import { applyDiscoveryDemo, createDiscoveryDemo, discoveryDemoActors, visibleDemoComments, visibleDemoMuseums } from '../../src/features/discovery/demo';
import { applyMemoirDemo, createMemoirDemo, currentDemoConfirmation, currentDemoSession, exportMemoirDemo } from '../../src/features/memoir/demo';

function workspace(state: MemoirDemoState): MemoirDemoWorkspace {
  assert.equal(state.data.state, 'ready');
  if (state.data.state !== 'ready') throw new Error('expected ready state');
  return state.data.workspace;
}
function runtime() {
  let sequence = 0;
  return { newId: () => `90000000-0000-4000-8000-${(++sequence).toString().padStart(12, '0')}`, now: () => '2026-10-24T01:00:00.000Z' };
}
const hasCode = (code: string) => (error: unknown) => error instanceof DemoRuleError && error.code === code;
function memoirFlow() {
  let state = createMemoirDemo();
  const clock = runtime();
  const step = (action: MemoirDemoAction) => { state = applyMemoirDemo(state, action, clock); return state; };
  function saveChapter() {
    step({ type: 'chapter_fixture', expectedVersion: workspace(state).memoir.version, sourceVersion: workspace(state).sourceVersion });
    const draft = workspace(state).drafts.at(-1);
    assert.ok(draft);
    step({ type: 'save_chapter', expectedVersion: workspace(state).memoir.version, sourceVersion: draft.sourceVersion,
      title: draft.output.title, paragraphs: draft.output.paragraphs, derivedFromDraftId: draft.id });
  }
  function confirmChapter() {
    const revisionId = workspace(state).chapter.currentRevisionId;
    assert.ok(revisionId);
    step({ type: 'confirm_chapter', expectedVersion: workspace(state).memoir.version, revisionId, reviewedSources: true });
  }
  return { state: () => state, step, saveChapter, confirmChapter };
}

test('DEMO 访谈暂停可续接原问题，拒绝后刷新也不重新追问该话题', () => {
  const flow = memoirFlow();
  const questionId = currentDemoSession(workspace(flow.state())).currentQuestionId;
  flow.step({ type: 'pause', expectedVersion: 1 });
  flow.step({ type: 'resume', expectedVersion: 2 });
  assert.equal(currentDemoSession(workspace(flow.state())).currentQuestionId, questionId);
  flow.step({ type: 'refuse', expectedVersion: 3 });
  const restored = memoirDemoStateSchema.parse(JSON.parse(JSON.stringify(flow.state())));
  assert.equal(currentDemoSession(workspace(restored)).topic.disposition, 'refused');
  assert.throws(() => applyMemoirDemo(restored, { type: 'resume', expectedVersion: 4 }), hasCode('INTERVIEW_STATE_CONFLICT'));
  assert.throws(() => applyMemoirDemo(restored, { type: 'select_topic', expectedVersion: 4, topicIndex: 0 }), hasCode('INTERVIEW_STATE_CONFLICT'));
  flow.step({ type: 'select_topic', expectedVersion: 4, topicIndex: 1 });
  assert.equal(currentDemoSession(workspace(flow.state())).topic.title, '求学片段');
});

test('DEMO 本地存档边界拒绝悬空当前访谈及跨书记录，不让有效 JSON 绕过关系校验', () => {
  const state = createMemoirDemo();
  const value = workspace(state);
  assert.equal(memoirDemoStateSchema.safeParse({ ...state, data: { state: 'ready', workspace: { ...value,
    currentSessionId: '99999999-0000-4000-8000-000000000001' } } }).success, false);
  assert.equal(memoirDemoStateSchema.safeParse({ ...state, data: { state: 'ready', workspace: { ...value,
    answers: value.answers.map((answer) => ({ ...answer, memoirId: '99999999-0000-4000-8000-000000000001' })) } } }).success, false);
});

test('DEMO 回答修订追加记录，过期写入拒绝且不改原状态', () => {
  const flow = memoirFlow();
  const originalAnswer = workspace(flow.state()).answers[0];
  assert.ok(originalAnswer);
  flow.step({ type: 'save_answer', expectedVersion: 1, text: '  【合成】也可能是另一种树。\n' });
  const answers = workspace(flow.state()).answers;
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[0], originalAnswer);
  assert.equal(answers[1]?.answerId, originalAnswer.answerId);
  assert.equal(answers[1]?.revision, 2);
  const serialized = JSON.stringify(flow.state());
  assert.throws(() => flow.step({ type: 'save_answer', expectedVersion: 1, text: '旧请求' }), hasCode('VERSION_CONFLICT'));
  assert.equal(JSON.stringify(flow.state()), serialized);
});

test('DEMO 每次只增加一个追问，未回答新问题不能继续扣额追问', () => {
  const flow = memoirFlow();
  const previousCount = workspace(flow.state()).questions.length;
  flow.step({ type: 'followup_fixture', expectedVersion: 1 });
  assert.equal(workspace(flow.state()).questions.length, previousCount + 1);
  assert.equal(workspace(flow.state()).interviewQuotaRemaining, 2);
  assert.throws(() => flow.step({ type: 'followup_fixture', expectedVersion: 2 }), hasCode('VALIDATION_ERROR'));
  assert.equal(workspace(flow.state()).interviewQuotaRemaining, 2);
});

test('DEMO 额度耗尽只停止深访，保存、整理、编辑与两种导出仍可用', () => {
  const flow = memoirFlow();
  flow.step({ type: 'exhaust_demo_quota', expectedVersion: 1 });
  assert.throws(() => flow.step({ type: 'followup_fixture', expectedVersion: 2 }), hasCode('INTERVIEW_QUOTA_EXHAUSTED'));
  flow.step({ type: 'save_answer', expectedVersion: 2, text: '【合成】年份不确定。\n~~~\n保留原文。' });
  flow.saveChapter();
  assert.equal(workspace(flow.state()).revisions.length, 1);
  assert.ok(exportMemoirDemo(flow.state(), 'markdown').includes('年份不确定。\n~~~\n保留原文。'));
  assert.equal(memoirDemoStateSchema.parse(JSON.parse(exportMemoirDemo(flow.state(), 'json'))).data.state, 'ready');
});

test('DEMO 草稿不自动采纳或确认，逐章授权生成独立快照，编辑不改已发布正文', () => {
  const flow = memoirFlow();
  flow.saveChapter();
  assert.equal(currentDemoConfirmation(workspace(flow.state())), undefined);
  assert.equal(workspace(flow.state()).publications.length, 0);
  flow.confirmChapter();
  const confirmation = currentDemoConfirmation(workspace(flow.state()));
  assert.ok(confirmation);
  flow.step({ type: 'publish_chapter', expectedVersion: workspace(flow.state()).memoir.version,
    confirmationId: confirmation.id, privacyAcknowledged: true, authorizePublicChapter: true });
  const snapshot = structuredClone(workspace(flow.state()).publications[0]);
  const revision = workspace(flow.state()).revisions.at(-1);
  assert.ok(revision);
  flow.step({ type: 'save_chapter', expectedVersion: workspace(flow.state()).memoir.version,
    sourceVersion: workspace(flow.state()).sourceVersion, title: '新的用户标题',
    paragraphs: revision.paragraphs, derivedFromDraftId: revision.derivedFromDraftId });
  assert.equal(currentDemoConfirmation(workspace(flow.state())), undefined);
  assert.deepEqual(workspace(flow.state()).publications[0], snapshot);
  assert.throws(() => flow.step({ type: 'publish_chapter', expectedVersion: workspace(flow.state()).memoir.version,
    confirmationId: confirmation.id, privacyAcknowledged: true, authorizePublicChapter: true }), hasCode('MEMOIR_NOT_CONFIRMED'));
  flow.step({ type: 'revoke_chapter', expectedVersion: workspace(flow.state()).memoir.version });
  assert.equal(workspace(flow.state()).publications.some((item) => item.revokedAt === null), false);
});

test('DEMO 来源修订使旧草稿与确认失效；删除后导出和旧回包不能恢复资料', () => {
  const flow = memoirFlow();
  flow.saveChapter(); flow.confirmChapter();
  const oldSourceVersion = workspace(flow.state()).sourceVersion;
  flow.step({ type: 'save_answer', expectedVersion: workspace(flow.state()).memoir.version, text: '【合成修订】我并不确定那是什么树。' });
  assert.equal(currentDemoConfirmation(workspace(flow.state())), undefined);
  assert.throws(() => flow.step({ type: 'chapter_fixture', expectedVersion: workspace(flow.state()).memoir.version, sourceVersion: oldSourceVersion }), hasCode('VERSION_CONFLICT'));
  const version = workspace(flow.state()).memoir.version;
  const deleted = flow.step({ type: 'delete_memoir', expectedVersion: version, confirmOnlineDeletion: true });
  const serialized = JSON.stringify(deleted);
  for (const privateText of ['桂花树', '我并不确定', 'paragraphs', 'answers', 'publications']) assert.ok(!serialized.includes(privateText));
  assert.throws(() => exportMemoirDemo(deleted, 'json'), hasCode('NOT_FOUND'));
  assert.throws(() => applyMemoirDemo(deleted, { type: 'chapter_fixture', expectedVersion: version, sourceVersion: oldSourceVersion }), hasCode('NOT_FOUND'));
});

test('DEMO 四字段可搜索；私密、持链接、未发布修改及自传不进搜索', () => {
  const state = createDiscoveryDemo();
  for (const query of ['木盒收藏者', '沿途的车票', '旧相机', '磁带']) assert.ok(visibleDemoMuseums(state, query).length > 0);
  for (const query of ['私密哨兵', '链接哨兵', '未发布修改哨兵', '未发布标签哨兵', '桂花树']) assert.equal(visibleDemoMuseums(state, query).length, 0);
  assert.equal(visibleDemoMuseums(state, '%').length, 0);
});

test('DEMO 每个账号一座馆，关注与收藏分开，重复收藏不增加', () => {
  const clock = runtime();
  let state = createDiscoveryDemo();
  assert.equal(new Set(state.data.museums.map((item) => item.published.owner.userId)).size, state.data.museums.length);
  const museum = visibleDemoMuseums(state)[0]; assert.ok(museum);
  state = applyDiscoveryDemo(state, { type: 'follow', userId: museum.owner.userId, following: true }, clock);
  assert.equal(visibleDemoMuseums(state, '', true).length, 1);
  state = applyDiscoveryDemo(state, { type: 'favorite', museumId: museum.museumId, favorited: true }, clock);
  state = applyDiscoveryDemo(state, { type: 'favorite', museumId: museum.museumId, favorited: true }, clock);
  assert.equal(visibleDemoMuseums(state)[0]?.favoriteCount, 1);
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: discoveryDemoActors[1].userId }, clock);
  assert.equal(visibleDemoMuseums(state, '', true).length, 0);
  assert.equal(visibleDemoMuseums(state)[0]?.isFavorited, false);
  assert.equal(visibleDemoMuseums(state)[0]?.favoriteCount, 1);
});

test('DEMO 首版禁止自关注与自收藏，失败不改关系或计数', () => {
  const clock = runtime();
  let state = createDiscoveryDemo();
  const museum = state.data.museums[0]; assert.ok(museum);
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: museum.published.owner.userId }, clock);
  const before = JSON.stringify(state);
  assert.throws(() => applyDiscoveryDemo(state, { type: 'follow', userId: museum.published.owner.userId, following: true }, clock), hasCode('VALIDATION_ERROR'));
  assert.throws(() => applyDiscoveryDemo(state, { type: 'favorite', museumId: museum.published.museumId, favorited: true }, clock), hasCode('VALIDATION_ERROR'));
  assert.equal(JSON.stringify(state), before);
});

test('DEMO 关闭留言不影响自己删除，删除根留言后回复保留且正文消失', () => {
  const clock = runtime();
  let state = createDiscoveryDemo();
  const museum = state.data.museums[0]; assert.ok(museum);
  const root = museum.comments[0]; assert.ok(root);
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: museum.published.owner.userId }, clock);
  state = applyDiscoveryDemo(state, { type: 'comment_mode', museumId: museum.published.museumId, expectedVersion: 1, mode: 'closed' }, clock);
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: root.author.userId }, clock);
  assert.throws(() => applyDiscoveryDemo(state, { type: 'comment', museumId: museum.published.museumId,
    accessEpoch: museum.published.accessEpoch, rootId: null, replyToId: null, body: '不能新增' }, clock), hasCode('COMMENTS_CLOSED'));
  state = applyDiscoveryDemo(state, { type: 'delete_comment', museumId: museum.published.museumId, commentId: root.id, expectedVersion: 1 }, clock);
  const current = state.data.museums[0]; assert.ok(current);
  assert.equal(visibleDemoComments(current).length, 2);
  assert.equal('body' in (visibleDemoComments(current)[0] ?? {}), false);
});

test('DEMO 访客不能管理，隐藏根留言隐藏整线程，禁评不禁止参观', () => {
  const clock = runtime();
  let state = createDiscoveryDemo();
  const museum = state.data.museums[0]; assert.ok(museum);
  const root = museum.comments[0]; assert.ok(root);
  assert.throws(() => applyDiscoveryDemo(state, { type: 'moderate_comment', museumId: museum.published.museumId,
    commentId: root.id, expectedVersion: 1, status: 'hidden' }, clock), hasCode('FORBIDDEN'));
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: museum.published.owner.userId }, clock);
  state = applyDiscoveryDemo(state, { type: 'moderate_comment', museumId: museum.published.museumId, commentId: root.id, expectedVersion: 1, status: 'hidden' }, clock);
  state = applyDiscoveryDemo(state, { type: 'ban', museumId: museum.published.museumId, commentId: root.id, banned: true }, clock);
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: root.author.userId }, clock);
  assert.equal(visibleDemoMuseums(state).length, 3);
  const current = state.data.museums[0]; assert.ok(current);
  assert.equal(visibleDemoComments(current).length, 0);
  assert.throws(() => applyDiscoveryDemo(state, { type: 'comment', museumId: museum.published.museumId,
    accessEpoch: museum.published.accessEpoch, rootId: null, replyToId: null, body: '不能新增' }, clock), hasCode('COMMENTING_BLOCKED'));
});

test('DEMO 作者删除已隐藏根留言不会重新开放线程；馆主恢复也不会还原已删正文', () => {
  const clock = runtime();
  let state = createDiscoveryDemo();
  const museum = state.data.museums[0]; const root = museum?.comments[0]; assert.ok(museum); assert.ok(root);
  const museumId = museum.published.museumId;
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: museum.published.owner.userId }, clock);
  state = applyDiscoveryDemo(state, { type: 'moderate_comment', museumId, commentId: root.id, expectedVersion: 1, status: 'hidden' }, clock);
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: root.author.userId }, clock);
  state = applyDiscoveryDemo(state, { type: 'delete_comment', museumId, commentId: root.id, expectedVersion: 2 }, clock);
  const hidden = state.data.museums[0]; assert.ok(hidden);
  assert.equal(hidden.comments[0]?.status, 'hidden_deleted');
  assert.equal('body' in (hidden.comments[0] ?? {}), false);
  assert.deepEqual(visibleDemoComments(hidden), []);
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: museum.published.owner.userId }, clock);
  state = applyDiscoveryDemo(state, { type: 'moderate_comment', museumId, commentId: root.id, expectedVersion: 3, status: 'visible' }, clock);
  const restored = state.data.museums[0]; assert.ok(restored);
  assert.equal(visibleDemoComments(restored).length, 2);
  assert.equal(restored.comments[0]?.status, 'deleted');
  assert.equal('body' in (restored.comments[0] ?? {}), false);
});

test('DEMO 跨馆回复拒绝，退出发现使旧访问版本失效，再公开也不能复用旧版本', () => {
  const clock = runtime();
  let state = createDiscoveryDemo();
  const first = state.data.museums[0]; const second = state.data.museums[1]; const root = first?.comments[0];
  assert.ok(first); assert.ok(second); assert.ok(root);
  assert.throws(() => applyDiscoveryDemo(state, { type: 'comment', museumId: second.published.museumId,
    accessEpoch: second.published.accessEpoch, rootId: root.id, replyToId: root.id, body: '跨馆回复' }, clock), hasCode('THREAD_UNAVAILABLE'));
  state = applyDiscoveryDemo(state, { type: 'switch_actor', userId: first.published.owner.userId }, clock);
  state = applyDiscoveryDemo(state, { type: 'access', museumId: first.published.museumId, accessMode: 'private' }, clock);
  assert.equal(visibleDemoMuseums(state).length, 2);
  state = applyDiscoveryDemo(state, { type: 'access', museumId: first.published.museumId, accessMode: 'discoverable' }, clock);
  assert.throws(() => applyDiscoveryDemo(state, { type: 'comment', museumId: first.published.museumId,
    accessEpoch: first.published.accessEpoch, rootId: null, replyToId: null, body: '旧入口' }, clock), hasCode('NOT_FOUND'));
});
