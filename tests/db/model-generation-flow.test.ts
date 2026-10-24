import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, before, test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import type { CreateExhibitInput } from '../../src/contracts';
import { getModelGenerationJob, requestSingleModelGeneration } from '../../src/server/core/model-generation';
import { createMuseum, createExhibit } from '../../src/server/core';
import { migrate } from '../../src/server/db/migrate';
import { withTransaction } from '../../src/server/db/pool';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { resolveAssetPath } from '../../src/server/assets/storage';
import { HttpError } from '../../src/server/http';

Object.assign(process.env, { NODE_ENV: 'test' });
const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 1, connectionTimeoutMillis: 1000 });
// getServerConfig 是进程级单例：整个文件共享一个上传根目录，用例内以
// uuid 存储键隔离，避免目录切换被缓存吞掉。
const uploadRoot = resolve('.local', `model-jobs-${randomUUID()}`);
const providerEnv = ['HUNYUAN_PROVIDER', 'HUNYUAN_SECRET_ID', 'HUNYUAN_SECRET_KEY', 'HUNYUAN_REGION'] as const;
const previousProviderEnv = providerEnv.map((name) => [name, process.env[name]] as const);
before(async () => {
  await mkdir(uploadRoot, { recursive: true });
  process.env.UPLOAD_DIR = uploadRoot;
  // 默认隔离本机真实云密钥：本文件的反代用例必须走假反代。
  process.env.HUNYUAN_PROVIDER = 'proxy';
  delete process.env.HUNYUAN_SECRET_ID;
  delete process.env.HUNYUAN_SECRET_KEY;
  delete process.env.HUNYUAN_REGION;
  await migrate(pool);
});
after(async () => {
  for (const [name, value] of previousProviderEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await pool.end();
  await rm(uploadRoot, { recursive: true, force: true });
});

const TRIANGLE_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

function glbBytes(withMaterial: boolean): Buffer {
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'model-generation-tests' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
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
  const source = Buffer.from(JSON.stringify(json));
  const bin = Buffer.from(TRIANGLE_POSITIONS.buffer, TRIANGLE_POSITIONS.byteOffset, TRIANGLE_POSITIONS.byteLength);
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const jsonChunk = Buffer.alloc(jsonLength, 0x20); source.copy(jsonChunk);
  const binLength = Math.ceil(bin.length / 4) * 4;
  const binChunk = Buffer.alloc(binLength, 0); bin.copy(binChunk);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  return Buffer.concat([
    header,
    (() => { const h = Buffer.alloc(8); h.writeUInt32LE(jsonLength, 0); h.writeUInt32LE(0x4e4f534a, 4); return h; })(),
    jsonChunk,
    (() => { const h = Buffer.alloc(8); h.writeUInt32LE(binLength, 0); h.writeUInt32LE(0x004e4942, 4); return h; })(),
    binChunk,
  ]);
}

async function fixture(context: TestContext) {
  const actor = randomUUID();
  const input: Omit<CreateExhibitInput, 'expectedMuseumVersion'> = { name: '旧物生成测试', era: '年代待考', slotIndex: 0, modelKey: 'photo-plane', caption: '人工填写的旧展签。',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null }, approximation: '演示模型', sourceNotice: '自动化测试', rawStory: '测试讲述。', transcript: null, sourceSegments: [] };
  // 生成输入必须是真实可读的 display.webp：用 sharp 生成 256×256 样本。
  const sharp = (await import('sharp')).default;
  const photoBytes = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 120, g: 80, b: 60 } } }).webp().toBuffer();
  // 上传目录在文件级 before() 统一设置（进程级单例配置），这里只写文件。
  const result = await withTransaction(async (db) => {
    await db.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [actor, `gen-test-${actor}`, 'test-only']);
    const museum = await createMuseum(actor, { title: '生成编排测试', description: '' }, db);
    const photo = randomUUID();
    await db.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,width,height,sha256,created_by)
      VALUES($1,$2,'model-input.webp','image','image/webp',$3,$4,256,256,$5,$6)`,
      [photo, museum.id, photoBytes.length, `${photo}/display.webp`, '0'.repeat(64), actor]);
    const photoPath = resolveAssetPath(uploadRoot, `${photo}/display.webp`);
    await mkdir(dirname(photoPath), { recursive: true, mode: 0o700 });
    await writeFile(photoPath, photoBytes);
    input.modelInput = { mode: 'single', imageAssetId: photo };
    const exhibit = await createExhibit(actor, museum.id, { ...input, expectedMuseumVersion: museum.version }, db);
    return { actor, museum, exhibit, input, photo };
  }, pool);
  context.after(async () => {
    await withTransaction(async (db) => {
      // jobs 与 model_assets 相互外键：先解引用（CHECK 要求 DONE 必须有结果），
      // 再删任务，最后删模型资产与其余数据。
      await db.query(`UPDATE model_generation_jobs SET status='FAIL', model_asset_id=NULL WHERE museum_id=$1`, [result.museum.id]);
      await db.query('DELETE FROM model_assets WHERE museum_id=$1', [result.museum.id]);
      await db.query('DELETE FROM model_generation_jobs WHERE museum_id=$1', [result.museum.id]);
      await db.query('DELETE FROM exhibits WHERE museum_id=$1', [result.museum.id]);
      await db.query('DELETE FROM assets WHERE museum_id=$1', [result.museum.id]);
      await db.query('DELETE FROM museums WHERE id=$1', [result.museum.id]);
      await db.query('DELETE FROM team_members WHERE id=$1', [result.actor]);
    }, pool);
  });
  return result;
}

type ProxyState = {
  submitErrNo?: number | undefined;
  disconnectSubmit?: boolean;
  beforeSubmit?: () => Promise<void>;
  geometryStatus: number;
  textureStatus: number | null;
  glbWithMaterial: boolean;
};

async function fakeProxy(context: TestContext, state: ProxyState) {
  const names = ['HUNYUAN_PROXY_BASE_URL', 'HUNYUAN_PROXY_ALLOW_INSECURE_UPLOAD'] as const;
  const previous = names.map((name) => [name, process.env[name]] as const);
  let putBodyLength = 0;
  let textureSubmits = 0;
  let geometrySubmits = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.on('error', () => {}); response.on('error', () => {});
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', async () => {
      const url = request.url ?? '';
      if (request.method === 'PUT') {
        putBodyLength = Buffer.concat(chunks).length;
        response.statusCode = 200; response.end(); return;
      }
      if (url === '/api/login/status') {
        response.end(JSON.stringify({ ok: true, data: { loggedIn: true } })); return;
      }
      if (url === '/api/3d/resource/genUploadInfo') {
        // 旧形状（无 bucket/region/location）：PUT 目标退回 resourceUrl，
        // 上传落在本地假服务；真实形状的解析有专门单测覆盖。
        response.end(JSON.stringify({
          ok: true,
          data: { encryptTmpSecretId: 'id', encryptTmpSecretKey: 'key', sessionToken: 'tok',
            resourceUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/cos/up.png` },
        }));
        return;
      }
      if (url === '/game3d/geometry_generation/image2geometry') {
        geometrySubmits += 1;
        if (state.beforeSubmit) await state.beforeSubmit();
        if (state.disconnectSubmit) { response.destroy(); return; }
        if (state.submitErrNo !== undefined) {
          response.end(JSON.stringify({ errNo: state.submitErrNo, errMsg: 'secret-token /private/path 输入参数错误', data: null })); return;
        }
        response.end(JSON.stringify({ errNo: 0, errMsg: '', data: { worksId: 'geo-1' } })); return;
      }
      if (url === '/game3d/general_info/get_works_list') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { worksIds?: string[]; worksPipeline?: number };
        if (Array.isArray(body.worksIds)) {
          response.end(JSON.stringify({ errNo: 0, errMsg: '', data: { list: [{ worksId: 'geo-1', pipelineStatus: state.geometryStatus }] } }));
          return;
        }
        const list = state.textureStatus === null ? [] : [{
          worksId: 'tex-1', pipelineStatus: state.textureStatus, dependonWorksInfo: { worksId: 'geo-1' },
          modelInfo: { texturePaintingRsp: { glbUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/model.glb` } },
        }];
        response.end(JSON.stringify({ errNo: 0, errMsg: '', data: { list } }));
        return;
      }
      if (url === '/api/text3d/texture') {
        textureSubmits += 1;
        // 模拟真实 Go 反代：ok 信封内含上游 HTTP 状态与原始响应体。
        response.end(JSON.stringify({ ok: true, data: {
          worksId: 'tex-1', method: 'image', modelVersion: 'v3.1', status: 200,
          body: { errNo: 0, errMsg: '', data: { worksId: 'tex-1' } },
        } }));
        return;
      }
      if (url === '/model.glb') {
        response.end(glbBytes(state.glbWithMaterial)); return;
      }
      response.statusCode = 404; response.end(JSON.stringify({ ok: false, error: 'not found' }));
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  context.after(async () => {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    server.closeAllConnections();
    await new Promise<void>((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.HUNYUAN_PROXY_BASE_URL = `http://127.0.0.1:${address.port}`;
  // 本地假上游不是 HTTPS COS：显式开启测试注入口，生产不得设置。
  process.env.HUNYUAN_PROXY_ALLOW_INSECURE_UPLOAD = '1';
  return { get geometrySubmits() { return geometrySubmits; }, get putLength() { return putBodyLength; }, get textureSubmits() { return textureSubmits; } };
}

function request(setup: Awaited<ReturnType<typeof fixture>>) {
  return { expectedVersion: setup.exhibit.version, requestId: randomUUID(), generationConsent: true as const, imageAssetId: setup.photo };
}

test('提交去重、轮询推进到 DONE，模型资产私有落盘并通过校验', async (context) => {
  const setup = await fixture(context);
  const uploadDir = process.env.UPLOAD_DIR;
  assert.ok(uploadDir, 'fixture 已设置上传目录');
  const state: ProxyState = { geometryStatus: 0, textureStatus: null, glbWithMaterial: true };
  const proxy = await fakeProxy(context, state);
  const input = request(setup);

  const submitted = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, input, pool);
  assert.equal(submitted.status, 'WAIT');
  assert.ok(submitted.id);
  assert.ok(proxy.putLength > 0, '提交完成前照片必须已经上传到对象存储');

  assert.equal((await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, submitted.id, pool)).status, 'WAIT');
  state.geometryStatus = 2;
  const running = await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, submitted.id, pool);
  assert.equal(running.status, 'RUN');
  assert.equal(proxy.textureSubmits, 1, '几何完成后自动接续一次纹理阶段');

  state.textureStatus = 2;
  const done = await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, submitted.id, pool);
  assert.equal(done.status, 'DONE');
  assert.ok(done.modelAssetId);
  assert.equal(done.stats?.materialCount, 1);
  assert.equal(proxy.textureSubmits, 1, '终态后不再重复提交纹理阶段');

  const stored = await pool.query('SELECT byte_size, storage_key FROM model_assets WHERE id=$1', [done.modelAssetId]);
  assert.equal(stored.rowCount, 1);
  const row = stored.rows[0];
  assert.ok(row);
  const file = await readFile(resolveAssetPath(uploadDir, row.storage_key));
  assert.equal(file.byteLength, row.byte_size);
  assert.ok(row.storage_key.endsWith('/model.glb'));

  // 同展品已有 DONE 任务：重复提交复用结果，不重复扣积分。
  const again = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  assert.equal(again.id, submitted.id);
  assert.equal(again.status, 'DONE');
});

