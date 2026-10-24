import { updateExhibitInputSchema, versionInputSchema } from '@/contracts';
import { requireUser, requireSameOrigin } from '@/server/auth/session';
import { removeExhibit, updateExhibit } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type ExhibitContext } from '../../../_params';

export async function PATCH(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const input = updateExhibitInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await updateExhibit(user.id, museumId, exhibitId, input));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const input = versionInputSchema.parse(await readJsonRequest(request));
    await removeExhibit(user.id, museumId, exhibitId, input.expectedVersion);
    return dataResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
