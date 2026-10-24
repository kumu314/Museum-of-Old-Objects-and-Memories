import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { publicMuseumSchema } from '../../src/contracts';
import { confirmExhibit, createExhibit, createMuseum, getMuseum, getShareAsset, publishMuseum, getPublicProfile, readLeaderboard, readShare, rotateShareToken, stopSharing, updateMuseum, updateMuseumAccess, updatePublicProfile } from '../../src/server/core';
import { loadMigrations, migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });
const hasCode = (code: string) => (error: unknown) => error instanceof HttpError && error.failure.code === code;
async function fixture(work: (db: PoolClient, actor: string) => Promise<void>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const actor = randomUUID();
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [actor, `access-${actor}`, 'test-only']);
    await work(db, actor);
  } finally { await db.query('ROLLBACK'); db.release(); }
}
async function ready(db: PoolClient, actor: string) {
  const museum = await createMuseum(actor, { title: 'DEMO 私密发布', description: '合成资料' }, db);
  const exhibit = await createExhibit(actor, museum.id, { expectedMuseumVersion: museum.version, name: '演示相机', era: '年代待考',
    slotIndex: 0, modelKey: 'camera-01', caption: '仅用于测试的合成展品。', photoAssetId: null, audioAssetId: null,
    modelInput: { mode: 'single', imageAssetId: null }, approximation: '演示模型', sourceNotice: '非真实资料', rawStory: '', transcript: null, sourceSegments: [] }, db);
  await confirmExhibit(actor, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '核对合成展示内容。' }, db);
  return getMuseum(actor, museum.id, db);
}

test('新馆发布和重复发布均不开放访问；明确开链才产生 token，旧版本不能重复开链', async () => {
  await fixture(async (db, actor) => {
    const museum = await ready(db, actor);
    await assert.rejects(rotateShareToken(actor, museum.id, museum.version, db), hasCode('VALIDATION_ERROR'));
    const published = await publishMuseum(actor, museum.id, museum.version, db);
    assert.equal(published.token, null);
    assert.deepEqual(await publishMuseum(actor, museum.id, museum.version, db), published);
    const privateMuseum = await getMuseum(actor, museum.id, db);
    assert.equal(privateMuseum.accessMode, 'private');
    assert.equal(privateMuseum.shareEnabled, false);
    assert.equal(privateMuseum.accessEpoch, null);
    assert.equal((await db.query('SELECT share_token_hash FROM museums WHERE id=$1', [museum.id])).rows[0]?.share_token_hash, null);
    const opened = await rotateShareToken(actor, museum.id, museum.version, db);
    const linked = await getMuseum(actor, museum.id, db);
    assert.equal(linked.accessMode, 'link_only');
    assert.equal(linked.shareEnabled, true);
    assert.ok(linked.accessEpoch);
    assert.equal((await readShare(actor, opened.token, db)).id, museum.id);
    await assert.rejects(rotateShareToken(actor, museum.id, museum.version, db), hasCode('VERSION_CONFLICT'));
    await publishMuseum(actor, museum.id, linked.version, db);
    const replacedEpoch = (await getMuseum(actor, museum.id, db)).accessEpoch;
    assert.notEqual(replacedEpoch, linked.accessEpoch);
    await publishMuseum(actor, museum.id, linked.version, db);
    assert.equal((await getMuseum(actor, museum.id, db)).accessEpoch, replacedEpoch);
    await stopSharing(actor, museum.id, linked.version, db);
    const stopped = await getMuseum(actor, museum.id, db);
    assert.equal(stopped.accessMode, 'private');
    assert.equal(stopped.accessEpoch, null);
    await assert.rejects(readShare(actor, opened.token, db), hasCode('SHARE_NOT_FOUND'));
    await publishMuseum(actor, museum.id, stopped.version, db);
    assert.equal((await getMuseum(actor, museum.id, db)).shareEnabled, false);
    await assert.rejects(readShare(actor, opened.token, db), hasCode('SHARE_NOT_FOUND'));
    const reopened = await rotateShareToken(actor, museum.id, stopped.version, db);
    assert.notEqual(reopened.token, opened.token);
    assert.equal((await readShare(actor, reopened.token, db)).id, museum.id);
  });
});

