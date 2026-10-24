import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { confirmExhibit, createExhibit, createMuseum, getMuseum, updateMuseum } from '../../src/server/core/museums';
import { publishMuseum } from '../../src/server/core/sharing';
import { getMuseumAccess, getMuseumTags, getPublicProfile, listDiscovery, readDiscoveryMuseum, updateMuseumAccess, updateMuseumTags, updatePublicProfile } from '../../src/server/core/discovery';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });
const hasCode = (code: string) => (error: unknown) => error instanceof HttpError && error.failure.code === code;
async function account(db: PoolClient, demo = true) {
  const id = randomUUID();
  await db.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [id, `private-login-${id}`, 'test-only', 'member']);
  if (demo) await db.query('INSERT INTO direction1_demo_accounts(user_id) VALUES($1)', [id]);
  return id;
}
async function fixture(work: (db: PoolClient, visitor: string) => Promise<void>) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); await work(db, await account(db)); }
  finally { await db.query('ROLLBACK'); db.release(); }
}
async function preparedMuseum(db: PoolClient, owner: string, title = 'DEMO 车票馆') {
  const museum = await createMuseum(owner, { title, description: '这只是测试简介，不属于搜索字段。' }, db);
  const exhibit = await createExhibit(owner, museum.id, { expectedMuseumVersion: museum.version, name: 'DEMO 搪瓷杯', era: '年代待考',
    slotIndex: 0, modelKey: 'camera-01', caption: '合成展品，不对应真实物主。', photoAssetId: null, audioAssetId: null,
    modelInput: { mode: 'single', imageAssetId: null }, approximation: '演示', sourceNotice: '测试', rawStory: '私密讲述哨兵', transcript: null, sourceSegments: [] }, db);
  await confirmExhibit(owner, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '核对合成资料。' }, db);
  await publishMuseum(owner, museum.id, (await getMuseum(owner, museum.id, db)).version, db);
  return museum.id;
}
async function open(db: PoolClient, owner: string, museumId: string, nickname = 'DEMO 昵称') {
  await updatePublicProfile(owner, { operationId: randomUUID(), expectedVersion: 1, nickname, expectMissing: true }, db);
  return updateMuseumAccess(owner, museumId, { operationId: randomUUID(), expectedVersion: (await getMuseum(owner, museumId, db)).version, accessMode: 'discoverable' }, db);
}
const pageInput = { query: '', cursor: null, limit: 50 };

test('发现由服务端演示名单控制；member 身份不能代替登记，也不把登录名作为公开昵称', async () => {
  await fixture(async (db, visitor) => {
    const real = await account(db, false);
    const museum = await preparedMuseum(db, real);
    await assert.rejects(listDiscovery(real, pageInput, db), hasCode('DEMO_ONLY'));
    await assert.rejects(updatePublicProfile(real, { operationId: randomUUID(), expectedVersion: 1, nickname: '伪造 DEMO', expectMissing: true }, db), hasCode('DEMO_ONLY'));
    await assert.rejects(updateMuseumAccess(real, museum, { operationId: randomUUID(), expectedVersion: (await getMuseum(real, museum, db)).version, accessMode: 'discoverable' }, db), hasCode('DEMO_ONLY'));
    assert.equal((await getMuseumAccess(real, museum, db)).accessMode, 'private');
    assert.equal((await listDiscovery(visitor, pageInput, db)).items.some(({ museumId }) => museumId === museum), false);
    assert.equal(await getPublicProfile(visitor, db), null);
  });
});

