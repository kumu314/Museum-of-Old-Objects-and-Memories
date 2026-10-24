import type { Metadata } from 'next';
import { MyContributions } from '../../features/contributors/my-contributions';
import { listMyContributions } from '../../server/core';
import { requirePageUser } from '../../server/auth/page-user';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '我参与的讲述 · 拾物馆',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * 共同作者的工作台（真实数据）。
 *
 * 首版只对登录用户开放：仓库里没有匿名只读通道，这些内容也不该被搜索引擎索引。
 * 页面只读"我的"邀请与"我的"讲述——别人的草稿不在这一页，服务端也不会给。
 */
export default async function CoauthorPage() {
  const member = await requirePageUser();
  const data = await listMyContributions(member.id);
  return <MyContributions initial={data} />;
}
