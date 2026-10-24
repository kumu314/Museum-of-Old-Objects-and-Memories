import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';

test('归属迁移保留历史账号、展馆及登录节流记录，并且可重复执行', async () => {
  const connectionString = getIsolatedTestDatabaseUrl();
  const admin = new Pool({ connectionString, max: 1 });
  const schema = `ownership_upgrade_${randomUUID().replaceAll('-', '')}`;
  const legacy = await mkdtemp(join(tmpdir(), 'museum-ownership-upgrade-'));
  const pool = new Pool({ connectionString, max: 1, options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const file of ['0001_initial.sql', '0002_auth.sql']) {
      await copyFile(join('migrations', file), join(legacy, file));
    }
    assert.deepEqual(await migrate(pool, legacy), [1, 2]);
    const owner = randomUUID();
    const museum = randomUUID();
    await pool.query("INSERT INTO team_members(id,username,password_hash) VALUES($1,'legacy-owner','test-only')", [owner]);
    await pool.query("INSERT INTO museums(id,title,created_by) VALUES($1,'历史展馆',$2)", [museum, owner]);
    await pool.query("INSERT INTO login_attempts(username,attempts,window_started_at) VALUES('register:legacy-owner',7,now())");
    assert.deepEqual(await migrate(pool), [3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(await migrate(pool), []);
    const saved = await pool.query('SELECT m.id,m.title,m.created_by,u.role FROM museums m JOIN team_members u ON u.id=m.created_by');
    assert.deepEqual(saved.rows, [{ id: museum, title: '历史展馆', created_by: owner, role: 'member' }]);
    assert.deepEqual((await pool.query('SELECT scope,username,attempts FROM login_attempts')).rows,
      [{ scope: 'login', username: 'register:legacy-owner', attempts: 7 }]);
    await assert.rejects(pool.query('UPDATE museums SET created_by=$1 WHERE id=$2', [randomUUID(), museum]), { code: '23514' });
    assert.equal((await pool.query('SELECT created_by FROM museums WHERE id=$1', [museum])).rows[0]?.created_by, owner);
  } finally {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); await rm(legacy, { recursive: true, force: true }); }
  }
});
