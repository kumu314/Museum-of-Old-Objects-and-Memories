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
