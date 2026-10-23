import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { readAssetUpload, uploadAsset } from '@/server/core/assets';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';

export const runtime = 'nodejs';
export async function POST(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const museumId = privateId((await params).museumId);
    return dataResponse(await uploadAsset(member.id, museumId, await readAssetUpload(request)), 201);
  } catch (error) { return errorResponse(error); }
}
