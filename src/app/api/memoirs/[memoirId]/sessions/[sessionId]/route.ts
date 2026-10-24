import { interviewActionInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { changeMemoirInterview } from '@/server/core/memoirs';
import { getMemoirSession } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MemoirSessionContext } from '../../../_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MemoirSessionContext) {
  try { const actor = await requireMember(); const path = await params;
    return dataResponse(await getMemoirSession(actor.id, privateId(path.memoirId), privateId(path.sessionId)));
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: MemoirSessionContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await changeMemoirInterview(actor.id, privateId(path.memoirId), privateId(path.sessionId), interviewActionInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
