import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { CreateExhibitInput } from '../../src/contracts';
import {
  cancelInvitation,
  confirmExhibit,
  contribute,
  createExhibit,
  createMuseum,
  getMuseum,
  inviteContributor,
  publishMuseum,
  readContributionState,
  readShareContributions,
  respondInvitation,
  stopSharing,
  withdrawContribution,
} from '../../src/server/core';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

/**
 * 参观页读取多人讲述的真实 SQL（方向二 · 第五块）。
 *
 * 这一层测的是纯函数绝对测不到的东西：
 * - `publish_consent` / `withdrawn_at` 两个条件是否真的写进了 WHERE；
 * - 展品范围是否严格取自**发布快照**，而不是活表；
 * - token 失效时是否和读展馆一样 404，而不是给出可区分的回答；
 * - 返回给读者的字段里是否混进了 `authorId`。
 *
 * 最要紧的一条是"撤回立即生效"：讲述不进快照，这是刻意的设计取舍，
 * 所以必须有一条测试盯着"撤回后不需要重新发布就已经读不到"。
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

async function account(db: PoolClient, label: string): Promise<{ id: string; username: string }> {
  const id = randomUUID();
  const username = `share-contrib-${label}-${id}`;
  await db.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
    [id, username, 'test-only', 'user']);
  return { id, username };
}

function exhibitInput(name: string, slotIndex: number, expectedMuseumVersion: number): CreateExhibitInput {
  return {
    name, era: '年代待考', slotIndex, modelKey: 'camera-01', caption: '公开讲述测试展签',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null },
    approximation: '候选演示模型', sourceNotice: '仅作公开讲述测试', rawStory: '内部原文不可公开', transcript: null,
    sourceSegments: [{ id: 'raw-1', text: '内部原文不可公开', source: 'rawStory' }], expectedMuseumVersion,
  };
}

/** 造一座「已发布、分享中」的馆：一件展品，走真实发布事务拿到 token。 */
async function publishedMuseum(db: PoolClient, ownerId: string, title: string): Promise<{ museumId: string; exhibitId: string; token: string }> {
  const museum = await createMuseum(ownerId, { title, description: '' }, db);
  const image = randomUUID();
  await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
    VALUES($1,$2,'cover.webp','image','image/webp',100,$3,10,10,$4,$5)`,
    [image, museum.id, `${image}.processed`, '0'.repeat(64), ownerId]);
  const exhibit = await createExhibit(ownerId, museum.id, { ...exhibitInput('搪瓷缸', 0, museum.version), photoAssetId: image }, db);
  await confirmExhibit(ownerId, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '公开讲述测试确认' }, db);
  const current = (await getMuseum(ownerId, museum.id, db)).version;
  const published = await publishMuseum(ownerId, museum.id, current, db);
  assert.ok(published.token, '首次发布必须返回参观 token。');
  return { museumId: museum.id, exhibitId: exhibit.id, token: published.token };
}

const stories = { story: '这只缸是我父亲 1968 年从厂里带回来的。', sourceNote: '2026 年 10 月，家中访谈，本人讲述' };

test('只返回作者同意公开且未撤回的讲述，顺序按创建时间稳定', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'owner');
    const guest = await account(db, 'guest');
    const reader = await account(db, 'reader');
    const { museumId, exhibitId, token } = await publishedMuseum(db, owner.id, '公开讲述排序馆');

    // 先接受邀请，再依次写三份：两份同意公开、一份不同意。
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db);
    // 三条都在同一个事务里，`now()`（= 事务开始时间）完全相同，直接写会退化成按 uuid 平局排序。
    // 生产上每次讲述是独立事务，时间天然不同；这里显式把时间轴拉开，测的才是"按创建时间排"。
    const first = await contribute(owner.id, museumId, exhibitId, { ...stories, story: '馆主先讲的一段。', publishConsent: true }, db);
    await db.query(`UPDATE contributions SET created_at=now()-interval '3 minutes' WHERE id=$1`, [first.id]);
    const second = await contribute(guest.id, museumId, exhibitId, { ...stories, story: '客人后讲的一段。', publishConsent: true }, db);
    await db.query(`UPDATE contributions SET created_at=now()-interval '2 minutes' WHERE id=$1`, [second.id]);
    const third = await contribute(guest.id, museumId, exhibitId, { ...stories, story: '这段没同意公开。', publishConsent: false }, db);
    await db.query(`UPDATE contributions SET created_at=now()-interval '1 minute' WHERE id=$1`, [third.id]);

    const shared = await readShareContributions(reader.id, token, db);
    assert.equal(shared.museumId, museumId);
    assert.deepEqual(shared.contributions.map((item) => item.story), ['馆主先讲的一段。', '客人后讲的一段。']);
    assert.deepEqual(shared.contributions.map((item) => item.authorRole), ['owner', 'coauthor']);
    assert.deepEqual(shared.contributions.map((item) => item.authorName), [owner.username, guest.username]);
  });
});

test('返回给读者的字段里没有 authorId：账号主键不进公开接口', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'owner');
    const reader = await account(db, 'reader');
    const { museumId, exhibitId, token } = await publishedMuseum(db, owner.id, '公开字段测试馆');
    await contribute(owner.id, museumId, exhibitId, { ...stories, publishConsent: true }, db);

    const shared = await readShareContributions(reader.id, token, db);
    assert.equal(shared.contributions.length, 1);
    const first = shared.contributions[0];
    assert.ok(first);
    assert.equal('authorId' in first, false);
    assert.equal('publishConsent' in first, false);
    assert.equal('withdrawnAt' in first, false);
    assert.deepEqual(Object.keys(first).sort(), ['authorName', 'authorRole', 'exhibitId', 'id', 'sourceNote', 'story']);
  });
});

test('撤回立即生效：不需要重新发布，公开列表里就没有了', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'owner');
    const reader = await account(db, 'reader');
    const { museumId, exhibitId, token } = await publishedMuseum(db, owner.id, '公开撤回馆');
    const kept = await contribute(owner.id, museumId, exhibitId, { ...stories, story: '留下的这段。', publishConsent: true }, db);
    const withdrawn = await contribute(owner.id, museumId, exhibitId, { ...stories, story: '要撤回的这段。', publishConsent: true }, db);

    assert.equal((await readShareContributions(reader.id, token, db)).contributions.length, 2);
    const versionBefore = (await getMuseum(owner.id, museumId, db)).version;
    await withdrawContribution(owner.id, withdrawn.id, db);
    const remaining = await readShareContributions(reader.id, token, db);
    assert.deepEqual(remaining.contributions.map((item) => item.id), [kept.id]);

    // 关键：展馆没有重新发布，版本号也没动，撤回依然立刻生效。
    // 如果讲述被塞进快照，这一条必然失败——快照有不可变触发器，改不了，只能整馆重发。
    assert.equal((await getMuseum(owner.id, museumId, db)).version, versionBefore);
  });
});

test('展品范围取自发布快照：发布后新加展品上的讲述不会提前露出', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'owner');
    const reader = await account(db, 'reader');
    const { museumId, token } = await publishedMuseum(db, owner.id, '快照展品范围馆');
    // 发布之后再加一件展品并写讲述，但不重新发布：它不在任何快照里。
    const version = (await getMuseum(owner.id, museumId, db)).version;
    const later = await createExhibit(owner.id, museumId, exhibitInput('发布后加的钟', 1, version), db);
    await contribute(owner.id, museumId, later.id, { ...stories, story: '未发布展品上的一段。', publishConsent: true }, db);

    const shared = await readShareContributions(reader.id, token, db);
    assert.deepEqual(shared.contributions, []);
  });
});

test('停止分享后读讲述与读展馆一样 404，不给出可区分的回答', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'owner');
    const reader = await account(db, 'reader');
    const { museumId, exhibitId, token } = await publishedMuseum(db, owner.id, '停分享讲述馆');
    await contribute(owner.id, museumId, exhibitId, { ...stories, publishConsent: true }, db);

    const version = (await getMuseum(owner.id, museumId, db)).version;
    await stopSharing(owner.id, museumId, version, db);
    await assert.rejects(readShareContributions(reader.id, token, db), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.failure.code, 'SHARE_NOT_FOUND');
      return true;
    });
  });
});

test('伪造的 token 一律 404：讲述不是绕过参观门禁的旁路', async () => {
  await inRollback(async (db) => {
    const reader = await account(db, 'reader');
    for (const token of ['A'.repeat(43), 'not-a-token', '']) {
      await assert.rejects(readShareContributions(reader.id, token, db), (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.failure.code, 'SHARE_NOT_FOUND');
        return true;
      });
    }
  });
});

test('馆主读参观页也没有特权：别人未同意公开的讲述一样看不到', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'owner');
    const guest = await account(db, 'guest');
    const { museumId, exhibitId, token } = await publishedMuseum(db, owner.id, '馆主无特权馆');

    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db);
    await contribute(guest.id, museumId, exhibitId, { ...stories, story: '客人私下写的一段。', publishConsent: false }, db);

    // 同一个接口、同一座馆，换谁来读结果都一样：可见性只取决于作者有没有同意公开，
    // 与"读的人是不是馆主"无关。参观页不该因为读者身份多出一层特权视图。
    assert.deepEqual((await readShareContributions(owner.id, token, db)).contributions, []);
    assert.deepEqual((await readShareContributions(guest.id, token, db)).contributions, []);

    // 与此同时，馆主在自己的工作台里看得到这段草稿——两个接口的可见性不同，且这是对的。
    const state = await readContributionState(owner.id, museumId, exhibitId, db);
    assert.deepEqual(state.contributions.map((item) => item.story), ['客人私下写的一段。']);
  });
});
