import assert from 'node:assert/strict';
import test from 'node:test';
import { createInspectionGesture } from './inspection-gesture';

test('单指拖动旋转，移动过后即使回到原处也不触发选择', () => {
  const gesture = createInspectionGesture(); gesture.begin(1, 10, 20, 'touch');
  assert.deepEqual(gesture.move(1, 20, 25), { dx: 10, dy: 5, zoomFactor: 1 });
  gesture.move(1, 10, 20);
  assert.equal(gesture.end(1, 10, 20), false);
  gesture.begin(2, 10, 20, 'mouse'); assert.equal(gesture.end(2, 11, 20), true);
});
test('双指按距离比例缩放，不同时旋转，不触发选择', () => {
  const gesture = createInspectionGesture();
  gesture.begin(1, 0, 0, 'touch'); gesture.begin(2, 100, 0, 'touch');
  assert.deepEqual(gesture.move(2, 150, 0), { dx: 0, dy: 0, zoomFactor: 1.5 });
  assert.deepEqual(gesture.move(1, 50, 0), { dx: 0, dy: 0, zoomFactor: 2 / 3 });
  assert.equal(gesture.end(2, 150, 0), false);
  assert.deepEqual(gesture.move(1, 55, 3), { dx: 5, dy: 3, zoomFactor: 1 });
  assert.equal(gesture.end(1, 55, 3), false);
});
test('零距离、第三指和抬指不会产生无限缩放或误选', () => {
  const gesture = createInspectionGesture();
  gesture.begin(1, 0, 0, 'touch'); gesture.begin(2, 0, 0, 'touch'); gesture.begin(3, 30, 0, 'touch');
  assert.deepEqual(gesture.move(2, 10, 0), { dx: 0, dy: 0, zoomFactor: 1 });
  assert.deepEqual(gesture.move(3, 100, 0), { dx: 0, dy: 0, zoomFactor: 1 });
  assert.equal(gesture.end(1, 0, 0), false); assert.equal(gesture.end(2, 10, 0), false); assert.equal(gesture.end(3, 100, 0), false);
});
test('取消释放全部指针，迟到事件被忽略，下次点击正常', () => {
  const gesture = createInspectionGesture(); gesture.begin(1, 0, 0, 'touch'); gesture.begin(2, 100, 0, 'touch');
  assert.deepEqual(gesture.cancel(), [1, 2]); assert.equal(gesture.has(1), false);
  assert.equal(gesture.move(1, 30, 0), null); assert.equal(gesture.end(2, 100, 0), false);
  gesture.begin(3, 10, 10, 'touch'); assert.equal(gesture.end(3, 10, 10), true);
});
