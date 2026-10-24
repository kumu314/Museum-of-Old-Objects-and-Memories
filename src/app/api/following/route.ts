import { discoverySearchInputSchema } from '@/contracts';
import { requireMember } from '@/server/auth/session';
import { listFollowing } from '@/server/core/discovery';
import { dataResponse, errorResponse } from '@/server/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const actor = await requireMember(); const query = new URL(request.url).searchParams;
    return dataResponse(await listFollowing(actor.id, discoverySearchInputSchema.parse({ ...Object.fromEntries(query),
      query: query.get('query') ?? '', cursor: query.get('cursor'), limit: query.has('limit') ? Number(query.get('limit')) : 20 })));
  } catch (error) { return errorResponse(error); }
}
