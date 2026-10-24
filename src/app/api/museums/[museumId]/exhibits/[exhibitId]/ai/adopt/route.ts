import { adoptAiInputSchema } from '@/contracts';
import { requireUser, requireSameOrigin } from '@/server/auth/session';
import { adoptAiDraft } from '@/server/core/ai';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type ExhibitContext } from '../../../../../_params';

export async function POST(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const input = adoptAiInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await adoptAiDraft(user.id, museumId, exhibitId, input));
  } catch (error) { return errorResponse(error); }
}
