import { singleModelRequestSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { requestSingleModelGeneration } from '@/server/core/model-generation';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type ExhibitContext } from '../../../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const input = singleModelRequestSchema.parse(await readJsonRequest(request));
    return dataResponse(await requestSingleModelGeneration(member.id, museumId, exhibitId, input));
  } catch (error) { return errorResponse(error); }
}
