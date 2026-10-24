import assert from 'node:assert/strict';
import test from 'node:test';
import { cabinetItems, type CabinetExhibit } from './cabinet-items';

const photo: CabinetExhibit = {
  id: 'photo', name: '测试照片', era: '年代待考', slotIndex: 4,
  modelKey: 'photo-plane', photoAssetId: 'owned-photo',
};

test('照片展示使用调用方的受保护素材入口，不把照片替换为演示模型', () => {
  const items = cabinetItems([photo], '/api/museums/owner-museum/assets');
  assert.deepEqual(items, [{ id: 'photo', slot: 4, modelKey: 'photo-plane', photoUrl: '/api/museums/owner-museum/assets/owned-photo' }]);
  assert.equal(photo.photoAssetId, 'owned-photo');
});

test('缺图草稿不进入场景；其他格位仍可展示，既有内置模型协议不变', () => {
  const items = cabinetItems([{ ...photo, photoAssetId: null }, { ...photo, id: 'camera', slotIndex: 0, modelKey: 'camera-01' }], '/api/museums/m/assets');
  assert.deepEqual(items, [{ id: 'camera', slot: 0, modelKey: 'camera-01' }]);
});

test('参观场景只引用分享素材入口，素材标识编码为单一路径段', () => {
  const items = cabinetItems([{ ...photo, photoAssetId: 'not/a/path' }], '/api/share/test-token/assets');
  assert.deepEqual(items, [{ id: 'photo', slot: 4, modelKey: 'photo-plane', photoUrl: '/api/share/test-token/assets/not%2Fa%2Fpath' }]);
});
