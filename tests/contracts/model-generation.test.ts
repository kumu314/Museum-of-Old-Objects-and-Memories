import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { modelInputSchema, modelInputAssetIds, singleModelRequestSchema, multiviewModelRequestSchema } from '../../src/contracts';

const views = { front: randomUUID(), back: randomUUID(), left: randomUUID(), right: randomUUID() };
const task = { expectedVersion: 1, requestId: randomUUID(), generationConsent: true };
test('建模准备可缺图；单图提交必须有素材、来源版本、重复请求标识和明确授权', () => {
  assert.deepEqual(modelInputAssetIds(modelInputSchema.parse({ mode: 'single', imageAssetId: null })), []);
  const request = { ...task, imageAssetId: views.front };
  assert.ok(singleModelRequestSchema.safeParse(request).success);
  for (const key of ['expectedVersion', 'requestId', 'generationConsent', 'imageAssetId']) {
    assert.equal(singleModelRequestSchema.safeParse({ ...request, [key]: undefined }).success, false);
  }
  for (const imageAssetId of ['https://example.test/photo.png', 'C:/private/photo.png', null]) {
    assert.equal(singleModelRequestSchema.safeParse({ ...request, imageAssetId }).success, false);
  }
  assert.equal(singleModelRequestSchema.safeParse({ ...request, generationConsent: false }).success, false);
});
test('四视图提交固定正背左右，缺图、重复照片和未知输入均被拒绝', () => {
  assert.deepEqual(modelInputAssetIds(modelInputSchema.parse({ mode: 'multiview', views })), Object.values(views));
  assert.ok(multiviewModelRequestSchema.safeParse({ ...task, views }).success);
  for (const key of Object.keys(views)) assert.equal(multiviewModelRequestSchema.safeParse({ ...task, views: { ...views, [key]: null } }).success, false);
  assert.equal(multiviewModelRequestSchema.safeParse({ ...task, views: { ...views, back: views.front } }).success, false);
  assert.equal(multiviewModelRequestSchema.safeParse({ ...task, views: { ...views, top: randomUUID() } }).success, false);
});
