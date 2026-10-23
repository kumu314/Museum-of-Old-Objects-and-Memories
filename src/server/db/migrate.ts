import 'server-only';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { z } from 'zod';

const AppliedMigrations = z.array(z.object({ name: z.string(), checksum: z.string() }));

/** SQL 来自受版本控制的服务端目录；同一批迁移与账本更新在同一事务提交。 */
export async function migrate(client: PoolClient, directory: string): Promise<string[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const migrations = await Promise.all(names.map(async (name, index) => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name) || Number(name.slice(0, 4)) !== index + 1) {
      throw new Error('迁移必须从 0001 开始连续编号，文件名使用小写英文与下划线');
    }
    const sql = await readFile(join(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));

  await client.query('BEGIN');
  try {
    // 防止两个迁移进程同时读取旧账本并重复执行 SQL；锁随事务结束释放。
    await client.query('SELECT pg_advisory_xact_lock(7347, 1)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const result = await client.query('SELECT name, checksum FROM schema_migrations ORDER BY name');
    const applied = AppliedMigrations.parse(result.rows);
    for (const [index, previous] of applied.entries()) {
      const current = migrations[index];
      if (!current || current.name !== previous.name || current.checksum !== previous.checksum) {
        throw new Error(`已应用的迁移缺失或被修改：${previous.name}`);
      }
    }
    const pending = migrations.slice(applied.length);
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name, migration.checksum,
      ]);
    }
    await client.query('COMMIT');
    return pending.map((migration) => migration.name);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], '迁移失败，回滚也未完成');
    }
    throw error;
  }
}
