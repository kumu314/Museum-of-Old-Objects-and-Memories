import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { requestMemoirAi } from '@/server/core/memoir-ai';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MemoirSessionContext } from '../../../../_params';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: MemoirSessionContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await requestMemoirAi(actor.id, privateId(path.memoirId), 'followup', privateId(path.sessionId), await readJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