test('上游拒绝映射为 FAIL 并保留错误码；显式重试创建新任务', async (context) => {
  const setup = await fixture(context);
  const state: ProxyState = { submitErrNo: 200002, geometryStatus: 0, textureStatus: null, glbWithMaterial: true };
  await fakeProxy(context, state);
  const failed = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.errorCode, '200002');
  assert.ok(failed.errorMessage && failed.errorMessage.length > 0);

  state.submitErrNo = undefined;
  const retried = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  assert.notEqual(retried.id, failed.id);
  assert.equal(retried.status, 'WAIT');
});

test('白模结果被判失败；崩溃遗留的 SUBMITTING 按提交结果未知处理且不盲目重提', async (context) => {
  const setup = await fixture(context);
  const state: ProxyState = { geometryStatus: 0, textureStatus: null, glbWithMaterial: false };
  await fakeProxy(context, state);
  const job = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  state.geometryStatus = 2;
  await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, job.id, pool);
  state.textureStatus = 2;
  const finished = await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, job.id, pool);
  assert.equal(finished.status, 'FAIL');
  assert.equal(finished.errorCode, 'INVALID_GLB');

  await withTransaction(async (db) => {
    await db.query(`INSERT INTO model_generation_jobs(id,museum_id,exhibit_id,source_version,mode,input_asset_id,provider,status,created_by)
      VALUES($1,$2,$3,$4,'single',$5,'hunyuan-proxy','SUBMITTING',$6)`,
      [randomUUID(), setup.museum.id, setup.exhibit.id, setup.exhibit.version, setup.photo, setup.actor]);
  }, pool);
  await assert.rejects(
    requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool),
    (error: unknown) => error instanceof HttpError && error.failure.code === 'VALIDATION_ERROR',
  );
});


