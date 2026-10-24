import { updateMuseumInputSchema, versionInputSchema } from '@/contracts';
import { requireUser, requireSameOrigin } from '@/server/auth/session';
import { getMuseum, removeMuseum, updateMuseum } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../_params';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MuseumContext) {
  try {
    const user = await requireUser();
    return dataResponse(await getMuseum(user.id, privateId((await params).museumId)));
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const id = privateId((await params).museumId);
    const input = updateMuseumInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await updateMuseum(user.id, id, input));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const id = privateId((await params).museumId);
    const input = versionInputSchema.parse(await readJsonRequest(request));
    await removeMuseum(user.id, id, input.expectedVersion);
    return dataResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
