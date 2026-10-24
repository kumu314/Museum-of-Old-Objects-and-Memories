import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { CreateExhibitInput, ExhibitDraft, UpdateExhibitInput } from '../../src/contracts';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';
import { createMuseum, getMuseum, getOwnMuseum, listMuseums, removeMuseum, updateMuseum, createExhibit, updateExhibit, removeExhibit, confirmExhibit,
  publishMuseum, readShare, getShareAsset, stopSharing, rotateShareToken, getPrivateAsset } from '../../src/server/core';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

async function fixture(work: (db: PoolClient, actorId: string) => Promise<void>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const actorId = randomUUID();
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [actorId, `core-test-${actorId}`, 'test-only']);
    await work(db, actorId);
  } finally { await db.query('ROLLBACK'); db.release(); }
}
test('用户间隔离：非创建者读取、修改和列举他人展馆均不可见', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '私人展馆', description: '' }, db);
    await createExhibit(actor, museum.id, exhibitInput(museum.version), db);
    const outsider = randomUUID();
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [outsider, `outsider-${outsider}`, 'test-only']);
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
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '候选演示模型', sourceNotice: '仅作流程测试',
    rawStory: '内部原文不可公开', transcript: null, sourceSegments: [{ id: 'raw-1', text: '内部原文不可公开', source: 'rawStory' }], expectedMuseumVersion };
}
function editInput(exhibit: ExhibitDraft): UpdateExhibitInput {
  return { name: exhibit.name, era: exhibit.era, slotIndex: exhibit.slotIndex, modelKey: exhibit.modelKey,
    caption: exhibit.caption, photoAssetId: exhibit.photoAssetId, audioAssetId: exhibit.audioAssetId,
    approximation: exhibit.approximation, sourceNotice: exhibit.sourceNotice, rawStory: exhibit.rawStory,
    transcript: exhibit.transcript, sourceSegments: exhibit.sourceSegments, modelInput: exhibit.modelInput, expectedVersion: exhibit.version };
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

test('每个账号只保留一座有效展馆；重复创建不覆盖资料，删除后可重新开始', async () => {
  await fixture(async (db, actor) => {
    assert.equal(await getOwnMuseum(actor, db), null);
    const museum = await createMuseum(actor, { title: '唯一展馆', description: '整座展馆的概括' }, db);
    assert.equal((await getOwnMuseum(actor, db))?.exhibits.length, 0);
    await rejected(createMuseum(actor, { title: '重复创建', description: '' }, db), 'MUSEUM_EXISTS');
    assert.equal((await getOwnMuseum(actor, db))?.title, museum.title);
    await removeMuseum(actor, museum.id, museum.version, db);
    assert.equal(await getOwnMuseum(actor, db), null);
    assert.notEqual((await createMuseum(actor, { title: '重新开始', description: '' }, db)).id, museum.id);
  });
});

test('跨页收录与发布包含全部展品，未确认清单超过六项，简介更新不改变旧快照', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '多页展馆', description: '旧的全馆简介' }, db);
    for (let slot = 0; slot < 8; slot++) await createExhibit(actor, museum.id, { ...exhibitInput(await currentVersion(db, actor, museum.id), slot), name: `旧物 ${slot + 1}`, rawStory: `这只属于旧物 ${slot + 1}` }, db);
    const draft = await getOwnMuseum(actor, db);
    assert.equal(draft?.exhibits.length, 8);
    assert.equal(draft?.exhibits[6]?.rawStory, '这只属于旧物 7');
    assert.ok(draft);
    await assert.rejects(publishMuseum(actor, museum.id, draft.version, db), (error: unknown) => {
      assert.ok(error instanceof HttpError && error.failure.code === 'NOT_CONFIRMED');
      assert.equal(error.failure.details.unconfirmedExhibitIds.length, 8);
      return true;
    });
    for (const exhibit of draft.exhibits) await confirmExhibit(actor, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '核对本件展品。' }, db);
    const published = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal(published.token, null);
    const { token } = await rotateShareToken(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    const before = await readShare(actor, token, db);
    assert.equal(before.exhibits.length, 8);
    assert.equal(before.exhibits[7]?.slotIndex, 7);
    const updated = await updateMuseum(actor, museum.id, { title: museum.title, description: '新的全馆简介', expectedVersion: await currentVersion(db, actor, museum.id) }, db);
    assert.equal(updated.description, '新的全馆简介');
    assert.deepEqual(await readShare(actor, token, db), before);
    await publishMuseum(actor, museum.id, updated.version, db);
    assert.equal((await readShare(actor, token, db)).description, '新的全馆简介');
    assert.equal((await readShare(actor, token, db)).exhibits[0]?.caption, exhibitInput(1).caption);
  });
});

