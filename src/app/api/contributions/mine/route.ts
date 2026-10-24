import { requireMember } from '@/server/auth/session';
import { listMyContributions } from '@/server/core';
import { dataResponse, errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * 我收到的邀请与我写过的讲述。
 *
 * 这是共同作者唯一能读到的协作数据：不包含别人的讲述、不含别人的草稿，
 * 也不含馆主的邀请记录。馆主看全貌要走展品下的 `/contributions`。
 */
export async function GET() {
  try {
    const member = await requireMember();
    return dataResponse(await listMyContributions(member.id));
  } catch (error) { return errorResponse(error); }
}
