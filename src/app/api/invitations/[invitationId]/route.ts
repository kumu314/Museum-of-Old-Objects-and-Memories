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

/**
 * 馆主收回邀请。
 *
 * 未回应的直接作废；已接受的转为**停止共写**（`cancelled` 并记 `revoked_at`）：
 * 对方不能再新增讲述，已经写下的讲述属于作者本人，仍按本人同意公开，
 * 要下架只能由作者撤回那份内容。
 */
export async function DELETE(request: Request, { params }: InvitationContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const { invitationId } = await params;
    return dataResponse(await cancelInvitation(member.id, privateId(invitationId)));
  } catch (error) { return errorResponse(error); }
}
