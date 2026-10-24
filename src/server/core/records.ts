import type { PoolClient } from 'pg';
import { z } from 'zod';
import { assetSchema, exhibitDraftSchema, museumSummarySchema, type Asset } from '../../contracts';
import { HttpError } from '../http';

export function notFound(): never {
  throw new HttpError({ code: 'NOT_FOUND', message: '未找到该内容。' });
}
export function conflict(): never {
  throw new HttpError({ code: 'VERSION_CONFLICT', message: '内容已更新，请刷新后核对差异；未保存输入仍可保留。' });
}
export function invalid(message: string): never {
  throw new HttpError({ code: 'VALIDATION_ERROR', message });
}
export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) conflict();
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date)) throw new Error('Invalid database timestamp.');
  return value.toISOString();
}
export function dates(row: Record<string, unknown>) {
  return { ...row, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    ...('confirmedAt' in row ? { confirmedAt: row.confirmedAt === null ? null : timestamp(row.confirmedAt) } : {}) };
}

export const exhibitColumns = `id, museum_id AS "museumId", name, era, slot_index AS "slotIndex", model_key AS "modelKey",
  caption, photo_asset_id AS "photoAssetId", audio_asset_id AS "audioAssetId", approximation, source_notice AS "sourceNotice",
  raw_story AS "rawStory", transcript, source_segments AS "sourceSegments", version, confirmed_version AS "confirmedVersion",
  confirmation_note AS "confirmationNote", confirmed_at AS "confirmedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function requireActor(client: PoolClient, actorId: string): Promise<void> {
  const result = await client.query('SELECT id FROM users WHERE id=$1 AND active', [actorId]);
  if (result.rowCount !== 1) throw new HttpError({ code: 'UNAUTHORIZED', message: '请重新登录。' });
}
// Ownership check: only the account that created the museum may reach it.
// Another user's museum and a nonexistent one are indistinguishable (NOT_FOUND).
export async function museumRecord(client: PoolClient, id: string, actorId: string, lock = false) {
  const result = await client.query<Record<string, unknown>>(`SELECT m.id,m.title,m.description,m.version,
    p.museum_version AS "publishedVersion", m.share_enabled AS "shareEnabled",m.created_at AS "createdAt",m.updated_at AS "updatedAt"
    FROM museums m LEFT JOIN published_snapshots p ON p.id=m.current_snapshot_id
    WHERE m.id=$1 AND m.created_by=$2 AND m.deleted_at IS NULL ${lock ? 'FOR UPDATE OF m' : ''}`, [id, actorId]);
  const row = result.rows[0];
  if (!row) notFound();
  return museumSummarySchema.parse(dates(row));
}
export async function exhibitRecord(client: PoolClient, museumId: string, id: string) {
  const result = await client.query<Record<string, unknown>>(`SELECT ${exhibitColumns} FROM exhibits WHERE id=$1 AND museum_id=$2 AND deleted_at IS NULL`, [id, museumId]);
  const row = result.rows[0];
  if (!row) notFound();
  return exhibitDraftSchema.parse(dates(row));
}
export async function exhibitRecords(client: PoolClient, museumId: string) {
  const result = await client.query<Record<string, unknown>>(`SELECT ${exhibitColumns} FROM exhibits WHERE museum_id=$1 AND deleted_at IS NULL ORDER BY slot_index`, [museumId]);
  return result.rows.map((row) => exhibitDraftSchema.parse(dates(row)));
}
export async function bumpMuseum(client: PoolClient, museumId: string): Promise<void> {
  await client.query('UPDATE museums SET version=version+1,updated_at=now() WHERE id=$1', [museumId]);
}
export async function validateAssets(client: PoolClient, museumId: string, photo: string | null, audio: string | null): Promise<void> {
  for (const [id, kind] of [[photo, 'image'], [audio, 'audio']]) {
    if (id === null) continue;
    const result = await client.query('SELECT id FROM assets WHERE id=$1 AND museum_id=$2 AND kind=$3', [id, museumId, kind]);
    if (result.rowCount !== 1) notFound();
  }
}

const storageFields = z.object({ storageKey: z.string().min(1), thumbnailStorageKey: z.string().nullable() });
export type StoredAsset = { asset: Asset; storageKey: string; thumbnailStorageKey: string | null };
export async function assetRecord(client: PoolClient, museumId: string, assetId: string): Promise<StoredAsset> {
  const result = await client.query<Record<string, unknown>>(`SELECT id,museum_id AS "museumId",kind,mime AS "contentType",byte_size AS "byteSize",
    original_name AS "originalName",width,height,created_at AS "createdAt",storage_key AS "storageKey",thumbnail_storage_key AS "thumbnailStorageKey"
    FROM assets WHERE id=$1 AND museum_id=$2`, [assetId, museumId]);
  const row = result.rows[0];
  if (!row) notFound();
  const { storageKey, thumbnailStorageKey } = storageFields.parse(row);
  const asset = assetSchema.parse({ id: row.id, museumId: row.museumId, kind: row.kind, contentType: row.contentType,
    byteSize: row.byteSize, originalName: row.originalName, createdAt: timestamp(row.createdAt),
    ...(row.kind === 'image' ? { width: row.width, height: row.height } : {}) });
  return { asset, storageKey, thumbnailStorageKey };
}
