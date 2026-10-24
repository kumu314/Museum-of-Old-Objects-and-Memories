import { discoverySearchInputSchema } from '@/contracts';
import { requireMember } from '@/server/auth/session';
import { listDiscovery } from '@/server/core/discovery';
import { dataResponse, errorResponse } from '@/server/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const actor = await requireMember();
    const params = new URL(request.url).searchParams;
    const input = discoverySearchInputSchema.parse({ ...Object.fromEntries(params), query: params.get('query') ?? '',
      cursor: params.get('cursor'), limit: params.has('limit') ? Number(params.get('limit')) : 20 });
    return dataResponse(await listDiscovery(actor.id, input));
  } catch (error) { return errorResponse(error); }
}
