import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { displayPhotoRequiredMessage, missingDisplayPhoto, modelInputAssetIds, museumDraftSchema, museumSummarySchema, type CreateMuseumInput, type UpdateMuseumInput,
  type CreateExhibitInput, type UpdateExhibitInput, type ConfirmExhibitInput } from '../../contracts';
import { withTransaction } from '../db/pool';
import { HttpError } from '../http';
import { assertVersion, dates, exhibitRecord, exhibitRecords, museumRecord, requireActor, validateAssets,
  bumpMuseum, invalid, assetRecord } from './records';

// The optional client composes writes with an existing transaction, e.g. AI adoption.
// Callers supplying it own BEGIN/COMMIT/ROLLBACK; ordinary HTTP callers omit it.
export function inTransaction<T>(work: (db: PoolClient) => Promise<T>, client?: PoolClient): Promise<T> {
  return client ? work(client) : withTransaction(work);
}
export async function museumDraft(client: PoolClient, actorId: string, museumId: string) {
  const museum = await museumRecord(client, actorId, museumId);
  return museumDraftSchema.parse({ ...museum, exhibits: await exhibitRecords(client, museumId) });
}

export function listMuseums(actorId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    // 只看自己创建的展馆：工作台列表不能泄露他人展馆的存在、标题与更新时间。
    const result = await db.query<Record<string, unknown>>(`SELECT m.id,m.title,m.description,m.version,p.museum_version AS "publishedVersion",
      m.share_enabled AS "shareEnabled",m.region_city AS "regionCity",m.discovery_listed AS "discoveryListed",m.created_at AS "createdAt",m.updated_at AS "updatedAt"
      FROM museums m LEFT JOIN published_snapshots p ON p.id=m.current_snapshot_id
      WHERE m.deleted_at IS NULL AND m.created_by=$1 ORDER BY m.updated_at DESC`, [actorId]);
    return result.rows.map((row) => museumSummarySchema.parse(dates(row)));
  }, client);
}
export function getMuseum(actorId: string, museumId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireActor(db, actorId); return museumDraft(db, actorId, museumId); }, client);
}
/**
 * 只做归属判断，不读展品。
 * 上传路由在解析请求体之前调用它：越权请求不该先被读进内存。
 */
export function assertMuseumAccess(actorId: string, museumId: string, client?: PoolClient) {
  return inTransaction(async (db) => { await requireActor(db, actorId); await museumRecord(db, actorId, museumId); }, client);
}
export function getOwnMuseum(actorId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const result = await db.query<{ id: string }>('SELECT id FROM museums WHERE created_by=$1 AND deleted_at IS NULL', [actorId]);
    if (result.rows.length > 1) throw new Error('One active museum per account migration is required.');
    const row = result.rows[0];
    return row ? museumDraft(db, actorId, row.id) : null;
  }, client);
}
const museumEntrySchema = z.strictObject({ id: z.uuid(), hasExhibits: z.boolean() });

