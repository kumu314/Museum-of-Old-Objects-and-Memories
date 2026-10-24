import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { after, before, test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import type { CreateExhibitInput } from '../../src/contracts';
import { requestAiDraft, adoptAiDraft } from '../../src/server/core/ai';
import { createMuseum, createExhibit, confirmExhibit, getMuseum, updateExhibit } from '../../src/server/core';
import { migrate } from '../../src/server/db/migrate';
import { withTransaction } from '../../src/server/db/pool';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

// A single database connection makes an accidentally open network-time transaction observable.
const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 1, connectionTimeoutMillis: 1000 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });
const sourceText = '家里有一台旧相机，具体是什么时候买的我记不清，可能是很多年前。';
const output = { caption: '这是一件用于测试整理流程的旧物。物主只记得大约在多年前取得，具体年代记不清。现有描述不足以确认制作时间、使用经过及相关人物，仍需根据原始讲述进一步核对。',
  questions: ['是否还有购置时间的相关线索？'], sourceSegmentIds: ['story-1'] };

async function fixture(context: TestContext) {
  const actor = randomUUID();
  const input: Omit<CreateExhibitInput, 'expectedMuseumVersion'> = { name: '复古相机', era: '年代待考', slotIndex: 0, modelKey: 'camera-01', caption: '人工填写的旧展签。',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '演示模型', sourceNotice: '自动化测试', rawStory: sourceText, transcript: null,
    sourceSegments: [{ id: 'story-1', text: sourceText, source: 'rawStory' }] };
  const result = await withTransaction(async (db) => {
    await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [actor, `ai-test-${actor}`, 'test-only']);
    const museum = await createMuseum(actor, { title: 'AI流程测试', description: '' }, db);
    const photo = randomUUID();
    await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
      VALUES($1,$2,'model-input.webp','image','image/webp',100,$3,10,10,$4,$5)`, [photo, museum.id, `${photo}.webp`, '0'.repeat(64), actor]);
    input.modelInput = { mode: 'single', imageAssetId: photo };
    const exhibit = await createExhibit(actor, museum.id, { ...input, expectedMuseumVersion: museum.version }, db);
    await confirmExhibit(actor, museum.id, exhibit.id, { expectedVersion: exhibit.version, confirmationNote: '测试已有人工确认' }, db);
    return { actor, museum, exhibit, input };
  }, pool);
  context.after(async () => {
    // Remove only UUIDs created by this fixture; no shared tables or pre-existing data are cleared.
    await withTransaction(async (db) => {
      await db.query('DELETE FROM ai_drafts WHERE museum_id=$1', [result.museum.id]);
      await db.query('DELETE FROM exhibits WHERE museum_id=$1', [result.museum.id]);
      await db.query('DELETE FROM assets WHERE museum_id=$1', [result.museum.id]);
      await db.query('DELETE FROM museums WHERE id=$1', [result.museum.id]);
      await db.query('DELETE FROM users WHERE id=$1', [actor]);
    }, pool);
  });
  return result;
}
async function service(context: TestContext, handler: (response: ServerResponse) => void) {
  const names = ['AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY'] as const;
  const previous = names.map((name) => [name, process.env[name]] as const);
  const server = createServer((request, response) => { request.resume(); request.on('end', () => handler(response)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.AI_MODEL = 'local-flow-fixture';
  process.env.AI_API_KEY = 'local-stub-key';
}
function complete(response: ServerResponse) {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }] }));
}
function versionConflict(error: unknown) { return error instanceof HttpError && error.failure.code === 'VERSION_CONFLICT'; }

test('AI草稿单独保存并复用；人工采纳才修改展签，原文保留且旧确认失效', async (context) => {
  const setup = await fixture(context);
  let calls = 0;
  await service(context, (response) => { calls += 1; complete(response); });
  const request = { expectedVersion: setup.exhibit.version };
  const [draft, duplicate] = await Promise.all([
    requestAiDraft(setup.actor, setup.museum.id, setup.exhibit.id, request, pool),
    requestAiDraft(setup.actor, setup.museum.id, setup.exhibit.id, request, pool),
  ]);
  assert.equal(draft.id, duplicate.id);
  assert.equal(calls, 1);
  assert.equal((await requestAiDraft(setup.actor, setup.museum.id, setup.exhibit.id, request, pool)).id, draft.id);
  assert.equal(calls, 1);
  await withTransaction(async (db) => {
    const before = (await getMuseum(setup.actor, setup.museum.id, db)).exhibits[0];
    assert.equal(before?.caption, setup.input.caption);
    assert.equal(before?.confirmedVersion, setup.exhibit.version);
    const adopted = await adoptAiDraft(setup.actor, setup.museum.id, setup.exhibit.id, { expectedVersion: setup.exhibit.version, draftId: draft.id, caption: draft.output.caption }, db);
    assert.equal(adopted.rawStory, sourceText);
    assert.equal(adopted.transcript, null);
    assert.deepEqual(adopted.modelInput, setup.input.modelInput);
    assert.equal(adopted.caption, output.caption);
    assert.equal(adopted.version, setup.exhibit.version + 1);
    assert.equal(adopted.confirmedVersion, null);
    // Even with the latest expectedVersion, an older source draft cannot be adopted again.
    await assert.rejects(adoptAiDraft(setup.actor, setup.museum.id, setup.exhibit.id, { expectedVersion: adopted.version, draftId: draft.id, caption: '过期采纳不能覆盖当前展签。' }, db), versionConflict);
  }, pool);
});

test('AI服务故障或输出无效不改变已保存内容与确认，失败后仍可人工编辑并重新确认', async (context) => {
  const setup = await fixture(context);
  let mode: 'unavailable' | 'invalid' = 'unavailable';
  let calls = 0;
  await service(context, (response) => {
    calls += 1;
    if (mode === 'unavailable') {
      response.statusCode = 503;
      response.end('provider unavailable');
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{' } }] }));
    }
  });
  const before = await withTransaction((db) => getMuseum(setup.actor, setup.museum.id, db), pool);
  for (const failure of ['unavailable', 'invalid'] as const) {
    mode = failure;
    await assert.rejects(
      requestAiDraft(setup.actor, setup.museum.id, setup.exhibit.id, { expectedVersion: setup.exhibit.version }, pool),
      (error: unknown) => error instanceof HttpError && error.failure.code === 'AI_UNAVAILABLE',
    );
    const current = await withTransaction((db) => getMuseum(setup.actor, setup.museum.id, db), pool);
    assert.deepEqual(current, before);
    const drafts = await pool.query('SELECT id FROM ai_drafts WHERE exhibit_id=$1', [setup.exhibit.id]);
    assert.equal(drafts.rowCount, 0);
  }
  assert.equal(calls, 2);
  await withTransaction(async (db) => {
    const changed = await updateExhibit(setup.actor, setup.museum.id, setup.exhibit.id, {
      ...setup.input, caption: 'AI不可用时，仍然可以手工整理并保存这段展签。', expectedVersion: setup.exhibit.version,
    }, db);
    assert.equal(changed.rawStory, sourceText);
    assert.deepEqual(changed.sourceSegments, setup.input.sourceSegments);
    assert.equal(changed.confirmedVersion, null);
    const confirmed = await confirmExhibit(setup.actor, setup.museum.id, changed.id, {
      expectedVersion: changed.version, confirmationNote: '人工继续制作后明确确认当前版本。',
    }, db);
    assert.equal(confirmed.confirmedVersion, confirmed.version);
  }, pool);
});

test('网络等待不持有事务；等待期间人工修改并确认后，旧AI结果不落库或覆盖', async (context) => {
  const setup = await fixture(context);
  const arrived = Promise.withResolvers<ServerResponse>();
  await service(context, (response) => arrived.resolve(response));
  const operation = requestAiDraft(setup.actor, setup.museum.id, setup.exhibit.id, { expectedVersion: setup.exhibit.version }, pool);
  const rejected = assert.rejects(operation, versionConflict);
  const response = await arrived.promise;
  try {
    await withTransaction(async (db) => {
      const changed = await updateExhibit(setup.actor, setup.museum.id, setup.exhibit.id, {
        ...setup.input, caption: '模型还在整理时，人工已经改成这段展签。', expectedVersion: setup.exhibit.version,
      }, db);
      await confirmExhibit(setup.actor, setup.museum.id, changed.id, { expectedVersion: changed.version, confirmationNote: '重新确认人工修改后的内容。' }, db);
    }, pool);
  } finally { complete(response); }
  await rejected;
  await withTransaction(async (db) => {
    const current = (await getMuseum(setup.actor, setup.museum.id, db)).exhibits[0];
    assert.equal(current?.caption, '模型还在整理时，人工已经改成这段展签。');
    assert.equal(current?.rawStory, sourceText);
    assert.equal(current?.confirmedVersion, setup.exhibit.version + 1);
    const saved = await db.query('SELECT id FROM ai_drafts WHERE exhibit_id=$1', [setup.exhibit.id]);
    assert.equal(saved.rowCount, 0);
  }, pool);
});
