import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  idSchema,
  modelGenerationJobSchema,
  modelGlbStatsSchema,
  modelJobStatusSchema,
  versionSchema,
  type ModelGenerationJob,
} from '../../contracts';
import { getPool, withTransaction } from '../db/pool';
import { getServerConfig } from '../config';
import { prepareGeneratedModel, resolveAssetPath } from '../assets/storage';
import { createHunyuan3DClient, Hunyuan3DError } from '../integrations/hunyuan3d';
import { readHunyuanCloudConfig } from '../integrations/hunyuan3d/config';
import { createHunyuanWebProxyClient } from '../integrations/hunyuan3d-proxy';
import { readHunyuanProxyConfig } from '../integrations/hunyuan3d-proxy/config';
import type { Hunyuan3DClient } from '../integrations/hunyuan3d/types';
import { HttpError } from '../http';
import { assertVersion, assetRecord, exhibitRecord, invalid, museumRecord, notFound, requireActor } from './records';

/**
 * 照片生成 3D 的最小编排闭环（初版，C 需复核归属/额度/快照边界）：
 *
 * - 提交：校验照片准备与版本一致 → 同展品已有未终态任务直接复用（防重复
 *   扣积分）→ 事务外调反代提交 → 写回外部任务号。提交网络失败按 FAIL
 *   记录并允许显式重试；"上游已受理但响应丢失"目前无法与"未受理"区分，
 *   该不确定性如实落在错误信息里（B06 的完整对账待反代支持后补）。
 * - 轮询：查询外部状态；DONE 时下载 GLB（适配器已做来源策略、流式上限
 *   与可加载性校验，且拒绝白模）→ 私有落盘 → model_assets 入库 → 任务
 *   DONE。轮询查询失败视为瞬时错误，不改变任务状态。
 * - 进程内对同一任务只跑一个推进循环，避免并发重复下载/入库。
 */

type ModelProvider = { name: string; client: Hunyuan3DClient };

// 适配器实例按配置缓存：纹理阶段去重等进程内状态必须跨轮询保留，
// 否则每次轮询都会重复提交纹理任务、重复消耗积分。
const clients = new Map<string, Hunyuan3DClient>();

function clientFor(key: string, create: () => Hunyuan3DClient): Hunyuan3DClient {
  let client = clients.get(key);
  if (client === undefined) {
    client = create();
    clients.set(key, client);
  }
  return client;
}

/**
 * 通道选择：三项云 API 变量齐全时走官方云 API（生产路径），否则退回本机
 * 反代演示链路。任务会记录提交时的 provider，轮询按记录选择，避免中途切换
 * 配置把任务串到另一条通道。
 */
function resolveProvider(): ModelProvider {
  const cloud = readHunyuanCloudConfig();
  if (cloud !== undefined) {
    const key = `cloud|${cloud.config.region}|${cloud.config.endpoint ?? ''}|${cloud.config.model ?? ''}`;
    return { name: cloud.provider, client: clientFor(key, () => createHunyuan3DClient(cloud.config)) };
  }
  const proxy = readHunyuanProxyConfig();
  const key = `proxy|${proxy.baseUrl}|${process.env.HUNYUAN_PROXY_ALLOW_INSECURE_UPLOAD === '1' ? 'insecure' : 'strict'}`;
  return { name: 'hunyuan-proxy', client: clientFor(key, () => createHunyuanWebProxyClient(proxy)) };
}

function providerForJob(provider: string): Hunyuan3DClient {
  if (provider === 'hunyuan-cloud') {
    const cloud = readHunyuanCloudConfig();
    if (cloud === undefined) {
      throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '该任务由云 API 提交，但云 API 配置已移除，无法继续查询。' });
    }
    const key = `cloud|${cloud.config.region}|${cloud.config.endpoint ?? ''}|${cloud.config.model ?? ''}`;
    return clientFor(key, () => createHunyuan3DClient(cloud.config));
  }
  const proxy = readHunyuanProxyConfig();
  const key = `proxy|${proxy.baseUrl}|${process.env.HUNYUAN_PROXY_ALLOW_INSECURE_UPLOAD === '1' ? 'insecure' : 'strict'}`;
  return clientFor(key, () => createHunyuanWebProxyClient(proxy));
}

const jobRowSchema = z.strictObject({
  id: idSchema,
  exhibitId: idSchema,
  sourceVersion: versionSchema,
  status: modelJobStatusSchema,
  errorCode: z.string().max(120).nullable(),
  errorMessage: z.string().max(240).nullable(),
  modelAssetId: idSchema.nullable(),
  externalJobId: z.string().max(200).nullable(),
  inputAssetId: idSchema,
  provider: z.string().min(1).max(60),
  createdAt: z.instanceof(Date),
});

