import assert from 'node:assert/strict';
import { test } from 'node:test';
import { henanCities } from '../../contracts/discovery';
import { cityPoint, cityPoints, isRegionCity } from './regions';

test('河南白名单是 17 个地级市 + 济源，共 18 个且不重复', () => {
  assert.equal(henanCities.length, 18);
  assert.equal(new Set(henanCities).size, 18);
  assert.ok((henanCities as readonly string[]).includes('济源'));
});

test('每个白名单城市都有中心点，顺序与白名单一致', () => {
  assert.equal(cityPoints.length, henanCities.length);
  assert.deepEqual(cityPoints.map((point) => point.city), [...henanCities]);
  for (const city of henanCities) {
    const point = cityPoint(city);
    assert.ok(point.longitude > 110 && point.longitude < 117, `${city} 经度越界`);
    assert.ok(point.latitude > 31 && point.latitude < 37, `${city} 纬度越界`);
  }
});

test('isRegionCity 只认白名单，自由文本一律拒绝', () => {
  assert.equal(isRegionCity('洛阳'), true);
  assert.equal(isRegionCity('洛阳市涧西区'), false);
  assert.equal(isRegionCity('北京'), false);
  assert.equal(isRegionCity(''), false);
});
