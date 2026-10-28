import { requireMember } from '@/server/auth/session';
import { getShareModelAsset } from '@/server/core/sharing';
import { sharedModelFileResponse } from '@/server/core/model-file';
import { errorResponse } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ token: string; assetId: string }> }) {
  try {
    const member = await requireMember();
    const { token, assetId } = await params;
    return await sharedModelFileResponse(await getShareModelAsset(member.id, token, assetId), request);
  } catch (error) { return errorResponse(error); }
}
