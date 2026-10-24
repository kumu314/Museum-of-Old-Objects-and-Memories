'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  errorResponseSchema, successResponseSchema, memoirExportSchema, memoirPageSchema, onlineMemoirSchema,
  memoirOpeningTopics, memoirChapterSchema, memoirAiOperationSchema, museumListResponseSchema, type MuseumSummary, type MemoirExport, type MemoirChapter, type MemoirParagraph,
} from '../../contracts';
import styles from '../direction1/demo.module.css';

class MemoirRequestError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

async function request<T extends z.ZodType>(url: string, schema: T, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<z.infer<T>> {
  const response = await fetch(url, { method, cache: 'no-store', ...(signal ? { signal } : {}),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(result);
    if (error.success) throw new MemoirRequestError(`${error.data.error.message}${error.data.error.code === 'VERSION_CONFLICT' ? ' 请重新读取，核对后再保存。' : ''}`, error.data.error.code);
    throw new Error('请求失败，请稍后重试。');
  }
  return schema.parse(result);
}
const receipt = (expectedVersion: number) => ({ operationId: crypto.randomUUID(), expectedVersion });
type Online = z.infer<typeof onlineMemoirSchema>;

export function MemoirWorkspace() {
  const [books, setBooks] = useState<Online[]>([]);
  const [museums, setMuseums] = useState<MuseumSummary[]>([]);
  const [museumId, setMuseumId] = useState('');
  const [book, setBook] = useState<MemoirExport | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('我的回忆录');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [supplement, setSupplement] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [chapterTitle, setChapterTitle] = useState('一段回忆');
  const [chapterDirty, setChapterDirty] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      request('/api/memoirs', successResponseSchema(memoirPageSchema(onlineMemoirSchema)), 'GET', undefined, controller.signal),
      request('/api/museums', museumListResponseSchema, 'GET', undefined, controller.signal),
    ]).then(([{ data }, museumResponse]) => { setBooks(data.items); setCursor(data.nextCursor); setMuseums(museumResponse.data); setReady(true); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败。'); });
    return () => controller.abort();
  }, []);

  async function reload(id: string) {
    const next = await request(`/api/memoirs/${id}/export?format=json`, memoirExportSchema);
    setBook(next); setBooks((items) => items.map((item) => item.memoir.id === id ? { memoir: next.memoir, sourceVersion: next.sourceVersion } : item));
  }
  async function run(action: () => Promise<void>, success: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(success); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : '操作失败，输入仍保留。'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function mutate(path: string, body: unknown, method = 'POST') {
    if (!book) return;
    await request(`/api/memoirs/${book.memoir.id}${path}`, successResponseSchema(z.unknown()), method, body);
    await reload(book.memoir.id);
  }
  const latestAnswers = book?.answers.filter((answer) => !book.answers.some((other) => other.answerId === answer.answerId && other.revision > answer.revision)) ?? [];
  const dirty = chapterDirty || supplement.length > 0 || Object.entries(inputs).some(([questionId, text]) => text !== (latestAnswers.find((answer) => answer.questionId === questionId)?.text ?? ''));
  const chapter = book?.chapters.find((item) => item.id === chapterId);
  return <main className={styles.shell}>
    <header className={styles.header}><div><span className={styles.eyebrow}>拾物馆 / MEMOIR</span><h1>把故事，慢慢讲完</h1></div><nav className={styles.nav}><Link href="/studio">我的工作台</Link><Link href="/memoir?mode=local-demo">本地样例</Link></nav></header>
    <p className={styles.banner}><strong>合成资料在线 DEMO · 服务端保存</strong><br />仅向已登记演示账号开放，请只使用虚构资料。当前支持人工记录、来源核对与独立授权；AI 追问与章节整理需要配置服务并逐次同意传输。公开授权不等于已出现在参观页，展示还需要关联展馆及有效公开入口。</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.status}>{message}</p>}
    {!ready && !error && <p role="status">正在读取自传…</p>}
    <fieldset disabled={busy || !ready} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <section className={styles.panel}><h2>我的自传</h2><div className={styles.actions}>{books.map((item) => <button className={styles.secondary} key={item.memoir.id} aria-pressed={book?.memoir.id === item.memoir.id} onClick={() => {
        if (dirty && !window.confirm('有未保存内容，确定切换并放弃编辑吗？')) return;
        void run(async () => { await reload(item.memoir.id); setInputs({}); setSupplement(''); setChapterId(''); setChapterDirty(false); }, '已读取服务端存档。');
      }}>{item.memoir.title}</button>)}{cursor && <button className={styles.secondary} onClick={() => void run(async () => {
        const { data } = await request(`/api/memoirs?cursor=${cursor}`, successResponseSchema(memoirPageSchema(onlineMemoirSchema))); setBooks((items) => [...items, ...data.items]); setCursor(data.nextCursor);
      }, '已加载更多自传。')}>加载更多</button>}</div>
        {books.length === 0 && ready && <p>还没有在线自传。</p>}
        <label className={styles.field}>新自传名称<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className={styles.field}>关联我的展馆<select value={museumId} onChange={(event) => setMuseumId(event.target.value)}><option value="">暂不关联（仅保存独立公开许可）</option>{museums.map((museum) => <option key={museum.id} value={museum.id}>{museum.title}</option>)}</select></label>
        <p className={styles.muted}>关联后，已授权章节通过该展馆的有效公开入口展示；关联本身不会公开章节。创建后不支持转移关联。</p>
        <button className={styles.button} disabled={!title.trim()} onClick={() => {
          if (dirty && !window.confirm('有未保存内容，确定新建并切换自传吗？')) return;
          void run(async () => { const { data } = await request('/api/memoirs', successResponseSchema(onlineMemoirSchema), 'POST', { operationId: crypto.randomUUID(), title, museumId: museumId || null }); setBooks((items) => [...items, data]); await reload(data.memoir.id); setInputs({}); setSupplement(''); setChapterId(''); setChapterDirty(false); }, '自传已创建。');
        }}>创建在线自传</button>
      </section>
      {book && <><p className={styles.muted}>关联展馆：{museums.find((museum) => museum.id === book.memoir.museumId)?.title ?? '未关联'}</p><div className={styles.actions}><a className={styles.secondary} href={`/api/memoirs/${book.memoir.id}/export?format=markdown`}>导出已保存资料</a><button className={styles.secondary} onClick={() => void run(() => reload(book.memoir.id), '服务端状态已刷新，未保存输入仍保留。')}>重新读取状态</button></div>
        <div className={styles.grid}><section className={styles.panel}><h2>一次，只讲一个话题</h2><p className={styles.muted}>以下为固定开场问题，非 AI 生成。</p><div className={styles.actions}>{Object.entries(memoirOpeningTopics).map(([key, topic]) => <button key={key} className={styles.secondary} disabled={book.sessions.some((session) => session.topic.title === topic.title)} onClick={() => void run(() => mutate('/sessions', { ...receipt(book.memoir.version), topicKey: key }), '话题已开启。')}>{topic.title}</button>)}</div>
          {book.sessions.map((session) => {
            const question = book.questions.find((item) => item.id === session.currentQuestionId);
            const answer = latestAnswers.find((item) => item.questionId === question?.id);
            const text = (question ? inputs[question.id] : undefined) ?? answer?.text ?? '';
            return <div key={session.id}><h3>{session.topic.title} · {session.state === 'active' ? '进行中' : session.state === 'paused' ? '暂停' : '已结束'}</h3>{question && <><p className={styles.question}>{question.text}</p><label className={styles.field}>回答<textarea rows={4} value={text} onChange={(event) => { setInputs({ ...inputs, [question.id]: event.target.value }); }} /></label><button className={styles.button} disabled={!text.trim() || session.state !== 'active'} onClick={() => void run(() => mutate(`/sessions/${session.id}/answers`, { ...receipt(session.version), questionId: question.id, answerId: answer?.answerId ?? null, text }), '回答已保存，原文与版本已保留。')}>保存回答</button></>}
              {session.state === 'active' && answer && <MemoirAiAction book={book} path={`/sessions/${session.id}/ai`} version={session.version} label="生成一个追问" answerIds={[answer.id]} unsavedAnswer={text !== answer.text} run={run} refresh={() => reload(book.memoir.id)} />}
              <div className={styles.actions}>{(session.state === 'active' ? ['pause', 'complete', 'skip', 'refuse'] as const : session.state === 'paused' ? ['resume'] as const : []).map((action) => <button key={action} className={styles.secondary} onClick={() => {
                const endsSession = action === 'complete' || action === 'skip' || action === 'refuse';
                if (endsSession && text !== (answer?.text ?? '') && !window.confirm('当前回答尚未保存。结束此话题将放弃这份输入，是否继续？')) return;
                void run(async () => {
                  await mutate(`/sessions/${session.id}`, { ...receipt(session.version), action }, 'PATCH');
                  if (endsSession && question) setInputs((current) => { const next = { ...current }; delete next[question.id]; return next; });
                }, endsSession ? '话题已结束。' : '话题状态已更新；未保存回答仍保留在输入区。');
              }}>{{ pause: '暂停', complete: '结束话题', skip: '跳过', refuse: '不愿回答', resume: '继续' }[action]}</button>)}</div></div>;
          })}
          <label className={styles.field}>补充原始资料<textarea value={supplement} onChange={(event) => { setSupplement(event.target.value); }} /></label><button className={styles.button} disabled={!supplement.trim()} onClick={() => void run(async () => { await mutate('/supplements', { ...receipt(book.memoir.version), answerId: null, text: supplement }); setSupplement(''); }, '补充资料已保存。')}>保存补充资料</button>
          <h3>已保存原文</h3>{latestAnswers.map((answer) => <p key={answer.id} className={styles.source}>{answer.text}</p>)}
        </section><section className={styles.panel}><h2>章节与来源核对</h2><div className={styles.actions}>{book.chapters.map((item) => <button key={item.id} className={styles.secondary} aria-pressed={chapterId === item.id} onClick={() => { if (chapterId === item.id) return; if (dirty && !window.confirm('切换章节会放弃该章节未保存的编辑，是否继续？')) return; setChapterDirty(false); setChapterId(item.id); }}>{item.title}</button>)}</div>
          <label className={styles.field}>新章节标题<input value={chapterTitle} maxLength={120} onChange={(event) => setChapterTitle(event.target.value)} /></label><button className={styles.secondary} disabled={!chapterTitle.trim()} onClick={() => {
            if (dirty && !window.confirm('新建章节会切换编辑区，是否继续？')) return;
            void run(async () => { const { data } = await request(`/api/memoirs/${book.memoir.id}/chapters`, successResponseSchema(memoirChapterSchema), 'POST', { ...receipt(book.memoir.version), title: chapterTitle }); await reload(book.memoir.id); setChapterDirty(false); setChapterId(data.id); }, '章节已创建。');
          }}>新建章节</button>
          {chapter && <ChapterEditor key={chapter.id} book={book} chapter={chapter} onDirty={setChapterDirty} run={run} mutate={mutate} refresh={() => reload(book.memoir.id)} />}
        </section></div></>}
    </fieldset>
  </main>;
}

