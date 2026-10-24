import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { discoveryMuseumSchema, discoveryPageSchema, discoverySearchInputSchema, followingListSchema, idSchema, museumAccessSchema, museumTagsSchema,
  museumTagsStateSchema, publicMuseumSchema, publicProfileSchema, timestampSchema,
  type DiscoverySearchInput, type UpdateMuseumAccessInput, type UpdateMuseumTagsInput, type UpdatePublicProfileInput } from '../../contracts';
import { lockDirection1Actor, prepareDirection1Write, requireDemoAccount } from './direction1';
import { inTransaction } from './museums';
import { assertVersion, assetRecord, invalid, museumRecord, notFound, requireActor } from './records';
import { newShareToken } from './share-tokens';

async function profileRecord(db: PoolClient, actorId: string) {
  const result = await db.query<Record<string, unknown>>('SELECT user_id AS "userId",nickname,version,updated_at AS "updatedAt" FROM public_profiles WHERE user_id=$1', [actorId]);
  const row = result.rows[0];
  return row ? publicProfileSchema.parse({ ...row, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt }) : null;
}
export function getPublicProfile(actorId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireDemoAccount(db, actorId); return profileRecord(db, actorId); }, client);
}
export function updatePublicProfile(actorId: string, input: UpdatePublicProfileInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'profile', actorId, [input.expectedVersion, input.nickname]);
    const current = await profileRecord(db, actorId);
    if (operation.replayed) return current;
    assertVersion(current?.version ?? 1, input.expectedVersion);
    if (current) await db.query('UPDATE public_profiles SET nickname=$1,version=version+1,updated_at=now() WHERE user_id=$2', [input.nickname, actorId]);
    else await db.query('INSERT INTO public_profiles(user_id,nickname) VALUES($1,$2)', [actorId, input.nickname]);
    await operation.finish();
    return profileRecord(db, actorId);
  }, client);
}
function accessProjection(museum: Awaited<ReturnType<typeof museumRecord>>) {
  return museumAccessSchema.parse({ museumId: museum.id, version: museum.version, accessMode: museum.accessMode, accessEpoch: museum.accessEpoch });
}
export function getMuseumAccess(actorId: string, museumId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireActor(db, actorId); return accessProjection(await museumRecord(db, actorId, museumId)); }, client);
}
export function updateMuseumAccess(actorId: string, museumId: string, input: UpdateMuseumAccessInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'access', museumId, [input.expectedVersion, input.accessMode]);
    const museum = await museumRecord(db, actorId, museumId, true);
    if (operation.replayed) return accessProjection(museum);
    assertVersion(museum.version, input.expectedVersion);
    if (input.accessMode === 'discoverable') {
      await requireDemoAccount(db, actorId);
      if (!await profileRecord(db, actorId)) invalid('请先明确填写公开昵称，再开启公开发现。');
    }
    if (input.accessMode !== 'private' && museum.publishedVersion === null) invalid('请先生成发布快照，再开放访问。');
    if (museum.accessMode !== input.accessMode) {
      // Enabling discovery does not need to reveal a bearer token. The existing
      // share endpoint explicitly issues/rotates a link when one is requested.
      const token = newShareToken();
      await db.query(`UPDATE museums SET access_mode=$1,access_epoch=$2,
        share_token_hash=CASE WHEN $1='private' THEN NULL ELSE COALESCE(share_token_hash,$3) END,
        version=version+1,updated_at=now() WHERE id=$4`, [input.accessMode,
        input.accessMode === 'private' ? null : randomUUID(), token.hash, museumId]);
    }
    await operation.finish();
    return accessProjection(await museumRecord(db, actorId, museumId));
  }, client);
}
async function tagsRecord(db: PoolClient, actorId: string, museumId: string) {
  await museumRecord(db, actorId, museumId);
  const row = await db.query<{ version: number; tags: unknown }>('SELECT version,tags FROM museums WHERE id=$1', [museumId]);
  return museumTagsStateSchema.parse({ museumId, version: row.rows[0]?.version, tags: row.rows[0]?.tags });
}
export function getMuseumTags(actorId: string, museumId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireActor(db, actorId); return tagsRecord(db, actorId, museumId); }, client);
}
export function updateMuseumTags(actorId: string, museumId: string, input: UpdateMuseumTagsInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'tags', museumId, [input.expectedVersion, input.tags]);
    const museum = await museumRecord(db, actorId, museumId, true);
    if (!operation.replayed) {
      assertVersion(museum.version, input.expectedVersion);
      await db.query('UPDATE museums SET tags=$1,version=version+1,updated_at=now() WHERE id=$2', [JSON.stringify(museumTagsSchema.parse(input.tags)), museumId]);
      await operation.finish();
    }
    return tagsRecord(db, actorId, museumId);
  }, client);
}

// One eligibility predicate is shared by directory, search, details, assets and
// social operations. These aliases are fixed SQL, never request fragments.
export const discoveryFromSql = `FROM museums m
  JOIN published_snapshots p ON p.id=m.current_snapshot_id AND p.museum_id=m.id AND p.sealed
  JOIN team_members owner ON owner.id=m.created_by AND owner.active
  JOIN direction1_demo_accounts demo ON demo.user_id=owner.id
  JOIN public_profiles profile ON profile.user_id=owner.id
  WHERE m.access_mode='discoverable' AND m.deleted_at IS NULL`;
const discoveryRecordSchema = z.strictObject({ museumId: idSchema, accessEpoch: idSchema, snapshotId: idSchema,
  ownerId: idSchema, nickname: publicProfileSchema.shape.nickname, data: publicMuseumSchema, tags: museumTagsSchema });