type JobRow = z.infer<typeof jobRowSchema>;

const jobColumns = `id, exhibit_id AS "exhibitId", source_version AS "sourceVersion", status,
  error_code AS "errorCode", error_message AS "errorMessage", model_asset_id AS "modelAssetId",
  external_job_id AS "externalJobId", input_asset_id AS "inputAssetId", provider, created_at AS "createdAt"`;

function rowToJob(row: JobRow, stats: Record<string, number> | null): ModelGenerationJob {
  return modelGenerationJobSchema.parse({
    id: row.id, exhibitId: row.exhibitId, status: row.status, sourceVersion: row.sourceVersion,
    errorCode: row.errorCode, errorMessage: row.errorMessage, modelAssetId: row.modelAssetId,
    stats, createdAt: row.createdAt.toISOString(),
  });
}

async function loadJob(db: PoolClient, museumId: string, exhibitId: string, jobId: string): Promise<JobRow> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT ${jobColumns} FROM model_generation_jobs WHERE id=$1 AND museum_id=$2 AND exhibit_id=$3`,
    [jobId, museumId, exhibitId]);
  const row = result.rows[0];
  if (!row) notFound();
  return jobRowSchema.parse(row);
}

async function loadStats(db: PoolClient, modelAssetId: string | null): Promise<Record<string, number> | null> {
  if (modelAssetId === null) return null;
  const result = await db.query<{ stats: unknown }>('SELECT stats FROM model_assets WHERE id=$1', [modelAssetId]);
  const row = result.rows[0];
  if (!row) return null;
  return modelGlbStatsSchema.parse(row.stats);
}

function describeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof Hunyuan3DError) {
    const messages: Record<string, string> = {
      CONFIG_INVALID: '三维生成服务配置无效，请检查本机反代。',
      INPUT_INVALID: '照片不满足生成要求（每边 128–5000 像素、JPEG/PNG/WebP、不超过 6MB）。',
      UPSTREAM_ERROR: '混元上游拒绝了请求，请稍后重试或更换照片。',
      TIMEOUT: '三维生成服务请求超时，请稍后重试。',
      DOWNLOAD_FAILED: '生成结果下载失败，本次任务已终止，可重新生成。',
      INVALID_GLB: '生成结果未通过模型校验，本次任务已终止，可重新生成。',
      RESULT_MISSING: '上游任务已完成但没有可用结果文件，本次任务已终止。',
      RESULT_URL_REJECTED: '生成结果地址未通过来源校验，本次任务已终止。',
      JOB_FAILED: '上游任务执行失败，可重新生成。',
    };
    const message = messages[error.code] ?? '三维生成服务暂时不可用，请稍后重试。';
    // Hunyuan3DError 的 message 按可展示标准设计；优先保留它（含具体原因），
    // 仅在缺失时退回通用文案。错误码优先保留上游码（如 errNo）。
    const display = error.message.length > 0 ? error.message : message;
    return { code: error.upstreamCode ?? error.code, message: display };
  }
  if (error instanceof HttpError) return { code: 'GENERATION_UNAVAILABLE', message: error.message };
  return { code: 'GENERATION_UNAVAILABLE', message: '三维生成服务暂时不可用，请稍后重试。' };
}

async function failJob(db: PoolClient, jobId: string, code: string, message: string): Promise<void> {
  await db.query(
    `UPDATE model_generation_jobs SET status='FAIL', error_code=$2, error_message=$3, updated_at=now()
     WHERE id=$1 AND status IN ('SUBMITTING','WAIT','RUN')`, [jobId, code.slice(0, 120), message.slice(0, 240)]);
}

async function generateModelFile(client: Hunyuan3DClient, externalJobId: string, uploadDir: string) {
  const remote = await client.queryJob(externalJobId);
  if (remote.status === 'FAIL') {
    return { kind: 'fail' as const, code: remote.errorCode ?? 'JOB_FAILED', message: remote.errorMessage ?? '上游任务执行失败，可重新生成。' };
  }
  if (remote.status !== 'DONE') return { kind: 'pending' as const, status: remote.status };
  const file = remote.files.find((entry) => entry.type.toLowerCase() === 'glb');
  if (!file) return { kind: 'fail' as const, code: 'RESULT_MISSING', message: '上游任务已完成但没有可用结果文件，本次任务已终止。' };
  const { bytes, stats } = await client.downloadGlb(file);
  const prepared = await prepareGeneratedModel(uploadDir, bytes);
  return { kind: 'done' as const, prepared, stats };
}

export async function requestSingleModelGeneration(
  actorId: string, museumId: string, exhibitId: string,
  input: { expectedVersion: number; requestId: string; generationConsent: true; imageAssetId: string },
  pool: Pool = getPool(),
): Promise<ModelGenerationJob> {
  // 配置缺失在任务创建前受控失败，避免留下无意义的失败任务。
  const provider = resolveProvider();
  const uploadDir = getServerConfig().uploadDir;

  const claim = await withTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    const exhibit = await exhibitRecord(db, museumId, exhibitId);
    assertVersion(exhibit.version, input.expectedVersion);
    if (exhibit.modelInput.mode !== 'single' || exhibit.modelInput.imageAssetId !== input.imageAssetId) {
      invalid('请先保存与本请求一致的单张照片准备，再发起生成。');
    }
    const stored = await assetRecord(db, museumId, input.imageAssetId);
    if (stored.asset.kind !== 'image') invalid('生成需要图片素材。');

    const latest = await db.query<Record<string, unknown>>(
      `SELECT ${jobColumns} FROM model_generation_jobs WHERE exhibit_id=$1 AND museum_id=$2
       ORDER BY created_at DESC LIMIT 1`, [exhibitId, museumId]);
    const latestRow = latest.rows[0];
    if (latestRow !== undefined) {
      const row = jobRowSchema.parse(latestRow);
      // 上一次提交还在进行中或结果未知：拒绝再次提交，避免重复扣积分。
      if (row.status === 'SUBMITTING' && row.externalJobId === null) {
        invalid('上一次提交尚未完成或结果未知，为避免重复扣积分，请稍后再试。');
      }
      if (row.status !== 'FAIL') {
        // 已有执行中或已完成任务：直接复用，不重复消耗积分。
        const stats = await loadStats(db, row.modelAssetId);
        return { existing: rowToJob(row, stats) };
      }
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO model_generation_jobs(id,museum_id,exhibit_id,source_version,mode,input_asset_id,provider,status,created_by)
       VALUES($1,$2,$3,$4,'single',$5,$6,'SUBMITTING',$7)`,
      [id, museumId, exhibitId, exhibit.version, input.imageAssetId, provider.name, actorId]);
    return { jobId: id, stored };
  }, pool);
  if ('existing' in claim) return claim.existing;

  // 事务外执行网络调用；失败把任务记为 FAIL，允许显式重试。
  try {
    const stored = claim.stored;
    if (stored.asset.kind !== 'image') invalid('生成需要图片素材。');
    const bytes = new Uint8Array(await readFile(resolveAssetPath(uploadDir, stored.storageKey)));
    const { jobId } = await provider.client.submitImage({
      image: { bytes, mime: stored.asset.contentType as 'image/webp', width: stored.asset.width, height: stored.asset.height },
      // 云 API 需要显式打开 PBR 才能拿到带贴图的成品；反代通道忽略该字段。
      enablePbr: true,
    });
    await withTransaction(async (db) => {
      await db.query(
        `UPDATE model_generation_jobs SET external_job_id=$2, status='WAIT', updated_at=now()
         WHERE id=$1 AND status='SUBMITTING'`, [claim.jobId, jobId]);
    }, pool);
  } catch (error) {
    const failure = describeFailure(error);
    await withTransaction(async (db) => {
      await failJob(db, claim.jobId, failure.code, failure.message);
    }, pool).catch(() => { /* 状态更新失败时保留 SUBMITTING，轮询按提交结果未知处理 */ });
  }
  const finalJob = await withTransaction(async (db) => {
    const row = await loadJob(db, museumId, exhibitId, claim.jobId);
    const stats = await loadStats(db, row.modelAssetId);
    return rowToJob(row, stats);
  }, pool);
  return finalJob;
}