test('建模照片准备持久保存并校验归属和类型，分享不泄露未选为展示图的建模输入', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '建模准备', description: '' }, db);
    const views = { front: await asset(db, actor, museum.id), back: await asset(db, actor, museum.id), left: await asset(db, actor, museum.id), right: await asset(db, actor, museum.id) };
    const input = { ...exhibitInput(museum.version), modelInput: { mode: 'multiview' as const, views } };
    const exhibit = await createExhibit(actor, museum.id, input, db);
    assert.deepEqual((await getMuseum(actor, museum.id, db)).exhibits[0]?.modelInput, input.modelInput);
    const wrongKind = await asset(db, actor, museum.id, 'audio');
    await rejected(updateExhibit(actor, museum.id, exhibit.id, { ...editInput(exhibit), modelInput: { mode: 'single', imageAssetId: wrongKind } }, db), 'NOT_FOUND');
    await rejected(updateExhibit(actor, museum.id, exhibit.id, { ...editInput(exhibit), modelInput: { mode: 'single', imageAssetId: randomUUID() } }, db), 'NOT_FOUND');
    await confirmExhibit(actor, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '确认演示展示。' }, db);
    const published = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal(published.token, null);
    const { token } = await rotateShareToken(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal('modelInput' in ((await readShare(actor, token, db)).exhibits[0] ?? {}), false);
    for (const id of Object.values(views)) await rejected(getShareAsset(actor, token, id, db), 'SHARE_NOT_FOUND');
    assert.equal((await getPrivateAsset(actor, museum.id, views.front, db)).asset.id, views.front);
  });
});

test('缺图照片平面可保存草稿，确认和发布明确拒绝；补图后仍须重新确认', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '缺图回归馆', description: '' }, db);
    const exhibit = await createExhibit(actor, museum.id, { ...exhibitInput(museum.version), modelKey: 'photo-plane' }, db);
    const version = await currentVersion(db, actor, museum.id);
    const missingPhoto = (error: unknown) => error instanceof HttpError
      && error.failure.code === 'VALIDATION_ERROR' && /上传.*保存.*实拍照片/.test(error.message);
    await assert.rejects(confirmExhibit(actor, museum.id, exhibit.id, {
      expectedVersion: exhibit.version, confirmationNote: '不能确认没有展示图片的照片平面。',
    }, db), missingPhoto);
    assert.equal((await getMuseum(actor, museum.id, db)).exhibits[0]?.confirmedVersion, null);
    assert.equal(await currentVersion(db, actor, museum.id), version);

    // A record confirmed before this fix must also produce a useful publication error.
    await db.query('UPDATE exhibits SET confirmed_version=version,confirmed_by=$1,confirmed_at=now(),confirmation_note=$2 WHERE id=$3',
      [actor, '旧版本遗留确认记录，仅用于回归测试。', exhibit.id]);
    await assert.rejects(confirmExhibit(actor, museum.id, exhibit.id, {
      expectedVersion: exhibit.version, confirmationNote: '重复确认仍不能绕过补图。',
    }, db), missingPhoto);
    await assert.rejects(publishMuseum(actor, museum.id, version, db), (error: unknown) => {
      assert.ok(missingPhoto(error));
      assert.ok(error instanceof Error);
      assert.match(error.message, /第 1 格「复古相机」/);
      return true;
    });
    assert.equal((await getMuseum(actor, museum.id, db)).publishedVersion, null);

    const image = await asset(db, actor, museum.id);
    const updated = await updateExhibit(actor, museum.id, exhibit.id, { ...editInput(exhibit), photoAssetId: image }, db);
    assert.equal(updated.confirmedVersion, null);
    await rejected(publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db), 'NOT_CONFIRMED');
    await confirmExhibit(actor, museum.id, updated.id, { expectedVersion: updated.version, confirmationNote: '补图并核对当前版本。' }, db);
    const published = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal(published.token, null);
    const { token } = await rotateShareToken(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal((await readShare(actor, token, db)).exhibits[0]?.photoAssetId, image);
  });
});

