import { createContributionInputSchema } from '@/contracts/contributors';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { contribute, readContributionState } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type ExhibitContext } from '../../../../_params';

export const dynamic = 'force-dynamic';

/**
 * 馆主视角的协作状态。只有归属人能读：共同作者读同一份会看到别人
 * 还没同意公开的草稿，所以对方走 `/api/contributions/mine`。
 */
export async function GET(_request: Request, { params }: ExhibitContext) {
  try {
    const member = await requireMember();
    const ids = await params;
    return dataResponse(await readContributionState(member.id, privateId(ids.museumId), privateId(ids.exhibitId)));
  } catch (error) { return errorResponse(error); }
}

/** 写一份讲述：馆主本人，或持有这件展品已接受邀请的人。署名由服务端判定。 */
export async function POST(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const input = createContributionInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await contribute(member.id, privateId(ids.museumId), privateId(ids.exhibitId), input), 201);
  } catch (error) { return errorResponse(error); }
}
