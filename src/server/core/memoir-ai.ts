import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { requestMemoirAiInputSchema, memoirAiInputSchema, memoirAiOperationSchema, memoirFollowupContextSchema } from '../../contracts';
import { createDeepSeekAdapter, DeepSeekCallError, readDeepSeekConfig } from '../integrations/deepseek';
import { HttpError } from '../http';
import { inTransaction } from './museums';
import { lockDirection1Actor, requireDemoAccount } from './direction1';
import { assertVersion, invalid, notFound } from './records';
import { memoirRecord, memoirChapterRecord, memoirSessionRecord, memoirAnswerColumns, memoirAnswerProjection, memoirDates } from './memoir-records';
import { insertMemoirParagraphs } from './memoirs';

export const memoirAiColumns = `id,memoir_id AS "memoirId",kind,target_id AS "targetId",source_version AS "sourceVersion",state,generation,created_at AS "createdAt",updated_at AS "updatedAt"`;
async function operation(db: PoolClient, memoirId: string, id: string) {
  const row = (await db.query<Record<string, unknown>>(`SELECT ${memoirAiColumns} FROM memoir_ai_operations WHERE memoir_id=$1 AND id=$2`, [memoirId, id])).rows[0];
  if (!row) notFound();
  return memoirAiOperationSchema.parse(memoirDates(row));
}
export function getMemoirAiOperation(actorId: string, memoirId: string, id: string) {
  return inTransaction(async (db) => {
    await requireDemoAccount(db, actorId); await memoirRecord(db, actorId, memoirId);
    // A crashed sender cannot be retried safely; the provider has no query-by-client-id API.
    await db.query("UPDATE memoir_ai_operations SET state='unknown',updated_at=clock_timestamp() WHERE memoir_id=$1 AND id=$2 AND state='sending' AND updated_at<clock_timestamp()-interval '2 minutes'", [memoirId, id]);
    return operation(db, memoirId, id);
  });
}
export async function requestMemoirAi(actorId: string, memoirId: string, kind: 'chapter' | 'followup', targetId: string, rawInput: unknown, dependencies: { transaction?: typeof inTransaction; adapter?: ReturnType<typeof createDeepSeekAdapter>; checkConfig?: () => unknown; dailyCallLimit?: number } = {}) {
  const transaction = dependencies.transaction ?? inTransaction;
  const input = requestMemoirAiInputSchema.parse(rawInput);
  const hash = createHash('sha256').update(JSON.stringify([memoirId, kind, targetId, input])).digest('hex');
  const prepared = await transaction(async (db) => {
    await requireDemoAccount(db, actorId); await lockDirection1Actor(db, actorId);
    const current = await memoirRecord(db, actorId, memoirId, true);
    await db.query("UPDATE memoir_ai_operations SET state='unknown',updated_at=clock_timestamp() WHERE memoir_id=$1 AND state='sending' AND updated_at<clock_timestamp()-interval '2 minutes'", [memoirId]);
    const previous = (await db.query<{ request_hash: string; memoir_id: string }>('SELECT request_hash,memoir_id FROM memoir_ai_operations WHERE id=$1', [input.operationId])).rows[0];
    if (previous) {
      if (previous.memoir_id !== memoirId || previous.request_hash !== hash) throw new HttpError({ code: 'IDEMPOTENCY_CONFLICT', message: '操作标识已用于其他请求。' });
      return { replay: await operation(db, memoirId, input.operationId) };
    }
    const pending = await db.query("SELECT id FROM memoir_ai_operations WHERE memoir_id=$1 AND kind=$2 AND target_id=$3 AND state IN ('sending','unknown')", [memoirId, kind, targetId]);
    if (pending.rowCount) throw new HttpError({ code: 'AI_OUTCOME_UNKNOWN', message: '已有请求正在处理或结果不明，请先核对状态，不会重复提交。' });
    assertVersion(current.sourceVersion, input.sourceVersion);
    const target = kind === 'chapter' ? await memoirChapterRecord(db, memoirId, targetId) : await memoirSessionRecord(db, memoirId, targetId);
    assertVersion(target.version, input.expectedVersion);
    const rows = await db.query<Record<string, unknown>>(`SELECT ${memoirAnswerColumns} FROM memoir_answer_revisions r JOIN memoir_answers a ON a.id=r.answer_id WHERE r.memoir_id=$1 AND r.id=ANY($2::uuid[]) AND NOT EXISTS(SELECT 1 FROM memoir_answer_revisions newer WHERE newer.answer_id=r.answer_id AND newer.revision>r.revision) ORDER BY r.id`, [memoirId, input.answerRevisionIds]);
    if (rows.rows.length !== input.answerRevisionIds.length) invalid('请选择本自传的当前回答版本。');
    const sources = memoirAiInputSchema.parse({ memoirId, sourceVersion: input.sourceVersion, sources: rows.rows.map(memoirAnswerProjection) });
    let context;
    if (kind === 'followup') {
      const session = await memoirSessionRecord(db, memoirId, targetId);
      if (session.state !== 'active' || session.topic.disposition !== 'open' || !session.currentQuestionId) invalid('请先恢复可继续的访谈。');
      if (!sources.sources.some((source) => source.questionId === session.currentQuestionId)) invalid('请先保存当前问题的回答并选为来源。');
      const questions = (await db.query<{ id: string; body: string }>('SELECT id,body FROM memoir_questions WHERE session_id=$1 ORDER BY created_at,id', [targetId])).rows;
      const question = questions.find((value) => value.id === session.currentQuestionId);
      if (!question) notFound();
      context = memoirFollowupContextSchema.parse({ topicTitle: session.topic.title, currentQuestionText: question.body, answeredQuestionTexts: questions.map((value) => value.body) });
    }
    (dependencies.checkConfig ?? readDeepSeekConfig)();
    const limit = dependencies.dailyCallLimit ?? Number(process.env.MEMOIR_AI_DAILY_CALL_LIMIT);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new HttpError({ code: 'AI_UNAVAILABLE', message: '自传 AI 日调用预算尚未配置，请联系维护者；已有资料仍可人工编辑。' });
    // Usage survives memoir deletion; reserve it atomically with the operation before sending.
    const reserved = await db.query(`INSERT INTO memoir_ai_daily_usage(owner_id,usage_date,call_count)
      VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,1)
      ON CONFLICT(owner_id,usage_date) DO UPDATE SET call_count=memoir_ai_daily_usage.call_count+1
      WHERE memoir_ai_daily_usage.call_count<$2 RETURNING call_count`, [actorId, limit]);
    if (!reserved.rowCount) throw new HttpError({ code: 'AI_UNAVAILABLE', message: '今日自传 AI 调用预算已用完，已有资料仍可查看、编辑与导出。' });
    await db.query("INSERT INTO memoir_ai_operations(id,memoir_id,kind,target_id,request_hash,source_version,state) VALUES($1,$2,$3,$4,$5,$6,'sending')", [input.operationId, memoirId, kind, targetId, hash, input.sourceVersion]);
    return { sources, context };
  });
  if ('replay' in prepared) return prepared.replay;
  const adapter = dependencies.adapter ?? createDeepSeekAdapter();
  try {
    const result = kind === 'chapter' ? { kind: 'chapter' as const, ...await adapter.chapter(prepared.sources) }
      : { kind: 'followup' as const, ...await adapter.followup(prepared.sources, memoirFollowupContextSchema.parse(prepared.context)) };
    return await transaction(async (db) => {
      await requireDemoAccount(db, actorId); await lockDirection1Actor(db, actorId);
      const current = await memoirRecord(db, actorId, memoirId, true);
      const target = kind === 'chapter' ? await memoirChapterRecord(db, memoirId, targetId) : await memoirSessionRecord(db, memoirId, targetId);
      if (current.sourceVersion !== input.sourceVersion || target.version !== input.expectedVersion) {
        await db.query("UPDATE memoir_ai_operations SET state='superseded',provider_request_id=$2,actual_model=$3,token_usage=$4,updated_at=clock_timestamp() WHERE id=$1", [input.operationId, result.providerRequestId, result.model, JSON.stringify(result.usage)]);
        return operation(db, memoirId, input.operationId);
      }
      if (result.kind === 'chapter') {
        const id = randomUUID();
        await db.query("INSERT INTO memoir_chapter_contents(id,memoir_id,chapter_id,kind,source_version,title,generation,ai_operation_id) VALUES($1,$2,$3,'draft',$4,$5,'provider',$6)", [id, memoirId, targetId, input.sourceVersion, result.output.title, input.operationId]);
        await insertMemoirParagraphs(db, memoirId, id, result.output.paragraphs);
      } else if (result.output.question) {
        const id = randomUUID(); const question = result.output.question;
        await db.query("INSERT INTO memoir_questions(id,memoir_id,session_id,kind,body) VALUES($1,$2,$3,'followup',$4)", [id, memoirId, targetId, question.text]);
        for (const sourceId of question.basedOnAnswerRevisionIds) await db.query('INSERT INTO memoir_question_sources(memoir_id,question_id,answer_revision_id) VALUES($1,$2,$3)', [memoirId, id, sourceId]);
        await db.query('UPDATE memoir_sessions SET current_question_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1', [targetId, id]);
      }
      await db.query('UPDATE memoirs SET version=version+1,updated_at=clock_timestamp() WHERE id=$1', [memoirId]);
      await db.query("UPDATE memoir_ai_operations SET state='succeeded',provider_request_id=$2,actual_model=$3,token_usage=$4,updated_at=clock_timestamp() WHERE id=$1", [input.operationId, result.providerRequestId, result.model, JSON.stringify(result.usage)]);
      return operation(db, memoirId, input.operationId);
    });
  } catch (error) {
    // Transport ambiguity and local failures after a provider response must never trigger a second paid call.
    const state = error instanceof DeepSeekCallError && error.outcome !== 'unknown' ? 'failed' : 'unknown';
    await transaction(async (db) => { await db.query("UPDATE memoir_ai_operations SET state=$2,updated_at=clock_timestamp() WHERE id=$1 AND state='sending'", [input.operationId, state]); });
    throw error;
  }
}
