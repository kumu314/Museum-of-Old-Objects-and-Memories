import { notFound } from 'next/navigation';
import { SharedMuseum } from '../../../features/viewer/shared-museum';
import { readShare } from '../../../server/core/sharing';
import { HttpError } from '../../../server/http';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const museum = await readShare(token).catch((error: unknown) => {
    if (error instanceof HttpError && error.failure.code === 'SHARE_NOT_FOUND') notFound();
    throw error;
  });
  return <SharedMuseum key={token} token={token} initialMuseum={museum} />;
}
