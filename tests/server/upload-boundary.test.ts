import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadLimits } from '../../src/contracts/assets';
import { readAssetUpload, drainTimeoutMs } from '../../src/server/core/assets';
import { HttpError } from '../../src/server/http';

// 与 readAssetUpload 内部使用的上限保持一致：音频上限 + multipart 表单开销。
const multipartLimit = uploadLimits.audioBytes + 65_536;

function tooLarge(error: unknown) {
  assert.ok(error instanceof HttpError, `应抛出 HttpError，实际 ${String(error)}`);
  assert.equal(error.failure.code, 'PAYLOAD_TOO_LARGE');
  return true;
}

/** 声明超限的流式请求；body 由用例自己控制生产与结束时机。 */
function streamingRequest(stream: ReadableStream<Uint8Array>, declared: number) {
  return new Request('http://127.0.0.1/upload', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': String(declared) },
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

test('超限后客户端停传：到达丢弃时间上限即返回 413，且主动终止这条流', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true; },
  });
  const started = Date.now();
  await assert.rejects(readAssetUpload(streamingRequest(stream, multipartLimit + 1)), tooLarge);
  const elapsed = Date.now() - started;
  // 不带时间边界时这里会永远挂着，这正是被指出的第一处缺口。
  assert.ok(elapsed >= drainTimeoutMs - 200, `不应早于时间上限结束，实际 ${elapsed}ms`);
  assert.ok(elapsed < drainTimeoutMs + 5_000, `不应远超时间上限，实际 ${elapsed}ms`);
  assert.equal(cancelled, true, '没读到流结束就必须取消流，而不是只释放读锁');
});

test('丢弃超过上限：立刻终止，不把无底洞读完', async () => {
  let cancelled = false;
  let produced = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { produced += chunk.byteLength; controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readAssetUpload(streamingRequest(stream, multipartLimit + 1)), tooLarge);
  assert.equal(cancelled, true, '超过丢弃上限必须终止连接');
  // 只读到 2 倍上限附近就该停，不会无限生产。
  assert.ok(produced <= multipartLimit * 3, `丢弃应停在 2 倍上限附近，实际生产 ${produced} 字节`);
});

test('超限但请求体正常读完：返回 413，且不需要取消已读完的流', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4096));
      controller.enqueue(new Uint8Array(4096));
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readAssetUpload(streamingRequest(stream, multipartLimit + 1)), tooLarge);
  assert.equal(cancelled, false, '流已读完时取消是多余动作');
});

test('流式累加才发现超限：同样按超限处理并终止流', async () => {
  let cancelled = false;
  const block = new Uint8Array(1024 * 1024);
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      produced += block.byteLength;
      controller.enqueue(block);
      // 不 close：模拟客户端一直发、但服务端中途判定超限
      if (produced > multipartLimit * 4) controller.close();
    },
    cancel() { cancelled = true; },
  });
  // 声明值故意不超限，走流式累加路径
  await assert.rejects(readAssetUpload(streamingRequest(stream, 1_000)), tooLarge);
  assert.equal(cancelled, true, '流式超限后同样不能留下未消费的连接');
});

test('未超限的上传不受影响：正常解析出文件名与 MIME', async () => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(1024)], { type: 'image/png' }), 'photo.png');
  const request = new Request('http://127.0.0.1/upload', { method: 'POST', body: form, duplex: 'half' } as RequestInit);
  const input = await readAssetUpload(request);
  assert.equal(input.originalName, 'photo.png');
  assert.equal(input.mime, 'image/png');
  assert.equal(input.inputBuffer.length, 1024);
});
