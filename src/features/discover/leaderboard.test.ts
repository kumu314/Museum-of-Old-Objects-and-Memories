import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoMuseums } from './demo-fixtures';
import { filterEntries, rankEntries, toLeaderboard } from './leaderboard';

test('浏览次数降序，名次从 1 连续递增', () => {
  const board = toLeaderboard(demoMuseums);
  assert.equal(board.period, 'all');
  assert.equal(board.totalMuseums, demoMuseums.length);
  assert.deepEqual(board.entries.map((entry) => entry.rank), board.entries.map((_, index) => index + 1));
  const counts = board.entries.map((entry) => entry.viewCount);
  assert.deepEqual(counts, [...counts].sort((left, right) => right - left));
});

test('同次数有确定顺序：输入打乱后输出不变', () => {
  const reversed = [...demoMuseums].reverse();
  assert.deepEqual(toLeaderboard(reversed).entries, toLeaderboard(demoMuseums).entries);
});

test('limit 只截断展示条数，totalMuseums 仍是聚合总数', () => {
  const board = toLeaderboard(demoMuseums, 3);
  assert.equal(board.entries.length, 3);
  assert.equal(board.totalMuseums, demoMuseums.length);
  assert.equal(board.entries[2]?.rank, 3);
});

test('limit 为 0 时给出空榜单，不是错误', () => {
  const board = toLeaderboard(demoMuseums, 0);
  assert.deepEqual(board.entries, []);
  assert.equal(board.totalMuseums, demoMuseums.length);
});

test('演示数据与真实数据混入同一榜单必须失败', () => {
  const real = { museumId: '00000000-0000-4000-8000-0000000000ff', title: '真实馆', regionCity: '郑州' as const, viewCount: 1, isDemo: false };
  assert.throws(() => toLeaderboard([...demoMuseums, real]), /不能混入同一榜单/);
});

test('fixture 通过同一份契约校验，且全部标记为演示', () => {
  const board = toLeaderboard(demoMuseums);
  assert.ok(board.entries.every((entry) => entry.isDemo));
  assert.ok(board.entries.every((entry) => entry.title.startsWith('【演示】')));
});

test('rankEntries 不改输入数组', () => {
  const input = [...demoMuseums];
  rankEntries(input);
  assert.deepEqual(input, demoMuseums);
});

test('筛选：全部、单城、未标注是三件不同的事', () => {
  const entries = toLeaderboard(demoMuseums).entries;
  assert.equal(filterEntries(entries, { kind: 'all' }).length, entries.length);
  const luoyang = filterEntries(entries, { kind: 'city', city: '洛阳' });
  assert.deepEqual(luoyang.map((entry) => entry.title), ['【演示】洛阳老厂区的搪瓷缸', '【演示】洛阳涧西的搪瓷脸盆']);
  const unplaced = filterEntries(entries, { kind: 'unplaced' });
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0]?.regionCity, null);
  assert.ok(unplaced.every((entry) => entry.regionCity === null));
});

test('筛选不重排名次：名次仍是累计榜里的原位置', () => {
  const entries = toLeaderboard(demoMuseums).entries;
  const zhengzhou = filterEntries(entries, { kind: 'city', city: '郑州' });
  assert.deepEqual(zhengzhou.map((entry) => entry.rank), [2, 7]);
});
