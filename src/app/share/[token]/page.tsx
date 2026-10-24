import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MuseumVisit } from '../../../features/viewer/museum-visit';
import { requireMember } from '../../../server/auth/session';
import { HttpError } from '../../../server/http';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '旧物纪念展 · 拾物馆', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try { await requireMember(); }
  catch (error: unknown) {
    if (error instanceof HttpError && error.failure.code === 'UNAUTHORIZED') {
      redirect(`/login?next=${encodeURIComponent(`/share/${token}`)}`);
    }
    throw error;
  }
  return <MuseumVisit key={token} token={token} />;
}
