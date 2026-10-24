import { createInvitationInputSchema } from '@/contracts/contributors';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { inviteContributor } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type ExhibitContext } from '../../../../_params';

export const dynamic = 'force-dynamic';

/**
 * 邀请某人讲这一件展品。粒度就是这件展品，不扩散到整馆。
 *
 * 邀请只创建"待回应"记录，不产生署名权；对方接受之前，他没有资格在这件展品
 * 下写任何内容（`contribute` 会返回 NOT_FOUND）。
 */
export async function POST(request: Request, { params }: ExhibitContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const input = createInvitationInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await inviteContributor(member.id, privateId(ids.museumId), privateId(ids.exhibitId), input), 201);
  } catch (error) { return errorResponse(error); }
}