// 入口仅决定跳转目的地，不读取目标页稍后才需要的故事、素材和全部展品。
export function getOwnMuseumEntry(actorId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const result = await db.query(`SELECT m.id,
      EXISTS (SELECT 1 FROM exhibits e WHERE e.museum_id=m.id AND e.deleted_at IS NULL) AS "hasExhibits"
      FROM museums m WHERE m.created_by=$1 AND m.deleted_at IS NULL`, [actorId]);
    if (result.rows.length > 1) throw new Error('One active museum per account migration is required.');
    return result.rows.length === 0 ? null : museumEntrySchema.parse(result.rows[0]);
  }, client);
}
export function createMuseum(actorId: string, input: CreateMuseumInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    // Serialize repeated creation per account; the unique index also protects
    // writes outside this service.
    await db.query('SELECT id FROM team_members WHERE id=$1 FOR UPDATE', [actorId]);
    const existing = await db.query('SELECT id FROM museums WHERE created_by=$1 AND deleted_at IS NULL', [actorId]);
    if (existing.rowCount) throw new HttpError({ code: 'MUSEUM_EXISTS', message: '你已有自己的展馆，请进入现有展馆继续收录。' });
    const id = randomUUID();
    await db.query('INSERT INTO museums(id,title,description,created_by) VALUES($1,$2,$3,$4)', [id, input.title, input.description, actorId]);
    return museumDraft(db, actorId, id);
  }, client);
}
export function updateMuseum(actorId: string, id: string, input: UpdateMuseumInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    const current = await museumRecord(db, actorId, id, true);
    assertVersion(current.version, input.expectedVersion);
    // 未传 regionCity 表示"不改"；传 null 才是"清空"。两者不能合并，否则老客户端
    // 一次保存就会把馆主选好的城市悄悄抹掉。
    const regionCity = input.regionCity === undefined ? current.regionCity : input.regionCity;
    const discoveryListed = input.discoveryListed ?? current.discoveryListed;
    await db.query('UPDATE museums SET title=$1,description=$2,region_city=$3,discovery_listed=$4,version=version+1,updated_at=now() WHERE id=$5',
      [input.title, input.description, regionCity, discoveryListed, id]);
    return museumDraft(db, actorId, id);
  }, client);
}
export function removeMuseum(actorId: string, id: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    assertVersion((await museumRecord(db, actorId, id, true)).version, expectedVersion);
    await db.query('UPDATE museums SET deleted_at=now(),share_enabled=false,share_token_hash=NULL,version=version+1,updated_at=now() WHERE id=$1', [id]);
    return { id };
  }, client);
}
async function ensureFreeSlot(db: PoolClient, museumId: string, slotIndex: number, exceptId: string | null) {
  const occupied = await db.query('SELECT id FROM exhibits WHERE museum_id=$1 AND slot_index=$2 AND deleted_at IS NULL AND ($3::uuid IS NULL OR id<>$3)', [museumId, slotIndex, exceptId]);
  if (occupied.rowCount) invalid('该柜格已有展品，请选择其他位置。');
}
function editableValues(input: CreateExhibitInput | UpdateExhibitInput) {
  return [input.name, input.era, input.slotIndex, input.modelKey, input.caption, input.photoAssetId, input.audioAssetId,
    input.approximation, input.sourceNotice, input.rawStory, input.transcript, JSON.stringify(input.sourceSegments), JSON.stringify(input.modelInput)];
}
async function validateModelInput(db: PoolClient, museumId: string, input: CreateExhibitInput | UpdateExhibitInput) {
  for (const id of new Set(modelInputAssetIds(input.modelInput))) await validateAssets(db, museumId, id, null);
}
export function createExhibit(actorId: string, museumId: string, input: CreateExhibitInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    assertVersion((await museumRecord(db, actorId, museumId, true)).version, input.expectedMuseumVersion);
    await ensureFreeSlot(db, museumId, input.slotIndex, null);
    await validateAssets(db, museumId, input.photoAssetId, input.audioAssetId);
    await validateModelInput(db, museumId, input);
    const id = randomUUID();
    await db.query(`INSERT INTO exhibits(name,era,slot_index,model_key,caption,photo_asset_id,audio_asset_id,approximation,source_notice,
      raw_story,transcript,source_segments,model_input,id,museum_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [...editableValues(input), id, museumId]);
    await bumpMuseum(db, museumId);
    return exhibitRecord(db, museumId, id);
  }, client);
}
export function updateExhibit(actorId: string, museumId: string, id: string, input: UpdateExhibitInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    assertVersion((await exhibitRecord(db, museumId, id)).version, input.expectedVersion);
    await ensureFreeSlot(db, museumId, input.slotIndex, id);
    await validateAssets(db, museumId, input.photoAssetId, input.audioAssetId);
    await validateModelInput(db, museumId, input);
    await db.query(`UPDATE exhibits SET name=$1,era=$2,slot_index=$3,model_key=$4,caption=$5,photo_asset_id=$6,audio_asset_id=$7,
      approximation=$8,source_notice=$9,raw_story=$10,transcript=$11,source_segments=$12,model_input=$13,version=version+1,confirmed_version=NULL,
      confirmed_by=NULL,confirmed_at=NULL,confirmation_note=NULL,updated_at=now() WHERE id=$14 AND museum_id=$15`, [...editableValues(input), id, museumId]);
    await bumpMuseum(db, museumId);
    return exhibitRecord(db, museumId, id);
  }, client);
}
export function removeExhibit(actorId: string, museumId: string, id: string, expectedVersion: number, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    assertVersion((await exhibitRecord(db, museumId, id)).version, expectedVersion);
    await db.query('UPDATE exhibits SET deleted_at=now(),version=version+1,confirmed_version=NULL,confirmed_by=NULL,confirmed_at=NULL,confirmation_note=NULL,updated_at=now() WHERE id=$1 AND museum_id=$2', [id, museumId]);
    await bumpMuseum(db, museumId);
    return { id };
  }, client);
}
export function confirmExhibit(actorId: string, museumId: string, id: string, input: ConfirmExhibitInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    const exhibit = await exhibitRecord(db, museumId, id);
    assertVersion(exhibit.version, input.expectedVersion);
    if (missingDisplayPhoto(exhibit)) invalid(displayPhotoRequiredMessage);
    if (exhibit.confirmedVersion === exhibit.version) return exhibit;
    if (!exhibit.caption.trim()) invalid('请先填写展签，再记录物主对当前内容的确认。');
    await db.query('UPDATE exhibits SET confirmed_version=version,confirmed_by=$1,confirmed_at=now(),confirmation_note=$2,updated_at=now() WHERE id=$3 AND museum_id=$4', [actorId, input.confirmationNote, id, museumId]);
    await bumpMuseum(db, museumId);
    return exhibitRecord(db, museumId, id);
  }, client);
}
export function getPrivateAsset(actorId: string, museumId: string, assetId: string, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId);
    return assetRecord(db, museumId, assetId);
  }, client);
}
