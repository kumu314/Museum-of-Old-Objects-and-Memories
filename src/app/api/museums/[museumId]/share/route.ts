import { versionInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { rotateShareToken, stopSharing } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';

export async function POST(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const museumId = privateId((await params).museumId);
    const input = versionInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await rotateShareToken(member.id, museumId, input.expectedVersion));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const museumId = privateId((await params).museumId);
    const input = versionInputSchema.parse(await readJsonRequest(request));
    await stopSharing(member.id, museumId, input.expectedVersion);
    return dataResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
