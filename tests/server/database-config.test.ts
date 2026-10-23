import assert from 'node:assert/strict';
import test from 'node:test';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';

const development = 'postgresql://app@localhost:5432/shiwuguan_dev';
const isolated = 'postgresql://app@localhost:5432/shiwuguan_test';
test('different databases are accepted', () => {
  assert.equal(getIsolatedTestDatabaseUrl({ DATABASE_URL: development, TEST_DATABASE_URL: isolated }), isolated);
});
test('the same database is rejected', () => {
  assert.throws(() => getIsolatedTestDatabaseUrl({ DATABASE_URL: development, TEST_DATABASE_URL: development }), /separate database/);
});
test('credentials, protocol aliases and default ports do not bypass isolation', () => {
  assert.throws(() => getIsolatedTestDatabaseUrl({
    DATABASE_URL: 'postgresql://dev@localhost/shiwuguan',
    TEST_DATABASE_URL: 'postgres://test@127.0.0.1:5432/shiwuguan',
  }), /separate database/);
});
for (const value of ['invalid', 'https://localhost/database', 'postgresql://localhost', 'postgresql://localhost/%invalid', 'postgresql://localhost/dev?dbname=production']) {
  test(`rejects invalid database target ${value} without exposing its value`, () => {
    assert.throws(() => getIsolatedTestDatabaseUrl({ DATABASE_URL: value, TEST_DATABASE_URL: isolated }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(value), false);
      return true;
    });
  });
}
test('missing configuration names the required fields without exposing values', () => {
  assert.throws(() => getIsolatedTestDatabaseUrl({ TEST_DATABASE_URL: isolated }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /DATABASE_URL/);
    assert.equal(error.message.includes(isolated), false);
    return true;
  });
});
