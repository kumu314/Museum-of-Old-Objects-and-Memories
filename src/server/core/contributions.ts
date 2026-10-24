import type { PoolClient } from 'pg';
import {
  contributionInvitationSchema,
  contributionSchema,
  contributionStateSchema,
  invitationInboxItemSchema,
  myContributionItemSchema,
  myContributionsSchema,
  type Contribution,
  type ContributionInvitation,
  type ContributionState,
  type CreateContributionInput,
  type CreateInvitationInput,
  type MyContributions,
  type RespondInvitationInput,
} from '../../contracts/contributors';
import { inTransaction } from './museums';
import { exhibitRecord, invalid, museumRecord, notFound, requireActor } from './records';

/**
 * 共同作者与多人讲述的服务端（方向二 · 第四块）。
 *
 * 纯规则在 `src/features/contributors/model.ts`，这里只负责"把规则和数据库对齐"，
 * 两处判定必须一致：
 * - 写入时判定署名权（`contribute`）：馆主不需要邀请，共同作者必须有已接受的邀请。
 * - 读取时再判定一次（公开视图那份纯函数）：邀请被收回后，历史内容立刻不再公开，
 *   不需要回头改数据。
 *
 * **这里没有任何"合并多人讲述"的入口。** 同一实物下保留多人独立讲述、各自署名、
 * 各自来源，不生成共同摘要——这条是产品红线，不是暂未实现。
 */

const invitationColumns = `i.id, i.exhibit_id AS "exhibitId", i.museum_id AS "museumId", i.invitee_id AS "inviteeId",
  i.invitee_name AS "inviteeName", i.status, i.invited_at AS "invitedAt", i.responded_at AS "respondedAt"`;

const contributionColumns = `c.id, c.exhibit_id AS "exhibitId", c.author_id AS "authorId", c.author_name AS "authorName",
  c.author_role AS "authorRole", c.story, c.source_note AS "sourceNote", c.publish_consent AS "publishConsent",
  c.withdrawn_at AS "withdrawnAt", c.created_at AS "createdAt"`;

function iso(value: unknown): string {
  if (!(value instanceof Date)) throw new Error('Invalid database timestamp.');
  return value.toISOString();
}
function isoOrNull(value: unknown): string | null {
  return value === null ? null : iso(value);
}

type InvitationRow = {
  id: string; exhibitId: string; museumId: string; inviteeId: string; inviteeName: string;
  status: string; invitedAt: Date; respondedAt: Date | null;
};
type ContributionRow = {
  id: string; exhibitId: string; authorId: string; authorName: string; authorRole: string;
  story: string; sourceNote: string; publishConsent: boolean; withdrawnAt: Date | null; createdAt: Date;
};

/** `isDemo` 恒为 false：这个文件里的每一行都来自 `contributions` 表，不是 fixture。 */
function toInvitation(row: InvitationRow): ContributionInvitation {
  return contributionInvitationSchema.parse({
    id: row.id,
    exhibitId: row.exhibitId,
    museumId: row.museumId,
    inviteeId: row.inviteeId,
    inviteeName: row.inviteeName,
    status: row.status,
    invitedAt: iso(row.invitedAt),
    respondedAt: isoOrNull(row.respondedAt),
    isDemo: false,
  });
}
function toContribution(row: ContributionRow): Contribution {
  return contributionSchema.parse({
    id: row.id,
    exhibitId: row.exhibitId,
    authorId: row.authorId,
    authorName: row.authorName,
    authorRole: row.authorRole,
    story: row.story,
    sourceNote: row.sourceNote,
    publishConsent: row.publishConsent,
    withdrawnAt: isoOrNull(row.withdrawnAt),
    createdAt: iso(row.createdAt),
    isDemo: false,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

/**
 * 馆主视角的展品协作状态：全部邀请 + 全部讲述（含已撤回、未同意的）。
 *
 * **只有馆主能读**。共同作者读同一份状态会看到别人还没同意的草稿，
 * 所以对方拿的是 `/api/contributions/mine`：只有自己的邀请与自己的讲述。
 */
export function readContributionState(actorId: string, museumId: string, exhibitId: string, client?: PoolClient): Promise<ContributionState> {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId);
    await exhibitRecord(db, museumId, exhibitId);
    const invitations = await db.query<InvitationRow>(
      `SELECT ${invitationColumns} FROM contribution_invitations i
       WHERE i.museum_id=$1 AND i.exhibit_id=$2 ORDER BY i.invited_at, i.id`, [museumId, exhibitId]);
    const contributions = await db.query<ContributionRow>(
      `SELECT ${contributionColumns} FROM contributions c
       WHERE c.museum_id=$1 AND c.exhibit_id=$2 ORDER BY c.created_at, c.id`, [museumId, exhibitId]);
    return contributionStateSchema.parse({
      exhibitId,
      invitations: invitations.rows.map(toInvitation),
      contributions: contributions.rows.map(toContribution),
    });
  }, client);
}

