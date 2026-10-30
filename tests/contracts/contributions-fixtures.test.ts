import assert from 'node:assert/strict';
import test from 'node:test';
import { myContributionsSchema } from '../../src/contracts/contributors';
import { contributionInbox } from '../browser/fixtures.mjs';

/**
 * 浏览器夹具是"我的讲述"页面的初始数据，页面在每次写操作后会用同一个响应再解析一遍。
 * 契约字段增加（例如邀请的 `revokedAt`）而夹具没跟上时，写操作成功后的刷新会解析失败，
 * 成功提示被错误提示覆盖，表现为浏览器回归随机超时。这条测试把这种漂移挡在日常测试里。
 */
test('浏览器夹具满足我的讲述契约', () => {
  const parsed = myContributionsSchema.safeParse(contributionInbox);
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  assert.equal(parsed.data?.invitations.length, 2);
});
