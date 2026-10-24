import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaderboardSchema, type LeaderboardEntry } from '../../contracts/discovery';
import { filterEntries } from './leaderboard';

// 构造数据只用于测筛选：排序与名次由服务端聚合决定，不在这一层断言。
const entries: LeaderboardEntry[] = leaderboardSchema.parse({
  period: 'all',
  totalMuseums: 5,
  entries: [
    { rank: 1, museumId: '00000000-0000-4000-8000-000000000001', title: '洛阳的搪瓷缸', regionCity: '洛阳', viewCount: 12, isDemo: false },
    { rank: 2, museumId: '00000000-0000-4000-8000-000000000002', title: '郑州的换班牌', regionCity: '郑州', viewCount: 9, isDemo: false },
    { rank: 3, museumId: '00000000-0000-4000-8000-000000000003', title: '洛阳的搪瓷脸盆', regionCity: '洛阳', viewCount: 5, isDemo: false },
    { rank: 4, museumId: '00000000-0000-4000-8000-000000000004', title: '郑州的旧车票', regionCity: '郑州', viewCount: 2, isDemo: false },
    { rank: 5, museumId: '00000000-0000-4000-8000-000000000005', title: '未标注城市的木箱', regionCity: null, viewCount: 0, isDemo: false },
  ],
}).entries;

test('筛选：全部、单城、未标注是三件不同的事', () => {
  assert.equal(filterEntries(entries, { kind: 'all' }).length, entries.length);
  const luoyang = filterEntries(entries, { kind: 'city', city: '洛阳' });
  assert.deepEqual(luoyang.map((entry) => entry.title), ['洛阳的搪瓷缸', '洛阳的搪瓷脸盆']);
  const unplaced = filterEntries(entries, { kind: 'unplaced' });
  assert.equal(unplaced.length, 1);
  assert.ok(unplaced.every((entry) => entry.regionCity === null));
});

test('筛选保留原顺序与原名次，不重排', () => {
  const zhengzhou = filterEntries(entries, { kind: 'city', city: '郑州' });
  assert.deepEqual(zhengzhou.map((entry) => entry.rank), [2, 4]);
  assert.deepEqual(filterEntries(entries, { kind: 'all' }).map((entry) => entry.rank), [1, 2, 3, 4, 5]);
});

test('筛选未命中返回空数组，而不是回退成全部', () => {
  // 「这个城市没有馆」必须显示为空；退成全部会让读者以为该市馆很多。
  assert.deepEqual(filterEntries(entries, { kind: 'city', city: '济源' }), []);
});

test('筛选不改输入数组', () => {
  const snapshot = [...entries];
  filterEntries(entries, { kind: 'city', city: '郑州' });
  filterEntries(entries, { kind: 'all' });
  assert.deepEqual(entries, snapshot);
});
