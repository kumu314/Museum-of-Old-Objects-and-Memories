import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { shareNotFoundMessage, uploadLimits, type Asset } from '../../contracts';
import { cleanupAllowed, cleanupUncommittedAsset, prepareAsset, processAsset, resolveAssetPath, type AssetInput } from '../assets';
import { getServerConfig } from '../config';
import { getPool } from '../db/pool';
import { HttpError, privateHeaders } from '../http';
import { getMuseum } from './museums';
import { assetRecord, museumRecord, type StoredAsset } from './records';

const multipartLimit = uploadLimits.audioBytes + 65_536;
/** 超限后最多再丢这么多字节；超过就终止连接，不陪跑无底洞。 */
const drainCeiling = multipartLimit * 2;
/** 超限后清空请求体的时间上限；客户端停传时不能把 handler 挂住。 */
export const drainTimeoutMs = 5_000;

type ReadOutcome = { kind: 'chunk'; value: Uint8Array } | { kind: 'done' } | { kind: 'stopped' };

function toOutcome(result: ReadableStreamReadResult<Uint8Array>): ReadOutcome {
  return result.done || !result.value ? { kind: 'done' } : { kind: 'chunk', value: result.value };
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadOutcome> {
  try { return toOutcome(await reader.read()); }
  catch { return { kind: 'stopped' }; }
}

/**
 * 丢弃阶段的单次读取必须带时间边界：客户端停传时 `read()` 永不返回，
 * handler 会被一直挂着，既不响应也不再收数据。超时按「停止」处理，由调用方终止。
 */
function readChunkWithin(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number): Promise<ReadOutcome> {
  return new Promise<ReadOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ReadOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: 'stopped' }), timeoutMs);
    reader.read().then(
      (result) => finish(toOutcome(result)),
      // 取消流会让挂起的 read 失败，这里不能让它变成未处理的拒绝。
      () => finish({ kind: 'stopped' }),
    );
  });
}

export async function readAssetUpload(request: Request): Promise<AssetInput> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new HttpError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: '请使用文件上传表单。' });
  const tooLarge = () => new HttpError({ code: 'PAYLOAD_TOO_LARGE', message: '上传请求超过允许大小。' });
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError({ code: 'VALIDATION_ERROR', message: '请选择一个文件。' });
  // 声明超限也要把请求体读空再拒绝。请求体没读完就返回 413，这条连接会带着
  // 未消费的字节回到客户端连接池，下一个请求复用它就是 ECONNRESET。
  let overflow = Number(request.headers.get('content-length')) > multipartLimit;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let dropped = 0;
  // 一旦判定超限却没能读到流结束，就必须主动终止这条流，而不是只把锁还回去。
  let unconsumed = false;
  try {
    for (;;) {
      const outcome = overflow ? await readChunkWithin(reader, drainTimeoutMs) : await readChunk(reader);
      if (outcome.kind !== 'chunk') {
        if (outcome.kind === 'stopped') unconsumed = true;
        break;
      }
      if (overflow) {
        dropped += outcome.value.byteLength;
        if (dropped > drainCeiling) { unconsumed = true; break; }
        continue;
      }
      size += outcome.value.byteLength;
      if (size > multipartLimit) { overflow = true; chunks.length = 0; continue; }
      chunks.push(outcome.value);
    }
  } finally {
    // 残留数据留在连接上，下一个请求复用它就会读到半截请求。
    if (overflow && unconsumed) {
      try { await reader.cancel(); }
      catch { /* 连接已断，没有需要保护的复用者 */ }
    }
    reader.releaseLock();
  }
  if (overflow) throw tooLarge();
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new HttpError({ code: 'VALIDATION_ERROR', message: '上传表单不完整，请重新选择文件。' }); }
  const entries = [...form.entries()];
  const first = entries[0];
  if (entries.length !== 1 || !first || first[0] !== 'file' || !(first[1] instanceof File)) {
    throw new HttpError({ code: 'VALIDATION_ERROR', message: '每次只能上传一个名为 file 的文件字段。' });
  }
  return { inputBuffer: Buffer.from(await first[1].arrayBuffer()), originalName: first[1].name, mime: first[1].type };
}

/** The transaction begins only after complete private files exist. */
export async function uploadAsset(actorId: string, museumId: string, input: AssetInput): Promise<Asset> {
  await getMuseum(actorId, museumId);
  const processed = await processAsset(input);
  const directory = getServerConfig().uploadDir;
  const prepared = await prepareAsset(processed, directory);
  const pool = getPool();
  let client: PoolClient | null = null;
  let begun = false;
  let commitAttempted = false;
  let rollbackConfirmed = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN'); begun = true;
    const actor = await client.query('SELECT id FROM team_members WHERE id=$1 AND active FOR SHARE', [actorId]);
    if (actor.rowCount !== 1) throw new HttpError({ code: 'UNAUTHORIZED', message: '请重新登录制作入口。' });
    await museumRecord(client, museumId, true);
    await client.query(`INSERT INTO assets(id,museum_id,original_name,kind,mime,byte_size,storage_key,thumbnail_storage_key,width,height,sha256,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [prepared.id, museumId, prepared.originalName, prepared.kind,
      prepared.contentType, prepared.byteSize, prepared.storageKey, prepared.thumbnailStorageKey, prepared.width, prepared.height, prepared.sha256, actorId]);
    const result = (await assetRecord(client, museumId, prepared.id)).asset;
    commitAttempted = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client && begun) {
      try { await client.query('ROLLBACK'); rollbackConfirmed = true; }
      catch { console.error(JSON.stringify({ category: 'asset-rollback-unconfirmed', assetId: prepared.id })); }
    }
    client?.release(!begun || !rollbackConfirmed);
    client = null;
    if (cleanupAllowed({ begun, commitAttempted, rollbackConfirmed })) {
      try {
        await cleanupUncommittedAsset(prepared, directory, begun ? 'rolled-back' : 'not-started', async (id) => {
          const result = await pool.query<{ referenced: boolean }>(`SELECT EXISTS(
            SELECT 1 FROM assets WHERE id=$1 UNION ALL SELECT 1 FROM snapshot_assets WHERE asset_id=$1
          ) AS referenced`, [id]);
          if (!result.rows[0]) throw new Error('Asset reference lookup did not return a result.');
          return result.rows[0].referenced;
        });
      } catch { console.error(JSON.stringify({ category: 'uncommitted-asset-retained', assetId: prepared.id })); }
    } else console.error(JSON.stringify({ category: 'asset-commit-uncertain-retained', assetId: prepared.id }));
    throw error;
  } finally { client?.release(); }
}

export async function assetFileResponse(stored: StoredAsset, request: Request, share = false): Promise<Response> {
  const missing = () => new HttpError(share ? { code: 'SHARE_NOT_FOUND', message: shareNotFoundMessage }
    : { code: 'NOT_FOUND', message: '未找到该内容。' });
  const variant = new URL(request.url).searchParams.get('variant') ?? 'display';
  if (variant !== 'display' && variant !== 'thumbnail') throw missing();
  const key = variant === 'thumbnail' ? stored.thumbnailStorageKey : stored.storageKey;
  if (key === null) throw missing();
  let bytes: Buffer;
  try { bytes = await readFile(resolveAssetPath(getServerConfig().uploadDir, key)); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw missing();
    throw error;
  }
  return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders,
    'Content-Type': variant === 'thumbnail' ? 'image/webp' : stored.asset.contentType,
    'Content-Length': String(bytes.length),
  } });
}
