'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ZodError } from 'zod';
import { memoirDemoStateSchema, type MemoirDemoAction, type MemoirParagraph } from '../../contracts';
import { DemoRuleError } from '../direction1/demo-error';
import { useDemoStorage } from '../direction1/use-demo-storage';
import styles from '../direction1/demo.module.css';
import { applyMemoirDemo, createMemoirDemo, currentDemoConfirmation, currentDemoSession, exportMemoirDemo, latestDemoAnswers, memoirDemoTopics } from './demo';
import { DemoBook } from './demo-book';

type Editor = { title: string; paragraphs: MemoirParagraph[]; draftId: string | null; sourceVersion: number; dirty: boolean };
export function MemoirDemo({ viewerId }: { viewerId: string }) {
  const store = useDemoStorage(`direction1:memoir:v1:${viewerId}`, memoirDemoStateSchema, createMemoirDemo);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<Editor | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const state = store.value;
  const workspace = store.hydrated && state.data.state === 'ready' ? state.data.workspace : null;
  const session = workspace ? currentDemoSession(workspace) : null;
  const question = workspace?.questions.find((item) => item.id === session?.currentQuestionId);
  const savedAnswer = workspace ? latestDemoAnswers(workspace).find((item) => item.questionId === question?.id) : undefined;
  const answerText = question ? inputs[question.id] ?? savedAnswer?.text ?? '' : '';
  const revision = workspace?.revisions.find((item) => item.id === workspace.chapter.currentRevisionId);
  const confirmation = workspace ? currentDemoConfirmation(workspace) : undefined;
  const publication = workspace?.publications.findLast((item) => item.revokedAt === null);
  const disabled = !store.hydrated || store.blocked;

  function report(error: unknown) {
    setFailure(error instanceof DemoRuleError ? error.message : error instanceof ZodError
      ? error.issues[0]?.message ?? '请核对输入。' : '演示操作失败，输入仍保留。');
  }
  function act(action: MemoirDemoAction, success: string): boolean {
    try {
      store.save(applyMemoirDemo(state, action));
      setMessage(success); setFailure('');
      return true;
    } catch (error: unknown) { report(error); return false; }
  }
  function loadEditor(next: Editor) {
    if (editor?.dirty && !window.confirm('编辑区有未保存修改。确定放弃这些修改并载入所选版本吗？')) return;
    setEditor(next); setReviewed(false); setConsent(false);
  }
  function saveAnswerAndEnd() {
    if (!workspace) return;
    try {
      let next = state;
      if (question && answerText.trim() && answerText !== savedAnswer?.text) {
        next = applyMemoirDemo(next, { type: 'save_answer', expectedVersion: workspace.memoir.version, text: answerText });
      }
      if (next.data.state !== 'ready') return;
      store.save(applyMemoirDemo(next, { type: 'next', expectedVersion: next.data.workspace.memoir.version }));
      setMessage('当前回答已记录，本题已结束。可选择另一个话题。'); setFailure('');
    } catch (error: unknown) { report(error); }
  }
  function download(format: 'markdown' | 'json') {
    try {
      const text = exportMemoirDemo(state, format);
      const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `DEMO-memoir.${format === 'json' ? 'json' : 'md'}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage('已导出当前已保存的演示资料；未保存的输入不在导出包中。'); setFailure('');
    } catch (error: unknown) { report(error); }
  }
  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>拾物馆 / MEMOIR DEMO</span><h1>把故事，慢慢讲完</h1></div>
      <nav className={styles.nav} aria-label="演示导航"><Link href="/demo">DEMO 导览</Link><Link href="/world">世界 DEMO</Link><Link href="/studio">我的工作台</Link></nav>
    </header>
    <div className={styles.banner}><strong>DEMO · 合成资料 · 非实时 AI</strong><br />这里只演示访谈、版本和授权流程。样例草稿按回答原文摘录，不调用 DeepSeek，也不扣费。请只填写虚构内容；操作仅存于当前浏览器标签页，尚未接入服务端持久化与公开发布。</div>
    {store.warning && <p role="alert" className={styles.error}>{store.warning}</p>}
    <p className={styles.muted}>{!store.hydrated ? '正在读取本地演示存档…' : store.persisted ? '演示进度已存于当前标签页，可刷新续接。' : '尚未写入标签页存档。'} 这份自传不关联你的真实展馆。</p>
    {message && <p role="status" className={styles.status}>{message}</p>}
    {failure && <p role="alert" className={styles.error}>{failure}</p>}
    {!store.hydrated ? <section className={styles.panel}><h2>正在读取演示进度</h2><p>本地存档校验完成后再显示回答与章节。</p></section> : !workspace || !session ? <section className={styles.panel}><h2>演示自传已删除</h2><p>当前演示存档已清除回答、草稿、编辑稿、确认和公开许可。原先下载的文件不受影响。</p></section> : <>
      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>一次，只讲一个话题</h2>
          <div className={styles.actions}>{memoirDemoTopics.map((topic, index) => {
            const target = workspace.sessions.find((item) => item.topic.id === topic.id);
            return <button key={topic.id} className={styles.secondary} disabled={disabled || target?.topic.disposition !== 'open'}
              aria-pressed={target?.id === workspace.currentSessionId} onClick={() => {
                act({ type: 'select_topic', expectedVersion: workspace.memoir.version, topicIndex: index }, '已切换话题，原话题的保存记录仍在。');
              }}>{topic.title}{target?.topic.disposition === 'refused' ? ' · 已拒绝' : target?.topic.disposition === 'skipped' ? ' · 已跳过' : target?.topic.disposition === 'completed' ? ' · 已完成' : ''}</button>;
          })}</div>
          <p className={styles.muted}>状态：{session.state === 'active' ? '正在访谈' : session.state === 'paused' ? '已暂停' : '话题已结束'} · 演示深访剩余 {workspace.interviewQuotaRemaining} 次（虚构额度）</p>
          {question ? <>
            <p className={styles.question}>{question.text}</p>
            <label className={styles.field}>当前回答（仅虚构资料，最多 6000 字）<textarea value={answerText} disabled={disabled || session.state !== 'active'}
              onChange={(event) => setInputs({ ...inputs, [question.id]: event.target.value })} rows={6} /></label>
            <p className={styles.muted}>可以写“不确定”或“记不清”。原始空格、换行和不确定表达都会保留。</p>
          </> : <p>这段话题已结束。拒绝与跳过不会自动触发追问；可选择其他话题。</p>}
          <div className={styles.actions}>
            <button className={styles.button} disabled={disabled || session.state !== 'active' || !answerText.trim()} onClick={() => act({ type: 'save_answer', expectedVersion: workspace.memoir.version, text: answerText }, '回答已保存到本地演示存档，尚未调用 AI。')}>保存回答</button>
            <button className={styles.secondary} disabled={disabled || session.state !== 'active' || !savedAnswer || answerText !== savedAnswer.text} onClick={() => act({ type: 'followup_fixture', expectedVersion: workspace.memoir.version }, '已显示一个固定演示追问；非实时 AI。')}>一个演示追问</button>
            <button className={styles.secondary} disabled={disabled || session.state !== 'active'} onClick={saveAnswerAndEnd}>保存并结束本题</button>
          </div>
          <div className={styles.actions}>
            <button className={styles.secondary} disabled={disabled || session.state === 'completed'} onClick={() => act({ type: session.state === 'paused' ? 'resume' : 'pause', expectedVersion: workspace.memoir.version }, session.state === 'paused' ? '已恢复原问题。' : '访谈已暂停，输入保留在当前页面。')}>{session.state === 'paused' ? '恢复访谈' : '暂停'}</button>
            {(['skip', 'refuse'] as const).map((type) => <button key={type} className={styles.secondary} disabled={disabled || session.state !== 'active'} onClick={() => {
              if (answerText !== (savedAnswer?.text ?? '') && !window.confirm('当前有未保存文字。确定结束话题吗？如需保留为回答，请取消并先保存。')) return;
              act({ type, expectedVersion: workspace.memoir.version }, type === 'refuse' ? '已记录拒绝，不再追问这个话题。' : '已跳过，不会自动追问。');
            }}>{type === 'skip' ? '跳过话题' : '不谈这个话题'}</button>)}
          </div>
          <button className={styles.secondary} disabled={disabled || workspace.interviewQuotaRemaining === 0} onClick={() => act({ type: 'exhaust_demo_quota', expectedVersion: workspace.memoir.version }, '已模拟额度耗尽；仍可保存、整理章节和导出。')}>模拟深访额度耗尽</button>
          <hr className={styles.divider} />
          <h3>原始回答与修订</h3>
          {workspace.answers.map((answer) => <details key={answer.id}><summary className={styles.muted}>回答修订 {answer.revision} · {answer.id.slice(-6)}</summary><p className={styles.source}>{answer.text}</p></details>)}
        </section>
        <section className={styles.panel}>
          <h2>从原话，到自己的章节</h2>
          <p className={styles.muted}>整理不消耗演示深访额度。样例草稿、用户编辑稿、确认记录分别保存；原话摘录不会被标为真实 AI 生成。</p>
          <button className={styles.button} disabled={disabled} onClick={() => act({ type: 'chapter_fixture', expectedVersion: workspace.memoir.version, sourceVersion: workspace.sourceVersion }, '已保存一份原文摘录样例草稿，尚未采纳或确认。')}>整理样例草稿（非 AI）</button>
          <div className={styles.actions}>{workspace.drafts.map((draft, index) => <button key={draft.id} className={styles.secondary} disabled={disabled} onClick={() => loadEditor({ title: draft.output.title,
            paragraphs: structuredClone(draft.output.paragraphs), draftId: draft.id, sourceVersion: draft.sourceVersion, dirty: true })}>载入样例草稿 {index + 1}</button>)}</div>
          {revision && <button className={styles.secondary} onClick={() => loadEditor({ title: revision.title, paragraphs: structuredClone(revision.paragraphs), draftId: revision.derivedFromDraftId, sourceVersion: revision.sourceVersion, dirty: false })}>载入已保存编辑稿</button>}
          {editor && <div>
            <label className={styles.field}>章节标题<input value={editor.title} onChange={(event) => { setEditor({ ...editor, title: event.target.value, dirty: true }); setReviewed(false); setConsent(false); }} /></label>
            {editor.paragraphs.map((paragraph, index) => <div key={paragraph.id}>
              <label className={styles.field}>第 {index + 1} 段<textarea value={paragraph.text} rows={4} onChange={(event) => {
                setEditor({ ...editor, dirty: true, paragraphs: editor.paragraphs.map((item) => item.id === paragraph.id ? { ...item, text: event.target.value } : item) }); setReviewed(false); setConsent(false);
              }} /></label>
              <details><summary className={styles.muted}>核对本段来源（码点范围）</summary>{paragraph.sources.map((ref) => {
                const answer = workspace.answers.find((item) => item.id === ref.answerRevisionId);
                return <div key={`${ref.answerRevisionId}:${ref.start}:${ref.end}`}><p className={styles.muted}>回答 {ref.answerRevisionId.slice(-6)} · [{ref.start}, {ref.end})</p><p className={styles.source}>{answer ? Array.from(answer.text).slice(ref.start, ref.end).join('') : '来源不可用，请重新整理。'}</p></div>;
              })}</details>
            </div>)}
            <p className={styles.muted}>编辑不会改变原始回答。请逐段核对；有效引用只能说明来源可定位，不能证明新文字属实。</p>
            <button className={styles.button} disabled={disabled} onClick={() => {
              if (act({ type: 'save_chapter', expectedVersion: workspace.memoir.version, title: editor.title, paragraphs: editor.paragraphs,
                derivedFromDraftId: editor.draftId, sourceVersion: editor.sourceVersion }, '已另存用户编辑稿。当前稿需重新确认；此前公开的副本保持原版本，直到撤销或再次授权。')) setEditor({ ...editor, dirty: false });
            }}>保存用户编辑稿</button>
          </div>}
          {revision && <>
            <p className={styles.status}>编辑稿版本 {revision.version} · {confirmation ? '当前版本已确认' : '当前版本待确认'}{editor?.dirty ? ' · 编辑区尚有未保存内容' : ''}</p>
            <label className={styles.check}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />我已对照原始回答核对当前编辑稿，不确定或矛盾处已保留。</label>
            <button className={styles.secondary} disabled={disabled || !reviewed || editor?.dirty || !!confirmation} onClick={() => act({ type: 'confirm_chapter', expectedVersion: workspace.memoir.version, revisionId: revision.id, reviewedSources: true }, '已确认当前章节；仍未授权公开。')}>确认当前章节</button>
            <label className={styles.check}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />我已检查第三方隐私，并单独同意在 DEMO 阅读区展示这一个已确认章节。此操作不发布到真实展馆。</label>
            <div className={styles.actions}><button className={styles.button} disabled={disabled || !confirmation || !consent || editor?.dirty} onClick={() => {
              if (confirmation) act({ type: 'publish_chapter', expectedVersion: workspace.memoir.version, confirmationId: confirmation.id, privacyAcknowledged: true, authorizePublicChapter: true }, '已生成章节的 DEMO 公开快照，仅在本地阅读区可见。');
            }}>单独授权此章（DEMO）</button><button className={styles.secondary} disabled={disabled || !publication} onClick={() => act({ type: 'revoke_chapter', expectedVersion: workspace.memoir.version }, '已撤销本地章节许可，阅读区不再显示正文。')}>撤销此章许可</button></div>
          </>}
        </section>
      </div>
      <section className={styles.panel}><h2>公开阅读预览 · DEMO</h2><DemoBook key={publication?.id ?? 'private'} chapter={publication?.publicData ?? null} author="DEMO · 参观者" />{publication ? <article><h3>{publication.publicData.title}</h3>{publication.publicData.paragraphs.map((text, index) => <p className={styles.reading} key={index}>{text}</p>)}</article> : <p className={styles.muted}>尚无有效的逐章公开许可。真实馆的公开状态不会自动公开这份自传。</p>}</section>
      <section className={styles.panel}><h2>资料由自己保管</h2><p className={styles.muted}>导出只含已保存资料；深访额度不足仍可导出。真实资料接入前还需落实备份期限和删除恢复策略。</p>
        <div className={styles.actions}><button className={styles.secondary} disabled={disabled} onClick={() => download('markdown')}>导出 Markdown</button><button className={styles.secondary} disabled={disabled} onClick={() => download('json')}>导出 JSON</button></div>
        <label className={styles.check}><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} />我确认删除此标签页内整份 DEMO 自传，包括回答、草稿、编辑稿与许可。已导出副本无法撤回。</label>
        <button className={styles.danger} disabled={disabled || !deleteConfirmed} onClick={() => {
          if (act({ type: 'delete_memoir', expectedVersion: workspace.memoir.version, confirmOnlineDeletion: true }, 'DEMO 自传已删除。')) { setEditor(null); setInputs({}); setReviewed(false); setConsent(false); }
        }}>删除整份 DEMO 自传</button>
      </section>
    </>}
    <button className={styles.secondary} disabled={!store.hydrated} onClick={() => {
      if (!window.confirm('确定清空当前演示进度并重新载入合成样例吗？')) return;
      store.save(createMemoirDemo()); setEditor(null); setInputs({}); setMessage('已重置为合成样例。'); setFailure(''); setReviewed(false); setConsent(false); setDeleteConfirmed(false);
    }}>重置演示资料</button>
  </main>;
}
