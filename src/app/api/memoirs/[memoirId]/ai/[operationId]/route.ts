import { requireMember } from '@/server/auth/session';
import { getMemoirAiOperation } from '@/server/core/memoir-ai';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId } from '../../../_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ memoirId: string; operationId: string }> }) {
  try { const actor = await requireMember(); const path = await params;
    return dataResponse(await getMemoirAiOperation(actor.id, privateId(path.memoirId), privateId(path.operationId)));
  } catch (error) { return errorResponse(error); }
}