type ChapterProps = { refresh: () => Promise<void>; book: MemoirExport; chapter: MemoirChapter; onDirty: (dirty: boolean) => void; run: (action: () => Promise<void>, message: string) => Promise<void>; mutate: (path: string, body: unknown, method?: string) => Promise<void> };
function ChapterEditor({ book, chapter, onDirty, run, mutate, refresh }: ChapterProps) {
  const revision = book.revisions.find((item) => item.id === chapter.currentRevisionId);
  const [title, setTitle] = useState(revision?.title ?? chapter.title);
  const [paragraphs, setParagraphs] = useState<MemoirParagraph[]>(revision?.paragraphs ?? []);
  const [edited, setEdited] = useState(false);
  const [baseRevisionId, setBaseRevisionId] = useState(chapter.currentRevisionId);
  const [draftId, setDraftId] = useState<string | null>(revision?.derivedFromDraftId ?? null);
  const [reviewed, setReviewed] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [authorize, setAuthorize] = useState(false);
  const sources = book.answers.filter((answer) => !book.answers.some((other) => other.answerId === answer.answerId && other.revision > answer.revision));
  const confirmation = book.confirmations.find((item) => item.revisionId === chapter.currentRevisionId && item.sourceVersion === book.sourceVersion);
  const publication = book.publications.find((item) => item.chapterId === chapter.id && item.revokedAt === null);
  const path = `/chapters/${chapter.id}`;
  const revisionChanged = baseRevisionId !== chapter.currentRevisionId;
  // 服务端新修订只能替换未编辑的表单；本地修改必须由用户明确取舍。
  if (revisionChanged && !edited) {
    setBaseRevisionId(chapter.currentRevisionId); setTitle(revision?.title ?? chapter.title);
    setParagraphs(revision?.paragraphs ?? []); setDraftId(revision?.derivedFromDraftId ?? null);
    setReviewed(false); setPrivacy(false); setAuthorize(false);
  }
  function changed() { setEdited(true); setReviewed(false); setPrivacy(false); setAuthorize(false); onDirty(true); }
  return <div>{revisionChanged && edited && <p role="alert" className={styles.banner}>服务端章节已有新修订，本地输入已保留。请先复制需要的内容，再载入服务端版本核对。
    <button className={styles.secondary} onClick={() => { if (!window.confirm('载入服务端版本将放弃当前未保存的章节编辑，是否继续？')) return; setEdited(false); onDirty(false); }}>放弃本地编辑并载入服务端版本</button></p>}<MemoirAiAction book={book} path={`${path}/ai`} version={chapter.version} label="整理章节草稿" answerIds={sources.map((source) => source.id)} run={run} refresh={refresh} />
    {book.drafts.filter((draft) => draft.chapterId === chapter.id).map((draft) => <div key={draft.id} className={styles.source}><strong>{draft.generation === 'provider' ? 'AI 草稿 · 待人工核对' : '样例草稿 · 非 AI'}</strong><h3>{draft.output.title}</h3>{draft.output.paragraphs.map((paragraph) => <p key={paragraph.id}>{paragraph.text}</p>)}<button className={styles.secondary} disabled={draft.sourceVersion !== book.sourceVersion} onClick={() => { if (edited && !window.confirm('载入草稿会替换当前未保存的章节编辑，是否继续？')) return; setTitle(draft.output.title); setParagraphs(draft.output.paragraphs); setDraftId(draft.id); changed(); }}>载入编辑区并核对来源</button></div>)}
    <label className={styles.field}>章节标题<input value={title} onChange={(event) => { setTitle(event.target.value); changed(); }} /></label>
    <p className={styles.muted}>从已保存原文添加段落后人工编辑。引用以字符区间计数；编辑不能补造来源中没有的事实。</p>
    <div className={styles.actions}>{sources.map((source, index) => <button key={source.id} className={styles.secondary} disabled={paragraphs.length >= 40} onClick={() => { setParagraphs([...paragraphs, { id: crypto.randomUUID(), text: source.text, sources: [{ answerRevisionId: source.id, start: 0, end: Array.from(source.text).length }] }]); changed(); }}>引用原文 {index + 1}</button>)}</div>
    {paragraphs.map((paragraph, index) => <div key={paragraph.id}><label className={styles.field}>段落 {index + 1}<textarea value={paragraph.text} onChange={(event) => { setParagraphs(paragraphs.map((item) => item.id === paragraph.id ? { ...item, text: event.target.value } : item)); changed(); }} /></label>
      {paragraph.sources.map((ref, sourceIndex) => {
        const source = book.answers.find((item) => item.id === ref.answerRevisionId);
        const points = Array.from(source?.text ?? '');
        return <div key={`${ref.answerRevisionId}:${sourceIndex}`}><p className={styles.source}>{points.slice(0, ref.start).join('')}<mark>{points.slice(ref.start, ref.end).join('')}</mark>{points.slice(ref.end).join('')}</p><div className={styles.actions}>{(['start', 'end'] as const).map((field) => <label key={field}>{field === 'start' ? '来源起点（从 0 起）' : '来源终点（不含）'}<input type="number" min={0} max={points.length} value={ref[field]} onChange={(event) => { const value = event.target.valueAsNumber; if (!Number.isInteger(value)) return; setParagraphs(paragraphs.map((item) => item.id === paragraph.id ? { ...item, sources: item.sources.map((entry, position) => position === sourceIndex ? { ...entry, [field]: value } : entry) } : item)); changed(); }} /></label>)}</div></div>;
      })}<button className={styles.secondary} onClick={() => { setParagraphs(paragraphs.filter((item) => item.id !== paragraph.id)); changed(); }}>移除此段</button></div>)}
    <button className={styles.button} disabled={revisionChanged || !paragraphs.length || !title.trim()} onClick={() => void run(async () => { await mutate(path, { ...receipt(chapter.version), expectedSourceVersion: book.sourceVersion, title, paragraphs, derivedFromDraftId: draftId }, 'PUT'); setEdited(false); onDirty(false); }, '章节已保存，请重新核对来源并确认。')}>保存章节</button>
    <label className={styles.check}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />已逐段核对来源及不确定表述</label>
    <button className={styles.secondary} disabled={!reviewed || edited || !revision || revision.sourceVersion !== book.sourceVersion} onClick={() => void run(() => mutate(`${path}/confirmation`, { ...receipt(chapter.version), revisionId: revision?.id, expectedSourceVersion: book.sourceVersion, reviewedSources: true }), '当前章节与来源已确认。')}>确认当前已保存章节</button>
    <label className={styles.check}><input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} />我已检查本章隐私</label><label className={styles.check}><input type="checkbox" checked={authorize} onChange={(event) => setAuthorize(event.target.checked)} />我单独授权公开本章</label>
    <button className={styles.button} disabled={!confirmation || edited || !privacy || !authorize} onClick={() => void run(() => mutate(`${path}/publication`, { ...receipt(chapter.version), confirmationId: confirmation?.id, privacyAcknowledged: true, authorizePublicChapter: true }), '独立公开许可已保存。')}>授权公开本章</button>
    {publication && <><p className={styles.status}>本章已有有效公开许可；编辑草稿不改变已授权版本。</p><button className={styles.danger} onClick={() => void run(() => mutate(`${path}/publication`, receipt(chapter.version), 'DELETE'), '本章公开许可已撤回。')}>撤回本章公开许可</button></>}
  </div>;
}


