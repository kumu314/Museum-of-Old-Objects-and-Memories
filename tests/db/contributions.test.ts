import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { CreateExhibitInput } from '../../src/contracts';
import { toPublicationView } from '../../src/features/contributors/model';
import {
  cancelInvitation,
  contribute,
  createExhibit,
  createMuseum,
  inviteContributor,
  listMyContributions,
  readContributionState,
  removeMuseum,
  removeExhibit,
  respondInvitation,
  withdrawContribution,
} from '../../src/server/core';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

/**
 * 共同作者与多人讲述的真实 SQL。
 *
 * 纯规则（`toPublicationView` / `withdrawContribution` 的名字判定）已经有
 * `model.test.ts`；这一层测的是纯函数测不到的部分：跨表署名权判定、
 * "只认作者本人"的 WHERE 条件、以及数据库自己拒绝非法状态。
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
  const username = `contrib-${label}-${id}`;
  await db.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
    [id, username, 'test-only', 'user']);
  return { id, username };
}

function exhibitInput(expectedMuseumVersion: number): CreateExhibitInput {
  return {
    name: '为人民服务 · 搪瓷缸', era: '1960 年代', slotIndex: 0, modelKey: 'camera-01', caption: '共同作者测试展签',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null },
    approximation: '候选演示模型', sourceNotice: '仅作共同作者测试', rawStory: '内部原文不可公开', transcript: null,
    sourceSegments: [{ id: 'raw-1', text: '内部原文不可公开', source: 'rawStory' }], expectedMuseumVersion,
  };
}

/** 一座馆 + 一件展品，不发布：共同作者与发布流程无关。 */
async function museumWithExhibit(db: PoolClient, ownerId: string, label: string): Promise<{ museumId: string; exhibitId: string }> {
  const museum = await createMuseum(ownerId, { title: `共同作者测试馆 ${label}`, description: '' }, db);
  const exhibit = await createExhibit(ownerId, museum.id, exhibitInput(museum.version), db);
  return { museumId: museum.id, exhibitId: exhibit.id };
}

function notFound(error: unknown): boolean {
  assert.ok(error instanceof HttpError, `预期 HttpError，实际是 ${String(error)}`);
  assert.equal(error.failure.code, 'NOT_FOUND');
  return true;
}

test('未接受邀请不能署名：待回应的邀请不产生任何写入资格', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'pending-owner');
    const guest = await account(db, 'pending-guest');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'pending');

    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    assert.equal(invitation.status, 'pending');
    assert.equal(invitation.isDemo, false);
    await assert.rejects(contribute(guest.id, museumId, exhibitId,
      { story: '我来讲讲这只缸。', sourceNote: '李素云口述', publishConsent: true }, db), notFound);

    // 接受之后才拿到署名权，角色是 coauthor 而不是 owner。
    const accepted = await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db);
    assert.equal(accepted.status, 'accepted');
    assert.ok(accepted.respondedAt);
    const written = await contribute(guest.id, museumId, exhibitId,
      { story: '我来讲讲这只缸。', sourceNote: '李素云口述', publishConsent: true }, db);
    assert.equal(written.authorRole, 'coauthor');
    assert.equal(written.authorName, guest.username);
  });
});

test('只有被邀请人自己能回应，别人的邀请与不存在同一回答', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'respond-owner');
    const guest = await account(db, 'respond-guest');
    const outsider = await account(db, 'respond-outsider');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'respond');
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);

    await assert.rejects(respondInvitation(outsider.id, invitation.id, { status: 'accepted' }, db), notFound);
    // 馆主也不能替对方回应：接受是对方的意思表示。
    await assert.rejects(respondInvitation(owner.id, invitation.id, { status: 'accepted' }, db), notFound);
    const state = await readContributionState(owner.id, museumId, exhibitId, db);
    assert.equal(state.invitations[0]?.status, 'pending');
  });
});

test('同一展品不能重复邀请，拒绝之后可以重新邀请', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'redeliver-owner');
    const guest = await account(db, 'redeliver-guest');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'redeliver');
    const first = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);

    await assert.rejects(inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.failure.code, 'VALIDATION_ERROR');
      return true;
    });
    await respondInvitation(guest.id, first.id, { status: 'declined' }, db);
    // 拒绝是对方的决定，换一个时机重新邀请是正常动作。
    const second = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    assert.notEqual(second.id, first.id);
    assert.equal(second.status, 'pending');
    const state = await readContributionState(owner.id, museumId, exhibitId, db);
    // 两条记录都在，且新的一条仍是 pending：被拒绝的不占"生效中"名额。
    assert.deepEqual(new Set(state.invitations.map((item) => item.id)), new Set([first.id, second.id]));
    assert.equal(state.invitations.filter((item) => item.status === 'pending').length, 1);
  });
});

