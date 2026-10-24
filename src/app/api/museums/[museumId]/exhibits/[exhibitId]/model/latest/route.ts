import { requireMember } from '@/server/auth/session';
import { getLatestModelGenerationJob } from '@/server/core/model-generation';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId } from '../../../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 读操作：刷新后用最新任务恢复界面，访问控制由登录会话与归属校验承担。
export async function GET(_request: Request, { params }: { params: Promise<{ museumId: string; exhibitId: string }> }) {
  try {
    const member = await requireMember();
    const ids = await params;
    return dataResponse(await getLatestModelGenerationJob(member.id, privateId(ids.museumId), privateId(ids.exhibitId)));
  } catch (error) { return errorResponse(error); }
}
