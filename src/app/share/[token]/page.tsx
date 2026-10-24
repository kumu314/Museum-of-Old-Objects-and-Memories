import { notFound, redirect } from 'next/navigation';
import { loginDestination } from '../../../features/studio/login-destination';
import { SharedMuseum } from '../../../features/viewer/shared-museum';
import { requireMember } from '../../../server/auth/session';
import { readShare, readShareContributions } from '../../../server/core/sharing';
import { HttpError } from '../../../server/http';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const member = await requireMember().catch((error: unknown) => {
    if (error instanceof HttpError && error.failure.code === 'UNAUTHORIZED') {
      redirect(`/login?next=${encodeURIComponent(loginDestination(`/share/${token}`))}`);
    }
    throw error;
  });
  const museum = await readShare(member.id, token).catch((error: unknown) => {
    if (error instanceof HttpError && error.failure.code === 'SHARE_NOT_FOUND') notFound();
    throw error;
  });
  // 多人讲述不在快照里，单独读一次，首屏就能看到，不必等客户端补拉。
  // 它和展馆走同一个 token 门禁：上一步已经确认读得到展馆，这里跟着读就是了。
  const shared = await readShareContributions(member.id, token).catch((error: unknown) => {
    if (error instanceof HttpError && error.failure.code === 'SHARE_NOT_FOUND') notFound();
    throw error;
  });
  return <SharedMuseum key={token} token={token} initialMuseum={museum} initialContributions={shared.contributions} />;
}
