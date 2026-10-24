import { versionInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { adoptGeneratedModel } from '@/server/core/model-generation';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId } from '../../../../../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: { params: Promise<{ museumId: string; exhibitId: string; jobId: string }> }) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const input = versionInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await adoptGeneratedModel(
      member.id, privateId(ids.museumId), privateId(ids.exhibitId), privateId(ids.jobId), input.expectedVersion));
  } catch (error) { return errorResponse(error); }
}
