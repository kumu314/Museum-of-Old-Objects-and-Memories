import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Pool } from 'pg';
import { assetResponseSchema, commentPageResponseSchema, commentResponseSchema, discoveryPageResponseSchema, errorResponseSchema,
  exhibitDraftResponseSchema, followingListSchema, managedCommentPageSchema, museumAccessSchema, museumDraftResponseSchema,
  publicMuseumResponseSchema, publishResponseSchema, sessionResponseSchema, type CreateExhibitInput } from '../../src/contracts';

const originValue = process.env.E2E_BASE_URL;
const databaseValue = process.env.E2E_DATABASE_URL;
const originUrl = originValue ? URL.parse(originValue) : null;
const databaseUrl = databaseValue ? URL.parse(databaseValue) : null;
const local = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
if (!originUrl || !databaseUrl || !local(originUrl.hostname) || !local(databaseUrl.hostname)
  || !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw new Error('Direction-one HTTP tests require an explicit isolated loopback server and database.');
const origin = originUrl.origin;
async function request(path: string, cookie = '', method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) {
  return fetch(new URL(path, origin), { method, redirect: 'manual',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
}
async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(errorResponseSchema.parse(await response.json()).error.code, code);
}
async function registered() {
  const response = await request('/api/auth/register', '', 'POST', { username: `d1-http-${randomUUID().replaceAll('-', '')}`, password: randomBytes(24).toString('base64url') });
  assert.equal(response.status, 201);
  return { id: sessionResponseSchema.parse(await response.json()).data.id,
    cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') };
}

test('方向一真实 HTTP：服务端白名单、公开投影、关注收藏、留言管理与旧入口撤销', async () => {
  const db = new Pool({ connectionString: databaseValue, max: 1 });
  const accounts: string[] = [];
  try {
    const owner = await registered(); accounts.push(owner.id);
    const visitor = await registered(); accounts.push(visitor.id);
    const ordinary = await registered(); accounts.push(ordinary.id);
    await expectError(await request('/api/discovery'), 401, 'UNAUTHORIZED');
    await expectError(await request('/api/discovery', ordinary.cookie), 403, 'DEMO_ONLY');
    await db.query('INSERT INTO direction1_demo_accounts(user_id) SELECT unnest($1::uuid[])', [[owner.id, visitor.id]]);
    for (const actor of [owner, visitor]) {
      const profile = await request('/api/profile', actor.cookie, 'PATCH', { operationId: randomUUID(), expectedVersion: 1, nickname: `DEMO ${actor.id.slice(0, 8)}` });
      assert.equal(profile.status, 200);
    }
    const created = await request('/api/museums', owner.cookie, 'POST', { title: `DEMO 馆 ${owner.id}`, description: '仅供合成资料验收。' });
    assert.equal(created.status, 201); const museum = museumDraftResponseSchema.parse(await created.json()).data;
    const path = `/api/museums/${museum.id}`;
    async function current() { return museumDraftResponseSchema.parse(await (await request(path, owner.cookie)).json()).data; }
    await expectError(await request(`${path}/access`, visitor.cookie), 404, 'NOT_FOUND');
    await expectError(await request(`${path}/access`, owner.cookie, 'PATCH', { operationId: randomUUID(), expectedVersion: museum.version, accessMode: 'private' }, { Origin: 'https://other.example.test' }), 403, 'FORBIDDEN');
    const form = new FormData(); form.append('file', new Blob([await readFile('src/features/cabinet/assets/reference-overview.png')], { type: 'image/png' }), 'synthetic.png');
    const uploaded = await fetch(new URL(`${path}/assets`, origin), { method: 'POST', headers: { Origin: origin, Cookie: owner.cookie }, body: form, signal: AbortSignal.timeout(30000) });
    assert.equal(uploaded.status, 201); const photo = assetResponseSchema.parse(await uploaded.json()).data.id;
    const fields: CreateExhibitInput = { expectedMuseumVersion: (await current()).version, name: 'DEMO 公开旧物', era: '年代待考', slotIndex: 0,
      modelKey: 'photo-plane', caption: '用于 HTTP 验收的合成展品。', photoAssetId: photo, audioAssetId: null,
      modelInput: { mode: 'single', imageAssetId: null }, approximation: '照片平面', sourceNotice: '合成验收资料', rawStory: '私密讲述哨兵，不应公开', transcript: null, sourceSegments: [] };
    const added = await request(`${path}/exhibits`, owner.cookie, 'POST', fields); assert.equal(added.status, 201);
    const exhibit = exhibitDraftResponseSchema.parse(await added.json()).data;
    assert.equal((await request(`${path}/exhibits/${exhibit.id}/confirm`, owner.cookie, 'POST', { expectedVersion: exhibit.version, confirmationNote: '核对合成展示内容。' })).status, 200);
    const published = await request(`${path}/publish`, owner.cookie, 'POST', { expectedVersion: (await current()).version });
    assert.equal(published.status, 200); assert.equal(publishResponseSchema.parse(await published.json()).data.token, null);
    assert.equal((await current()).accessMode, 'private');
    const opened = await request(`${path}/access`, owner.cookie, 'PATCH', { operationId: randomUUID(), expectedVersion: (await current()).version, accessMode: 'discoverable' });
    assert.equal(opened.status, 200); const access = museumAccessSchema.parse((await opened.json()).data); assert.ok(access.accessEpoch);
    const entry = `/api/discovery/${museum.id}/${access.accessEpoch}`;
    const directory = discoveryPageResponseSchema.parse(await (await request(`/api/discovery?query=${encodeURIComponent(museum.title)}`, visitor.cookie)).json()).data;
    assert.equal(directory.items.length, 1); assert.equal(directory.items[0]?.museumId, museum.id);
    const publicData = publicMuseumResponseSchema.parse(await (await request(entry, visitor.cookie)).json()).data;
    assert.equal(JSON.stringify(publicData).includes('私密讲述哨兵'), false);
    assert.equal((await request(`${entry}/assets/${photo}`, visitor.cookie)).status, 200);
    assert.equal((await request(`/api/following/${owner.id}`, visitor.cookie, 'PUT', { operationId: randomUUID() })).status, 200);
    const following = followingListSchema.parse((await (await request('/api/following', visitor.cookie)).json()).data);
    assert.equal(following.items[0]?.profile.userId, owner.id);
    assert.equal(followingListSchema.parse((await (await request('/api/following', owner.cookie)).json()).data).items.length, 0);
    assert.equal((await request(`${entry}/favorite`, visitor.cookie, 'PUT', { operationId: randomUUID() })).status, 200);
    const commentInput = { operationId: randomUUID(), accessEpoch: access.accessEpoch, rootId: null, replyToId: null, body: '【合成留言】删除不恢复正文。' };
    const posted = await request(`${entry}/comments`, visitor.cookie, 'POST', commentInput); assert.equal(posted.status, 201);
    const comment = commentResponseSchema.parse(await posted.json()).data;
    const replay = await request(`${entry}/comments`, visitor.cookie, 'POST', commentInput); assert.equal(replay.status, 201);
    assert.equal(commentResponseSchema.parse(await replay.json()).data.id, comment.id);
    assert.equal((await request(`${entry}/comments`, owner.cookie, 'POST', { ...commentInput, operationId: randomUUID(), rootId: comment.id, replyToId: comment.id, body: '【合成回复】保留回复。' })).status, 201);
    const commentPath = `${path}/comments/${comment.id}`;
    assert.equal((await request(`${commentPath}/moderation`, owner.cookie, 'PATCH', { operationId: randomUUID(), expectedVersion: 1, action: 'hide' })).status, 200);
    assert.equal((await request(commentPath, visitor.cookie, 'DELETE', { operationId: randomUUID(), expectedVersion: 2 })).status, 200);
    assert.equal(commentPageResponseSchema.parse(await (await request(`${entry}/comments`, visitor.cookie)).json()).data.items.length, 0);
    const managed = managedCommentPageSchema.parse((await (await request(`${path}/comments`, owner.cookie)).json()).data);
    const deleted = managed.items.find(({ id }) => id === comment.id); assert.equal(deleted?.status, 'hidden_deleted'); assert.equal('body' in (deleted ?? {}), false);
    assert.equal((await request(`${commentPath}/moderation`, owner.cookie, 'PATCH', { operationId: randomUUID(), expectedVersion: 3, action: 'restore' })).status, 200);
    assert.equal(commentPageResponseSchema.parse(await (await request(`${entry}/comments`, visitor.cookie)).json()).data.items.length, 2);
    assert.equal((await request(`${path}/comment-bans`, owner.cookie, 'PUT', { operationId: randomUUID(), targetCommentId: comment.id })).status, 200);
    await expectError(await request(`${entry}/comments`, visitor.cookie, 'POST', { ...commentInput, operationId: randomUUID() }), 403, 'COMMENTING_BLOCKED');
    assert.equal((await request(entry, visitor.cookie)).status, 200);
    assert.equal((await request(`${entry}/assets/${photo}`, visitor.cookie)).status, 200);
    assert.equal((await request(`${path}/access`, owner.cookie, 'PATCH', { operationId: randomUUID(), expectedVersion: (await current()).version, accessMode: 'private' })).status, 200);
    await expectError(await request(entry, visitor.cookie), 404, 'NOT_FOUND');
    await expectError(await request(`${entry}/assets/${photo}`, visitor.cookie), 404, 'NOT_FOUND');
    assert.equal((await request(path, owner.cookie, 'DELETE', { expectedVersion: (await current()).version })).status, 200);
  } finally {
    if (accounts.length) {
      await db.query('DELETE FROM direction1_demo_accounts WHERE user_id=ANY($1::uuid[])', [accounts]);
      await db.query('UPDATE team_members SET active=false WHERE id=ANY($1::uuid[])', [accounts]);
    }
    await db.end();
  }
});
