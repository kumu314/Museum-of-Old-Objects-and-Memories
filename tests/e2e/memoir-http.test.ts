import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { onlineMemoirSchema, interviewSessionSchema, memoirAnswerRevisionSchema, memoirChapterSchema,
  memoirChapterConfirmationSchema, memoirChapterPublicationSchema, memoirExportSchema,
  errorResponseSchema, sessionResponseSchema } from '../../src/contracts';

const originUrl = process.env.E2E_BASE_URL ? URL.parse(process.env.E2E_BASE_URL) : null;
const databaseUrl = process.env.E2E_DATABASE_URL ? URL.parse(process.env.E2E_DATABASE_URL) : null;
const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
if (!originUrl || !databaseUrl || !loopback(originUrl.hostname) || !loopback(databaseUrl.hostname)
  || !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw new Error('Memoir HTTP tests require an explicit isolated loopback server and database.');
const origin = originUrl.origin;
async function request(path: string, cookie = '', method = 'GET', body?: unknown, headers: Record<string, string> = {}, escaped = false) {
  return fetch(new URL(path, origin), { method, redirect: 'manual', signal: AbortSignal.timeout(60000),
    headers: { Origin: origin, Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: escaped ? JSON.stringify(body).replaceAll('😀', '\\ud83d\\ude00') : JSON.stringify(body) }) });
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(errorResponseSchema.parse(await response.json()).error.code, code);
}
async function registered() {
  const response = await request('/api/auth/register', '', 'POST', { username: `m1-http-${randomUUID().replaceAll('-', '')}`, password: randomBytes(24).toString('base64url') });
  assert.equal(response.status, 201);
  return { id: sessionResponseSchema.parse(await response.json()).data.id, cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') };
}
const operation = (expectedVersion: number) => ({ operationId: randomUUID(), expectedVersion });

test('自传真实 HTTP：原文/长章节白名单、私有归属、版本、确认许可、导出和在线删除', async () => {
  const db = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
  const ids: string[] = [];
  try {
    const owner = await registered(); ids.push(owner.id); const stranger = await registered(); ids.push(stranger.id);
    await error(await request('/api/memoirs'), 401, 'UNAUTHORIZED');
    await error(await request('/api/memoirs', owner.cookie), 403, 'DEMO_ONLY');
    await db.query('INSERT INTO direction1_demo_accounts(user_id) SELECT unnest($1::uuid[])', [ids]);
    const create = { operationId: randomUUID(), title: 'HTTP 合成资料自传', museumId: null };
    await error(await request('/api/memoirs', owner.cookie, 'POST', { ...create, ownerId: stranger.id }), 400, 'VALIDATION_ERROR');
    await error(await request('/api/memoirs', owner.cookie, 'POST', create, { Origin: 'https://foreign.example.test' }), 403, 'FORBIDDEN');
    const created = await request('/api/memoirs', owner.cookie, 'POST', create); assert.equal(created.status, 201);
    const id = onlineMemoirSchema.parse((await created.json()).data).memoir.id; const path = `/api/memoirs/${id}`;
    async function current() { return onlineMemoirSchema.parse((await (await request(path, owner.cookie)).json()).data); }
    assert.equal(onlineMemoirSchema.parse((await (await request('/api/memoirs', owner.cookie, 'POST', create)).json()).data).memoir.id, id);
    await error(await request(path, stranger.cookie), 404, 'NOT_FOUND');
    await error(await request(`${path}/export?format=json`, stranger.cookie), 404, 'NOT_FOUND');
    await error(await request('/api/memoirs?ownerId=other', owner.cookie), 400, 'VALIDATION_ERROR');
    let session = interviewSessionSchema.parse((await (await request(`${path}/sessions`, owner.cookie, 'POST', { ...operation(1), topicKey: 'childhood' })).json()).data);
    assert.ok(session.currentQuestionId);
    const answerInput = { ...operation(session.version), questionId: session.currentQuestionId, answerId: null, text: '😀'.repeat(6000) };
    const saved = await request(`${path}/sessions/${session.id}/answers`, owner.cookie, 'POST', answerInput, {}, true); assert.equal(saved.status, 200);
    const answer = memoirAnswerRevisionSchema.parse((await saved.json()).data); assert.equal(answer.text, answerInput.text);
    assert.equal(memoirAnswerRevisionSchema.parse((await (await request(`${path}/sessions/${session.id}/answers`, owner.cookie, 'POST', answerInput)).json()).data).id, answer.id);
    session = interviewSessionSchema.parse((await (await request(`${path}/sessions/${session.id}`, owner.cookie)).json()).data);
    const paused = await request(`${path}/sessions/${session.id}`, owner.cookie, 'PATCH', { ...operation(session.version), action: 'pause' }); assert.equal(paused.status, 200);
    session = interviewSessionSchema.parse((await paused.json()).data);
    assert.equal(session.state, 'paused');
    await error(await request(`${path}/sessions/${session.id}/questions`, stranger.cookie), 404, 'NOT_FOUND');
    const beforeChapter = await current();
    const chapterResponse = await request(`${path}/chapters`, owner.cookie, 'POST', { ...operation(beforeChapter.memoir.version), title: '长章节预算' }); assert.equal(chapterResponse.status, 201);
    let chapter = memoirChapterSchema.parse((await chapterResponse.json()).data); const chapterPath = `${path}/chapters/${chapter.id}`;
    const paragraphs = Array.from({ length: 40 }, () => ({ id: randomUUID(), text: '😀'.repeat(500),
      sources: Array.from({ length: 40 }, (_, start) => ({ answerRevisionId: answer.id, start, end: start + 1 })) }));
    const chapterInput = { ...operation(chapter.version), expectedSourceVersion: beforeChapter.sourceVersion, title: chapter.title, paragraphs, derivedFromDraftId: null };
    const edited = await request(chapterPath, owner.cookie, 'PUT', chapterInput, {}, true); assert.equal(edited.status, 200);
    chapter = memoirChapterSchema.parse((await edited.json()).data); assert.ok(chapter.currentRevisionId);
    await error(await request(chapterPath, owner.cookie, 'PUT', { ...chapterInput, operationId: randomUUID() }), 409, 'VERSION_CONFLICT');
    await error(await request(chapterPath, stranger.cookie, 'PUT', { ...chapterInput, ...operation(chapter.version) }), 404, 'NOT_FOUND');
    const confirmed = await request(`${chapterPath}/confirmation`, owner.cookie, 'POST', { ...operation(chapter.version), revisionId: chapter.currentRevisionId, expectedSourceVersion: (await current()).sourceVersion, reviewedSources: true }); assert.equal(confirmed.status, 200);
    const confirmation = memoirChapterConfirmationSchema.parse((await confirmed.json()).data);
    chapter = memoirChapterSchema.parse((await (await request(chapterPath, owner.cookie)).json()).data);
    const granted = await request(`${chapterPath}/publication`, owner.cookie, 'POST', { ...operation(chapter.version), confirmationId: confirmation.id, privacyAcknowledged: true, authorizePublicChapter: true }); assert.equal(granted.status, 200);
    const publication = memoirChapterPublicationSchema.parse((await granted.json()).data); assert.equal(publication.publicData.paragraphs.length, 40);
    const json = await request(`${path}/export?format=json`, owner.cookie); assert.equal(json.status, 200);
    assert.match(json.headers.get('cache-control') ?? '', /no-store/); assert.equal(json.headers.get('x-content-type-options'), 'nosniff');
    assert.match(json.headers.get('content-disposition') ?? '', /attachment; filename="memoir-/);
    const exported = memoirExportSchema.parse(await json.json()); assert.equal(exported.answers[0]?.text, answerInput.text); assert.equal(exported.revisions.length, 1);
    const markdown = await request(`${path}/export?format=markdown`, owner.cookie); assert.equal(markdown.status, 200); assert.ok((await markdown.text()).includes(answer.id));
    await error(await request(`${path}/export?format=html`, owner.cookie), 400, 'VALIDATION_ERROR');
    await error(await request(path, owner.cookie, 'DELETE', { ...operation(1), confirmOnlineDeletion: true }), 409, 'VERSION_CONFLICT');
    const deletion = { ...operation((await current()).memoir.version), confirmOnlineDeletion: true };
    await error(await request(path, owner.cookie, 'DELETE', { ...deletion, confirmOnlineDeletion: false }), 400, 'VALIDATION_ERROR');
    assert.equal((await request(path, owner.cookie, 'DELETE', deletion)).status, 200);
    assert.equal((await request(path, owner.cookie, 'DELETE', deletion)).status, 200);
    for (const suffix of ['', '/answers', '/chapters', '/sessions', '/export?format=json', `/chapters/${chapter.id}/history?kind=publication`]) await error(await request(`${path}${suffix}`, owner.cookie), 404, 'NOT_FOUND');
    await error(await request('/api/memoirs', owner.cookie, 'POST', create), 404, 'NOT_FOUND');
    await error(await request(`${path}/sessions/${session.id}/answers`, owner.cookie, 'POST', answerInput), 404, 'NOT_FOUND');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM memoir_publications WHERE memoir_id=$1', [id])).rows[0]?.count, 0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM memoir_answer_revisions WHERE memoir_id=$1', [id])).rows[0]?.count, 0);
  } finally {
    if (ids.length) {
      await db.query('DELETE FROM memoirs WHERE owner_id=ANY($1::uuid[])', [ids]);
      await db.query('DELETE FROM direction1_demo_accounts WHERE user_id=ANY($1::uuid[])', [ids]);
      await db.query('UPDATE team_members SET active=false WHERE id=ANY($1::uuid[])', [ids]);
    }
    await db.end();
  }
});
