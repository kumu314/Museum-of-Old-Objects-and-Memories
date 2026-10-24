import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test, type TestContext } from 'node:test';
import { z } from 'zod';
import {
  createHunyuan3DClient,
  Hunyuan3DError,
  validateGlb,
  type Hunyuan3DConfig,
} from '../../src/server/integrations/hunyuan3d';

function glb(json: unknown): Buffer {
  const source = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const jsonChunk = Buffer.alloc(jsonLength, 0x20);
  source.copy(jsonChunk);
  const total = 12 + 8 + jsonLength;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(jsonLength, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, jsonChunk]);
}

const minimalJson = { asset: { version: '2.0' }, meshes: [{}], materials: [{}], images: [] };

function makeConfig(endpoint: string, overrides: Partial<Hunyuan3DConfig> = {}): Hunyuan3DConfig {
  return {
    secretId: 'dummy-secret-id',
    secretKey: 'dummy-secret-key',
    region: 'ap-guangzhou',
    endpoint,
    timeoutMs: 2_000,
    maxDownloadBytes: 1024 * 1024,
    ...overrides,
  };
}

async function fakeServer(context: TestContext, handler: (request: IncomingMessage, response: ServerResponse, body: string) => void) {
  const requests: { action: string | undefined; authorization: string | undefined; body: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ action: request.headers['x-tc-action']?.toString(), authorization: request.headers.authorization?.toString(), body });
      handler(request, response, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { endpoint: `http://127.0.0.1:${address.port}/`, requests };
}

function sendJson(response: ServerResponse, value: unknown, status = 200) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(value));
}

test('提交请求使用 Pro 动作、TC3 签名、原始 base64 且不显式请求 ResultFormat', async (context) => {
  const server = await fakeServer(context, (_request, response) => {
    sendJson(response, { Response: { JobId: 'job-1', RequestId: 'request-1' } });
  });
  const client = createHunyuan3DClient(makeConfig(server.endpoint));
  const result = await client.submitImage({
    image: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/webp', width: 512, height: 512 },
    enablePbr: true,
    faceCount: 50_000,
  });
  assert.deepEqual(result, { jobId: 'job-1', requestId: 'request-1' });
  const request = server.requests[0];
  assert.ok(request);
  assert.equal(request.action, 'SubmitHunyuanTo3DProJob');
  assert.match(request.authorization ?? '', /^TC3-HMAC-SHA256 Credential=dummy-secret-id\//);
  assert.match(request.authorization ?? '', /SignedHeaders=content-type;host;x-tc-action/);
  assert.match(request.authorization ?? '', /Signature=[0-9a-f]{64}$/);
  const body = z.strictObject({ ImageBase64: z.string(), EnablePBR: z.boolean(), FaceCount: z.number() }).parse(JSON.parse(request.body));
  assert.equal(body.ImageBase64, Buffer.from([1, 2, 3, 4]).toString('base64'));
  assert.equal(body.EnablePBR, true);
  assert.equal(body.FaceCount, 50_000);
  assert.equal(Object.hasOwn(body, 'ResultFormat'), false);
});

test('查询任务并下载 GLB，返回边界统计', async (context) => {
  const server = await fakeServer(context, (request, response) => {
    if (request.url === '/model.glb') {
      response.end(glb(minimalJson));
      return;
    }
    sendJson(response, {
      Response: {
        Status: 'DONE',
        ResultCreditConsumed: 20,
        ResultFile3Ds: [
          { Type: 'OBJ', Url: 'http://example.invalid/model.obj' },
          { Type: 'GLB', Url: `${server.endpoint}model.glb`, PreviewImageUrl: 'http://example.invalid/preview.png' },
        ],
      },
    });
  });
  const client = createHunyuan3DClient(makeConfig(server.endpoint));
  const job = await client.queryJob('job-1');
  assert.equal(job.status, 'DONE');
  assert.equal(job.creditsConsumed, 20);
  const file = job.files.find((entry) => entry.type === 'GLB');
  assert.ok(file);
  const result = await client.downloadGlb(file);
  assert.equal(result.stats.meshCount, 1);
  assert.equal(result.stats.materialCount, 1);
  assert.equal(result.stats.imageCount, 0);
  const query = server.requests.find((entry) => entry.action === 'QueryHunyuanTo3DProJob');
  assert.ok(query);
  assert.equal(JSON.parse(query.body).JobId, 'job-1');
});

test('上游 API 错误、任务失败和缺失结果分别返回明确错误', async (context) => {
  let mode: 'api-error' | 'failed' | 'empty' = 'api-error';
  const server = await fakeServer(context, (_request, response) => {
    if (mode === 'api-error') {
      sendJson(response, { Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: 'bad signature' } } });
    } else if (mode === 'failed') {
      sendJson(response, { Response: { Status: 'FAIL', ErrorCode: 'FailedOperation', ErrorMessage: 'generation failed' } });
    } else {
      sendJson(response, { Response: { Status: 'DONE', ResultFile3Ds: [] } });
    }
  });
  const client = createHunyuan3DClient(makeConfig(server.endpoint));

  await assert.rejects(client.queryJob('job-1'), (error: unknown) => {
    assert.ok(error instanceof Hunyuan3DError);
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.equal(error.upstreamCode, 'AuthFailure.SignatureFailure');
    return true;
  });

  mode = 'failed';
  const failed = await client.queryJob('job-1');
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.errorCode, 'FailedOperation');

  mode = 'empty';
  await assert.rejects(client.queryJob('job-1'), (error: unknown) => {
    assert.ok(error instanceof Hunyuan3DError);
    assert.equal(error.code, 'RESULT_MISSING');
    return true;
  });
});

test('输入限制在发请求前失败，不把超限原图提交给供应商', async (context) => {
  const server = await fakeServer(context, (_request, response) => sendJson(response, { Response: { JobId: 'unexpected' } }));
  const client = createHunyuan3DClient(makeConfig(server.endpoint));
  await assert.rejects(client.submitImage({
    image: { bytes: new Uint8Array([1]), mime: 'image/webp', width: 64, height: 512 },
  }), (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INPUT_INVALID');
  await assert.rejects(client.submitImage({
    image: { bytes: new Uint8Array(6 * 1024 * 1024 + 1), mime: 'image/png', width: 512, height: 512 },
  }), (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INPUT_INVALID');
  assert.equal(server.requests.length, 0);
});

test('无响应请求超时，不自动重试', async (context) => {
  let count = 0;
  const server = await fakeServer(context, (request) => {
    count += 1;
    request.resume();
  });
  const client = createHunyuan3DClient(makeConfig(server.endpoint, { timeoutMs: 1_000 }));
  await assert.rejects(client.queryJob('job-1'), (error: unknown) => error instanceof Hunyuan3DError && error.code === 'TIMEOUT');
  assert.equal(count, 1);
});

test('GLB 校验拒绝 Draco、外部资源和损坏容器', () => {
  assert.throws(() => validateGlb(glb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }), 1024),
    (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INVALID_GLB');
  assert.throws(() => validateGlb(glb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.invalid/a.png' }] }), 1024),
    (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INVALID_GLB');
  assert.throws(() => validateGlb(Buffer.from('not a glb'), 1024),
    (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INVALID_GLB');
  const stats = validateGlb(glb(minimalJson), 1024);
  assert.equal(stats.meshCount, 1);
});
