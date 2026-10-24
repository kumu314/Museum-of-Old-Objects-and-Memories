import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { migrate } from '../../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { withTransaction } from '../../src/server/db/pool';
import { HttpError } from '../../src/server/http';
import { memoirExportSchema } from '../../src/contracts';
import { createMuseum, createExhibit, confirmExhibit, getMuseum } from '../../src/server/core/museums';
import { publishMuseum } from '../../src/server/core/sharing';
import { getMuseumAccess, updateMuseumAccess, updatePublicProfile } from '../../src/server/core/discovery';
import { createMemoir, getMemoir, deleteMemoir, startMemoirInterview, changeMemoirInterview, saveMemoirAnswer, saveMemoirSupplement,
  createMemoirChapter, saveMemoirChapter, confirmMemoirChapter, grantMemoirPublication, revokeMemoirPublication, insertMemoirParagraphs } from '../../src/server/core/memoirs';
import { listMemoirs, listMemoirSessions, getMemoirSession, getMemoirChapter, listMemoirAnswers, listMemoirChapters,
  listMemoirQuestions, listMemoirChapterHistory, exportMemoir, memoirExportMarkdown, readDiscoveryMemoirChapters } from '../../src/server/core/memoir-queries';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 4 });
before(async () => { await migrate(pool); }); after(async () => { await pool.end(); });
const hasCode = (code: string) => (error: unknown) => error instanceof HttpError && error.failure.code === code;
const operation = (expectedVersion: number) => ({ operationId: randomUUID(), expectedVersion });
const page = { cursor: null, limit: 100 };
async function account(db: PoolClient, demo = true) {
  const id = randomUUID();
  await db.query('INSERT INTO team_members(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [id, `memoir-test-${id}`, 'synthetic-only', 'member']);
  if (demo) await db.query('INSERT INTO direction1_demo_accounts(user_id) VALUES($1)', [id]);
  return id;
}
async function fixture(work: (db: PoolClient, actor: string) => Promise<void>) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); await work(db, await account(db)); }
  finally { await db.query('ROLLBACK'); db.release(); }
}
async function book(db: PoolClient, actor: string, museumId: string | null = null) {
  return createMemoir(actor, { operationId: randomUUID(), title: '合成资料 DEMO 自传', museumId }, db);
}
async function source(db: PoolClient, actor: string, memoirId: string, text = '  可能是那一年。\n我记得一只杯子😀。  ') {
  const current = await getMemoir(actor, memoirId, db);
  return saveMemoirSupplement(actor, memoirId, { ...operation(current.memoir.version), answerId: null, text }, db);
}
function paragraphs(id: string, text = '我记得一只杯子。') {
  return [{ id: randomUUID(), text, sources: [{ answerRevisionId: id, start: 0, end: 1 }] }];
}
async function edited(db: PoolClient, actor: string, memoirId: string, answerRevisionId: string) {
  const current = await getMemoir(actor, memoirId, db);
  const chapter = await createMemoirChapter(actor, memoirId, { ...operation(current.memoir.version), title: 'DEMO 第一章' }, db);
  return saveMemoirChapter(actor, memoirId, chapter.id, { ...operation(chapter.version), expectedSourceVersion: current.sourceVersion,
    title: chapter.title, paragraphs: paragraphs(answerRevisionId), derivedFromDraftId: null }, db);
}
async function confirmed(db: PoolClient, actor: string, memoirId: string, chapterId: string) {
  const chapter = await getMemoirChapter(actor, memoirId, chapterId, db); assert.ok(chapter.currentRevisionId);
  return confirmMemoirChapter(actor, memoirId, chapterId, { ...operation(chapter.version), revisionId: chapter.currentRevisionId,
    expectedSourceVersion: (await getMemoir(actor, memoirId, db)).sourceVersion, reviewedSources: true }, db);
}
async function permitted(db: PoolClient, actor: string, memoirId: string, chapterId: string, confirmationId: string) {
  return grantMemoirPublication(actor, memoirId, chapterId, { ...operation((await getMemoirChapter(actor, memoirId, chapterId, db)).version),
    confirmationId, privacyAcknowledged: true, authorizePublicChapter: true }, db);
}

