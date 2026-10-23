import { updateMuseumInputSchema, versionInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { getMuseum, removeMuseum, updateMuseum } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../_params';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: MuseumContext) {
  try {
    const member = await requireMember();
    return dataResponse(await getMuseum(member.id, privateId((await params).museumId)));
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const id = privateId((await params).museumId);
    const input = updateMuseumInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await updateMuseum(member.id, id, input));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const id = privateId((await params).museumId);
    const input = versionInputSchema.parse(await readJsonRequest(request));
    await removeMuseum(member.id, id, input.expectedVersion);
    return dataResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
