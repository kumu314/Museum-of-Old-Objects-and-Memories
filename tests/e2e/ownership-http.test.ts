import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { assetResponseSchema, errorResponseSchema, exhibitDraftResponseSchema, museumDraftResponseSchema,
  museumListResponseSchema, sessionResponseSchema, uploadLimits } from '../../src/contracts';

// 归属隔离必须由两个互相独立的账号证明。
// 单账号回归只能说明馆级隔离，不能说明用户隔离，两者的失败方式完全不同。
const base = process.env.E2E_BASE_URL;
const ownerName = process.env.E2E_USERNAME;
const ownerPassword = process.env.E2E_PASSWORD;
const otherName = process.env.E2E_SECOND_USERNAME;
const otherPassword = process.env.E2E_SECOND_PASSWORD;
if (!base || !ownerName || !ownerPassword || !otherName || !otherPassword) {
  throw new Error('E2E_BASE_URL, E2E_USERNAME, E2E_PASSWORD, E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD are required.');
}
const origin = new URL(base).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Ownership acceptance requires an isolated local server.');
}

test('归属隔离HTTP：两个账号的列表、直接构造 ID 与素材上传', async () => {
  let ownerCookie = '';
  let otherCookie = '';
  let museumId: string | undefined;

  function request(path: string, method = 'GET', data?: unknown, cookie = ownerCookie) {
    return fetch(new URL(path, origin), {
      method,
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(30_000),
    });
  }
  async function login(username: string, password: string) {
    const response = await fetch(new URL('/api/auth/login', origin), {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    sessionResponseSchema.parse(await response.json());
    const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    assert.ok(cookie);
    return cookie;
  }
  async function hiddenError(response: Response) {
    assert.equal(response.status, 404);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    const error = errorResponseSchema.parse(await response.json()).error;
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.message, '未找到该内容。');
    return { code: error.code, message: error.message };
  }
  async function museum() {
    assert.ok(museumId);
    const response = await request(`/api/museums/${museumId}`);
    assert.equal(response.status, 200);
    return museumDraftResponseSchema.parse(await response.json()).data;
  }
  async function upload(id: string, cookie: string) {
    const bytes = await sharp({ create: { width: 20, height: 40, channels: 3, background: '#8a8175' } }).jpeg().toBuffer();
    assert.ok(bytes.byteLength < uploadLimits.imageBytes);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), '旧物.jpg');
    return fetch(new URL(`/api/museums/${id}/assets`, origin), {
      method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: form, signal: AbortSignal.timeout(30_000),
    });
  }

  try {
    ownerCookie = await login(ownerName, ownerPassword);
    otherCookie = await login(otherName, otherPassword);

    const created = await request('/api/museums', 'POST', { title: `归属隔离验收 ${randomUUID()}`, description: '' });
    assert.equal(created.status, 201);
    const draft = museumDraftResponseSchema.parse(await created.json()).data;
    museumId = draft.id;

    const added = await request(`/api/museums/${museumId}/exhibits`, 'POST', {
      name: '旧车票', era: '年代待考', slotIndex: 0, modelKey: 'ticket', caption: '归属隔离验收展签',
      photoAssetId: null, audioAssetId: null, approximation: '候选演示模型', sourceNotice: '自动化归属验收，不代表真实物主记录。',
      rawStory: '内部原文不应公开', transcript: null,
      sourceSegments: [{ id: 'raw-1', text: '内部原文不应公开', source: 'rawStory' }],
      expectedMuseumVersion: (await museum()).version,
    });
    assert.equal(added.status, 201);
    exhibitDraftResponseSchema.parse(await added.json());

    const uploaded = await upload(museumId, ownerCookie);
    assert.equal(uploaded.status, 201);
    const asset = assetResponseSchema.parse(await uploaded.json()).data;

    // 归属账号看得到自己的展馆，另一个账号的列表里根本不该出现它。
    const ownerList = museumListResponseSchema.parse(await (await request('/api/museums')).json()).data;
    assert.ok(ownerList.some((item) => item.id === museumId));
    const otherList = museumListResponseSchema.parse(await (await request('/api/museums', 'GET', undefined, otherCookie)).json()).data;
    assert.equal(otherList.some((item) => item.id === museumId), false);

    // 直接构造 ID：读、改名、删除、加展品、发布、换分享链接、取素材、传素材全部拒绝。
    const current = await museum();
    const museumPath = `/api/museums/${museumId}`;
    const otherRequest = (path: string, method = 'GET', data?: unknown) => request(path, method, data, otherCookie);
    const denied = [
      await hiddenError(await otherRequest(museumPath)),
      await hiddenError(await otherRequest(museumPath, 'PATCH', { title: '被他人改名', description: '', expectedVersion: current.version })),
      await hiddenError(await otherRequest(museumPath, 'DELETE', { expectedVersion: current.version })),
      await hiddenError(await otherRequest(`${museumPath}/exhibits`, 'POST', {
        name: '越权展品', era: '年代待考', slotIndex: 1, modelKey: 'cassette', caption: '越权',
        photoAssetId: null, audioAssetId: null, approximation: '候选演示模型', sourceNotice: '越权测试',
        rawStory: '', transcript: null, sourceSegments: [], expectedMuseumVersion: current.version,
      })),
      await hiddenError(await otherRequest(`${museumPath}/publish`, 'POST', { expectedVersion: current.version })),
      await hiddenError(await otherRequest(`${museumPath}/share`, 'POST', { expectedVersion: current.version })),
      await hiddenError(await otherRequest(`${museumPath}/assets/${asset.id}`)),
      await hiddenError(await upload(museumId, otherCookie)),
    ];
    // 他人展馆与不存在的展馆给出完全相同的错误，不带存在性差异。
    const missing = await hiddenError(await otherRequest(`/api/museums/${randomUUID()}`));
    for (const deniedError of denied) assert.deepEqual(deniedError, missing);

    // 越权尝试没有留下任何副作用：标题、版本、展品和素材都还是归属账号操作后的样子。
    const after = await museum();
    assert.equal(after.title, current.title);
    assert.equal(after.version, current.version);
    assert.equal(after.exhibits.length, 1);
    const stillReadable = await request(`${museumPath}/assets/${asset.id}`);
    assert.equal(stillReadable.status, 200);
    assert.equal(stillReadable.headers.get('content-type'), 'image/webp');
  } finally {
    if (museumId) {
      const current = await request(`/api/museums/${museumId}`);
      if (current.status === 200) {
        const version = museumDraftResponseSchema.parse(await current.json()).data.version;
        await request(`/api/museums/${museumId}`, 'DELETE', { expectedVersion: version });
      }
    }
  }
});
