import { saveMemoirSupplementInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { saveMemoirSupplement } from '@/server/core/memoirs';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, memoirAnswerBodyLimit, type MemoirContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: MemoirContext) {
  try { requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await saveMemoirSupplement(actor.id, privateId((await params).memoirId), saveMemoirSupplementInputSchema.parse(await readJsonRequest(request, memoirAnswerBodyLimit))));
  } catch (error) { return errorResponse(error); }
}
