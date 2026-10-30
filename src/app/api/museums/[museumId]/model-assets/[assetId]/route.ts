import { requireMember } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { resolveAssetPath } from '@/server/assets/storage';
import { privateFileResponse } from '@/server/assets/file-response';
import { errorResponse } from '@/server/http';
import { inTransaction } from '@/server/core/museums';
import { museumRecord, notFound } from '@/server/core/records';
import { privateId } from '../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ museumId: string; assetId: string }> }) {
  try {
    const member = await requireMember();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const assetId = privateId(ids.assetId);
    const stored = await inTransaction(async (db) => {
      await museumRecord(db, member.id, museumId);
      const result = await db.query<{ storage_key: string }>(
        'SELECT storage_key FROM model_assets WHERE id=$1 AND museum_id=$2', [assetId, museumId]);
      const row = result.rows[0];
      if (!row) notFound();
      return row;
    });
    return await privateFileResponse({
      request,
      path: resolveAssetPath(getServerConfig().uploadDir, stored.storage_key),
      contentType: 'model/gltf-binary',
      onMissing: notFound,
    });
  } catch (error) { return errorResponse(error); }
}