test('馆主自己写讲述记为 owner，且不需要也不能邀请自己', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'own-owner');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'own');
    const written = await contribute(owner.id, museumId, exhibitId,
      { story: '这是我家的缸。', sourceNote: '周砚自述', publishConsent: true }, db);
    assert.equal(written.authorRole, 'owner');
    await assert.rejects(inviteContributor(owner.id, museumId, exhibitId, { username: owner.username }, db), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.failure.code, 'VALIDATION_ERROR');
      return true;
    });
  });
});

test('撤回只可能撤自己的：别人的讲述一律 NOT_FOUND', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'withdraw-owner');
    const guest = await account(db, 'withdraw-guest');
    const outsider = await account(db, 'withdraw-outsider');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'withdraw');
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db);
    const guestStory = await contribute(guest.id, museumId, exhibitId,
      { story: '缸底有我父亲刻的字。', sourceNote: '李素云口述', publishConsent: true }, db);

    await assert.rejects(withdrawContribution(outsider.id, guestStory.id, db), notFound);
    await assert.rejects(withdrawContribution(owner.id, guestStory.id, db), notFound);

    const withdrawn = await withdrawContribution(guest.id, guestStory.id, db);
    assert.ok(withdrawn.withdrawnAt);
    // 重复撤回是幂等的：不报错、也不再改时间。
    const again = await withdrawContribution(guest.id, guestStory.id, db);
    assert.equal(again.withdrawnAt, withdrawn.withdrawnAt);
  });
});

test('公开版本逐份判定：撤回、未同意、邀请被收回各自给出原因', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'publish-owner');
    const guest = await account(db, 'publish-guest');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'publish');
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db);

    const ownerStory = await contribute(owner.id, museumId, exhibitId,
      { story: '馆主的那份。', sourceNote: '周砚自述', publishConsent: true }, db);
    const guestStory = await contribute(guest.id, museumId, exhibitId,
      { story: '共同作者的那份。', sourceNote: '李素云口述', publishConsent: false }, db);
    await withdrawContribution(guest.id, guestStory.id, db);

    const state = await readContributionState(owner.id, museumId, exhibitId, db);
    const view = toPublicationView(state);
    // 两份内容各自成条：不合并、不生成摘要，公开版里也不出现内部状态字段。
    assert.deepEqual(view.contributions.map((item) => item.id), [ownerStory.id]);
    assert.deepEqual(view.excluded.map((item) => [item.id, item.reason]), [[guestStory.id, 'withdrawn']]);
    const published = view.contributions[0];
    assert.ok(published, '馆主同意公开的那份应当出现在公开版本里。');
    assert.equal('publishConsent' in published, false);
    assert.equal('withdrawnAt' in published, false);
  });
});

test('未同意的内容不进公开版，即使作者有署名权', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'consent-owner');
    const guest = await account(db, 'consent-guest');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'consent');
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db);
    const story = await contribute(guest.id, museumId, exhibitId,
      { story: '先记下来，但还不想公开。', sourceNote: '李素云口述', publishConsent: false }, db);

    const view = toPublicationView(await readContributionState(owner.id, museumId, exhibitId, db));
    assert.deepEqual(view.contributions, []);
    assert.deepEqual(view.excluded.map((item) => [item.id, item.reason]), [[story.id, 'no-consent']]);
  });
});

test('馆主收回待回应邀请后，对方立刻失去写入资格', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'cancel-owner');
    const guest = await account(db, 'cancel-guest');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'cancel');
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);

    const cancelled = await cancelInvitation(owner.id, invitation.id, db);
    assert.equal(cancelled.status, 'cancelled');
    await assert.rejects(respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.failure.code, 'VALIDATION_ERROR');
      return true;
    });
    await assert.rejects(contribute(guest.id, museumId, exhibitId,
      { story: '还有一句想说。', sourceNote: '李素云口述', publishConsent: true }, db), notFound);
  });
});

