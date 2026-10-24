import { z } from 'zod';
import { successResponseSchema } from './errors';
import { idSchema, textSchema } from './primitives';

/**
 * 河南省 17 个地级市 + 济源（省直辖县级市），共 18 个城市。
 *
 * 只允许城市级：不存街道、不存坐标、不接受自由文本。白名单之外的值一律拒绝，
 * 避免"用户随手填个地点"把精确位置带进公开数据。
 */
export const henanCities = [
  '郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳',
  '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店', '济源',
] as const;

export const regionCitySchema = z.enum(henanCities);
export type RegionCity = z.infer<typeof regionCitySchema>;

/**
 * 只做累计榜。日/月/年榜与收藏榜明确不做，所以这里不是枚举而是字面量，
 * 将来要加周期必须改契约，不能靠传参悄悄扩展。
 */
export const leaderboardPeriodSchema = z.literal('all');

export const leaderboardEntrySchema = z.strictObject({
  rank: z.number().int().positive(),
  museumId: idSchema,
  title: textSchema(1, 120),
  regionCity: regionCitySchema.nullable(),
  /**
   * 浏览次数，不是人数。口径见 docs/DIRECTION_2_CONTRACT_PROPOSAL.md §6：
   * 排除馆主自己的查看；刷新/预加载/机器人的处理方式仍属未决，未决前不做去重，
   * 也不得在界面或文档里暗示已经处理。
   */
  viewCount: z.number().int().nonnegative(),
  /**
   * DEMO 标记。fixture 恒为 true，真实聚合恒为 false。
   * 界面必须据此显示可见标注，禁止把 fixture 混进真实榜单。
   */
  isDemo: z.boolean(),
});

export const leaderboardSchema = z.strictObject({
  period: leaderboardPeriodSchema,
  totalMuseums: z.number().int().nonnegative(),
  entries: z.array(leaderboardEntrySchema),
}).refine((board) => board.entries.every((entry, index) => entry.rank === index + 1), {
  message: '榜单名次必须从 1 连续递增。',
  path: ['entries'],
}).refine((board) => board.totalMuseums >= board.entries.length, {
  message: '入榜馆数不能超过总馆数。',
  path: ['totalMuseums'],
});

export const leaderboardResponseSchema = successResponseSchema(leaderboardSchema);

export const regionBucketSchema = z.strictObject({
  city: regionCitySchema,
  museumCount: z.number().int().nonnegative(),
  viewCount: z.number().int().nonnegative(),
});

export const regionDistributionSchema = z.strictObject({
  cities: z.array(regionBucketSchema),
});

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
export type Leaderboard = z.infer<typeof leaderboardSchema>;
export type RegionBucket = z.infer<typeof regionBucketSchema>;
export type RegionDistribution = z.infer<typeof regionDistributionSchema>;
