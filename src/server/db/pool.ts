import { Pool, type PoolClient } from 'pg';
import { getServerConfig } from '../config';

const runtime = globalThis as typeof globalThis & { museumPool?: Pool };

export function getPool(): Pool {
  if (!runtime.museumPool) {
    runtime.museumPool = new Pool({
      connectionString: getServerConfig().databaseUrl,
      max: 8,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 15000,
    });
    // Idle-client disconnects do not belong to a request. Do not log connection strings.
    runtime.museumPool.on('error', () => console.error('Database idle connection failed.'));
  }
  return runtime.museumPool;
}

export async function closePool(): Promise<void> {
  const pool = runtime.museumPool;
  delete runtime.museumPool;
  await pool?.end();
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>, pool = getPool()): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Transaction failed and rollback could not be confirmed.');
    }
    throw error;
  } finally {
    client.release();
  }
}
