import { versionInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { publishMuseum } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';

export async function POST(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const museumId = privateId((await params).museumId);
    const input = versionInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await publishMuseum(member.id, museumId, input.expectedVersion));
  } catch (error) { return errorResponse(error); }
}
