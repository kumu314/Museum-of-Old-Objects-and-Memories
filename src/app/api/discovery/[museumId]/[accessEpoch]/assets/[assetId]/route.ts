import { requireMember } from '@/server/auth/session';
import { assetFileResponse } from '@/server/core/assets';
import { getDiscoveryAsset } from '@/server/core/discovery';
import { errorResponse } from '@/server/http';
import { privateId } from '../../../../../museums/_params';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ museumId: string; accessEpoch: string; assetId: string }> }) {
  try {
    const actor = await requireMember(); const path = await params;
    return await assetFileResponse(await getDiscoveryAsset(actor.id, privateId(path.museumId), privateId(path.accessEpoch), privateId(path.assetId)), request, true);
  } catch (error) { return errorResponse(error); }
}