test('提交响应丢失保持未知；轮询和新 requestId 均不会重复付费', async (context) => {
  const setup = await fixture(context);
  const proxy = await fakeProxy(context, { disconnectSubmit: true, geometryStatus: 0, textureStatus: null, glbWithMaterial: true });
  const input = request(setup);
  const unknown = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, input, pool);
  assert.equal(unknown.status, 'SUBMITTING');
  assert.equal(unknown.errorCode, 'SUBMIT_UNKNOWN');
  assert.equal((await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, unknown.id, pool)).status, 'SUBMITTING');
  assert.equal((await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, input, pool)).id, unknown.id);
  await assert.rejects(requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool), HttpError);
  assert.equal(proxy.geometrySubmits, 1);
});

test('提交中并发读取保持状态；相同失败 requestId 不再次提交且不泄露上游文本', async (context) => {
  const setup = await fixture(context);
  const state: ProxyState = { submitErrNo: 200002, geometryStatus: 0, textureStatus: null, glbWithMaterial: true,
    beforeSubmit: async () => {
      const rows = await pool.query<{ id: string }>('SELECT id FROM model_generation_jobs WHERE exhibit_id=$1', [setup.exhibit.id]);
      const id = rows.rows[0]?.id; assert.ok(id);
      assert.equal((await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, id, pool)).status, 'SUBMITTING');
    },
  };
  const proxy = await fakeProxy(context, state);
  const input = request(setup);
  const failed = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, input, pool);
  assert.equal(failed.status, 'FAIL');
  assert.doesNotMatch(failed.errorMessage ?? '', /secret-token|private/);
  assert.equal((await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, input, pool)).id, failed.id);
  assert.equal(proxy.geometrySubmits, 1);
});

