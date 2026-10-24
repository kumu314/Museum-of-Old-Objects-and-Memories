import { relationshipInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { setFavorite } from '@/server/core/social';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId } from '../../../../museums/_params';
type Context = { params: Promise<{ museumId: string; accessEpoch: string }> };
async function write(request: Request, { params }: Context, favorited: boolean) {
  try {
    requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    return dataResponse(await setFavorite(actor.id, privateId(path.museumId), privateId(path.accessEpoch), relationshipInputSchema.parse(await readJsonRequest(request)), favorited));
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: Context) { return write(request, context, true); }
export async function DELETE(request: Request, context: Context) { return write(request, context, false); }
