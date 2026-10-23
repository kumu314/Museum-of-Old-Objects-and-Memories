import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PLAQUE_LENGTH,
  moveExhibitToSlot,
  setPlaqueText,
  validateArrangement,
  type CabinetArrangement,
} from './cabinet-arrangement.ts';

const arrangement: CabinetArrangement = Object.freeze([
  Object.freeze({ id: 'camera-01', slot: 0, plaqueText: '复古相机 · 年代待考' }),
  Object.freeze({ id: 'cassette', slot: 1, plaqueText: '手录磁带 · 年代待考' }),
  Object.freeze({ id: 'ticket', slot: 4, plaqueText: '旧车票 · 年代待考' }),
]);
const ids = arrangement.map(entry => entry.id);

test('拖到空格仅移动指定展品，保留顺序、铭牌和原始数据', () => {
  const result = moveExhibitToSlot(arrangement, 'cassette', 5);
  assert.deepEqual(result, [arrangement[0], { id: 'cassette', slot: 5, plaqueText: '手录磁带 · 年代待考' }, arrangement[2]]);
  assert.equal(result[0], arrangement[0]);
  assert.equal(result[2], arrangement[2]);
  assert.equal(arrangement[1]?.slot, 1);
});

test('拖到已有展品的柜格交换位置，铭牌跟随各自展品', () => {
  const result = moveExhibitToSlot(arrangement, 'camera-01', 4);
  assert.deepEqual(result, [
    { id: 'camera-01', slot: 4, plaqueText: '复古相机 · 年代待考' },
    arrangement[1],
    { id: 'ticket', slot: 0, plaqueText: '旧车票 · 年代待考' },
  ]);
  assert.equal(result[1], arrangement[1]);
  assert.deepEqual(moveExhibitToSlot(result, 'camera-01', 0), arrangement);
});

test('重复移动到当前位置不会交换回去或产生额外变化', () => {
  const result = moveExhibitToSlot(arrangement, 'camera-01', 4);
  assert.equal(moveExhibitToSlot(result, 'camera-01', 4), result);
  assert.equal(moveExhibitToSlot(arrangement, 'cassette', 1), arrangement);
});

test('移动拒绝未知展品和六格范围外的目标', () => {
  assert.throws(() => moveExhibitToSlot(arrangement, 'missing', 2), /未知展品/);
  for (const slot of [-1, 6, 1.5, NaN, Infinity]) {
    assert.throws(() => moveExhibitToSlot(arrangement, 'cassette', slot), /柜格必须/);
  }
});

test('修改铭牌只改变目标文字，去除首尾空白并保留原始数据', () => {
  const result = setPlaqueText(arrangement, 'ticket', '  北京 ──> 上海 · 2003 年  ');
  assert.deepEqual(result[2], { id: 'ticket', slot: 4, plaqueText: '北京 ──> 上海 · 2003 年' });
  assert.equal(result[0], arrangement[0]);
  assert.equal(result[1], arrangement[1]);
  assert.equal(arrangement[2]?.plaqueText, '旧车票 · 年代待考');
  assert.equal(setPlaqueText(result, 'ticket', '北京 ──> 上海 · 2003 年'), result);
});

test('铭牌长度按 Unicode 码点计算，接受 24 个字符并拒绝第 25 个', () => {
  const text = '𠮷'.repeat(MAX_PLAQUE_LENGTH);
  assert.equal(setPlaqueText(arrangement, 'ticket', `  ${text}  `)[2]?.plaqueText, text);
  assert.throws(() => setPlaqueText(arrangement, 'ticket', `${text}字`), /不能超过 24/);
  assert.throws(() => setPlaqueText(arrangement, 'ticket', '字'.repeat(25)), /不能超过 24/);
});

test('拒绝空白铭牌和对未知展品的铭牌修改', () => {
  for (const text of ['', ' \n\t　']) {
    assert.throws(() => setPlaqueText(arrangement, 'ticket', text), /不能为空/);
  }
  assert.throws(() => setPlaqueText(arrangement, 'missing', '新铭牌'), /未知展品/);
});

test('有效存储数据按明确字段恢复、规范铭牌空白且保留存储顺序', () => {
  const stored = [
    { id: 'ticket', slot: 5, plaqueText: ' 旧车票 ', extra: '不进入陈列状态' },
    { id: 'camera-01', slot: 2, plaqueText: '相机' },
    { id: 'cassette', slot: 0, plaqueText: '磁带' },
  ];
  assert.deepEqual(validateArrangement(stored, ids), [
    { id: 'ticket', slot: 5, plaqueText: '旧车票' },
    { id: 'camera-01', slot: 2, plaqueText: '相机' },
    { id: 'cassette', slot: 0, plaqueText: '磁带' },
  ]);
  assert.equal(stored[0]?.plaqueText, ' 旧车票 ');
});

test('存储必须包含完整且唯一的预期展品集合', () => {
  assert.throws(() => validateArrangement(arrangement.slice(0, 2), ids), /包含全部展品/);
  assert.throws(() => validateArrangement([...arrangement, { id: 'extra', slot: 3, plaqueText: '额外' }], ids), /包含全部展品/);
  assert.throws(() => validateArrangement([arrangement[0], arrangement[1], { id: 'extra', slot: 4, plaqueText: '额外' }], ids), /未知展品/);
  assert.throws(() => validateArrangement([arrangement[0], arrangement[1], { id: 'cassette', slot: 4, plaqueText: '重复' }], ids), /ID 重复/);
});

test('拒绝非数组及不完整、错误类型的存储条目', () => {
  for (const value of [undefined, null, '', 1, {}]) {
    assert.throws(() => validateArrangement(value, ids), /必须为数组/);
  }
  for (const entry of [null, 1, {}, { id: 1 }, { id: 'ticket' }, { id: 'ticket', slot: 4 }]) {
    assert.throws(() => validateArrangement([arrangement[0], arrangement[1], entry], ids), /展品 ID|缺少柜格|缺少铭牌/);
  }
  assert.throws(() => validateArrangement(new Array<unknown>(3), ids), /展品 ID/);
});

test('存储拒绝重复柜格和无效格位', () => {
  assert.throws(() => validateArrangement([arrangement[0], arrangement[1], { id: 'ticket', slot: 1, plaqueText: '车票' }], ids), /柜格重复/);
  for (const slot of [-1, 6, 1.5, NaN, Infinity, '4', null]) {
    assert.throws(() => validateArrangement([arrangement[0], arrangement[1], { id: 'ticket', slot, plaqueText: '车票' }], ids), /柜格必须/);
  }
});

test('存储铭牌遵守与编辑相同的文字规则', () => {
  for (const plaqueText of [null, 1, '', '  ', '𠮷'.repeat(25)]) {
    assert.throws(() => validateArrangement([arrangement[0], arrangement[1], { id: 'ticket', slot: 4, plaqueText }], ids), /铭牌文字/);
  }
  assert.equal(validateArrangement([
    arrangement[0], arrangement[1], { id: 'ticket', slot: 4, plaqueText: ` ${'𠮷'.repeat(24)} ` },
  ], ids)[2]?.plaqueText, '𠮷'.repeat(24));
});
