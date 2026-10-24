import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  aiDraftResponseSchema, errorResponseSchema, exhibitDraftResponseSchema,
  museumDraftResponseSchema, sessionResponseSchema,
} from '../../src/contracts';

if (process.env.RUN_REAL_AI_ACCEPTANCE !== '1') {
  throw new Error('Set RUN_REAL_AI_ACCEPTANCE=1 explicitly; this acceptance test makes one billable model request.');
}
const configuredBase = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
if (!configuredBase || !username || !password) {
  throw new Error('E2E_BASE_URL, E2E_USERNAME and E2E_PASSWORD are required.');
}
const base = new URL(configuredBase);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Real AI acceptance requires an explicitly prepared loopback server.');
}
const origin = base.origin;

test('真实AI正式流程：生成草稿、人工修订采纳、确认和拒绝旧草稿', { timeout: 120_000 }, async () => {
  let cookie = '';
  let museumId: string | undefined;
  async function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
    return fetch(new URL(path, origin), {
      method,
      headers: { Origin: origin, ...(authenticated && cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
  }
  async function museum() {
    assert.ok(museumId);
    const response = await request(`/api/museums/${museumId}`);
    assert.equal(response.status, 200);
    return museumDraftResponseSchema.parse(await response.json()).data;
  }
  try {
    const login = await request('/api/auth/login', 'POST', { username, password }, false);
    assert.equal(login.status, 200);
    sessionResponseSchema.parse(await login.json());
    cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    assert.ok(cookie);
    const created = await request('/api/museums', 'POST', {
      title: `D真实AI验收 ${randomUUID()}`, description: '合成讲述，仅验证真实调用与人工采纳，不代表物主事实。',
    });
    assert.equal(created.status, 201);
    const initialMuseum = museumDraftResponseSchema.parse(await created.json()).data;
    museumId = initialMuseum.id;
    const rawStory = '爷爷跑运输的时候一直带着这个茶杯，杯口有一道磕痕。具体哪一年买的记不清了，大概是八十年代，地点也说不准。';
    const sourceSegments = [{ id: 'raw-1', source: 'rawStory', text: rawStory }];
    const added = await request(`/api/museums/${museumId}/exhibits`, 'POST', {
      name: '旧茶杯', era: '约八十年代', slotIndex: 0, modelKey: 'camera-01', caption: '待人工整理的验收展签。',
      photoAssetId: null, audioAssetId: null, approximation: '使用内置演示模型，仅验证故事链路。',
      sourceNotice: '合成讲述，无真实物主信息。', rawStory, transcript: null, sourceSegments,
      expectedMuseumVersion: initialMuseum.version,
    });
    assert.equal(added.status, 201);
    const exhibit = exhibitDraftResponseSchema.parse(await added.json()).data;
    const generated = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}/ai`, 'POST', { expectedVersion: exhibit.version });
    assert.equal(generated.status, 200);
    const draft = aiDraftResponseSchema.parse(await generated.json()).data;
    assert.equal(draft.sourceVersion, exhibit.version);
    assert.deepEqual(draft.output.sourceSegmentIds, ['raw-1']);
    const afterGeneration = (await museum()).exhibits.find((entry) => entry.id === exhibit.id);
    assert.deepEqual(afterGeneration, exhibit);

    const editedCaption = '这是一只旧茶杯，爷爷跑运输时一直随身带着，杯口留有一道磕痕。讲述者记不清具体购买年份，大概是八十年代，购买地点也说不准。';
    const adoptedResponse = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}/ai/adopt`, 'POST', {
      expectedVersion: exhibit.version, draftId: draft.id, caption: editedCaption,
    });
    assert.equal(adoptedResponse.status, 200);
    const adopted = exhibitDraftResponseSchema.parse(await adoptedResponse.json()).data;
    assert.equal(adopted.caption, editedCaption);
    assert.equal(adopted.rawStory, rawStory);
    assert.deepEqual(adopted.sourceSegments, sourceSegments);
    assert.equal(adopted.version, exhibit.version + 1);
    assert.equal(adopted.confirmedVersion, null);

    const confirmedResponse = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}/confirm`, 'POST', {
      expectedVersion: adopted.version, confirmationNote: '明确确认合成验收的人工修订版本，不作为真实物主确认。',
    });
    assert.equal(confirmedResponse.status, 200);
    const confirmed = exhibitDraftResponseSchema.parse(await confirmedResponse.json()).data;
    assert.equal(confirmed.confirmedVersion, confirmed.version);
    const stale = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}/ai/adopt`, 'POST', {
      expectedVersion: confirmed.version, draftId: draft.id, caption: '旧草稿不能覆盖人工确认后的内容。',
    });
    assert.equal(stale.status, 409);
    assert.equal(errorResponseSchema.parse(await stale.json()).error.code, 'VERSION_CONFLICT');
    const latest = (await museum()).exhibits.find((entry) => entry.id === exhibit.id);
    assert.deepEqual(latest, confirmed);
  } finally {
    try {
      if (museumId && cookie) {
        const current = await museum();
        const removed = await request(`/api/museums/${museumId}`, 'DELETE', { expectedVersion: current.version });
        assert.equal(removed.status, 200);
      }
    } finally {
      if (cookie) assert.equal((await request('/api/auth/logout', 'POST')).status, 200);
    }
  }
});
