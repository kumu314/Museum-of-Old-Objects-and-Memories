import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '@/server/config/env';
import { createPool } from '@/server/db/connection';
import { migrate } from '@/server/db/migrate';

// 只替换 Next.js 的导入标记，pg、SQL 和数据库全部真实执行。
vi.mock('server-only', () => ({}));

const config = loadEnv(process.env);
const pool = createPool(config.TEST_DATABASE_URL);
const fixtureDirectory = fileURLToPath(new URL('../fixtures/migrations/', import.meta.url));
async function withDatabase(run: (client: PoolClient, directory: string, schema: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'shiwuguan-migrations-'));
  try {
    await cp(fixtureDirectory, directory, { recursive: true });
    const client = await pool.connect();
    // 名称仅由本次生成的 UUID 构成，不接收外部输入，不触碰已有业务 schema。
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await run(client, directory, schema);
    } finally {
      try {
        await client.query('ROLLBACK');
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        client.release();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

afterAll(async () => { await pool.end(); });

describe('真实 PostgreSQL 基线', () => {
  it('连接目标为隔离测试库且版本为 PostgreSQL 17', () => withDatabase(async (client) => {
    const result = await client.query('SELECT current_database() AS database, current_setting($1) AS version', ['server_version_num']);
    const row = z.object({ database: z.string(), version: z.string() }).parse(result.rows[0]);
    expect(row.database).toBe(decodeURIComponent(new URL(config.TEST_DATABASE_URL).pathname.slice(1)));
    expect(row.version).toMatch(/^17\d{4}$/);
  }));

  it('顺序迁移真实表结构，重复运行不重复执行', () => withDatabase(async (client, directory) => {
    expect(await migrate(client, directory)).toEqual(['0001_create_entries.sql', '0002_add_note.sql']);
    expect(await migrate(client, directory)).toEqual([]);
    await client.query('INSERT INTO entries (id, title, note) VALUES ($1, $2, $3)', [1, '合成展品', '测试']);
    expect((await client.query('SELECT * FROM entries')).rows).toEqual([{ id: 1, title: '合成展品', note: '测试' }]);
  }));

  it('拒绝修改已应用的迁移，并保留原表', () => withDatabase(async (client, directory) => {
    await migrate(client, directory);
    await writeFile(join(directory, '0001_create_entries.sql'), 'DROP TABLE entries;');
    await expect(migrate(client, directory)).rejects.toThrow('已应用的迁移缺失或被修改');
    expect((await client.query('SELECT * FROM entries')).rows).toEqual([]);
  }));

  it('迁移编号不连续时，在执行 SQL 前失败', () => withDatabase(async (client, directory, schema) => {
    await writeFile(join(directory, '0004_gap.sql'), 'CREATE TABLE unexpected (id integer);');
    await expect(migrate(client, directory)).rejects.toThrow('连续编号');
    expect((await client.query('SELECT tablename FROM pg_tables WHERE schemaname = $1', [schema])).rows).toEqual([]);
  }));

  it('两个连接同时迁移，只应用一次', () => withDatabase(async (client, directory, schema) => {
    const other = await pool.connect();
    try {
      await other.query(`SET search_path TO "${schema}"`);
      const results = await Promise.all([migrate(client, directory), migrate(other, directory)]);
      expect(results.map((result) => result.length).sort()).toEqual([0, 2]);
    } finally {
      other.release();
    }
  }));

  it('迁移中途失败时，DDL 与迁移账本全部回滚', () => withDatabase(async (client, directory, schema) => {
    await writeFile(join(directory, '0003_fail.sql'), 'SELECT missing_column FROM entries;');
    await expect(migrate(client, directory)).rejects.toMatchObject({ code: '42703' });
    const result = await client.query('SELECT tablename FROM pg_tables WHERE schemaname = $1', [schema]);
    expect(result.rows).toEqual([]);
  }));

  it('提交的数据能被另一连接读取', () => withDatabase(async (client, directory, schema) => {
    await migrate(client, directory);
    await client.query('BEGIN');
    await client.query('INSERT INTO entries (id, title) VALUES ($1, $2)', [1, '提交测试']);
    await client.query('COMMIT');
    expect((await pool.query(`SELECT title FROM "${schema}".entries`)).rows).toEqual([{ title: '提交测试' }]);
  }));

  it('约束失败后回滚，前面的写入也不保留', () => withDatabase(async (client, directory, schema) => {
    await migrate(client, directory);
    await client.query('BEGIN');
    await client.query('INSERT INTO entries (id, title) VALUES ($1, $2)', [1, '回滚测试']);
    await expect(client.query('INSERT INTO entries (id, title) VALUES ($1, $2)', [1, '重复主键']))
      .rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK');
    expect((await pool.query(`SELECT * FROM "${schema}".entries`)).rows).toEqual([]);
  }));
});
