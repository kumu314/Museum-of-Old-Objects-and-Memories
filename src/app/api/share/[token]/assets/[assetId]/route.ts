import { getShareAsset } from '@/server/core/sharing';
import { assetFileResponse } from '@/server/core/assets';
import { errorResponse } from '@/server/http';
import { requireUser } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ token: string; assetId: string }> }) {
  try {
    await requireUser();
    const { token, assetId } = await params;
    return await assetFileResponse(await getShareAsset(token, assetId), request, true);
  } catch (error) { return errorResponse(error); }
}
