import { updatePublicProfileInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { getPublicProfile, updatePublicProfile } from '@/server/core/discovery';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return dataResponse(await getPublicProfile((await requireMember()).id)); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireMember();
    return dataResponse(await updatePublicProfile(actor.id, updatePublicProfileInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
