import { MemoirWorkspace } from '../../features/memoir/memoir-workspace';
import { MemoirDemo } from '../../features/memoir/memoir-demo';
import { requirePageUser } from '../../server/auth/page-user';

export const dynamic = 'force-dynamic';
export default async function MemoirPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const user = await requirePageUser();
  return (await searchParams).mode === 'local-demo' ? <MemoirDemo viewerId={user.id} /> : <MemoirWorkspace />;
}
