import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { ExhibitDraft, UpdateExhibitInput } from '../../src/contracts';
import { createMuseum, createExhibit, confirmExhibit, getMuseum, publishMuseum, removeExhibit,
  removeMuseum, rotateShareToken, readShare, updateExhibit, updateMuseum } from '../../src/server/core';
import { getOwnPublishedMuseum } from '../../src/server/core/sharing';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

async function fixture(work: (db: PoolClient, owner: string, other: string) => Promise<void>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const owner = randomUUID(); const other = randomUUID();
    for (const id of [owner, other]) {
      await db.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
        [id, `published-owner-${id}`, 'test-only', 'user']);
    }
    await work(db, owner, other);
  } finally { await db.query('ROLLBACK'); db.release(); }
}

async function publishFixture(db: PoolClient, owner: string) {
  const museum = await createMuseum(owner, { title: '已发布展馆', description: '发布时的简介' }, db);
  const exhibit = await createExhibit(owner, museum.id, {
    name: '合成相机', era: '约九十年代', slotIndex: 0, modelKey: 'camera-01', caption: '只公开已确认展签。',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null },
    approximation: '内置测试模型', sourceNotice: '合成回归资料', rawStory: '仅供馆主编辑的原始讲述',
    transcript: '仅供馆主编辑的录音整理', sourceSegments: [{ id: 'raw-1', text: '仅供馆主编辑的原始讲述', source: 'rawStory' }],
    expectedMuseumVersion: museum.version,
  }, db);
  await db.query('INSERT INTO ai_drafts(id,museum_id,exhibit_id,source_version,output,provider,model) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), museum.id, exhibit.id, exhibit.version,
      JSON.stringify({ caption: '尚未采纳的内部 AI 草稿', questions: [], citations: [] }), 'https://example.test', 'test-model']);
  await confirmExhibit(owner, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '内部确认备注' }, db);
  await publishMuseum(owner, museum.id, (await getMuseum(owner, museum.id, db)).version, db);
  return { museumId: museum.id, exhibit };
}

function editInput(exhibit: ExhibitDraft): UpdateExhibitInput {
  return {
    name: exhibit.name, era: exhibit.era, slotIndex: exhibit.slotIndex, modelKey: exhibit.modelKey,
    caption: exhibit.caption, photoAssetId: exhibit.photoAssetId, audioAssetId: exhibit.audioAssetId,
    approximation: exhibit.approximation, sourceNotice: exhibit.sourceNotice, rawStory: exhibit.rawStory,
    transcript: exhibit.transcript, sourceSegments: exhibit.sourceSegments, modelInput: exhibit.modelInput,
    expectedVersion: exhibit.version,
  };
}

async function sharingState(db: PoolClient, museumId: string) {
  const result = await db.query<{
    access_mode: string; access_epoch: string | null; share_token_hash: string | null; current_snapshot_id: string | null; version: number;
  }>(`SELECT access_mode,access_epoch,share_token_hash,current_snapshot_id,version
    FROM museums WHERE id=$1`, [museumId]);
  const row = result.rows[0];
  assert.ok(row);
  return row;
}

test('馆主直接查看私密发布快照；草稿修改或删除不改变展示，读取不启用或轮换分享', async () => {
  await fixture(async (db, owner) => {
    const { museumId, exhibit } = await publishFixture(db, owner);
    const privateState = await sharingState(db, museumId);
    assert.equal(privateState.access_mode, 'private');
    assert.equal(privateState.share_token_hash, null);
    const published = await getOwnPublishedMuseum(owner, db);
    assert.ok(published);
    assert.equal(published.id, museumId);
    assert.equal(published.title, '已发布展馆');
    assert.deepEqual(await sharingState(db, museumId), privateState);
    const displayed = published.exhibits[0];
    assert.ok(displayed);
    for (const field of ['rawStory', 'transcript', 'sourceSegments', 'modelInput', 'confirmationNote', 'confirmedAt']) {
      assert.equal(field in displayed, false);
    }
    assert.doesNotMatch(JSON.stringify(published), /仅供馆主编辑|尚未采纳的内部 AI 草稿|内部确认备注/);

    await updateMuseum(owner, museumId, {
      title: '尚未发布的新标题', description: '尚未发布的新简介',
      expectedVersion: (await getMuseum(owner, museumId, db)).version,
    }, db);
    const changed = await updateExhibit(owner, museumId, exhibit.id, {
      ...editInput(exhibit), caption: '尚未确认的新展签。',
    }, db);
    assert.deepEqual(await getOwnPublishedMuseum(owner, db), published);
    await removeExhibit(owner, museumId, changed.id, changed.version, db);
    assert.equal((await getMuseum(owner, museumId, db)).exhibits.length, 0);
    const afterEditing = await sharingState(db, museumId);
    assert.deepEqual(await getOwnPublishedMuseum(owner, db), published);
    assert.deepEqual(await sharingState(db, museumId), afterEditing);
    assert.equal(afterEditing.access_mode, 'private');
    assert.equal(afterEditing.share_token_hash, null);

    const { token } = await rotateShareToken(owner, museumId, (await getMuseum(owner, museumId, db)).version, db);
    const linkedState = await sharingState(db, museumId);
    assert.deepEqual(await getOwnPublishedMuseum(owner, db), published);
    assert.deepEqual(await sharingState(db, museumId), linkedState);
    assert.deepEqual(await readShare(owner, token, db), published);
  });
});

test('馆主发布入口不泄露他馆；无发布、删除与禁用账号分别返回空或拒绝', async () => {
  await fixture(async (db, owner, other) => {
    assert.equal(await getOwnPublishedMuseum(owner, db), null);
    const { museumId } = await publishFixture(db, owner);
    assert.equal(await getOwnPublishedMuseum(other, db), null);
    await createMuseum(other, { title: '只有草稿的他馆', description: '' }, db);
    assert.equal(await getOwnPublishedMuseum(other, db), null);
    await db.query('UPDATE team_members SET active=false WHERE id=$1', [owner]);
    await assert.rejects(getOwnPublishedMuseum(owner, db),
      (error: unknown) => error instanceof HttpError && error.failure.code === 'UNAUTHORIZED');
    await db.query('UPDATE team_members SET active=true WHERE id=$1', [owner]);
    await removeMuseum(owner, museumId, (await getMuseum(owner, museumId, db)).version, db);
    assert.equal(await getOwnPublishedMuseum(owner, db), null);
  });
});
