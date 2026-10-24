import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contributionStateSchema } from '../../contracts/contributors';
import { demoLi, demoOwner, demoState, demoWang, demoZhao } from './demo-fixtures';
import * as model from './model';
import { toPublicationView, withdrawAllByAuthor, withdrawContribution } from './model';

test('fixture 与真实数据服从同一份契约，且全部标记为 DEMO', () => {
  assert.doesNotThrow(() => contributionStateSchema.parse(demoState));
  assert.ok(demoState.contributions.every((contribution) => contribution.isDemo));
  assert.ok(demoState.invitations.every((invitation) => invitation.isDemo));
});

test('公开版本只收录满足全部条件的内容', () => {
  const view = toPublicationView(demoState);
  assert.equal(view.contributions.length, 2);
  assert.deepEqual(view.contributions.map((entry) => entry.authorName), [demoOwner.name, demoLi.name]);
});

test('尚未接受邀请的人不署名，内容也不出现在公开版本', () => {
  const view = toPublicationView(demoState);
  assert.ok(view.contributions.every((entry) => entry.authorId !== demoWang.id));
  const excluded = view.excluded.find((entry) => entry.authorName === demoWang.name);
  assert.equal(excluded?.reason, 'invitation-not-accepted');
});

test('已接受邀请但本人没同意公开的，仍不公开', () => {
  const view = toPublicationView(demoState);
  const excluded = view.excluded.find((entry) => entry.authorName === demoZhao.name);
  assert.equal(excluded?.reason, 'no-consent');
  assert.ok(view.contributions.every((entry) => entry.authorId !== demoZhao.id));
});

test('已撤回的内容不进入公开版本，但记录本身还在', () => {
  const withdrawn = demoState.contributions.find((contribution) => contribution.withdrawnAt !== null);
  assert.ok(withdrawn, 'fixture 应当保留一条已撤回的内容用来验证');
  const view = toPublicationView(demoState);
  assert.ok(view.contributions.every((entry) => entry.id !== withdrawn.id));
  assert.equal(view.excluded.find((entry) => entry.id === withdrawn.id)?.reason, 'withdrawn');
});

test('公开版本不泄露内部状态：没有同意标记、撤回时间与 DEMO 标记', () => {
  const view = toPublicationView(demoState);
  for (const entry of view.contributions) {
    assert.deepEqual(Object.keys(entry).sort(), ['authorId', 'authorName', 'authorRole', 'id', 'sourceNote', 'story']);
  }
  for (const entry of view.excluded) {
    assert.deepEqual(Object.keys(entry).sort(), ['authorName', 'id', 'reason']);
  }
});

test('多人讲述各自成条，不合并成一段', () => {
  const view = toPublicationView(demoState);
  assert.ok(view.contributions.length > 1, '至少要有两份独立讲述才谈得上"不合并"');
  // 每条的正文必须与原始记录逐字相同：任何拼接都会让某条变长。
  for (const entry of view.contributions) {
    const source = demoState.contributions.find((contribution) => contribution.id === entry.id);
    assert.equal(entry.story, source?.story);
    assert.ok(entry.sourceNote.length > 0, '来源不得为空');
  }
});

test('模块不提供任何合并、摘要或润色多人讲述的入口', () => {
  const banned = /merge|summar|combine|condense|rewrite|polish/i;
  assert.deepEqual(Object.keys(model).filter((name) => banned.test(name)), []);
});

test('撤回自己的内容成功，其他人的讲述逐字保留', () => {
  const mine = demoState.contributions.find((contribution) => contribution.authorId === demoLi.id && contribution.withdrawnAt === null);
  assert.ok(mine);
  const outcome = withdrawContribution(demoState, mine.id, demoLi.id, '2026-10-10T10:00:00+08:00');
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const view = toPublicationView(outcome.state);
  assert.ok(view.contributions.every((entry) => entry.id !== mine.id), '撤回后新公开版本必须移除');
  assert.equal(view.contributions.length, 1, '其他作者的内容必须保留');
  assert.equal(view.contributions[0]?.authorId, demoOwner.id);
  // 原始状态不被就地改写，撤回是产出新状态。
  assert.equal(demoState.contributions.find((contribution) => contribution.id === mine.id)?.withdrawnAt, null);
});

