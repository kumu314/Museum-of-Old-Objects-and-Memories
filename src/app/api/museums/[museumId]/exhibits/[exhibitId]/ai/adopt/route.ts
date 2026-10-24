import { adoptAiInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { adoptAiDraft } from '@/server/core/ai';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type ExhibitContext } from '../../../../../_params';

export async function POST(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const input = adoptAiInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await adoptAiDraft(member.id, museumId, exhibitId, input));
  } catch (error) { return errorResponse(error); }
}
