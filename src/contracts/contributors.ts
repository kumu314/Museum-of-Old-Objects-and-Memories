import { z } from 'zod';
import { idSchema, textSchema, timestampSchema } from './primitives';

/**
 * 共同作者与多人讲述的契约（方向二 · 第三块）。
 *
 * 这一版**只有类型，没有任何表**。仓库里还拿不到迁移编号：`0006` 已被
 * PR #15 占用，而 `migrate.ts` 要求编号从 0001 起连续无缺口。
 * 字段与语义先定下来，是为了让评审能先看规则，避免表建完才发现口径不对。
 *
 * 三条不可协商的产品规则，全部落在这里而不是界面里：
 * 1. 邀请粒度是**单件展品**：接受邀请只对这一件展品生效，不扩散到整馆。
 * 2. **未接受邀请不能署名**：待回应、已拒绝、已被撤回的邀请都不产生署名权。
 * 3. **每位作者分别同意自己的内容公开**：同意是逐份的，一个人同意不代表另一个人的内容可以公开。
 */

/**
 * 署名角色。`owner` 是展馆归属人（`museums.created_by`），不需要邀请；
 * `coauthor` 必须持有该展品上**已接受**的邀请。
 *
 * 与 `team_members.role` 无关：那个字段是账号来源标记，不参与授权判断。
 */
export const contributorRoleSchema = z.enum(['owner', 'coauthor']);
export type ContributorRole = z.infer<typeof contributorRoleSchema>;

/**
 * 邀请状态。四个状态互斥且都保留，不合并：
 * - `pending`  馆主已发出，被邀请人尚未回应 → 不产生署名权
 * - `accepted` 被邀请人已接受 → 产生该展品的署名权
 * - `declined` 被邀请人拒绝 → 不产生署名权；同一展品再邀请需新建记录
 * - `cancelled` 馆主在对方回应前收回 → 不产生署名权
 *
 * `declined` 与 `cancelled` 分开，是因为动作主体不同：前者是被邀请人的决定，
 * 后者是馆主的决定。合并成一个状态会丢掉"谁拒绝的"这个事实。
 */
export const invitationStatusSchema = z.enum(['pending', 'accepted', 'declined', 'cancelled']);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const contributionInvitationSchema = z.strictObject({
  id: idSchema,
  exhibitId: idSchema,
  museumId: idSchema,
  /** 被邀请人账号。邀请必须指向已存在的账号，否则对方侧无从接受。 */
  inviteeId: idSchema,
  /** 发出邀请时的展示名快照；对方改名不影响历史记录的当时语义。 */
  inviteeName: textSchema(1, 60),
  status: invitationStatusSchema,
  invitedAt: timestampSchema,
  /** 回应或收回的时间；`pending` 时必须为空。 */
  respondedAt: timestampSchema.nullable(),
  isDemo: z.boolean(),
}).refine((invitation) => invitation.status === 'pending'
  ? invitation.respondedAt === null
  : invitation.respondedAt !== null, {
  message: '邀请一旦有结果就必须记录时间，未回应时不得有回应时间。',
  path: ['respondedAt'],
});

/**
 * 一份讲述。**一份内容对应一位作者**，没有"共同作者共写一份"这种形态：
 * 同一实物下保留多人独立讲述，不做合并、不生成共同摘要、不用 AI 弥合矛盾。
 */
export const contributionSchema = z.strictObject({
  id: idSchema,
  exhibitId: idSchema,
  authorId: idSchema,
  authorName: textSchema(1, 60),
  authorRole: contributorRoleSchema,
  /** 讲述正文。每份独立保存，任何合并都发生在展示层之外，不属于契约。 */
  story: textSchema(1, 4_000),
  /**
   * 来源：谁讲的、何时何地记录的。必填。
   * 多人讲述的价值在来源，缺来源的转述无法核验，因此不允许留空。
   */
  sourceNote: textSchema(1, 200),
  /** 作者本人对自己这份内容是否同意公开。逐份控制，可单独改为 false。 */
  publishConsent: z.boolean(),
  /** 撤回时间。非空即视为该作者撤回这份内容，新公开版本必须移除。 */
  withdrawnAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  isDemo: z.boolean(),
});

/**
 * 公开版本里的一份讲述。**不含** `publishConsent`、`withdrawnAt` 这类内部状态：
 * 读者只需要知道"谁讲的、讲的什么、来源在哪"，不需要知道别人有没有撤回过。
 */
export const publicContributionSchema = z.strictObject({
  id: idSchema,
  authorId: idSchema,
  authorName: textSchema(1, 60),
  authorRole: contributorRoleSchema,
  story: textSchema(1, 4_000),
  sourceNote: textSchema(1, 200),
});
export type PublicContribution = z.infer<typeof publicContributionSchema>;

/**
 * 一份讲述没有进入公开版本的原因。
 *
 * 对外只给原因码，不给正文：被排除的内容连标题都不该泄露。
 */
export const exclusionReasonSchema = z.enum(['invitation-not-accepted', 'no-consent', 'withdrawn']);
export type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

export const excludedContributionSchema = z.strictObject({
  id: idSchema,
  authorName: textSchema(1, 60),
  reason: exclusionReasonSchema,
});
export type ExcludedContribution = z.infer<typeof excludedContributionSchema>;

/**
 * 一件展品的公开版本视图。
 *
 * `contributions` 保持数组而不是拼接文本：顺序按创建时间稳定排序，
 * 每条各自署名与来源。存成一段合并文本就等于替作者改了话。
 */
export const publicationViewSchema = z.strictObject({
  exhibitId: idSchema,
  contributions: z.array(publicContributionSchema),
  excluded: z.array(excludedContributionSchema),
});
export type PublicationView = z.infer<typeof publicationViewSchema>;

export const contributionStateSchema = z.strictObject({
  exhibitId: idSchema,
  invitations: z.array(contributionInvitationSchema),
  contributions: z.array(contributionSchema),
});
export type ContributionState = z.infer<typeof contributionStateSchema>;

export type ContributionInvitation = z.infer<typeof contributionInvitationSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
