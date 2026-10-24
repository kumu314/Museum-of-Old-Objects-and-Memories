import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelGenerationJob } from '../../contracts/model-generation';
import { modelResultState } from './model-generation-state';

const completed: ModelGenerationJob = {
  id: 'job', exhibitId: 'exhibit', status: 'DONE', sourceVersion: 2,
  errorCode: null, errorMessage: null, modelAssetId: 'model', stats: null, createdAt: '2026-10-25',
};

test('采纳增加版本及后续编辑不将当前采用的模型误报为旧候选', () => {
  assert.equal(modelResultState(completed, 3, 'model'), 'adopted');
  assert.equal(modelResultState(completed, 4, 'model'), 'adopted');
});

test('切回照片或换用其他模型后，旧任务不再标记为当前已采用', () => {
  assert.equal(modelResultState(completed, 4, null), 'stale');
  assert.equal(modelResultState(completed, 4, 'other-model'), 'stale');
  assert.equal(modelResultState(completed, 2, null), 'ready');
});

test('无任务及尚未生成模型不视为已采纳', () => {
  assert.equal(modelResultState(null, 2, null), 'pending');
  assert.equal(modelResultState({ ...completed, status: 'RUN' }, 2, null), 'pending');
  assert.equal(modelResultState({ ...completed, modelAssetId: null }, 2, null), 'ready');
});
