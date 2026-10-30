import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { aiDraftSchema, aiInputSchema, type AiDraft, type AdoptAiInput, type RequestAiInput } from '../../contracts';
import { getServerConfig } from '../config';
import { getPool, withTransaction } from '../db/pool';
import { HttpError } from '../http';
import { generateDraft, readAiConfig } from '../integrations/ai';
import { inTransaction, updateExhibit } from './museums';
import { assertVersion, exhibitRecord, invalid, museumRecord, notFound, requireActor } from './records';

const pending = new WeakMap<Pool, Map<string, Promise<AiDraft>>>();

// 文本 AI 每日额度：与首次校验同事务累加，超限抛错由外层回滚，并发提交不会绕过上限。
// 预留发生在调用上游之前，因此上游失败也计入当日用量。
export async function consumeDailyDraftQuota(
  db: Pick<PoolClient, 'query'>, ownerId: string, limit: number,
): Promise<number> {
  const usage = await db.query<{ draft_count: number }>(
    `INSERT INTO ai_draft_daily_usage(owner_id,usage_date,draft_count)
     VALUES($1,(now() AT TIME ZONE 'UTC')::date,1)
     ON CONFLICT (owner_id,usage_date) DO UPDATE SET draft_count=ai_draft_daily_usage.draft_count+1
     RETURNING draft_count`, [ownerId]);
  const used = usage.rows[0]?.draft_count ?? 1;
  if (used > limit) {
    throw new HttpError({
      code: 'AI_QUOTA_EXHAUSTED',
      message: `今日 AI 展签整理额度已用完（每日 ${limit} 次），请明天再试；原文已保留，可以继续人工编辑。`,
    });
  }
  return used;
}

async function savedDraft(db: PoolClient, museumId: string, exhibitId: string, sourceVersion: number, draftId?: string): Promise<AiDraft | null> {
  const result = await db.query<Record<string, unknown>>(`SELECT id,exhibit_id AS "exhibitId",source_version AS "sourceVersion",output,created_at AS "createdAt"
    FROM ai_drafts WHERE museum_id=$1 AND exhibit_id=$2 AND source_version=$3 AND ($4::uuid IS NULL OR id=$4)
    ORDER BY created_at DESC LIMIT 1`, [museumId, exhibitId, sourceVersion, draftId ?? null]);
  const row = result.rows[0];
  if (!row) return null;
  if (!(row.createdAt instanceof Date)) throw new Error('Invalid AI draft timestamp.');
  return aiDraftSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
}

async function generateAndSave(actorId: string, museumId: string, exhibitId: string, input: RequestAiInput, pool: Pool): Promise<AiDraft> {
  const source = await withTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    const exhibit = await exhibitRecord(db, museumId, exhibitId);
    assertVersion(exhibit.version, input.expectedVersion);
    const previous = await savedDraft(db, museumId, exhibitId, exhibit.version);
    const generation = aiInputSchema.parse({ name: exhibit.name, era: exhibit.era, sourceVersion: exhibit.version, sourceSegments: exhibit.sourceSegments });
    for (const segment of generation.sourceSegments) {
      const original = segment.source === 'rawStory' ? exhibit.rawStory : exhibit.transcript;
      if (!original?.includes(segment.text)) invalid('讲述片段与原文不一致，请先重新保存讲述。');
    }
    // 已有同版本草稿直接复用，不占用当日额度；只有真正要调用上游时才累加。
    if (!previous) await consumeDailyDraftQuota(db, actorId, getServerConfig().aiDraftDailyLimit);
    return { generation, previous };
  }, pool);
  if (source.previous) return source.previous;

  // No checked-out database client or transaction remains while the provider runs.
  const configuration = readAiConfig();
  const output = await generateDraft(source.generation);
  return withTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    const current = await exhibitRecord(db, museumId, exhibitId);
    assertVersion(current.version, source.generation.sourceVersion);
    const previous = await savedDraft(db, museumId, exhibitId, current.version);
    if (previous) return previous;
    const id = randomUUID();
    await db.query('INSERT INTO ai_drafts(id,museum_id,exhibit_id,source_version,output,provider,model) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, museumId, exhibitId, current.version, JSON.stringify(output), new URL(configuration.endpoint).origin, configuration.model]);
    const draft = await savedDraft(db, museumId, exhibitId, current.version, id);
    if (!draft) throw new Error('Saved AI draft could not be read.');
    return draft;
  }, pool);
}

/** Same-version retries reuse the saved draft; simultaneous requests share one provider call. */
export function requestAiDraft(actorId: string, museumId: string, exhibitId: string, input: RequestAiInput, pool = getPool()): Promise<AiDraft> {
  let requests = pending.get(pool);
  if (!requests) { requests = new Map(); pending.set(pool, requests); }
  const key = `${actorId}:${museumId}:${exhibitId}:${input.expectedVersion}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const operation = generateAndSave(actorId, museumId, exhibitId, input, pool).finally(() => requests.delete(key));
  requests.set(key, operation);
  return operation;
}

export function adoptAiDraft(actorId: string, museumId: string, exhibitId: string, input: AdoptAiInput, client?: PoolClient) {
  return inTransaction(async (db) => {
    await requireActor(db, actorId);
    await museumRecord(db, actorId, museumId, true);
    const current = await exhibitRecord(db, museumId, exhibitId);
    assertVersion(current.version, input.expectedVersion);
    const row = await db.query<{ source_version: number }>('SELECT source_version FROM ai_drafts WHERE id=$1 AND museum_id=$2 AND exhibit_id=$3', [input.draftId, museumId, exhibitId]);
    const draft = row.rows[0];
    if (!draft) notFound();
    assertVersion(current.version, draft.source_version);
    return updateExhibit(actorId, museumId, exhibitId, {
      name: current.name, era: current.era, slotIndex: current.slotIndex, modelKey: current.modelKey,
      caption: input.caption, photoAssetId: current.photoAssetId, audioAssetId: current.audioAssetId,
      approximation: current.approximation, sourceNotice: current.sourceNotice,
      rawStory: current.rawStory, transcript: current.transcript, sourceSegments: current.sourceSegments, modelInput: current.modelInput,
      expectedVersion: current.version,
    }, db);
  }, client);
}
