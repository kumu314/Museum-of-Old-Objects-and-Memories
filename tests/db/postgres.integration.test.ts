import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';

const connectionString = getIsolatedTestDatabaseUrl();
const fixtures = fileURLToPath(new URL('../fixtures/migrations/', import.meta.url));
async function withDatabase(run: (pool: Pool, client: PoolClient, directory: string, schema: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'shiwuguan-migrations-'));
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  try {
    await cp(fixtures, directory, { recursive: true });
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await run(pool, client, directory, schema);
    } finally {
      try {
        await client.query('ROLLBACK');
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally { client.release(); }
    }
  } finally {
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
}

test('connection uses the isolated database and PostgreSQL 18', () => withDatabase(async (_pool, client) => {
  const result = await client.query<{ database: string; version: string }>('SELECT current_database() AS database, current_setting($1) AS version', ['server_version_num']);
  assert.equal(result.rows[0]?.database, decodeURIComponent(new URL(connectionString).pathname.slice(1)));
  assert.match(result.rows[0]?.version ?? '', /^18\d{4}$/);
}));
test('ordered migrations change real tables and run once', () => withDatabase(async (pool, client, directory) => {
  assert.deepEqual(await migrate(pool, directory), [1, 2]);
  assert.deepEqual(await migrate(pool, directory), []);
  await client.query('INSERT INTO entries (id, title, note) VALUES ($1, $2, $3)', [1, '合成展品', '测试']);
  assert.deepEqual((await client.query('SELECT * FROM entries')).rows, [{ id: 1, title: '合成展品', note: '测试' }]);
}));
test('modified historical migration is rejected without changing its table', () => withDatabase(async (pool, client, directory) => {
  await migrate(pool, directory);
  await writeFile(join(directory, '0001_create_entries.sql'), 'DROP TABLE entries;');
  await assert.rejects(migrate(pool, directory), /has changed or is missing/);
  assert.deepEqual((await client.query('SELECT * FROM entries')).rows, []);
}));
test('sequence gaps are rejected before executing SQL', () => withDatabase(async (pool, client, directory, schema) => {
  await writeFile(join(directory, '0004_gap.sql'), 'CREATE TABLE unexpected (id integer);');
  await assert.rejects(migrate(pool, directory), /no gaps/);
  assert.deepEqual((await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])).rows, []);
}));
test('concurrent connections apply pending migrations once', () => withDatabase(async (pool, _client, directory) => {
  const results = await Promise.all([migrate(pool, directory), migrate(pool, directory)]);
  assert.deepEqual(results.map((result) => result.length).sort(), [0, 2]);
}));
test('failed migration rolls back both DDL and ledger', () => withDatabase(async (pool, client, directory, schema) => {
  await writeFile(join(directory, '0003_fail.sql'), 'SELECT missing_column FROM entries;');
  await assert.rejects(migrate(pool, directory), { code: '42703' });
  assert.deepEqual((await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])).rows, []);
}));
test('committed data can be read by another connection', () => withDatabase(async (pool, client, directory) => {
  await migrate(pool, directory);
  await client.query('BEGIN');
  await client.query('INSERT INTO entries (id,title) VALUES ($1,$2)', [1, '提交测试']);
  await client.query('COMMIT');
  assert.deepEqual((await pool.query('SELECT title FROM entries')).rows, [{ title: '提交测试' }]);
}));
test('constraint failure rollback preserves no partial writes', () => withDatabase(async (pool, client, directory) => {
  await migrate(pool, directory);
  await client.query('BEGIN');
  await client.query('INSERT INTO entries (id,title) VALUES ($1,$2)', [1, '回滚测试']);
  await assert.rejects(client.query('INSERT INTO entries (id,title) VALUES ($1,$2)', [1, '重复主键']), { code: '23505' });
  await client.query('ROLLBACK');
  assert.deepEqual((await pool.query('SELECT * FROM entries')).rows, []);
}));
