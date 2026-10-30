import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { privateFileResponse } from '../../src/server/assets/file-response';
import { parseByteRange } from '../../src/server/assets/range';
import { HttpError } from '../../src/server/http';

let workspace: string;
before(async () => { workspace = await mkdtemp(join(tmpdir(), 'museum-range-test-')); });
after(async () => { await rm(workspace, { recursive: true, force: true }); });

function request(range?: string): Request {
  return new Request('http://127.0.0.1/asset', range === undefined ? undefined : { headers: { Range: range } });
}

test('single byte ranges: explicit, open-ended, suffix, clamped and unsatisfiable', () => {
  assert.deepEqual(parseByteRange(null, 100), { kind: 'none' });
  assert.deepEqual(parseByteRange('bytes=0-9', 100), { kind: 'range', range: { start: 0, end: 9 } });
  assert.deepEqual(parseByteRange('bytes=90-', 100), { kind: 'range', range: { start: 90, end: 99 } });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { kind: 'range', range: { start: 90, end: 99 } });
  // 客户端把 end 写过文件末尾：按 RFC 截到最后字节，不报错。
  assert.deepEqual(parseByteRange('bytes=0-999', 100), { kind: 'range', range: { start: 0, end: 99 } });
  assert.deepEqual(parseByteRange('bytes=100-', 100), { kind: 'unsatisfiable' });
  assert.deepEqual(parseByteRange('bytes=5-2', 100), { kind: 'unsatisfiable' });
  assert.deepEqual(parseByteRange('bytes=-0', 100), { kind: 'unsatisfiable' });
  assert.deepEqual(parseByteRange('bytes=0-', 0), { kind: 'unsatisfiable' });
  // 多段范围与语法错误按 RFC 允许忽略，回完整 200，而不是把播放器判死。
  assert.deepEqual(parseByteRange('bytes=0-1,4-5', 100), { kind: 'none' });
  assert.deepEqual(parseByteRange('bytes=abc', 100), { kind: 'none' });
  assert.deepEqual(parseByteRange('bytes=-', 100), { kind: 'none' });
});

test('full response keeps content type and advertises range support', async () => {
  const path = join(workspace, 'display.mp3');
  await writeFile(path, Buffer.from(Array.from({ length: 100 }, (_, index) => index)));
  const response = await privateFileResponse({ request: request(), path, contentType: 'audio/mpeg', onMissing: () => { throw new Error('unexpected'); } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-length'), '100');
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(Array.from({ length: 100 }, (_, index) => index)));
});

test('range requests return 206 with an exact Content-Range and sliced body', async () => {
  const path = join(workspace, 'display.wav');
  await writeFile(path, Buffer.from(Array.from({ length: 100 }, (_, index) => index)));
  const first = await privateFileResponse({ request: request('bytes=0-9'), path, contentType: 'audio/wav', onMissing: () => { throw new Error('unexpected'); } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('content-range'), 'bytes 0-9/100');
  assert.equal(first.headers.get('content-length'), '10');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  const suffix = await privateFileResponse({ request: request('bytes=-10'), path, contentType: 'audio/wav', onMissing: () => { throw new Error('unexpected'); } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get('content-range'), 'bytes 90-99/100');
  assert.equal((await suffix.arrayBuffer()).byteLength, 10);
});

test('unsatisfiable range returns 416 with the total size and no body', async () => {
  const path = join(workspace, 'display.webp');
  await writeFile(path, Buffer.alloc(100));
  const response = await privateFileResponse({ request: request('bytes=200-300'), path, contentType: 'image/webp', onMissing: () => { throw new Error('unexpected'); } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */100');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('empty files and multipart ranges stay valid whole-file responses', async () => {
  const path = join(workspace, 'empty.bin');
  await writeFile(path, Buffer.alloc(0));
  const empty = await privateFileResponse({ request: request(), path, contentType: 'application/octet-stream', onMissing: () => { throw new Error('unexpected'); } });
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('content-length'), '0');

  await writeFile(path, Buffer.alloc(8));
  const multi = await privateFileResponse({ request: request('bytes=0-1,4-5'), path, contentType: 'application/octet-stream', onMissing: () => { throw new Error('unexpected'); } });
  assert.equal(multi.status, 200);
  assert.equal(multi.headers.get('content-length'), '8');
});

test('missing files surface the caller-provided not-found error, not a filesystem error', async () => {
  const path = join(workspace, 'absent.glb');
  await assert.rejects(
    privateFileResponse({ request: request(), path, contentType: 'model/gltf-binary', onMissing: () => { throw new HttpError({ code: 'NOT_FOUND', message: '未找到该内容。' }); } }),
    (error: unknown) => error instanceof HttpError && error.failure.code === 'NOT_FOUND',
  );
});
