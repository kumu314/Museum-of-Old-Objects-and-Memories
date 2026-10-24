import assert from 'node:assert/strict';
import dns from 'node:dns';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mock, test, type TestContext } from 'node:test';
import { z } from 'zod';
import {
  assertProviderResultUrl,
  createHunyuan3DClient,
  Hunyuan3DError,
  isRejectedIpAddress,
  validateGlb,
  type Hunyuan3DConfig,
  type HunyuanFile,
} from '../../src/server/integrations/hunyuan3d';

const TRIANGLE_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

/** 与展示端同一加载链（未配置解码器的 GLTFLoader）可解析的最小三角形 GLB。 */
function buildValidGlb(): { json: Record<string, unknown>; bin: Buffer } {
  const bin = Buffer.from(TRIANGLE_POSITIONS.buffer, TRIANGLE_POSITIONS.byteOffset, TRIANGLE_POSITIONS.byteLength);
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'hunyuan3d-tests' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  return { json, bin };
}

function glbFrom(json: unknown, bin?: Buffer): Buffer {
  const source = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const jsonChunk = Buffer.alloc(jsonLength, 0x20);
  source.copy(jsonChunk);
  const hasBin = bin !== undefined;
  const binLength = hasBin ? Math.ceil((bin as Buffer).length / 4) * 4 : 0;
  const binChunk = Buffer.alloc(binLength, 0);
  if (hasBin) (bin as Buffer).copy(binChunk);
  const total = 12 + 8 + jsonLength + (hasBin ? 8 + binLength : 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  if (!hasBin) return Buffer.concat([header, jsonHeader, jsonChunk]);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binLength, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

function validGlbBytes(): Buffer {
  const { json, bin } = buildValidGlb();
  return glbFrom(json, bin);
}

function glbFile(url: string): HunyuanFile {
  return { type: 'GLB', url };
}

function baseConfig(endpoint: string, overrides: Partial<Hunyuan3DConfig> = {}): Hunyuan3DConfig {
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

/** 仅允许本地假上游的下载策略：生产默认策略不会因测试放宽。 */
function loopbackPolicy(endpoint: string): (url: URL) => void {
  const origin = new URL(endpoint).origin;
  return (url) => {
    if (url.origin !== origin) throw new Hunyuan3DError('RESULT_URL_REJECTED', '测试策略只允许本地下载地址。');
  };
}

function testConfig(endpoint: string, overrides: Partial<Hunyuan3DConfig> = {}): Hunyuan3DConfig {
  return baseConfig(endpoint, { resultUrlPolicy: loopbackPolicy(endpoint), ...overrides });
}

async function fakeServer(context: TestContext, handler: (request: IncomingMessage, response: ServerResponse, body: string) => void) {
  const requests: { action: string | undefined; authorization: string | undefined; body: string; url: string | undefined }[] = [];
  const server = createServer((request, response) => {
    // Content-Length 与实际字节数不匹配等场景会产生套接字错误，吞掉以保护测试进程。
    request.on('error', () => {});
    response.on('error', () => {});
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        action: request.headers['x-tc-action']?.toString(),
        authorization: request.headers.authorization?.toString(),
        body,
        url: request.url,
      });
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

function rejectsCode(promise: Promise<unknown>, code: string) {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Hunyuan3DError, `期望 Hunyuan3DError(${code})，实际：${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

test('提交请求使用 Pro 动作、TC3 签名、原始 base64 且不显式请求 ResultFormat', async (context) => {
  const server = await fakeServer(context, (_request, response) => {
    sendJson(response, { Response: { JobId: 'job-1', RequestId: 'request-1' } });
  });
  const client = createHunyuan3DClient(testConfig(server.endpoint));
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

test('查询任务并下载 GLB，保留签名 query 并返回边界统计', async (context) => {
  const server = await fakeServer(context, (request, response) => {
    if (request.url === '/model.glb?sig=abc123') {
      response.end(validGlbBytes());
      return;
    }
    sendJson(response, {
      Response: {
        Status: 'DONE',
        ResultCreditConsumed: 20,
        ResultFile3Ds: [
          { Type: 'OBJ', Url: 'https://bucket-1.cos.ap-guangzhou.myqcloud.com/model.obj' },
          { Type: 'GLB', Url: `${server.endpoint}model.glb?sig=abc123`, PreviewImageUrl: 'https://bucket-1.cos.ap-guangzhou.myqcloud.com/preview.png' },
        ],
      },
    });
  });
  const client = createHunyuan3DClient(testConfig(server.endpoint));
  const job = await client.queryJob('job-1');
  assert.equal(job.status, 'DONE');
  assert.equal(job.creditsConsumed, 20);
  const file = job.files.find((entry) => entry.type === 'GLB');
  assert.ok(file);
  const result = await client.downloadGlb(file);
  assert.equal(result.stats.meshCount, 1);
  assert.equal(result.stats.materialCount, 0);
  assert.equal(result.stats.imageCount, 0);
  const download = server.requests.find((entry) => entry.url === '/model.glb?sig=abc123');
  assert.ok(download, '下载请求必须保留完整的 COS 签名 query');
  const query = server.requests.find((entry) => entry.action === 'QueryHunyuanTo3DProJob');
  assert.ok(query);
  assert.equal(JSON.parse(query.body).JobId, 'job-1');
});

test('校验通过的最小三角形能被项目当前 GLTFLoader 解析', async () => {
  const bytes = validGlbBytes();
  const stats = validateGlb(bytes, 1024 * 1024);
  assert.equal(stats.meshCount, 1);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(data, '');
  assert.equal(gltf.scene.children.length, 1);
});

test('校验通过的 unlit 材质模型同样能被 GLTFLoader 解析', async () => {
  const { json, bin } = buildValidGlb();
  const mesh0 = (json.meshes as Record<string, unknown>[])[0];
  assert.ok(mesh0);
  const primitive0 = (mesh0.primitives as Record<string, unknown>[])[0];
  assert.ok(primitive0);
  primitive0.material = 0;
  json.materials = [{ extensions: { KHR_materials_unlit: {} } }];
  json.extensionsUsed = ['KHR_materials_unlit'];
  json.extensionsRequired = ['KHR_materials_unlit'];
  const bytes = glbFrom(json, bin);
  const stats = validateGlb(bytes, 1024 * 1024);
  assert.equal(stats.materialCount, 1);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(data, '');
  assert.equal(gltf.scene.children.length, 1);
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
  const client = createHunyuan3DClient(testConfig(server.endpoint));

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
  await rejectsCode(client.queryJob('job-1'), 'RESULT_MISSING');
});

test('输入限制在发请求前失败，不把超限原图提交给供应商', async (context) => {
  const server = await fakeServer(context, (_request, response) => sendJson(response, { Response: { JobId: 'unexpected' } }));
  const client = createHunyuan3DClient(testConfig(server.endpoint));
  await rejectsCode(client.submitImage({
    image: { bytes: new Uint8Array([1]), mime: 'image/webp', width: 64, height: 512 },
  }), 'INPUT_INVALID');
  await rejectsCode(client.submitImage({
    image: { bytes: new Uint8Array(6 * 1024 * 1024 + 1), mime: 'image/png', width: 512, height: 512 },
  }), 'INPUT_INVALID');
  assert.equal(server.requests.length, 0);
});

test('无响应请求超时，不自动重试', async (context) => {
  let count = 0;
  const server = await fakeServer(context, (request) => {
    count += 1;
    request.resume();
  });
  const client = createHunyuan3DClient(testConfig(server.endpoint, { timeoutMs: 1_000 }));
  await rejectsCode(client.queryJob('job-1'), 'TIMEOUT');
  assert.equal(count, 1);
});

test('默认下载策略拒绝非 HTTPS、非 COS 来源与内网地址，不发请求', async (context) => {
  let received = 0;
  const server = await fakeServer(context, (request) => {
    received += 1;
    request.resume();
  });
  const client = createHunyuan3DClient(baseConfig(server.endpoint));
  for (const url of [
    'http://127.0.0.1/model.glb',
    'https://example.invalid/model.glb',
    'https://evil.cos.ap-guangzhou.myqcloud.com.evil.example/model.glb',
    'https://bucket.cos.ap-guangzhou.myqcloud.com:8443/model.glb',
    'https://user:pass@bucket-1.cos.ap-guangzhou.myqcloud.com/model.glb',
  ]) {
    await rejectsCode(client.downloadGlb(glbFile(url)), 'RESULT_URL_REJECTED');
  }
  assert.equal(received, 0);
});

test('默认下载策略要求解析结果全部为公网地址', async (context) => {
  const responses: dns.LookupAddress[][] = [
    [{ address: '1.2.3.4', family: 4 }],
    [{ address: '1.2.3.4', family: 4 }],
    [{ address: '1.2.3.4', family: 4 }],
    [{ address: '1.2.3.4', family: 4 }],
    [{ address: '1.2.3.4', family: 4 }, { address: '10.0.0.7', family: 4 }],
    [{ address: '::ffff:127.0.0.1', family: 6 }],
    [{ address: '169.254.169.254', family: 4 }],
  ];
  let call = 0;
  const lookupMock = mock.method(dns.promises, 'lookup', (
    _hostname: string,
    _options: dns.LookupAllOptions,
    callback?: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
  ): void | Promise<dns.LookupAddress[]> => {
    const result = responses[call];
    call += 1;
    if (result === undefined) {
      const error = Object.assign(new Error('EAI_NODATA'), { code: 'EAI_NODATA' });
      if (callback !== undefined) { callback(error, []); return; }
      return Promise.reject(error);
    }
    if (callback !== undefined) { callback(null, result); return; }
    return Promise.resolve(result);
  });
  context.after(() => { lookupMock.mock.restore(); });
  const host = 'https://bucket-1.cos.ap-guangzhou.myqcloud.com/model.glb?X-Cos-Signature=keep';
  await assertProviderResultUrl(new URL(host));
  for (const hostname of ['bucket-1.cos.ap-guangzhou.tencentcos.cn', 'cos.ap-guangzhou.tencentcos.cn', 'cos.ap-guangzhou.myqcloud.com']) {
    await assertProviderResultUrl(new URL(`https://${hostname}/model.glb`));
  }
  await rejectsCode(assertProviderResultUrl(new URL('https://bucket-1.cos.ap-guangzhou.myqcloud.com/model.glb')), 'RESULT_URL_REJECTED');
  await rejectsCode(assertProviderResultUrl(new URL('https://bucket-1.cos.ap-guangzhou.myqcloud.com/model.glb')), 'RESULT_URL_REJECTED');
  await rejectsCode(assertProviderResultUrl(new URL('https://bucket-1.cos.ap-guangzhou.myqcloud.com/model.glb')), 'RESULT_URL_REJECTED');
  assert.equal(call, 7);
});

test('私网地址判定覆盖环回、链路本地、映射 IPv6 与保留段', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1',
    '::ffff:10.0.0.1', '64:ff9b::192.0.2.1', '2001:db8::1', '2002:7f00:1::']) {
    assert.equal(isRejectedIpAddress(address), true, `${address} 应被拒绝`);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2402:4e00::1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isRejectedIpAddress(address), false, `${address} 应视为公网`);
  }
});