test('停用馆主后有效访客也不能通过旧链接读取数据或素材', async () => {
  await fixture(async (db, actor) => {
    const museum = await ready(db, actor);
    await publishMuseum(actor, museum.id, museum.version, db);
    const { token } = await rotateShareToken(actor, museum.id, museum.version, db);
    const visitor = randomUUID();
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [visitor, `visitor-${visitor}`, 'test-only']);
    assert.equal((await readShare(visitor, token, db)).id, museum.id);
    await db.query('UPDATE team_members SET active=false WHERE id=$1', [actor]);
    await assert.rejects(readShare(visitor, token, db), hasCode('SHARE_NOT_FOUND'));
    await assert.rejects(getShareAsset(visitor, token, randomUUID(), db), hasCode('SHARE_NOT_FOUND'));
  });
});

test('从主线 0007 升级保留有效旧链接与私密状态；访问字段约束拒绝漂移和旧写入器', async () => {
  await fixture(async (db, actor) => {
    const schema = `access_upgrade_${randomUUID().replaceAll('-', '')}`;
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}"`);
    const migrations = await loadMigrations('migrations');
    // 升级起点是主线 schema，不写死序号：按文件名定位方向一访问迁移。
    // 先应用主线与方向二迁移（此时还没有访问约束），在此之上构造旧版「分享中」状态。
    const accessIndex = migrations.findIndex(({ filename }) => filename === '0013_museum_access.sql');
    assert.ok(accessIndex > 0, '找不到 0013_museum_access.sql，重编号后请同步本文件。');
    for (const migration of migrations.slice(0, accessIndex)) await db.query(migration.sql);
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [actor, 'legacy-access', 'test-only']);
    const museum = randomUUID(); const snapshot = randomUUID(); const exhibit = randomUUID();
    await db.query('INSERT INTO museums(id,title,created_by) VALUES($1,$2,$3)', [museum, '旧链接馆', actor]);
    const data = publicMuseumSchema.parse({ id: museum, title: '旧链接馆', description: '', version: 1,
      publishedAt: '2026-10-24T00:00:00.000Z', exhibits: [{ id: exhibit, name: '旧物', era: '年代待考', slotIndex: 0,
        modelKey: 'camera-01', caption: '合成展品。', photoAssetId: null, audioAssetId: null, approximation: '演示', sourceNotice: '测试' }] });
    await db.query('INSERT INTO published_snapshots(id,museum_id,museum_version,public_data,published_by,sealed) VALUES($1,$2,1,$3,$4,true)', [snapshot, museum, JSON.stringify(data), actor]);
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await db.query('UPDATE museums SET current_snapshot_id=$1,share_enabled=true,share_token_hash=$2 WHERE id=$3', [snapshot, hash, museum]);
    // 应用方向一访问迁移：旧有效链接转为 link_only，私密馆保持 private。
    const upgrade = migrations[accessIndex];
    assert.ok(upgrade);
    await db.query(upgrade.sql);
    assert.deepEqual(await readShare(actor, token, db), data);
    const saved = await getMuseum(actor, museum, db);
    assert.equal(saved.accessMode, 'link_only'); assert.equal(saved.version, 1);
    assert.equal((await db.query("SELECT id FROM museums WHERE access_mode='discoverable'")).rowCount, 0);
    assert.equal((await db.query('SELECT share_token_hash FROM museums WHERE id=$1', [museum])).rows[0]?.share_token_hash, hash);
    await db.query('SAVEPOINT legacy_writer');
    await assert.rejects(db.query('UPDATE museums SET share_enabled=false WHERE id=$1', [museum]), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT legacy_writer');
    await db.query('SAVEPOINT bad_private');
    await assert.rejects(db.query("UPDATE museums SET access_mode='private' WHERE id=$1", [museum]), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT bad_private');
    await stopSharing(actor, museum, saved.version, db);
    await assert.rejects(readShare(actor, token, db), hasCode('SHARE_NOT_FOUND'));
  });
});

