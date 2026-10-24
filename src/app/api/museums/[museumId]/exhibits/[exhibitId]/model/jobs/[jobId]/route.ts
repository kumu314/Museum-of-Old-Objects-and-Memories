import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { getModelGenerationJob } from '@/server/core/model-generation';
import { dataResponse, errorResponse } from '@/server/http';
import { privateId } from '../../../../../../_params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 同源 GET 通常不发送 Origin；浏览器来源使用 Fetch Metadata 检查，另核对会话与归属。
export async function GET(request: Request, { params }: { params: Promise<{ museumId: string; exhibitId: string; jobId: string }> }) {
  try {
    // 查询会推进纹理阶段；拒绝浏览器跨站触发付费副作用。
    const site = request.headers.get('sec-fetch-site');
    if (site !== null && site !== 'same-origin') requireSameOrigin(request);
    const member = await requireMember();
    const ids = await params;
    const museumId = privateId(ids.museumId);
    const exhibitId = privateId(ids.exhibitId);
    const jobId = privateId(ids.jobId);
    return dataResponse(await getModelGenerationJob(member.id, museumId, exhibitId, jobId));
  } catch (error) { return errorResponse(error); }
}
