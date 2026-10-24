import assert from 'node:assert/strict';
import { test } from 'node:test';
import { henanCities, type RegionCity } from '../../src/contracts/discovery';
import { toLiveLeaderboard, toRegionBuckets, type LeaderboardRow } from '../../src/server/core/discovery';

/**
 * 聚合结果的整形规则。
 *
 * 这两个函数是「数据库聚合行」到「公开契约」之间唯一的一道门，因此断言的重点不是
 * 排序（排序在 SQL，见 `src/server/core/discovery.ts`），而是**名次、恒非 DEMO、
 * 18 城固定顺序**这些一旦错了就会悄悄污染公开榜单的不变量。
 */

const rows: LeaderboardRow[] = [
  { museumId: '00000000-0000-4000-8000-000000000001', title: '洛阳的搪瓷缸', regionCity: '洛阳', viewCount: 12 },
  { museumId: '00000000-0000-4000-8000-000000000002', title: '郑州的换班牌', regionCity: '郑州', viewCount: 9 },
  { museumId: '00000000-0000-4000-8000-000000000003', title: '未标注城市的木箱', regionCity: null, viewCount: 0 },
];

test('名次从 1 连续递增，且顺序沿用数据库给出的顺序', () => {
  const board = toLiveLeaderboard(rows, 3);
  assert.deepEqual(board.entries.map((entry) => entry.rank), [1, 2, 3]);
  assert.deepEqual(board.entries.map((entry) => entry.museumId), rows.map((row) => row.museumId));
  assert.equal(board.period, 'all');
});

test('真实聚合的每条都是 isDemo: false', () => {
  // 一个 true 就会让界面打出 DEMO 标记，读者随即不再相信整页数字。
  assert.ok(toLiveLeaderboard(rows, 3).entries.every((entry) => entry.isDemo === false));
});

test('totalMuseums 是聚合总数，可以大于入榜条数', () => {
  const board = toLiveLeaderboard(rows.slice(0, 2), 40);
  assert.equal(board.entries.length, 2);
  assert.equal(board.totalMuseums, 40);
});

test('空库给出空榜单而不是错误', () => {
  const board = toLiveLeaderboard([], 0);
  assert.deepEqual(board.entries, []);
  assert.equal(board.totalMuseums, 0);
});

test('入榜条数超过总数会被契约挡下', () => {
  // 这条若放过，页面上会出现「共 2 座馆」却列出 3 条自相矛盾的数字。
  assert.throws(() => toLiveLeaderboard(rows, 2));
});

test('整形不改输入数组', () => {
  const snapshot = structuredClone(rows);
  toLiveLeaderboard(rows, 3);
  assert.deepEqual(rows, snapshot);
});

test('地区聚合恒输出 18 个城市，顺序固定', () => {
  const buckets = toRegionBuckets([{ city: '洛阳', museumCount: 2, viewCount: 17 }]);
  assert.equal(buckets.length, henanCities.length);
  assert.deepEqual(buckets.map((bucket) => bucket.city), [...henanCities]);
});

test('没有馆的城市补 0，而不是省略', () => {
  const buckets = toRegionBuckets([{ city: '洛阳', museumCount: 2, viewCount: 17 }]);
  const zhengzhou = buckets.find((bucket) => bucket.city === '郑州');
  assert.deepEqual(zhengzhou, { city: '郑州', museumCount: 0, viewCount: 0 });
});

test('重复城市直接报错，不合并也不取其一', () => {
  // 重复说明 SQL 写错了（少了 GROUP BY）；悄悄取一条会给出看似正常的错误数字。
  assert.throws(() => toRegionBuckets([
    { city: '洛阳', museumCount: 1, viewCount: 1 },
    { city: '洛阳', museumCount: 2, viewCount: 2 },
  ]), /重复城市/);
});

test('白名单外的城市名报错，而不是被悄悄丢掉', () => {
  assert.throws(() => toRegionBuckets([
    { city: '北京' as RegionCity, museumCount: 1, viewCount: 1 },
  ]));
});
