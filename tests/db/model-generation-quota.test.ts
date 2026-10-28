import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { consumeDailyGenerationQuota } from '../../src/server/core/model-generation';
import { migrate } from '../../src/server/db/migrate';
import { withTransaction } from '../../src/server/db/pool';
import { getIsolatedTestDatabaseUrl } from '../../src/server/db/test-database';
import { HttpError } from '../../src/server/http';

const pool = new Pool({ connectionString: getIsolatedTestDatabaseUrl(), max: 1, connectionTimeoutMillis: 1000 });
before(async () => { await migrate(pool); });
after(async () => { await pool.end(); });

async function member(): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO team_members(id,username,password_hash) VALUES($1,$2,$3)', [id, `quota-${id.slice(0, 8)}`, 'x']);
  return id;
}

const hasQuotaCode = (error: unknown) =>
  error instanceof HttpError && error.failure.code === 'GENERATION_QUOTA_EXHAUSTED';

test('每日额度按账号累加，超限在事务内回滚且不占用额度', async () => {
  const owner = await member();
  assert.equal(await consumeDailyGenerationQuota(pool, owner, 2), 1);
  assert.equal(await consumeDailyGenerationQuota(pool, owner, 2), 2);
  await assert.rejects(withTransaction((db) => consumeDailyGenerationQuota(db, owner, 2), pool), hasQuotaCode);
  const usage = await pool.query<{ task_count: number }>(
    'SELECT task_count FROM model_generation_usage WHERE owner_id=$1', [owner]);
  assert.equal(usage.rows[0]?.task_count, 2);
  // 其他账号不受影响。
  assert.equal(await consumeDailyGenerationQuota(pool, await member(), 2), 1);
});

test('跨 UTC 日期重新计数', async () => {
  const owner = await member();
  await consumeDailyGenerationQuota(pool, owner, 1);
  await pool.query('UPDATE model_generation_usage SET usage_date = usage_date - 1 WHERE owner_id=$1', [owner]);
  assert.equal(await consumeDailyGenerationQuota(pool, owner, 1), 1);
});
