'use client';

import { useState } from 'react';
import {
  contributionInvitationSchema,
  contributionSchema,
  myContributionsSchema,
  type InvitationInboxItem,
  type MyContributionItem,
  type MyContributions as MyContributionsData,
} from '../../contracts/contributors';
import { apiRequest, describeFailure, jsonRequest } from '../studio/api';
import styles from './contributors.module.css';

/**
 * 共同作者的工作台（真实数据）。
 *
 * 这里只有"我的"东西：别人邀请我的、我自己写的。**没有**别人的讲述、没有
 * 别人的草稿，也没有"代表别人撤回"的按钮——服务端同样不接受这种请求，
 * 界面上的克制只是把服务端的边界说出来，不是靠界面拦。
 *
 * 接受邀请之后才出现"写一份讲述"：未接受时对方连提交资格都没有，
 * 提前给输入框等于骗人。
 */
function statusOf(item: MyContributionItem): { label: string; tone: 'accepted' | 'pending' | 'declined' } {
  if (item.contribution.withdrawnAt !== null) return { label: '已撤回', tone: 'declined' };
  if (!item.contribution.publishConsent) return { label: '未同意公开', tone: 'pending' };
  return { label: '已同意公开', tone: 'accepted' };
}

export function MyContributions({ initial }: { readonly initial: MyContributionsData }) {
  const [data, setData] = useState<MyContributionsData>(initial);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ story: '', sourceNote: '', publishConsent: false });

  async function run(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      setNotice(await work());
      setData(await apiRequest('/api/contributions/mine', myContributionsSchema));
    } catch (error) {
      setNotice(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  function respond(item: InvitationInboxItem, status: 'accepted' | 'declined') {
    void run(async () => {
      await apiRequest(`/api/invitations/${encodeURIComponent(item.invitation.id)}`,
        contributionInvitationSchema, jsonRequest('PATCH', { status }));
      return status === 'accepted'
        ? '已接受。你现在可以在这件展品下写自己的讲述，署名是你本人。'
        : '已拒绝。这件展品不会出现你的署名，馆主也不会看到你的讲述。';
    });
  }

  function submit(item: InvitationInboxItem) {
    void run(async () => {
      await apiRequest(`/api/museums/${encodeURIComponent(item.invitation.museumId)}/exhibits/${encodeURIComponent(item.invitation.exhibitId)}/contributions`,
        contributionSchema,
        jsonRequest('POST', { story: draft.story.trim(), sourceNote: draft.sourceNote.trim(), publishConsent: draft.publishConsent }));
      setComposing(null);
      setDraft({ story: '', sourceNote: '', publishConsent: false });
      return '已记录你的讲述，署名是你本人；它不会和别人的内容合并。';
    });
  }

  function withdraw(item: MyContributionItem) {
    void run(async () => {
      await apiRequest(`/api/contributions/${encodeURIComponent(item.contribution.id)}/withdraw`,
        contributionSchema, { method: 'POST' });
      return '已撤回。这份内容不会再进入任何公开版本，记录与时间保留，其他人的讲述不受影响。';
    });
  }

  const pending = data.invitations.filter((item) => item.invitation.status === 'pending');
  const accepted = data.invitations.filter((item) => item.invitation.status === 'accepted');

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>同一件实物 · 多人的讲述</p>
        <h1 className={styles.title}>我参与的讲述</h1>
        <p className={styles.lede}>
          邀请以单件展品为单位。接受之后你才有资格写自己的讲述，并署自己的名字；
          每份讲述由作者本人决定是否公开；你只能撤回自己的内容，撤不回别人的。
        </p>
      </header>

      {notice === '' ? null : <p className={styles.notice} role="status">{notice}</p>}

      <section className={styles.panel} aria-labelledby="pending-heading">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="pending-heading">等回应的邀请</h2>
          <p className={styles.panelNote}>{pending.length} 件</p>
        </div>
        {pending.length === 0 ? (
          <p className={styles.muted}>没有待回应的邀请。有人邀请你讲某件东西时，会出现在这里。</p>
        ) : (
          <ul className={styles.stories}>
            {pending.map((item) => (
              <li key={item.invitation.id} className={styles.story}>
                <div className={styles.storyHead}>
                  <span className={styles.author}>{item.exhibitName}</span>
                  <span className={styles.role}>{item.museumTitle}</span>
                </div>
                <p className={styles.muted}>未接受之前，你在这件展品下不署名，也没有提交入口。</p>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={busy} onClick={() => respond(item, 'accepted')}>接受邀请</button>
                  <button type="button" className={styles.danger} disabled={busy} onClick={() => respond(item, 'declined')}>拒绝</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="write-heading">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="write-heading">可以讲的展品</h2>
          <p className={styles.panelNote}>{accepted.length} 件</p>
        </div>
        {accepted.length === 0 ? (
          <p className={styles.muted}>接受邀请后，这里会出现「写一份讲述」的入口。</p>
        ) : (
          <ul className={styles.stories}>
            {accepted.map((item) => (
              <li key={item.invitation.id} className={styles.story}>
                <div className={styles.storyHead}>
                  <span className={styles.author}>{item.exhibitName}</span>
                  <span className={styles.role}>{item.museumTitle}</span>
                </div>
                {composing === item.invitation.id ? (
                  <div className={styles.form}>
                    <label className={styles.label}>你记得的事
                      <textarea className={styles.textarea} rows={4} maxLength={4000} disabled={busy} value={draft.story}
                        onChange={(event) => setDraft({ ...draft, story: event.target.value })} />
                    </label>
                    <label className={styles.label}>来源（谁讲的、何时何地）
                      <input className={styles.input} maxLength={200} disabled={busy} value={draft.sourceNote}
                        onChange={(event) => setDraft({ ...draft, sourceNote: event.target.value })} />
                    </label>
                    <label className={styles.check}>
                      <input type="checkbox" disabled={busy} checked={draft.publishConsent}
                        onChange={(event) => setDraft({ ...draft, publishConsent: event.target.checked })} />
                      我同意这份讲述在展品已发布且分享开启时立即向登录参观者公开，无需馆主再次发布（可撤回）
                    </label>
                    <div className={styles.actions}>
                      <button type="button" className={styles.primary} disabled={busy || draft.story.trim() === '' || draft.sourceNote.trim() === ''}
                        onClick={() => submit(item)}>提交</button>
                      <button type="button" className={styles.link} disabled={busy} onClick={() => setComposing(null)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={styles.link} disabled={busy} onClick={() => {
                    if (composing !== null && (draft.story || draft.sourceNote || draft.publishConsent) && !window.confirm('切换展品会放弃当前未保存的讲述，是否继续？')) return;
                    setComposing(item.invitation.id); setDraft({ story: '', sourceNote: '', publishConsent: false }); }}>
                    写一份讲述
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="mine-heading">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="mine-heading">我讲过的</h2>
          <p className={styles.panelNote}>{data.contributions.length} 份 · 各自署名，不合并</p>
        </div>
        <p className={styles.muted}>
          同意公开的讲述独立展示在已发布展品旁，无需馆主再次发布。撤回后，新请求不再返回这份讲述，
          不影响其他讲述或整馆分享；已打开页面需重新读取，已下载副本无法撤回。
        </p>
        {data.contributions.length === 0 ? (
          <p className={styles.muted}>你还没有写过讲述。</p>
        ) : (
          <ol className={styles.stories}>
            {data.contributions.map((item) => {
              const status = statusOf(item);
              return (
                <li key={item.contribution.id} className={styles.story}>
                  <div className={styles.storyHead}>
                    <span className={styles.author}>{item.exhibitName}</span>
                    <span className={styles.badge} data-status={status.tone}>{status.label}</span>
                  </div>
                  <p className={styles.storyText}>{item.contribution.story}</p>
                  <p className={styles.source}>来源：{item.contribution.sourceNote}　·　{item.museumTitle}</p>
                  <div className={styles.actions}>
                    <button type="button" className={styles.link} disabled={busy || item.contribution.withdrawnAt !== null}
                      onClick={() => withdraw(item)}>
                      {item.contribution.withdrawnAt === null ? '撤回这份讲述' : '已撤回'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <footer className={styles.footer}>
        <p>撤回不是删除：记录与时间保留，公开版本据此移除；你撤不回别人的内容，别人也一样。</p>
        <p>不做合并：同一实物下的多份讲述各自独立呈现，不生成共同摘要，也不用 AI 弥合分歧。</p>
      </footer>
    </main>
  );
}
