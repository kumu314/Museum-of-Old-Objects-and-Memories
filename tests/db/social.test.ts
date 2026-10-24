import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { confirmExhibit, createExhibit, createMuseum, getMuseum } from '../../src/server/core/museums';
import { publishMuseum } from '../../src/server/core/sharing';
import { listDiscovery, listFollowing, readDiscoveryMuseum, updateMuseumAccess } from '../../src/server/core/discovery';
import { createComment, deleteComment, getCommentSettings, listComments, listManagedComments, moderateComment, setCommentBan, setFavorite, setFollow, updateCommentSettings } from '../../src/server/core/social';
import { migrate } from '../../src/server/db/migrate';
import { withTransaction } from '../../src/server/db/pool';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const connectionString = getIsolatedTestDatabaseUrl();
const pool = new Pool({ connectionString, max: 3 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });
const hasCode = (code: string) => (error: unknown) => error instanceof HttpError && error.failure.code === code;
const pageInput = { cursor: null, limit: 100 };
const directoryInput = { query: '', cursor: null, limit: 50 };
async function account(db: PoolClient) {
  const id = randomUUID();
  await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [id, `social-${id}`, 'test-only']);
  await db.query('INSERT INTO direction1_demo_accounts(user_id) VALUES($1)', [id]);
  await db.query('INSERT INTO public_profiles(user_id,nickname) VALUES($1,$2)', [id, `DEMO ${id.slice(0, 8)}`]);
  return id;
}
async function ready(db: PoolClient) {
  const owner = await account(db); const visitor = await account(db);
  const museum = await createMuseum(owner, { title: 'DEMO 社交测试馆', description: '' }, db);
  const exhibit = await createExhibit(owner, museum.id, { expectedMuseumVersion: museum.version, name: '演示展品', era: '年代待考',
    slotIndex: 0, modelKey: 'camera-01', caption: '合成展品。', photoAssetId: null, audioAssetId: null,
    modelInput: { mode: 'single', imageAssetId: null }, approximation: '演示', sourceNotice: '合成', rawStory: '', transcript: null, sourceSegments: [] }, db);
  await confirmExhibit(owner, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '核对合成资料。' }, db);
  await publishMuseum(owner, museum.id, (await getMuseum(owner, museum.id, db)).version, db);
  const access = await updateMuseumAccess(owner, museum.id, { operationId: randomUUID(), expectedVersion: (await getMuseum(owner, museum.id, db)).version, accessMode: 'discoverable' }, db);
  assert.ok(access.accessEpoch);
  return { owner, visitor, museumId: museum.id, epoch: access.accessEpoch };
}
type Fixture = Awaited<ReturnType<typeof ready>>;
async function fixture(work: (db: PoolClient, f: Fixture) => Promise<void>) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); await work(db, await ready(db)); }
  finally { await db.query('ROLLBACK'); db.release(); }
}
function rootInput(epoch: string) { return { operationId: randomUUID(), accessEpoch: epoch, rootId: null, replyToId: null, body: '【合成留言】不对应真实人物。' }; }

test('关注账号和收藏展馆分别持久化，重复请求不增量；本人列表与公开计数不泄露名单', async () => {
  await fixture(async (db, f) => {
    const follow = { operationId: randomUUID() };
    await setFollow(f.visitor, f.owner, follow, true, db);
    await setFollow(f.visitor, f.owner, follow, true, db);
    assert.equal((await listFollowing(f.visitor, directoryInput, db)).items.length, 1);
    assert.equal((await listFollowing(f.owner, directoryInput, db)).items.length, 0);
    const input = { operationId: randomUUID() };
    assert.equal((await setFavorite(f.visitor, f.museumId, f.epoch, input, true, db)).favoriteCount, 1);
    assert.equal((await setFavorite(f.visitor, f.museumId, f.epoch, input, true, db)).favoriteCount, 1);
    assert.equal((await setFavorite(f.visitor, f.museumId, f.epoch, { operationId: randomUUID() }, true, db)).favoriteCount, 1);
    const other = await account(db);
    const item = (await listDiscovery(other, directoryInput, db)).items.find(({ museumId }) => museumId === f.museumId);
    assert.ok(item); assert.equal(item.favoriteCount, 1); assert.equal(item.isFavorited, false); assert.equal(item.isFollowing, false);
    assert.equal(JSON.stringify(item).includes(f.visitor), false);
    await assert.rejects(setFollow(f.owner, f.owner, { operationId: randomUUID() }, true, db), hasCode('VALIDATION_ERROR'));
    await assert.rejects(setFavorite(f.owner, f.museumId, f.epoch, { operationId: randomUUID() }, true, db), hasCode('VALIDATION_ERROR'));
    await setFollow(f.visitor, f.owner, { operationId: randomUUID() }, false, db);
    assert.equal((await listFollowing(f.visitor, directoryInput, db)).items.length, 0);
    assert.equal((await setFavorite(f.visitor, f.museumId, f.epoch, { operationId: randomUUID() }, false, db)).favoriteCount, 0);
  });
});

