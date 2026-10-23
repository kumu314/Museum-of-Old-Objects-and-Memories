import { verifyStorageDirectory } from '@/server/storage';
import { getServerConfig } from '@/server/config';
import { getPool } from '@/server/db/pool';
import { dataResponse, errorResponse } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const config = getServerConfig();
    await Promise.all([
      getPool().query('SELECT version FROM schema_migrations WHERE version = 1').then((result) => {
        if (result.rowCount !== 1) throw new Error('Database migration missing');
      }),
      verifyStorageDirectory(config.uploadDir),
    ]);
    return dataResponse({ status: 'ok', database: 'ok', storage: 'ok' });
  } catch (error) { return errorResponse(error); }
}
