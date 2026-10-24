import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readHunyuanCloudConfig } from '../../src/server/integrations/hunyuan3d/config';
import { HttpError } from '../../src/server/http';

test('云 API 配置：三项齐全才启用，未配置返回 undefined，部分配置受控失败', () => {
  assert.equal(readHunyuanCloudConfig({}), undefined);
  assert.throws(
    () => readHunyuanCloudConfig({ HUNYUAN_SECRET_ID: 'id', HUNYUAN_SECRET_KEY: 'key' }),
    (error: unknown) => error instanceof HttpError && error.failure.code === 'GENERATION_UNAVAILABLE',
  );
  const configured = readHunyuanCloudConfig({
    HUNYUAN_SECRET_ID: 'synthetic-id',
    HUNYUAN_SECRET_KEY: 'synthetic-key',
    HUNYUAN_REGION: 'ap-guangzhou',
    HUNYUAN_3D_MODEL: '3.1',
  });
  assert.ok(configured);
  assert.equal(configured.provider, 'hunyuan-cloud');
  assert.equal(configured.config.region, 'ap-guangzhou');
  assert.equal(configured.config.model, '3.1');
});

test('云 API 配置拒绝非法地域与含空白的密钥', () => {
  assert.throws(() => readHunyuanCloudConfig({
    HUNYUAN_SECRET_ID: 'id', HUNYUAN_SECRET_KEY: 'key', HUNYUAN_REGION: 'ap guangzhou',
  }), (error: unknown) => error instanceof HttpError && error.failure.code === 'GENERATION_UNAVAILABLE');
});
