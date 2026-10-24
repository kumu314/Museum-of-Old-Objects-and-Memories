import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  assetResponseSchema, errorResponseSchema, exhibitDraftResponseSchema,
  museumDraftResponseSchema, publishResponseSchema, sessionResponseSchema, type Asset,
} from '../../src/contracts';

const configuredBase = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
if (!configuredBase || !username || !password) {
  throw new Error('E2E_BASE_URL, E2E_USERNAME and E2E_PASSWORD are required.');
}
const base = new URL(configuredBase);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Media acceptance requires an explicitly prepared loopback server.');
}
const origin = base.origin;
const executeFile = promisify(execFile);

test('六格式HTTP验收：真实编码文件上传、私有读取、快照读取和撤销', { timeout: 180_000 }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'shiwuguan-media-http-'));
  let cookie = '';
  let museumId: string | undefined;
  async function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
    return fetch(new URL(path, origin), {
      method,
      headers: { Origin: origin, ...(authenticated && cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  }
  async function museum() {
    assert.ok(museumId);
    const response = await request(`/api/museums/${museumId}`);
    assert.equal(response.status, 200);
    return museumDraftResponseSchema.parse(await response.json()).data;
  }
  async function expectError(response: Response, status: number, code: string) {
    assert.equal(response.status, status);
    assert.equal(errorResponseSchema.parse(await response.json()).error.code, code);
  }
  function assertPrivateHeaders(response: Response, contentType: string) {
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), contentType);
  }
  async function upload(bytes: Buffer, name: string, mime: string): Promise<Asset> {
    assert.ok(museumId);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    const response = await fetch(new URL(`/api/museums/${museumId}/assets`, origin), {
      method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: form,
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 201);
    const value: unknown = await response.json();
    const asset = assetResponseSchema.parse(value).data;
    assert.ok(!JSON.stringify(value).includes('storageKey'));
    return asset;
  }
  async function imageBytes(response: Response, width: number, height: number) {
    assert.equal(response.status, 200);
    assertPrivateHeaders(response, 'image/webp');
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.deepEqual([metadata.width, metadata.height], [width, height]);
    for (const name of ['exif', 'xmp', 'iptc', 'icc', 'orientation'] as const) {
      assert.equal(metadata[name], undefined);
    }
    return bytes;
  }

  const images: { asset: Asset; displayed: Buffer; width: number; height: number }[] = [];
  const audio: { asset: Asset; input: Buffer }[] = [];
  try {
    const login = await request('/api/auth/login', 'POST', { username, password }, false);
    assert.equal(login.status, 200);
    sessionResponseSchema.parse(await login.json());
    cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    assert.ok(cookie);
    const created = await request('/api/museums', 'POST', {
      title: `D六格式验收 ${randomUUID()}`, description: '合成编码测试文件，不含真实物主素材。',
    });
    assert.equal(created.status, 201);
    museumId = museumDraftResponseSchema.parse(await created.json()).data.id;

    for (const format of ['jpeg', 'png', 'webp'] as const) {
      await context.test(`${format} 上传后展示图和缩略图可解码且无敏感元数据`, async () => {
        let pipeline = sharp({ create: { width: 96, height: 48, channels: 3, background: '#b48e5c' } });
        if (format === 'jpeg') {
          pipeline = pipeline.withMetadata({ orientation: 6 }).withExifMerge({
            IFD0: { Make: 'SYNTHETIC-DEVICE' },
            IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 12/1 0/1' },
          });
        }
        const bytes = await pipeline.toFormat(format).toBuffer();
        const original = Buffer.from(bytes);
        const asset = await upload(bytes, `fixture.${format === 'jpeg' ? 'jpg' : format}`, `image/${format}`);
        assert.equal(asset.kind, 'image');
        const width = format === 'jpeg' ? 48 : 96;
        const height = format === 'jpeg' ? 96 : 48;
        const path = `/api/museums/${museumId}/assets/${asset.id}`;
        await expectError(await request(path, 'GET', undefined, false), 401, 'UNAUTHORIZED');
        const displayed = await imageBytes(await request(path), width, height);
        await imageBytes(await request(`${path}?variant=thumbnail`), width, height);
        await expectError(await request(`${path}?variant=original`), 404, 'NOT_FOUND');
        assert.deepEqual(bytes, original);
        images.push({ asset, displayed, width, height });
      });
    }
    assert.equal(images.length, 3);

    for (const [format, codec, mime] of [
      ['mp3', 'libmp3lame', 'audio/mpeg'], ['m4a', 'aac', 'audio/mp4'], ['wav', 'pcm_s16le', 'audio/wav'],
    ] as const) {
      await context.test(`${format} 上传读取字节一致且完整音轨可解码`, async () => {
        const path = join(directory, `input.${format}`);
        await executeFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000',
          '-t', '0.4', '-c:a', codec, path], { timeout: 15_000 });
        const input = await readFile(path);
        const asset = await upload(input, `voice.${format}`, mime);
        assert.equal(asset.kind, 'audio');
        const response = await request(`/api/museums/${museumId}/assets/${asset.id}`);
        assert.equal(response.status, 200);
        assertPrivateHeaders(response, mime);
        const fetched = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(fetched, input);
        const fetchedPath = join(directory, `fetched.${format}`);
        await writeFile(fetchedPath, fetched, { flag: 'wx' });
        await executeFile('ffmpeg', ['-v', 'error', '-xerror', '-i', fetchedPath, '-f', 'null', '-'], { timeout: 15_000 });
        audio.push({ asset, input });
      });
    }
    assert.equal(audio.length, 3);

    for (let index = 0; index < 3; index += 1) {
      const photo = images[index]; const voice = audio[index];
      assert.ok(photo); assert.ok(voice);
      const exhibitResponse = await request(`/api/museums/${museumId}/exhibits`, 'POST', {
        name: `媒体验收 ${index + 1}`, era: '合成测试', slotIndex: index, modelKey: 'photo-plane',
        caption: '合成媒体文件，仅用于验证上传、读取与分享撤销。', photoAssetId: photo.asset.id, audioAssetId: voice.asset.id,
        approximation: '实拍薄片验收', sourceNotice: '合成图与正弦波，不含物主内容。', rawStory: '', transcript: null,
        sourceSegments: [], expectedMuseumVersion: (await museum()).version,
      });
      assert.equal(exhibitResponse.status, 201);
      const exhibit = exhibitDraftResponseSchema.parse(await exhibitResponse.json()).data;
      const confirmed = await request(`/api/museums/${museumId}/exhibits/${exhibit.id}/confirm`, 'POST', {
        expectedVersion: exhibit.version, confirmationNote: '明确确认本次合成媒体验收版本。',
      });
      assert.equal(confirmed.status, 200);
    }
    const publication = await request(`/api/museums/${museumId}/publish`, 'POST', { expectedVersion: (await museum()).version });
    assert.equal(publication.status, 200);
    const token = publishResponseSchema.parse(await publication.json()).data.token;
    assert.ok(token);
    for (const photo of images) {
      const path: string = `/api/share/${token}/assets/${photo.asset.id}`;
      await expectError(await request(path, 'GET', undefined, false), 401, 'UNAUTHORIZED');
      assert.deepEqual(await imageBytes(await request(path), photo.width, photo.height), photo.displayed);
      await imageBytes(await request(`${path}?variant=thumbnail`), photo.width, photo.height);
    }
    for (const voice of audio) {
      await expectError(await request(`/api/share/${token}/assets/${voice.asset.id}`, 'GET', undefined, false), 401, 'UNAUTHORIZED');
      const response = await request(`/api/share/${token}/assets/${voice.asset.id}`);
      assert.equal(response.status, 200);
      assertPrivateHeaders(response, voice.asset.contentType);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), voice.input);
    }
    const stopped = await request(`/api/museums/${museumId}/share`, 'DELETE', { expectedVersion: (await museum()).version });
    assert.equal(stopped.status, 200);
    for (const { asset } of [...images, ...audio]) {
      await expectError(await request(`/api/share/${token}/assets/${asset.id}`), 404, 'SHARE_NOT_FOUND');
    }
  } finally {
    try {
      if (museumId && cookie) {
        const current = await museum();
        const removed = await request(`/api/museums/${museumId}`, 'DELETE', { expectedVersion: current.version });
        assert.equal(removed.status, 200);
      }
    } finally {
      try {
        if (cookie) assert.equal((await request('/api/auth/logout', 'POST')).status, 200);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});
