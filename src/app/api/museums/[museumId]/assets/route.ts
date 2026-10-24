import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { assertMuseumAccess } from '@/server/core';
import { readAssetUpload, uploadAsset } from '@/server/core/assets';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId, type MuseumContext } from '../../_params';

export const runtime = 'nodejs';
export async function POST(request: Request, { params }: MuseumContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const museumId = privateId((await params).museumId);
    // 归属判断放在解析请求体之前：他人展馆的上传不该先把整个文件读进内存再拒绝。
    await assertMuseumAccess(member.id, museumId);
    return dataResponse(await uploadAsset(member.id, museumId, await readAssetUpload(request)), 201);
  } catch (error) { return errorResponse(error); }
}
