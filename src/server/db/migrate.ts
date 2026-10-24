import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';

export interface Migration {
  version: number;
  filename: string;
  checksum: string;
  sql: string;
}
type AppliedMigration = Pick<Migration, 'version' | 'filename' | 'checksum'>;

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const [index, filename] of filenames.entries()) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(filename);
    if (!match || Number(match[1]) !== index + 1) {
      throw new Error(`Migration sequence must start at 0001 with no gaps: ${filename}`);
    }
    const sql = await readFile(resolve(directory, filename), 'utf8');
    migrations.push({ version: index + 1, filename, checksum: createHash('sha256').update(sql).digest('hex'), sql });
  }
  if (migrations.length === 0) throw new Error('No SQL migrations found.');
  return migrations;
}

function verifyAppliedMigrations(migrations: readonly Migration[], applied: readonly AppliedMigration[]): void {
  for (const row of applied) {
    const migration = migrations[row.version - 1];
    if (!migration || migration.filename !== row.filename || migration.checksum !== row.checksum) {
      throw new Error(`Applied migration ${row.version} has changed or is missing.`);
    }
  }
  if (applied.some((row, index) => row.version !== index + 1)) {
    throw new Error('Applied migration history is not contiguous.');
  }
}

/** Health checks inspect the migration ledger without applying or repairing migrations. */
export async function verifyMigrationsCurrent(database: Pick<Pool, 'query'>, directory = resolve(process.cwd(), 'migrations')): Promise<void> {
  const migrations = await loadMigrations(directory);
  const applied = await database.query<AppliedMigration>('SELECT version, filename, checksum FROM schema_migrations ORDER BY version');
  verifyAppliedMigrations(migrations, applied.rows);
  if (applied.rows.length !== migrations.length) throw new Error('Database migrations are incomplete.');
}

export async function migrate(pool: Pool, directory = resolve(process.cwd(), 'migrations')): Promise<number[]> {
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [17681001]);
    const server = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    const version = Number(server.rows[0]?.server_version_num);
    if (version < 180000 || version >= 190000 || !Number.isFinite(version)) {
      throw new Error('This application requires PostgreSQL 18.');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<AppliedMigration>(
      'SELECT version, filename, checksum FROM schema_migrations ORDER BY version',
    );
    verifyAppliedMigrations(migrations, applied.rows);
    const newVersions: number[] = [];
    for (const migration of migrations.slice(applied.rows.length)) {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(version, filename, checksum) VALUES ($1, $2, $3)', [
        migration.version, migration.filename, migration.checksum,
      ]);
      newVersions.push(migration.version);
    }
    await client.query('COMMIT');
    return newVersions;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Migration failed and rollback could not be confirmed.');
    }
    throw error;
  } finally {
    client.release();
  }
}
