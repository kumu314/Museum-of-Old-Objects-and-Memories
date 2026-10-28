import assert from 'node:assert/strict';
import test from 'node:test';
import { parseServerConfig } from '../../src/server/config.ts';

const valid = {
  DATABASE_URL: 'postgresql://app:secret@127.0.0.1:15432/shiwuguan',
  TEST_DATABASE_URL: 'postgresql://test:secret@127.0.0.1:15433/shiwuguan',
  SESSION_PASSWORD: 'a'.repeat(48), APP_ORIGIN: 'http://127.0.0.1:17682', UPLOAD_DIR: '/tmp/private-uploads',
};
test('configuration rejects missing secrets, public storage and database alias overlap without leaking values', () => {
  assert.equal(parseServerConfig(valid).appOrigin, valid.APP_ORIGIN);
  assert.throws(() => parseServerConfig({ ...valid, DATABASE_URL: 'secret-invalid-url' }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Invalid server configuration: DATABASE_URL');
    return true;
  });
  assert.throws(() => parseServerConfig({ ...valid, SESSION_PASSWORD: '' }));
  assert.throws(() => parseServerConfig({ ...valid, UPLOAD_DIR: `${process.cwd()}/public/uploads` }));
  assert.throws(() => parseServerConfig({ ...valid, UPLOAD_DIR: `${process.cwd()}/public/..uploads` }));
  assert.throws(() => parseServerConfig({ ...valid, TEST_DATABASE_URL: valid.DATABASE_URL.replace('127.0.0.1', 'localhost') }));
  assert.throws(() => parseServerConfig({ ...valid, NODE_ENV: 'production' }));
});

test('自助注册默认开启，可显式关闭，非法取值直接失败', () => {
  assert.equal(parseServerConfig(valid).selfRegistration, true);
  assert.equal(parseServerConfig({ ...valid, SELF_REGISTRATION: 'open' }).selfRegistration, true);
  assert.equal(parseServerConfig({ ...valid, SELF_REGISTRATION: 'closed' }).selfRegistration, false);
  assert.throws(() => parseServerConfig({ ...valid, SELF_REGISTRATION: 'yes' }));
});

test('每日生成额度默认 10 次，可配置且拒绝越界值', () => {
  assert.equal(parseServerConfig(valid).modelDailyGenerationLimit, 10);
  assert.equal(parseServerConfig({ ...valid, MODEL_DAILY_GENERATION_LIMIT: '3' }).modelDailyGenerationLimit, 3);
  assert.throws(() => parseServerConfig({ ...valid, MODEL_DAILY_GENERATION_LIMIT: '0' }));
  assert.throws(() => parseServerConfig({ ...valid, MODEL_DAILY_GENERATION_LIMIT: '101' }));
  assert.throws(() => parseServerConfig({ ...valid, MODEL_DAILY_GENERATION_LIMIT: 'many' }));
});

test('HTTP 演示需显式开启，HTTPS 会话始终使用安全 Cookie', () => {
  const production = { ...valid, NODE_ENV: 'production' };
  assert.throws(() => parseServerConfig(production));
  assert.throws(() => parseServerConfig({ ...production, DEMO_ALLOW_HTTP: 'false' }));
  assert.throws(() => parseServerConfig({ ...production, DEMO_ALLOW_HTTP: 'yes' }));
  assert.equal(parseServerConfig({ ...production, DEMO_ALLOW_HTTP: 'true' }).secureCookies, false);
  assert.equal(parseServerConfig({ ...production, APP_ORIGIN: 'https://museum.example.test', DEMO_ALLOW_HTTP: 'true' }).secureCookies, true);
});
