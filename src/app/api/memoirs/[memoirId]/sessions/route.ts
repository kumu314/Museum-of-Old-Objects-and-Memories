import { startMemoirInterviewInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { startMemoirInterview } from '@/server/core/memoirs';
import { listMemoirSessions } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MemoirContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MemoirContext) {
  try { return dataResponse(await listMemoirSessions((await requireMember()).id, privateId((await params).memoirId))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: MemoirContext) {
  try { requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await startMemoirInterview(actor.id, privateId((await params).memoirId), startMemoirInterviewInputSchema.parse(await readJsonRequest(request))), 201);
  } catch (error) { return errorResponse(error); }
}
