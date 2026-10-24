import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkGlbContainer, glbModelSourceSchema, modelBudget, readModelResponse, resolveModelUrl } from './glb-model';

function glb(document: unknown): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const size = Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + size); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(json, 20); return bytes.buffer;
}
const emptyScene = { asset: { version: '2.0' }, scenes: [{ nodes: [] }] };

test('已有三个模型通过 GLB 内嵌资源检查，损坏长度被拒绝', async () => {
  for (const key of ['camera-01', 'cassette', 'ticket']) {
    const bytes = await readFile(new URL(`./assets/${key}.glb`, import.meta.url));
    const buffer = Uint8Array.from(bytes).buffer;
    assert.doesNotThrow(() => checkGlbContainer(buffer));
    assert.throws(() => checkGlbContainer(buffer.slice(0, buffer.byteLength - 1)), /GLB/);
  }
});

test('拒绝外链几何、外链贴图及非内嵌图片，避免加载器额外发起请求', () => {
  assert.doesNotThrow(() => checkGlbContainer(glb(emptyScene)));
  for (const addition of [
    { buffers: [{ uri: 'https://example.com/private.bin' }] },
    { buffers: [{ uri: 'data:application/octet-stream;base64,AA==' }] },
    { images: [{ uri: '/another-private-photo.png' }] },
    { images: [{ mimeType: 'image/png' }] },
  ]) assert.throws(() => checkGlbContainer(glb({ ...emptyScene, ...addition })), /内嵌/);
  assert.throws(() => checkGlbContainer(new ArrayBuffer(8)), /GLB/);
});

test('模型读取限定同源且不接受内嵌凭据、文件地址或第三方地址', () => {
  const base = 'https://museum.test/studio/1';
  assert.equal(resolveModelUrl('/api/models/1', base), 'https://museum.test/api/models/1');
  for (const url of ['https://other.test/file.glb', 'file:///tmp/model.glb', 'data:application/octet-stream;base64,AA==', 'https://user:password@museum.test/file.glb']) {
    assert.throws(() => resolveModelUrl(url, base), /本站/);
  }
  assert.equal(glbModelSourceSchema.safeParse({ assetId: 'asset', version: '', url: '/model' }).success, false);
});

test('无 Content-Length 的超限流仍被取消，不将整个文件交给解析器', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(modelBudget.bytes + 1)); }, cancel() { canceled = true; } });
  // 用预算常量断言，避免调整上限时文案漂移导致测试失败。
  const limitMiB = modelBudget.bytes / (1024 * 1024);
  await assert.rejects(readModelResponse(new Response(body), new AbortController().signal), new RegExp(`${limitMiB} MiB`));
  assert.equal(canceled, true);
});

test('响应头已超限或请求预先取消时同样关闭响应流', async () => {
  for (const preAborted of [false, true]) {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
    const abort = new AbortController();
    if (preAborted) abort.abort();
    const response = new Response(body, { headers: preAborted ? {} : { 'content-length': String(modelBudget.bytes + 1) } });
    await assert.rejects(readModelResponse(response, abort.signal));
    assert.equal(canceled, true);
  }
});

test('取消等待中的模型读取会终止流；失败响应不能伪装成可用模型', async () => {
  let canceled = false;
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  const pending = readModelResponse(new Response(body), abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(canceled, true);
  await assert.rejects(readModelResponse(new Response('not found', { status: 404 }), new AbortController().signal), /404/);
});