test('开放发现要求已发布快照与主动填写昵称；陌生人不能操作访问、标签或私有资料', async () => {
  await fixture(async (db, visitor) => {
    const owner = await account(db); const museum = await preparedMuseum(db, owner);
    const version = (await getMuseum(owner, museum, db)).version;
    await assert.rejects(updateMuseumAccess(owner, museum, { operationId: randomUUID(), expectedVersion: version, accessMode: 'discoverable' }, db), hasCode('VALIDATION_ERROR'));
    await assert.rejects(getMuseumAccess(visitor, museum, db), hasCode('NOT_FOUND'));
    await assert.rejects(getMuseumTags(visitor, museum, db), hasCode('NOT_FOUND'));
    await assert.rejects(updateMuseumAccess(visitor, museum, { operationId: randomUUID(), expectedVersion: version, accessMode: 'private' }, db), hasCode('NOT_FOUND'));
    await assert.rejects(updateMuseumTags(visitor, museum, { operationId: randomUUID(), expectedVersion: version, tags: ['越权'] }, db), hasCode('NOT_FOUND'));
    const empty = await createMuseum(visitor, { title: '尚未发布', description: '' }, db);
    await updatePublicProfile(visitor, { operationId: randomUUID(), expectedVersion: 1, nickname: '主动填写', expectMissing: true }, db);
    await assert.rejects(updateMuseumAccess(visitor, empty.id, { operationId: randomUUID(), expectedVersion: empty.version, accessMode: 'discoverable' }, db), hasCode('VALIDATION_ERROR'));
    assert.equal((await getMuseumAccess(owner, museum, db)).accessMode, 'private');
  });
});

test('搜索仅使用已发布四类字段，标签随快照冻结，原文和未发布编辑均不可检索', async () => {
  await fixture(async (db, visitor) => {
    const owner = await account(db); const museum = await preparedMuseum(db, owner);
    await updateMuseumTags(owner, museum, { operationId: randomUUID(), expectedVersion: (await getMuseum(owner, museum, db)).version, tags: ['手动标签哨兵'] }, db);
    await publishMuseum(owner, museum, (await getMuseum(owner, museum, db)).version, db);
    const access = await open(db, owner, museum, 'DEMO 昵称哨兵'); assert.ok(access.accessEpoch);
    for (const query of ['车票', '搪瓷杯', '手动标签哨兵', '昵称哨兵']) {
      assert.equal((await listDiscovery(visitor, { ...pageInput, query }, db)).items.some(({ museumId }) => museumId === museum), true);
    }
    const draft = await getMuseum(owner, museum, db);
    await updateMuseum(owner, museum, { expectedVersion: draft.version, title: '未发布标题哨兵', description: draft.description }, db);
    await updateMuseumTags(owner, museum, { operationId: randomUUID(), expectedVersion: (await getMuseum(owner, museum, db)).version, tags: ['未发布标签哨兵'] }, db);
    for (const query of ['私密讲述哨兵', '不属于搜索字段', '未发布标题哨兵', '未发布标签哨兵', `private-login-${owner}`, '%', '_', "' OR true --"]) {
      assert.equal((await listDiscovery(visitor, { ...pageInput, query }, db)).items.some(({ museumId }) => museumId === museum), false);
    }
    assert.equal((await readDiscoveryMuseum(visitor, museum, access.accessEpoch, db)).title, 'DEMO 车票馆');
    await publishMuseum(owner, museum, (await getMuseum(owner, museum, db)).version, db);
    await assert.rejects(readDiscoveryMuseum(visitor, museum, access.accessEpoch, db), hasCode('NOT_FOUND'));
    assert.equal((await listDiscovery(visitor, { ...pageInput, query: '未发布标签哨兵' }, db)).items.some(({ museumId }) => museumId === museum), true);
  });
});

