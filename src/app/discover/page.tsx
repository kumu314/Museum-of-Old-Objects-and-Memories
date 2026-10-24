import type { Metadata } from 'next';
import { DiscoverBoard } from '../../features/discover/discover-board';
import { requirePageUser } from '../../server/auth/page-user';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '记忆地图 · 拾物馆',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function DiscoverPage() {
  // 首版只对登录用户开放：仓库里目前没有匿名只读通道，开放匿名需要单独的安全契约。
  await requirePageUser();
  // 地图 key 由服务端读出后传下去；客户端组件不直接读 process.env。
  const mapKey = process.env.NEXT_PUBLIC_TMAP_KEY ?? '';
  return <DiscoverBoard mapKey={mapKey} />;
}