test('不能撤回别人的内容', () => {
  const others = demoState.contributions.find((contribution) => contribution.authorId === demoOwner.id);
  assert.ok(others);
  const outcome = withdrawContribution(demoState, others.id, demoLi.id, '2026-10-10T10:00:00+08:00');
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'not-author');
});

test('撤回不存在的 id 返回 not-found（接口层须与越权合并为同一个响应）', () => {
  const missing = withdrawContribution(demoState, 'c1000000-0000-4000-8000-0000000000ff', demoLi.id, '2026-10-10T10:00:00+08:00');
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.reason, 'not-found');
});

test('重复撤回被拒绝', () => {
  const mine = demoState.contributions.find((contribution) => contribution.authorId === demoLi.id && contribution.withdrawnAt === null);
  assert.ok(mine);
  const first = withdrawContribution(demoState, mine.id, demoLi.id, '2026-10-10T10:00:00+08:00');
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = withdrawContribution(first.state, mine.id, demoLi.id, '2026-10-11T10:00:00+08:00');
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.reason, 'already-withdrawn');
});

test('整体撤回只影响自己，别人的内容不动', () => {
  const after = withdrawAllByAuthor(demoState, demoLi.id, '2026-10-10T10:00:00+08:00');
  assert.ok(after.contributions.filter((entry) => entry.authorId === demoLi.id).every((entry) => entry.withdrawnAt !== null));
  const untouched = after.contributions.filter((entry) => entry.authorId !== demoLi.id);
  const before = demoState.contributions.filter((entry) => entry.authorId !== demoLi.id);
  assert.deepEqual(untouched, before);

  const view = toPublicationView(after);
  assert.ok(view.contributions.every((entry) => entry.authorId !== demoLi.id));
  assert.equal(view.contributions.length, 1);
});

test('参与者列表：馆主在前，已接受排在待回应之前', () => {
  const list = model.participantList(demoState);
  assert.equal(list[0]?.role, 'owner');
  const statuses = list.map((participant) => participant.invitationStatus);
  assert.ok(statuses.indexOf('accepted') < statuses.indexOf('pending'));
  assert.equal(list.find((participant) => participant.userId === demoWang.id)?.invitationStatus, 'pending');
});

test('另一件展品已接受的邀请不能授予当前展品署名权', () => {
  const contribution = demoState.contributions.find((entry) => entry.authorId === demoLi.id);
  assert.ok(contribution);
  const invitations = demoState.invitations.map((entry) => ({ ...entry, exhibitId: '6f1b0000-0000-4000-8000-000000000099' }));
  assert.equal(model.exclusionReasonFor(contribution, invitations), 'invitation-not-accepted');
});

test('状态契约拒绝混入其他展品的邀请或讲述', () => {
  const exhibitId = '6f1b0000-0000-4000-8000-000000000099';
  assert.equal(contributionStateSchema.safeParse({ ...demoState,
    invitations: demoState.invitations.map((entry) => ({ ...entry, exhibitId })),
  }).success, false);
  assert.equal(contributionStateSchema.safeParse({ ...demoState,
    contributions: demoState.contributions.map((entry) => ({ ...entry, exhibitId })),
  }).success, false);
});

test('公开讲述按实际时间排序，不受时区偏移与时间表示影响', () => {
  const contributions = demoState.contributions.filter((entry) => entry.authorId === demoOwner.id || (entry.authorId === demoLi.id && entry.withdrawnAt === null))
    .map((entry) => ({ ...entry, createdAt: entry.authorId === demoOwner.id ? '2026-10-01T10:00:00+08:00' : '2026-10-01T03:00:00Z' }));
  assert.deepEqual(toPublicationView({ ...demoState, contributions }).contributions.map((entry) => entry.authorId), [demoOwner.id, demoLi.id]);
  const sameInstant = contributions.map((entry) => ({ ...entry, createdAt: entry.authorId === demoOwner.id ? '2026-10-01T10:00:00+08:00' : '2026-10-01T02:00:00Z' }));
  assert.deepEqual(toPublicationView({ ...demoState, contributions: sameInstant.reverse() }).contributions.map((entry) => entry.authorId), [demoOwner.id, demoLi.id]);
});
