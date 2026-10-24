import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { z } from 'zod';
import { errorResponseSchema, exhibitDraftResponseSchema, museumDraftResponseSchema, museumSummarySchema, mutationSuccessSchema,
  publicMuseumResponseSchema, publishResponseSchema, sessionResponseSchema, shareLinkResponseSchema, successResponseSchema } from '../../src/contracts';

// Run against an explicitly prepared local test server. The main flow logs in with a
// provisioned account; the self-service test below registers its own users through the API.
// The test creates its own museum and soft-removes it through the application API.
const baseUrl = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
if (!baseUrl || !username || !password) throw new Error('E2E_BASE_URL, E2E_USERNAME and E2E_PASSWORD are required.');
const endpoint = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('API acceptance requires an isolated local server.');
const origin = endpoint.origin;

test('HTTP制作发布与分享撤销：会话、CAS、确认、快照和统一错误协议', async () => {
  let cookie = '';
  let museumId: string | undefined;
  async function request(path: string, method = 'GET', body?: unknown, authenticated = true, includeOrigin = true) {
    return fetch(new URL(path, origin), {
      method,
      headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(includeOrigin ? { Origin: origin } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  }
  async function expectError(response: Response, status: number, code: string) {
    assert.equal(response.status, status);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const result = errorResponseSchema.parse(await response.json());
    assert.equal(result.error.code, code);
    return result.error;
  }
  async function museum() {
    assert.ok(museumId);
    const response = await request(`/api/museums/${museumId}`);
    assert.equal(response.status, 200);
    return museumDraftResponseSchema.parse(await response.json()).data;
  }
  try {
    await expectError(await request('/api/museums', 'GET', undefined, false), 401, 'UNAUTHORIZED');
    await expectError(await request('/api/museums', 'POST', { title: '拒绝请求', description: '' }, false, false), 403, 'FORBIDDEN');
    const login = await request('/api/auth/login', 'POST', { username, password }, false);
    assert.equal(login.status, 200);
    sessionResponseSchema.parse(await login.json());
    cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    assert.ok(cookie);
    const created = await request('/api/museums', 'POST', { title: `HTTP验收 ${randomUUID()}`, description: '自动化验收数据，无真实物主信息。' });
    assert.equal(created.status, 201);
    const initial = museumDraftResponseSchema.parse(await created.json()).data;
    museumId = initial.id;
    const base = `/api/museums/${museumId}`;
    await expectError(await request('/api/museums/not-a-uuid'), 404, 'NOT_FOUND');
    const exhibitFields = { name: '复古相机', era: '年代待考', slotIndex: 0, modelKey: 'camera-01', caption: '这是一件用于验收的演示展品。',
      photoAssetId: null, audioAssetId: null, approximation: '候选演示模型', sourceNotice: '自动化验收，不代表真实物主记录。',
      rawStory: '内部原文不应公开', transcript: null, sourceSegments: [{ id: 'raw-1', text: '内部原文不应公开', source: 'rawStory' }] };
    const added = await request(`${base}/exhibits`, 'POST', { ...exhibitFields, expectedMuseumVersion: initial.version });
    assert.equal(added.status, 201);
    const exhibit = exhibitDraftResponseSchema.parse(await added.json()).data;
    const notConfirmed = await expectError(await request(`${base}/publish`, 'POST', { expectedVersion: (await museum()).version }), 409, 'NOT_CONFIRMED');
    if (notConfirmed.code === 'NOT_CONFIRMED') assert.deepEqual(notConfirmed.details.unconfirmedExhibitIds, [exhibit.id]);
    const confirmation = await request(`${base}/exhibits/${exhibit.id}/confirm`, 'POST', { expectedVersion: exhibit.version, confirmationNote: '测试账号确认当前演示内容。' });
    assert.equal(confirmation.status, 200);
    const confirmed = exhibitDraftResponseSchema.parse(await confirmation.json()).data;
    assert.equal(confirmed.confirmedVersion, confirmed.version);
    const publication = await request(`${base}/publish`, 'POST', { expectedVersion: (await museum()).version });
    assert.equal(publication.status, 200);
    const published = publishResponseSchema.parse(await publication.json()).data;
    assert.ok(published.token);
    const token = published.token;
    await expectError(await request(`/api/share/${token}`, 'GET', undefined, false), 401, 'UNAUTHORIZED');
    await expectError(await request('/api/share/invalid', 'GET', undefined, false), 401, 'UNAUTHORIZED');
    const share = await request(`/api/share/${token}`);
    assert.equal(share.status, 200);
    assert.match(share.headers.get('cache-control') ?? '', /no-store/);
    const before = publicMuseumResponseSchema.parse(await share.json()).data;
    assert.equal(JSON.stringify(before).includes('内部原文不应公开'), false);
    const edit = await request(`${base}/exhibits/${exhibit.id}`, 'PATCH', { ...exhibitFields, name: '修改后的相机', expectedVersion: exhibit.version });
    assert.equal(edit.status, 200);
    const changed = exhibitDraftResponseSchema.parse(await edit.json()).data;
    assert.equal(changed.confirmedVersion, null);
    await expectError(await request(`${base}/exhibits/${exhibit.id}`, 'PATCH', { ...exhibitFields, expectedVersion: exhibit.version }), 409, 'VERSION_CONFLICT');
    const unchangedShare = await request(`/api/share/${token}`);
    assert.deepEqual(publicMuseumResponseSchema.parse(await unchangedShare.json()).data, before);
    const rotation = await request(`${base}/share`, 'POST', { expectedVersion: (await museum()).version });
    assert.equal(rotation.status, 200);
    const rotated = shareLinkResponseSchema.parse(await rotation.json()).data;
    const expired = await expectError(await request(`/api/share/${token}`), 404, 'SHARE_NOT_FOUND');
    const invalid = await expectError(await request('/api/share/invalid'), 404, 'SHARE_NOT_FOUND');
    assert.equal(expired.message, invalid.message);
    const stopped = await request(`${base}/share`, 'DELETE', { expectedVersion: (await museum()).version });
    assert.equal(stopped.status, 200);
    mutationSuccessSchema.parse(await stopped.json());
    await expectError(await request(`/api/share/${rotated.token}`), 404, 'SHARE_NOT_FOUND');
  } finally {
    if (museumId && cookie) {
      const latest = await museum();
      const removed = await request(`/api/museums/${museumId}`, 'DELETE', { expectedVersion: latest.version });
      assert.equal(removed.status, 200);
      mutationSuccessSchema.parse(await removed.json());
    }
    if (cookie) {
      const logout = await request('/api/auth/logout', 'POST');
      assert.equal(logout.status, 200);
      await expectError(await request('/api/museums'), 401, 'UNAUTHORIZED');
    }
  }
});

test('自助注册与用户间隔离：注册、重复用户名、跨用户不可见', async () => {
  let firstCookie = '';
  let secondCookie = '';
  let museumId: string | undefined;
  async function request(path: string, method = 'GET', body?: unknown, cookie = '') {
    return fetch(new URL(path, origin), {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  }
  async function expectError(response: Response, status: number, code: string) {
    assert.equal(response.status, status);
    const result = errorResponseSchema.parse(await response.json());
    assert.equal(result.error.code, code);
    return result.error;
  }
  const first = `e2e-${randomUUID().slice(0, 30)}`;
  const second = `e2e-${randomUUID().slice(0, 30)}`;
  const password = 'registration-only-password';
  try {
    await expectError(await request('/api/auth/register', 'POST', { username: first, password: 'short' }), 400, 'VALIDATION_ERROR');
    await expectError(await request('/api/auth/register', 'POST', { username: '无效 用户名!', password }), 400, 'VALIDATION_ERROR');
    const registration = await request('/api/auth/register', 'POST', { username: first, password });
    assert.equal(registration.status, 201);
    sessionResponseSchema.parse(await registration.json());
    firstCookie = registration.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    assert.ok(firstCookie);
    await expectError(await request('/api/auth/register', 'POST', { username: first, password }), 400, 'VALIDATION_ERROR');
    const created = await request('/api/museums', 'POST', { title: `自助验收 ${randomUUID()}`, description: '' }, firstCookie);
    assert.equal(created.status, 201);
    museumId = museumDraftResponseSchema.parse(await created.json()).data.id;

    const other = await request('/api/auth/register', 'POST', { username: second, password });
    assert.equal(other.status, 201);
    secondCookie = other.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    await expectError(await request(`/api/museums/${museumId}`, 'GET', undefined, secondCookie), 404, 'NOT_FOUND');
    const listResponse = await request('/api/museums', 'GET', undefined, secondCookie);
    const list = successResponseSchema(z.array(museumSummarySchema)).safeParse(await listResponse.json());
    assert.ok(list.success);
    assert.equal(list.data.data.some((item) => item.id === museumId), false);
  } finally {
    for (const [cookie, id] of [[firstCookie, museumId], [secondCookie, undefined]] as const) {
      if (!cookie) continue;
      if (id) {
        const detail = await request(`/api/museums/${id}`, 'GET', undefined, cookie);
        const draft = museumDraftResponseSchema.parse(await detail.json()).data;
        const removed = await request(`/api/museums/${id}`, 'DELETE', { expectedVersion: draft.version }, cookie);
        assert.equal(removed.status, 200);
      }
      const logout = await request('/api/auth/logout', 'POST', undefined, cookie);
      assert.equal(logout.status, 200);
    }
  }
});
