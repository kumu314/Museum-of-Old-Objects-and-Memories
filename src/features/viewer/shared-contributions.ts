import type { SharedContribution } from '../../contracts/contributors';

/**
 * 参观页上多人讲述的分组与署名标签（方向二 · 第五块）。
 *
 * 放在这里而不是组件里的原因只有一个：这两条规则要能被测试单独盯住。
 * 分组错了会把 A 的讲述挂到 B 的展品上——这类错误在界面上看起来完全正常，
 * 只有对着数据逐条核才发现。
 */

export type ContributionAuthorLabel = '物主' | '共同讲述者';

/**
 * 署名标签。`owner` 与 `coauthor` 必须给出不同标签：
 * 都写成"讲述者"，读者会以为这些话都是馆主说的，而这正是多人记忆最该避免的混淆。
 */
export function authorLabel(role: SharedContribution['authorRole']): ContributionAuthorLabel {
  return role === 'owner' ? '物主' : '共同讲述者';
}

/**
 * 按展品分组。输入顺序原样保留——服务端已按创建时间排好，谁先讲、谁后补
 * 本身就是这段记忆的一部分，前端不得重排、不得按作者聚合。
 */
export function groupContributions(list: readonly SharedContribution[]): ReadonlyMap<string, readonly SharedContribution[]> {
  const grouped = new Map<string, SharedContribution[]>();
  for (const item of list) {
    const bucket = grouped.get(item.exhibitId);
    if (bucket === undefined) grouped.set(item.exhibitId, [item]);
    else bucket.push(item);
  }
  return grouped;
}