test('被邀请人只看得到自己的邀请与讲述', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'mine-owner');
    const guest = await account(db, 'mine-guest');
    const other = await account(db, 'mine-other');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'mine');
    const guestInvite = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    await inviteContributor(owner.id, museumId, exhibitId, { username: other.username }, db);
    await respondInvitation(guest.id, guestInvite.id, { status: 'accepted' }, db);
    const guestStory = await contribute(guest.id, museumId, exhibitId,
      { story: '我的那份。', sourceNote: '李素云口述', publishConsent: true }, db);
    await contribute(owner.id, museumId, exhibitId,
      { story: '馆主的那份。', sourceNote: '周砚自述', publishConsent: true }, db);

    const mine = await listMyContributions(guest.id, db);
    assert.deepEqual(mine.invitations.map((item) => item.invitation.id), [guestInvite.id]);
    assert.deepEqual(mine.contributions.map((item) => item.contribution.id), [guestStory.id]);
    assert.equal(mine.contributions[0]?.exhibitName, '为人民服务 · 搪瓷缸');
    // 别人的邀请与别人的讲述都不在收件箱里。
    assert.equal(mine.invitations.some((item) => item.invitation.inviteeId === other.id), false);

    const otherMine = await listMyContributions(other.id, db);
    assert.deepEqual(otherMine.contributions, []);
    assert.deepEqual(otherMine.invitations.map((item) => item.invitation.status), ['pending']);
  });
});

test('展馆下线后，对方的收件箱里不再出现该馆的邀请', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'offline-owner');
    const guest = await account(db, 'offline-guest');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'offline');
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
    assert.equal((await listMyContributions(guest.id, db)).invitations.length, 1);

    const current = (await db.query<{ version: number }>('SELECT version FROM museums WHERE id=$1', [museumId])).rows[0];
    assert.ok(current, '刚建出来的展馆必须有版本号。');
    await removeMuseum(owner.id, museumId, current.version, db);

    assert.deepEqual((await listMyContributions(guest.id, db)).invitations, []);
    // 邀请行本身还在：下线是展示层过滤，不是删数据。
    assert.equal((await db.query('SELECT id FROM contribution_invitations WHERE id=$1', [invitation.id])).rowCount, 1);
  });
});

test('数据库自己拒绝非法状态：待回应却有回应时间、同一展品两条生效邀请', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'check-owner');
    const guest = await account(db, 'check-guest');
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'check');
    await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);

    // 绕过服务端直接写：这两条都必须被数据库挡住，否则并发或人肉 SQL 就能造出脏状态。
    // 每条失败都会中止事务，所以各自退回到同一个保存点再试下一条。
    await db.query('SAVEPOINT invalid_state');
    await assert.rejects(db.query(
      `INSERT INTO contribution_invitations(museum_id,exhibit_id,invitee_id,invited_by,invitee_name,status,responded_at)
       VALUES($1,$2,$3,$4,'x','pending',now())`, [museumId, exhibitId, guest.id, owner.id]), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT invalid_state');
    await assert.rejects(db.query(
      `INSERT INTO contribution_invitations(museum_id,exhibit_id,invitee_id,invited_by,invitee_name,status)
       VALUES($1,$2,$3,$4,'x','pending')`, [museumId, exhibitId, guest.id, owner.id]), { code: '23505' });
  });
});

for (const removed of ['museum', 'exhibit'] as const) {
  test(`删除 ${removed} 后旧邀请不能回应、收回或继续投稿`, async () => {
    await inRollback(async (db) => {
      const owner = await account(db, 'del-owner');
      const guest = await account(db, 'del-guest');
      const pendingGuest = await account(db, 'del-pending');
      const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'deleted');
      const accepted = await inviteContributor(owner.id, museumId, exhibitId, { username: guest.username }, db);
      await respondInvitation(guest.id, accepted.id, { status: 'accepted' }, db);
      const pending = await inviteContributor(owner.id, museumId, exhibitId, { username: pendingGuest.username }, db);
      if (removed === 'museum') {
        await removeMuseum(owner.id, museumId, 2, db);
      } else {
        await removeExhibit(owner.id, museumId, exhibitId, 1, db);
      }
      await assert.rejects(respondInvitation(pendingGuest.id, pending.id, { status: 'accepted' }, db), notFound);
      await assert.rejects(cancelInvitation(owner.id, pending.id, db), notFound);
      await assert.rejects(inviteContributor(owner.id, museumId, exhibitId, { username: pendingGuest.username }, db), notFound);
      for (const actorId of [owner.id, guest.id]) {
        await assert.rejects(contribute(actorId, museumId, exhibitId,
          { story: '删除后不应保存。', sourceNote: '本人', publishConsent: false }, db), notFound);
      }
      assert.equal((await db.query('SELECT 1 FROM contributions WHERE exhibit_id=$1', [exhibitId])).rowCount, 0);
    });
  });
}

