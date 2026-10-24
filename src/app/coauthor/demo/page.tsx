import type { Metadata } from 'next';
import { ContributionBoard } from '../../../features/contributors/contribution-board';
import { requirePageUser } from '../../../server/auth/page-user';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '共同作者规则演示 · 拾物馆',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * 规则演示页（DEMO）。
 *
 * `/coauthor` 已经是真实数据；这一页保留下来是为了能在不注册两个账号的前提下，
 * 把"未接受不署名 / 各自同意 / 只能撤回自己"三条判定完整走一遍。
 * 页面数据全部来自 `demo-fixtures.ts`，不读写数据库，刷新即还原，界面上有可见的 DEMO 标注。
 */
export default async function CoauthorDemoPage() {
  await requirePageUser();
  return <ContributionBoard />;
}
