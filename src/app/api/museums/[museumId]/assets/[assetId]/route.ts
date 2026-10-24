import { requireUser } from '@/server/auth/session';
import { getPrivateAsset } from '@/server/core/museums';
import { assetFileResponse } from '@/server/core/assets';
import { errorResponse } from '@/server/http';
import { privateId } from '../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ museumId: string; assetId: string }> }) {
  try {
    const user = await requireUser();
    const values = await params;
    const stored = await getPrivateAsset(user.id, privateId(values.museumId), privateId(values.assetId));
    return await assetFileResponse(stored, request);
  } catch (error) { return errorResponse(error); }
}
