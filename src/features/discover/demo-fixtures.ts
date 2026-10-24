import type { RegionCity } from '../../contracts/discovery';

export type DemoMuseum = {
  readonly museumId: string;
  readonly title: string;
  readonly regionCity: RegionCity | null;
  readonly viewCount: number;
  /** 字面量而不是 boolean：fixture 只能是演示数据，不允许被改成 false。 */
  readonly isDemo: true;
};

/**
 * DEMO fixture。**不是真实用户、不是真实浏览量、不是真实生成结果。**
 *
 * - 全部 `isDemo: true`，界面必须显示可见的 DEMO 标注；
 * - museumId 使用固定 uuid，好让 fixture 与将来真实接口走同一份契约校验；
 * - viewCount 是写死的小数字，不得在任何文案里被描述成"河南有多少人在看"。
 *
 * 真实聚合接入后本文件应删除，而不是改成默认值继续存在。
 */
export const demoMuseums: readonly DemoMuseum[] = [
  { museumId: '00000000-0000-4000-8000-000000000001', title: '【演示】洛阳老厂区的搪瓷缸', regionCity: '洛阳', viewCount: 12, isDemo: true },
  { museumId: '00000000-0000-4000-8000-000000000002', title: '【演示】郑州国棉厂的换班牌', regionCity: '郑州', viewCount: 9, isDemo: true },
  { museumId: '00000000-0000-4000-8000-000000000003', title: '【演示】开封鼓楼旁的收音机', regionCity: '开封', viewCount: 7, isDemo: true },
  { museumId: '00000000-0000-4000-8000-000000000004', title: '【演示】南阳乡下的木斗', regionCity: '南阳', viewCount: 5, isDemo: true },
  { museumId: '00000000-0000-4000-8000-000000000005', title: '【演示】信阳茶场的记账本', regionCity: '信阳', viewCount: 5, isDemo: true },
  { museumId: '00000000-0000-4000-8000-000000000006', title: '【演示】安阳老宅的门簪', regionCity: '安阳', viewCount: 3, isDemo: true },
  { museumId: '00000000-0000-4000-8000-000000000007', title: '【演示】郑州二七广场的旧车票', regionCity: '郑州', viewCount: 2, isDemo: true },
  { museumId: '00000000-0000-4000-8000-000000000008', title: '【演示】洛阳涧西的搪瓷脸盆', regionCity: '洛阳', viewCount: 1, isDemo: true },
  // 未选择城市：会出现在榜单里，但不进地图聚合（不按 IP 推断、不猜地点）。
  { museumId: '00000000-0000-4000-8000-000000000009', title: '【演示】未标注城市的一只木箱', regionCity: null, viewCount: 0, isDemo: true },
];