/**
 * 邀请某人讲这一件展品。
 *
 * 被邀请人按用户名查；查不到与"不是馆主"一样都被挡在前面，但查不到本身用
 * NOT_FOUND 回应是邀请功能无法回避的（见 `createInvitationInputSchema` 的说明）。
 */
export function inviteContributor(actorId: string, museumId: string, exhibitId: string,
  input: CreateInvitationInput, client?: PoolClient): Promise<ContributionInvitation> {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId);
    await exhibitRecord(db, museumId, exhibitId);
    const invitee = await db.query<{ id: string; username: string }>(
      'SELECT id, username FROM team_members WHERE username=$1 AND active', [input.username]);
    const target = invitee.rows[0];
    if (target === undefined) notFound();
    // 馆主给馆主自己发邀请没有意义：归属人本来就署名。
    if (target.id === actorId) invalid('你是这座馆的归属人，不需要邀请自己。');
    const live = await db.query<{ status: string }>(
      `SELECT status FROM contribution_invitations
       WHERE exhibit_id=$1 AND invitee_id=$2 AND status IN ('pending', 'accepted')`, [exhibitId, target.id]);
    const existing = live.rows[0];
    if (existing !== undefined) {
      invalid(existing.status === 'accepted' ? '对方已经是这件展品的共同作者。' : '邀请已发出，等待对方回应。');
    }
    try {
      const inserted = await db.query<InvitationRow>(
        `INSERT INTO contribution_invitations(museum_id, exhibit_id, invitee_id, invited_by, invitee_name)
         VALUES($1, $2, $3, $4, $5) RETURNING id, exhibit_id AS "exhibitId", museum_id AS "museumId",
           invitee_id AS "inviteeId", invitee_name AS "inviteeName", status,
           invited_at AS "invitedAt", responded_at AS "respondedAt"`,
        [museumId, exhibitId, target.id, actorId, target.username]);
      const row = inserted.rows[0];
      if (row === undefined) throw new Error('Invitation insert returned no row.');
      return toInvitation(row);
    } catch (error) {
      // 并发下两条邀请同时通过上面的查询：唯一索引是最终裁判，这里把它翻译成同一句话。
      if (isUniqueViolation(error)) invalid('邀请已发出，等待对方回应。');
      throw error;
    }
  }, client);
}

/**
 * 被邀请人回应邀请。
 *
 * 别人的邀请与不存在的邀请返回同一个 NOT_FOUND：区分开就等于提供
 * "这条邀请 id 属于谁"的探测通道。
 */
export function respondInvitation(actorId: string, invitationId: string,
  input: RespondInvitationInput, client?: PoolClient): Promise<ContributionInvitation> {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const found = await db.query<InvitationRow>(
      `SELECT ${invitationColumns} FROM contribution_invitations i
       WHERE i.id=$1 AND i.invitee_id=$2 FOR UPDATE`, [invitationId, actorId]);
    const current = found.rows[0];
    if (current === undefined) notFound();
    if (current.status !== 'pending') invalid('这条邀请已经有结果了，无需再次回应。');
    const updated = await db.query<InvitationRow>(
      `UPDATE contribution_invitations i SET status=$1, responded_at=now()
       WHERE i.id=$2 RETURNING ${invitationColumns}`, [input.status, invitationId]);
    const row = updated.rows[0];
    if (row === undefined) notFound();
    return toInvitation(row);
  }, client);
}

/** 馆主收回一条还没被回应的邀请。已接受的要收回属于"移出共同作者"，首版没有这个动作。 */
export function cancelInvitation(actorId: string, invitationId: string, client?: PoolClient): Promise<ContributionInvitation> {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    // 归属校验与取行合成一条：越权与不存在必须得到同一个回答。
    const found = await db.query<InvitationRow>(
      `SELECT ${invitationColumns} FROM contribution_invitations i
       JOIN museums m ON m.id=i.museum_id
       WHERE i.id=$1 AND m.created_by=$2 AND m.deleted_at IS NULL FOR UPDATE OF i`, [invitationId, actorId]);
    const current = found.rows[0];
    if (current === undefined) notFound();
    if (current.status !== 'pending') invalid('只有还没回应的邀请可以收回。');
    const updated = await db.query<InvitationRow>(
      `UPDATE contribution_invitations i SET status='cancelled', responded_at=now()
       WHERE i.id=$1 RETURNING ${invitationColumns}`, [invitationId]);
    const row = updated.rows[0];
    if (row === undefined) notFound();
    return toInvitation(row);
  }, client);
}

/**
 * 写一份讲述。
 *
 * 署名角色由服务端判定：自己是这座馆的归属人就是 owner，否则必须有这件展品上
 * **已接受**的邀请。两者都不满足时一律 NOT_FOUND——不能让试图试探的人区分
 * "展品不存在"和"你没有资格"。
 */
