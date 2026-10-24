import type { Metadata } from 'next';
import { MuseumVisit } from '../../../features/viewer/museum-visit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '旧物纪念展 · 拾物馆', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MuseumVisit key={token} token={token} />;
}
