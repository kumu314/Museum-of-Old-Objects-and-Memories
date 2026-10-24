import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { henanCities } from '../../src/contracts/discovery';

/**
 * 城市白名单在两处存在：迁移里的 CHECK 约束（数据库侧最后防线）与
 * `src/contracts/discovery.ts` 的 `henanCities`（应用侧）。两套真相迟早漂移，
 * 漂移的后果是「界面能选的城市一保存就被数据库拒绝」或反过来「库里存着界面
 * 认不出的城市，聚合时被静默丢失」。
 *
 * 这个用例把它们钉在一起：改任何一侧而忘了另一侧，CI 直接红。
 */
const migration = readFileSync(new URL('../../migrations/0008_discovery_views.sql', import.meta.url), 'utf8');

function migrationCities(): string[] {
  const constraint = /region_city IN \(([\s\S]*?)\)/.exec(migration);
  assert.ok(constraint, '迁移里找不到 region_city 的白名单约束。');
  const body = constraint[1] ?? '';
  return [...body.matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((city): city is string => city !== undefined);
}

test('迁移里的城市白名单与 henanCities 完全一致', () => {
  assert.deepEqual(migrationCities(), [...henanCities]);
});

test('白名单是 18 个城市且没有重复', () => {
  const cities = migrationCities();
  assert.equal(cities.length, 18);
  assert.equal(new Set(cities).size, cities.length);
  assert.equal(henanCities.length, 18);
  assert.equal(new Set(henanCities).size, henanCities.length);
});

test('地区只到城市级：白名单里不含区县、街道或坐标', () => {
  // 城市名都很短；出现长字符串通常意味着有人把区县或地址塞进了白名单。
  assert.ok(migrationCities().every((city) => Array.from(city).length <= 4));
});
