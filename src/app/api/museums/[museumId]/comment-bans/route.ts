import { commentBanInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { setCommentBan } from '@/server/core/social';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';
async function write(request: Request, { params }: MuseumContext, banned: boolean) {
  try {
    requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await setCommentBan(actor.id, privateId((await params).museumId), commentBanInputSchema.parse(await readJsonRequest(request)), banned));
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: MuseumContext) { return write(request, context, true); }
export async function DELETE(request: Request, context: MuseumContext) { return write(request, context, false); }
