import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MuseumDisplay } from '../../../features/viewer/museum-display';
import { requirePageUser } from '../../../server/auth/page-user';
import { getOwnPublishedMuseum } from '../../../server/core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '已发布展馆 · 拾物馆', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function PublishedMuseumPage() {
  const user = await requirePageUser();
  const museum = await getOwnPublishedMuseum(user.id);
  if (!museum) redirect('/studio');
  return <MuseumDisplay key={`${museum.id}:${museum.version}`} museum={museum} mode="published-owner" />;
}
