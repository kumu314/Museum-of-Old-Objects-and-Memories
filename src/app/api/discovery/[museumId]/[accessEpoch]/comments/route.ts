import { commentListInputSchema, createCommentInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { createComment, listComments } from '@/server/core/social';
import { dataResponse, errorResponse, HttpError, readJsonRequest } from '@/server/http';
import { privateId } from '../../../../museums/_params';
type Context = { params: Promise<{ museumId: string; accessEpoch: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireMember(); const path = await params; const query = new URL(request.url).searchParams;
    return dataResponse(await listComments(actor.id, privateId(path.museumId), privateId(path.accessEpoch), commentListInputSchema.parse({ ...Object.fromEntries(query),
      cursor: query.get('cursor'), limit: query.has('limit') ? Number(query.get('limit')) : 50 })));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request); const actor = await requireMember(); const path = await params;
    const epoch = privateId(path.accessEpoch);
    const input = createCommentInputSchema.parse(await readJsonRequest(request));
    if (input.accessEpoch !== epoch) throw new HttpError({ code: 'NOT_FOUND', message: '此入口不可用。' });
    return dataResponse(await createComment(actor.id, privateId(path.museumId), input), 201);
  } catch (error) { return errorResponse(error); }
}
