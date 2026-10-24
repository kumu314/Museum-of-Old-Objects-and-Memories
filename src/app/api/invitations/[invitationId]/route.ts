import { respondInvitationInputSchema } from '@/contracts/contributors';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { cancelInvitation, respondInvitation } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { privateId, type InvitationContext } from '../_params';

export const dynamic = 'force-dynamic';

/** 被邀请人接受或拒绝。别人的邀请与不存在的邀请得到同一个 NOT_FOUND。 */
export async function PATCH(request: Request, { params }: InvitationContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const { invitationId } = await params;
    const input = respondInvitationInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await respondInvitation(member.id, privateId(invitationId), input));
  } catch (error) { return errorResponse(error); }
}

/** 馆主收回还没被回应的邀请。已接受的收回属于"移出共同作者"，首版没有这个动作。 */
export async function DELETE(request: Request, { params }: InvitationContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const { invitationId } = await params;
    return dataResponse(await cancelInvitation(member.id, privateId(invitationId)));
  } catch (error) { return errorResponse(error); }
}
