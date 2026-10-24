import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { assetResponseSchema, errorResponseSchema, exhibitDraftResponseSchema, museumDraftResponseSchema,
  publishResponseSchema, sessionResponseSchema, shareLinkResponseSchema, uploadLimits, type Asset } from '../../src/contracts';

const base = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
if (!base || !username || !password) throw new Error('E2E_BASE_URL, E2E_USERNAME and E2E_PASSWORD are required.');
const origin = new URL(base).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use an explicitly prepared local acceptance server.');

test('素材HTTP闭环：真实上传、脱敏、字节边界、快照保护及撤销授权', async () => {
  let cookie = '';
  const museumIds: string[] = [];
  async function request(path: string, method = 'GET', data?: unknown, authenticated = true) {
    return fetch(new URL(path, origin), { method, headers: { Origin: origin,
      ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(30_000) });
  }
  async function error(response: Response, status: number, code: string) {
    assert.equal(response.status, status);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const value = errorResponseSchema.parse(await response.json()).error;
    assert.equal(value.code, code);
    return value;
  }
  async function museum(id: string) {
    const response = await request(`/api/museums/${id}`); assert.equal(response.status, 200);
    return museumDraftResponseSchema.parse(await response.json()).data;
  }
  async function upload(id: string, bytes: Buffer, name = 'photo.jpg', mime = 'image/jpeg', fieldCount = 1, authenticated = true): Promise<Response> {
    const form = new FormData();
    for (let i = 0; i < fieldCount; i++) form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    return fetch(new URL(`/api/museums/${id}/assets`, origin), { method: 'POST', headers: { Origin: origin, ...(authenticated && cookie ? { Cookie: cookie } : {}) }, body: form, signal: AbortSignal.timeout(30_000) });
  }
  async function uploaded(response: Response): Promise<Asset> {
    assert.equal(response.status, 201);
    const value: unknown = await response.json();
    const result = assetResponseSchema.parse(value).data;
    assert.equal(JSON.stringify(value).includes('storageKey'), false);
    assert.equal(JSON.stringify(value).includes('storage_key'), false);
    return result;
  }
  async function imageBody(response: Response): Promise<Buffer> {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), 'image/webp');
    const body = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(body).metadata();
    assert.deepEqual([metadata.width, metadata.height], [20, 40]);
    assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.orientation, undefined);
    return body;
  }
  try {
    const login = await request('/api/auth/login', 'POST', { username, password }, false);
    assert.equal(login.status, 200); sessionResponseSchema.parse(await login.json());
    cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    for (let i = 0; i < 2; i++) {
      const created = await request('/api/museums', 'POST', { title: `素材验收 ${randomUUID()}`, description: '合成测试素材，不含真实物主资料。' });
      assert.equal(created.status, 201); museumIds.push(museumDraftResponseSchema.parse(await created.json()).data.id);
    }
    const museumId = museumIds[0]; const otherId = museumIds[1];
    assert.ok(museumId); assert.ok(otherId);
    const bytes = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#bc904f' } })
      .withMetadata({ orientation: 6 }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="31,12.0N"/></rdf:RDF></x:xmpmeta>').jpeg().toBuffer();
    await error(await upload(museumId, bytes, 'photo.jpg', 'image/jpeg', 1, false), 401, 'UNAUTHORIZED');
    await error(await upload(museumId, bytes, 'photo.jpg', 'image/jpeg', 2), 400, 'VALIDATION_ERROR');
    await error(await upload(museumId, bytes, 'fake.png', 'image/png'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    const photo = await uploaded(await upload(museumId, bytes));
    function wave(size: number): Buffer {
      const wav = Buffer.alloc(size);
      wav.write('RIFF'); wav.writeUInt32LE(size - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
      wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(size - 44, 40);
      return wav;
    }
    const audioInput = wave(uploadLimits.audioBytes);
    const audio = await uploaded(await upload(museumId, audioInput, 'exact-voice.wav', 'audio/wav'));
    const replacementAudio = await uploaded(await upload(museumId, wave(2044), 'replacement.wav', 'audio/wav'));
    await error(await upload(museumId, Buffer.concat([audioInput, Buffer.from([0])]), 'too-large.wav', 'audio/wav'), 413, 'PAYLOAD_TOO_LARGE');
    async function audioBody(path: string) {
      const response = await request(path);
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), audioInput);
    }
    const replacement = await uploaded(await upload(museumId, bytes));
    const foreign = await uploaded(await upload(otherId, bytes));
    const privatePath = `/api/museums/${museumId}/assets/${photo.id}`;
    await error(await request(privatePath, 'GET', undefined, false), 401, 'UNAUTHORIZED');
    await error(await request(`/api/museums/${otherId}/assets/${photo.id}`), 404, 'NOT_FOUND');
    await error(await request(`${privatePath}?variant=original`), 404, 'NOT_FOUND');
    const displayed = await imageBody(await request(privatePath));
    await imageBody(await request(`${privatePath}?variant=thumbnail`));

    const padded = Buffer.concat([bytes, Buffer.alloc(uploadLimits.imageBytes - bytes.length)]);
    await uploaded(await upload(museumId, padded, 'exact-limit.jpg'));
    await error(await upload(museumId, Buffer.concat([padded, Buffer.from([0])]), 'over-limit.jpg'), 413, 'PAYLOAD_TOO_LARGE');
    const oversized = await fetch(new URL(`/api/museums/${museumId}/assets`, origin), { method: 'POST', headers: {
      Origin: origin, Cookie: cookie, 'Content-Type': 'multipart/form-data; boundary=oversized' },
      body: new Uint8Array(uploadLimits.audioBytes + 65_537), signal: AbortSignal.timeout(30_000) });
    await error(oversized, 413, 'PAYLOAD_TOO_LARGE');

    const fields = { name: '测试票据', era: '年代待考', slotIndex: 0, modelKey: 'photo-plane', caption: '测试生成图片，不代表真实物主经历。',
      photoAssetId: photo.id, audioAssetId: audio.id, approximation: '合成验收图', sourceNotice: '仅自动化验收用途', rawStory: '', transcript: null, sourceSegments: [] };
    await error(await request(`/api/museums/${museumId}/exhibits`, 'POST', { ...fields, photoAssetId: foreign.id, expectedMuseumVersion: (await museum(museumId)).version }), 404, 'NOT_FOUND');
    const createdExhibit = await request(`/api/museums/${museumId}/exhibits`, 'POST', { ...fields, expectedMuseumVersion: (await museum(museumId)).version });
    assert.equal(createdExhibit.status, 201);
    const exhibit = exhibitDraftResponseSchema.parse(await createdExhibit.json()).data;
    const confirmed = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}/confirm`, 'POST', { expectedVersion: exhibit.version, confirmationNote: '明确确认本次合成验收样例。' });
    assert.equal(confirmed.status, 200);
    const publication = await request(`/api/museums/${museumId}/publish`, 'POST', { expectedVersion: (await museum(museumId)).version });
    assert.equal(publication.status, 200); const token = publishResponseSchema.parse(await publication.json()).data.token; assert.ok(token);
    const sharePath = `/api/share/${token}/assets/${photo.id}`;
    const audioPath = `/api/share/${token}/assets/${audio.id}`;
    await audioBody(audioPath);
    await error(await request(sharePath, 'GET', undefined, false), 401, 'UNAUTHORIZED');
    await error(await request(`${sharePath}?variant=thumbnail`, 'GET', undefined, false), 401, 'UNAUTHORIZED');
    await error(await request(audioPath, 'GET', undefined, false), 401, 'UNAUTHORIZED');
    assert.deepEqual(await imageBody(await request(sharePath)), displayed);
    await imageBody(await request(`${sharePath}?variant=thumbnail`));
    const badVariant = await error(await request(`${sharePath}?variant=original`), 404, 'SHARE_NOT_FOUND');
    const outside = await error(await request(`/api/share/${token}/assets/${replacement.id}`), 404, 'SHARE_NOT_FOUND');
    assert.equal(badVariant.message, outside.message);
    const edited = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}`, 'PATCH', { ...fields, photoAssetId: replacement.id, audioAssetId: replacementAudio.id, expectedVersion: exhibit.version });
    assert.equal(edited.status, 200);
    const updated = exhibitDraftResponseSchema.parse(await edited.json()).data;
    assert.deepEqual(await imageBody(await request(sharePath)), displayed);
    const removedExhibit = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}`, 'DELETE', { expectedVersion: updated.version });
    assert.equal(removedExhibit.status, 200);
    assert.deepEqual(await imageBody(await request(sharePath)), displayed);
    await audioBody(audioPath);
    const rotation = await request(`/api/museums/${museumId}/share`, 'POST', { expectedVersion: (await museum(museumId)).version });
    assert.equal(rotation.status, 200); const rotated = shareLinkResponseSchema.parse(await rotation.json()).data.token;
    const revoked = await error(await request(sharePath), 404, 'SHARE_NOT_FOUND');
    assert.equal(revoked.message, outside.message);
    await error(await request(audioPath), 404, 'SHARE_NOT_FOUND');
    await imageBody(await request(`/api/share/${rotated}/assets/${photo.id}`));
    const stop = await request(`/api/museums/${museumId}/share`, 'DELETE', { expectedVersion: (await museum(museumId)).version }); assert.equal(stop.status, 200);
    await error(await request(`/api/share/${rotated}/assets/${photo.id}`), 404, 'SHARE_NOT_FOUND');
    await error(await request(`/api/share/${rotated}/assets/${audio.id}`), 404, 'SHARE_NOT_FOUND');
  } finally {
    for (const id of museumIds) {
      const current = await museum(id);
      const removed = await request(`/api/museums/${id}`, 'DELETE', { expectedVersion: current.version });
      assert.equal(removed.status, 200);
    }
    if (cookie) assert.equal((await request('/api/auth/logout', 'POST')).status, 200);
  }
});
