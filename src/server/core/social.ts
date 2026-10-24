import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { commentPageSchema, commentSettingsSchema, deletedCommentStatus, favoriteResultSchema, followResultSchema,
  idSchema, managedCommentPageSchema, managedCommentSchema, moderatedCommentStatus, publicCommentSchema, timestampSchema,
  type CommentBanInput, type CommentListInput, type CreateCommentInput, type ModerateCommentInput,
  type RelationshipInput, type UpdateCommentSettingsInput, type VersionedOperationInput } from '../../contracts';
import { HttpError } from '../http';
import { discoveryFromSql, discoveryRecord } from './discovery';
import { prepareDirection1Write, requireDemoAccount } from './direction1';
import { inTransaction } from './museums';
import { assertVersion, invalid, museumRecord, notFound } from './records';

export function setFollow(actorId: string, followedUserId: string, input: RelationshipInput, following: boolean, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    if (actorId === followedUserId) invalid('不能关注自己的账号。');
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'follow', followedUserId, [following]);
    if (following) {
      const visible = await db.query(`SELECT m.id ${discoveryFromSql} AND owner.id=$1 FOR UPDATE OF m`, [followedUserId]);
      if (visible.rowCount !== 1) notFound();
    }
    if (!operation.replayed) {
      if (following) await db.query('INSERT INTO account_follows(follower_id,followed_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [actorId, followedUserId]);
      else await db.query('DELETE FROM account_follows WHERE follower_id=$1 AND followed_user_id=$2', [actorId, followedUserId]);
      await operation.finish();
    }
    const row = await db.query('SELECT 1 FROM account_follows WHERE follower_id=$1 AND followed_user_id=$2', [actorId, followedUserId]);
    return followResultSchema.parse({ followedUserId, isFollowing: row.rowCount === 1 });
  }, client);
}
export function setFavorite(actorId: string, museumId: string, accessEpoch: string, input: RelationshipInput, favorited: boolean, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'favorite', museumId, [accessEpoch, favorited]);
    const museum = await discoveryRecord(db, museumId, accessEpoch, true);
    if (museum.ownerId === actorId) invalid('不能收藏自己的展馆。');
    if (!operation.replayed) {
      if (favorited) await db.query('INSERT INTO museum_favorites(user_id,museum_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [actorId, museumId]);
      else await db.query('DELETE FROM museum_favorites WHERE user_id=$1 AND museum_id=$2', [actorId, museumId]);
      await operation.finish();
    }
    const result = await db.query<{ count: number; mine: boolean }>(`SELECT count(*)::float8 AS count,
      COALESCE(bool_or(user_id=$1),false) AS mine FROM museum_favorites WHERE museum_id=$2`, [actorId, museumId]);
    return favoriteResultSchema.parse({ museumId, isFavorited: result.rows[0]?.mine, favoriteCount: result.rows[0]?.count });
  }, client);
}

const commentColumns = `c.id,c.museum_id AS "museumId",jsonb_build_object('userId',profile.user_id,'nickname',profile.nickname) AS author,
  c.root_id AS "rootId",c.reply_to_id AS "replyToId",c.status,c.body,c.version,c.created_at AS "createdAt"`;
const commentFromSql = `FROM museum_comments c JOIN public_profiles profile ON profile.user_id=c.author_id
  JOIN team_members author ON author.id=c.author_id
  LEFT JOIN museum_comments root ON root.id=c.root_id AND root.museum_id=c.museum_id
  LEFT JOIN team_members root_author ON root_author.id=root.author_id`;
const visibleCommentSql = `c.status IN ('visible','deleted') AND author.active
  AND (c.root_id IS NULL OR (root.status IN ('visible','deleted') AND root_author.active))`;
