import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { HttpError } from '../http';
import { requireActor } from './records';

export async function requireDemoAccount(db: PoolClient, actorId: string): Promise<void> {
  await requireActor(db, actorId);
  const allowed = await db.query('SELECT user_id FROM direction1_demo_accounts WHERE user_id=$1 FOR SHARE', [actorId]);
  if (allowed.rowCount !== 1) throw new HttpError({ code: 'DEMO_ONLY', message: '此功能目前仅供服务端登记的合成资料演示账号使用。' });
}

export async function prepareDirection1Write(db: PoolClient, actorId: string, operationId: string,
  kind: string, resourceId: string, values: readonly unknown[]) {
  await requireActor(db, actorId);
  // All direction-one writers take this lock before resource locks. It also
  // serializes repeated operation IDs across workers without in-memory state.
  await lockDirection1Actor(db, actorId);
  const hash = createHash('sha256').update(JSON.stringify([kind, resourceId, ...values])).digest('hex');
  const receipt = await db.query<{ request_hash: string; result_id: string | null }>('SELECT request_hash,result_id FROM direction1_write_receipts WHERE actor_id=$1 AND operation_id=$2', [actorId, operationId]);
  const previous = receipt.rows[0];
  if (previous && previous.request_hash !== hash) throw new HttpError({ code: 'IDEMPOTENCY_CONFLICT', message: '此操作标识已经用于其他内容，请核对当前状态。' });
  return {
    replayed: previous !== undefined,
    resultId: previous?.result_id ?? null,
    async finish(resultId: string | null = null) {
      await db.query('INSERT INTO direction1_write_receipts(actor_id,operation_id,kind,resource_id,request_hash,result_id) VALUES($1,$2,$3,$4,$5,$6)', [actorId, operationId, kind, resourceId, hash, resultId]);
    },
  };
}
export async function lockDirection1Actor(db: PoolClient, actorId: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,17681007))', [actorId]);
}
