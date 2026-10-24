import { moderateCommentInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { moderateComment } from '@/server/core/social';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId } from '../../../../_params';
export async function PATCH(request: Request, { params }: { params: Promise<{ museumId: string; commentId: string }> }) {
  try {
    requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await moderateComment(actor.id, privateId(path.museumId), privateId(path.commentId), moderateCommentInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
