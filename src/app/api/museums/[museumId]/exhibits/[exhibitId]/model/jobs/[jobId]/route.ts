import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { getModelGenerationJob } from '@/server/core/model-generation';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId } from '../../../../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ museumId: string; exhibitId: string; jobId: string }> }) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const jobId = privateId(ids.jobId);
    return dataResponse(await getModelGenerationJob(member.id, museumId, exhibitId, jobId));
  } catch (error) { return errorResponse(error); }
}
