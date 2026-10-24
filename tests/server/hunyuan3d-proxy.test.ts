import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test, type TestContext } from 'node:test';
import {
  createHunyuanWebProxyClient,
  Hunyuan3DError,
  type HunyuanProxyConfig,
} from '../../src/server/integrations/hunyuan3d-proxy';

const TRIANGLE_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

function buildGlbJson(withMaterial: boolean): Record<string, unknown> {
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'hunyuan3d-proxy-tests' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: TRIANGLE_POSITIONS.byteLength }],
    buffers: [{ byteLength: TRIANGLE_POSITIONS.byteLength }],
  };
  if (withMaterial) {
    const meshes = json.meshes as Record<string, unknown>[];
    const mesh0 = meshes[0];
    assert.ok(mesh0);
    mesh0.primitives = [{ attributes: { POSITION: 0 }, material: 0 }];
    json.materials = [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.4, 1] } }];
  }
  return json;
}

function glbBytes(withMaterial: boolean): Buffer {
  const json = buildGlbJson(withMaterial);
  const bin = Buffer.from(TRIANGLE_POSITIONS.buffer, TRIANGLE_POSITIONS.byteOffset, TRIANGLE_POSITIONS.byteLength);
  const source = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const jsonChunk = Buffer.alloc(jsonLength, 0x20);
  source.copy(jsonChunk);
  const binLength = Math.ceil(bin.length / 4) * 4;
  const binChunk = Buffer.alloc(binLength, 0);
  bin.copy(binChunk);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  return Buffer.concat([
    header,
    (() => { const h = Buffer.alloc(8); h.writeUInt32LE(jsonLength, 0); h.writeUInt32LE(0x4e4f534a, 4); return h; })(),
    jsonChunk,
    (() => { const h = Buffer.alloc(8); h.writeUInt32LE(binLength, 0); h.writeUInt32LE(0x004e4942, 4); return h; })(),
    binChunk,
  ]);
}

type ProxyState = {
  loggedIn: boolean;
  geometryStatus: number;
  geometryError?: { errorCode: string; errorMsg: string } | undefined;
  textureStatus: number | null;
  textureSubmitCount: number;
  textureSubmitShouldFail: boolean;
  submitErrNo?: number;
  uploadInfo?: Record<string, unknown>;
};

type Recorded = { method: string | undefined; url: string | undefined; body: string; headers: Record<string, string | string[] | undefined> };

async function fakeServer(context: TestContext, handler: (request: IncomingMessage, response: ServerResponse, body: string) => void) {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    request.on('error', () => {});
    response.on('error', () => {});
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: request.method,
        url: request.url,
        body,
        headers: request.headers,
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
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}

function makeConfig(proxyOrigin: string, cosOrigin: string, overrides: Partial<HunyuanProxyConfig> = {}): HunyuanProxyConfig {
  return {
    baseUrl: proxyOrigin,
    timeoutMs: 2_000,
    maxDownloadBytes: 1024 * 1024,
    resultUrlPolicy: (url) => {
      if (url.origin !== new URL(cosOrigin).origin) {
        throw new Hunyuan3DError('RESULT_URL_REJECTED', '测试策略只允许本地下载地址。');
      }
    },
    ...overrides,
  };
}