test('独立连接推进纹理只提交一次；完成后新来源版本创建新任务', async (context) => {
  const setup = await fixture(context);
  const state: ProxyState = { geometryStatus: 2, textureStatus: null, glbWithMaterial: true };
  const proxy = await fakeProxy(context, state);
  const submitted = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  const otherPool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 2 });
  try {
    await Promise.all([pool, otherPool].map((db) => getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, submitted.id, db)));
    assert.equal(proxy.textureSubmits, 1);
    const record = await pool.query('SELECT texture_submission_started, texture_external_job_id FROM model_generation_jobs WHERE id=$1', [submitted.id]);
    assert.deepEqual(record.rows[0], { texture_submission_started: true, texture_external_job_id: 'tex-1' });
    state.textureStatus = 2;
    const results = await Promise.all([pool, otherPool].map((db) => getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, submitted.id, db)));
    assert.equal(results[0]?.modelAssetId, results[1]?.modelAssetId);
    assert.equal((await pool.query('SELECT id FROM model_assets WHERE job_id=$1', [submitted.id])).rowCount, 1);
    await pool.query('UPDATE exhibits SET version=version+1 WHERE id=$1', [setup.exhibit.id]);
    const next = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id,
      { ...request(setup), expectedVersion: setup.exhibit.version + 1 }, pool);
    assert.notEqual(next.id, submitted.id);
    assert.equal(proxy.geometrySubmits, 2);
  } finally { await otherPool.end(); }
});

test('他人不可提交或读取生成任务，归属检查在上游调用前完成', async (context) => {
  const setup = await fixture(context);
  const other = await fixture(context);
  const proxy = await fakeProxy(context, { geometryStatus: 0, textureStatus: null, glbWithMaterial: true });
  await assert.rejects(requestSingleModelGeneration(other.actor, setup.museum.id, setup.exhibit.id, request(setup), pool), HttpError);
  assert.equal(proxy.geometrySubmits, 0);
  const submitted = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  await assert.rejects(getModelGenerationJob(other.actor, setup.museum.id, setup.exhibit.id, submitted.id, pool), HttpError);
});


