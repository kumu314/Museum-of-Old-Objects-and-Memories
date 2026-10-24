import { requireMember } from '@/server/auth/session';
import { listMemoirAnswers } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId, memoirPageInput, type MemoirContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: MemoirContext) {
  try { return dataResponse(await listMemoirAnswers((await requireMember()).id, privateId((await params).memoirId), memoirPageInput(request))); }
  catch (error) { return errorResponse(error); }
}
