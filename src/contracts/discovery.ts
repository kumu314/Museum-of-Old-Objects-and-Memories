import { z } from 'zod';
import { successResponseSchema } from './errors';
import { exhibitNameSchema, idSchema, textSchema, timestampSchema, versionedOperationInputSchema, versionSchema } from './primitives';

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

export const museumAccessModeSchema = z.enum(['private', 'link_only', 'discoverable']);
export const newMuseumAccessMode: MuseumAccessMode = 'private';
export const publicAuthorSchema = z.strictObject({ userId: idSchema, nickname: textSchema(1, 80) });
export const publicProfileSchema = publicAuthorSchema.extend({ version: versionSchema, updatedAt: timestampSchema });
export const updatePublicProfileInputSchema = versionedOperationInputSchema.extend({
  nickname: textSchema(1, 80),
  // 「未创建」与「已存在且版本 1」在数据上无法区分：首次保存必须显式声明预期缺失，
  // 服务端据此在资料行已存在时返回 409，而不是把并发的另一次首次保存静默覆盖。
  expectMissing: z.boolean().optional(),
});
export const museumTagsSchema = z.array(textSchema(1, 30)).max(10)
  .refine((tags) => new Set(tags).size === tags.length, '标签不得重复。');
export const updateMuseumTagsInputSchema = versionedOperationInputSchema.extend({ tags: museumTagsSchema });
export const museumTagsStateSchema = z.strictObject({ museumId: idSchema, version: versionSchema, tags: museumTagsSchema });
export const museumAccessSchema = z.strictObject({
  museumId: idSchema,
  version: versionSchema,
  accessMode: museumAccessModeSchema,
  accessEpoch: idSchema.nullable(),
}).refine((access) => access.accessMode === 'private' ? access.accessEpoch === null : access.accessEpoch !== null,
  '私密馆不提供外部访问版本；开放访问必须有当前版本。');
export const updateMuseumAccessInputSchema = versionedOperationInputSchema.extend({ accessMode: museumAccessModeSchema });

export const discoveryMuseumSchema = z.strictObject({
  museumId: idSchema,
  accessEpoch: idSchema,
  owner: publicAuthorSchema,
  title: textSchema(1, 120),
  description: textSchema(0, 2_000),
  tags: museumTagsSchema,
  exhibitNames: z.array(exhibitNameSchema),
  publishedAt: timestampSchema,
  favoriteCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  isFollowing: z.boolean(),
  isFavorited: z.boolean(),
});
// A cursor is opaque data, never a URL or client-provided SQL fragment.
export const discoveryCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/);
export const discoverySearchInputSchema = z.strictObject({
  query: textSchema(0, 100),
  cursor: discoveryCursorSchema.nullable(),
  limit: z.number().int().min(1).max(50),
});
export const discoveryPageSchema = z.strictObject({
  items: z.array(discoveryMuseumSchema).max(50),
  nextCursor: discoveryCursorSchema.nullable(),
}).refine((page) => new Set(page.items.map(({ museumId }) => museumId)).size === page.items.length,
  '目录页不得重复返回展馆。');
export const discoveryPageResponseSchema = successResponseSchema(discoveryPageSchema);
export const discoveryMuseumResponseSchema = successResponseSchema(discoveryMuseumSchema);
export const relationshipInputSchema = z.strictObject({ operationId: idSchema });
export const favoriteResultSchema = z.strictObject({
  museumId: idSchema,
  isFavorited: z.boolean(),
  favoriteCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const followResultSchema = z.strictObject({ followedUserId: idSchema, isFollowing: z.boolean() });
export const followingListSchema = z.strictObject({
  items: z.array(z.strictObject({
    profile: publicAuthorSchema,
    followedAt: timestampSchema,
    museums: z.array(discoveryMuseumSchema).max(50),
  })).max(50),
  nextCursor: discoveryCursorSchema.nullable(),
});

// This marker describes fixture provenance. It is never an authorization input.
export function demoFixtureSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ provenance: z.literal('demo'), generation: z.literal('fixture'), data });
}

export type MuseumAccessMode = z.infer<typeof museumAccessModeSchema>;
export type MuseumAccess = z.infer<typeof museumAccessSchema>;
export type PublicAuthor = z.infer<typeof publicAuthorSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type DiscoveryMuseum = z.infer<typeof discoveryMuseumSchema>;
export type DiscoveryPage = z.infer<typeof discoveryPageSchema>;
export type DiscoverySearchInput = z.infer<typeof discoverySearchInputSchema>;
export type FollowingList = z.infer<typeof followingListSchema>;
export type UpdatePublicProfileInput = z.infer<typeof updatePublicProfileInputSchema>;
export type UpdateMuseumTagsInput = z.infer<typeof updateMuseumTagsInputSchema>;
export type UpdateMuseumAccessInput = z.infer<typeof updateMuseumAccessInputSchema>;
export type RelationshipInput = z.infer<typeof relationshipInputSchema>;
