import { deleteMemoirInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { getMemoir, deleteMemoir } from '@/server/core/memoirs';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MemoirContext } from '../_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MemoirContext) {
  try { return dataResponse(await getMemoir((await requireMember()).id, privateId((await params).memoirId))); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: MemoirContext) {
  try { requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await deleteMemoir(actor.id, privateId((await params).memoirId), deleteMemoirInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
