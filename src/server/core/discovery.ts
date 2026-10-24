import type { PoolClient } from 'pg';
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
import { inTransaction } from './museums';

/**
 * 累计浏览榜与地区分布的真实聚合（方向二 · 第四块）。
 *
 * **上榜范围是一条安全边界，不是可调参数**：只有「馆主明确同意收录 + 未删除 + 已发布 + 分享开着」的馆才计入。
 * 少了后两个条件，馆主还没发布的草稿标题就会出现在全站公开榜单上——浏览数当然是 0，
 * 但标题本身已经泄露了。已停止分享的馆同理：链接都失效了，还留在榜上等于继续公示。
 */
const visibleMuseum = 'm.discovery_listed AND m.deleted_at IS NULL AND m.share_enabled AND m.current_snapshot_id IS NOT NULL';

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
