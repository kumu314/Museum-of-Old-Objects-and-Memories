import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { discoveryMuseumSchema, discoveryPageSchema, discoverySearchInputSchema, followingListSchema, idSchema, museumAccessSchema, museumTagsSchema,
  museumTagsStateSchema, publicMuseumSchema, publicProfileSchema, timestampSchema,
  type DiscoverySearchInput, type UpdateMuseumAccessInput, type UpdateMuseumTagsInput, type UpdatePublicProfileInput } from '../../contracts';
import {
  henanCities,
  leaderboardSchema,
  regionCitySchema,
  regionDistributionSchema,
  type Leaderboard,
  type LeaderboardEntry,
  type RegionBucket,
  type RegionCity,
} from '../../contracts/discovery';
import { lockDirection1Actor, prepareDirection1Write, requireDemoAccount } from './direction1';
import { HttpError } from '../http';
import { inTransaction } from './museums';
import { assertVersion, assetRecord, invalid, museumRecord, notFound, requireActor } from './records';
import { newShareToken } from './share-tokens';

/**
 * 累计浏览榜与地区分布的真实聚合（方向二 · 第四块）。
 *
 * **上榜范围是一条安全边界，不是可调参数**：只有「馆主明确同意收录 + 未删除 + 已发布 + 分享开着」的馆才计入。
 * 少了后两个条件，馆主还没发布的草稿标题就会出现在全站公开榜单上——浏览数当然是 0，
 * 但标题本身已经泄露了。已停止分享的馆同理：链接都失效了，还留在榜上等于继续公示。
 */
const visibleMuseum = "m.discovery_listed AND m.access_mode='discoverable' AND m.deleted_at IS NULL AND m.share_enabled AND m.current_snapshot_id IS NOT NULL";

/**
 * 榜单条数上限。首版馆数很少，取全量最省事，也让「按城市筛选」与地图聚合口径一致；
 * 上限只是防止某天数据涨起来把一次性查询拖垮，不是产品设计的 Top N 榜。
 */
const leaderboardLimit = 200;

export type LeaderboardRow = {
  readonly museumId: string;
  readonly title: string;
  readonly regionCity: RegionCity | null;
  readonly viewCount: number;
};

/**
 * 聚合行 → 契约榜单。
 *
 * 名次在这里补，排序留在 SQL：并列时（浏览数相同）库里的顺序才是最终顺序，
 * 若在应用层二次排序，LIMIT 的截断点会和最终顺序对不上。
 */
export function toLiveLeaderboard(rows: readonly LeaderboardRow[], totalMuseums: number): Leaderboard {
  const entries: LeaderboardEntry[] = rows.map((row, index) => ({
    rank: index + 1,
    museumId: row.museumId,
    title: row.title,
    regionCity: row.regionCity,
    viewCount: row.viewCount,
    // 真实聚合恒为 false：这里的每个数字都来自 museum_view_events，不是 fixture。
    isDemo: false,
  }));
  return leaderboardSchema.parse({ period: 'all', totalMuseums, entries });
}

export type CityAggregateRow = {
  readonly city: RegionCity;
  readonly museumCount: number;
  readonly viewCount: number;
};

/**
 * 地区聚合 → 18 城固定顺序。
 *
 * 没有馆的城市也要出现（计 0）：否则地图与柱状图每次渲染都会按"有数据的城市"
 * 重排，读者会以为城市集合在变。城市值一律过白名单校验，库里不该有名单外的值，
 * 真出现了就让它抛错，而不是悄悄丢掉一行。
 */
export function toRegionBuckets(rows: readonly CityAggregateRow[]): RegionBucket[] {
  const byCity = new Map<RegionCity, CityAggregateRow>();
  for (const row of rows) {
    const city = regionCitySchema.parse(row.city);
    if (byCity.has(city)) throw new Error(`地区聚合出现重复城市：${city}`);
    byCity.set(city, row);
  }
  const cities = henanCities.map((city) => {
    const row = byCity.get(city);
    return { city, museumCount: row?.museumCount ?? 0, viewCount: row?.viewCount ?? 0 };
  });
  return regionDistributionSchema.parse({ cities }).cities;
}

