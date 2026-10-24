import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { updateExhibitInputSchema, type ExhibitDraft, type UpdateExhibitInput } from '../../src/contracts/museum';
import { cabinetItems } from '../../src/features/studio/cabinet-items';
import { createMuseum, createExhibit, getMuseum, updateExhibit, confirmExhibit, publishMuseum, rotateShareToken, readShare } from '../../src/server/core';
import { getShareModelAsset } from '../../src/server/core/sharing';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

function editInput(exhibit: ExhibitDraft): UpdateExhibitInput {
  return {
    name: exhibit.name, era: exhibit.era, slotIndex: exhibit.slotIndex, modelKey: exhibit.modelKey,
    caption: exhibit.caption, photoAssetId: exhibit.photoAssetId, audioAssetId: exhibit.audioAssetId,
    approximation: exhibit.approximation, sourceNotice: exhibit.sourceNotice, rawStory: exhibit.rawStory,
    transcript: exhibit.transcript, sourceSegments: exhibit.sourceSegments, modelInput: exhibit.modelInput,
    expectedVersion: exhibit.version,
  };
}

async function fixture(work: (db: PoolClient, actor: string, exhibit: ExhibitDraft, model: string) => Promise<void>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const actor = randomUUID();
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [actor, `display-${actor}`, 'test-only']);
    const museum = await createMuseum(actor, { title: '展示选择回归', description: '' }, db);
    const photo = randomUUID();
    await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
      VALUES($1,$2,'fixture.webp','image','image/webp',100,$3,10,10,$4,$5)`, [photo, museum.id, `${photo}.processed`, '0'.repeat(64), actor]);
    const exhibit = await createExhibit(actor, museum.id, {
      name: '测试旧物', era: '年代待考', slotIndex: 0, modelKey: 'photo-plane', caption: '合成回归样例',
      photoAssetId: photo, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: photo },
      approximation: '仅作流程测试', sourceNotice: '合成测试素材', rawStory: '', transcript: null,
      sourceSegments: [], expectedMuseumVersion: museum.version,
    }, db);
    const job = randomUUID(); const model = randomUUID();
    await db.query(`INSERT INTO model_generation_jobs(id,museum_id,exhibit_id,source_version,mode,input_asset_id,provider,status,created_by)
      VALUES($1,$2,$3,$4,'single',$5,'synthetic-test','RUN',$6)`, [job, museum.id, exhibit.id, exhibit.version, photo, actor]);
    await db.query(`INSERT INTO model_assets(id,museum_id,job_id,byte_size,storage_key,sha256,stats)
      VALUES($1,$2,$3,100,$4,$5,'{}')`, [model, museum.id, job, `${model}/model.glb`, '0'.repeat(64)]);
    await db.query('UPDATE exhibits SET generated_model_asset_id=$1 WHERE id=$2', [model, exhibit.id]);
    await work(db, actor, { ...exhibit, generatedModelAssetId: model }, model);
  } finally { await db.query('ROLLBACK'); db.release(); }
}

test('普通编辑省略清除标记时保留已采纳模型，并拒绝伪造模型引用或 false 标记', async () => {
  await fixture(async (db, actor, exhibit, model) => {
    const input = editInput(exhibit);
    assert.equal(updateExhibitInputSchema.safeParse({ ...input, clearGeneratedModel: true }).success, true);
    assert.equal(updateExhibitInputSchema.safeParse({ ...input, clearGeneratedModel: false }).success, false);
    assert.equal(updateExhibitInputSchema.safeParse({ ...input, generatedModelAssetId: randomUUID() }).success, false);
    const updated = await updateExhibit(actor, exhibit.museumId, exhibit.id, { ...input, caption: '只修改展签' }, db);
    assert.equal(updated.generatedModelAssetId, model);
    assert.equal(cabinetItems([updated], '/assets', '/models')[0]?.modelKey, 'glb');
  });
});

for (const modelKey of ['photo-plane', 'camera-01'] as const) {
  test(`显式切回 ${modelKey} 清除生成引用、使确认失效，旧快照仍保留模型`, async () => {
    await fixture(async (db, actor, exhibit, model) => {
      const museumId = exhibit.museumId;
      await confirmExhibit(actor, museumId, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '合成测试确认' }, db);
      await publishMuseum(actor, museumId, (await getMuseum(actor, museumId, db)).version, db);
      const { token } = await rotateShareToken(actor, museumId, (await getMuseum(actor, museumId, db)).version, db);
      const before = await readShare(actor, token, db);
      const museumVersion = (await getMuseum(actor, museumId, db)).version;
      const changed = await updateExhibit(actor, museumId, exhibit.id, { ...editInput(exhibit), modelKey, clearGeneratedModel: true }, db);
      assert.equal(changed.generatedModelAssetId, null);
      assert.equal(changed.modelKey, modelKey);
      assert.equal(changed.version, exhibit.version + 1);
      assert.equal(changed.confirmedVersion, null);
      assert.equal(changed.confirmationNote, null);
      assert.equal((await getMuseum(actor, museumId, db)).version, museumVersion + 1);
      assert.equal(cabinetItems([changed], '/assets', '/models')[0]?.modelKey, modelKey);
      assert.deepEqual(await readShare(actor, token, db), before);
      assert.equal(before.exhibits[0]?.generatedModelAssetId, model);
      assert.equal((await getShareModelAsset(actor, token, model, db)).storage_key, `${model}/model.glb`);
    });
  });
}
