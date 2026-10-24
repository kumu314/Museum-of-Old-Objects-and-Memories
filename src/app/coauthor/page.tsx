import type { Metadata } from 'next';
import { ContributionBoard } from '../../features/contributors/contribution-board';
import { requirePageUser } from '../../server/auth/page-user';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '共同作者 · 拾物馆',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * 共同作者规则演示页（DEMO）。
 *
 * 首版只对登录用户开放：仓库里没有匿名只读通道，而这些演示数据本身也不该被索引。
 * 这一页不读写数据库，等共同作者的表落地后，这里的交互会换成真实接口，
 * 但"未接受不署名 / 各自同意 / 只能撤回自己"这三条判定必须留在服务端。
 */
export default async function CoauthorPage() {
  await requirePageUser();
  return <ContributionBoard />;
}
