import { memoirAiColumns } from './memoir-ai';
import { memoirAiOperationSchema } from '../../contracts';
import type { PoolClient } from 'pg';
import {
  interviewSessionSchema, memoirChapterSchema, memoirPageInputSchema, memoirPageSchema, onlineMemoirSchema,
  publicMemoirChapterSchema, memoirExportSchema, type MemoirPageInput, type MemoirExport,
} from '../../contracts';
import { lockDirection1Actor, requireDemoAccount } from './direction1';
import { discoveryRecord } from './discovery';
import { inTransaction } from './museums';
import {
  memoirRecord, memoirProjection, memoirColumns, memoirSessionRecord, memoirSessionColumns, memoirQuestionColumns, memoirQuestionProjection,
  memoirAnswerColumns, memoirAnswerProjection, memoirChapterColumns, memoirChapterRecord,
  memoirContentColumns, memoirContentProjection, memoirConfirmationColumns, memoirConfirmationProjection,
  memoirPublicationColumns, memoirPublicationProjection, memoirDates,
} from './memoir-records';

function page<T>(items: T[], rows: Record<string, unknown>[], input: MemoirPageInput) {
  return { items: items.slice(0, input.limit), nextCursor: rows.length > input.limit ? String(rows[input.limit - 1]?.id) : null };
}
export function listMemoirs(actorId: string, rawInput: MemoirPageInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); const input = memoirPageInputSchema.parse(rawInput);
    const rows = (await db.query<Record<string, unknown>>(`SELECT ${memoirColumns} FROM memoirs WHERE owner_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`, [actorId, input.cursor, input.limit + 1])).rows;
    return memoirPageSchema(onlineMemoirSchema).parse(page(rows.map(memoirProjection), rows, input));
  }, client);
}
export function getMemoirSession(actorId: string, memoirId: string, sessionId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId); return memoirSessionRecord(db, memoirId, sessionId); }, client);
}
export function getMemoirChapter(actorId: string, memoirId: string, chapterId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId); return memoirChapterRecord(db, memoirId, chapterId); }, client);
}
export function listMemoirSessions(actorId: string, memoirId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId);
    return (await db.query<Record<string, unknown>>(`SELECT ${memoirSessionColumns} FROM memoir_sessions WHERE memoir_id=$1 ORDER BY created_at,id`, [memoirId])).rows.map((row) => interviewSessionSchema.parse(memoirDates(row)));
  }, client);
}
export function listMemoirQuestions(actorId: string, memoirId: string, sessionId: string, rawInput: MemoirPageInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId); await memoirSessionRecord(db, memoirId, sessionId);
    const input = memoirPageInputSchema.parse(rawInput);
    const rows = (await db.query<Record<string, unknown>>(`SELECT ${memoirQuestionColumns} FROM memoir_questions q JOIN memoir_sessions s ON s.id=q.session_id
      WHERE q.memoir_id=$1 AND q.session_id=$2 AND ($3::uuid IS NULL OR q.id>$3) ORDER BY q.id LIMIT $4`, [memoirId, sessionId, input.cursor, input.limit + 1])).rows;
    return page(rows.map(memoirQuestionProjection), rows, input);
  }, client);
}
export function listMemoirAnswers(actorId: string, memoirId: string, rawInput: MemoirPageInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId); const input = memoirPageInputSchema.parse(rawInput);
    const rows = (await db.query<Record<string, unknown>>(`SELECT ${memoirAnswerColumns} FROM memoir_answer_revisions r JOIN memoir_answers a ON a.id=r.answer_id
      WHERE r.memoir_id=$1 AND ($2::uuid IS NULL OR r.id>$2) ORDER BY r.id LIMIT $3`, [memoirId, input.cursor, input.limit + 1])).rows;
    return page(rows.map(memoirAnswerProjection), rows, input);
  }, client);
}
export function listMemoirChapters(actorId: string, memoirId: string, rawInput: MemoirPageInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId); const input = memoirPageInputSchema.parse(rawInput);
    const rows = (await db.query<Record<string, unknown>>(`SELECT ${memoirChapterColumns} FROM memoir_chapters WHERE memoir_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`, [memoirId, input.cursor, input.limit + 1])).rows;
    return memoirPageSchema(memoirChapterSchema).parse(page(rows.map((row) => memoirChapterSchema.parse(memoirDates(row))), rows, input));
  }, client);
}
export function listMemoirChapterHistory(actorId: string, memoirId: string, chapterId: string, kind: 'draft' | 'revision' | 'confirmation' | 'publication', rawInput: MemoirPageInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId); await memoirChapterRecord(db, memoirId, chapterId);
    const input = memoirPageInputSchema.parse(rawInput);
    const query = kind === 'confirmation' ? `SELECT ${memoirConfirmationColumns} FROM memoir_confirmations WHERE memoir_id=$1 AND chapter_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4`
      : kind === 'publication' ? `SELECT ${memoirPublicationColumns} FROM memoir_publications WHERE memoir_id=$1 AND chapter_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4`
        : `SELECT ${memoirContentColumns} FROM memoir_chapter_contents c WHERE c.memoir_id=$1 AND c.chapter_id=$2 AND ($3::uuid IS NULL OR c.id>$3) AND c.kind=$5 ORDER BY c.id LIMIT $4`;
    const rows = (await db.query<Record<string, unknown>>(query, [memoirId, chapterId, input.cursor, input.limit + 1, ...(kind === 'draft' || kind === 'revision' ? [kind] : [])])).rows;
    const items = rows.map((row) => kind === 'confirmation' ? memoirConfirmationProjection(row) : kind === 'publication' ? memoirPublicationProjection(row) : memoirContentProjection(row));
    return page(items, rows, input);
  }, client);
}
export function readDiscoveryMemoirChapters(actorId: string, museumId: string, accessEpoch: string, rawInput: MemoirPageInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await discoveryRecord(db, museumId, accessEpoch, true);
    const input = memoirPageInputSchema.parse(rawInput);
    const rows = (await db.query<Record<string, unknown>>(`SELECT p.id,p.public_data AS "publicData" FROM memoir_publications p JOIN memoirs b ON b.id=p.memoir_id
      JOIN museums m ON m.id=b.museum_id AND m.created_by=b.owner_id WHERE m.id=$1 AND p.revoked_at IS NULL AND ($2::uuid IS NULL OR p.id>$2) ORDER BY p.id LIMIT $3`, [museumId, input.cursor, input.limit + 1])).rows;
    return memoirPageSchema(publicMemoirChapterSchema).parse(page(rows.map((row) => publicMemoirChapterSchema.parse(row.publicData)), rows, input));
  }, client);
}