test('API 响应在读取过程中执行 1 MiB 字节上限', async (context) => {
  let mode: 'declared' | 'chunked' | 'exact' | 'empty' | 'invalid' = 'declared';
  let socketClosedEarly = false;
  const server = await fakeServer(context, (request, response) => {
    if (mode === 'declared') {
      response.setHeader('Content-Length', String(2 * 1024 * 1024));
      response.write('{"Resp');
      response.end();
      return;
    }
    if (mode === 'chunked') {
      request.socket.on('close', () => { if (!response.writableEnded) socketClosedEarly = true; });
      response.setHeader('Content-Type', 'application/json');
      response.write(Buffer.alloc(512 * 1024, 0x20));
      setTimeout(() => {
        response.write(Buffer.alloc(600 * 1024, 0x20));
        setTimeout(() => { try { response.end(Buffer.alloc(64 * 1024, 0x20)); } catch { /* 客户端已取消 */ } }, 120);
      }, 60);
      return;
    }
    if (mode === 'exact') {
      const body = Buffer.alloc(1024 * 1024, 0x20);
      body.write(JSON.stringify({ Response: { Status: 'RUN' } }));
      response.end(body);
      return;
    }
    if (mode === 'empty') {
      response.end();
      return;
    }
    response.end('not json');
  });
  const client = createHunyuan3DClient(testConfig(server.endpoint));

  await rejectsCode(client.queryJob('job-1'), 'UPSTREAM_ERROR');

  mode = 'chunked';
  await rejectsCode(client.queryJob('job-1'), 'UPSTREAM_ERROR');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(socketClosedEarly, true, '超过上限后必须在读取过程中终止连接');

  mode = 'exact';
  const exact = await client.queryJob('job-1');
  assert.equal(exact.status, 'RUN');

  mode = 'empty';
  await rejectsCode(client.queryJob('job-1'), 'UPSTREAM_ERROR');

  mode = 'invalid';
  await rejectsCode(client.queryJob('job-1'), 'UPSTREAM_ERROR');
});

