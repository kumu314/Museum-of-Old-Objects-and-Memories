import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { toMuseumDisplay } from '../../contracts/museum';
import { MuseumDisplay } from '../../features/viewer/museum-display';
import { requirePageUser } from '../../server/auth/page-user';
import { getOwnMuseum } from '../../server/core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '我的展馆 · 拾物馆', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function MyMuseumPage() {
  const user = await requirePageUser();
  const museum = await getOwnMuseum(user.id);
  if (!museum || museum.exhibits.length === 0) redirect(museum ? `/studio/${museum.id}` : '/studio');
  return <MuseumDisplay key={`${museum.id}:${museum.version}`} museum={toMuseumDisplay(museum)} mode="owner" />;
}
