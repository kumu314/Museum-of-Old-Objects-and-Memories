import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { publicExhibitSchema } from '../../contracts/museum';
import { publicStageItems } from './public-stage-items';

test('published identities, slots and labels survive repeated model keys', () => {
  const first = publicExhibitSchema.parse({ id: randomUUID(), name: '祖父的相机', era: '约八十年代', slotIndex: 5, modelKey: 'camera-01',
    caption: '仅供测试的展签。', photoAssetId: null, audioAssetId: null, approximation: '近似模型', sourceNotice: '合成测试内容' });
  const second = { ...first, id: randomUUID(), name: '另一台相机', slotIndex: 1 };
  const items = publicStageItems([first, second], 'test-token');
  assert.deepEqual(items.map(({ id, slot }) => ({ id, slot })), [{ id: first.id, slot: 5 }, { id: second.id, slot: 1 }]);
  assert.equal(items[0]?.plaqueText, '祖父的相机 · 约八十年代');
  assert.equal(items[1]?.plaqueText, '另一台相机 · 约八十年代');
});

test('photo planes read their snapshot asset through the revocable share endpoint', () => {
  const assetId = randomUUID();
  const exhibit = publicExhibitSchema.parse({ id: randomUUID(), name: '旧照片', era: '记不清', slotIndex: 2, modelKey: 'photo-plane',
    caption: '仅供测试的展签。', photoAssetId: assetId, audioAssetId: null, approximation: '照片薄片', sourceNotice: '合成测试内容' });
  const item = publicStageItems([exhibit], 'token/with?characters')[0];
  assert.ok(item && item.modelKey === 'photo-plane');
  assert.equal(item.photoUrl, `/api/share/token%2Fwith%3Fcharacters/assets/${assetId}`);
  assert.equal(publicExhibitSchema.safeParse({ ...exhibit, photoAssetId: null }).success, false);
});

test('generated models take precedence and use only the revocable snapshot model endpoint', () => {
  const model = randomUUID();
  const exhibit = publicExhibitSchema.parse({ id: randomUUID(), name: '旧相机', era: '约八十年代', slotIndex: 1, modelKey: 'camera-01',
    generatedModelAssetId: model, caption: '合成测试', photoAssetId: null, audioAssetId: null, approximation: '近似', sourceNotice: '测试' });
  const item = publicStageItems([exhibit], 'token/with?characters')[0];
  assert.ok(item?.modelKey === 'glb');
  assert.equal(item.source.url, `/api/share/token%2Fwith%3Fcharacters/model-assets/${model}`);
  assert.equal(item.source.version, model);
});
