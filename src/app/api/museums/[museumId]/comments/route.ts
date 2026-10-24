import { commentListInputSchema } from '@/contracts';
import { requireMember } from '@/server/auth/session';
import { listManagedComments } from '@/server/core/social';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: MuseumContext) {
  try {
    const actor = await requireMember(); const query = new URL(request.url).searchParams;
    return dataResponse(await listManagedComments(actor.id, privateId((await params).museumId), commentListInputSchema.parse({ ...Object.fromEntries(query),
      cursor: query.get('cursor'), limit: query.has('limit') ? Number(query.get('limit')) : 50 })));
  } catch (error) { return errorResponse(error); }
}
