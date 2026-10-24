import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { loadMigrations, verifyMigrationsCurrent, type Migration } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
after(async () => { await pool.end(); });

async function withLedger(work: (client: PoolClient, migrations: Migration[]) => Promise<void>, createLedger = true): Promise<void> {
  const migrations = await loadMigrations('migrations');
  const client = await pool.connect();
  const schema = `readiness_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    if (createLedger) {
      await client.query(`CREATE TABLE schema_migrations (
        version integer PRIMARY KEY, filename text NOT NULL UNIQUE, checksum text NOT NULL
      )`);
      for (const migration of migrations) {
        await client.query('INSERT INTO schema_migrations(version,filename,checksum) VALUES($1,$2,$3)',
          [migration.version, migration.filename, migration.checksum]);
      }
    }
    await work(client, migrations);
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { client.release(); }
  }
}

test('readiness accepts every current migration without changing its ledger', () => withLedger(async (client) => {
  const before = await client.query('SELECT * FROM schema_migrations ORDER BY version');
  await verifyMigrationsCurrent(client);
  assert.deepEqual((await client.query('SELECT * FROM schema_migrations ORDER BY version')).rows, before.rows);
}));

test('readiness rejects the formerly accepted first-migration-only database', () => withLedger(async (client) => {
  await client.query('DELETE FROM schema_migrations WHERE version > 1');
  await assert.rejects(verifyMigrationsCurrent(client), /migrations are incomplete/);
  assert.deepEqual((await client.query('SELECT version FROM schema_migrations')).rows, [{ version: 1 }]);
}));

test('readiness rejects an internal gap even when the latest version is present', () => withLedger(async (client) => {
  await client.query('DELETE FROM schema_migrations WHERE version = 2');
  await assert.rejects(verifyMigrationsCurrent(client), /not contiguous/);
}));

test('readiness rejects a changed historical checksum', () => withLedger(async (client) => {
  await client.query("UPDATE schema_migrations SET checksum = 'changed-checksum' WHERE version = 1");
  await assert.rejects(verifyMigrationsCurrent(client), /Applied migration 1 has changed or is missing/);
}));

test('readiness rejects a renamed historical migration', () => withLedger(async (client) => {
  await client.query("UPDATE schema_migrations SET filename = '0001_renamed.sql' WHERE version = 1");
  await assert.rejects(verifyMigrationsCurrent(client), /Applied migration 1 has changed or is missing/);
}));

test('readiness rejects migrations unknown to this application version', () => withLedger(async (client, migrations) => {
  await client.query('INSERT INTO schema_migrations(version,filename,checksum) VALUES($1,$2,$3)',
    [migrations.length + 1, 'future_migration.sql', 'future-checksum']);
  await assert.rejects(verifyMigrationsCurrent(client), /has changed or is missing/);
}));

test('readiness rejects a missing ledger without creating one', () => withLedger(async (client) => {
  await client.query('SAVEPOINT before_readiness');
  await assert.rejects(verifyMigrationsCurrent(client), { code: '42P01' });
  await client.query('ROLLBACK TO SAVEPOINT before_readiness');
  assert.equal((await client.query("SELECT to_regclass('schema_migrations') AS ledger")).rows[0]?.ledger, null);
}, false));
