import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { CreateExhibitInput } from '../../src/contracts';
import type { RegionCity } from '../../src/contracts/discovery';
import {
  confirmExhibit,
  createExhibit,
  createMuseum,
  getMuseum,
  publishMuseum,
  readLeaderboard,
  readShare,
  readRegionDistribution,
  recordMuseumView,
  stopSharing,
  updateMuseum,
} from '../../src/server/core';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

/**
 * 浏览榜与地区分布的真实 SQL。
 *
 * 这一层的断言无法用纯函数替代：`readLeaderboard` 的口径（只算已发布且分享中的馆、
 * 排除馆主自查）全部写在 SQL 的 WHERE/JOIN 里，纯函数测不到。
 */
async function inRollback(work: (db: PoolClient) => Promise<void>): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await work(db);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}

async function account(db: PoolClient, label: string): Promise<{ id: string }> {
  const id = randomUUID();
  await db.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
    [id, `discover-${label}-${id}`, 'test-only', 'user']);
  return { id };
}

function exhibitInput(expectedMuseumVersion: number): CreateExhibitInput {
  return {
    name: '旧车票', era: '年代待考', slotIndex: 0, modelKey: 'ticket', caption: '浏览榜测试展签',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null },
    approximation: '候选演示模型', sourceNotice: '仅作浏览榜测试', rawStory: '内部原文不可公开', transcript: null,
    sourceSegments: [{ id: 'raw-1', text: '内部原文不可公开', source: 'rawStory' }], expectedMuseumVersion,
  };
}

/**
 * 造一座「已发布、分享中」的馆，返回 token。
 * 走真实的发布事务而不是直接拼 SQL：`share_enabled`/`current_snapshot_id`/token 哈希
 * 之间的约束由发布逻辑维护，手工插行容易造出库里根本不可能出现的状态。
 */
