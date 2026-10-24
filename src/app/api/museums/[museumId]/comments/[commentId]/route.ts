import { versionedOperationInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { deleteComment } from '@/server/core/social';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId } from '../../../_params';
export async function DELETE(request: Request, { params }: { params: Promise<{ museumId: string; commentId: string }> }) {
  try {
    requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await deleteComment(actor.id, privateId(path.museumId), privateId(path.commentId), versionedOperationInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
