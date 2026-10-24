import { useState } from 'react';
import type { AiDraft } from '../../contracts/ai';
import type { ExhibitDraft } from '../../contracts/museum';
import { Field, inputClass, panelClass, primaryClass } from './ui';

export function AiDraftPanel({ draft, saved, busy, dirty, onAdopt }: {
  draft: AiDraft; saved: ExhibitDraft; busy: boolean; dirty: boolean; onAdopt: (caption: string) => void;
}) {
  const [caption, setCaption] = useState(draft.output.caption);
  const stale = draft.sourceVersion !== saved.version;
  return <section className={`${panelClass} mt-6`} aria-label="AI 草稿对照">
    <h3 className="text-lg">AI 草稿 · 待人工审阅</h3><p className="mt-2 text-xs text-stone-400">依据展品版本 {draft.sourceVersion} 整理。来源标识正确不等于事实已经核实。</p>
    <div className="mt-5 grid gap-5 sm:grid-cols-2"><div><h4 className="text-sm text-stone-300">已保存展签</h4><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-400">{saved.caption || '尚未填写'}</p></div><Field label="审阅并修订 AI 草稿"><textarea className={inputClass} rows={6} value={caption} onChange={(event) => setCaption(event.target.value)} disabled={busy} /></Field></div>
    {draft.output.questions.length > 0 && <div className="mt-4"><h4 className="text-sm text-stone-300">建议补充核对</h4><ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-stone-400">{draft.output.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}
    <details className="mt-4 text-sm text-stone-400"><summary className="cursor-pointer">查看引用的讲述片段</summary>{draft.output.sourceSegmentIds.map((id) => <p key={id} className="mt-3 whitespace-pre-wrap leading-6">{saved.sourceSegments.find((segment) => segment.id === id)?.text ?? '此片段已随来源版本变化，请重新整理。'}</p>)}</details>
    <p className="mt-4 text-sm text-amber-100/70">{stale ? '来源版本已变化，不能采纳这份草稿。请重新整理。' : dirty ? '编辑区有未保存内容。请先保存，再重新整理或核对来源版本。' : '采纳后仍需针对新版本确认。'}</p>
    <button className={`${primaryClass} mt-4`} type="button" disabled={busy || dirty || stale} onClick={() => onAdopt(caption)}>采纳修订后的展签</button>
  </section>;
}