test('第二页缺图时明确指出页号和格位，不提示不存在的第七格', async () => {
  await fixture(async (db, actor) => {
    const museum = await createMuseum(actor, { title: '第二页缺图', description: '' }, db);
    await createExhibit(actor, museum.id, { ...exhibitInput(museum.version, 6), modelKey: 'photo-plane' }, db);
    await assert.rejects(publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db), (error: unknown) => {
      assert.ok(error instanceof HttpError && error.failure.code === 'VALIDATION_ERROR');
      assert.match(error.message, /第 2 页 · 第 1 格「复古相机」.*上传.*保存.*实拍照片/);
      return true;
    });
  });
});

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
    assert.equal(published.token, null);
    const { token } = await rotateShareToken(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    const before = await readShare(actor, token, db);
    assert.equal(before.exhibits.length, 2);
    assert.equal(JSON.stringify(before).includes('内部原文不可公开'), false);
    assert.equal('rawStory' in (before.exhibits[0] ?? {}), false);
    const newImage = await asset(db, actor, museum.id);
    const changed = await updateExhibit(actor, museum.id, first.id, { ...editInput(first), photoAssetId: newImage, caption: '新的展签仍待确认。' }, db);
    assert.equal(changed.version, first.version + 1);
    assert.equal(changed.confirmedVersion, null);
    assert.equal(changed.confirmationNote, null);
    assert.deepEqual(await readShare(actor, token, db), before);
    assert.equal((await getShareAsset(actor, token, oldImage, db)).asset.id, oldImage);
    assert.equal((await getShareAsset(actor, token, oldAudio, db)).asset.id, oldAudio);
    await rejected(getShareAsset(actor, token, newImage, db), 'SHARE_NOT_FOUND');
    await rejected(publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db), 'NOT_CONFIRMED');
    await removeExhibit(actor, museum.id, second.id, second.version, db);
    assert.deepEqual(await readShare(actor, token, db), before);
    await confirmExhibit(actor, museum.id, changed.id, { expectedVersion: changed.version, confirmationNote: '再次确认变更后的内容。' }, db);
    const again = await publishMuseum(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.equal(again.token, null);
    const after = await readShare(actor, token, db);
    assert.equal(after.exhibits.length, 1);
    assert.equal(after.exhibits[0]?.photoAssetId, newImage);
    await rejected(getShareAsset(actor, token, oldImage, db), 'SHARE_NOT_FOUND');
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
    const outsider = randomUUID();
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [outsider, `asset-owner-${outsider}`, 'test-only']);
    const another = await createMuseum(outsider, { title: '另一馆', description: '' }, db);
    const foreignImage = await asset(db, outsider, another.id);
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
    assert.equal(published.token, null);
    const { token } = await rotateShareToken(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    const rotated = await rotateShareToken(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    assert.notEqual(rotated.token, token);
    await rejected(readShare(actor, token, db), 'SHARE_NOT_FOUND');
    await rejected(getShareAsset(actor, token, image, db), 'SHARE_NOT_FOUND');
    assert.equal((await readShare(actor, rotated.token, db)).id, museum.id);
    assert.equal((await getShareAsset(actor, rotated.token, image, db)).asset.id, image);
    await stopSharing(actor, museum.id, await currentVersion(db, actor, museum.id), db);
    await rejected(readShare(actor, rotated.token, db), 'SHARE_NOT_FOUND');
    await rejected(getShareAsset(actor, rotated.token, image, db), 'SHARE_NOT_FOUND');
    await rejected(getShareAsset(actor, 'invalid', randomUUID(), db), 'SHARE_NOT_FOUND');
    const row = await db.query<{ share_token_hash: string | null }>('SELECT share_token_hash FROM museums WHERE id=$1', [museum.id]);
    assert.equal(row.rows[0]?.share_token_hash, null);
  });
});
