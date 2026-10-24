import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { withdrawContribution } from '@/server/core';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId, type ContributionContext } from '../../_params';

export const dynamic = 'force-dynamic';

/**
 * 撤回自己的一份讲述。
 *
 * 只认作者本人：`author_id` 写在 SQL 的 WHERE 里，没有任何"代表别人撤回"的入口。
 * 撤回立即影响公开版本（发布时按 `withdrawn_at` 过滤），不需要等馆主重新发布。
 */
export async function POST(request: Request, { params }: ContributionContext) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const { contributionId } = await params;
    return dataResponse(await withdrawContribution(member.id, privateId(contributionId)));
  } catch (error) { return errorResponse(error); }
}
