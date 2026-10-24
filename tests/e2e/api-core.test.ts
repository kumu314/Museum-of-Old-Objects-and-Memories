import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { errorResponseSchema, exhibitDraftResponseSchema, museumDraftResponseSchema, mutationSuccessSchema,
  publicMuseumResponseSchema, publishResponseSchema, sessionResponseSchema, shareLinkResponseSchema } from '../../src/contracts';

// Run against an explicitly prepared local test server, using a provisioned team account.
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
    try {
      return await fetch(new URL(path, origin), {
        method, redirect: 'manual',
        headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(includeOrigin ? { Origin: origin } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error: unknown) {
      const route = path.replace(/(\/(?:api\/)?share\/)[^/]+/, '$1[token]');
      throw new Error(`HTTP regression request failed: ${method} ${route}`, { cause: error });
    }
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
      photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '候选演示模型', sourceNotice: '自动化验收，不代表真实物主记录。',
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
    assert.equal(published.token, null);
    assert.equal((await museum()).accessMode, 'private');
    const opening = await request(`${base}/share`, 'POST', { expectedVersion: (await museum()).version });
    assert.equal(opening.status, 200);
    const { token } = shareLinkResponseSchema.parse(await opening.json()).data;
    assert.equal((await museum()).accessMode, 'link_only');
    await expectError(await request(`/api/share/${token}`, 'GET', undefined, false), 401, 'UNAUTHORIZED');
    await expectError(await request('/api/share/invalid', 'GET', undefined, false), 401, 'UNAUTHORIZED');
    const share = await request(`/api/share/${token}`);
    assert.equal(share.status, 200);
    assert.match(share.headers.get('cache-control') ?? '', /no-store/);
    const before = publicMuseumResponseSchema.parse(await share.json()).data;
    assert.equal(JSON.stringify(before).includes('内部原文不应公开'), false);
    const unauthenticatedPage = await request(`/share/${token}`, 'GET', undefined, false);
    assert.equal(unauthenticatedPage.status, 307);
    assert.equal(unauthenticatedPage.headers.get('location'), `/login?next=${encodeURIComponent(`/share/${token}`)}`);
    const withheld = await unauthenticatedPage.text();
    assert.equal(withheld.includes(initial.title), false);
    assert.equal(withheld.includes(exhibitFields.caption), false);
    const page = await request(`/share/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const html = await page.text();
    assert.ok(html.includes(initial.title));
    assert.ok(html.includes(exhibitFields.caption));
    assert.equal(html.includes('内部原文不应公开'), false);
    const visitorLogin = await request('/api/auth/login', 'POST', {
      username: process.env.E2E_SECOND_USERNAME, password: process.env.E2E_SECOND_PASSWORD,
    }, false);
    assert.equal(visitorLogin.status, 200);
    const visitorCookie = visitorLogin.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const visit = () => fetch(new URL(`/api/share/${token}`, origin), {
      headers: { Cookie: visitorCookie }, signal: AbortSignal.timeout(15_000),
    });
    const visitorShare = await visit();
    assert.equal(visitorShare.status, 200, '已登录的非所有者可凭有效链接参观');
    assert.deepEqual(publicMuseumResponseSchema.parse(await visitorShare.json()).data, before);
    const visitorPage = await fetch(new URL(`/share/${token}`, origin), {
      headers: { Cookie: visitorCookie }, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    assert.equal(visitorPage.status, 200);
    assert.ok((await visitorPage.text()).includes(initial.title));
    assert.equal((await fetch(new URL('/api/auth/logout', origin), {
      method: 'POST', headers: { Origin: origin, Cookie: visitorCookie }, signal: AbortSignal.timeout(15_000),
    })).status, 200);
    await expectError(await visit(), 401, 'UNAUTHORIZED');
    const loggedOutPage = await fetch(new URL(`/share/${token}`, origin), {
      headers: { Cookie: visitorCookie }, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    assert.equal(loggedOutPage.status, 307);
    assert.equal((await loggedOutPage.text()).includes(initial.title), false);
    const edit = await request(`${base}/exhibits/${exhibit.id}`, 'PATCH', { ...exhibitFields, name: '修改后的相机', expectedVersion: exhibit.version });
    assert.equal(edit.status, 200);
    const changed = exhibitDraftResponseSchema.parse(await edit.json()).data;
    assert.equal(changed.confirmedVersion, null);
    await expectError(await request(`${base}/exhibits/${exhibit.id}`, 'PATCH', { ...exhibitFields, expectedVersion: exhibit.version }), 409, 'VERSION_CONFLICT');
    const unchangedShare = await request(`/api/share/${token}`);
    assert.deepEqual(publicMuseumResponseSchema.parse(await unchangedShare.json()).data, before);
    const unchangedPage = await request(`/share/${token}`);
    assert.equal(unchangedPage.status, 200);
    assert.equal((await unchangedPage.text()).includes('修改后的相机'), false);
    const rotation = await request(`${base}/share`, 'POST', { expectedVersion: (await museum()).version });
    assert.equal(rotation.status, 200);
    const rotated = shareLinkResponseSchema.parse(await rotation.json()).data;
    const expired = await expectError(await request(`/api/share/${token}`), 404, 'SHARE_NOT_FOUND');
    const invalid = await expectError(await request('/api/share/invalid'), 404, 'SHARE_NOT_FOUND');
    assert.equal(expired.message, invalid.message);
    for (const path of [`/share/${token}`, '/share/invalid']) {
      const unavailable = await request(path);
      assert.equal(unavailable.status, 404);
      assert.match(unavailable.headers.get('cache-control') ?? '', /no-store/);
      const body = await unavailable.text();
      assert.ok(body.includes(invalid.message), `Unavailable share page must show the shared message (default404=${body.includes('This page could not be found')}, html=${unavailable.headers.get('content-type')}).`);
      assert.equal(body.includes(initial.title), false);
    }
    const stopped = await request(`${base}/share`, 'DELETE', { expectedVersion: (await museum()).version });
    assert.equal(stopped.status, 200);
    mutationSuccessSchema.parse(await stopped.json());
    await expectError(await request(`/api/share/${rotated.token}`), 404, 'SHARE_NOT_FOUND');
    const stoppedPage = await request(`/share/${rotated.token}`);
    assert.equal(stoppedPage.status, 404);
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
