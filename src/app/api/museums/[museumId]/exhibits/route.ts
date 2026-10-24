import { createExhibitInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { createExhibit } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';

export async function POST(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const museumId = privateId((await params).museumId);
    const input = createExhibitInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await createExhibit(member.id, museumId, input), 201);
  } catch (error) { return errorResponse(error); }
}