async function publishedMuseum(db: PoolClient, ownerId: string, title: string, regionCity: RegionCity | null, discoveryListed = true): Promise<{ museumId: string; token: string }> {
  const museum = await createMuseum(ownerId, { title, description: '' }, db);
  assert.equal(museum.discoveryListed, false);
  let version = museum.version;
  if (regionCity !== null || discoveryListed) {
    version = (await updateMuseum(ownerId, museum.id, { title, description: '', regionCity, discoveryListed, expectedVersion: version }, db)).version;
  }
  const image = randomUUID();
  await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
    VALUES($1,$2,'cover.webp','image','image/webp',100,$3,10,10,$4,$5)`,
    [image, museum.id, `${image}.processed`, '0'.repeat(64), ownerId]);
  const exhibit = await createExhibit(ownerId, museum.id, { ...exhibitInput(version), photoAssetId: image }, db);
  await confirmExhibit(ownerId, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '浏览榜测试确认' }, db);
  const current = (await getMuseum(ownerId, museum.id, db)).version;
  const published = await publishMuseum(ownerId, museum.id, current, db);
  assert.ok(published.token, '首次发布必须返回参观 token。');
  return { museumId: museum.id, token: published.token };
}

async function viewCountOf(db: PoolClient, museumId: string): Promise<number | undefined> {
  const board = await readLeaderboard(db);
  return board.entries.find((entry) => entry.museumId === museumId)?.viewCount;
}

test('浏览数只算访客，馆主自己反复查看不计入', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'owner');
    const visitor = await account(db, 'visitor');
    const museum = await publishedMuseum(db, owner.id, '自查排除测试馆', '洛阳');

    for (let index = 0; index < 3; index += 1) await recordMuseumView(visitor.id, museum.token, db);
    for (let index = 0; index < 2; index += 1) await recordMuseumView(owner.id, museum.token, db);

    // 事件行照实写 5 条（含馆主自查），聚合侧才排除馆主。
    const events = await db.query('SELECT viewer_id FROM museum_view_events WHERE museum_id=$1', [museum.museumId]);
    assert.equal(events.rowCount, 5);
    assert.equal(await viewCountOf(db, museum.museumId), 3);
  });
});

test('未发布的馆不进榜：草稿标题不能出现在全站公开榜单上', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'draft-owner');
    const draft = await createMuseum(owner.id, { title: '还没发布的草稿馆', description: '' }, db);
    const board = await readLeaderboard(db);
    assert.equal(board.entries.some((entry) => entry.museumId === draft.id), false);
  });
});

test('停止分享后立即退出榜单，但历史事件保留', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'stop-owner');
    const visitor = await account(db, 'stop-visitor');
    const museum = await publishedMuseum(db, owner.id, '停止分享测试馆', '郑州');
    await recordMuseumView(visitor.id, museum.token, db);
    assert.equal(await viewCountOf(db, museum.museumId), 1);

    const current = (await getMuseum(owner.id, museum.museumId, db)).version;
    await stopSharing(owner.id, museum.museumId, current, db);

    assert.equal(await viewCountOf(db, museum.museumId), undefined);
    // 停止分享是「不再对外计数」，不是「删掉历史」：数据仍在，便于日后审计。
    assert.equal((await db.query('SELECT id FROM museum_view_events WHERE museum_id=$1', [museum.museumId])).rowCount, 1);
  });
});

test('无效或已停用的链接不记浏览', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'bad-token-owner');
    const visitor = await account(db, 'bad-token-visitor');
    await publishedMuseum(db, owner.id, '无效链接测试馆', null);

    await assert.rejects(recordMuseumView(visitor.id, 'A'.repeat(43), db), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.failure.code, 'SHARE_NOT_FOUND');
      return true;
    });
    assert.equal((await db.query('SELECT id FROM museum_view_events')).rowCount, 0);
  });
});

test('榜单按浏览数降序，同数时顺序稳定可重复', async () => {
  await inRollback(async (db) => {
    const ownerA = await account(db, 'rank-a');
    const ownerB = await account(db, 'rank-b');
    const visitor = await account(db, 'rank-visitor');
    const busy = await publishedMuseum(db, ownerA.id, '被看得多的馆', '洛阳');
    const quiet = await publishedMuseum(db, ownerB.id, '被看得少的馆', '洛阳');

    for (let index = 0; index < 4; index += 1) await recordMuseumView(visitor.id, busy.token, db);
    await recordMuseumView(visitor.id, quiet.token, db);

    const first = await readLeaderboard(db);
    const second = await readLeaderboard(db);
    assert.deepEqual(first, second, '同一份数据两次读取必须完全一致。');
    const ids = first.entries.map((entry) => entry.museumId);
    assert.ok(ids.indexOf(busy.museumId) < ids.indexOf(quiet.museumId));
    assert.ok(first.entries.every((entry) => entry.isDemo === false));
    assert.deepEqual(first.entries.map((entry) => entry.rank), first.entries.map((_, index) => index + 1));
  });
});

test('地区聚合只统计已发布的馆，未标注城市单独计数', async () => {
  await inRollback(async (db) => {
    const luoyangOwner = await account(db, 'region-luoyang');
    const zhengzhouOwner = await account(db, 'region-zhengzhou');
    const unplacedOwner = await account(db, 'region-unplaced');
    const draftOwner = await account(db, 'region-draft');
    const visitor = await account(db, 'region-visitor');
    const luoyang = await publishedMuseum(db, luoyangOwner.id, '洛阳测试馆', '洛阳');
    await publishedMuseum(db, zhengzhouOwner.id, '郑州测试馆', '郑州');
    const unplaced = await publishedMuseum(db, unplacedOwner.id, '未标注测试馆', null);
    await createMuseum(draftOwner.id, { title: '未发布不该计入', description: '' }, db);
    await recordMuseumView(visitor.id, luoyang.token, db);
    await recordMuseumView(visitor.id, unplaced.token, db);

    const distribution = await readRegionDistribution(db);
    assert.equal(distribution.cities.length, 18);
    assert.deepEqual(distribution.cities.find((bucket) => bucket.city === '洛阳'),
      { city: '洛阳', museumCount: 1, viewCount: 1 });
    assert.deepEqual(distribution.cities.find((bucket) => bucket.city === '郑州'),
      { city: '郑州', museumCount: 1, viewCount: 0 });
    assert.equal(distribution.unplacedMuseums, 1);
    // 未标注的馆不该被塞进任何城市桶，否则地图上会凭空多出一个市。
    assert.equal(distribution.cities.reduce((total, bucket) => total + bucket.museumCount, 0), 2);
  });
});

test('保存资料时不传地区不会清空已选城市，传 null 才清空', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'region-keep');
    const museum = await createMuseum(owner.id, { title: '地区保留测试馆', description: '' }, db);
    assert.equal(museum.regionCity, null);
    const withCity = await updateMuseum(owner.id, museum.id, { title: museum.title, description: '', regionCity: '南阳', expectedVersion: museum.version }, db);
    assert.equal(withCity.regionCity, '南阳');

    // 老客户端整份保存时不会带 regionCity：不能因此把馆主选的市抹掉。
    const omitted = await updateMuseum(owner.id, museum.id, { title: '改过名的馆', description: '', expectedVersion: withCity.version }, db);
    assert.equal(omitted.regionCity, '南阳');

    const cleared = await updateMuseum(owner.id, museum.id, { title: omitted.title, description: '', regionCity: null, expectedVersion: omitted.version }, db);
    assert.equal(cleared.regionCity, null);
  });
});

test('数据库层拒绝白名单外的城市名', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'region-check');
    const museum = await createMuseum(owner.id, { title: '白名单测试馆', description: '' }, db);
    // 应用层有 zod 白名单；这里验证数据库自己也拦，避免绕过接口直接写库。
    await assert.rejects(db.query('UPDATE museums SET region_city=$1 WHERE id=$2', ['洛阳市涧西区', museum.id]), { code: '23514' });
  });
});


test('发布后修改草稿标题不会泄露到榜单，重新发布后才更新', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'snapshot-title');
    const museum = await publishedMuseum(db, owner.id, '已发布标题', null);
    const current = await getMuseum(owner.id, museum.museumId, db);
    const draft = await updateMuseum(owner.id, museum.museumId, {
      title: '尚未公开的私密标题', description: '', expectedVersion: current.version,
    }, db);
    const title = async () => (await readLeaderboard(db)).entries.find((entry) => entry.museumId === museum.museumId)?.title;
    assert.equal(await title(), '已发布标题');
    await publishMuseum(owner.id, museum.museumId, draft.version, db);
    assert.equal(await title(), '尚未公开的私密标题');
  });
});


test('发现收录需明确同意，撤回不关闭参观链接，旧客户端缺省保留授权', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'consent-owner');
    const visitor = await account(db, 'consent-visitor');
    const museum = await publishedMuseum(db, owner.id, '仅持链接访问的馆', '洛阳', false);
    const draft = await getMuseum(owner.id, museum.museumId, db);
    assert.equal(draft.discoveryListed, false);
    assert.equal(await viewCountOf(db, museum.museumId), undefined);
    assert.equal((await readRegionDistribution(db)).cities.find(({ city }) => city === '洛阳')?.museumCount, 0);
    const listed = await updateMuseum(owner.id, museum.museumId, {
      title: draft.title, description: draft.description, expectedVersion: draft.version, regionCity: '洛阳', discoveryListed: true,
    }, db);
    assert.equal(listed.discoveryListed, true);
    assert.equal(await viewCountOf(db, museum.museumId), 0);
    assert.equal((await readRegionDistribution(db)).cities.find(({ city }) => city === '洛阳')?.museumCount, 1);
    const preserved = await updateMuseum(owner.id, museum.museumId, {
      title: listed.title, description: listed.description, expectedVersion: listed.version,
    }, db);
    assert.equal(preserved.discoveryListed, true);
    const revoked = await updateMuseum(owner.id, museum.museumId, {
      title: preserved.title, description: preserved.description, expectedVersion: preserved.version, discoveryListed: false,
    }, db);
    assert.equal(revoked.discoveryListed, false);
    assert.equal(await viewCountOf(db, museum.museumId), undefined);
    assert.equal((await readRegionDistribution(db)).cities.find(({ city }) => city === '洛阳')?.museumCount, 0);
    assert.equal((await readShare(visitor.id, museum.token, db)).id, museum.museumId);
    const stillRevoked = await updateMuseum(owner.id, museum.museumId, {
      title: revoked.title, description: revoked.description, expectedVersion: revoked.version,
    }, db);
    assert.equal(stillRevoked.discoveryListed, false);
  });
});
