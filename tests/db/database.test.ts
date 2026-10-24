import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { migrate } from '../../src/server/db/migrate';
import { withTransaction } from '../../src/server/db/pool';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 3, connectionTimeoutMillis: 5000 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

async function rollbackFixture(work: (client: PoolClient, memberId: string, museumId: string) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const memberId = randomUUID();
    const museumId = randomUUID();
    await client.query('INSERT INTO users(id, username, password_hash) VALUES ($1,$2,$3)', [memberId, `test-${memberId}`, 'test-only-not-a-password']);
    await client.query('INSERT INTO museums(id,title,created_by) VALUES ($1,$2,$3)', [museumId, '约束测试展馆', memberId]);
    await work(client, memberId, museumId);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function rejectedStatement(client: PoolClient, sql: string, values: readonly unknown[], code: string): Promise<void> {
  await client.query('SAVEPOINT expected_rejection');
  await assert.rejects(client.query(sql, [...values]), { code });
  await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
  await client.query('RELEASE SAVEPOINT expected_rejection');
}

async function insertImage(client: PoolClient, memberId: string, museumId: string): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
    VALUES($1,$2,'test.webp','image','image/webp',100,$3,10,10,$4,$5)`, [id, museumId, `${id}.webp`, '0'.repeat(64), memberId]);
  return id;
}

test('migration is idempotent under concurrent startup and rejects changes to applied SQL', async () => {
  assert.deepEqual(await Promise.all([migrate(pool), migrate(pool)]), [[], []]);
  const temporary = await mkdtemp(join(tmpdir(), 'museum-migration-'));
  try {
    const source = await readFile('migrations/0001_initial.sql', 'utf8');
    await writeFile(join(temporary, '0001_initial.sql'), `${source}\n-- changed after application\n`);
    await assert.rejects(migrate(pool, temporary), /has changed or is missing/);
    assert.deepEqual(await migrate(pool), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('个人展馆迁移遇到旧的多馆账号会整体回滚，处理归属后保留内容并开放第七格', async () => {
  const db = await pool.connect();
  const schema = `owner_upgrade_${randomUUID().replaceAll('-', '')}`;
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}"`);
    for (const file of ['0001_initial.sql', '0002_auth.sql', '0003_self_service_users.sql']) await db.query(await readFile(`migrations/${file}`, 'utf8'));
    const actor = randomUUID();
    await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [actor, 'legacy-upgrade-test', 'test-only']);
    await db.query("INSERT INTO museums(title,created_by) VALUES('旧馆一',$1),('旧馆二',$1)", [actor]);
    const migration = await readFile('migrations/0004_personal_museum_pages.sql', 'utf8');
    await db.query('SAVEPOINT before_upgrade');
    await assert.rejects(db.query(migration), /Multiple active museums exist/);
    await db.query('ROLLBACK TO SAVEPOINT before_upgrade');
    assert.equal((await db.query('SELECT id FROM museums')).rowCount, 2);
    await db.query("UPDATE museums SET deleted_at=now() WHERE title='旧馆二'");
    await db.query(migration);
    assert.equal((await db.query('SELECT id FROM museums')).rowCount, 2);
    const museum = (await db.query<{ id: string }>('SELECT id FROM museums WHERE deleted_at IS NULL')).rows[0];
    assert.ok(museum);
    await rejectedStatement(db, "INSERT INTO museums(title,created_by) VALUES('重复',$1)", [actor], '23505');
    await db.query("INSERT INTO exhibits(museum_id,name,slot_index,model_key,approximation,source_notice) VALUES($1,'第七件',6,'camera-01','演示','测试')", [museum.id]);
    await rejectedStatement(db, "INSERT INTO exhibits(museum_id,name,slot_index,model_key,approximation,source_notice) VALUES($1,'负数',-1,'camera-01','演示','测试')", [museum.id], '23514');
    assert.equal((await db.query('SELECT slot_index FROM exhibits')).rows[0]?.slot_index, 6);
  } finally { await db.query('ROLLBACK'); db.release(); }
});

test('failed transactions leave no committed member or museum', async () => {
  const id = randomUUID();
  await assert.rejects(withTransaction(async (client) => {
    await client.query('INSERT INTO users(id, username, password_hash) VALUES($1,$2,$3)', [id, `test-${id}`, 'test-only']);
    await client.query('INSERT INTO museums(title,created_by) VALUES($1,$2)', ['应回滚', id]);
    throw new Error('intentional transaction failure');
  }, pool), /intentional transaction failure/);
  const result = await pool.query('SELECT id FROM users WHERE id=$1', [id]);
  assert.equal(result.rowCount, 0);
});