const polling = new WeakMap<Pool, Map<string, Promise<ModelGenerationJob>>>();

export async function getModelGenerationJob(
  actorId: string, museumId: string, exhibitId: string, jobId: string,
  pool: Pool = getPool(),
): Promise<ModelGenerationJob> {
  let requests = polling.get(pool);
  if (!requests) { requests = new Map(); polling.set(pool, requests); }
  const key = `${actorId}:${museumId}:${exhibitId}:${jobId}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const operation = advanceJob(actorId, museumId, exhibitId, jobId, pool).finally(() => requests.delete(key));
  requests.set(key, operation);
  return operation;
}

async function advanceJob(actorId: string, museumId: string, exhibitId: string, jobId: string, pool: Pool): Promise<ModelGenerationJob> {
  const snapshot = await withTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId);
    await exhibitRecord(db, museumId, exhibitId);
    const row = await loadJob(db, museumId, exhibitId, jobId);
    const stats = await loadStats(db, row.modelAssetId);
    return { row, stats };
  }, pool);
  if (snapshot.row.status === 'FAIL' || snapshot.row.status === 'DONE') {
    return rowToJob(snapshot.row, snapshot.stats);
  }
  if (snapshot.row.externalJobId === null) {
    // 提交进程崩溃遗留：外部任务号未知，可能已扣积分，不盲目重提。
    await withTransaction(async (db) => {
      await failJob(db, jobId, 'SUBMIT_UNKNOWN', '提交结果未知（服务中断），为避免重复扣积分未自动重试。');
    }, pool);
    return rowToJob({ ...snapshot.row, status: 'FAIL', errorCode: 'SUBMIT_UNKNOWN',
      errorMessage: '提交结果未知（服务中断），为避免重复扣积分未自动重试。' }, null);
  }
  if (snapshot.row.status === 'SUBMITTING') {
    // 外部任务号已写回、状态尚未推进的瞬态：直接返回，下次轮询推进。
    return rowToJob(snapshot.row, null);
  }

  try {
    const uploadDir = getServerConfig().uploadDir;
    const outcome = await generateModelFile(providerForJob(snapshot.row.provider), snapshot.row.externalJobId, uploadDir);
    if (outcome.kind === 'pending') {
      await withTransaction(async (db) => {
        await db.query(`UPDATE model_generation_jobs SET status=$2, updated_at=now() WHERE id=$1 AND status IN ('SUBMITTING','WAIT','RUN')`,
          [jobId, outcome.status]);
      }, pool);
      return rowToJob({ ...snapshot.row, status: outcome.status }, null);
    }
    if (outcome.kind === 'fail') {
      await withTransaction(async (db) => {
        await failJob(db, jobId, outcome.code, outcome.message);
      }, pool);
      return rowToJob({ ...snapshot.row, status: 'FAIL', errorCode: outcome.code, errorMessage: outcome.message }, null);
    }
    const stats = modelGlbStatsSchema.parse({
      byteLength: outcome.stats.byteLength,
      meshCount: outcome.stats.meshCount,
      materialCount: outcome.stats.materialCount,
      imageCount: outcome.stats.imageCount,
    });
    const modelAssetId = await withTransaction(async (db) => {
      await requireActor(db, actorId);
      await museumRecord(db, actorId, museumId, true);
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO model_assets(id,museum_id,job_id,byte_size,storage_key,sha256,stats)
         VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6) RETURNING id`,
        [museumId, jobId, outcome.prepared.byteSize, outcome.prepared.storageKey, outcome.prepared.sha256,
          JSON.stringify(stats)]);
      const assetId = inserted.rows[0]?.id;
      if (assetId === undefined) throw new Error('Saved model asset could not be read.');
      await db.query(`UPDATE model_generation_jobs SET status='DONE', model_asset_id=$2, error_code=NULL, error_message=NULL, updated_at=now()
        WHERE id=$1 AND status IN ('SUBMITTING','WAIT','RUN')`, [jobId, assetId]);
      return assetId;
    }, pool);
    return rowToJob({ ...snapshot.row, status: 'DONE', modelAssetId, errorCode: null, errorMessage: null }, stats);
  } catch (error) {
    // 轮询/下载失败：下载与 GLB 校验类错误视为终态；查询类瞬时错误保持原
    // 状态等待下次轮询。非上游错误（如数据库故障）记录日志便于排查。
    if (!(error instanceof Hunyuan3DError)) {
      console.error('[model-generation] 轮询推进失败:', error);
    }
    if (error instanceof Hunyuan3DError && ['INVALID_GLB', 'RESULT_MISSING', 'RESULT_URL_REJECTED', 'DOWNLOAD_FAILED'].includes(error.code)) {
      const failure = describeFailure(error);
      await withTransaction(async (db) => {
        await failJob(db, jobId, failure.code, failure.message);
      }, pool);
      return rowToJob({ ...snapshot.row, status: 'FAIL', errorCode: failure.code, errorMessage: failure.message }, null);
    }
    return rowToJob(snapshot.row, snapshot.stats);
  }
}

/** 刷新/重新进入页面时恢复该展品的最新任务（无任务返回 null），并推进一次轮询。 */
export async function getLatestModelGenerationJob(
  actorId: string, museumId: string, exhibitId: string,
  pool: Pool = getPool(),
): Promise<ModelGenerationJob | null> {
  const latest = await withTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId);
    await exhibitRecord(db, museumId, exhibitId);
    const result = await db.query<{ id: string }>(
      `SELECT id FROM model_generation_jobs WHERE exhibit_id=$1 AND museum_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [exhibitId, museumId]);
    return result.rows[0]?.id ?? null;
  }, pool);
  if (latest === null) return null;
  return getModelGenerationJob(actorId, museumId, exhibitId, latest, pool);
}
