import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { withTransaction } from '../../src/server/db/pool';
import { createMemoir, deleteMemoir, createMemoirChapter, saveMemoirSupplement, getMemoir, startMemoirInterview, saveMemoirAnswer } from '../../src/server/core/memoirs';
import { requestMemoirAi } from '../../src/server/core/memoir-ai';
import { createDeepSeekAdapter } from '../../src/server/integrations/deepseek';
import { HttpError } from '../../src/server/http';
const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 4 });
before(async () => { await migrate(pool); }); after(async () => { await pool.end(); });
const transaction: typeof import('../../src/server/core/museums').inTransaction = (work) => withTransaction(work, pool);
const environment = { DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: 'test-only' };
test('memoir AI persists draft, replays once, and preserves unknown outcomes without resubmitting', async () => {
  const actor = randomUUID();
  await pool.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [actor, `memoir-ai-${actor}`, 'synthetic', 'member']);
  await pool.query('INSERT INTO direction1_demo_accounts(user_id) VALUES($1)', [actor]);
  const book = await transaction((db) => createMemoir(actor, { operationId: randomUUID(), title: '合成自传', museumId: null }, db));
  try {
    const source = await transaction((db) => saveMemoirSupplement(actor, book.memoir.id, { operationId: randomUUID(), expectedVersion: 1, answerId: null, text: '我记得一只杯子。' }, db));
    const current = await transaction((db) => getMemoir(actor, book.memoir.id, db));
    const chapter = await transaction((db) => createMemoirChapter(actor, book.memoir.id, { operationId: randomUUID(), expectedVersion: current.memoir.version, title: '杯子' }, db));
    const input = { operationId: randomUUID(), expectedVersion: chapter.version, sourceVersion: current.sourceVersion, answerRevisionIds: [source.id], providerTransferConsent: true };
    let calls = 0; const paragraphId = randomUUID();
    const adapter = createDeepSeekAdapter({ environment, newId: () => paragraphId, transport: async () => {
      calls += 1;
      return Response.json({ id: 'provider-1', model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ title: '杯子', paragraphs: [{ id: paragraphId, text: '我记得一只杯子。', sources: [{ answerRevisionId: source.id, start: 0, end: 8 }] }] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    } });
    const dependencies = { transaction, adapter, dailyCallLimit: 20, checkConfig: () => undefined };
    const completed = await requestMemoirAi(actor, book.memoir.id, 'chapter', chapter.id, input, dependencies);
    assert.equal(completed.state, 'succeeded');
    assert.equal(completed.targetId, chapter.id);
    assert.equal((await requestMemoirAi(actor, book.memoir.id, 'chapter', chapter.id, input, dependencies)).state, 'succeeded');
    assert.equal(calls, 1);
    assert.equal((await pool.query("SELECT id FROM memoir_chapter_contents WHERE memoir_id=$1 AND generation='provider'", [book.memoir.id])).rowCount, 1);
    // A user edit while the external call is in flight makes the result obsolete.
    const staleAdapter = createDeepSeekAdapter({ environment, newId: () => paragraphId, transport: async () => {
      const latest = await transaction((db) => getMemoir(actor, book.memoir.id, db));
      await transaction((db) => saveMemoirSupplement(actor, book.memoir.id, { operationId: randomUUID(), expectedVersion: latest.memoir.version, answerId: null, text: '后来补充的合成资料。' }, db));
      return Response.json({ id: 'provider-stale', model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ title: '杯子', paragraphs: [{ id: paragraphId, text: '一只杯子。', sources: [{ answerRevisionId: source.id, start: 0, end: 8 }] }] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    } });
    assert.equal((await requestMemoirAi(actor, book.memoir.id, 'chapter', chapter.id, { ...input, operationId: randomUUID() }, { ...dependencies, adapter: staleAdapter })).state, 'superseded');
    input.sourceVersion = (await transaction((db) => getMemoir(actor, book.memoir.id, db))).sourceVersion;
    const beforeInterview = await transaction((db) => getMemoir(actor, book.memoir.id, db));
    const session = await transaction((db) => startMemoirInterview(actor, book.memoir.id, { operationId: randomUUID(), expectedVersion: beforeInterview.memoir.version, topicKey: 'childhood' }, db));
    assert.ok(session.currentQuestionId);
    const questionId = session.currentQuestionId;
    const answer = await transaction((db) => saveMemoirAnswer(actor, book.memoir.id, session.id, { operationId: randomUUID(), expectedVersion: session.version, questionId, answerId: null, text: '童年窗前有一棵树。' }, db));
    const afterAnswer = await transaction((db) => getMemoir(actor, book.memoir.id, db));
    const followupAdapter = createDeepSeekAdapter({ environment, transport: async () => Response.json({ id: 'followup-1', model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ question: { text: '你记得那棵树的什么细节？', basedOnAnswerRevisionIds: [answer.id] } }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) });
    assert.equal((await requestMemoirAi(actor, book.memoir.id, 'followup', session.id, { operationId: randomUUID(), expectedVersion: session.version + 1, sourceVersion: afterAnswer.sourceVersion, answerRevisionIds: [answer.id], providerTransferConsent: true }, { ...dependencies, adapter: followupAdapter })).state, 'succeeded');
    assert.equal((await pool.query("SELECT id FROM memoir_questions WHERE session_id=$1 AND kind='followup'", [session.id])).rowCount, 1);
    input.sourceVersion = afterAnswer.sourceVersion;
    const unknownInput = { ...input, operationId: randomUUID() };
    const uncertain = createDeepSeekAdapter({ environment, timeoutMs: 5, transport: async (_url, options) => { calls += 1; return new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('timed out')), { once: true }); }); } });
    await assert.rejects(requestMemoirAi(actor, book.memoir.id, 'chapter', chapter.id, unknownInput, { ...dependencies, adapter: uncertain }));
    assert.equal((await requestMemoirAi(actor, book.memoir.id, 'chapter', chapter.id, unknownInput, dependencies)).state, 'unknown');
    await assert.rejects(requestMemoirAi(actor, book.memoir.id, 'chapter', chapter.id, { ...input, operationId: randomUUID() }, dependencies), (error: unknown) => error instanceof HttpError && error.failure.code === 'AI_OUTCOME_UNKNOWN');
    assert.equal(calls, 2);
    const usage = await pool.query<{ call_count: number }>('SELECT call_count FROM memoir_ai_daily_usage WHERE owner_id=$1', [actor]);
    assert.equal(usage.rows[0]?.call_count, 4, 'replays and blocked requests do not consume another budget reservation');
    const beforeDelete = await transaction((db) => getMemoir(actor, book.memoir.id, db));
    await transaction((db) => deleteMemoir(actor, book.memoir.id, { operationId: randomUUID(), expectedVersion: beforeDelete.memoir.version, confirmOnlineDeletion: true }, db));
    const replacement = await transaction((db) => createMemoir(actor, { operationId: randomUUID(), title: '新建合成自传', museumId: null }, db));
    try {
      const replacementSource = await transaction((db) => saveMemoirSupplement(actor, replacement.memoir.id, { operationId: randomUUID(), expectedVersion: 1, answerId: null, text: '新的虚构资料。' }, db));
      const replacementCurrent = await transaction((db) => getMemoir(actor, replacement.memoir.id, db));
      const replacementChapter = await transaction((db) => createMemoirChapter(actor, replacement.memoir.id, { operationId: randomUUID(), expectedVersion: replacementCurrent.memoir.version, title: '新的章节' }, db));
      await assert.rejects(requestMemoirAi(actor, replacement.memoir.id, 'chapter', replacementChapter.id, { ...input, operationId: randomUUID(), expectedVersion: replacementChapter.version, sourceVersion: replacementCurrent.sourceVersion, answerRevisionIds: [replacementSource.id] }, { ...dependencies, dailyCallLimit: 4 }),
        (error: unknown) => error instanceof HttpError && error.failure.code === 'AI_UNAVAILABLE');
      assert.equal(calls, 2, 'deleting a memoir does not allow another paid submission');
      assert.equal((await pool.query('SELECT id FROM memoir_ai_operations WHERE memoir_id=$1', [replacement.memoir.id])).rowCount, 0);
    } finally {
      await pool.query('DELETE FROM memoirs WHERE id=$1', [replacement.memoir.id]);
    }
  } finally {
    await pool.query('DELETE FROM memoirs WHERE id=$1', [book.memoir.id]);
    await pool.query('DELETE FROM memoir_deletions WHERE owner_id=$1', [actor]);
    await pool.query('DELETE FROM memoir_ai_daily_usage WHERE owner_id=$1', [actor]);
    await pool.query('DELETE FROM direction1_write_receipts WHERE actor_id=$1', [actor]);
    await pool.query('DELETE FROM direction1_demo_accounts WHERE user_id=$1', [actor]);
    await pool.query('DELETE FROM team_members WHERE id=$1', [actor]);
  }
});
