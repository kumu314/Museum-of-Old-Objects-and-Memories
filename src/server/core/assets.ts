import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { shareNotFoundMessage, uploadLimits, type Asset } from '../../contracts';
import { cleanupUncommittedAsset, prepareAsset, processAsset, resolveAssetPath, type AssetInput } from '../assets';
import { getServerConfig } from '../config';
import { getPool } from '../db/pool';
import { HttpError, privateHeaders } from '../http';
import { getMuseum } from './museums';
import { assetRecord, museumRecord, type StoredAsset } from './records';

const multipartLimit = uploadLimits.audioBytes + 65_536;
export async function readAssetUpload(request: Request): Promise<AssetInput> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new HttpError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: '请使用文件上传表单。' });
  const tooLarge = () => new HttpError({ code: 'PAYLOAD_TOO_LARGE', message: '上传请求超过允许大小。' });
  if (Number(request.headers.get('content-length')) > multipartLimit) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError({ code: 'VALIDATION_ERROR', message: '请选择一个文件。' });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > multipartLimit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
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
    if (!commitAttempted && (!begun || rollbackConfirmed)) {
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
