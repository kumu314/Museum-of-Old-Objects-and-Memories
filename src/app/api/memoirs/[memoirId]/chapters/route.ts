import { createMemoirChapterInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { createMemoirChapter } from '@/server/core/memoirs';
import { listMemoirChapters } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, memoirPageInput, type MemoirContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: MemoirContext) {
  try { return dataResponse(await listMemoirChapters((await requireMember()).id, privateId((await params).memoirId), memoirPageInput(request))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: MemoirContext) {
  try { requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await createMemoirChapter(actor.id, privateId((await params).memoirId), createMemoirChapterInputSchema.parse(await readJsonRequest(request))), 201);
  } catch (error) { return errorResponse(error); }
}
