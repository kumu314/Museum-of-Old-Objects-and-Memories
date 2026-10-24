import { requireMember } from '@/server/auth/session';
import { listMemoirQuestions } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId, memoirPageInput, type MemoirSessionContext } from '../../../../_params';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: MemoirSessionContext) {
  try { const actor = await requireMember(); const path = await params;
    return dataResponse(await listMemoirQuestions(actor.id, privateId(path.memoirId), privateId(path.sessionId), memoirPageInput(request)));
  } catch (error) { return errorResponse(error); }
}
