import { requireMember } from '@/server/auth/session';
import { getModelGenerationJob } from '@/server/core/model-generation';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId } from '../../../../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 轮询是读操作：同源 GET 不发送 Origin 头，不能套用写请求的 requireSameOrigin；
// 访问控制由登录会话与展馆归属校验承担。
export async function GET(_request: Request, { params }: { params: Promise<{ museumId: string; exhibitId: string; jobId: string }> }) {
  try {
    const member = await requireMember();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const jobId = privateId(ids.jobId);
    return dataResponse(await getModelGenerationJob(member.id, museumId, exhibitId, jobId));
  } catch (error) { return errorResponse(error); }
}
