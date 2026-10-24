import { notFound, redirect } from 'next/navigation';
import { loginDestination } from '../../../features/studio/login-destination';
import { SharedMuseum } from '../../../features/viewer/shared-museum';
import { requireMember } from '../../../server/auth/session';
import { readShare } from '../../../server/core/sharing';
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
  return <SharedMuseum key={token} token={token} initialMuseum={museum} />;
}
