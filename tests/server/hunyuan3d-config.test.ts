import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readHunyuanCloudConfig } from '../../src/server/integrations/hunyuan3d/config';
import { HttpError } from '../../src/server/http';

// 本文件断言的是环境变量语义：把可替换配置文件指到不存在的路径，避免本机
// .local/model-provider.json 覆盖环境变量导致结果依赖开发机状态。
const previousConfigPath = process.env.HUNYUAN_PROVIDER_CONFIG;
before(() => { process.env.HUNYUAN_PROVIDER_CONFIG = 'no-such-provider-config.json'; });
after(() => {
  if (previousConfigPath === undefined) delete process.env.HUNYUAN_PROVIDER_CONFIG;
  else process.env.HUNYUAN_PROVIDER_CONFIG = previousConfigPath;
});

test('云 API 配置：三项齐全才启用，未配置返回 undefined，部分配置受控失败', () => {
  assert.equal(readHunyuanCloudConfig({}, 'no-such-provider-config.json'), undefined);
  assert.throws(
    () => readHunyuanCloudConfig({ HUNYUAN_SECRET_ID: 'id', HUNYUAN_SECRET_KEY: 'key' }, 'no-such-provider-config.json'),
    (error: unknown) => error instanceof HttpError && error.failure.code === 'GENERATION_UNAVAILABLE',
  );
  const configured = readHunyuanCloudConfig({
    HUNYUAN_SECRET_ID: 'synthetic-id',
    HUNYUAN_SECRET_KEY: 'synthetic-key',
    HUNYUAN_REGION: 'ap-guangzhou',
    HUNYUAN_3D_MODEL: '3.1',
  }, 'no-such-provider-config.json');
  assert.ok(configured);
  assert.equal(configured.provider, 'hunyuan-cloud');
  assert.equal(configured.config.region, 'ap-guangzhou');
  assert.equal(configured.config.model, '3.1');
});

test('云 API 配置拒绝非法地域与含空白的密钥', () => {
  assert.throws(() => readHunyuanCloudConfig({
    HUNYUAN_SECRET_ID: 'id', HUNYUAN_SECRET_KEY: 'key', HUNYUAN_REGION: 'ap guangzhou',
  }, 'no-such-provider-config.json'), (error: unknown) => error instanceof HttpError && error.failure.code === 'GENERATION_UNAVAILABLE');
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

test('上游失败映射：未开通/地域/鉴权/额度给出可操作提示，且只保留安全错误码', async () => {
  const { describeGenerationFailure } = await import('../../src/server/core/model-generation');
  const { Hunyuan3DError } = await import('../../src/server/integrations/hunyuan3d');
  const notActivated = describeGenerationFailure(new Hunyuan3DError('UPSTREAM_ERROR', 'x', { upstreamCode: 'ResourceUnavailable.NotExist' }));
  assert.equal(notActivated.code, 'ResourceUnavailable.NotExist');
  assert.match(notActivated.message, /未开通/);
  const region = describeGenerationFailure(new Hunyuan3DError('UPSTREAM_ERROR', 'x', { upstreamCode: 'UnsupportedRegion' }));
  assert.match(region.message, /ap-guangzhou/);
  const quota = describeGenerationFailure(new Hunyuan3DError('UPSTREAM_ERROR', 'x', { upstreamCode: 'FailedOperation.InsufficientBalance' }));
  assert.equal(quota.code, 'FailedOperation.InsufficientBalance');
  assert.match(quota.message, /额度/);
  // 自由文本形态的上游码不得进入任务错误码。
  const unsafe = describeGenerationFailure(new Hunyuan3DError('UPSTREAM_ERROR', 'x', { upstreamCode: 'bad code with spaces' }));
  assert.equal(unsafe.code, 'UPSTREAM_ERROR');
});
