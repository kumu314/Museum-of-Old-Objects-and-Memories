import {
  contributionStateSchema,
  publicationViewSchema,
  type Contribution,
  type ContributionInvitation,
  type ContributionState,
  type ExclusionReason,
  type PublicationView,
} from '../../contracts/contributors';

/**
 * 共同作者的纯规则层：不碰数据库、不碰网络，只吃契约、吐契约。
 *
 * 之所以先写成纯函数，是因为这几条规则将来要在服务端强制执行（发布事务、
 * 分享读取、接口授权），先在无 IO 的地方把它们固定下来并跑用例，比在路由里
 * 边写 SQL 边推演安全得多。
 *
 * **不提供合并、摘要、润色任何多人讲述的函数。** 同一实物下的多份讲述必须
 * 各自独立呈现；一旦有了"把几段话揉成一段"的工具，就迟早会有人用它，
 * 而那样等于替作者改了话、也抹掉了来源。
 */

/** 该展品上真正拥有署名权的人。只有 accepted 算数，其余状态一律不算。 */
export function acceptedAuthorIds(invitations: readonly ContributionInvitation[], exhibitId: string): Set<string> {
  return new Set(invitations.filter((invitation) => invitation.status === 'accepted' && invitation.exhibitId === exhibitId).map((invitation) => invitation.inviteeId));
}

/**
 * 一份讲述没能进入公开版本的原因。返回 null 表示可以公开。
 *
 * 判定顺序是有意的：先看是否已撤回，再看本人是否同意，最后才看署名权。
 * 已经撤回的内容，即使作者又点了同意，也不该被当成"只差一个勾"——撤回是更强的意思表示。
 */
export function exclusionReasonFor(
  contribution: Contribution,
  invitations: readonly ContributionInvitation[],
): ExclusionReason | null {
  if (contribution.withdrawnAt !== null) return 'withdrawn';
  if (!contribution.publishConsent) return 'no-consent';
  // 馆主不需要邀请；共同作者必须有该展品上已接受的邀请，否则不得署名。
  if (contribution.authorRole === 'coauthor' && !acceptedAuthorIds(invitations, contribution.exhibitId).has(contribution.authorId)) {
    return 'invitation-not-accepted';
  }
  return null;
}

/**
 * 产出公开版本视图。
 *
 * 每个作者的内容各自成条：不排序成"主叙述 + 补充"，也不拼接。
 * 时间顺序是唯一的中立顺序，按 `createdAt`、再用 id 兜底保证同一份数据每次渲染都一样。
 */
export function toPublicationView(state: ContributionState): PublicationView {
  const ordered = [...state.contributions].sort((left, right) => {
    const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return timeDifference || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
  const contributions = [];
  const excluded = [];
  for (const contribution of ordered) {
    const reason = exclusionReasonFor(contribution, state.invitations);
    if (reason === null) {
      contributions.push({
        id: contribution.id,
        authorId: contribution.authorId,
        authorName: contribution.authorName,
        authorRole: contribution.authorRole,
        story: contribution.story,
        sourceNote: contribution.sourceNote,
      });
    } else {
      // 只暴露"有人撤了/没同意"，不暴露被排除的正文。
      excluded.push({ id: contribution.id, authorName: contribution.authorName, reason });
    }
  }
  return publicationViewSchema.parse({ exhibitId: state.exhibitId, contributions, excluded });
}

export type WithdrawOutcome =
  | { readonly ok: true; readonly state: ContributionState }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-author' | 'already-withdrawn' };

/**
 * 撤回一份自己的讲述。
 *
 * `actorId` 必填，且只与 `authorId` 比对 —— 这条规则是整个功能的安全边界：
 * 贡献者只能撤回自己的内容，不能删除他人的，也没有任何"代表别人撤回"的入口。
 *
 * 注意：接口层应把 `not-found` 与 `not-author` 都映射为同一个 `NOT_FOUND`，
 * 否则等于向调用方提供"这条 id 是否存在"的探测通道。
 */
export function withdrawContribution(
  state: ContributionState,
  contributionId: string,
  actorId: string,
  at: string,
): WithdrawOutcome {
  const target = state.contributions.find((contribution) => contribution.id === contributionId);
  if (target === undefined) return { ok: false, reason: 'not-found' };
  if (target.authorId !== actorId) return { ok: false, reason: 'not-author' };
  if (target.withdrawnAt !== null) return { ok: false, reason: 'already-withdrawn' };
  return {
    ok: true,
    state: contributionStateSchema.parse({
      ...state,
      contributions: state.contributions.map((contribution) => contribution.id === contributionId
        ? { ...contribution, withdrawnAt: at }
        : contribution),
    }),
  };
}

/**
 * 一次性撤回某位作者在本展品的全部讲述（"整体撤回"）。
 *
 * 语义仍然是"只能撤回自己的"：函数没有 actor 参数之外的入口，而它只改
 * `authorId === actorId` 的那几条，其余作者的内容逐字保留。
 */
export function withdrawAllByAuthor(state: ContributionState, actorId: string, at: string): ContributionState {
  return contributionStateSchema.parse({
    ...state,
    contributions: state.contributions.map((contribution) => contribution.authorId === actorId && contribution.withdrawnAt === null
      ? { ...contribution, withdrawnAt: at }
      : contribution),
  });
}

export type Participant = {
  readonly userId: string;
  readonly name: string;
  readonly role: 'owner' | 'coauthor';
  readonly invitationStatus: 'none' | 'pending' | 'accepted' | 'declined' | 'cancelled';
  readonly contributionCount: number;
};

/**
 * 参与者列表，供邀请面板显示。
 *
 * 馆主永远在列表首位且不受邀请影响；其余人按"已接受 → 待回应 → 其他"排列，
 * 让馆主一眼看出谁还没接受。
 */
export function participantList(state: ContributionState): Participant[] {
  const participants = new Map<string, Participant>();
  const bump = (userId: string, name: string, role: Participant['role']) => {
    const current = participants.get(userId);
    if (current === undefined) {
      participants.set(userId, { userId, name, role, invitationStatus: 'none', contributionCount: 1 });
    } else {
      participants.set(userId, { ...current, contributionCount: current.contributionCount + 1 });
    }
  };
  for (const contribution of state.contributions) bump(contribution.authorId, contribution.authorName, contribution.authorRole);
  for (const invitation of state.invitations) {
    const current = participants.get(invitation.inviteeId);
    if (current === undefined) {
      participants.set(invitation.inviteeId, {
        userId: invitation.inviteeId,
        name: invitation.inviteeName,
        role: 'coauthor',
        invitationStatus: invitation.status,
        contributionCount: 0,
      });
    } else {
      participants.set(invitation.inviteeId, { ...current, invitationStatus: invitation.status });
    }
  }
  const order: Record<Participant['invitationStatus'], number> = { none: 0, accepted: 1, pending: 2, declined: 3, cancelled: 4 };
  return [...participants.values()].sort((left, right) => (left.role === 'owner' ? -1 : 0) - (right.role === 'owner' ? -1 : 0)
    || order[left.invitationStatus] - order[right.invitationStatus]
    || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}