export function readLeaderboard(client?: PoolClient): Promise<Leaderboard> {
  return inTransaction(async (db) => {
    // 浏览数只算「不是馆主本人」的访问：馆主自己反复打开不该把自己的馆推上榜首。
    // 事件行仍然照实写入（见 recordMuseumView），排除发生在聚合这一侧，便于事后审计。
    // 总数与条目共用同一语句快照，避免并发停止分享导致总数小于条目数。
    const rows = await db.query<{ museumId: string; title: string; regionCity: string | null; viewCount: number; totalMuseums: number }>(
      `SELECT m.id AS "museumId", s.public_data->>'title' AS title, m.region_city AS "regionCity", count(e.id)::int AS "viewCount", count(*) OVER()::int AS "totalMuseums"
       FROM museums m
       JOIN published_snapshots s ON s.id=m.current_snapshot_id AND s.museum_id=m.id AND s.sealed
       LEFT JOIN museum_view_events e ON e.museum_id = m.id AND e.viewer_id <> m.created_by
       WHERE ${visibleMuseum}
       GROUP BY m.id, s.public_data, m.region_city
       ORDER BY count(e.id) DESC, s.public_data->>'title' ASC, m.id ASC
       LIMIT $1`, [leaderboardLimit]);
    return toLiveLeaderboard(rows.rows.map((row) => ({
      museumId: row.museumId,
      title: row.title,
      regionCity: row.regionCity === null ? null : regionCitySchema.parse(row.regionCity),
      viewCount: row.viewCount,
    })), rows.rows[0]?.totalMuseums ?? 0);
  }, client);
}

export type RegionDistributionResult = {
  readonly cities: readonly RegionBucket[];
  /** 未标注城市的馆数：不参与地图聚合，单列出来是为了让总数对得上。 */
  readonly unplacedMuseums: number;
};

export function readRegionDistribution(client?: PoolClient): Promise<RegionDistributionResult> {
  return inTransaction(async (db) => {
    const rows = await db.query<{ city: string; museumCount: number; viewCount: number }>(
      `SELECT m.region_city AS city, count(DISTINCT m.id)::int AS "museumCount", count(e.id)::int AS "viewCount"
       FROM museums m
       LEFT JOIN museum_view_events e ON e.museum_id = m.id AND e.viewer_id <> m.created_by
       WHERE ${visibleMuseum} AND m.region_city IS NOT NULL
       GROUP BY m.region_city`, []);
    const unplaced = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM museums m WHERE ${visibleMuseum} AND m.region_city IS NULL`, []);
    return {
      cities: toRegionBuckets(rows.rows.map((row) => ({
        city: regionCitySchema.parse(row.city),
        museumCount: row.museumCount,
        viewCount: row.viewCount,
      }))),
      unplacedMuseums: unplaced.rows[0]?.n ?? 0,
    };
  }, client);
}

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
    // 工作台与世界页都可能首次保存昵称：先锁行再核对版本，后提交者得到 409，
    // 不能让晚到的请求静默覆盖先提交者。
    const locked = await db.query<Record<string, unknown>>('SELECT user_id AS "userId",nickname,version,updated_at AS "updatedAt" FROM public_profiles WHERE user_id=$1 FOR UPDATE', [actorId]);
    const current = locked.rows[0]
      ? publicProfileSchema.parse({ ...locked.rows[0], updatedAt: locked.rows[0].updatedAt instanceof Date ? locked.rows[0].updatedAt.toISOString() : locked.rows[0].updatedAt })
      : null;
    if (operation.replayed) return current;
    if (input.expectMissing === true && current) {
      // 另一页面的首次保存已经创建了资料行：这次“预期缺失”的提交必须 409，而不是覆盖。
      throw new HttpError({ code: 'VERSION_CONFLICT', message: '昵称已由另一次首次保存创建，请刷新后核对。' });
    }
    assertVersion(current?.version ?? 1, input.expectedVersion);
    if (current) await db.query('UPDATE public_profiles SET nickname=$1,version=version+1,updated_at=now() WHERE user_id=$2', [input.nickname, actorId]);
    else {
      try {
        await db.query('INSERT INTO public_profiles(user_id,nickname) VALUES($1,$2)', [actorId, input.nickname]);
      } catch (error) {
        // 并发首次保存：另一半事务已插入同名资料行，按版本冲突处理。
        if ((error as { code?: string }).code === '23505') {
          throw new HttpError({ code: 'VERSION_CONFLICT', message: '昵称刚刚被另一次保存创建，请刷新后核对。' });
        }
        throw error;
      }
    }
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
      // 退出公开发现（转持链接或私密）必须同时撤销收录同意：否则榜单与地图仍会
      // 公开标题、城市和浏览量，等于退出后还被公示。
      await db.query(`UPDATE museums SET access_mode=$1,access_epoch=$2,
        share_token_hash=CASE WHEN $1='private' THEN NULL ELSE COALESCE(share_token_hash,$3) END,
        discovery_listed=CASE WHEN $1='discoverable' THEN discovery_listed ELSE false END,
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
