import { verifyStorageDirectory } from '@/server/storage';
import { getServerConfig } from '@/server/config';
import { getPool } from '@/server/db/pool';
import { verifyMigrationsCurrent } from '@/server/db/migrate';
import { dataResponse, errorResponse } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const config = getServerConfig();
    await Promise.all([
      verifyMigrationsCurrent(getPool()),
      verifyStorageDirectory(config.uploadDir),
    ]);
    return dataResponse({ status: 'ok', database: 'ok', storage: 'ok' });
  } catch (error) { return errorResponse(error); }
}
