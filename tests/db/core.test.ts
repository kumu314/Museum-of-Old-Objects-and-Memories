import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { CreateExhibitInput, ExhibitDraft, UpdateExhibitInput } from '../../src/contracts';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';
import { createMuseum, getMuseum, listMuseums, updateMuseum, createExhibit, updateExhibit, removeExhibit, confirmExhibit,
  publishMuseum, readShare, getShareAsset, stopSharing, rotateShareToken, getPrivateAsset } from '../../src/server/core';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

async function fixture(work: (db: PoolClient, actorId: string) => Promise<void>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const actorId = randomUUID();
    await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [actorId, `core-test-${actorId}`, 'test-only']);
    await work(db, actorId);
  } finally { await db.query('ROLLBACK'); db.release(); }
}
test('用户间隔离：非创建者读取、修改和列举他人展馆均不可见', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '私人展馆', description: '' }, db);
    await createExhibit(actor, museum.id, exhibitInput(museum.version), db);
    const outsider = randomUUID();
    await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [outsider, `outsider-${outsider}`, 'test-only']);
    await rejected(getMuseum(outsider, museum.id, db), 'NOT_FOUND');
    await rejected(updateMuseum(outsider, museum.id, { title: '篡改', description: '', expectedVersion: museum.version }, db), 'NOT_FOUND');
    await rejected(getPrivateAsset(outsider, museum.id, randomUUID(), db), 'NOT_FOUND');
    assert.deepEqual(await listMuseums(outsider, db), []);
    const own = await listMuseums(actor, db);
    assert.equal(own.length, 1);
    assert.equal(own[0]?.id, museum.id);
  });
});
function exhibitInput(expectedMuseumVersion: number, slotIndex = 0): CreateExhibitInput {
  return { name: '复古相机', era: '年代待考', slotIndex, modelKey: 'camera-01', caption: '演示展品，不代表真实物主记录。',
    photoAssetId: null, audioAssetId: null, approximation: '候选演示模型', sourceNotice: '仅作流程测试',
    rawStory: '内部原文不可公开', transcript: null, sourceSegments: [{ id: 'raw-1', text: '内部原文不可公开', source: 'rawStory' }], expectedMuseumVersion };
}
function editInput(exhibit: ExhibitDraft): UpdateExhibitInput {
  return { name: exhibit.name, era: exhibit.era, slotIndex: exhibit.slotIndex, modelKey: exhibit.modelKey,
    caption: exhibit.caption, photoAssetId: exhibit.photoAssetId, audioAssetId: exhibit.audioAssetId,
    approximation: exhibit.approximation, sourceNotice: exhibit.sourceNotice, rawStory: exhibit.rawStory,
    transcript: exhibit.transcript, sourceSegments: exhibit.sourceSegments, expectedVersion: exhibit.version };
}
async function asset(db: PoolClient, actorId: string, museumId: string, kind: 'image' | 'audio' = 'image') {
  const id = randomUUID();
  await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
    VALUES($1,$2,$3,$4,$5,100,$6,$7,$8,$9,$10)`, [id, museumId, kind === 'image' ? 'test.webp' : 'test.wav', kind,
    kind === 'image' ? 'image/webp' : 'audio/wav', `${id}.processed`, kind === 'image' ? 10 : null, kind === 'image' ? 10 : null, '0'.repeat(64), actorId]);
  return id;
}
async function rejected(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => error instanceof HttpError && error.failure.code === code);
}
async function currentVersion(db: PoolClient, actor: string, museum: string) { return (await getMuseum(actor, museum, db)).version; }

test('制作确认发布：完整未确认清单、旧快照隔离、替换素材和重新发布', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '家庭演示馆', description: '仅测试' }, db);
    const oldImage = await asset(db, actor, museum.id);
    const oldAudio = await asset(db, actor, museum.id, 'audio');
    const input = { ...exhibitInput(museum.version), photoAssetId: oldImage, audioAssetId: oldAudio };
    const first = await createExhibit(actor, museum.id, input, db);
    const second = await createExhibit(actor, museum.id, exhibitInput(await currentVersion(db, actor, museum.id), 1), db);
    await assert.rejects(publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.failure.code, 'NOT_CONFIRMED');
      if (error.failure.code === 'NOT_CONFIRMED') assert.deepEqual(error.failure.details.unconfirmedExhibitIds, [first.id, second.id]);
      return true;
    });
    for (const exhibit of [first, second]) await confirmExhibit(actor, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '测试确认，仅用于自动化测试。' }, db);
    const published = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.ok(published.token);
    const token = published.token;
    const before = await readShare(token, db);
    assert.equal(before.exhibits.length, 2);
    assert.equal(JSON.stringify(before).includes('内部原文不可公开'), false);
    assert.equal('rawStory' in (before.exhibits[0] ?? {}), false);
    const newImage = await asset(db, actor, museum.id);
    const changed = await updateExhibit(actor, museum.id, first.id, { ...editInput(first), photoAssetId: newImage, caption: '新的展签仍待确认。' }, db);
    assert.equal(changed.version, first.version + 1);
    assert.equal(changed.confirmedVersion, null);
    assert.equal(changed.confirmationNote, null);
    assert.deepEqual(await readShare(token, db), before);
    assert.equal((await getShareAsset(token, oldImage, db)).asset.id, oldImage);
    assert.equal((await getShareAsset(token, oldAudio, db)).asset.id, oldAudio);
    await rejected(getShareAsset(token, newImage, db), 'SHARE_NOT_FOUND');
    await rejected(publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db), 'NOT_CONFIRMED');
    await removeExhibit(actor, museum.id, second.id, second.version, db);
    assert.deepEqual(await readShare(token, db), before);
    await confirmExhibit(actor, museum.id, changed.id, { expectedVersion: changed.version, confirmationNote: '再次确认变更后的内容。' }, db);
    const again = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal(again.token, null);
    const after = await readShare(token, db);
    assert.equal(after.exhibits.length, 1);
    assert.equal(after.exhibits[0]?.photoAssetId, newImage);
    await rejected(getShareAsset(token, oldImage, db), 'SHARE_NOT_FOUND');
    assert.equal((await getPrivateAsset(actor, museum.id, oldImage, db)).asset.id, oldImage);
    const repeated = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal(repeated.snapshotId, again.snapshotId);
  });
});

test('旧版本写入不覆盖；跨馆或错误类型素材被拒绝且不改变馆版本', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '并发馆', description: '' }, db);
    const exhibit = await createExhibit(actor, museum.id, exhibitInput(museum.version), db);
    const updated = await updateExhibit(actor, museum.id, exhibit.id, { ...editInput(exhibit), name: '已更新的名称' }, db);
    await rejected(updateExhibit(actor, museum.id, exhibit.id, { ...editInput(exhibit), name: '过期覆盖' }, db), 'VERSION_CONFLICT');
    assert.equal((await getMuseum(actor, museum.id, db)).exhibits[0]?.name, updated.name);
    await rejected(updateMuseum(actor, museum.id, { title: '过期馆名', description: '', expectedVersion: museum.version }, db), 'VERSION_CONFLICT');
    await rejected(publishMuseum(actor, museum.id, museum.version, db), 'VERSION_CONFLICT');
    const another = await createMuseum(actor, { title: '另一馆', description: '' }, db);
    const foreignImage = await asset(db, actor, another.id);
    const wrongKind = await asset(db, actor, museum.id, 'audio');
    const version = await currentVersion(db, actor, museum.id);
    await rejected(updateExhibit(actor, museum.id, updated.id, { ...editInput(updated), photoAssetId: foreignImage }, db), 'NOT_FOUND');
    await rejected(updateExhibit(actor, museum.id, updated.id, { ...editInput(updated), photoAssetId: wrongKind }, db), 'NOT_FOUND');
    assert.equal(await currentVersion(db, actor, museum.id), version);
    await rejected(getPrivateAsset(actor, museum.id, foreignImage, db), 'NOT_FOUND');
    await rejected(getMuseum(randomUUID(), museum.id, db), 'UNAUTHORIZED');
  });
});

test('停止分享和换链立即撤销旧数据与素材入口，所有不可见分享使用同一错误', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '分享撤销', description: '' }, db);
    const image = await asset(db, actor, museum.id);
    const exhibit = await createExhibit(actor, museum.id, { ...exhibitInput(museum.version), photoAssetId: image }, db);
    await confirmExhibit(actor, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '自动化测试确认' }, db);
    const published = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.ok(published.token);
    const token = published.token;
    const rotated = await rotateShareToken(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.notEqual(rotated.token, token);
    await rejected(readShare(token, db), 'SHARE_NOT_FOUND');
    await rejected(getShareAsset(token, image, db), 'SHARE_NOT_FOUND');
    assert.equal((await readShare(rotated.token, db)).id, museum.id);
    assert.equal((await getShareAsset(rotated.token, image, db)).asset.id, image);
    await stopSharing(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    await rejected(readShare(rotated.token, db), 'SHARE_NOT_FOUND');
    await rejected(getShareAsset(rotated.token, image, db), 'SHARE_NOT_FOUND');
    await rejected(getShareAsset('invalid', randomUUID(), db), 'SHARE_NOT_FOUND');
    const row = await db.query<{ share_token_hash: string | null }>('SELECT share_token_hash FROM museums WHERE id=$1', [museum.id]);
    assert.equal(row.rows[0]?.share_token_hash, null);
  });
});
