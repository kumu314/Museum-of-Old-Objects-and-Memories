import { confirmExhibitInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { confirmExhibit } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type ExhibitContext } from '../../../../_params';

export async function POST(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const input = confirmExhibitInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await confirmExhibit(member.id, museumId, exhibitId, input));
  } catch (error) { return errorResponse(error); }
}
