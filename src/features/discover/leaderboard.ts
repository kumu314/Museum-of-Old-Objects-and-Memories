import { leaderboardSchema, type Leaderboard, type LeaderboardEntry, type RegionCity } from '../../contracts/discovery';

export type RankInput = {
  readonly museumId: string;
  readonly title: string;
  readonly regionCity: RegionCity | null;
  readonly viewCount: number;
  readonly isDemo: boolean;
};

const titleOrder = new Intl.Collator('zh-Hans-CN');

/**
 * 累计榜排序：浏览次数降序；同次数按标题、再用 museumId 兜底。
 *
 * 并列必须有名次之外的确定顺序，否则同一份数据每次渲染都会跳位。
 */
export function rankEntries(input: readonly RankInput[]): LeaderboardEntry[] {
  return [...input]
    .sort((left, right) => right.viewCount - left.viewCount
      || titleOrder.compare(left.title, right.title)
      || titleOrder.compare(left.museumId, right.museumId))
    .map((entry, index) => ({
      rank: index + 1,
      museumId: entry.museumId,
      title: entry.title,
      regionCity: entry.regionCity,
      viewCount: entry.viewCount,
      isDemo: entry.isDemo,
    }));
}

/**
 * 演示数据与真实数据不得混入同一榜单：混在一起就再也分不清哪个数字是真的。
 * 首版全部是 fixture，这条在接真实聚合时才会真正生效，但要现在就挡住。
 */
function assertDemoHomogeneous(input: readonly RankInput[]): void {
  const first = input[0];
  if (first === undefined) return;
  if (input.some((entry) => entry.isDemo !== first.isDemo)) {
    throw new Error('演示数据与真实数据不能混入同一榜单。');
  }
}

/** 产出经契约校验的榜单；limit 只影响展示条数，totalMuseums 始终是聚合总数。 */
export function toLeaderboard(input: readonly RankInput[], limit?: number): Leaderboard {
  assertDemoHomogeneous(input);
  const ranked = rankEntries(input);
  const entries = limit === undefined ? ranked : ranked.slice(0, Math.max(0, limit));
  return leaderboardSchema.parse({ period: 'all', totalMuseums: input.length, entries });
}

/**
 * 榜单筛选。「全部」与「未标注城市」是两回事：前者不筛，后者只留 regionCity 为 null 的馆。
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
