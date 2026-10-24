import { grantMemoirPublicationInputSchema, versionedOperationInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { grantMemoirPublication, revokeMemoirPublication } from '@/server/core/memoirs';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MemoirChapterContext } from '../../../../_params';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: MemoirChapterContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await grantMemoirPublication(actor.id, privateId(path.memoirId), privateId(path.chapterId), grantMemoirPublicationInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: MemoirChapterContext) {
  try { requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await revokeMemoirPublication(actor.id, privateId(path.memoirId), privateId(path.chapterId), versionedOperationInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
