import { Pool } from 'pg';
import { migrate } from '../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../src/server/db/test-database';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--test')) throw new Error('Usage: migrate.ts [--test]');
const connectionString = args.includes('--test') ? getIsolatedTestDatabaseUrl() : process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database schema is current.');
} finally {
  await pool.end();
}
