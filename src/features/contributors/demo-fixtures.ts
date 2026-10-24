import { contributionStateSchema, type ContributionState } from '../../contracts/contributors';

/**
 * DEMO 数据。
 *
 * 全部虚构，`isDemo: true` 是字面量，界面必须可见标注。这些人不是真实用户，
 * 这些讲述也不是真实征集来的内容；用途只有一个：把"未接受不能署名、各自同意、
 * 只能撤回自己的"这三条规则演示清楚。
 *
 * 数据在模块加载时就走一遍 `contributionStateSchema.parse`，fixture 与将来的
 * 真实数据服从同一份契约，不可能出现"演示数据能过、真实数据过不了"的分叉。
 */

const MUSEUM_ID = '5a1b0000-0000-4000-8000-000000000001';
const EXHIBIT_ID = '6f1b0000-0000-4000-8000-000000000001';

export const demoOwner = { id: '11110000-0000-4000-8000-000000000001', name: '周砚' } as const;
export const demoLi = { id: '22220000-0000-4000-8000-000000000002', name: '李素云' } as const;
export const demoWang = { id: '33330000-0000-4000-8000-000000000003', name: '王大成' } as const;
export const demoZhao = { id: '44440000-0000-4000-8000-000000000004', name: '赵梅' } as const;

/** 可切换的"当前登录者"，用来演示"换成别人就撤不了你的内容"。 */
export const demoViewers = [demoOwner, demoLi, demoZhao, demoWang] as const;

export const demoExhibitTitle = '为人民服务 · 搪瓷缸';

export const demoState: ContributionState = contributionStateSchema.parse({
  exhibitId: EXHIBIT_ID,
  invitations: [
    {
      id: 'a1000000-0000-4000-8000-000000000001',
      exhibitId: EXHIBIT_ID,
      museumId: MUSEUM_ID,
      inviteeId: demoLi.id,
      inviteeName: demoLi.name,
      status: 'accepted',
      invitedAt: '2026-10-01T10:20:00+08:00',
      respondedAt: '2026-10-01T21:05:00+08:00',
      isDemo: true,
    },
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      exhibitId: EXHIBIT_ID,
      museumId: MUSEUM_ID,
      inviteeId: demoWang.id,
      inviteeName: demoWang.name,
      status: 'pending',
      invitedAt: '2026-10-05T09:00:00+08:00',
      respondedAt: null,
      isDemo: true,
    },
    {
      id: 'a1000000-0000-4000-8000-000000000003',
      exhibitId: EXHIBIT_ID,
      museumId: MUSEUM_ID,
      inviteeId: demoZhao.id,
      inviteeName: demoZhao.name,
      status: 'accepted',
      invitedAt: '2026-10-02T08:30:00+08:00',
      respondedAt: '2026-10-02T19:40:00+08:00',
      isDemo: true,
    },
  ],
  contributions: [
    {
      id: 'c1000000-0000-4000-8000-000000000001',
      exhibitId: EXHIBIT_ID,
      authorId: demoOwner.id,
      authorName: demoOwner.name,
      authorRole: 'owner',
      story: '缸是父亲 1979 年从厂里带回来的，缸沿磕掉一块瓷，一直没舍得换。他说那年车间搞劳动竞赛，奖品就是这个。',
      sourceNote: '周砚口述，2026-09-28 在其家中录音整理',
      publishConsent: true,
      withdrawnAt: null,
      createdAt: '2026-09-28T15:10:00+08:00',
      isDemo: true,
    },
    {
      id: 'c1000000-0000-4000-8000-000000000002',
      exhibitId: EXHIBIT_ID,
      authorId: demoLi.id,
      authorName: demoLi.name,
      authorRole: 'coauthor',
      story: '我在厂里做统计，那个缸我见过——不是奖品，是车间统一发的劳保用品，每人一只，缸底还印了编号。',
      sourceNote: '李素云口述，2026-10-02 于家属院',
      publishConsent: true,
      withdrawnAt: null,
      createdAt: '2026-10-02T19:45:00+08:00',
      isDemo: true,
    },
    {
      id: 'c1000000-0000-4000-8000-000000000003',
      exhibitId: EXHIBIT_ID,
      authorId: demoWang.id,
      authorName: demoWang.name,
      authorRole: 'coauthor',
      // 邀请还没被接受：这段内容只能停在草稿里，绝不能带署名出现在公开版本。
      story: '缸底编号我记得是 037，跟工号一致，发的时候按工号领。',
      sourceNote: '王大成电话口述，2026-10-05',
      publishConsent: true,
      withdrawnAt: null,
      createdAt: '2026-10-05T09:20:00+08:00',
      isDemo: true,
    },
    {
      id: 'c1000000-0000-4000-8000-000000000004',
      exhibitId: EXHIBIT_ID,
      authorId: demoZhao.id,
      authorName: demoZhao.name,
      authorRole: 'coauthor',
      // 已接受邀请，但本人没有同意公开：内容必须留在系统里、停在公开版本之外。
      story: '我母亲那只缸后来拿去腌咸菜了，缸口太大，盖不住，得压块石头。',
      sourceNote: '赵梅口述，2026-10-03',
      publishConsent: false,
      withdrawnAt: null,
      createdAt: '2026-10-03T11:00:00+08:00',
      isDemo: true,
    },
    {
      id: 'c1000000-0000-4000-8000-000000000005',
      exhibitId: EXHIBIT_ID,
      authorId: demoLi.id,
      authorName: demoLi.name,
      authorRole: 'coauthor',
      // 已撤回：新公开版本必须移除，但记录本身不删（要留下"曾经提交过"的事实）。
      story: '（这段是李素云早先写的一版，已经撤回，公开版本里不应出现。）',
      sourceNote: '李素云口述，2026-10-01',
      publishConsent: true,
      withdrawnAt: '2026-10-04T10:00:00+08:00',
      createdAt: '2026-10-01T22:00:00+08:00',
      isDemo: true,
    },
  ],
});