test('合法的 80 字符用户名可以接受邀请并保留完整署名', async () => {
  await inRollback(async (db) => {
    const owner = await account(db, 'long-owner');
    const guest = await account(db, 'long-guest');
    const username = `${guest.id}${'x'.repeat(44)}`;
    await db.query('UPDATE team_members SET username=$1 WHERE id=$2', [username, guest.id]);
    const { museumId, exhibitId } = await museumWithExhibit(db, owner.id, 'long-name');
    const invitation = await inviteContributor(owner.id, museumId, exhibitId, { username }, db);
    assert.equal(invitation.inviteeName, username);
    await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, db);
    const contribution = await contribute(guest.id, museumId, exhibitId,
      { story: '完整署名。', sourceNote: '本人', publishConsent: true }, db);
    assert.equal(contribution.authorName, username);
    const view = toPublicationView(await readContributionState(owner.id, museumId, exhibitId, db));
    assert.equal(view.contributions[0]?.authorName, username);
    assert.equal((await listMyContributions(guest.id, db)).contributions[0]?.contribution.authorName, username);
  });
});

for (const removed of ['museum', 'exhibit'] as const) {
  for (const action of ['respond', 'contribute'] as const) {
    test(`${action} 等待删除 ${removed} 的事务后重新检查资源状态`, async () => {
      const deleting = await pool.connect();
      const writing = await pool.connect();
      let museumId: string | undefined;
      const accountIds: string[] = [];
      try {
        await deleting.query('BEGIN');
        const owner = await account(deleting, 'race-owner');
        const guest = await account(deleting, 'race-guest');
        accountIds.push(owner.id, guest.id);
        const resource = await museumWithExhibit(deleting, owner.id, 'race');
        museumId = resource.museumId;
        const invitation = await inviteContributor(owner.id, museumId, resource.exhibitId, { username: guest.username }, deleting);
        if (action === 'contribute') await respondInvitation(guest.id, invitation.id, { status: 'accepted' }, deleting);
        await deleting.query('COMMIT');
        await deleting.query('BEGIN');
        if (removed === 'museum') await removeMuseum(owner.id, museumId, 2, deleting);
        else await removeExhibit(owner.id, museumId, resource.exhibitId, 1, deleting);

        await writing.query('BEGIN');
        await writing.query("SET LOCAL statement_timeout='5s'");
        const pidResult = await writing.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        const pid = pidResult.rows[0]?.pid;
        assert.ok(pid);
        const work = action === 'respond'
          ? respondInvitation(guest.id, invitation.id, { status: 'accepted' }, writing)
          : contribute(guest.id, museumId, resource.exhibitId,
            { story: '并发写入不应成功。', sourceNote: '本人', publishConsent: false }, writing);
        // 立刻处理拒绝，避免在等待锁状态期间产生未处理的 Promise rejection。
        const outcome = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const result = await deleting.query<{ blocked: boolean }>(
            'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
          if (result.rows[0]?.blocked === true) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        // 先释放事务，即使断言失败也不会留下等待本连接的后台请求。
        await deleting.query('COMMIT');
        const result = await outcome;
        assert.ok(blocked, '写入必须等待展馆锁，不能穿过未提交的删除');
        assert.equal(result.ok, false);
        if (!result.ok) notFound(result.error);
        await writing.query('ROLLBACK');
        assert.equal((await deleting.query('SELECT 1 FROM contributions WHERE museum_id=$1', [museumId])).rowCount, 0);
      } finally {
        await deleting.query('ROLLBACK');
        await writing.query('ROLLBACK');
        if (museumId !== undefined) {
          await deleting.query('DELETE FROM contributions WHERE museum_id=$1', [museumId]);
          await deleting.query('DELETE FROM contribution_invitations WHERE museum_id=$1', [museumId]);
          await deleting.query('DELETE FROM exhibits WHERE museum_id=$1', [museumId]);
          await deleting.query('DELETE FROM museums WHERE id=$1', [museumId]);
        }
        await deleting.query('DELETE FROM team_members WHERE id=ANY($1::uuid[])', [accountIds]);
        deleting.release();
        writing.release();
      }
    });
  }
}
