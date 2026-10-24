import { createExhibitInputSchema } from '@/contracts';
import { requireUser, requireSameOrigin } from '@/server/auth/session';
import { createExhibit } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';

export async function POST(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const museumId = privateId((await params).museumId);
    const input = createExhibitInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await createExhibit(user.id, museumId, input), 201);
  } catch (error) { return errorResponse(error); }
}
