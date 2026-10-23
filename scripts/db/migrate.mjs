import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../src/server/config/env.ts';
import { createPool } from '../../src/server/db/connection.ts';
import { migrate } from '../../src/server/db/migrate.ts';

const config = loadEnv(process.env);
const pool = createPool(config.DATABASE_URL);
try {
  const client = await pool.connect();
  try {
    const applied = await migrate(client, fileURLToPath(new URL('../../migrations/', import.meta.url)));
    console.log(`迁移完成，本次应用 ${applied.length} 个 SQL 文件。`);
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
