import assert from 'node:assert/strict';
import { test } from 'node:test';
import { henanCities } from '../../contracts/discovery';
import { cityPoint, cityPoints, distributeByCity, isRegionCity } from './regions';

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

test('聚合按固定顺序输出全部 18 个城市，没有馆的补 0', () => {
  const { cities } = distributeByCity([
    { regionCity: '洛阳', viewCount: 12 },
    { regionCity: '洛阳', viewCount: 1 },
    { regionCity: '郑州', viewCount: 9 },
  ]);
  assert.deepEqual(cities.map((bucket) => bucket.city), [...henanCities]);
  const luoyang = cities.find((bucket) => bucket.city === '洛阳');
  const zhengzhou = cities.find((bucket) => bucket.city === '郑州');
  const kaifeng = cities.find((bucket) => bucket.city === '开封');
  assert.deepEqual(luoyang, { city: '洛阳', museumCount: 2, viewCount: 13 });
  assert.deepEqual(zhengzhou, { city: '郑州', museumCount: 1, viewCount: 9 });
  assert.deepEqual(kaifeng, { city: '开封', museumCount: 0, viewCount: 0 });
});

test('未选择城市的馆不进任何城市桶，单独计数', () => {
  const { cities, unplacedMuseums } = distributeByCity([
    { regionCity: null, viewCount: 5 },
    { regionCity: '南阳', viewCount: 2 },
  ]);
  assert.equal(unplacedMuseums, 1);
  assert.equal(cities.reduce((total, bucket) => total + bucket.museumCount, 0), 1);
  assert.equal(cities.reduce((total, bucket) => total + bucket.viewCount, 0), 2);
});

test('空输入也是 18 个零桶，不是空数组', () => {
  const { cities, unplacedMuseums } = distributeByCity([]);
  assert.equal(cities.length, 18);
  assert.ok(cities.every((bucket) => bucket.museumCount === 0 && bucket.viewCount === 0));
  assert.equal(unplacedMuseums, 0);
});