test('删除根留言保留回复，回复必须属于本馆同一根线程，私密后作者仍可清除自己的正文', async () => {
  await fixture(async (db, f) => {
    const root = await createComment(f.visitor, f.museumId, rootInput(f.epoch), db);
    const reply = await createComment(f.owner, f.museumId, { ...rootInput(f.epoch), rootId: root.id, replyToId: root.id }, db);
    const other = await ready(db);
    await assert.rejects(createComment(other.visitor, other.museumId, { ...rootInput(other.epoch), rootId: root.id, replyToId: reply.id }, db), hasCode('THREAD_UNAVAILABLE'));
    await deleteComment(f.visitor, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: root.version }, db);
    const comments = (await listComments(f.visitor, f.museumId, f.epoch, pageInput, db)).items;
    assert.equal(comments.length, 2); assert.equal(comments[0]?.status, 'deleted'); assert.equal('body' in (comments[0] ?? {}), false);
    await createComment(f.owner, f.museumId, { ...rootInput(f.epoch), rootId: root.id, replyToId: reply.id }, db);
    await updateMuseumAccess(f.owner, f.museumId, { operationId: randomUUID(), expectedVersion: (await getMuseum(f.owner, f.museumId, db)).version, accessMode: 'private' }, db);
    await assert.rejects(listComments(f.visitor, f.museumId, f.epoch, pageInput, db), hasCode('NOT_FOUND'));
    await deleteComment(f.owner, f.museumId, reply.id, { operationId: randomUUID(), expectedVersion: reply.version }, db);
    assert.equal((await db.query('SELECT body FROM museum_comments WHERE id=$1', [reply.id])).rows[0]?.body, null);
  });
});

test('馆主隐藏根线程后，作者删除不会重新公开回复；恢复不复活正文，原文不进回执', async () => {
  await fixture(async (db, f) => {
    const input = rootInput(f.epoch); input.body = '【合成】删除后不应保留的留言正文';
    const root = await createComment(f.visitor, f.museumId, input, db);
    await createComment(f.owner, f.museumId, { ...rootInput(f.epoch), rootId: root.id, replyToId: root.id }, db);
    const hidden = await moderateComment(f.owner, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: 1, action: 'hide' }, db);
    await deleteComment(f.visitor, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: hidden.version }, db);
    assert.deepEqual((await listComments(f.visitor, f.museumId, f.epoch, pageInput, db)).items, []);
    const managed = (await listManagedComments(f.owner, f.museumId, pageInput, db)).items;
    const deleted = managed.find(({ id }) => id === root.id); assert.ok(deleted);
    assert.equal(deleted.status, 'hidden_deleted'); assert.equal('body' in deleted, false);
    await moderateComment(f.owner, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: deleted.version, action: 'restore' }, db);
    const restored = (await listComments(f.visitor, f.museumId, f.epoch, pageInput, db)).items;
    assert.equal(restored.length, 2); assert.equal(restored[0]?.status, 'deleted');
    assert.equal(JSON.stringify((await db.query('SELECT * FROM direction1_write_receipts WHERE actor_id=$1', [f.visitor])).rows).includes(input.body), false);
    await db.query('SAVEPOINT restore_deleted');
    await assert.rejects(db.query("UPDATE museum_comments SET status='visible',body='恢复已删除正文' WHERE id=$1", [root.id]), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT restore_deleted');
  });
});

