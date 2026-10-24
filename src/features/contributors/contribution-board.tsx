'use client';

import { useMemo, useState } from 'react';
import type { ContributionState, ExclusionReason } from '../../contracts/contributors';
import { demoExhibitTitle, demoOwner, demoState, demoViewers } from './demo-fixtures';
import { participantList, toPublicationView, withdrawAllByAuthor, withdrawContribution } from './model';
import styles from './contributors.module.css';

const reasonLabel: Record<ExclusionReason, string> = {
  'invitation-not-accepted': '未接受邀请，不能署名',
  'no-consent': '作者本人未同意公开',
  withdrawn: '作者已撤回',
};

const statusLabel = {
  none: '馆主',
  pending: '待回应',
  accepted: '已接受',
  declined: '已拒绝',
  cancelled: '已收回',
} as const;

/** 本地时区的 ISO 时间串，带偏移量。契约要求带偏移，不用 `toISOString` 的 Z 形式。 */
function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function ContributionBoard() {
  const [state, setState] = useState<ContributionState>(demoState);
  const [viewerId, setViewerId] = useState<string>(demoOwner.id);
  const [notice, setNotice] = useState<string>('');

  const view = useMemo(() => toPublicationView(state), [state]);
  const participants = useMemo(() => participantList(state), [state]);
  const viewer = demoViewers.find((person) => person.id === viewerId) ?? demoOwner;
  const ownActive = state.contributions.filter((contribution) => contribution.authorId === viewerId && contribution.withdrawnAt === null);
  const pendingInvitation = state.invitations.find((invitation) => invitation.inviteeId === viewerId && invitation.status === 'pending');

  function withdraw(contributionId: string) {
    const outcome = withdrawContribution(state, contributionId, viewerId, stamp());
    if (outcome.ok) {
      setState(outcome.state);
      setNotice('已撤回。公开版本里这条已经消失，其他人的讲述未受影响。');
      return;
    }
    // 这三条都是服务端将来必须自己判的边界，界面只是提前把结果说出来。
    setNotice(outcome.reason === 'not-author'
      ? '只能撤回自己写的内容，别人的讲述不能由你删除。'
      : outcome.reason === 'already-withdrawn'
        ? '这条已经撤回过一次了。'
        : '没有找到这条讲述。');
  }

  function withdrawAll() {
    setState(withdrawAllByAuthor(state, viewerId, stamp()));
    setNotice('已撤回你在本展品的全部讲述，其他作者的仍在。');
  }

  function acceptInvitation() {
    if (pendingInvitation === undefined) return;
    const respondedAt = stamp();
    setState({
      ...state,
      invitations: state.invitations.map((invitation) => invitation.id === pendingInvitation.id
        ? { ...invitation, status: 'accepted' as const, respondedAt }
        : invitation),
    });
    setNotice('邀请已接受。你之前提交的讲述现在才获得署名权，并会出现在公开版本里。');
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>同一件实物 · 多人的讲述</p>
        <h1 className={styles.title}>共同作者与多人记忆</h1>
        <p className={styles.lede}>
          邀请以单件展品为单位。未接受邀请的人不署名；每份讲述由作者本人决定是否公开；
          贡献者只能撤回自己的内容。撤回后新公开版本移除该内容，其余作者的讲述保留。
        </p>
      </header>

      <p className={styles.demoBanner} role="note">
        <strong>DEMO</strong>　本页人物、讲述与邀请全部为演示数据，不是真实用户、真实征集内容或真实授权记录。
        可以切换身份试操作，但这里没有数据库、没有接口，刷新即还原。
      </p>

      <section className={styles.viewerBar} aria-label="演示身份切换">
        <span className={styles.viewerLabel}>以谁的身份操作</span>
        {demoViewers.map((person) => (
          <button
            key={person.id}
            type="button"
            className={styles.viewerButton}
            data-active={person.id === viewerId}
            aria-pressed={person.id === viewerId}
            onClick={() => { setViewerId(person.id); setNotice(''); }}
          >
            {person.name}
            {person.id === demoOwner.id ? <small>馆主</small> : null}
          </button>
        ))}
      </section>

      {notice === '' ? null : <p className={styles.notice} role="status">{notice}</p>}

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="people-heading">
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle} id="people-heading">这件展品的参与者</h2>
            <p className={styles.panelNote}>{demoExhibitTitle}</p>
          </div>

          <ul className={styles.people}>
            {participants.map((participant) => (
              <li key={participant.userId} className={styles.person}>
                <span className={styles.personName}>
                  {participant.name}
                  {participant.userId === viewerId ? <small className={styles.self}>你</small> : null}
                </span>
                <span className={styles.personMeta}>
                  <span className={styles.badge} data-status={participant.role === 'owner' ? 'owner' : participant.invitationStatus}>
                    {participant.role === 'owner' ? '馆主' : statusLabel[participant.invitationStatus]}
                  </span>
                  <span className={styles.count}>{participant.contributionCount} 份讲述</span>
                </span>
              </li>
            ))}
          </ul>

          {pendingInvitation === undefined ? null : (
            <div className={styles.inviteAction}>
              <p>{viewer.name} 收到了本展品的邀请，但还没接受。未接受之前，已提交的讲述不能署名、也不会公开。</p>
              <button type="button" className={styles.primary} onClick={acceptInvitation}>接受邀请（试一下）</button>
            </div>
          )}

          {ownActive.length > 0 ? (
            <button type="button" className={styles.danger} onClick={withdrawAll}>
              撤回我在本展品的全部讲述（{ownActive.length} 份）
            </button>
          ) : (
            <p className={styles.muted}>你在本展品没有可撤回的讲述。</p>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="public-heading">
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle} id="public-heading">公开版本</h2>
            <p className={styles.panelNote}>{view.contributions.length} 份讲述 · 各自署名</p>
          </div>

          {view.contributions.length === 0 ? (
            <p className={styles.empty}>当前没有可公开的讲述。</p>
          ) : (
            <ol className={styles.stories}>
              {view.contributions.map((entry) => (
                <li key={entry.id} className={styles.story}>
                  <div className={styles.storyHead}>
                    <span className={styles.author}>{entry.authorName}</span>
                    <span className={styles.role}>{entry.authorRole === 'owner' ? '馆主' : '共同作者'}</span>
                  </div>
                  <p className={styles.storyText}>{entry.story}</p>
                  <p className={styles.source}>来源：{entry.sourceNote}</p>
                  <div className={styles.storyActions}>
                    <button
                      type="button"
                      className={styles.link}
                      disabled={entry.authorId !== viewerId}
                      title={entry.authorId === viewerId ? '撤回这份自己的讲述' : '只能撤回自己的内容'}
                      onClick={() => withdraw(entry.id)}
                    >
                      撤回
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {view.excluded.length === 0 ? null : (
            <div className={styles.excluded}>
              <h3>未进入公开版本（{view.excluded.length}）</h3>
              <ul>
                {view.excluded.map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.authorName}</span>
                    <span className={styles.reason}>{reasonLabel[entry.reason]}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.muted}>这里只显示是谁、为什么，不显示被排除的正文。</p>
            </div>
          )}
        </section>
      </div>

      <footer className={styles.footer}>
        <p>
          为什么不能有「删除」：贡献者只有撤回权，没有删除权。撤回保留记录与时间，取消失败的邀请也有痕迹；
          任何越权请求（撤别人的、删别人的）在接口层都要返回与「不存在」相同的响应，否则就成了存在性探测。
        </p>
        <p>
          为什么不做合并：同一实物下的多份讲述各自独立，不做共同摘要、不用 AI 弥合矛盾。
          来源必填，缺来源的转述无法核验。首版不做无实物故事，也不做共同所有的展馆。
        </p>
      </footer>
    </main>
  );
}
