import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { cabinetPosition, displayPhotoRequiredMessage, idSchema, missingDisplayPhoto, publicMuseumSchema, publishResultSchema, shareNotFoundMessage, shareTokenSchema, toPublicExhibit } from '../../contracts';
import { sharedContributionsSchema } from '../../contracts/contributors';
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
    const museum = await museumRecord(db, actorId, museumId, true);
    assertVersion(museum.version, expectedVersion);
    if (museum.shareEnabled) {
      await db.query('UPDATE museums SET share_enabled=false,share_token_hash=NULL,version=version+1,updated_at=now() WHERE id=$1', [museumId]);
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
/**
 * 参观页读取多人讲述（方向二 · 第五块）。
 *
 * **讲述不进 `published_snapshots`，这是刻意的。** 三条理由，按重要性排：
 *
 * 1. **撤回必须立即生效。** 封存的快照有 `guard_snapshot_mutation` 触发器，改不了；
 *    要把一条讲述从快照里拿掉，只能新建快照 → 整馆 version+1、所有展品重新封存。
 *    一个人撤回自己那一段，引发整馆重发，代价和权限都不对。
 * 2. **讲述的作者不是馆主。** 快照的语义是"馆主发布那一刻的定稿"。把别人的内容封进
 *    馆主的快照，等于馆主发布时替所有共同作者做了一次不可撤销的定稿，之后作者改不了。
 * 3. **两套生命周期本来就不同。** 快照管展品结构（馆主的），讲述管"谁讲过什么"（作者的）。
 *
 * 所以这里的分工是：快照给"有哪些展品"，活表给"谁在上面讲过话"。
 * 安全边界仍然只有一道，且是同一道：先过 `shareRecord`（token 有效 + 分享开着 +
 * 未删除 + 快照已封存）。读不到快照就 404，讲述一个字都不会返回。
 *
 * 可见条件只有两条：作者本人同意公开、且没有撤回。**与邀请状态无关**——
 * 已经写下的讲述不因馆主事后收回邀请而消失，那是作者的内容；收回邀请只是不能再新增。
 * 展品范围严格取快照里的展品 id：发布后被软删的展品，其讲述只跟着快照一起出现或消失，
 * 不会因为活表里还留着行就漏到别的展品上。
 */
export function readShareContributions(actorId: string, token: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const share = await shareRecord(db, token);
    const exhibitIds = share.data.exhibits.map((exhibit) => exhibit.id);
    if (exhibitIds.length === 0) return sharedContributionsSchema.parse({ museumId: share.id, contributions: [] });
    const result = await db.query<Record<string, unknown>>(`SELECT c.id,c.exhibit_id AS "exhibitId",
      c.author_name AS "authorName",c.author_role AS "authorRole",c.story,c.source_note AS "sourceNote"
      FROM contributions c
      WHERE c.museum_id=$1 AND c.exhibit_id=ANY($2::uuid[]) AND c.publish_consent AND c.withdrawn_at IS NULL
      ORDER BY c.created_at,c.id`, [share.id, exhibitIds]);
    return sharedContributionsSchema.parse({ museumId: share.id, contributions: result.rows });
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