test('禁评与关闭不剥夺参观和作者删除权；其他账号不能管理设置或隐藏他人留言', async () => {
  await fixture(async (db, f) => {
    const root = await createComment(f.visitor, f.museumId, rootInput(f.epoch), db);
    await assert.rejects(moderateComment(f.visitor, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: 1, action: 'hide' }, db), hasCode('NOT_FOUND'));
    await assert.rejects(getCommentSettings(f.visitor, f.museumId, db), hasCode('NOT_FOUND'));
    await assert.rejects(deleteComment(f.owner, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: 1 }, db), hasCode('NOT_FOUND'));
    await setCommentBan(f.owner, f.museumId, { operationId: randomUUID(), targetCommentId: root.id }, true, db);
    assert.equal((await readDiscoveryMuseum(f.visitor, f.museumId, f.epoch, db)).id, f.museumId);
    assert.equal((await listComments(f.visitor, f.museumId, f.epoch, pageInput, db)).canComment, false);
    await assert.rejects(createComment(f.visitor, f.museumId, rootInput(f.epoch), db), hasCode('COMMENTING_BLOCKED'));
    const settings = await getCommentSettings(f.owner, f.museumId, db);
    await updateCommentSettings(f.owner, f.museumId, { operationId: randomUUID(), expectedVersion: settings.version, mode: 'closed' }, db);
    await assert.rejects(createComment(f.owner, f.museumId, rootInput(f.epoch), db), hasCode('COMMENTS_CLOSED'));
    await deleteComment(f.visitor, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: 1 }, db);
    assert.equal((await listComments(f.visitor, f.museumId, f.epoch, pageInput, db)).items[0]?.status, 'deleted');
  });
});

test('留言分页不静默丢弃更多记录，游标不能跨馆或用于馆主管理；过期版本拒绝覆盖', async () => {
  await fixture(async (db, f) => {
    const root = await createComment(f.visitor, f.museumId, rootInput(f.epoch), db);
    await createComment(f.visitor, f.museumId, rootInput(f.epoch), db);
    const first = await listComments(f.visitor, f.museumId, f.epoch, { cursor: null, limit: 1 }, db); assert.ok(first.nextCursor);
    const second = await listComments(f.visitor, f.museumId, f.epoch, { cursor: first.nextCursor, limit: 1 }, db);
    assert.equal(second.nextCursor, null); assert.notEqual(first.items[0]?.id, second.items[0]?.id);
    await assert.rejects(listManagedComments(f.owner, f.museumId, { cursor: first.nextCursor, limit: 1 }, db), hasCode('VALIDATION_ERROR'));
    const hidden = await moderateComment(f.owner, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: 1, action: 'hide' }, db);
    await assert.rejects(deleteComment(f.visitor, f.museumId, root.id, { operationId: randomUUID(), expectedVersion: 1 }, db), hasCode('VERSION_CONFLICT'));
    assert.equal((await listManagedComments(f.owner, f.museumId, pageInput, db)).items.find(({ id }) => id === root.id)?.version, hidden.version);
  });
});

test('独立 PostgreSQL 连接并发重放只创建一条留言；等待中的请求会重新检查馆主禁评', async () => {
  const schema = `social_concurrency_${randomUUID().replaceAll('-', '')}`;
  const isolated = new Pool({ connectionString, max: 3, options: `-c search_path=${schema}`, statement_timeout: 5000 });
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await migrate(isolated);
    const f = await withTransaction(ready, isolated);
    const input = rootInput(f.epoch);
    const comments = await Promise.all([0, 1].map(() => withTransaction((db) => createComment(f.visitor, f.museumId, input, db), isolated)));
    assert.equal(comments[0]?.id, comments[1]?.id);
    assert.equal((await isolated.query('SELECT id FROM museum_comments')).rowCount, 1);
    const root = comments[0]; assert.ok(root);
    const ownerDb = await isolated.connect(); const writerDb = await isolated.connect();
    try {
      await ownerDb.query('BEGIN'); await writerDb.query('BEGIN');
      await ownerDb.query('SELECT id FROM museums WHERE id=$1 FOR UPDATE', [f.museumId]);
      const pid = (await writerDb.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid; assert.ok(pid);
      const waiting = createComment(f.visitor, f.museumId, rootInput(f.epoch), writerDb);
      const checked = assert.rejects(waiting, hasCode('COMMENTING_BLOCKED'));
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline) {
        const state = await ownerDb.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
        if (state.rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
        await delay(10);
      }
      assert.ok(blocked, '请求必须已经等待展馆行锁，才能验证锁后的禁评重检');
      await setCommentBan(f.owner, f.museumId, { operationId: randomUUID(), targetCommentId: root.id }, true, ownerDb);
      await ownerDb.query('COMMIT');
      await checked;
      assert.equal((await writerDb.query('SELECT id FROM museum_comments')).rowCount, 1);
    } finally { await ownerDb.query('ROLLBACK'); await writerDb.query('ROLLBACK'); ownerDb.release(); writerDb.release(); }
  } finally { await isolated.end(); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
});
