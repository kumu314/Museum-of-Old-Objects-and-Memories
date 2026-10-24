import { DiscoveryDemo } from '../../features/discovery/discovery-demo';
import { requirePageUser } from '../../server/auth/page-user';

export const dynamic = 'force-dynamic';
export default async function WorldPage() {
  const user = await requirePageUser();
  return <DiscoveryDemo viewerId={user.id} />;
}
