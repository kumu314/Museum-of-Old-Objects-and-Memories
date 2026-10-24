import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { cabinetPosition, displayPhotoRequiredMessage, idSchema, missingDisplayPhoto, museumTagsSchema, publicMuseumSchema, publishResultSchema, shareNotFoundMessage, shareTokenSchema, toPublicExhibit } from '../../contracts';
import { HttpError } from '../http';
import { inTransaction, museumDraft } from './museums';
import { assertVersion, assetRecord, exhibitRecords, invalid, museumRecord, requireActor, validateAssets } from './records';
import { newShareToken, shareTokenHash } from './share-tokens';

function shareNotFound(): never {
  throw new HttpError({ code: 'SHARE_NOT_FOUND', message: shareNotFoundMessage });
}

export function publishMuseum(actorId: string, museumId: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const museum = await museumRecord(db, actorId, museumId, true);
    assertVersion(museum.version, expectedVersion);
    const exhibits = await exhibitRecords(db, museumId);
    if (exhibits.length === 0) invalid('请先添加至少一件展品。');
    const missingPhoto = exhibits.find(missingDisplayPhoto);
    if (missingPhoto) invalid(`${cabinetPosition(missingPhoto.slotIndex)}「${missingPhoto.name}」：${displayPhotoRequiredMessage}`);
    const unconfirmedExhibitIds = exhibits.filter((item) => item.confirmedVersion !== item.version).map(({ id }) => id);
    if (unconfirmedExhibitIds.length) {
      throw new HttpError({ code: 'NOT_CONFIRMED', message: '请先确认列出的展品后再发布。', details: { unconfirmedExhibitIds } });
    }
    for (const exhibit of exhibits) await validateAssets(db, museumId, exhibit.photoAssetId, exhibit.audioAssetId);
    const data = publicMuseumSchema.parse({ id: museumId, title: museum.title, description: museum.description,
      version: museum.version, publishedAt: new Date().toISOString(), exhibits: exhibits.map(toPublicExhibit) });
    const existing = await db.query<{ id: string }>('SELECT id FROM published_snapshots WHERE museum_id=$1 AND museum_version=$2 AND sealed', [museumId, museum.version]);
    let snapshotId = existing.rows[0]?.id;
    if (!snapshotId) {
      snapshotId = randomUUID();
      const draft = await db.query<{ tags: unknown }>('SELECT tags FROM museums WHERE id=$1', [museumId]);
      const tags = museumTagsSchema.parse(draft.rows[0]?.tags);
      await db.query('INSERT INTO published_snapshots(id,museum_id,museum_version,public_data,published_by,published_at,tags) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [snapshotId, museumId, museum.version, JSON.stringify(data), actorId, data.publishedAt, JSON.stringify(tags)]);
      const assetIds = new Set(exhibits.flatMap((item) => [item.photoAssetId, item.audioAssetId]).filter((id): id is string => id !== null));
      for (const assetId of assetIds) {
        await db.query('INSERT INTO snapshot_assets(snapshot_id,museum_id,asset_id) VALUES($1,$2,$3)', [snapshotId, museumId, assetId]);
      }
      await db.query('UPDATE published_snapshots SET sealed=true WHERE id=$1', [snapshotId]);
    }
    await db.query(`UPDATE museums SET
      access_epoch=CASE WHEN access_mode='private' THEN NULL
        WHEN current_snapshot_id IS DISTINCT FROM $1::uuid THEN $2::uuid ELSE access_epoch END,
      current_snapshot_id=$1,updated_at=now() WHERE id=$3`, [snapshotId, randomUUID(), museumId]);
    return publishResultSchema.parse({ museumId, snapshotId, version: museum.version, token: null });
  }, client);
}

export function stopSharing(actorId: string, museumId: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const museum = await museumRecord(db, actorId, museumId, true);
    assertVersion(museum.version, expectedVersion);
    if (museum.shareEnabled) {
      await db.query("UPDATE museums SET access_mode='private',access_epoch=NULL,share_token_hash=NULL,version=version+1,updated_at=now() WHERE id=$1", [museumId]);
    }
    return museumDraft(db, actorId, museumId);
  }, client);
}
export function rotateShareToken(actorId: string, museumId: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const museum = await museumRecord(db, actorId, museumId, true);
    assertVersion(museum.version, expectedVersion);
    if (museum.publishedVersion === null) invalid('请先发布展馆，再生成参观链接。');
    const { token, hash } = newShareToken();
    await db.query(`UPDATE museums SET access_mode=CASE WHEN access_mode='private' THEN 'link_only' ELSE access_mode END,
      access_epoch=$1,share_token_hash=$2,version=version+1,updated_at=now() WHERE id=$3`, [randomUUID(), hash, museumId]);
    return { token: shareTokenSchema.parse(token) };
  }, client);
}

const shareRecordSchema = z.object({ id: idSchema, snapshotId: idSchema, data: publicMuseumSchema });
async function shareRecord(db: PoolClient, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) shareNotFound();
  const result = await db.query<Record<string, unknown>>(`SELECT m.id,p.id AS "snapshotId",p.public_data AS data
    FROM museums m JOIN published_snapshots p ON p.id=m.current_snapshot_id AND p.museum_id=m.id AND p.sealed
    JOIN team_members owner ON owner.id=m.created_by AND owner.active
    WHERE m.share_token_hash=$1 AND m.access_mode<>'private' AND m.deleted_at IS NULL`, [shareTokenHash(token)]);
  if (!result.rows[0]) shareNotFound();
  return shareRecordSchema.parse(result.rows[0]);
}
export function readShare(actorId: string, token: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    return (await shareRecord(db, token)).data;
  }, client);
}
/**
 * 记一次浏览。
 *
 * - 只有真能读到内容（token 有效、分享仍开着、快照已封存）才记；读不到就按 404 处理，不记。
 * - 馆主自己的访问**照实记下**，排除发生在聚合侧（见 `readLeaderboard`）。事件表记的是
 *   "发生过什么"的事实，聚合算的是"对外怎么算"的口径；把两者混在一处，将来改口径
 *   就得回头改历史数据。
 * - 不做去重：刷新、预加载与自动化流量的处理方式仍属未决，未决前如实记录每一次成功读取，
 *   也不在任何地方声称已经防刷或统计独立访客。
 */
export function recordMuseumView(actorId: string, token: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const share = await shareRecord(db, token);
    await db.query('INSERT INTO museum_view_events(museum_id,viewer_id) VALUES($1,$2)', [share.id, actorId]);
    return { ok: true as const };
  }, client);
}
export function getShareAsset(actorId: string, token: string, assetId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    if (!idSchema.safeParse(assetId).success) shareNotFound();
    const share = await shareRecord(db, token);
    const member = await db.query('SELECT asset_id FROM snapshot_assets WHERE snapshot_id=$1 AND museum_id=$2 AND asset_id=$3', [share.snapshotId, share.id, assetId]);
    if (member.rowCount !== 1) shareNotFound();
    return assetRecord(db, share.id, assetId);
  }, client);
}
