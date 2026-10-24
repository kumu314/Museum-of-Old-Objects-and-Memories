import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { errorResponseSchema, exhibitDraftResponseSchema, museumDraftResponseSchema } from '../../src/contracts';

const base = process.env.E2E_BASE_URL;
if (!base) throw new Error('E2E_BASE_URL is required.');
const origin = new URL(base).origin;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use an isolated loopback server.');
async function request(path: string, cookie = '', method = 'GET', body?: unknown) {
  return fetch(new URL(path, origin), { method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function register() {
  const response = await request('/api/auth/register', '', 'POST', { username: `flow-${randomUUID().replaceAll('-', '')}`, password: `Test-${randomUUID()}!` });
  assert.equal(response.status, 201);
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}
async function redirectTo(path: string, cookie: string, destination: string) {
  const response = await request(path, cookie);
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location') ?? '', origin).pathname, destination);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  await response.arrayBuffer();
}

test('登录入口按自己的展品分流；并发建馆仅成功一次；未发布的跨页内容只有本人可预览', async (t) => {
  await redirectTo('/studio', '', '/login');
  await redirectTo('/museum', '', '/login');
  const cookie = await register();
  const setup = await request('/studio', cookie);
  assert.equal(setup.status, 200);
  assert.match(await setup.text(), /收录第一件旧物/);
  const creations = await Promise.all([0, 1].map(() => request('/api/museums', cookie, 'POST', { title: '一座自己的展馆', description: '这是整座展馆的独立简介。' })));
  assert.deepEqual(creations.map(({ status }) => status).sort(), [201, 409]);
  const success = creations.find(({ status }) => status === 201);
  const duplicate = creations.find(({ status }) => status === 409);
  assert.ok(success && duplicate);
  assert.equal(errorResponseSchema.parse(await duplicate.json()).error.code, 'MUSEUM_EXISTS');
  const museum = museumDraftResponseSchema.parse(await success.json()).data;
  const path = `/api/museums/${museum.id}`;
  const current = async () => museumDraftResponseSchema.parse(await (await request(path, cookie)).json()).data;
  t.after(async () => {
    try { assert.equal((await request(path, cookie, 'DELETE', { expectedVersion: (await current()).version })).status, 200); }
    finally { await request('/api/auth/logout', cookie, 'POST'); }
  });
  await redirectTo('/studio', cookie, `/studio/${museum.id}`);
  await redirectTo('/museum', cookie, `/studio/${museum.id}`);
  for (let slotIndex = 0; slotIndex < 7; slotIndex++) {
    const added = await request(`${path}/exhibits`, cookie, 'POST', { expectedMuseumVersion: (await current()).version,
      name: `独立旧物 ${slotIndex + 1}`, era: '年代待考', slotIndex, modelKey: 'camera-01', caption: `第 ${slotIndex + 1} 件旧物的独立展签。`,
      photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '演示模型，非照片生成。', sourceNotice: '自动化合成样例。',
      rawStory: `私密原文-${slotIndex}`, transcript: null, sourceSegments: [] });
    assert.equal(added.status, 201);
    assert.equal(exhibitDraftResponseSchema.parse(await added.json()).data.slotIndex, slotIndex);
  }
  assert.equal((await current()).publishedVersion, null);
  await redirectTo('/studio', cookie, '/museum');
  const preview = await request('/museum', cookie);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('cache-control') ?? '', /no-store/);
  const html = await preview.text();
  assert.match(html, /进入工作台/);
  assert.match(html, /这是整座展馆的独立简介/);
  assert.match(html, /独立旧物 7/);
  assert.equal(html.includes('私密原文-'), false);
  assert.equal(html.includes('modelInput'), false);
  const outsider = await register();
  t.after(async () => { await request('/api/auth/logout', outsider, 'POST'); });
  const hidden = await request(path, outsider);
  assert.equal(hidden.status, 404);
  assert.equal(errorResponseSchema.parse(await hidden.json()).error.code, 'NOT_FOUND');
  const outsidersMuseum = await request('/museum', outsider);
  assert.equal(outsidersMuseum.status, 307);
  assert.equal(new URL(outsidersMuseum.headers.get('location') ?? '', origin).pathname, '/studio');
  await outsidersMuseum.arrayBuffer();
});
