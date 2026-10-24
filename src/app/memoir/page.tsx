import { MemoirDemo } from '../../features/memoir/memoir-demo';
import { requirePageUser } from '../../server/auth/page-user';

export const dynamic = 'force-dynamic';
export default async function MemoirPage() {
  const user = await requirePageUser();
  return <MemoirDemo viewerId={user.id} />;
}
