import { requireMember } from '@/server/auth/session';
import { listMemoirChapterHistory } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId, type MemoirChapterContext } from '../../../../_params';
import { memoirPageInputSchema, memoirChapterHistoryKindSchema } from '@/contracts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: MemoirChapterContext) {
  try { const actor = await requireMember(); const path = await params; const query = new URL(request.url).searchParams;
    const { kind, ...rest } = Object.fromEntries(query);
    const input = memoirPageInputSchema.parse({ ...rest, cursor: query.get('cursor'), limit: query.has('limit') ? Number(query.get('limit')) : 50 });
    return dataResponse(await listMemoirChapterHistory(actor.id, privateId(path.memoirId), privateId(path.chapterId), memoirChapterHistoryKindSchema.parse(kind), input));
  } catch (error) { return errorResponse(error); }
}
