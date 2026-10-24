import { requireMember } from '@/server/auth/session';
import { readShareContributions } from '@/server/core';
import { dataResponse, errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';
/**
 * 参观页读取多人讲述。
 *
 * 与 `GET /api/share/[token]` 一样按 token 定位、一样要求登录：讲述本身不是新的
 * 可见性面，它只是同一份参观内容的另一段。token 失效或分享已停 → 404，和读不到
 * 展馆时完全相同，不给出"这座馆存在但你没资格看讲述"这种可区分的回答。
 *
 * 只读，所以不做同源校验（那是给写操作防 CSRF 的）。
 * 没有 POST：写讲述走 `/api/museums/.../contributions`，那条路径要校验署名权。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const member = await requireMember();
    return dataResponse(await readShareContributions(member.id, (await params).token));
  } catch (error) { return errorResponse(error); }
}
