import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { recordMuseumView } from '@/server/core';
import { dataResponse, errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';
/**
 * 参观页上报一次浏览。
 *
 * 按 token 而不是 museumId 定位：参观者手里只有 token，让他先拿 id 再上报，
 * 等于把内部主键发给每一台看展的机器。
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    return dataResponse(await recordMuseumView(member.id, (await params).token), 201);
  } catch (error) { return errorResponse(error); }
}
