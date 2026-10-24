'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ZodError } from 'zod';
import { commentIsHidden, discoveryDemoStateSchema, museumAccessModeSchema, type DiscoveryDemoAction, type ManagedComment } from '../../contracts';
import { DemoRuleError } from '../direction1/demo-error';
import { useDemoStorage } from '../direction1/use-demo-storage';
import styles from '../direction1/demo.module.css';
import { applyDiscoveryDemo, createDiscoveryDemo, discoveryDemoActors, visibleDemoComments, visibleDemoMuseums } from './demo';
import { DemoMuseumVisit } from './demo-museum-visit';
import world from './world-demo.module.css';

// 失败信息区分触发位置：留言簿相关操作就近显示，其余显示在页面顶部。
type FailureScope = 'page' | 'guestbook';

export function DiscoveryDemo({ viewerId }: { viewerId: string }) {
  const store = useDemoStorage(`direction1:world:v1:${viewerId}`, discoveryDemoStateSchema, createDiscoveryDemo);
  const [query, setQuery] = useState('');
  const [followingOnly, setFollowingOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visitTick, setVisitTick] = useState(0);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [reply, setReply] = useState<{ museumId: string; rootId: string; replyToId: string; nickname: string } | null>(null);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState<{ text: string; scope: FailureScope } | null>(null);
  const visitBar = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const state = store.value;
  const { viewer } = state.data;
  const catalogue = visibleDemoMuseums(state, query, followingOnly);
  const selected = selectedId ? visibleDemoMuseums(state).find((museum) => museum.museumId === selectedId) : undefined;
  const internal = state.data.museums.find((museum) => museum.published.museumId === selected?.museumId);
  const isOwner = internal?.published.owner.userId === viewer.userId;
  const comments = internal ? visibleDemoComments(internal) : [];
  const displayComments = isOwner ? internal?.comments ?? [] : comments;
  const disabled = !store.hydrated || store.blocked;
  const inputKey = selected ? `${viewer.userId}:${selected.museumId}` : '';
  const body = inputs[inputKey] ?? '';

  // 参观点击后滚动到参观区；偏好减少动态效果时直接定位，不做平滑滚动。
  useEffect(() => {
    if (visitTick === 0) return;
    const element = visitBar.current;
    if (!element) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [visitTick]);

  function act(action: DiscoveryDemoAction, success: string, scope: FailureScope = 'page') {
    try {
      store.save(applyDiscoveryDemo(state, action)); setMessage(success); setFailure(null); return true;
    } catch (error: unknown) {
      const text = error instanceof DemoRuleError ? error.message : error instanceof ZodError
        ? error.issues[0]?.message ?? '请核对输入。' : '演示操作失败，留言输入仍保留。';
      setFailure({ text, scope }); return false;
    }
  }
  function visit(museumId: string) {
    setSelectedId(museumId); setReply(null); setFailure(null); setMessage(''); setVisitTick((tick) => tick + 1);
  }
  function renderComment(comment: ManagedComment) {
    const banned = internal?.bannedUserIds.includes(comment.author.userId) ?? false;
    return <article className={commentIsHidden(comment.status) ? world.commentHidden : undefined}>
      <div className={world.commentHead}>
        <strong>{comment.author.nickname}</strong>
        {banned && <span className={world.bannedBadge}>已禁评</span>}
        <span className={world.replyTag}>{comment.rootId ? `回复 ${internal?.comments.find((item) => item.id === comment.replyToId)?.author.nickname ?? '本线程'}` : '留言'}</span>
      </div>
      {!('body' in comment) ? <p className={`${styles.muted} ${world.deletedText}`}>{commentIsHidden(comment.status) ? '【整条线程仍隐藏】' : ''}作者已删除正文</p>
        : <p className={world.commentText}>{comment.status === 'hidden' ? '【已隐藏，仅 DEMO 馆主管理视图可见】' : ''}{comment.body}</p>}
      <div className={world.commentActions}>
        {comment.status === 'visible' && <button className={styles.secondary} disabled={disabled} onClick={() => {
          setReply({ museumId: comment.museumId, rootId: comment.rootId ?? comment.id, replyToId: comment.id, nickname: comment.author.nickname }); textarea.current?.focus();
        }}>回复</button>}
        {comment.author.userId === viewer.userId && 'body' in comment && <button className={styles.secondary} disabled={disabled} onClick={() => act({ type: 'delete_comment', museumId: comment.museumId,
          commentId: comment.id, expectedVersion: comment.version }, '自己的演示留言正文已删除；回复仍保留在原线程。', 'guestbook')}>删除自己的留言</button>}
        {isOwner && <button className={styles.secondary} disabled={disabled} onClick={() => act({ type: 'moderate_comment', museumId: comment.museumId, commentId: comment.id,
          expectedVersion: comment.version, status: commentIsHidden(comment.status) ? 'visible' : 'hidden' }, commentIsHidden(comment.status) ? '已恢复线程显示；已删除正文不会恢复。' : '已隐藏演示留言；隐藏根留言也会隐藏整条线程。', 'guestbook')}>{commentIsHidden(comment.status) ? '恢复显示' : '隐藏留言'}</button>}
        {isOwner && comment.author.userId !== viewer.userId && <button className={styles.secondary} disabled={disabled} onClick={() => act({ type: 'ban', museumId: comment.museumId, commentId: comment.id, banned: !banned }, banned ? '已解除此虚构账号的本馆禁评。' : '已在本馆禁评此虚构账号，仍允许其参观。', 'guestbook')}>{banned ? '解除本馆禁评' : '本馆禁评'}</button>}
      </div>
    </article>;
  }
  const rootComments = displayComments.filter((comment) => comment.rootId === null);
  const canComment = internal !== undefined && internal.settings.mode === 'open' && !internal.bannedUserIds.includes(viewer.userId);
  return <main className={styles.shell}>
    <header className={styles.header}><div><span className={styles.eyebrow}>拾物馆 / WORLD DEMO</span><h1>每件旧物，都有一处归宿</h1></div>
      <nav className={styles.nav} aria-label="演示导航"><Link href="/demo">DEMO 导览</Link><Link href="/memoir">自传 DEMO</Link><Link href="/studio">我的工作台</Link></nav>
    </header>
    <div className={styles.banner}><strong>DEMO · 以下账号、展馆与留言均为虚构</strong><br />这里是隔离的交互演示。搜索、关注、收藏及留言仅在当前浏览器标签页模拟，不写入真实展馆，不向其他用户公开。身份切换只切换虚构角色，不改变登录账号。</div>
    {store.warning && <p className={styles.error} role="alert">{store.warning}</p>}
    {message && <p className={styles.status} role="status">{message}</p>}
    {failure && (failure.scope === 'page' || !selected) && <p className={styles.error} role="alert">{failure.text}</p>}
    <div className={styles.grid}>
      <section className={`${styles.panel} ${world.catalogueSection}`} id="world-catalogue" aria-labelledby="world-catalogue-title"><h2 id="world-catalogue-title">从一件旧物，遇见一个故事</h2>
        <label className={styles.field}>搜索已发布的昵称、馆名、展品名或手动标签<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="试试：车票、木盒、旧相机" /></label>
        <div role="group" aria-label="目录筛选" className={world.filterGroup}><button className={styles.secondary} aria-pressed={!followingOnly} onClick={() => setFollowingOnly(false)}>全部公开馆</button><button className={styles.secondary} aria-pressed={followingOnly} onClick={() => setFollowingOnly(true)}>我的关注列表</button></div>
        <p className={styles.muted}>关注账号，收藏展馆。关注列表仅自己可见；收藏只显示总数。这里没有动态流。搜索不包含草稿、自传、私密馆或持链接馆。</p>
      </section>
      <section className={styles.panel}><h2>体验不同角色</h2>
        <label className={styles.field}>当前虚构身份<select value={viewer.userId} disabled={disabled} onChange={(event) => {
          act({ type: 'switch_actor', userId: event.target.value }, '已切换虚构角色，真实登录账号不变。'); setReply(null);
        }}>{discoveryDemoActors.map((actor) => <option value={actor.userId} key={actor.userId}>{actor.nickname}</option>)}</select></label>
        {state.data.museums.filter((museum) => museum.published.owner.userId === viewer.userId).map((museum) => <label key={museum.published.museumId} className={styles.field}>
          {museum.published.title} · 演示访问方式<select disabled={disabled} value={museum.accessMode} onChange={(event) => {
            const mode = museumAccessModeSchema.parse(event.target.value);
            act({ type: 'access', museumId: museum.published.museumId, accessMode: mode }, '演示访问方式已变更，目录与旧入口按当前状态更新。');
          }}><option value="private">私密</option><option value="link_only">持链接访问</option><option value="discoverable">公开可发现</option></select>
        </label>)}
        <p className={styles.muted}>{store.persisted ? '演示进度已保存到当前标签页。' : '尚未写入标签页存档。'}关闭标签页可能清除这些虚构操作。</p>
      </section>
    </div>
    <p aria-live="polite" className={styles.muted}>当前找到 {catalogue.length} 座 DEMO 公开馆</p>
    {catalogue.length === 0 ? <div className={styles.empty}>
      <p>{followingOnly ? '尚未关注有公开馆的账号，或关注的馆当前不可发现。' : '没有匹配的公开展馆。试试馆名、昵称、展品名或标签。'}</p>
      {(query || followingOnly) && <div className={world.emptyActions}>
        {query && <button type="button" className={styles.secondary} onClick={() => setQuery('')}>清除搜索</button>}
        {followingOnly && <button type="button" className={styles.secondary} aria-pressed={false} onClick={() => setFollowingOnly(false)}>查看全部公开馆</button>}
      </div>}
    </div> : <div className={world.cardGrid}>{catalogue.map((museum, index) => {
      const isSelected = museum.museumId === selectedId;
      return <article className={`${world.card} ${isSelected ? world.cardSelected : ''}`} key={museum.museumId} aria-current={isSelected ? 'true' : undefined}>
        {isSelected && <span className={world.cardBadge}>参观中</span>}
        <div className={world.art} aria-hidden="true">{['◌', '▤', '♫'][index % 3]}</div>
        <p className={world.ownerEyebrow}>{museum.owner.nickname}</p>
        <h3>{museum.title}</h3>
        <p>{museum.description}</p>
        {museum.tags.length > 0 && <p className={world.tagRow}>{museum.tags.map((tag) => <span className={world.tag} key={tag}>{tag}</span>)}</p>}
        <p className={styles.muted}>展品：{museum.exhibitNames.join('、')}</p>
        <p className={styles.muted}>收藏总数 {museum.favoriteCount} · 收藏者身份不展示</p>
        <div className={world.cardActions}>
          <button className={styles.button} disabled={disabled} onClick={() => visit(museum.museumId)}>参观 {museum.title}</button>
          {museum.owner.userId !== viewer.userId && <button className={styles.secondary} disabled={disabled} aria-pressed={museum.isFollowing} onClick={() => act({ type: 'follow', userId: museum.owner.userId, following: !museum.isFollowing }, museum.isFollowing ? '已取消关注此虚构账号。' : '已关注此虚构账号，其可发现的馆出现在自己的关注列表。')}>{museum.isFollowing ? '取消关注' : '关注账号'}</button>}
          {museum.owner.userId !== viewer.userId && <button className={styles.secondary} disabled={disabled} aria-pressed={museum.isFavorited} onClick={() => act({ type: 'favorite', museumId: museum.museumId, favorited: !museum.isFavorited }, museum.isFavorited ? '已取消收藏。' : '已收藏此 DEMO 展馆。')}>{museum.isFavorited ? '取消收藏' : '收藏展馆'}</button>}
          {museum.owner.userId === viewer.userId && <span className={world.tag}>我的展馆</span>}
        </div>
      </article>;
    })}</div>}
    {selectedId && !selected && <p className={styles.status}>刚才的演示入口已失效或已退出公开发现。留言输入仍保留在当前页面。</p>}
    {selected && <div className={world.visitBar} ref={visitBar}>
      <span className={world.visitLabel}><span className={world.visitBadge}>参观中</span><strong>{selected.title}</strong><span className={world.visitOwner}>{selected.owner.nickname}</span></span>
      <div className={world.visitActions}>
        <a className={world.backLink} href="#world-catalogue">返回展馆目录</a>
        <button type="button" className={world.exitVisit} onClick={() => { setSelectedId(null); setReply(null); setFailure(null); setMessage(''); }}>退出参观</button>
      </div>
    </div>}
    {selected && <DemoMuseumVisit key={selected.museumId} museum={selected} viewerId={viewerId} />}
    {selected && internal && <section className={styles.panel} aria-label="馆内留言">
      <span className={styles.eyebrow}>DEMO / {isOwner ? '馆主管理视图' : '访客视图'}</span><h2>{selected.title} · 留言簿</h2>
      <p>{selected.description}</p><p className={styles.muted}>此处演示留言和管理，不代表真实 3D 展馆已经接入发现。留言首版不支持编辑。</p>
      {isOwner && <button className={styles.secondary} disabled={disabled} onClick={() => act({ type: 'comment_mode', museumId: selected.museumId,
        expectedVersion: internal.settings.version, mode: internal.settings.mode === 'open' ? 'closed' : 'open' }, internal.settings.mode === 'open' ? '已关闭本馆新增留言，作者仍可删除自己的留言。' : '已重新开启本馆留言。', 'guestbook')}>{internal.settings.mode === 'open' ? '关闭本馆留言' : '开启本馆留言'}</button>}
      <p className={styles.muted}>留言当前{internal.settings.mode === 'open' ? '开启' : '关闭'}{internal.bannedUserIds.includes(viewer.userId) ? ' · 当前虚构身份在本馆被禁评，仍可参观' : ''}</p>
      <ol className={world.threads}>
        {rootComments.map((root) => <li key={root.id} className={world.thread}>
          {renderComment(root)}
          {displayComments.some((comment) => comment.rootId === root.id) && <ol className={world.replyList}>
            {displayComments.filter((comment) => comment.rootId === root.id).map((item) => <li key={item.id}>{renderComment(item)}</li>)}
          </ol>}
        </li>)}
      </ol>
      {displayComments.length === 0 && <p className={styles.muted}>这里还没有可见留言。</p>}
      {failure && failure.scope === 'guestbook' && selected && <p className={styles.error} role="alert">{failure.text}</p>}
      <form className={world.formBlock} onSubmit={(event) => {
        event.preventDefault();
        const target = reply?.museumId === selected.museumId ? reply : null;
        if (act({ type: 'comment', museumId: selected.museumId, accessEpoch: selected.accessEpoch, body,
          rootId: target?.rootId ?? null, replyToId: target?.replyToId ?? null }, '演示留言已写入本地存档，未发送到真实社区。', 'guestbook')) { setInputs({ ...inputs, [inputKey]: '' }); setReply(null); }
      }}>
        {reply?.museumId === selected.museumId && <p className={world.replyingRow}>正在回复 {reply.nickname} <button type="button" className={styles.secondary} onClick={() => setReply(null)}>取消回复</button></p>}
        {!canComment && <div className={world.threadState}>
          {internal.settings.mode === 'closed' && <p className={world.formNotice}>本馆已关闭新增留言，作者仍可删除自己的留言。</p>}
          {internal.bannedUserIds.includes(viewer.userId) && <p className={world.formNotice}>当前虚构身份在本馆被禁评，仍可参观。</p>}
        </div>}
        <label className={styles.field}>写一条虚构留言（最多 2000 字）<textarea ref={textarea} value={body} onChange={(event) => setInputs({ ...inputs, [inputKey]: event.target.value })} rows={3} disabled={!canComment} /></label>
        <button className={styles.button} disabled={disabled || !body.trim() || !canComment} type="submit">提交 DEMO 留言</button>
      </form>
    </section>}
    <button className={styles.secondary} disabled={!store.hydrated} onClick={() => {
      if (!window.confirm('确定清空关注、收藏、留言与访问设置的本地演示操作吗？')) return;
      store.save(createDiscoveryDemo()); setSelectedId(null); setReply(null); setInputs({}); setMessage('已重置合成演示数据。'); setFailure(null);
    }}>重置世界 DEMO</button>
  </main>;
}
