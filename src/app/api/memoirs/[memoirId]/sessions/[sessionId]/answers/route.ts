import { saveInterviewAnswerInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { saveMemoirAnswer } from '@/server/core/memoirs';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, memoirAnswerBodyLimit, type MemoirSessionContext } from '../../../../_params';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: MemoirSessionContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await saveMemoirAnswer(actor.id, privateId(path.memoirId), privateId(path.sessionId), saveInterviewAnswerInputSchema.parse(await readJsonRequest(request, memoirAnswerBodyLimit))));
  } catch (error) { return errorResponse(error); }
}
