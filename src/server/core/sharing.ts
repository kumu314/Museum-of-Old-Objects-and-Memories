import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { displayPhotoRequiredMessage, idSchema, missingDisplayPhoto, publicMuseumSchema, publishResultSchema, shareNotFoundMessage, shareTokenSchema, toPublicExhibit } from '../../contracts';
import { HttpError } from '../http';
import { inTransaction, museumDraft } from './museums';
import { assertVersion, assetRecord, exhibitRecords, invalid, museumRecord, requireActor, validateAssets } from './records';

function shareNotFound(): never {
  throw new HttpError({ code: 'SHARE_NOT_FOUND', message: shareNotFoundMessage });
}
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function newToken(): string { return randomBytes(32).toString('base64url'); }

export function publishMuseum(actorId: string, museumId: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const museum = await museumRecord(db, museumId, actorId, true);
    assertVersion(museum.version, expectedVersion);
    const exhibits = await exhibitRecords(db, museumId);
    if (exhibits.length === 0) invalid('请先添加至少一件展品。');
    const missingPhoto = exhibits.find(missingDisplayPhoto);
    if (missingPhoto) invalid(`第 ${missingPhoto.slotIndex + 1} 格「${missingPhoto.name}」：${displayPhotoRequiredMessage}`);
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
      await db.query('INSERT INTO published_snapshots(id,museum_id,museum_version,public_data,published_by,published_at) VALUES($1,$2,$3,$4,$5,$6)',
        [snapshotId, museumId, museum.version, JSON.stringify(data), actorId, data.publishedAt]);
      const assetIds = new Set(exhibits.flatMap((item) => [item.photoAssetId, item.audioAssetId]).filter((id): id is string => id !== null));
      for (const assetId of assetIds) {
        await db.query('INSERT INTO snapshot_assets(snapshot_id,museum_id,asset_id) VALUES($1,$2,$3)', [snapshotId, museumId, assetId]);
      }
      await db.query('UPDATE published_snapshots SET sealed=true WHERE id=$1', [snapshotId]);
    }
    const token = museum.shareEnabled ? null : newToken();
    await db.query(`UPDATE museums SET current_snapshot_id=$1,share_enabled=true,
      share_token_hash=COALESCE($2,share_token_hash),updated_at=now() WHERE id=$3`, [snapshotId, token ? tokenHash(token) : null, museumId]);
    return publishResultSchema.parse({ museumId, snapshotId, version: museum.version, token });
  }, client);
}

export function stopSharing(actorId: string, museumId: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const museum = await museumRecord(db, museumId, actorId, true);
    assertVersion(museum.version, expectedVersion);
    if (museum.shareEnabled) {
      await db.query('UPDATE museums SET share_enabled=false,share_token_hash=NULL,version=version+1,updated_at=now() WHERE id=$1', [museumId]);
    }
    return museumDraft(db, museumId, actorId);
  }, client);
}
export function rotateShareToken(actorId: string, museumId: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const museum = await museumRecord(db, museumId, actorId, true);
    assertVersion(museum.version, expectedVersion);
    if (museum.publishedVersion === null) invalid('请先发布展馆，再生成参观链接。');
    const token = newToken();
    await db.query('UPDATE museums SET share_enabled=true,share_token_hash=$1,version=version+1,updated_at=now() WHERE id=$2', [tokenHash(token), museumId]);
    return { token: shareTokenSchema.parse(token) };
  }, client);
}

const shareRecordSchema = z.object({ id: idSchema, snapshotId: idSchema, data: publicMuseumSchema });
async function shareRecord(db: PoolClient, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) shareNotFound();
  const result = await db.query<Record<string, unknown>>(`SELECT m.id,p.id AS "snapshotId",p.public_data AS data
    FROM museums m JOIN published_snapshots p ON p.id=m.current_snapshot_id AND p.museum_id=m.id AND p.sealed
    WHERE m.share_token_hash=$1 AND m.share_enabled AND m.deleted_at IS NULL`, [tokenHash(token)]);
  if (!result.rows[0]) shareNotFound();
  return shareRecordSchema.parse(result.rows[0]);
}
export function readShare(token: string, client?: PoolClient) {
  return inTransaction(async (db) => (await shareRecord(db, token)).data, client);
}
export function getShareAsset(token: string, assetId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    if (!idSchema.safeParse(assetId).success) shareNotFound();
    const share = await shareRecord(db, token);
    const member = await db.query('SELECT asset_id FROM snapshot_assets WHERE snapshot_id=$1 AND museum_id=$2 AND asset_id=$3', [share.snapshotId, share.id, assetId]);
    if (member.rowCount !== 1) shareNotFound();
    return assetRecord(db, share.id, assetId);
  }, client);
}
