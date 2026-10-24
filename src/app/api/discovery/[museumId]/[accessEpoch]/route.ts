import { requireMember } from '@/server/auth/session';
import { readDiscoveryMuseum } from '@/server/core/discovery';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId } from '../../../museums/_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ museumId: string; accessEpoch: string }> }) {
  try {
    const actor = await requireMember(); const path = await params;
    return dataResponse(await readDiscoveryMuseum(actor.id, privateId(path.museumId), privateId(path.accessEpoch)));
  } catch (error) { return errorResponse(error); }
}
