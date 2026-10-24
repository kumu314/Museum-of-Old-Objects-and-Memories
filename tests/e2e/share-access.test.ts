import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { assetResponseSchema, errorResponseSchema, exhibitDraftResponseSchema, museumDraftResponseSchema,
  publicMuseumResponseSchema, publishResponseSchema, type CreateExhibitInput } from '../../src/contracts';

const configuredOrigin = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
if (!configuredOrigin || !username || !password) throw new Error('E2E server and test credentials are required.');
const origin = new URL(configuredOrigin).origin;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use an isolated loopback server.');

async function request(path: string, cookie = '', method = 'GET', body?: unknown) {
  return fetch(new URL(path, origin), { method, redirect: 'manual',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
}
async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const error = errorResponseSchema.parse(await response.json()).error;
  assert.equal(error.code, code);
  return error;
}
function cookieOf(response: Response) {
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  return cookie;
}
async function fixture(t: TestContext) {
  const login = await request('/api/auth/login', '', 'POST', { username, password });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  const created = await request('/api/museums', cookie, 'POST', { title: '参观与缺图回归测试馆', description: '合成验收样例。' });
  assert.equal(created.status, 201);
  const museum = museumDraftResponseSchema.parse(await created.json()).data;
  const path = `/api/museums/${museum.id}`;
  const current = async () => {
    const response = await request(path, cookie);
    assert.equal(response.status, 200);
    return museumDraftResponseSchema.parse(await response.json()).data;
  };
  t.after(async () => {
    assert.equal((await request(path, cookie, 'DELETE', { expectedVersion: (await current()).version })).status, 200);
    assert.equal((await request('/api/auth/logout', cookie, 'POST')).status, 200);
  });
  const fields: CreateExhibitInput = { name: '回归测试旧物', era: '年代待考', slotIndex: 0, modelKey: 'photo-plane',
    caption: '这是供登录与缺图流程验收的展签。', photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '合成验收素材。',
    sourceNotice: '非真实用户素材。', rawStory: '不向参观者展示的原始讲述。', transcript: null, sourceSegments: [], expectedMuseumVersion: museum.version };
  return { cookie, path, current, fields };
}

test('参观页、快照和图片音频均要求有效会话；其他登录用户凭链接可参观但不可编辑', async (t) => {
  const f = await fixture(t);
  async function upload(bytes: Uint8Array, name: string, type: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    const response = await fetch(new URL(`${f.path}/assets`, origin), {
      method: 'POST', headers: { Origin: origin, Cookie: f.cookie }, body: form, signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 201);
    return assetResponseSchema.parse(await response.json()).data.id;
  }
  const photo = await upload(await readFile('src/features/cabinet/assets/reference-overview.png'), 'test.png', 'image/png');
  const wav = Buffer.alloc(44 + 16_000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16_000, 40);
  const audio = await upload(wav, 'test.wav', 'audio/wav');
  const added = await request(`${f.path}/exhibits`, f.cookie, 'POST', { ...f.fields, photoAssetId: photo, audioAssetId: audio });
  assert.equal(added.status, 201);
  const exhibit = exhibitDraftResponseSchema.parse(await added.json()).data;
  assert.equal((await request(`${f.path}/exhibits/${exhibit.id}/confirm`, f.cookie, 'POST', {
    expectedVersion: exhibit.version, confirmationNote: '确认本次合成回归样例。',
  })).status, 200);
  const publication = await request(`${f.path}/publish`, f.cookie, 'POST', { expectedVersion: (await f.current()).version });
  assert.equal(publication.status, 200);
  const token = publishResponseSchema.parse(await publication.json()).data.token;
  assert.ok(token);
  const share = `/api/share/${token}`;
  const dataPaths = [share, `${share}/assets/${photo}`, `${share}/assets/${photo}?variant=thumbnail`, `${share}/assets/${audio}`];
  for (const path of dataPaths) {
    await expectError(await request(path), 401, 'UNAUTHORIZED');
    await expectError(await request(path, 'shiwuguan-session=invalid'), 401, 'UNAUTHORIZED');
  }
  const page = await request(`/share/${token}`);
  assert.equal(page.status, 307);
  const destination = new URL(page.headers.get('location') ?? '', origin);
  assert.equal(destination.pathname, '/login');
  assert.equal(destination.search, '');
  await page.arrayBuffer();

  const visitor = await request('/api/auth/register', '', 'POST', { username: `visit-${randomUUID().replaceAll('-', '')}`, password });
  assert.equal(visitor.status, 201);
  const visitorCookie = cookieOf(visitor);
  t.after(async () => { await request('/api/auth/logout', visitorCookie, 'POST'); });
  const snapshot = publicMuseumResponseSchema.parse(await (await request(share, visitorCookie)).json()).data;
  assert.equal(JSON.stringify(snapshot).includes(f.fields.rawStory), false);
  await expectError(await request(f.path, visitorCookie), 404, 'NOT_FOUND');
  for (const path of dataPaths.slice(1)) {
    const response = await request(path, visitorCookie);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    await response.arrayBuffer();
  }
  const authenticatedPage = await request(`/share/${token}`, visitorCookie);
  assert.equal(authenticatedPage.status, 200);
  assert.match(authenticatedPage.headers.get('cache-control') ?? '', /no-store/);
  await authenticatedPage.arrayBuffer();
  assert.equal((await request('/api/auth/logout', visitorCookie, 'POST')).status, 200);
  for (const path of dataPaths) await expectError(await request(path, visitorCookie), 401, 'UNAUTHORIZED');
  const loggedOutPage = await request(`/share/${token}`, visitorCookie);
  assert.equal(loggedOutPage.status, 307);
  await loggedOutPage.arrayBuffer();
  assert.equal((await request(share, f.cookie)).status, 200);
});

test('缺图草稿可保存，确认与发布接口均返回明确补图提示且不修改版本', async (t) => {
  const f = await fixture(t);
  const added = await request(`${f.path}/exhibits`, f.cookie, 'POST', f.fields);
  assert.equal(added.status, 201);
  const exhibit = exhibitDraftResponseSchema.parse(await added.json()).data;
  const before = await f.current();
  const confirmation = await expectError(await request(`${f.path}/exhibits/${exhibit.id}/confirm`, f.cookie, 'POST', {
    expectedVersion: exhibit.version, confirmationNote: '缺图时不能确认。',
  }), 400, 'VALIDATION_ERROR');
  assert.match(confirmation.message, /上传.*保存.*实拍照片/);
  const publication = await expectError(await request(`${f.path}/publish`, f.cookie, 'POST', { expectedVersion: before.version }), 400, 'VALIDATION_ERROR');
  assert.match(publication.message, /第 1 格「回归测试旧物」.*上传.*实拍照片/);
  const after = await f.current();
  assert.equal(after.version, before.version);
  assert.equal(after.publishedVersion, null);
  assert.equal(after.exhibits[0]?.confirmedVersion, null);
});