test('历史未知任务即使不是最新任务也阻止新付费提交', async (context) => {
  const setup = await fixture(context);
  const proxy = await fakeProxy(context, { geometryStatus: 0, textureStatus: null, glbWithMaterial: true });
  const job = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  await pool.query("UPDATE model_generation_jobs SET status='SUBMITTING',external_job_id=NULL WHERE id=$1", [job.id]);
  await pool.query(`INSERT INTO model_generation_jobs(id,museum_id,exhibit_id,source_version,mode,input_asset_id,provider,status,created_by)
    VALUES($1,$2,$3,$4,'single',$5,'hunyuan-proxy','FAIL',$6)`,
    [randomUUID(), setup.museum.id, setup.exhibit.id, setup.exhibit.version, setup.photo, setup.actor]);
  await assert.rejects(requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool), HttpError);
  assert.equal(proxy.geometrySubmits, 1);
});

test('云 API 通道：配置齐全时走官方 Pro 协议，任务记录 provider 并完成落盘', async (context) => {
  const setup = await fixture(context);
  const names = ['HUNYUAN_PROVIDER', 'HUNYUAN_SECRET_ID', 'HUNYUAN_SECRET_KEY', 'HUNYUAN_REGION', 'HUNYUAN_3D_ENDPOINT', 'HUNYUAN_CLOUD_ALLOW_INSECURE_RESULT'] as const;
  const previous = names.map((name) => [name, process.env[name]] as const);
  let submitAction: string | undefined;
  const actions: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.on('error', () => {}); response.on('error', () => {});
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = request.url ?? '';
      if (url === '/model.glb') { response.end(glbBytes(true)); return; }
      const action = request.headers['x-tc-action']?.toString();
      actions.push(action ?? '');
      if (action === 'SubmitHunyuanTo3DProJob') {
        submitAction = action;
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        response.end(JSON.stringify({ Response: { JobId: 'cloud-job-1', RequestId: 'req-1', Echo: { EnablePBR: body.EnablePBR } } }));
        return;
      }
      if (action === 'QueryHunyuanTo3DProJob') {
        response.end(JSON.stringify({ Response: {
          Status: 'DONE', ResultCreditConsumed: 20,
          ResultFile3Ds: [{ Type: 'GLB', Url: `${(server.address() as { port: number }).port ? `http://127.0.0.1:${(server.address() as { port: number }).port}` : ''}/model.glb` }],
        } }));
        return;
      }
      response.statusCode = 400;
      response.end(JSON.stringify({ Response: { Error: { Code: 'InvalidAction', Message: 'unknown' } } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  context.after(async () => {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  process.env.HUNYUAN_PROVIDER = 'cloud';
  process.env.HUNYUAN_SECRET_ID = 'synthetic-id';
  process.env.HUNYUAN_SECRET_KEY = 'synthetic-key';
  process.env.HUNYUAN_REGION = 'ap-guangzhou';
  process.env.HUNYUAN_3D_ENDPOINT = `${origin}/`;
  process.env.HUNYUAN_CLOUD_ALLOW_INSECURE_RESULT = '1';

  const submitted = await requestSingleModelGeneration(setup.actor, setup.museum.id, setup.exhibit.id, request(setup), pool);
  assert.equal(submitted.status, 'WAIT');
  assert.equal(submitAction, 'SubmitHunyuanTo3DProJob');
  const stored = await pool.query<{ provider: string; external_job_id: string }>(
    'SELECT provider, external_job_id FROM model_generation_jobs WHERE id=$1', [submitted.id]);
  assert.equal(stored.rows[0]?.provider, 'hunyuan-cloud');
  assert.equal(stored.rows[0]?.external_job_id, 'cloud-job-1');

  const done = await getModelGenerationJob(setup.actor, setup.museum.id, setup.exhibit.id, submitted.id, pool);
  assert.equal(done.status, 'DONE');
  assert.equal(done.stats?.materialCount, 1);
  assert.ok(done.modelAssetId);
  assert.ok(actions.includes('QueryHunyuanTo3DProJob'));
});