function rejectsCode(promise: Promise<unknown>, code: string) {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Hunyuan3DError, `期望 Hunyuan3DError(${code})，实际：${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

test('完整链路：登录预检、COS 上传、几何提交、自动接续纹理、下载成品 GLB', async (context) => {
  const state: ProxyState = {
    loggedIn: true,
    geometryStatus: 0,
    textureStatus: null,
    textureSubmitCount: 0,
    textureSubmitShouldFail: false,
  };
  let cosPutBody: Buffer | undefined;
  let cosPutHeaders: Record<string, string | string[] | undefined> | undefined;

  const cos = await fakeServer(context, (request, response, body) => {
    if (request.method === 'PUT') {
      cosPutBody = Buffer.from(body, 'utf8');
      cosPutHeaders = request.headers;
      response.statusCode = 200;
      response.end();
      return;
    }
    response.end(glbBytes(true));
  });

  const proxy = await fakeServer(context, (request, response, body) => {
    const url = request.url ?? '';
    if (url === '/api/login/status') {
      response.end(JSON.stringify({ ok: true, data: { loggedIn: state.loggedIn } }));
      return;
    }
    if (url === '/api/3d/resource/genUploadInfo') {
      response.end(JSON.stringify({
        ok: true,
        data: state.uploadInfo ?? {
          encryptTmpSecretId: 'tmp-id',
          encryptTmpSecretKey: 'tmp-key',
          sessionToken: 'tmp-token',
          bucketName: 'bucket-1',
          region: 'ap-guangzhou',
          location: 'upload/abc.png',
          resourceUrl: `${cos.origin}/upload/abc.png`,
        },
      }));
      return;
    }
    if (url === '/game3d/geometry_generation/image2geometry') {
      if (state.submitErrNo !== undefined) {
        response.end(JSON.stringify({ errNo: state.submitErrNo, errMsg: '输入参数错误', data: null }));
        return;
      }
      response.end(JSON.stringify({ errNo: 0, errMsg: '', data: { worksId: 'geo-1' } }));
      return;
    }
    if (url === '/game3d/general_info/get_works_list') {
      const parsed = JSON.parse(body) as { worksIds?: string[]; worksPipeline?: number };
      if (Array.isArray(parsed.worksIds)) {
        response.end(JSON.stringify({
          errNo: 0, errMsg: '',
          data: { list: [{ worksId: 'geo-1', pipelineStatus: state.geometryStatus, ...state.geometryError }] },
        }));
        return;
      }
      const list = state.textureStatus === null ? [] : [{
        worksId: 'tex-1',
        pipelineStatus: state.textureStatus,
        dependonWorksInfo: { worksId: 'geo-1' },
        modelInfo: { texturePaintingRsp: { glbUrl: `${cos.origin}/model.glb`, pbrImageUrl: `${cos.origin}/pbr.png` } },
      }];
      response.end(JSON.stringify({ errNo: 0, errMsg: '', data: { list } }));
      return;
    }
    if (url === '/api/text3d/texture') {
      state.textureSubmitCount += 1;
      if (state.textureSubmitShouldFail) {
        response.statusCode = 500;
        response.end(JSON.stringify({ ok: false, error: 'upstream busy' }));
        return;
      }
      response.end(JSON.stringify({ ok: true, data: { worksId: 'tex-1', method: 'image' } }));
      return;
    }
    if (url === '/game3d/general_info/get_remaining_times') {
      response.end(JSON.stringify({ errNo: 0, errMsg: '', data: { remainingTimes: 7 } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin));
  const input = {
    image: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' as const, width: 512, height: 512 },
  };

  const submitted = await client.submitImage(input);
  assert.deepEqual(submitted, { jobId: 'geo-1' });

  const genUpload = proxy.requests.find((entry) => entry.url === '/api/3d/resource/genUploadInfo');
  assert.ok(genUpload);
  assert.match(genUpload.body, /"fileName":"hunyuan-input-/);
  const cosPut = cos.requests.find((entry) => entry.method === 'PUT');
  assert.ok(cosPut, '必须直接向 COS 发起 PUT 上传');
  assert.equal(cosPut.url, '/upload/abc.png');
  assert.equal(cosPutBody?.byteLength, 4);
  assert.equal(cosPutHeaders?.['x-cos-security-token'], 'tmp-token');
  assert.match(String(cosPutHeaders?.authorization ?? ''), /^q-sign-algorithm=sha1&q-ak=tmp-id&/);

  const geometry = proxy.requests.find((entry) => entry.url === '/game3d/geometry_generation/image2geometry');
  assert.ok(geometry);
  const geometryBody = JSON.parse(geometry.body) as Record<string, unknown>;
  assert.equal(geometryBody.singleImage, `${cos.origin}/upload/abc.png`);
  assert.equal(geometryBody.modelVersion, 'v3.1');
  assert.equal(geometryBody.faceCount, 500_000);

  assert.equal((await client.queryJob('geo-1')).status, 'WAIT');
  state.geometryStatus = 1;
  assert.equal((await client.queryJob('geo-1')).status, 'RUN');
  assert.equal(state.textureSubmitCount, 0, '几何未完成时不得发起纹理阶段');

  state.geometryStatus = 2;
  assert.equal((await client.queryJob('geo-1')).status, 'RUN');
  assert.equal(state.textureSubmitCount, 1, '几何完成后自动接续一次纹理阶段');
  const textureCall = proxy.requests.find((entry) => entry.url === '/api/text3d/texture');
  assert.ok(textureCall);
  const textureBody = JSON.parse(textureCall.body) as Record<string, unknown>;
  assert.equal(textureBody.worksId, 'geo-1');
  assert.equal(textureBody.method, 'image');
  assert.equal(textureBody.modelVersion, 'v3.1');

  // 纹理作品尚未出现在列表中：再次轮询不得重复提交。
  assert.equal((await client.queryJob('geo-1')).status, 'RUN');
  assert.equal(state.textureSubmitCount, 1);

  state.textureStatus = 1;
  assert.equal((await client.queryJob('geo-1')).status, 'RUN');
  state.textureStatus = 2;
  const done = await client.queryJob('geo-1');
  assert.equal(done.status, 'DONE');
  assert.equal(done.files[0]?.type, 'GLB');
  assert.equal(done.files[0]?.url, `${cos.origin}/model.glb`);

  const resultFile = done.files[0];
  assert.ok(resultFile);
  const download = await client.downloadGlb(resultFile);
  assert.equal(download.stats.materialCount, 1);
  assert.equal(download.stats.meshCount, 1);

  assert.equal(await client.remainingTimes(), 7);
});

test('白模（materials=0）即使下载成功也按无效结果拒绝', async (context) => {
  const cos = await fakeServer(context, (_request, response) => {
    response.end(glbBytes(false));
  });
  const proxy = await fakeServer(context, () => {});
  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin));
  await rejectsCode(client.downloadGlb({ type: 'GLB', url: `${cos.origin}/model.glb` }), 'INVALID_GLB');
});

test('反代会话未登录时受控失败，不发任何生成请求', async (context) => {
  let submitCalls = 0;
  const proxy = await fakeServer(context, (request, response) => {
    const url = request.url ?? '';
    if (url === '/api/login/status') {
      response.end(JSON.stringify({ ok: true, data: { loggedIn: false } }));
      return;
    }
    if (url === '/game3d/geometry_generation/image2geometry') submitCalls += 1;
    response.end(JSON.stringify({ ok: true, data: null }));
  });
  const cos = await fakeServer(context, () => {});
  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin));
  await rejectsCode(client.submitImage({
    image: { bytes: new Uint8Array([1]), mime: 'image/jpeg' as const, width: 256, height: 256 },
  }), 'CONFIG_INVALID');
  assert.equal(submitCalls, 0);
});

test('上游 errNo 拒绝映射为 UPSTREAM_ERROR 并保留错误码', async (context) => {
  const state: ProxyState = {
    loggedIn: true, geometryStatus: 0, textureStatus: null,
    textureSubmitCount: 0, textureSubmitShouldFail: false, submitErrNo: 200002,
  };
  const proxy = await fakeServer(context, (request, response) => {
    const url = request.url ?? '';
    if (url === '/api/login/status') {
      response.end(JSON.stringify({ ok: true, data: { loggedIn: true } }));
      return;
    }
    if (url === '/api/3d/resource/genUploadInfo') {
      response.end(JSON.stringify({
        ok: true,
        data: {
          encryptTmpSecretId: 'id', encryptTmpSecretKey: 'key', sessionToken: 'tok',
          bucketName: 'b', region: 'ap-guangzhou', location: 'u/x.png', resourceUrl: `${cos.origin}/u/x.png`,
        },
      }));
      return;
    }
    response.end(JSON.stringify({ errNo: state.submitErrNo, errMsg: '输入参数错误', data: null }));
  });
  const cos = await fakeServer(context, (request, response) => {
    response.statusCode = 200;
    response.end(request.method === 'PUT' ? '' : 'x');
  });
  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin));
  await assert.rejects(client.submitImage({
    image: { bytes: new Uint8Array([1]), mime: 'image/jpeg' as const, width: 256, height: 256 },
  }), (error: unknown) => {
    assert.ok(error instanceof Hunyuan3DError);
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.equal(error.upstreamCode, '200002');
    return true;
  });
});

test('上传凭证缺少临时密钥字段时受控失败，不盲目上传', async (context) => {
  const proxy = await fakeServer(context, (request, response) => {
    const url = request.url ?? '';
    if (url === '/api/login/status') {
      response.end(JSON.stringify({ ok: true, data: { loggedIn: true } }));
      return;
    }
    response.end(JSON.stringify({ ok: true, data: { bucketName: 'b', region: 'r', location: 'k' } }));
  });
  const cos = await fakeServer(context, () => {});
  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin));
  await rejectsCode(client.submitImage({
    image: { bytes: new Uint8Array([1]), mime: 'image/jpeg' as const, width: 256, height: 256 },
  }), 'UPSTREAM_ERROR');
});

test('HTTPS 上传地址必须命中腾讯 COS 来源', async (context) => {
  const proxy = await fakeServer(context, (request, response) => {
    const url = request.url ?? '';
    if (url === '/api/login/status') {
      response.end(JSON.stringify({ ok: true, data: { loggedIn: true } }));
      return;
    }
    if (url === '/api/3d/resource/genUploadInfo') {
      response.end(JSON.stringify({
        ok: true,
        data: {
          encryptTmpSecretId: 'id', encryptTmpSecretKey: 'key',
          resourceUrl: 'https://evil.example/upload/x.png',
        },
      }));
      return;
    }
    response.end(JSON.stringify({ ok: true, data: null }));
  });
  const cos = await fakeServer(context, () => {});
  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin));
  await rejectsCode(client.submitImage({
    image: { bytes: new Uint8Array([1]), mime: 'image/jpeg' as const, width: 256, height: 256 },
  }), 'UPSTREAM_ERROR');
});

test('几何失败映射为 FAIL；纹理提交失败后按失败上报且进程内不自动重试', async (context) => {
  const state: ProxyState = {
    loggedIn: true,
    geometryStatus: 3,
    geometryError: { errorCode: 'FailedOperation', errorMsg: 'geometry failed' },
    textureStatus: null,
    textureSubmitCount: 0,
    textureSubmitShouldFail: false,
  };
  const proxy = await fakeServer(context, (request, response, body) => {
    const url = request.url ?? '';
    if (url === '/game3d/general_info/get_works_list') {
      const parsed = JSON.parse(body) as { worksIds?: string[] };
      if (Array.isArray(parsed.worksIds)) {
        response.end(JSON.stringify({
          errNo: 0, errMsg: '',
          data: { list: [{ worksId: 'geo-1', pipelineStatus: state.geometryStatus, ...state.geometryError }] },
        }));
        return;
      }
      response.end(JSON.stringify({ errNo: 0, errMsg: '', data: { list: [] } }));
      return;
    }
    if (url === '/api/text3d/texture') {
      state.textureSubmitCount += 1;
      response.statusCode = 500;
      response.end(JSON.stringify({ ok: false, error: 'upstream busy' }));
      return;
    }
    response.end(JSON.stringify({ ok: true, data: null }));
  });
  const cos = await fakeServer(context, () => {});
  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin));

  const failed = await client.queryJob('geo-1');
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.errorCode, 'FailedOperation');
  assert.equal(failed.errorMessage, 'geometry failed');

  state.geometryStatus = 2;
  state.geometryError = undefined;
  const textureFailure = await client.queryJob('geo-1');
  assert.equal(textureFailure.status, 'FAIL');
  assert.equal(textureFailure.errorCode, 'TEXTURE_STAGE_SUBMIT_FAILED');
  assert.equal(state.textureSubmitCount, 1);

  const again = await client.queryJob('geo-1');
  assert.equal(again.status, 'FAIL');
  assert.equal(again.errorCode, 'TEXTURE_STAGE_SUBMIT_FAILED');
  assert.equal(state.textureSubmitCount, 1, '失败后进程内不得自动重复提交纹理阶段');
});

test('反代无响应时按超时处理，不自动重试', async (context) => {
  let count = 0;
  const proxy = await fakeServer(context, (request) => {
    if ((request.url ?? '') === '/api/login/status') {
      count += 1;
    }
    request.resume();
  });
  const cos = await fakeServer(context, () => {});
  const client = createHunyuanWebProxyClient(makeConfig(proxy.origin, cos.origin, { timeoutMs: 1_000 }));
  await rejectsCode(client.submitImage({
    image: { bytes: new Uint8Array([1]), mime: 'image/jpeg' as const, width: 256, height: 256 },
  }), 'TIMEOUT');
  assert.equal(count, 1);
});