test('GLB 下载同样在读取过程中执行大小上限', async (context) => {
  let mode: 'declared' | 'streamed' = 'declared';
  const server = await fakeServer(context, (_request, response) => {
    if (mode === 'declared') {
      response.setHeader('Content-Length', String(2 * 1024 * 1024));
      response.write('glTF');
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end(Buffer.alloc(1200, 1));
  });
  const client = createHunyuan3DClient(testConfig(server.endpoint, { maxDownloadBytes: 1024 }));
  await rejectsCode(client.downloadGlb(glbFile(`${server.endpoint}model.glb`)), 'DOWNLOAD_FAILED');
  mode = 'streamed';
  await rejectsCode(client.downloadGlb(glbFile(`${server.endpoint}model.glb`)), 'DOWNLOAD_FAILED');
});

test('根据状态码或声明长度拒绝响应后立即中止未读完的连接', async (context) => {
  let mode: 'http' | 'size' = 'http';
  let closed = 0;
  const server = await fakeServer(context, (_request, response) => {
    response.statusCode = mode === 'http' ? 503 : 200;
    response.setHeader('Content-Length', String(2 * 1024 * 1024));
    response.on('close', () => { closed += 1; });
    response.write('unfinished');
  });
  const client = createHunyuan3DClient(testConfig(server.endpoint));
  for (const current of ['http', 'size'] as const) {
    mode = current;
    await rejectsCode(client.queryJob('job-1'), 'UPSTREAM_ERROR');
    await rejectsCode(client.downloadGlb(glbFile(`${server.endpoint}model.glb`)), 'DOWNLOAD_FAILED');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(closed, current === 'http' ? 2 : 4, '拒绝响应后不能继续持有未读完的连接');
  }
});

test('GLB 校验拒绝必需解码扩展、漏声明使用、外部资源与损坏容器', () => {
  const { json, bin } = buildValidGlb();
  const cases: Record<string, unknown>[] = [
    { ...json, extensionsRequired: ['KHR_draco_mesh_compression'] },
    { ...json, extensionsRequired: ['EXT_meshopt_compression'] },
    { ...json, extensionsRequired: ['KHR_texture_basisu'] },
    { ...json, extensionsRequired: ['ACME_future_extension'] },
    // Meshopt 实际用于 bufferView 但未声明。
    { ...json, bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, extensions: { EXT_meshopt_compression: {} } }] },
    // Draco 实际用于 primitive 但未声明。
    { ...json, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, extensions: { KHR_draco_mesh_compression: {} } }] }] },
    // BasisU 实际用于 texture 但未声明。
    { ...json, textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }], images: [{ bufferView: 0, mimeType: 'image/ktx2' }] },
    { ...json, images: [{ uri: 'https://example.invalid/a.png' }] },
    { ...json, buffers: [{ uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }] },
  ];
  for (const [index, candidate] of cases.entries()) {
    assert.throws(() => validateGlb(glbFrom(candidate, bin), 1024 * 1024),
      (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INVALID_GLB',
      `第 ${index} 个用例应被拒绝`);
  }
  assert.throws(() => validateGlb(Buffer.from('not a glb'), 1024 * 1024),
    (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INVALID_GLB');
});

test('GLB 校验拒绝不可加载的引用结构', () => {
  const { json, bin } = buildValidGlb();
  const withoutScenes = { ...json };
  delete withoutScenes.scene;
  delete withoutScenes.scenes;
  const cases: Record<string, unknown>[] = [
    // 只有 meshes 没有 scenes/nodes。
    { asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bin.byteLength }] },
    // mesh 没有 primitives。
    { ...json, meshes: [{}] },
    // node 引用不存在的 mesh。
    { ...json, nodes: [{ mesh: 9 }] },
    // 默认 scene 索引越界。
    { ...json, scene: 5 },
    // accessor 超过 bufferView 边界。
    { ...json, accessors: [{ bufferView: 0, componentType: 5126, count: 9, type: 'VEC3' }] },
    // buffer 长度超过 BIN 分块。
    { ...json, buffers: [{ byteLength: bin.byteLength * 2 }] },
    // 缺少 BIN 分块。
    json,
    // POSITION 不是 FLOAT VEC3。
    { ...json, accessors: [{ bufferView: 0, componentType: 5123, count: 3, type: 'SCALAR' }] },
    // 节点引用成环。
    { ...json, nodes: [{ mesh: 0, children: [1] }, { children: [0] }] },
    // GLTFLoader 仅通过 scenes 建立可展示的场景，孤立 nodes 不能替代它。
    withoutScenes,
    // FLOAT 偏移未按四字节对齐，GLTFLoader 创建 TypedArray 时会失败。
    { ...json, accessors: [{ bufferView: 0, byteOffset: 1, componentType: 5126, count: 2, type: 'VEC3' }] },
  ];
  for (const [index, candidate] of cases.entries()) {
    const hasBin = candidate !== json;
    assert.throws(() => validateGlb(glbFrom(candidate, hasBin ? bin : undefined), 1024 * 1024),
      (error: unknown) => error instanceof Hunyuan3DError && error.code === 'INVALID_GLB',
      `第 ${index} 个结构用例应被拒绝`);
  }
});