test('私密、链接、停用及撤销名单立即退出目录，旧 epoch 不能复用；重复操作不重新开放', async () => {
  await fixture(async (db, visitor) => {
    const owner = await account(db); const museum = await preparedMuseum(db, owner);
    const access = await open(db, owner, museum); assert.ok(access.accessEpoch);
    const input = { operationId: randomUUID(), expectedVersion: access.version, accessMode: 'private' as const };
    const stopped = await updateMuseumAccess(owner, museum, input, db);
    assert.equal(stopped.accessEpoch, null);
    const current = await updateMuseumAccess(owner, museum, { operationId: randomUUID(), expectedVersion: stopped.version, accessMode: 'discoverable' }, db);
    assert.notEqual(current.accessEpoch, access.accessEpoch);
    assert.deepEqual(await updateMuseumAccess(owner, museum, input, db), current, '重放返回当前投影，不能再次执行旧的撤销操作');
    await assert.rejects(updateMuseumAccess(owner, museum, { ...input, accessMode: 'link_only' }, db), hasCode('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(readDiscoveryMuseum(visitor, museum, access.accessEpoch, db), hasCode('NOT_FOUND'));
    await db.query('DELETE FROM direction1_demo_accounts WHERE user_id=$1', [owner]);
    assert.equal((await listDiscovery(visitor, pageInput, db)).items.some(({ museumId }) => museumId === museum), false);
    assert.ok(current.accessEpoch);
    await assert.rejects(readDiscoveryMuseum(visitor, museum, current.accessEpoch, db), hasCode('NOT_FOUND'));
  });
});

test('分页游标绑定搜索条件，按快照发布时间和 ID 稳定翻页，不返回关注者或收藏者名单', async () => {
  await fixture(async (db, visitor) => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      const owner = await account(db); const museum = await preparedMuseum(db, owner, `分页测试 ${index}`);
      await open(db, owner, museum); ids.push(museum);
    }
    const first = await listDiscovery(visitor, { query: '分页测试', cursor: null, limit: 1 }, db);
    assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
    const second = await listDiscovery(visitor, { query: '分页测试', cursor: first.nextCursor, limit: 1 }, db);
    assert.ok(second.nextCursor);
    const third = await listDiscovery(visitor, { query: '分页测试', cursor: second.nextCursor, limit: 1 }, db);
    assert.equal(third.nextCursor, null);
    assert.deepEqual(new Set([...first.items, ...second.items, ...third.items].map(({ museumId }) => museumId)), new Set(ids));
    await assert.rejects(listDiscovery(visitor, { query: '另一条件', cursor: first.nextCursor, limit: 1 }, db), hasCode('VALIDATION_ERROR'));
    await assert.rejects(listDiscovery(visitor, { query: '', cursor: 'e30', limit: 1 }, db), hasCode('VALIDATION_ERROR'));
    assert.equal(JSON.stringify(first).includes('private-login'), false);
    assert.equal('favoriteUserIds' in (first.items[0] ?? {}), false);
    assert.equal('shareToken' in (first.items[0] ?? {}), false);
  });
});

test('昵称、标签与访问操作使用持久回执，重放不重复写，旧版本冲突不覆盖新内容', async () => {
  await fixture(async (db, visitor) => {
    const profileInput = { operationId: randomUUID(), expectedVersion: 1, nickname: '原昵称', expectMissing: true };
    const profile = await updatePublicProfile(visitor, profileInput, db); assert.ok(profile);
    assert.deepEqual(await updatePublicProfile(visitor, profileInput, db), profile);
    await updatePublicProfile(visitor, { operationId: randomUUID(), expectedVersion: profile.version, nickname: '新昵称', expectMissing: false }, db);
    await assert.rejects(updatePublicProfile(visitor, { operationId: randomUUID(), expectedVersion: profile.version, nickname: '过期覆盖', expectMissing: false }, db), hasCode('VERSION_CONFLICT'));
    const museum = await preparedMuseum(db, visitor);
    const input = { operationId: randomUUID(), expectedVersion: (await getMuseum(visitor, museum, db)).version, tags: ['原标签'] };
    const saved = await updateMuseumTags(visitor, museum, input, db);
    assert.deepEqual(await updateMuseumTags(visitor, museum, input, db), saved);
    await assert.rejects(updateMuseumTags(visitor, museum, { ...input, tags: ['冒用操作标识'] }, db), hasCode('IDEMPOTENCY_CONFLICT'));
    assert.deepEqual((await getMuseumTags(visitor, museum, db)).tags, ['原标签']);
  });
});
