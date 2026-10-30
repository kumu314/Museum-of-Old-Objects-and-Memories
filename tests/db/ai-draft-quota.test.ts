import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { consumeDailyDraftQuota } from '../../src/server/core/ai';
import { migrate } from '../../src/server/db/migrate';
import { withTransaction } from '../../src/server/db/pool';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 1, connectionTimeoutMillis: 1000 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

async function member(): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [id, `draft-quota-${id.slice(0, 8)}`, 'x']);
  return id;
}

const hasQuotaCode = (error: unknown) =>
  error instanceof HttpError && error.failure.code === 'AI_QUOTA_EXHAUSTED';

test('文本 AI 每日额度按账号累加，超限在事务内回滚且不占用额度', async () => {
  const owner = await member();
  assert.equal(await consumeDailyDraftQuota(pool, owner, 2), 1);
  assert.equal(await consumeDailyDraftQuota(pool, owner, 2), 2);
  await assert.rejects(withTransaction((db) => consumeDailyDraftQuota(db, owner, 2), pool), hasQuotaCode);
  const usage = await pool.query<{ draft_count: number }>(
    'SELECT draft_count FROM ai_draft_daily_usage WHERE owner_id=$1', [owner]);
  assert.equal(usage.rows[0]?.draft_count, 2);
  // 其他账号不受影响。
  assert.equal(await consumeDailyDraftQuota(pool, await member(), 2), 1);
});

test('跨 UTC 日期重新计数', async () => {
  const owner = await member();
  await consumeDailyDraftQuota(pool, owner, 1);
  await pool.query('UPDATE ai_draft_daily_usage SET usage_date = usage_date - 1 WHERE owner_id=$1', [owner]);
  assert.equal(await consumeDailyDraftQuota(pool, owner, 1), 1);
});
