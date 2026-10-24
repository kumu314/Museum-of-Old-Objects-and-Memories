import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { CreateExhibitInput } from '../../src/contracts';
import { adoptAiDraft } from '../../src/server/core/ai';
import { createExhibit, createMuseum, confirmExhibit, getMuseum, getPrivateAsset, listMuseums, publishMuseum,
  removeMuseum, rotateShareToken, stopSharing, updateMuseum, readShare, getShareAsset } from '../../src/server/core';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

type Account = { id: string; name: string };

/**
 * 两个独立账号在同一事务里各自建馆。
 * 事务保证测试数据不落库，也让失败时不必清理。
 */
async function twoAccounts(work: (db: PoolClient, owner: Account, stranger: Account) => Promise<void>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const accounts: Account[] = [];
    for (const label of ['owner', 'stranger']) {
      const id = randomUUID();
      await db.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
        [id, `ownership-${label}-${id}`, 'test-only', 'user']);
      accounts.push({ id, name: label });
    }
    const [owner, stranger] = accounts;
    assert.ok(owner && stranger);
    await work(db, owner, stranger);
  } finally { await db.query('ROLLBACK'); db.release(); }
}

function exhibitInput(expectedMuseumVersion: number): CreateExhibitInput {
  return { name: '旧车票', era: '年代待考', slotIndex: 0, modelKey: 'ticket', caption: '归属测试展签',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '候选演示模型', sourceNotice: '仅作归属测试',
    rawStory: '内部原文不可公开', transcript: null,
    sourceSegments: [{ id: 'raw-1', text: '内部原文不可公开', source: 'rawStory' }], expectedMuseumVersion };
}

/** 越权一律必须是 NOT_FOUND：区分「不存在」与「不属于你」等于提供存在性探测。 */
async function hidden(action: Promise<unknown>) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof HttpError, `expected HttpError, got ${String(error)}`);
    assert.equal(error.failure.code, 'NOT_FOUND');
    assert.equal(error.failure.message, '未找到该内容。');
    return true;
  });
}

test('归属隔离：列表、读取、写入、素材与删除都不越权', async () => {
  await twoAccounts(async (db, owner, stranger) => {
    const mine = await createMuseum(owner.id, { title: '归属测试馆', description: '' }, db);
    const theirs = await createMuseum(stranger.id, { title: '他人展馆', description: '' }, db);
    const assetId = randomUUID();
    await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
      VALUES($1,$2,'old.webp','image','image/webp',100,$3,10,10,$4,$5)`,
      [assetId, mine.id, `${assetId}.processed`, '0'.repeat(64), owner.id]);

    const ownerList = await listMuseums(owner.id, db);
    const strangerList = await listMuseums(stranger.id, db);
    assert.deepEqual(ownerList.map((item) => item.id), [mine.id]);
    assert.deepEqual(strangerList.map((item) => item.id), [theirs.id]);

    assert.equal((await getMuseum(owner.id, mine.id, db)).id, mine.id);
    await hidden(getMuseum(stranger.id, mine.id, db));

    await hidden(updateMuseum(stranger.id, mine.id, { title: '被改名', description: '', expectedVersion: mine.version }, db));
    // 越权更新不能顺手把版本号推进，否则归属人下次保存会收到假的版本冲突。
    assert.equal((await getMuseum(owner.id, mine.id, db)).title, '归属测试馆');

    await hidden(createExhibit(stranger.id, mine.id, exhibitInput(mine.version), db));
    await hidden(getPrivateAsset(stranger.id, mine.id, assetId, db));
    await hidden(removeMuseum(stranger.id, mine.id, mine.version, db));

    // 他人展馆不存在与他馆不存在必须给出同一个错误，不留存在性差异。
    await hidden(getMuseum(stranger.id, mine.id, db));
    await hidden(getMuseum(stranger.id, randomUUID(), db));
  });
});

test('归属隔离：发布、分享换链与停止分享只能由归属账号执行', async () => {
  await twoAccounts(async (db, owner, stranger) => {
    const mine = await createMuseum(owner.id, { title: '发布归属馆', description: '' }, db);
    const image = randomUUID();
    await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
      VALUES($1,$2,'shared.webp','image','image/webp',100,$3,10,10,$4,$5)`,
      [image, mine.id, `${image}.processed`, '0'.repeat(64), owner.id]);
    const exhibit = await createExhibit(owner.id, mine.id, { ...exhibitInput(mine.version), photoAssetId: image }, db);
    await confirmExhibit(owner.id, mine.id, exhibit.id,
      { expectedVersion: exhibit.version, confirmationNote: '归属测试确认' }, db);
    const version = (await getMuseum(owner.id, mine.id, db)).version;

    await hidden(publishMuseum(stranger.id, mine.id, version, db));
    const published = await publishMuseum(owner.id, mine.id, version, db);
    assert.equal(published.token, null);
    const { token } = await rotateShareToken(owner.id, mine.id, version, db);

    await hidden(rotateShareToken(stranger.id, mine.id, (await getMuseum(owner.id, mine.id, db)).version, db));
    await hidden(stopSharing(stranger.id, mine.id, (await getMuseum(owner.id, mine.id, db)).version, db));

    // 登录后持链接可参观，参观者不必是所有者；制作权限仍按归属隔离。
    assert.equal((await readShare(stranger.id, token, db)).id, mine.id);
    assert.equal((await getShareAsset(stranger.id, token, image, db)).asset.id, image);
    await db.query('UPDATE team_members SET active=false WHERE id=$1', [stranger.id]);
    for (const action of [() => readShare(stranger.id, token, db), () => getShareAsset(stranger.id, token, image, db)]) {
      await assert.rejects(action(), (error: unknown) => error instanceof HttpError && error.failure.code === 'UNAUTHORIZED');
    }
    assert.equal((await getMuseum(owner.id, mine.id, db)).shareEnabled, true);
  });
});

test('归属隔离：AI 采纳不能跨馆使用他人草稿', async () => {
  await twoAccounts(async (db, owner, stranger) => {
    const mine = await createMuseum(owner.id, { title: 'AI 归属馆', description: '' }, db);
    const exhibit = await createExhibit(owner.id, mine.id, exhibitInput(mine.version), db);
    const draftId = randomUUID();
    await db.query('INSERT INTO ai_drafts(id,museum_id,exhibit_id,source_version,output,provider,model) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [draftId, mine.id, exhibit.id, exhibit.version, JSON.stringify({ caption: '草稿', questions: [], citations: [] }),
        'https://example.test', 'test-model']);

    await hidden(adoptAiDraft(stranger.id, mine.id, exhibit.id,
      { draftId, caption: '被他人采纳', expectedVersion: exhibit.version }, db));
    const adopted = await adoptAiDraft(owner.id, mine.id, exhibit.id,
      { draftId, caption: '归属账号采纳', expectedVersion: exhibit.version }, db);
    assert.equal(adopted.caption, '归属账号采纳');
  });
});

test('归属在创建后不可更改，误改会直接失败', async () => {
  await twoAccounts(async (db, owner, stranger) => {
    const mine = await createMuseum(owner.id, { title: '归属不可变馆', description: '' }, db);
    await assert.rejects(
      db.query('UPDATE museums SET created_by=$1 WHERE id=$2', [stranger.id, mine.id]),
      /Museum ownership is fixed at creation/,
    );
  });
});
