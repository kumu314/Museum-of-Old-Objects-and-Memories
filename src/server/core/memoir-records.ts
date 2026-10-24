import type { PoolClient } from 'pg';
import {
  interviewQuestionSchema, interviewSessionSchema, memoirAnswerRevisionSchema, memoirChapterSchema,
  memoirChapterDraftSchema, memoirChapterRevisionSchema, memoirChapterConfirmationSchema,
  memoirChapterPublicationSchema, onlineMemoirSchema,
} from '../../contracts';
import { notFound } from './records';

export function memoirDates(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    key.endsWith('At') && value instanceof Date ? value.toISOString() : value]));
}
export const memoirColumns = `id,owner_id AS "ownerId",museum_id AS "museumId",title,version,
  source_version AS "sourceVersion",created_at AS "createdAt",updated_at AS "updatedAt"`;
export function memoirProjection(row: Record<string, unknown>) {
  const { sourceVersion, ...memoir } = memoirDates(row);
  return onlineMemoirSchema.parse({ memoir, sourceVersion });
}
export async function memoirRecord(db: PoolClient, actorId: string, id: string, lock = false) {
  const result = await db.query<Record<string, unknown>>(`SELECT ${memoirColumns}
    FROM memoirs WHERE id=$1 AND owner_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, actorId]);
  const row = result.rows[0];
  if (!row) notFound();
  return memoirProjection(row);
}
export const memoirSessionColumns = `id,memoir_id AS "memoirId",jsonb_build_object('id',topic_id,'title',topic_title,'disposition',disposition) AS topic,
  state,current_question_id AS "currentQuestionId",version,created_at AS "createdAt",updated_at AS "updatedAt"`;
export async function memoirSessionRecord(db: PoolClient, memoirId: string, id: string) {
  const row = (await db.query<Record<string, unknown>>(`SELECT ${memoirSessionColumns} FROM memoir_sessions WHERE memoir_id=$1 AND id=$2`, [memoirId, id])).rows[0];
  if (!row) notFound();
  return interviewSessionSchema.parse(memoirDates(row));
}
export const memoirQuestionColumns = `q.id,q.session_id AS "sessionId",s.topic_id AS "topicId",q.kind,q.body AS text,q.created_at AS "createdAt",
  COALESCE((SELECT jsonb_agg(x.answer_revision_id ORDER BY x.answer_revision_id) FROM memoir_question_sources x WHERE x.question_id=q.id),'[]') AS "basedOnAnswerRevisionIds"`;
export const memoirAnswerColumns = `r.id,r.answer_id AS "answerId",r.memoir_id AS "memoirId",a.session_id AS "sessionId",a.question_id AS "questionId",
  r.revision,a.kind,r.body AS text,r.created_at AS "createdAt"`;
export function memoirQuestionProjection(row: Record<string, unknown>) { return interviewQuestionSchema.parse(memoirDates(row)); }
export function memoirAnswerProjection(row: Record<string, unknown>) { return memoirAnswerRevisionSchema.parse(memoirDates(row)); }
export const memoirChapterColumns = `id,memoir_id AS "memoirId",title,version,current_revision_id AS "currentRevisionId",created_at AS "createdAt",updated_at AS "updatedAt"`;
export async function memoirChapterRecord(db: PoolClient, memoirId: string, id: string) {
  const row = (await db.query<Record<string, unknown>>(`SELECT ${memoirChapterColumns} FROM memoir_chapters WHERE memoir_id=$1 AND id=$2`, [memoirId, id])).rows[0];
  if (!row) notFound();
  return memoirChapterSchema.parse(memoirDates(row));
}
export const memoirContentColumns = `c.id,c.memoir_id AS "memoirId",c.chapter_id AS "chapterId",c.kind,c.source_version AS "sourceVersion",c.version,
  c.title,c.generation,c.ai_operation_id AS "aiOperationId",c.derived_from_draft_id AS "derivedFromDraftId",c.created_at AS "createdAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.paragraph_id,'text',p.body,'sources',
    (SELECT jsonb_agg(jsonb_build_object('answerRevisionId',s.answer_revision_id,'start',s.start_offset,'end',s.end_offset)
      ORDER BY s.answer_revision_id,s.start_offset,s.end_offset) FROM memoir_paragraph_sources s WHERE s.content_id=p.content_id AND s.ordinal=p.ordinal))
    ORDER BY p.ordinal) FROM memoir_paragraphs p WHERE p.content_id=c.id),'[]') AS paragraphs`;
export function memoirContentProjection(raw: Record<string, unknown>) {
  const row = memoirDates(raw);
  return row.kind === 'draft' ? memoirChapterDraftSchema.parse({ id: row.id, memoirId: row.memoirId, chapterId: row.chapterId,
    sourceVersion: row.sourceVersion, generation: row.generation, aiOperationId: row.aiOperationId,
    output: { title: row.title, paragraphs: row.paragraphs }, createdAt: row.createdAt })
    : memoirChapterRevisionSchema.parse({ id: row.id, chapterId: row.chapterId, version: row.version, sourceVersion: row.sourceVersion,
      title: row.title, paragraphs: row.paragraphs, derivedFromDraftId: row.derivedFromDraftId, createdAt: row.createdAt });
}
export const memoirConfirmationColumns = `id,chapter_id AS "chapterId",revision_id AS "revisionId",source_version AS "sourceVersion",confirmed_by AS "confirmedBy",confirmed_at AS "confirmedAt"`;
export function memoirConfirmationProjection(row: Record<string, unknown>) { return memoirChapterConfirmationSchema.parse(memoirDates(row)); }
export const memoirPublicationColumns = `id,chapter_id AS "chapterId",confirmed_revision_id AS "confirmedRevisionId",confirmation_id AS "confirmationId",
  consent_version AS "consentVersion",privacy_acknowledged_at AS "privacyAcknowledgedAt",granted_at AS "grantedAt",revoked_at AS "revokedAt",public_data AS "publicData"`;
export function memoirPublicationProjection(row: Record<string, unknown>) { return memoirChapterPublicationSchema.parse(memoirDates(row)); }
