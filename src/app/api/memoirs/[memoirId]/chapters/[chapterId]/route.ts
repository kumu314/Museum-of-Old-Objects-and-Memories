import { saveMemoirChapterInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { saveMemoirChapter } from '@/server/core/memoirs';
import { getMemoirChapter } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, memoirChapterBodyLimit, type MemoirChapterContext } from '../../../_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MemoirChapterContext) {
  try { const actor = await requireMember(); const path = await params;
    return dataResponse(await getMemoirChapter(actor.id, privateId(path.memoirId), privateId(path.chapterId)));
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, { params }: MemoirChapterContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await saveMemoirChapter(actor.id, privateId(path.memoirId), privateId(path.chapterId), saveMemoirChapterInputSchema.parse(await readJsonRequest(request, memoirChapterBodyLimit))));
  } catch (error) { return errorResponse(error); }
}
