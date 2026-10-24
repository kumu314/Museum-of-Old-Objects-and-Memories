import { confirmMemoirChapterInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { confirmMemoirChapter } from '@/server/core/memoirs';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MemoirChapterContext } from '../../../../_params';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: MemoirChapterContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await confirmMemoirChapter(actor.id, privateId(path.memoirId), privateId(path.chapterId), confirmMemoirChapterInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
