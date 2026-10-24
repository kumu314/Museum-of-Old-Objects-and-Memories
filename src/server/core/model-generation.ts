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
import { readForcedProvider, readHunyuanCloudConfig, readSettingsProxyBaseUrl } from '../integrations/hunyuan3d/config';
import { createHunyuanWebProxyClient } from '../integrations/hunyuan3d-proxy';
import { readHunyuanProxyConfig } from '../integrations/hunyuan3d-proxy/config';
import type { Hunyuan3DClient } from '../integrations/hunyuan3d/types';
import { HttpError } from '../http';
import { assertVersion, assetRecord, bumpMuseum, exhibitRecord, invalid, museumRecord, notFound, requireActor } from './records';

/** 网络调用在事务外；提交结果未知保留 SUBMITTING，核对上游前不再付费提交。 */
function selectedProvider(): 'hunyuan-cloud' | 'hunyuan-proxy' {
  // 通道锁定：.local/model-provider.json 优先，其次 HUNYUAN_PROVIDER；
  // 都未指定时按可用性自动选择（云 API 优先）。
  const forced = readForcedProvider();
  if (forced === 'hunyuan-proxy') {
    proxyConfig();
    return 'hunyuan-proxy';
  }
  if (forced === 'hunyuan-cloud') {
    if (!readHunyuanCloudConfig()) {
      throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '已指定云 API 通道，但密钥/地域配置缺失。' });
    }
    return 'hunyuan-cloud';
  }
  if (readHunyuanCloudConfig()) return 'hunyuan-cloud';
  proxyConfig();
  return 'hunyuan-proxy';
}

function proxyConfig(): ReturnType<typeof readHunyuanProxyConfig> {
  const baseUrl = readSettingsProxyBaseUrl();
  if (baseUrl !== undefined) return { baseUrl };
  return readHunyuanProxyConfig();
}

function providerForJob(provider: string, pool: Pool, jobId: string): Hunyuan3DClient {
  if (provider === 'hunyuan-cloud') {
    const cloud = readHunyuanCloudConfig();
    if (!cloud) throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '该任务的云 API 配置已移除，无法继续查询。' });
    return createHunyuan3DClient(cloud.config);
  }
  if (provider !== 'hunyuan-proxy') throw new Error('Unsupported model generation provider.');
  return proxyClient(pool, jobId);
}