test('在线自传仅服务端登记的演示账号可用；所有私有读写及关联馆检查真实归属', async () => {
  await fixture(async (db, actor) => {
    const stranger = await account(db); const real = await account(db, false);
    await assert.rejects(book(db, real), hasCode('DEMO_ONLY'));
    const museum = await createMuseum(stranger, { title: '他人的馆', description: '' }, db);
    await assert.rejects(book(db, actor, museum.id), hasCode('NOT_FOUND'));
    const current = await book(db, actor); const id = current.memoir.id;
    assert.equal((await listMemoirs(stranger, page, db)).items.length, 0);
    for (const read of [() => getMemoir(stranger, id, db), () => listMemoirSessions(stranger, id, db), () => listMemoirAnswers(stranger, id, page, db),
      () => listMemoirChapters(stranger, id, page, db), () => exportMemoir(stranger, id, db)]) await assert.rejects(read, hasCode('NOT_FOUND'));
    await assert.rejects(saveMemoirSupplement(stranger, id, { ...operation(1), answerId: null, text: '越权' }, db), hasCode('NOT_FOUND'));
    await assert.rejects(deleteMemoir(stranger, id, { ...operation(1), confirmOnlineDeletion: true }, db), hasCode('NOT_FOUND'));
  });
});

test('回答保留原文并追加修订；重复请求只写一次，冲突、跨会话与外部修改被拒绝', async () => {
  await fixture(async (db, actor) => {
    const current = await book(db, actor); const id = current.memoir.id;
    const session = await startMemoirInterview(actor, id, { ...operation(1), topicKey: 'childhood' }, db); assert.ok(session.currentQuestionId);
    const input = { ...operation(session.version), questionId: session.currentQuestionId, answerId: null, text: '  我不确定\n😀~~~  ' };
    const first = await saveMemoirAnswer(actor, id, session.id, input, db);
    assert.equal(first.text, input.text);
    assert.deepEqual(await saveMemoirAnswer(actor, id, session.id, input, db), first);
    await assert.rejects(saveMemoirAnswer(actor, id, session.id, { ...input, text: '不同请求' }, db), hasCode('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(saveMemoirAnswer(actor, id, session.id, { ...input, operationId: randomUUID() }, db), hasCode('VERSION_CONFLICT'));
    const saved = await getMemoirSession(actor, id, session.id, db);
    const second = await saveMemoirAnswer(actor, id, session.id, { ...operation(saved.version), questionId: input.questionId, answerId: first.answerId, text: '仍然记不清。' }, db);
    assert.equal(second.revision, 2); assert.notEqual(first.id, second.id);
    const answers = await listMemoirAnswers(actor, id, page, db);
    assert.equal(answers.items.length, 2); assert.equal(answers.items.find((r) => r.id === first.id)?.text, input.text);
    assert.equal((await getMemoir(actor, id, db)).sourceVersion, 3);
    const next = await startMemoirInterview(actor, id, { ...operation((await getMemoir(actor, id, db)).memoir.version), topicKey: 'school' }, db);
    await assert.rejects(saveMemoirAnswer(actor, id, next.id, { ...operation(next.version), questionId: input.questionId, answerId: first.answerId, text: '跨会话' }, db), hasCode('NOT_FOUND'));
    const questions = await listMemoirQuestions(actor, id, session.id, page, db); assert.equal(questions.items[0]?.kind, 'opening');
    await db.query('SAVEPOINT immutable_answer');
    await assert.rejects(db.query('UPDATE memoir_answer_revisions SET body=$1 WHERE id=$2', ['覆盖原文', first.id]), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT immutable_answer');
    assert.equal((await exportMemoir(actor, id, db)).answers[0]?.text, input.text);
  });
});

test('切题暂停原会话；暂停、刷新、恢复不会另建问题，拒绝不可重排且历史回答仍可修订', async () => {
  await fixture(async (db, actor) => {
    const current = await book(db, actor); const id = current.memoir.id;
    let session = await startMemoirInterview(actor, id, { ...operation(1), topicKey: 'work' }, db); assert.ok(session.currentQuestionId);
    const answer = await saveMemoirAnswer(actor, id, session.id, { ...operation(session.version), questionId: session.currentQuestionId, answerId: null, text: '我愿意保留这一句。' }, db);
    session = await getMemoirSession(actor, id, session.id, db);
    session = await changeMemoirInterview(actor, id, session.id, { ...operation(session.version), action: 'pause' }, db);
    assert.equal(session.state, 'paused');
    const sameQuestion = session.currentQuestionId;
    session = await changeMemoirInterview(actor, id, session.id, { ...operation(session.version), action: 'resume' }, db);
    assert.equal(session.currentQuestionId, sameQuestion);
    await startMemoirInterview(actor, id, { ...operation((await getMemoir(actor, id, db)).memoir.version), topicKey: 'legacy' }, db);
    session = await getMemoirSession(actor, id, session.id, db); assert.equal(session.state, 'paused');
    session = await changeMemoirInterview(actor, id, session.id, { ...operation(session.version), action: 'refuse' }, db);
    assert.equal(session.topic.disposition, 'refused'); assert.equal(session.currentQuestionId, null);
    await assert.rejects(changeMemoirInterview(actor, id, session.id, { ...operation(session.version), action: 'resume' }, db), hasCode('INTERVIEW_STATE_CONFLICT'));
    await assert.rejects(startMemoirInterview(actor, id, { ...operation((await getMemoir(actor, id, db)).memoir.version), topicKey: 'work' }, db), hasCode('INTERVIEW_STATE_CONFLICT'));
    assert.ok(answer.questionId);
    await saveMemoirAnswer(actor, id, session.id, { ...operation(session.version), questionId: answer.questionId, answerId: answer.answerId, text: '这是我主动修订，仍不继续访谈。' }, db);
    assert.equal((await getMemoirSession(actor, id, session.id, db)).topic.disposition, 'refused');
    assert.equal((await listMemoirQuestions(actor, id, session.id, page, db)).items.length, 1);
  });
});

test('章节校验本书当前来源及码点；来源/编辑变更使旧确认失效，人工操作不依赖 AI 或额度', async () => {
  await fixture(async (db, actor) => {
    const current = await book(db, actor); const id = current.memoir.id;
    const first = await source(db, actor, id, '😀'); const chapter = await edited(db, actor, id, first.id);
    const confirmation = await confirmed(db, actor, id, chapter.id);
    const secondBook = await book(db, actor); const foreign = await source(db, actor, secondBook.memoir.id);
    const update = { ...operation((await getMemoirChapter(actor, id, chapter.id, db)).version), expectedSourceVersion: (await getMemoir(actor, id, db)).sourceVersion,
      title: '新编辑', paragraphs: paragraphs(foreign.id), derivedFromDraftId: null };
    await assert.rejects(saveMemoirChapter(actor, id, chapter.id, update, db), hasCode('VALIDATION_ERROR'));
    await assert.rejects(saveMemoirChapter(actor, id, chapter.id, { ...update, operationId: randomUUID(), paragraphs: [{ id: randomUUID(), text: '越界', sources: [{ answerRevisionId: first.id, start: 0, end: 2 }] }] }, db), hasCode('VALIDATION_ERROR'));
    await db.query('SAVEPOINT invalid_source_range');
    await assert.rejects(db.query('INSERT INTO memoir_paragraph_sources(memoir_id,content_id,ordinal,answer_revision_id,start_offset,end_offset) VALUES($1,$2,0,$3,0,2)', [id, chapter.currentRevisionId, first.id]), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT invalid_source_range');
    await source(db, actor, id, '这是主动增加的来源。');
    await assert.rejects(permitted(db, actor, id, chapter.id, confirmation.id), hasCode('MEMOIR_NOT_CONFIRMED'));
    await assert.rejects(saveMemoirChapter(actor, id, chapter.id, { ...update, paragraphs: paragraphs(first.id) }, db), hasCode('VERSION_CONFLICT'));
    const updated = await saveMemoirChapter(actor, id, chapter.id, { ...update, operationId: randomUUID(), expectedSourceVersion: (await getMemoir(actor, id, db)).sourceVersion, paragraphs: paragraphs(first.id) }, db);
    assert.notEqual(updated.currentRevisionId, confirmation.revisionId);
    const newConfirmation = await confirmed(db, actor, id, chapter.id);
    assert.notEqual(newConfirmation.id, confirmation.id);
    assert.equal((await listMemoirChapterHistory(actor, id, chapter.id, 'revision', page, db)).items.length, 2);
    assert.equal((await listMemoirChapterHistory(actor, id, chapter.id, 'draft', page, db)).items.length, 0);
  });
});

test('在线来源分页无静默截断；JSON/Markdown 分别导出修订、来源、确认和独立公开正文', async () => {
  await fixture(async (db, actor) => {
    const current = await book(db, actor); const id = current.memoir.id;
    const first = await source(db, actor, id, '  # 不是标题\n~~~\n😀原始讲述  ');
    const second = await source(db, actor, id, '第二份主动资料');
    const chapter = await edited(db, actor, id, first.id); const confirmation = await confirmed(db, actor, id, chapter.id);
    await permitted(db, actor, id, chapter.id, confirmation.id);
    const firstPage = await listMemoirAnswers(actor, id, { cursor: null, limit: 1 }, db); assert.ok(firstPage.nextCursor);
    const secondPage = await listMemoirAnswers(actor, id, { cursor: firstPage.nextCursor, limit: 1 }, db);
    assert.equal(secondPage.nextCursor, null); assert.equal(new Set([...firstPage.items, ...secondPage.items].map((a) => a.id)).size, 2);
    const exported = await exportMemoir(actor, id, db);
    assert.equal(exported.answers.length, 2); assert.equal(exported.revisions.length, 1); assert.equal(exported.confirmations.length, 1);
    assert.equal(exported.publications.length, 1); assert.equal(exported.answers.find((a) => a.id === second.id)?.text, second.text);
    assert.ok(memoirExportMarkdown(exported).includes(first.text)); assert.ok(memoirExportMarkdown(exported).includes(first.id));
    assert.ok(memoirExportMarkdown(exported).includes('~~~~text\n'));
    assert.equal(memoirExportSchema.parse(JSON.parse(JSON.stringify(exported))).answers[0]?.text, first.text);
  });
});

test('逐章许可与馆访问分开；编辑不改变已授权正文，撤销/删书后公开入口无残留', async () => {
  await fixture(async (db, actor) => {
    const visitor = await account(db);
    const museum = await createMuseum(actor, { title: 'DEMO 书馆', description: '' }, db);
    const exhibit = await createExhibit(actor, museum.id, { expectedMuseumVersion: museum.version, name: '合成展品', era: '未知', slotIndex: 0, modelKey: 'camera-01', caption: '合成样例。',
      photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '演示', sourceNotice: '测试', rawStory: '不属于自传来源', transcript: null, sourceSegments: [] }, db);
    await confirmExhibit(actor, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '核对演示。' }, db);
    await publishMuseum(actor, museum.id, (await getMuseum(actor, museum.id, db)).version, db);
    const current = await book(db, actor, museum.id); const id = current.memoir.id;
    const answer = await source(db, actor, id, '私密回答哨兵'); const chapter = await edited(db, actor, id, answer.id);
    await updatePublicProfile(actor, { ...operation(1), nickname: '合成书馆主', expectMissing: true }, db);
    let access = await updateMuseumAccess(actor, museum.id, { ...operation((await getMuseum(actor, museum.id, db)).version), accessMode: 'discoverable' }, db); assert.ok(access.accessEpoch);
    const epoch = access.accessEpoch;
    assert.equal((await readDiscoveryMemoirChapters(visitor, museum.id, epoch, page, db)).items.length, 0);
    const confirmation = await confirmed(db, actor, id, chapter.id); const publication = await permitted(db, actor, id, chapter.id, confirmation.id);
    const publicResult = await readDiscoveryMemoirChapters(visitor, museum.id, epoch, page, db);
    assert.deepEqual(publicResult.items, [publication.publicData]);
    for (const forbidden of ['私密回答哨兵', 'answerRevisionId', 'ownerId', 'sourceVersion', 'confirmationId']) assert.equal(JSON.stringify(publicResult).includes(forbidden), false);
    const now = await getMemoirChapter(actor, id, chapter.id, db);
    await saveMemoirChapter(actor, id, chapter.id, { ...operation(now.version), expectedSourceVersion: (await getMemoir(actor, id, db)).sourceVersion, title: '未公开新稿', paragraphs: paragraphs(answer.id, '未公开编辑哨兵'), derivedFromDraftId: null }, db);
    assert.deepEqual((await readDiscoveryMemoirChapters(visitor, museum.id, epoch, page, db)).items, [publication.publicData]);
    await revokeMemoirPublication(actor, id, chapter.id, operation((await getMemoirChapter(actor, id, chapter.id, db)).version), db);
    assert.equal((await readDiscoveryMemoirChapters(visitor, museum.id, epoch, page, db)).items.length, 0);
    const newer = await confirmed(db, actor, id, chapter.id); await permitted(db, actor, id, chapter.id, newer.id);
    access = await updateMuseumAccess(actor, museum.id, { ...operation((await getMuseumAccess(actor, museum.id, db)).version), accessMode: 'private' }, db);
    await assert.rejects(readDiscoveryMemoirChapters(visitor, museum.id, epoch, page, db), hasCode('NOT_FOUND'));
    access = await updateMuseumAccess(actor, museum.id, { ...operation(access.version), accessMode: 'discoverable' }, db); assert.ok(access.accessEpoch);
    const deletion = { ...operation((await getMemoir(actor, id, db)).memoir.version), confirmOnlineDeletion: true as const };
    await deleteMemoir(actor, id, deletion, db); assert.deepEqual(await deleteMemoir(actor, id, deletion, db), { ok: true });
    assert.equal((await readDiscoveryMemoirChapters(visitor, museum.id, access.accessEpoch, page, db)).items.length, 0);
    assert.equal((await getMuseum(actor, museum.id, db)).id, museum.id);
    await assert.rejects(exportMemoir(actor, id, db), hasCode('NOT_FOUND'));
  });
});

test('删除事务清除回答/草稿/编辑/来源/许可；旧创建和保存请求不能复活，墓碑不含正文', async () => {
  await fixture(async (db, actor) => {
    const create = { operationId: randomUUID(), title: '删除哨兵', museumId: null };
    const current = await createMemoir(actor, create, db); const id = current.memoir.id;
    const answer = await source(db, actor, id); const chapter = await edited(db, actor, id, answer.id);
    const session = await startMemoirInterview(actor, id, { ...operation((await getMemoir(actor, id, db)).memoir.version), topicKey: 'legacy' }, db);
    assert.ok(session.currentQuestionId);
    const interviewAnswer = await saveMemoirAnswer(actor, id, session.id, { ...operation(session.version), questionId: session.currentQuestionId, answerId: null, text: '合成访谈回答。' }, db);
    const followupId = randomUUID();
    await db.query("INSERT INTO memoir_questions(id,memoir_id,session_id,kind,body) VALUES($1,$2,$3,'followup','【测试夹具】还有愿意补充的内容吗？')", [followupId, id, session.id]);
    await db.query('INSERT INTO memoir_question_sources(memoir_id,question_id,answer_revision_id) VALUES($1,$2,$3)', [id, followupId, interviewAnswer.id]);
    await db.query('UPDATE memoir_sessions SET current_question_id=$2,version=version+1 WHERE id=$1', [session.id, followupId]);
    const draftId = randomUUID(); const sourceVersion = (await getMemoir(actor, id, db)).sourceVersion;
    await db.query("INSERT INTO memoir_chapter_contents(id,memoir_id,chapter_id,kind,source_version,title,generation) VALUES($1,$2,$3,'draft',$4,'明确 fixture 草稿','fixture')", [draftId, id, chapter.id, sourceVersion]);
    await insertMemoirParagraphs(db, id, draftId, paragraphs(answer.id));
    const derived = await saveMemoirChapter(actor, id, chapter.id, { ...operation(chapter.version), expectedSourceVersion: sourceVersion, title: '采纳并编辑 fixture', paragraphs: paragraphs(answer.id), derivedFromDraftId: draftId }, db);
    const confirmation = await confirmed(db, actor, id, derived.id); await permitted(db, actor, id, derived.id, confirmation.id);
    assert.equal((await exportMemoir(actor, id, db)).drafts[0]?.generation, 'fixture');
    assert.equal((await exportMemoir(actor, id, db)).questions.filter((q) => q.kind === 'followup').length, 1);
    const deletion = { ...operation((await getMemoir(actor, id, db)).memoir.version), confirmOnlineDeletion: true as const };
    await deleteMemoir(actor, id, deletion, db);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    for (const table of ['memoirs','memoir_sessions','memoir_questions','memoir_answers','memoir_answer_revisions','memoir_question_sources',
      'memoir_chapters','memoir_chapter_contents','memoir_paragraphs','memoir_paragraph_sources','memoir_confirmations','memoir_publications']) {
      const key = table === 'memoirs' ? 'id' : 'memoir_id';
      assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${key}=$1`, [id])).rows[0]?.count, 0, table);
    }
    const tombstone = (await db.query<Record<string, unknown>>('SELECT * FROM memoir_deletions WHERE memoir_id=$1', [id])).rows[0];
    assert.deepEqual(Object.keys(tombstone ?? {}).sort(), ['deleted_at','memoir_id','owner_id']);
    await assert.rejects(createMemoir(actor, create, db), hasCode('NOT_FOUND'));
    await assert.rejects(source(db, actor, id), hasCode('NOT_FOUND'));
    await db.query('SAVEPOINT prevent_resurrection');
    await assert.rejects(db.query('INSERT INTO memoirs(id,owner_id,title) VALUES($1,$2,$3)', [id, actor, '复活']), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT prevent_resurrection');
  });
});

test('不同连接同时重放保存只追加一份回答；删除版本冲突不能静默覆盖新写入', async () => {
  const actor = await withTransaction((db) => account(db), pool);
  let memoirId: string | undefined;
  try {
    const current = await withTransaction((db) => book(db, actor), pool); memoirId = current.memoir.id;
    const input = { ...operation(1), answerId: null, text: '并发合成回答' };
    const [first, second] = await Promise.all([withTransaction((db) => saveMemoirSupplement(actor, current.memoir.id, input, db), pool), withTransaction((db) => saveMemoirSupplement(actor, current.memoir.id, input, db), pool)]);
    assert.equal(first.id, second.id);
    await withTransaction(async (db) => {
      assert.equal((await listMemoirAnswers(actor, current.memoir.id, page, db)).items.length, 1);
      await assert.rejects(deleteMemoir(actor, current.memoir.id, { ...operation(1), confirmOnlineDeletion: true }, db), hasCode('VERSION_CONFLICT'));
      assert.equal((await getMemoir(actor, current.memoir.id, db)).memoir.version, 2);
    }, pool);
  } finally {
    if (memoirId) await pool.query('DELETE FROM memoirs WHERE id=$1', [memoirId]);
    await pool.query('DELETE FROM direction1_write_receipts WHERE actor_id=$1', [actor]);
    await pool.query('DELETE FROM direction1_demo_accounts WHERE user_id=$1', [actor]);
    await pool.query('DELETE FROM team_members WHERE id=$1', [actor]);
  }
});