test('退出公开发现即撤销收录同意：榜单地图不再展示，参观链接保持有效', async () => {
  await fixture(async (db, actor) => {
    const museum = await ready(db, actor);
    await publishMuseum(actor, museum.id, museum.version, db);
    const { token } = await rotateShareToken(actor, museum.id, museum.version, db);
    // 收录前提：登记的演示账号 + 已填公开昵称；标注城市并明确同意收录后开启公开发现。
    await db.query('INSERT INTO direction1_demo_accounts(user_id) VALUES($1)', [actor]);
    await updatePublicProfile(actor, { operationId: randomUUID(), expectedVersion: 1, nickname: '演示收录者' }, db);
    const linked = await getMuseum(actor, museum.id, db);
    await updateMuseum(actor, museum.id, { title: 'DEMO 私密发布', description: '合成资料', regionCity: '洛阳', discoveryListed: true, expectedVersion: linked.version }, db);
    const discoverable = await updateMuseumAccess(actor, museum.id, { operationId: randomUUID(), expectedVersion: linked.version + 1, accessMode: 'discoverable' }, db);
    assert.equal(discoverable.accessMode, 'discoverable');
    assert.equal((await db.query('SELECT discovery_listed FROM museums WHERE id=$1', [museum.id])).rows[0]?.discovery_listed, true);
    assert.ok((await readLeaderboard(db)).entries.some((entry) => entry.museumId === museum.id));

    // 退出公开发现（转持链接）：收录同意必须一并撤销，否则退出后仍被榜单公示。
    await updateMuseumAccess(actor, museum.id, { operationId: randomUUID(), expectedVersion: discoverable.version, accessMode: 'link_only' }, db);
    const after = await db.query('SELECT discovery_listed,access_mode FROM museums WHERE id=$1', [museum.id]);
    assert.equal(after.rows[0]?.discovery_listed, false);
    assert.equal(after.rows[0]?.access_mode, 'link_only');
    assert.equal((await readLeaderboard(db)).entries.some((entry) => entry.museumId === museum.id), false);
    assert.equal((await readShare(actor, token, db)).id, museum.id);
  });
});

test('首次保存必须声明预期缺失：两个 expectedVersion=1 的首次保存，后者 409 不覆盖', async () => {
  await fixture(async (db, actor) => {
    await db.query('INSERT INTO direction1_demo_accounts(user_id) VALUES($1)', [actor]);
    // 页面 A：读到“无资料”，按 create 语义保存。
    const first = await updatePublicProfile(actor, { operationId: randomUUID(), expectedVersion: 1, nickname: '页面甲', expectMissing: true }, db);
    assert.ok(first);
    assert.equal(first.version, 1);
    // 页面 B 读到的是同一份“无资料”，随后才提交：声明预期缺失与现状不符，必须 409。
    await assert.rejects(
      updatePublicProfile(actor, { operationId: randomUUID(), expectedVersion: 1, nickname: '页面乙', expectMissing: true }, db),
      hasCode('VERSION_CONFLICT'));
    const final = await getPublicProfile(actor, db);
    assert.ok(final);
    assert.equal(final.nickname, '页面甲');
  });
});

test('昵称编辑核对版本：过期 expectedVersion 返回 409，不静默覆盖', async () => {
  await fixture(async (db, actor) => {
    await db.query('INSERT INTO direction1_demo_accounts(user_id) VALUES($1)', [actor]);
    const first = await updatePublicProfile(actor, { operationId: randomUUID(), expectedVersion: 1, nickname: '第一次保存', expectMissing: true }, db);
    assert.ok(first);
    assert.equal(first.version, 1);
    const second = await updatePublicProfile(actor, { operationId: randomUUID(), expectedVersion: first.version, nickname: '核对后的昵称' }, db);
    assert.ok(second);
    assert.equal(second.version, 2);
    // 仍带着旧视图 expectedVersion=1 的编辑请求：必须得到版本冲突，且不能覆盖已保存的昵称。
    await assert.rejects(
      updatePublicProfile(actor, { operationId: randomUUID(), expectedVersion: 1, nickname: '过期覆盖' }, db),
      hasCode('VERSION_CONFLICT'));
    const final = await getPublicProfile(actor, db);
    assert.ok(final);
    assert.equal(final.nickname, '核对后的昵称');
  });
});