const discoveryColumns = `m.id AS "museumId",m.access_epoch AS "accessEpoch",p.id AS "snapshotId",
  owner.id AS "ownerId",profile.nickname,p.public_data AS data,p.tags`;
const directoryRecordSchema = discoveryRecordSchema.extend({ favoriteCount: discoveryMuseumSchema.shape.favoriteCount,
  isFollowing: z.boolean(), isFavorited: z.boolean(), cursorPublishedAt: timestampSchema });
export async function discoveryRecord(db: PoolClient, museumId: string, accessEpoch?: string, lock = false) {
  const rows = await db.query<Record<string, unknown>>(`SELECT ${discoveryColumns} ${discoveryFromSql}
    AND m.id=$1 AND ($2::uuid IS NULL OR m.access_epoch=$2) ${lock ? 'FOR UPDATE OF m' : ''}`, [museumId, accessEpoch ?? null]);
  const row = rows.rows[0]; if (!row) notFound();
  return discoveryRecordSchema.parse(row);
}
const cursorSchema = z.strictObject({ query: discoverySearchInputSchema.shape.query, followingOnly: z.boolean(), publishedAt: timestampSchema, museumId: idSchema });
export function listDiscovery(actorId: string, rawInput: DiscoverySearchInput, client?: PoolClient, followingOnly = false) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const input = discoverySearchInputSchema.parse(rawInput);
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (input.cursor !== null) {
      try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
      catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
        invalid('目录游标无效，请从第一页重新读取。');
      }
      if (cursor.query !== input.query || cursor.followingOnly !== followingOnly) invalid('列表或搜索条件已变化，请从第一页重新读取。');
    }
    const pattern = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`;
    const result = await db.query<Record<string, unknown>>(`SELECT ${discoveryColumns},
      to_char(p.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorPublishedAt",
      (SELECT count(*)::float8 FROM museum_favorites favorite WHERE favorite.museum_id=m.id) AS "favoriteCount",
      EXISTS(SELECT 1 FROM museum_favorites favorite WHERE favorite.museum_id=m.id AND favorite.user_id=$5) AS "isFavorited",
      EXISTS(SELECT 1 FROM account_follows follow WHERE follow.followed_user_id=owner.id AND follow.follower_id=$5) AS "isFollowing"
      ${discoveryFromSql}
      AND (NOT $6::boolean OR EXISTS(SELECT 1 FROM account_follows follow WHERE follow.followed_user_id=owner.id AND follow.follower_id=$5))
      AND (profile.nickname ILIKE $1 ESCAPE '\\' OR p.public_data->>'title' ILIKE $1 ESCAPE '\\'
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.public_data->'exhibits') exhibit WHERE exhibit->>'name' ILIKE $1 ESCAPE '\\')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.tags) tag WHERE tag ILIKE $1 ESCAPE '\\'))
      AND ($2::timestamptz IS NULL OR (p.published_at,m.id)<($2::timestamptz,$3::uuid))
      ORDER BY p.published_at DESC,m.id DESC LIMIT $4`, [pattern, cursor?.publishedAt ?? null, cursor?.museumId ?? null, input.limit + 1, actorId, followingOnly]);
    const records = result.rows.map((row) => directoryRecordSchema.parse(row));
    const page = records.slice(0, input.limit);
    const last = page.at(-1);
    return discoveryPageSchema.parse({ items: page.map((record) => ({ museumId: record.museumId, accessEpoch: record.accessEpoch,
      owner: { userId: record.ownerId, nickname: record.nickname }, title: record.data.title, description: record.data.description,
      tags: record.tags, exhibitNames: record.data.exhibits.map(({ name }) => name), publishedAt: record.data.publishedAt,
      favoriteCount: record.favoriteCount, isFollowing: record.isFollowing, isFavorited: record.isFavorited })),
      nextCursor: records.length > input.limit && last ? Buffer.from(JSON.stringify({ query: input.query, followingOnly,
        publishedAt: last.cursorPublishedAt, museumId: last.museumId })).toString('base64url') : null });
  }, client);
}
export function listFollowing(actorId: string, input: DiscoverySearchInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    // Keep the actor's relationships stable across the page and timestamp read.
    await lockDirection1Actor(db, actorId);
    const page = await listDiscovery(actorId, input, db, true);
    const rows = await db.query<{ user_id: string; created_at: Date }>('SELECT followed_user_id AS user_id,created_at FROM account_follows WHERE follower_id=$1 AND followed_user_id=ANY($2::uuid[])', [actorId, page.items.map(({ owner }) => owner.userId)]);
    const dates = new Map(rows.rows.map((row) => [row.user_id, row.created_at.toISOString()]));
    return followingListSchema.parse({ items: page.items.map((museum) => ({ profile: museum.owner,
      followedAt: dates.get(museum.owner.userId), museums: [museum] })), nextCursor: page.nextCursor });
  }, client);
}
export function readDiscoveryMuseum(actorId: string, museumId: string, accessEpoch: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireDemoAccount(db, actorId); return (await discoveryRecord(db, museumId, accessEpoch)).data; }, client);
}
export function getDiscoveryAsset(actorId: string, museumId: string, accessEpoch: string, assetId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const record = await discoveryRecord(db, museumId, accessEpoch);
    const member = await db.query('SELECT asset_id FROM snapshot_assets WHERE snapshot_id=$1 AND museum_id=$2 AND asset_id=$3', [record.snapshotId, museumId, assetId]);
    if (member.rowCount !== 1) notFound();
    return assetRecord(db, museumId, assetId);
  }, client);
}