test('foreign keys prevent both draft and snapshot references to another museum assets', async () => {
  await rollbackFixture(async (client, memberId, museumId) => {
    const secondMuseum = randomUUID();
    const secondOwner = randomUUID();
    await client.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [secondOwner, `fk-${secondOwner}`, 'test-only']);
    await client.query('INSERT INTO museums(id,title,created_by) VALUES($1,$2,$3)', [secondMuseum, '另一馆', secondOwner]);
    const foreignAsset = await insertImage(client, secondOwner, secondMuseum);
    await rejectedStatement(client, `INSERT INTO exhibits(museum_id,name,slot_index,model_key,approximation,source_notice,photo_asset_id)
      VALUES($1,'测试展品',0,'camera-01','测试','仅测试',$2)`, [museumId, foreignAsset], '23503');
    const snapshot = randomUUID();
    await client.query('INSERT INTO published_snapshots(id,museum_id,museum_version,public_data,published_by) VALUES($1,$2,1,$3,$4)', [snapshot, museumId, '{}', memberId]);
    await rejectedStatement(client, 'INSERT INTO snapshot_assets(snapshot_id,museum_id,asset_id) VALUES($1,$2,$3)', [snapshot, museumId, foreignAsset], '23503');
  });
});

test('only one active exhibit can occupy a slot, and soft removal releases it', async () => {
  await rollbackFixture(async (client, _memberId, museumId) => {
    const exhibit = randomUUID();
    await client.query("INSERT INTO exhibits(id,museum_id,name,slot_index,model_key,approximation,source_notice) VALUES($1,$2,'原展品',0,'camera-01','测试','仅测试')", [exhibit, museumId]);
    const insert = "INSERT INTO exhibits(museum_id,name,slot_index,model_key,approximation,source_notice) VALUES($1,'新展品',0,'cassette','测试','仅测试')";
    await rejectedStatement(client, insert, [museumId], '23505');
    await client.query('UPDATE exhibits SET deleted_at=now() WHERE id=$1', [exhibit]);
    await client.query(insert, [museumId]);
    const result = await client.query('SELECT id FROM exhibits WHERE museum_id=$1 AND slot_index=0 AND deleted_at IS NULL', [museumId]);
    assert.equal(result.rowCount, 1);
  });
});

test('publishing seals both public content and asset membership; draft deletion preserves the snapshot', async () => {
  await rollbackFixture(async (client, memberId, museumId) => {
    const asset = await insertImage(client, memberId, museumId);
    const anotherAsset = await insertImage(client, memberId, museumId);
    const exhibit = randomUUID();
    const snapshot = randomUUID();
    await client.query("INSERT INTO exhibits(id,museum_id,name,slot_index,model_key,approximation,source_notice,photo_asset_id) VALUES($1,$2,'保留快照',0,'camera-01','测试','仅测试',$3)", [exhibit, museumId, asset]);
    const publicData = { id: museumId, title: '冻结展馆', description: '', version: 1, publishedAt: new Date().toISOString(), exhibits: [{ id: exhibit, photoAssetId: asset }] };
    await client.query('INSERT INTO published_snapshots(id,museum_id,museum_version,public_data,published_by) VALUES($1,$2,1,$3,$4)', [snapshot, museumId, JSON.stringify(publicData), memberId]);
    await client.query('INSERT INTO snapshot_assets(snapshot_id,museum_id,asset_id) VALUES($1,$2,$3)', [snapshot, museumId, asset]);
    await rejectedStatement(client, 'UPDATE museums SET current_snapshot_id=$1 WHERE id=$2', [snapshot, museumId], '23514');
    await client.query('UPDATE published_snapshots SET sealed=true WHERE id=$1', [snapshot]);
    await client.query('UPDATE museums SET current_snapshot_id=$1 WHERE id=$2', [snapshot, museumId]);
    await rejectedStatement(client, "UPDATE published_snapshots SET public_data='{}' WHERE id=$1", [snapshot], '23514');
    await rejectedStatement(client, 'DELETE FROM published_snapshots WHERE id=$1', [snapshot], '23514');
    await rejectedStatement(client, 'INSERT INTO snapshot_assets(snapshot_id,museum_id,asset_id) VALUES($1,$2,$3)', [snapshot, museumId, anotherAsset], '23514');
    await rejectedStatement(client, 'DELETE FROM snapshot_assets WHERE snapshot_id=$1', [snapshot], '23514');
    await client.query('UPDATE exhibits SET deleted_at=now(),photo_asset_id=$1 WHERE id=$2', [anotherAsset, exhibit]);
    const result = await client.query<{ public_data: unknown; asset_id: string }>(`SELECT s.public_data, a.asset_id
      FROM published_snapshots s JOIN snapshot_assets a ON a.snapshot_id=s.id WHERE s.id=$1`, [snapshot]);
    assert.deepEqual(result.rows[0]?.public_data, publicData);
    assert.equal(result.rows[0]?.asset_id, asset);
  });
});
