import { requireMember } from '@/server/auth/session';
import { readDiscoveryMemoirChapters } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse } from '@/server/http';
import { memoirPageInput, privateId } from '../../../../memoirs/_params';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ museumId: string; accessEpoch: string }> }) {
  try { const actor = await requireMember(); const path = await params;
    return dataResponse(await readDiscoveryMemoirChapters(actor.id, privateId(path.museumId), privateId(path.accessEpoch), memoirPageInput(request)));
  } catch (error) { return errorResponse(error); }
}