function proxyClient(pool: Pool, jobId: string): Hunyuan3DClient {
  return createHunyuanWebProxyClient({
    ...readHunyuanProxyConfig(),
    // 持久化 claim 在发送纹理请求前完成；多进程与重启后也不会重复提交。
    async claimTextureSubmission(geometryId) {
      const claimed = await pool.query(
        `UPDATE model_generation_jobs SET texture_submission_started=true, updated_at=now()
         WHERE id=$1 AND external_job_id=$2 AND NOT texture_submission_started
         AND status IN ('WAIT','RUN') RETURNING id`, [jobId, geometryId]);
      return claimed.rowCount === 1;
    },
    async recordTextureSubmission(geometryId, textureId) {
      await pool.query(`UPDATE model_generation_jobs SET texture_external_job_id=$3, texture_submission_started=true,
        updated_at=now() WHERE id=$1 AND external_job_id=$2`, [jobId, geometryId, textureId]);
    },
  });
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
  provider: z.enum(['hunyuan-cloud', 'hunyuan-proxy']),
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
    const quota = /insufficient|balance|quota|limit|exceeded/i.test(error.upstreamCode ?? '');
    const message = quota
      ? '当前 API 额度已用完。请在服务端更换 API 凭据（model-provider.json）或补充额度后重试。'
      : (messages[error.code] ?? '三维生成服务暂时不可用，请稍后重试。');
    // 上游任意文本不可进入 API 或数据库错误字段。
    return { code: error.upstreamCode && /^\d{1,12}$/.test(error.upstreamCode) ? error.upstreamCode : error.code, message };
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
    return { kind: 'fail' as const, code: 'JOB_FAILED', message: '上游任务执行失败，可重新生成。' };
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
  const provider = selectedProvider();
  const uploadDir = getServerConfig().uploadDir;

  const claim = await withTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    const exhibit = await exhibitRecord(db, museumId, exhibitId);
    const repeated = await db.query<Record<string, unknown>>(
      `SELECT ${jobColumns} FROM model_generation_jobs WHERE exhibit_id=$1 AND request_id=$2`,
      [exhibitId, input.requestId]);
    if (repeated.rows[0]) {
      const row = jobRowSchema.parse(repeated.rows[0]);
      if (row.sourceVersion !== input.expectedVersion || row.inputAssetId !== input.imageAssetId) {
        invalid('同一请求标识不能用于不同的建模输入。');
      }
      return { existing: rowToJob(row, await loadStats(db, row.modelAssetId)) };
    }
    assertVersion(exhibit.version, input.expectedVersion);
    if (exhibit.modelInput.mode !== 'single' || exhibit.modelInput.imageAssetId !== input.imageAssetId) {
      invalid('请先保存与本请求一致的单张照片准备，再发起生成。');
    }
    const stored = await assetRecord(db, museumId, input.imageAssetId);
    if (stored.asset.kind !== 'image') invalid('生成需要图片素材。');

    const outstanding = await db.query(
      `SELECT id FROM model_generation_jobs WHERE exhibit_id=$1 AND status IN ('SUBMITTING','WAIT','RUN') LIMIT 1`, [exhibitId]);
    if (outstanding.rowCount) invalid('已有任务正在执行或提交结果待核对，请先查看任务状态，不要重复提交。');

    const latest = await db.query<Record<string, unknown>>(
      `SELECT ${jobColumns} FROM model_generation_jobs WHERE exhibit_id=$1 AND museum_id=$2
       ORDER BY created_at DESC LIMIT 1`, [exhibitId, museumId]);
    const latestRow = latest.rows[0];
    if (latestRow !== undefined) {
      const row = jobRowSchema.parse(latestRow);
      if (row.status === 'DONE' && row.sourceVersion === exhibit.version && row.inputAssetId === input.imageAssetId) {
        // 同一来源已完成：直接复用，不重复消耗积分。
        const stats = await loadStats(db, row.modelAssetId);
        return { existing: rowToJob(row, stats) };
      }
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO model_generation_jobs(id,museum_id,exhibit_id,source_version,mode,input_asset_id,provider,status,created_by,request_id)
       VALUES($1,$2,$3,$4,'single',$5,$6,'SUBMITTING',$7,$8)`,
      [id, museumId, exhibitId, exhibit.version, input.imageAssetId, provider, actorId, input.requestId]);
    return { jobId: id, stored };
  }, pool);
  if ('existing' in claim) return claim.existing;

  // 仅确定未进入付费提交，或上游明确拒绝时才允许新请求。
  let submissionStarted = false;
  let externalAccepted = false;
  try {
    const stored = claim.stored;
    if (stored.asset.kind !== 'image') invalid('生成需要图片素材。');
    const bytes = new Uint8Array(await readFile(resolveAssetPath(uploadDir, stored.storageKey)));
    submissionStarted = true;
    const requests = {
      image: { bytes, mime: stored.asset.contentType as 'image/webp', width: stored.asset.width, height: stored.asset.height },
      enablePbr: true,
    };
    const { jobId } = await providerForJob(provider, pool, claim.jobId).submitImage(requests);
    externalAccepted = true;
    await withTransaction(async (db) => {
      await db.query(
        `UPDATE model_generation_jobs SET external_job_id=$2, status='WAIT', updated_at=now()
         WHERE id=$1 AND status='SUBMITTING'`, [claim.jobId, jobId]);
    }, pool);
  } catch (error) {
    const rejected = !externalAccepted && (!submissionStarted || (error instanceof Hunyuan3DError &&
      (['CONFIG_INVALID', 'INPUT_INVALID'].includes(error.code) || error.upstreamCode !== undefined)));
    const failure = rejected ? describeFailure(error) : {
      code: 'SUBMIT_UNKNOWN', message: '提交结果未知，请由管理员核对上游任务后处理，当前不会再次提交。',
    };
    await withTransaction(async (db) => {
      if (rejected) await failJob(db, claim.jobId, failure.code, failure.message);
      else await db.query(`UPDATE model_generation_jobs SET error_code=$2, error_message=$3, updated_at=now()
        WHERE id=$1 AND status='SUBMITTING'`, [claim.jobId, failure.code, failure.message]);
    }, pool);
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
    // 也可能是另一个请求仍在提交，读取状态不能把它改为失败。
    return rowToJob(snapshot.row, null);
  }
  if (snapshot.row.status === 'SUBMITTING') {
    // 外部任务号已写回、状态尚未推进的瞬态：直接返回，下次轮询推进。
    return rowToJob(snapshot.row, null);
  }

  let preparedId: string | undefined;
  try {
    const uploadDir = getServerConfig().uploadDir;
    const outcome = await generateModelFile(providerForJob(snapshot.row.provider, pool, jobId), snapshot.row.externalJobId, uploadDir);
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
    preparedId = outcome.prepared.id;
    const stats = modelGlbStatsSchema.parse({
      byteLength: outcome.stats.byteLength,
      meshCount: outcome.stats.meshCount,
      materialCount: outcome.stats.materialCount,
      imageCount: outcome.stats.imageCount,
    });
    const modelAssetId = await withTransaction(async (db) => {
      await requireActor(db, actorId);
      await museumRecord(db, actorId, museumId, true);
      const current = await loadJob(db, museumId, exhibitId, jobId);
      if (current.status === 'DONE') {
        console.warn('[model-generation] 并发下载的未引用文件待核对清理', { jobId, preparedId });
        return current.modelAssetId;
      }
      if (current.status === 'FAIL') throw new Error('Generation already failed.');
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
    if (preparedId) console.warn('[model-generation] 文件已写入，提交结果需核对后清理', { jobId, preparedId });
    // 轮询/下载失败：下载与 GLB 校验类错误视为终态；查询类瞬时错误保持原
    // 状态等待下次轮询。非上游错误（如数据库故障）记录日志便于排查。
    if (!(error instanceof Hunyuan3DError)) {
      console.error('[model-generation] 轮询推进失败', { jobId, category: error instanceof Error ? error.name : 'unknown' });
      throw error;
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

/**
 * 采纳已完成的生成模型到展柜。只替换工作台的展示模型引用，不改照片与讲述：
 * 展品版本 +1、旧确认失效（与人工修改一致），公开快照仍需重新发布。
 * 公开参观页在快照支持模型前继续使用照片。
 */
export async function adoptGeneratedModel(
  actorId: string, museumId: string, exhibitId: string, jobId: string, expectedVersion: number,
  pool: Pool = getPool(),
) {
  return withTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    const current = await exhibitRecord(db, museumId, exhibitId);
    assertVersion(current.version, expectedVersion);
    const job = await loadJob(db, museumId, exhibitId, jobId);
    if (job.status !== 'DONE' || job.modelAssetId === null) invalid('只能采纳已完成的生成任务。');
    if (current.modelInput.mode !== 'single' || job.inputAssetId !== current.modelInput.imageAssetId) {
      invalid('当前展品的建模照片已变更，请重新生成后再采纳。');
    }
    await db.query(
      `UPDATE exhibits SET generated_model_asset_id=$2, version=version+1, confirmed_version=NULL,
         confirmation_note=NULL, confirmed_at=NULL, updated_at=now()
       WHERE id=$1 AND museum_id=$3`, [exhibitId, job.modelAssetId, museumId]);
    await bumpMuseum(db, museumId);
    return exhibitRecord(db, museumId, exhibitId);
  }, pool);
}
