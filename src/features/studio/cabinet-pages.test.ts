import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cabinetPage, cabinetPageCount, cabinetPosition, exhibitsOnPage, firstEmptySlot } from './cabinet-pages';
import { cabinetItems } from './cabinet-items';

test('第七件进入下一页的第一格，场景仅消费当前页的局部格位', () => {
  const exhibits = Array.from({ length: 13 }, (_, slotIndex) => ({ id: `item-${slotIndex}`, name: '演示', era: '待考', modelKey: 'camera-01' as const, photoAssetId: null, slotIndex }));
  assert.equal(firstEmptySlot(exhibits), 13);
  assert.equal(cabinetPageCount(exhibits), 3);
  assert.equal(cabinetPage(6), 1);
  assert.equal(cabinetPosition(6), '第 2 页 · 第 1 格');
  const second = exhibitsOnPage(exhibits, 1);
  assert.deepEqual(second.map(({ id, slotIndex }) => [id, slotIndex]), Array.from({ length: 6 }, (_, index) => [`item-${index + 6}`, index]));
  assert.deepEqual(cabinetItems(second, '/private').map(({ slot }) => slot), [0, 1, 2, 3, 4, 5]);
  assert.equal(exhibits[6]?.slotIndex, 6);
  assert.equal(firstEmptySlot(exhibits.filter(({ slotIndex }) => slotIndex !== 2)), 2);
  assert.deepEqual(exhibitsOnPage(exhibits, 4), []);
});
