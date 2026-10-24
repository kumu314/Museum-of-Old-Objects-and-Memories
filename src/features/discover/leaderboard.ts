import type { LeaderboardEntry, RegionCity } from '../../contracts/discovery';

/**
 * 榜单的展示层筛选。
 *
 * 排序与名次全部由服务端聚合决定（见 `src/server/core/discovery.ts`）：真实数据下
 * 并列时的顺序由数据库给出，客户端再排一次就会与 `LIMIT` 截断点对不上。
 * 这里只做筛选，不改顺序、不改名次。
 *
 * 曾经的 DEMO 分支（fixture + 混入即抛）已随真实聚合接入删除；页面上的数字
 * 来自 `museum_view_events`，空库就是空页面，不再用假数据填充。
 */

/**
 * 「全部」与「未标注城市」是两回事：前者不筛，后者只留 regionCity 为 null 的馆。
 * 这两者混起来就会把"没选城市"悄悄当成"选了全部"。
 */
export type BoardFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'city'; readonly city: RegionCity }
  | { readonly kind: 'unplaced' };

export function filterEntries(entries: readonly LeaderboardEntry[], filter: BoardFilter): LeaderboardEntry[] {
  if (filter.kind === 'all') return [...entries];
  if (filter.kind === 'unplaced') return entries.filter((entry) => entry.regionCity === null);
  return entries.filter((entry) => entry.regionCity === filter.city);
}