export function contribute(actorId: string, museumId: string, exhibitId: string,
  input: CreateContributionInput, client?: PoolClient): Promise<Contribution> {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await exhibitRecord(db, museumId, exhibitId);
    const ownership = await db.query(
      'SELECT 1 FROM museums WHERE id=$1 AND created_by=$2 AND deleted_at IS NULL', [museumId, actorId]);
    const isOwner = ownership.rowCount === 1;
    if (!isOwner) {
      const accepted = await db.query(
        `SELECT 1 FROM contribution_invitations
         WHERE museum_id=$1 AND exhibit_id=$2 AND invitee_id=$3 AND status='accepted'`, [museumId, exhibitId, actorId]);
      if (accepted.rowCount !== 1) notFound();
    }
    const author = await db.query<{ username: string }>('SELECT username FROM team_members WHERE id=$1', [actorId]);
    const authorName = author.rows[0]?.username;
    if (authorName === undefined) notFound();
    const inserted = await db.query<ContributionRow>(
      `INSERT INTO contributions(museum_id, exhibit_id, author_id, author_role, author_name, story, source_note, publish_consent)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, exhibit_id AS "exhibitId", author_id AS "authorId", author_name AS "authorName",
         author_role AS "authorRole", story, source_note AS "sourceNote", publish_consent AS "publishConsent",
         withdrawn_at AS "withdrawnAt", created_at AS "createdAt"`,
      [museumId, exhibitId, actorId, isOwner ? 'owner' : 'coauthor', authorName, input.story, input.sourceNote, input.publishConsent]);
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('Contribution insert returned no row.');
    return toContribution(row);
  }, client);
}

/**
 * 撤回自己的一份讲述。
 *
 * `author_id` 写进 WHERE：只可能改到自己的内容。别人的 id 与不存在同样是
 * NOT_FOUND；已撤回的重复调用返回当前内容（幂等），不额外暴露"曾经撤回过几次"。
 */
export function withdrawContribution(actorId: string, contributionId: string, client?: PoolClient): Promise<Contribution> {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const withdrawn = await db.query<ContributionRow>(
      `UPDATE contributions c SET withdrawn_at=now()
       WHERE c.id=$1 AND c.author_id=$2 AND c.withdrawn_at IS NULL RETURNING ${contributionColumns}`,
      [contributionId, actorId]);
    const row = withdrawn.rows[0];
    if (row !== undefined) return toContribution(row);
    const current = await db.query<ContributionRow>(
      `SELECT ${contributionColumns} FROM contributions c WHERE c.id=$1 AND c.author_id=$2`,
      [contributionId, actorId]);
    const existing = current.rows[0];
    if (existing === undefined) notFound();
    return toContribution(existing);
  }, client);
}

/**
 * 共同作者自己的东西：待回应的邀请、已接受的邀请、自己写过的讲述（含已撤回）。
 *
 * 已删除的展馆与展品不出现在这里：馆主下线整馆后，邀请与讲述都不该继续留在
 * 对方的工作台上。
 */
export function listMyContributions(actorId: string, client?: PoolClient): Promise<MyContributions> {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const invitations = await db.query<InvitationRow & { exhibitName: string; museumTitle: string }>(
      `SELECT ${invitationColumns}, e.name AS "exhibitName", m.title AS "museumTitle"
       FROM contribution_invitations i
       JOIN exhibits e ON e.id=i.exhibit_id
       JOIN museums m ON m.id=i.museum_id
       WHERE i.invitee_id=$1 AND i.status IN ('pending', 'accepted')
         AND m.deleted_at IS NULL AND e.deleted_at IS NULL
       ORDER BY i.invited_at DESC, i.id`, [actorId]);
    const contributions = await db.query<ContributionRow & { exhibitName: string; museumTitle: string }>(
      `SELECT ${contributionColumns}, e.name AS "exhibitName", m.title AS "museumTitle"
       FROM contributions c
       JOIN exhibits e ON e.id=c.exhibit_id
       JOIN museums m ON m.id=c.museum_id
       WHERE c.author_id=$1 AND m.deleted_at IS NULL AND e.deleted_at IS NULL
       ORDER BY c.created_at DESC, c.id`, [actorId]);
    return myContributionsSchema.parse({
      invitations: invitations.rows.map((row) => invitationInboxItemSchema.parse({
        invitation: toInvitation(row),
        exhibitName: row.exhibitName,
        museumTitle: row.museumTitle,
      })),
      contributions: contributions.rows.map((row) => myContributionItemSchema.parse({
        contribution: toContribution(row),
        exhibitName: row.exhibitName,
        museumTitle: row.museumTitle,
      })),
    });
  }, client);
}
