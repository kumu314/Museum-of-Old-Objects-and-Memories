import { useState } from 'react';
import type { AiDraft } from '../../contracts/ai';
import type { ExhibitDraft } from '../../contracts/museum';
import { Field } from './ui';

export function AiDraftPanel({ draft, saved, busy, dirty, onAdopt, onDirty, onDismiss }: {
  draft: AiDraft; saved: ExhibitDraft; busy: boolean; dirty: boolean;
  onAdopt: (caption: string) => void; onDirty: (dirty: boolean) => void; onDismiss: () => void;
}) {
  const [caption, setCaption] = useState(draft.output.caption);
  const stale = draft.sourceVersion !== saved.version;
  const length = Array.from(caption.trim()).length;
  let adoptionHint = '采纳会保存为新版本，仍需你明确确认。';
  if (dirty) adoptionHint = '讲述有未保存修改，请先保存并核对来源版本。';
  if (stale) adoptionHint = '来源版本已变化，不能采纳。请先保留修订，再重新整理。';
  return <section className="workbench-ai-draft" aria-label="AI 草稿对照">
    <div className="wb-row"><h3>AI 整理草稿</h3><span className="wb-badge">待人工审阅</span></div>
    <p className="wb-hint">依据展品版本 v{draft.sourceVersion} 整理。引用来源不代表事实已经核实。</p>
    <Field label="审阅并修订草稿"><textarea rows={6} value={caption} aria-invalid={length > 120} onChange={(event) => { setCaption(event.target.value); onDirty(event.target.value !== draft.output.caption); }} disabled={busy} /></Field>
    <p className={`workbench-count ${length > 120 ? 'wb-error' : ''}`}>{length} / 120 字</p>
    {draft.output.questions.length > 0 && <div className="workbench-followup"><h4>还可以核对</h4><ul>{draft.output.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}
    <details className="workbench-details"><summary>核对草稿引用的讲述片段</summary>{draft.output.sourceSegmentIds.map((id) => <blockquote key={id}>{saved.sourceSegments.find((segment) => segment.id === id)?.text ?? '来源片段已变化，请重新整理。'}<cite>来源片段 · {id}</cite></blockquote>)}</details>
    <p className="wb-hint">{adoptionHint}</p>
    <div className="wb-actions"><button className="wb-secondary" type="button" disabled={busy || dirty || stale || length === 0 || length > 120} onClick={() => onAdopt(caption)}>采纳修订后的展签</button><button className="wb-text-link" type="button" disabled={busy} onClick={onDismiss}>放弃这份草稿</button></div>
  </section>;
}
