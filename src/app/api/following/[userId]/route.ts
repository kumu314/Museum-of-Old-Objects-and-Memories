import { relationshipInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { setFollow } from '@/server/core/social';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId } from '../../museums/_params';
type Context = { params: Promise<{ userId: string }> };
async function write(request: Request, { params }: Context, following: boolean) {
  try {
    requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await setFollow(actor.id, privateId((await params).userId), relationshipInputSchema.parse(await readJsonRequest(request)), following));
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: Context) { return write(request, context, true); }
export async function DELETE(request: Request, context: Context) { return write(request, context, false); }