type AiProps = { unsavedAnswer?: boolean; book: MemoirExport; path: string; version: number; label: string; answerIds: string[]; run: ChapterProps['run']; refresh: () => Promise<void> };
function MemoirAiAction({ book, path, version, label, answerIds, run, refresh, unsavedAnswer = false }: AiProps) {
  const [consent, setConsent] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [state, setState] = useState('');
  const unresolved = book.aiOperations.find((operation) => path === `/${operation.kind === 'chapter' ? 'chapters' : 'sessions'}/${operation.targetId}/ai`
    && ['prepared', 'sending', 'unknown'].includes(operation.state));
  const pendingId = unresolved?.id ?? operationId;
  const labels = { prepared: '已准备', sending: '处理中', succeeded: '已完成', failed: '失败，请检查服务配置或额度', unknown: '结果未知，请核对状态，勿重复提交', superseded: '来源已变化，请核对当前内容' };
  return <div className={styles.banner}><label className={styles.check}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />同意将本次已保存虚构原文发送至配置的 AI 服务（可能消耗额度）</label><p className={styles.muted}>本次发送 {answerIds.length} 份已保存原文。结果需要人工核对，不会自动确认或公开。</p>
    <button className={styles.secondary} disabled={unsavedAnswer || !consent || !answerIds.length || pendingId !== null} onClick={() => void run(async () => {
      const id = crypto.randomUUID(); setOperationId(id);
      const { data } = await request(`/api/memoirs/${book.memoir.id}${path}`, successResponseSchema(memoirAiOperationSchema), 'POST', { operationId: id, expectedVersion: version, sourceVersion: book.sourceVersion, answerRevisionIds: answerIds, providerTransferConsent: true });
      setState(labels[data.state]); setConsent(false); if (['succeeded', 'failed', 'superseded'].includes(data.state)) setOperationId(null); await refresh();
    }, 'AI 操作已返回，请检查下方状态及结果。')}>{label}</button>{unsavedAnswer && <p className={styles.muted}>请先保存当前回答，再生成追问。</p>}
    {pendingId && <button className={styles.secondary} onClick={() => void run(async () => {
      try {
        const { data } = await request(`/api/memoirs/${book.memoir.id}/ai/${pendingId}`, successResponseSchema(memoirAiOperationSchema));
        setState(labels[data.state]);
        if (['succeeded', 'failed', 'superseded'].includes(data.state)) setOperationId(null);
      } catch (cause: unknown) {
        // Only a confirmed absence permits releasing a locally pending request.
        if (!(cause instanceof MemoirRequestError) || cause.code !== 'NOT_FOUND') throw cause;
        setOperationId(null); setConsent(false); setState('服务端确认本次任务未创建，请修正配置或输入后重新授权提交。');
      }
      await refresh();
    }, '操作状态已核对。')}>核对生成状态</button>}{state && <p role="status">{state}</p>}
  </div>;
}
