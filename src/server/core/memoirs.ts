import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  memoirOpeningTopics, memoirReferencesAreValid, memoirParagraphsSchema,
  publicMemoirChapterSchema, type CreateMemoirInput, type DeleteMemoirInput, type StartMemoirInterviewInput,
  type SaveInterviewAnswerInput, type SaveMemoirSupplementInput, type InterviewActionInput,
  type CreateMemoirChapterInput, type SaveMemoirChapterInput, type ConfirmMemoirChapterInput,
  type GrantMemoirPublicationInput, type VersionedOperationInput, type MemoirParagraph,
} from '../../contracts';
import { HttpError } from '../http';
import { prepareDirection1Write, requireDemoAccount } from './direction1';
import { inTransaction } from './museums';
import { assertVersion, invalid, museumRecord, notFound } from './records';
import {
  memoirRecord, memoirSessionRecord, memoirChapterRecord, memoirAnswerColumns, memoirAnswerProjection,
  memoirContentColumns, memoirContentProjection, memoirConfirmationColumns, memoirConfirmationProjection,
  memoirPublicationColumns, memoirPublicationProjection,
} from './memoir-records';

function interviewConflict(): never {
  throw new HttpError({ code: 'INTERVIEW_STATE_CONFLICT', message: '访谈状态已改变；请核对当前问题，已跳过或拒绝的话题不会重新开启。' });
}
async function bumpMemoir(db: PoolClient, id: string, sourcesChanged = false) {
  await db.query('UPDATE memoirs SET version=version+1,source_version=source_version+$2,updated_at=clock_timestamp() WHERE id=$1', [id, sourcesChanged ? 1 : 0]);
}
async function bumpChapter(db: PoolClient, id: string) {
  await db.query('UPDATE memoir_chapters SET version=version+1,updated_at=clock_timestamp() WHERE id=$1', [id]);
}
async function prepare(db: PoolClient, actorId: string, memoirId: string, input: VersionedOperationInput, kind: string, values: readonly unknown[]) {
  await requireDemoAccount(db, actorId);
  const operation = await prepareDirection1Write(db, actorId, input.operationId, kind, memoirId, [input.expectedVersion, ...values]);
  const current = await memoirRecord(db, actorId, memoirId, true);
  return { operation, current };
}
export function getMemoir(actorId: string, memoirId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireDemoAccount(db, actorId); return memoirRecord(db, actorId, memoirId); }, client);
}
export function createMemoir(actorId: string, input: CreateMemoirInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'memoir:create', actorId, [input.title, input.museumId]);
    if (operation.replayed && operation.resultId) return memoirRecord(db, actorId, operation.resultId);
    if (input.museumId !== null) await museumRecord(db, actorId, input.museumId, true);
    const id = randomUUID();
    await db.query('INSERT INTO memoirs(id,owner_id,museum_id,title) VALUES($1,$2,$3,$4)', [id, actorId, input.museumId, input.title]);
    await operation.finish(id);
    return memoirRecord(db, actorId, id);
  }, client);
}
export function deleteMemoir(actorId: string, memoirId: string, input: DeleteMemoirInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    const operation = await prepareDirection1Write(db, actorId, input.operationId, 'memoir:delete', memoirId, [input.expectedVersion, input.confirmOnlineDeletion]);
    if (operation.replayed) {
      const deleted = await db.query('SELECT memoir_id FROM memoir_deletions WHERE memoir_id=$1 AND owner_id=$2', [memoirId, actorId]);
      if (deleted.rowCount !== 1) notFound();
      return { ok: true as const };
    }
    const current = await memoirRecord(db, actorId, memoirId, true);
    assertVersion(current.memoir.version, input.expectedVersion);
    await db.query('INSERT INTO memoir_deletions(memoir_id,owner_id) VALUES($1,$2)', [memoirId, actorId]);
    await db.query('DELETE FROM memoirs WHERE id=$1', [memoirId]);
    await operation.finish(memoirId);
    return { ok: true as const };
  }, client);
}
export function startMemoirInterview(actorId: string, memoirId: string, input: StartMemoirInterviewInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation, current } = await prepare(db, actorId, memoirId, input, 'memoir:session', [input.topicKey]);
    if (operation.replayed && operation.resultId) return memoirSessionRecord(db, memoirId, operation.resultId);
    assertVersion(current.memoir.version, input.expectedVersion);
    const previous = (await db.query<{ id: string }>('SELECT id FROM memoir_sessions WHERE memoir_id=$1 AND topic_key=$2', [memoirId, input.topicKey])).rows[0];
    if (previous) interviewConflict();
    // Switching topics pauses the prior session; it never silently completes it.
    await db.query("UPDATE memoir_sessions SET state='paused',version=version+1,updated_at=clock_timestamp() WHERE memoir_id=$1 AND state='active'", [memoirId]);
    const id = randomUUID(); const topicId = randomUUID(); const questionId = randomUUID();
    const topic = memoirOpeningTopics[input.topicKey];
    await db.query('INSERT INTO memoir_sessions(id,memoir_id,topic_id,topic_key,topic_title,current_question_id) VALUES($1,$2,$3,$4,$5,$6)', [id, memoirId, topicId, input.topicKey, topic.title, questionId]);
    await db.query("INSERT INTO memoir_questions(id,memoir_id,session_id,kind,body) VALUES($1,$2,$3,'opening',$4)", [questionId, memoirId, id, topic.question]);
    await bumpMemoir(db, memoirId); await operation.finish(id);
    return memoirSessionRecord(db, memoirId, id);
  }, client);
}
export function changeMemoirInterview(actorId: string, memoirId: string, sessionId: string, input: InterviewActionInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation } = await prepare(db, actorId, memoirId, input, 'memoir:interview-action', [sessionId, input.action]);
    const session = await memoirSessionRecord(db, memoirId, sessionId);
    if (operation.replayed) return session;
    assertVersion(session.version, input.expectedVersion);
    if (input.action === 'resume') {
      if (session.state !== 'paused' || session.topic.disposition !== 'open' || session.currentQuestionId === null) interviewConflict();
      await db.query("UPDATE memoir_sessions SET state='paused',version=version+1,updated_at=clock_timestamp() WHERE memoir_id=$1 AND state='active'", [memoirId]);
      await db.query("UPDATE memoir_sessions SET state='active',version=version+1,updated_at=clock_timestamp() WHERE id=$1", [sessionId]);
    } else if (input.action === 'pause') {
      if (session.state !== 'active') interviewConflict();
      await db.query("UPDATE memoir_sessions SET state='paused',version=version+1,updated_at=clock_timestamp() WHERE id=$1", [sessionId]);
    } else {
      if (session.state === 'completed') interviewConflict();
      const disposition = input.action === 'refuse' ? 'refused' : input.action === 'skip' ? 'skipped' : 'completed';
      await db.query("UPDATE memoir_sessions SET state='completed',disposition=$2,current_question_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1", [sessionId, disposition]);
    }
    await bumpMemoir(db, memoirId); await operation.finish(sessionId);
    return memoirSessionRecord(db, memoirId, sessionId);
  }, client);
}
async function appendAnswer(db: PoolClient, memoirId: string, answerId: string, text: string) {
  const revision = (await db.query<{ revision: number }>('SELECT COALESCE(max(revision),0)+1 AS revision FROM memoir_answer_revisions WHERE answer_id=$1', [answerId])).rows[0];
  if (!revision) throw new Error('Missing next answer revision.');
  const id = randomUUID();
  await db.query('INSERT INTO memoir_answer_revisions(id,memoir_id,answer_id,revision,body) VALUES($1,$2,$3,$4,$5)', [id, memoirId, answerId, revision.revision, text]);
  await bumpMemoir(db, memoirId, true);
  return id;
}
async function answerRevision(db: PoolClient, memoirId: string, id: string) {
  const row = (await db.query<Record<string, unknown>>(`SELECT ${memoirAnswerColumns} FROM memoir_answer_revisions r JOIN memoir_answers a ON a.id=r.answer_id WHERE r.memoir_id=$1 AND r.id=$2`, [memoirId, id])).rows[0];
  if (!row) notFound();
  return memoirAnswerProjection(row);
}
export function saveMemoirAnswer(actorId: string, memoirId: string, sessionId: string, input: SaveInterviewAnswerInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation } = await prepare(db, actorId, memoirId, input, 'memoir:answer', [sessionId, input.questionId, input.answerId, input.text]);
    const session = await memoirSessionRecord(db, memoirId, sessionId);
    if (operation.replayed && operation.resultId) return answerRevision(db, memoirId, operation.resultId);
    assertVersion(session.version, input.expectedVersion);
    const question = await db.query('SELECT id FROM memoir_questions WHERE memoir_id=$1 AND session_id=$2 AND id=$3', [memoirId, sessionId, input.questionId]);
    if (question.rowCount !== 1) notFound();
    const previous = (await db.query<{ id: string }>('SELECT id FROM memoir_answers WHERE memoir_id=$1 AND question_id=$2', [memoirId, input.questionId])).rows[0];
    if (previous ? previous.id !== input.answerId : input.answerId !== null) invalid('请核对当前回答标识，修订须追加到已有回答。');
    if (!previous && (session.state !== 'active' || session.currentQuestionId !== input.questionId)) interviewConflict();
    const answerId = previous?.id ?? randomUUID();
    if (!previous) await db.query("INSERT INTO memoir_answers(id,memoir_id,session_id,question_id,kind) VALUES($1,$2,$3,$4,'interview')", [answerId, memoirId, sessionId, input.questionId]);
    const id = await appendAnswer(db, memoirId, answerId, input.text);
    await db.query('UPDATE memoir_sessions SET version=version+1,updated_at=clock_timestamp() WHERE id=$1', [sessionId]);
    await operation.finish(id);
    return answerRevision(db, memoirId, id);
  }, client);
}
export function saveMemoirSupplement(actorId: string, memoirId: string, input: SaveMemoirSupplementInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation, current } = await prepare(db, actorId, memoirId, input, 'memoir:supplement', [input.answerId, input.text]);
    if (operation.replayed && operation.resultId) return answerRevision(db, memoirId, operation.resultId);
    assertVersion(current.memoir.version, input.expectedVersion);
    const answerId = input.answerId ?? randomUUID();
    if (input.answerId === null) await db.query("INSERT INTO memoir_answers(id,memoir_id,kind) VALUES($1,$2,'user_supplement')", [answerId, memoirId]);
    else if ((await db.query("SELECT id FROM memoir_answers WHERE memoir_id=$1 AND id=$2 AND kind='user_supplement'", [memoirId, answerId])).rowCount !== 1) notFound();
    const id = await appendAnswer(db, memoirId, answerId, input.text); await operation.finish(id);
    return answerRevision(db, memoirId, id);
  }, client);
}
export function createMemoirChapter(actorId: string, memoirId: string, input: CreateMemoirChapterInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation, current } = await prepare(db, actorId, memoirId, input, 'memoir:chapter-create', [input.title]);
    if (operation.replayed && operation.resultId) return memoirChapterRecord(db, memoirId, operation.resultId);
    assertVersion(current.memoir.version, input.expectedVersion);
    const id = randomUUID();
    await db.query('INSERT INTO memoir_chapters(id,memoir_id,title) VALUES($1,$2,$3)', [id, memoirId, input.title]);
    await bumpMemoir(db, memoirId); await operation.finish(id);
    return memoirChapterRecord(db, memoirId, id);
  }, client);
}
export async function insertMemoirParagraphs(db: PoolClient, memoirId: string, contentId: string, paragraphs: readonly MemoirParagraph[]) {
  for (const [ordinal, paragraph] of paragraphs.entries()) {
    await db.query('INSERT INTO memoir_paragraphs(memoir_id,content_id,ordinal,paragraph_id,body) VALUES($1,$2,$3,$4,$5)', [memoirId, contentId, ordinal, paragraph.id, paragraph.text]);
    for (const source of paragraph.sources) await db.query('INSERT INTO memoir_paragraph_sources(memoir_id,content_id,ordinal,answer_revision_id,start_offset,end_offset) VALUES($1,$2,$3,$4,$5,$6)', [memoirId, contentId, ordinal, source.answerRevisionId, source.start, source.end]);
  }
}
export function saveMemoirChapter(actorId: string, memoirId: string, chapterId: string, input: SaveMemoirChapterInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation, current } = await prepare(db, actorId, memoirId, input, 'memoir:chapter-save', [chapterId, input.expectedSourceVersion, input.title, input.paragraphs, input.derivedFromDraftId]);
    const chapter = await memoirChapterRecord(db, memoirId, chapterId);
    if (operation.replayed) return chapter;
    assertVersion(chapter.version, input.expectedVersion); assertVersion(current.sourceVersion, input.expectedSourceVersion);
    const paragraphs = memoirParagraphsSchema.parse(input.paragraphs);
    const ids = [...new Set(paragraphs.flatMap((p) => p.sources.map((s) => s.answerRevisionId)))];
    const rows = await db.query<Record<string, unknown>>(`SELECT ${memoirAnswerColumns} FROM memoir_answer_revisions r JOIN memoir_answers a ON a.id=r.answer_id
      WHERE r.memoir_id=$1 AND r.id=ANY($2::uuid[]) AND NOT EXISTS(SELECT 1 FROM memoir_answer_revisions newer WHERE newer.answer_id=r.answer_id AND newer.revision>r.revision)`, [memoirId, ids]);
    if (!memoirReferencesAreValid(paragraphs, rows.rows.map(memoirAnswerProjection))) invalid('每段须引用本自传的当前回答版本及有效码点范围；请先保存新增事实为补充资料。');
    if (input.derivedFromDraftId !== null && (await db.query("SELECT id FROM memoir_chapter_contents WHERE id=$1 AND memoir_id=$2 AND chapter_id=$3 AND kind='draft' AND source_version=$4", [input.derivedFromDraftId, memoirId, chapterId, current.sourceVersion])).rowCount !== 1) invalid('所选草稿不属于当前章节或来源已过期。');
    const id = randomUUID();
    await db.query("INSERT INTO memoir_chapter_contents(id,memoir_id,chapter_id,kind,source_version,version,title,derived_from_draft_id) VALUES($1,$2,$3,'revision',$4,$5,$6,$7)", [id, memoirId, chapterId, current.sourceVersion, chapter.version + 1, input.title, input.derivedFromDraftId]);
    await insertMemoirParagraphs(db, memoirId, id, paragraphs);
    await db.query('UPDATE memoir_chapters SET title=$2,current_revision_id=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1', [chapterId, input.title, id]);
    await bumpMemoir(db, memoirId); await operation.finish(id);
    return memoirChapterRecord(db, memoirId, chapterId);
  }, client);
}
export function confirmMemoirChapter(actorId: string, memoirId: string, chapterId: string, input: ConfirmMemoirChapterInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation, current } = await prepare(db, actorId, memoirId, input, 'memoir:chapter-confirm', [chapterId, input.revisionId, input.expectedSourceVersion, input.reviewedSources]);
    const chapter = await memoirChapterRecord(db, memoirId, chapterId);
    if (!operation.replayed) {
      assertVersion(chapter.version, input.expectedVersion); assertVersion(current.sourceVersion, input.expectedSourceVersion);
      if (chapter.currentRevisionId !== input.revisionId || (await db.query("SELECT id FROM memoir_chapter_contents WHERE id=$1 AND memoir_id=$2 AND chapter_id=$3 AND kind='revision' AND source_version=$4", [input.revisionId, memoirId, chapterId, current.sourceVersion])).rowCount !== 1) invalid('只能确认当前章节编辑版和当前回答来源。');
      const id = randomUUID();
      const inserted = await db.query<{ id: string }>('INSERT INTO memoir_confirmations(id,memoir_id,chapter_id,revision_id,source_version,confirmed_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(revision_id,source_version) DO NOTHING RETURNING id', [id, memoirId, chapterId, input.revisionId, current.sourceVersion, actorId]);
      const saved = inserted.rows[0] ?? (await db.query<{ id: string }>('SELECT id FROM memoir_confirmations WHERE revision_id=$1 AND source_version=$2', [input.revisionId, current.sourceVersion])).rows[0];
      if (!saved) throw new Error('Missing confirmation.');
      if (inserted.rowCount === 1) { await bumpChapter(db, chapterId); await bumpMemoir(db, memoirId); }
      await operation.finish(saved.id);
      return memoirConfirmationProjection((await db.query<Record<string, unknown>>(`SELECT ${memoirConfirmationColumns} FROM memoir_confirmations WHERE id=$1`, [saved.id])).rows[0] ?? notFound());
    }
    const row = (await db.query<Record<string, unknown>>(`SELECT ${memoirConfirmationColumns} FROM memoir_confirmations WHERE memoir_id=$1 AND id=$2`, [memoirId, operation.resultId])).rows[0];
    return memoirConfirmationProjection(row ?? notFound());
  }, client);
}
export function grantMemoirPublication(actorId: string, memoirId: string, chapterId: string, input: GrantMemoirPublicationInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation, current } = await prepare(db, actorId, memoirId, input, 'memoir:chapter-publish', [chapterId, input.confirmationId, input.privacyAcknowledged, input.authorizePublicChapter]);
    const chapter = await memoirChapterRecord(db, memoirId, chapterId);
    if (operation.replayed) {
      const row = (await db.query<Record<string, unknown>>(`SELECT ${memoirPublicationColumns} FROM memoir_publications WHERE memoir_id=$1 AND id=$2`, [memoirId, operation.resultId])).rows[0];
      return memoirPublicationProjection(row ?? notFound());
    }
    assertVersion(chapter.version, input.expectedVersion);
    const confirmation = await db.query('SELECT id FROM memoir_confirmations WHERE id=$1 AND memoir_id=$2 AND chapter_id=$3 AND revision_id=$4 AND source_version=$5', [input.confirmationId, memoirId, chapterId, chapter.currentRevisionId, current.sourceVersion]);
    if (confirmation.rowCount !== 1) throw new HttpError({ code: 'MEMOIR_NOT_CONFIRMED', message: '请先核对并确认当前章节和来源，再单独授权公开。' });
    const existing = (await db.query<Record<string, unknown>>(`SELECT ${memoirPublicationColumns} FROM memoir_publications WHERE chapter_id=$1 AND confirmation_id=$2 AND revoked_at IS NULL`, [chapterId, input.confirmationId])).rows[0];
    if (existing) { await operation.finish(String(existing.id)); return memoirPublicationProjection(existing); }
    const raw = (await db.query<Record<string, unknown>>(`SELECT ${memoirContentColumns} FROM memoir_chapter_contents c WHERE c.id=$1 AND c.kind='revision'`, [chapter.currentRevisionId])).rows[0];
    const revision = memoirContentProjection(raw ?? notFound());
    if (!('paragraphs' in revision)) throw new Error('Expected edited revision.');
    const id = randomUUID(); const publishedAt = new Date().toISOString();
    const publicData = publicMemoirChapterSchema.parse({ publicationId: id, chapterId, title: revision.title, paragraphs: revision.paragraphs.map((p) => p.text), publishedAt });
    await db.query('UPDATE memoir_publications SET revoked_at=clock_timestamp() WHERE chapter_id=$1 AND revoked_at IS NULL', [chapterId]);
    await db.query('INSERT INTO memoir_publications(id,memoir_id,chapter_id,confirmed_revision_id,confirmation_id,consent_version,public_data,granted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, memoirId, chapterId, chapter.currentRevisionId, input.confirmationId, chapter.version, JSON.stringify(publicData), publishedAt]);
    await bumpChapter(db, chapterId); await bumpMemoir(db, memoirId); await operation.finish(id);
    return memoirPublicationProjection((await db.query<Record<string, unknown>>(`SELECT ${memoirPublicationColumns} FROM memoir_publications WHERE id=$1`, [id])).rows[0] ?? notFound());
  }, client);
}
export function revokeMemoirPublication(actorId: string, memoirId: string, chapterId: string, input: VersionedOperationInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    const { operation } = await prepare(db, actorId, memoirId, input, 'memoir:chapter-revoke', [chapterId]);
    const chapter = await memoirChapterRecord(db, memoirId, chapterId);
    if (!operation.replayed) {
      assertVersion(chapter.version, input.expectedVersion);
      if ((await db.query('UPDATE memoir_publications SET revoked_at=clock_timestamp() WHERE chapter_id=$1 AND revoked_at IS NULL', [chapterId])).rowCount) {
        await bumpChapter(db, chapterId); await bumpMemoir(db, memoirId);
      }
      await operation.finish(chapterId);
    }
    return memoirChapterRecord(db, memoirId, chapterId);
  }, client);
}
