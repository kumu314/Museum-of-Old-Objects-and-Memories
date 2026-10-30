import { requireMember } from '@/server/auth/session';
import { sharedModelFileResponse } from '@/server/core/model-file';
import { getDiscoveryModelAsset } from '@/server/core/discovery';
import { errorResponse } from '@/server/http';
import { privateId } from '../../../../../museums/_params';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ museumId: string; accessEpoch: string; assetId: string }> }) {
  try {
    const actor = await requireMember(); const path = await params;
    return await sharedModelFileResponse(await getDiscoveryModelAsset(actor.id, privateId(path.museumId), privateId(path.accessEpoch), privateId(path.assetId)), request);
  } catch (error) { return errorResponse(error); }
}
