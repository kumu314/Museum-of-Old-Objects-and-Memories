import { StudioHome } from '../../features/studio/studio-home';
import { redirect } from 'next/navigation';
import { requirePageUser } from '../../server/auth/page-user';
import { getOwnMuseum } from '../../server/core';

export const dynamic = 'force-dynamic';
export default async function StudioPage() {
  const user = await requirePageUser();
  const museum = await getOwnMuseum(user.id);
  if (museum) redirect(museum.exhibits.length > 0 ? '/museum' : `/studio/${museum.id}`);
  return <StudioHome username={user.username} />;
}