function projectComment(row: Record<string, unknown>) {
  const { body, createdAt } = row;
  return managedCommentSchema.parse({ id: row.id, museumId: row.museumId, author: row.author, rootId: row.rootId,
    replyToId: row.replyToId, status: row.status, version: row.version,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    ...(body === null ? {} : { body }) });
}
async function commentRecord(db: PoolClient, museumId: string, commentId: string, publicOnly = false) {
  const result = await db.query<Record<string, unknown>>(`SELECT ${commentColumns} ${commentFromSql}
    WHERE c.museum_id=$1 AND c.id=$2 ${publicOnly ? `AND ${visibleCommentSql}` : ''}`, [museumId, commentId]);
  const row = result.rows[0]; if (!row) notFound();
  return projectComment(row);
}
async function settingsRecord(db: PoolClient, museumId: string) {
  const row = await db.query<Record<string, unknown>>('SELECT museum_id AS "museumId",mode,version FROM museum_comment_settings WHERE museum_id=$1', [museumId]);
  return commentSettingsSchema.parse(row.rows[0] ?? { museumId, mode: 'open', version: 1 });
}
async function isBanned(db: PoolClient, museumId: string, actorId: string) {
  return (await db.query('SELECT 1 FROM museum_comment_bans WHERE museum_id=$1 AND user_id=$2', [museumId, actorId])).rowCount === 1;
}
const commentCursorSchema = z.strictObject({ museumId: idSchema, accessEpoch: idSchema.nullable(), createdAt: timestampSchema, id: idSchema });
async function commentsPage(db: PoolClient, museumId: string, accessEpoch: string | null, input: CommentListInput) {
  let cursor: z.infer<typeof commentCursorSchema> | null = null;
  if (input.cursor) {
    try { cursor = commentCursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
    catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
      invalid('留言游标无效，请从第一页重新读取。');
    }
    if (cursor.museumId !== museumId || cursor.accessEpoch !== accessEpoch) invalid('留言入口已变化，请重新读取。');
  }
  const result = await db.query<Record<string, unknown>>(`SELECT ${commentColumns},
    to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime"
    ${commentFromSql} WHERE c.museum_id=$1 ${accessEpoch === null ? '' : `AND ${visibleCommentSql}`}
    AND ($2::timestamptz IS NULL OR (c.created_at,c.id)>($2::timestamptz,$3::uuid))
    ORDER BY c.created_at,c.id LIMIT $4`, [museumId, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1]);
  const rows = result.rows.slice(0, input.limit);
  const last = rows.at(-1);
  return { items: rows.map(projectComment), nextCursor: result.rows.length > input.limit && last
    ? Buffer.from(JSON.stringify({ museumId, accessEpoch, createdAt: last.cursorTime, id: last.id })).toString('base64url') : null };
}
export function listComments(actorId: string, museumId: string, accessEpoch: string, input: CommentListInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    await discoveryRecord(db, museumId, accessEpoch);
    const settings = await settingsRecord(db, museumId);
    return commentPageSchema.parse({ ...await commentsPage(db, museumId, accessEpoch, input), mode: settings.mode,
      canComment: settings.mode === 'open' && !await isBanned(db, museumId, actorId) });
  }, client);
}
export function listManagedComments(actorId: string, museumId: string, input: CommentListInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await museumRecord(db, actorId, museumId);
    return managedCommentPageSchema.parse(await commentsPage(db, museumId, null, input));
  }, client);
}
export function createComment(actorId: string, museumId: string, input: CreateCommentInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'create-comment', museumId, [input.accessEpoch, input.rootId, input.replyToId, input.body]);
    await discoveryRecord(db, museumId, input.accessEpoch, true);
    if (operation.replayed) {
      if (!operation.resultId) throw new Error('Comment receipt has no result identifier.');
      return publicCommentSchema.parse(await commentRecord(db, museumId, operation.resultId, true));
    }
    if ((await settingsRecord(db, museumId)).mode !== 'open') throw new HttpError({ code: 'COMMENTS_CLOSED', message: '本馆已关闭新增留言，已有输入仍可保留。' });
    if (await isBanned(db, museumId, actorId)) throw new HttpError({ code: 'COMMENTING_BLOCKED', message: '你已被本馆禁评，仍可参观本馆。' });
    if ((await db.query('SELECT 1 FROM public_profiles WHERE user_id=$1', [actorId])).rowCount !== 1) invalid('请先明确填写公开昵称。');
    if (input.rootId !== null && input.replyToId !== null) {
      const rows = await db.query<{ id: string; root_id: string | null }>(`SELECT c.id,c.root_id ${commentFromSql} WHERE c.museum_id=$1
        AND c.id=ANY($2::uuid[]) AND ${visibleCommentSql}`, [museumId, [input.rootId, input.replyToId]]);
      const root = rows.rows.find((row) => row.id === input.rootId && row.root_id === null);
      const target = rows.rows.find((row) => row.id === input.replyToId && (row.id === input.rootId || row.root_id === input.rootId));
      if (!root || !target) throw new HttpError({ code: 'THREAD_UNAVAILABLE', message: '目标线程不可回复，请核对当前留言。' });
    }
    const id = randomUUID();
    await db.query('INSERT INTO museum_comments(id,museum_id,author_id,root_id,reply_to_id,body) VALUES($1,$2,$3,$4,$5,$6)', [id, museumId, actorId, input.rootId, input.replyToId, input.body]);
    await operation.finish(id);
    return publicCommentSchema.parse(await commentRecord(db, museumId, id, true));
  }, client);
}
export function deleteComment(actorId: string, museumId: string, commentId: string, input: VersionedOperationInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'delete-comment', commentId, [museumId, input.expectedVersion]);
    // An author can erase their own text after a museum becomes private, without
    // receiving its title, hidden thread or any other private museum content.
    const owned = await db.query(`SELECT m.id FROM museums m JOIN museum_comments c ON c.museum_id=m.id
      WHERE m.id=$1 AND c.id=$2 AND c.author_id=$3 FOR UPDATE OF m`, [museumId, commentId, actorId]);
    if (owned.rowCount !== 1) notFound();
    const comment = await commentRecord(db, museumId, commentId);
    if (!operation.replayed) {
      assertVersion(comment.version, input.expectedVersion);
      if ('body' in comment) await db.query('UPDATE museum_comments SET body=NULL,status=$1,version=version+1 WHERE id=$2', [deletedCommentStatus(comment.status), commentId]);
      await operation.finish(commentId);
    }
    return { ok: true as const };
  }, client);
}
export function moderateComment(actorId: string, museumId: string, commentId: string, input: ModerateCommentInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'moderate-comment', commentId, [museumId, input.expectedVersion, input.action]);
    await museumRecord(db, actorId, museumId, true);
    const comment = await commentRecord(db, museumId, commentId);
    if (!operation.replayed) {
      assertVersion(comment.version, input.expectedVersion);
      const status = moderatedCommentStatus(comment.status, input.action === 'hide');
      if (status !== comment.status) await db.query('UPDATE museum_comments SET status=$1,version=version+1 WHERE id=$2', [status, commentId]);
      await operation.finish(commentId);
    }
    return commentRecord(db, museumId, commentId);
  }, client);
}
export function getCommentSettings(actorId: string, museumId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireDemoAccount(db, actorId); await museumRecord(db, actorId, museumId); return settingsRecord(db, museumId); }, client);
}
export function updateCommentSettings(actorId: string, museumId: string, input: UpdateCommentSettingsInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'comment-settings', museumId, [input.expectedVersion, input.mode]);
    await museumRecord(db, actorId, museumId, true);
    const settings = await settingsRecord(db, museumId);
    if (!operation.replayed) {
      assertVersion(settings.version, input.expectedVersion);
      await db.query(`INSERT INTO museum_comment_settings(museum_id,mode,version) VALUES($1,$2,2)
        ON CONFLICT(museum_id) DO UPDATE SET mode=excluded.mode,version=museum_comment_settings.version+1`, [museumId, input.mode]);
      await operation.finish();
    }
    return settingsRecord(db, museumId);
  }, client);
}
export function setCommentBan(actorId: string, museumId: string, input: CommentBanInput, banned: boolean, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'comment-ban', museumId, [input.targetCommentId, banned]);
    await museumRecord(db, actorId, museumId, true);
    const target = await commentRecord(db, museumId, input.targetCommentId);
    if (target.author.userId === actorId) invalid('不能将自己设为本馆禁评对象。');
    if (!operation.replayed) {
      if (banned) await db.query('INSERT INTO museum_comment_bans(museum_id,user_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [museumId, target.author.userId, actorId]);
      else await db.query('DELETE FROM museum_comment_bans WHERE museum_id=$1 AND user_id=$2', [museumId, target.author.userId]);
      await operation.finish();
    }
    return { ok: true as const };
  }, client);
}
