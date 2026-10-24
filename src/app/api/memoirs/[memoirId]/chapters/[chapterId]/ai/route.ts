import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { requestMemoirAi } from '@/server/core/memoir-ai';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MemoirChapterContext } from '../../../../_params';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: MemoirChapterContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await requestMemoirAi(actor.id, privateId(path.memoirId), 'chapter', privateId(path.chapterId), await readJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
