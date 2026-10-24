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

test('已采纳生成模型默认渲染 GLB；该模型加载失败时回退为照片', () => {
  const adopted: CabinetExhibit = { ...photo, generatedModelAssetId: 'model-asset-1' };
  const withModel = cabinetItems([adopted], '/api/museums/owner-museum/assets', '/api/museums/owner-museum/model-assets');
  assert.ok(withModel[0] && withModel[0].modelKey === 'glb');
  if (withModel[0].modelKey === 'glb') {
    assert.equal(withModel[0].source.assetId, 'model-asset-1');
    assert.equal(withModel[0].source.url, '/api/museums/owner-museum/model-assets/model-asset-1');
  }
  const fallback = cabinetItems([adopted], '/api/museums/owner-museum/assets', '/api/museums/owner-museum/model-assets', new Set(['model-asset-1']));
  assert.ok(fallback[0] && fallback[0].modelKey === 'photo-plane');
});

test('生成模型失败优先使用实拍；替换模型不继承旧模型的失败状态', () => {
  const adopted: CabinetExhibit = { ...photo, modelKey: 'camera-01', generatedModelAssetId: 'failed-model' };
  const failures = new Set(['failed-model']);
  const fallback = cabinetItems([adopted], '/assets', '/models', failures);
  assert.deepEqual(fallback, [{ id: photo.id, slot: photo.slotIndex, modelKey: 'photo-plane', photoUrl: '/assets/owned-photo' }]);
  const replacement = cabinetItems([{ ...adopted, generatedModelAssetId: 'new-model' }], '/assets', '/models', failures);
  assert.deepEqual(replacement, [{ id: photo.id, slot: photo.slotIndex, modelKey: 'glb', source: { assetId: 'new-model', version: 'new-model', url: '/models/new-model' } }]);
});
