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


test('云 API 配置由 schema 拒绝未知模型', () => {
  assert.throws(() => readHunyuanCloudConfig({
    HUNYUAN_SECRET_ID: 'synthetic-id', HUNYUAN_SECRET_KEY: 'synthetic-key',
    HUNYUAN_REGION: 'ap-guangzhou', HUNYUAN_3D_MODEL: 'unknown',
  }), HttpError);
});

test('官方端点覆盖和不安全结果仅允许测试环境环回服务', async () => {
  const credentials = {
    HUNYUAN_SECRET_ID: 'synthetic-id', HUNYUAN_SECRET_KEY: 'synthetic-key', HUNYUAN_REGION: 'ap-guangzhou',
  };
  for (const NODE_ENV of ['production', 'development', undefined]) {
    assert.throws(() => readHunyuanCloudConfig({ ...credentials, NODE_ENV, HUNYUAN_3D_ENDPOINT: 'http://127.0.0.1:1234' }), HttpError);
    assert.throws(() => readHunyuanCloudConfig({ ...credentials, NODE_ENV, HUNYUAN_CLOUD_ALLOW_INSECURE_RESULT: '1' }), HttpError);
  }
  const environment = { ...credentials, NODE_ENV: 'test', HUNYUAN_CLOUD_ALLOW_INSECURE_RESULT: '1' };
  for (const HUNYUAN_3D_ENDPOINT of ['http://127.0.0.1:1234', 'http://[::1]:1234']) {
    const result = readHunyuanCloudConfig({ ...environment, HUNYUAN_3D_ENDPOINT });
    assert.ok(result);
    assert.equal(result.config.endpoint, HUNYUAN_3D_ENDPOINT);
    await result.config.resultUrlPolicy?.(new URL(`${HUNYUAN_3D_ENDPOINT}/model.glb`));
  }
  const configured = readHunyuanCloudConfig(environment);
  assert.ok(configured);
  for (const value of ['invalid', 'http://169.254.169.254', 'https://example.com', 'http://user:pass@127.0.0.1', 'file:///tmp/model.glb']) {
    assert.throws(() => readHunyuanCloudConfig({ ...environment, HUNYUAN_3D_ENDPOINT: value }), HttpError);
    if (value !== 'invalid') await assert.rejects(async () => configured.config.resultUrlPolicy?.(new URL(value)));
  }
});


test('可替换配置文件：优先于环境变量，改文件即可换 API 与凭据', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readHunyuanCloudConfig, readForcedProvider, readProviderSettings } = await import('../../src/server/integrations/hunyuan3d/config');
  const directory = await mkdtemp(join(tmpdir(), 'provider-settings-'));
  const file = join(directory, 'model-provider.json');
  try {
    await writeFile(file, JSON.stringify({
      provider: 'hunyuan-cloud',
      cloud: { secretId: 'file-id', secretKey: 'file-key', region: 'ap-shanghai', model: '3.0', endpoint: 'https://gateway.example.com/ai3d' },
    }));
    const configured = readHunyuanCloudConfig({ HUNYUAN_SECRET_ID: 'env-id', HUNYUAN_SECRET_KEY: 'env-key', HUNYUAN_REGION: 'ap-guangzhou' }, file);
    assert.ok(configured);
    assert.equal(configured.config.secretId, 'file-id', '配置文件必须优先于环境变量');
    assert.equal(configured.config.region, 'ap-shanghai');
    assert.equal(configured.config.endpoint, 'https://gateway.example.com/ai3d');
    assert.equal(configured.config.model, '3.0');
    assert.equal(readForcedProvider({ HUNYUAN_PROVIDER: 'proxy' }, file), 'hunyuan-cloud');

    await writeFile(file, JSON.stringify({ cloud: { secretId: 'id', secretKey: 'key', region: 'ap-guangzhou', endpoint: 'http://remote.example.com' } }));
    assert.throws(() => readHunyuanCloudConfig({}, file),
      (error: unknown) => error instanceof HttpError && error.failure.code === 'GENERATION_UNAVAILABLE');

    await writeFile(file, '{ not json');
    assert.throws(() => readProviderSettings(file),
      (error: unknown) => error instanceof HttpError && error.failure.code === 'GENERATION_UNAVAILABLE');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
