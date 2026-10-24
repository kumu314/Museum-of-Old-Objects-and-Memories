import { updateMuseumTagsInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { getMuseumTags, updateMuseumTags } from '@/server/core/discovery';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MuseumContext) {
  try { return dataResponse(await getMuseumTags((await requireMember()).id, privateId((await params).museumId))); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const actor = await requireMember();
    const museumId = privateId((await params).museumId);
    return dataResponse(await updateMuseumTags(actor.id, museumId, updateMuseumTagsInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