export function exportMemoir(actorId: string, memoirId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId);
    // All memoir mutations take this same lock, keeping this multi-query export consistent.
    await lockDirection1Actor(db, actorId);
    const online = await memoirRecord(db, actorId, memoirId);
    const query = async (sql: string) => (await db.query<Record<string, unknown>>(sql, [memoirId])).rows;
    const sessions = (await query(`SELECT ${memoirSessionColumns} FROM memoir_sessions WHERE memoir_id=$1 ORDER BY created_at,id`)).map((row) => interviewSessionSchema.parse(memoirDates(row)));
    const questions = (await query(`SELECT ${memoirQuestionColumns} FROM memoir_questions q JOIN memoir_sessions s ON s.id=q.session_id WHERE q.memoir_id=$1 ORDER BY q.created_at,q.id`)).map(memoirQuestionProjection);
    const answers = (await query(`SELECT ${memoirAnswerColumns} FROM memoir_answer_revisions r JOIN memoir_answers a ON a.id=r.answer_id WHERE r.memoir_id=$1 ORDER BY r.created_at,r.id`)).map(memoirAnswerProjection);
    const chapters = (await query(`SELECT ${memoirChapterColumns} FROM memoir_chapters WHERE memoir_id=$1 ORDER BY created_at,id`)).map((row) => memoirChapterSchema.parse(memoirDates(row)));
    const contents = (await query(`SELECT ${memoirContentColumns} FROM memoir_chapter_contents c WHERE c.memoir_id=$1 ORDER BY c.created_at,c.id`)).map(memoirContentProjection);
    const confirmations = (await query(`SELECT ${memoirConfirmationColumns} FROM memoir_confirmations WHERE memoir_id=$1 ORDER BY confirmed_at,id`)).map(memoirConfirmationProjection);
    const publications = (await query(`SELECT ${memoirPublicationColumns} FROM memoir_publications WHERE memoir_id=$1 ORDER BY granted_at,id`)).map(memoirPublicationProjection);
    return memoirExportSchema.parse({ formatVersion: 1, provenance: 'synthetic_online_demo', exportedAt: new Date().toISOString(), ...online, sessions, questions, answers, chapters,
      drafts: contents.filter((content) => 'output' in content), revisions: contents.filter((content) => 'paragraphs' in content), confirmations, publications, aiOperations: (await query(`SELECT ${memoirAiColumns} FROM memoir_ai_operations WHERE memoir_id=$1 ORDER BY created_at,id`)).map((row) => memoirAiOperationSchema.parse(memoirDates(row))) });
  }, client);
}
function literal(text: string) {
  const longest = Math.max(0, ...(text.match(/~+/gu) ?? []).map((run) => run.length));
  const fence = '~'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}
export function memoirExportMarkdown(data: MemoirExport): string {
  const document = memoirExportSchema.parse(data);
  const lines = ['# 拾物馆自传导出', '合成资料在线 DEMO。原始回答、AI 草稿、编辑、确认和公开许可分别列出。',
    `自传 ${document.memoir.id}；来源版本 ${document.sourceVersion}；导出 ${document.exportedAt}`, literal(document.memoir.title)];
  lines.push('## 访谈和问题', literal(JSON.stringify({ sessions: document.sessions, questions: document.questions }, null, 2)));
  for (const answer of document.answers) lines.push(`## 回答 ${answer.answerId} · 修订 ${answer.revision}`, `来源版本标识：${answer.id}；类别：${answer.kind}`, literal(answer.text));
  for (const draft of document.drafts) lines.push(`## 草稿 ${draft.id} · ${draft.generation}`, literal(JSON.stringify(draft, null, 2)));
  for (const revision of document.revisions) lines.push(`## 用户编辑 ${revision.id}`, literal(revision.title), ...revision.paragraphs.flatMap((p) => [literal(p.text), literal(JSON.stringify(p.sources))]));
  lines.push('## 章节、确认与公开许可', literal(JSON.stringify({ chapters: document.chapters, confirmations: document.confirmations, publications: document.publications }, null, 2)));
  lines.push('## AI 操作', literal(JSON.stringify(document.aiOperations, null, 2)));
  return `${lines.join('\n\n')}\n`;
}
