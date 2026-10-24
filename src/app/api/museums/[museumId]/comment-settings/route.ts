import { updateCommentSettingsInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { getCommentSettings, updateCommentSettings } from '@/server/core/social';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MuseumContext) {
  try { return dataResponse(await getCommentSettings((await requireMember()).id, privateId((await params).museumId))); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await updateCommentSettings(actor.id, privateId((await params).museumId), updateCommentSettingsInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
