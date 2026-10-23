'use client';

import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { adoptAiInputSchema, aiDraftSchema, type AiDraft } from '../../contracts/ai';
import { confirmExhibitInputSchema, createExhibitInputSchema, exhibitDraftSchema, updateExhibitInputSchema, type CreateExhibitInput, type ExhibitDraft, type MuseumDraft } from '../../contracts/museum';
import { modelKeySchema } from '../../contracts/primitives';
import { apiRequest, describeFailure, jsonRequest } from './api';
import { AiDraftPanel } from './ai-draft-panel';
import { AssetFields } from './asset-fields';
import { sourceSegmentsFromText } from './source-segments';
import { buttonClass, Field, inputClass, Notice, panelClass, primaryClass } from './ui';

type Editable = Omit<CreateExhibitInput, 'expectedMuseumVersion'>;
function editable(exhibit: ExhibitDraft | null, slotIndex: number): Editable {
  if (!exhibit) return { name: '', era: '年代待考', slotIndex, modelKey: 'photo-plane', caption: '', photoAssetId: null, audioAssetId: null, approximation: '', sourceNotice: '', rawStory: '', transcript: null, sourceSegments: [] };
  return { name: exhibit.name, era: exhibit.era, slotIndex: exhibit.slotIndex, modelKey: exhibit.modelKey, caption: exhibit.caption, photoAssetId: exhibit.photoAssetId, audioAssetId: exhibit.audioAssetId, approximation: exhibit.approximation, sourceNotice: exhibit.sourceNotice, rawStory: exhibit.rawStory, transcript: exhibit.transcript, sourceSegments: exhibit.sourceSegments };
}

export function ExhibitEditor({ museum, initial, slotIndex, onSaved, onDeleted, onDirty, onBusy }: {
  museum: MuseumDraft; initial: ExhibitDraft | null; slotIndex: number;
  onSaved: (exhibit: ExhibitDraft) => Promise<void>; onDeleted: () => Promise<void>;
  onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [fields, setFields] = useState(() => editable(initial, slotIndex));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const dirty = JSON.stringify(fields) !== JSON.stringify(editable(saved, slotIndex));
  const path = `/api/museums/${museum.id}/exhibits`;
  function change<K extends keyof Editable>(key: K, value: Editable[K]) {
    const next = { ...fields, [key]: value };
    setFields(next); onDirty(JSON.stringify(next) !== JSON.stringify(editable(saved, slotIndex)) || note.length > 0); setMessage(null);
  }
  function pending(value: string | null) { setBusy(value); onBusy(value !== null); }
  async function acceptSaved(exhibit: ExhibitDraft, messageText: string) {
    setSaved(exhibit); setFields(editable(exhibit, slotIndex)); setNote(''); onDirty(false); setMessage(messageText);
    await onSaved(exhibit);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); pending('保存'); setError(null); setMessage(null);
    try {
      const values = { ...fields, sourceSegments: sourceSegmentsFromText(fields.rawStory, fields.transcript, saved?.sourceSegments ?? []) };
      const input = saved ? updateExhibitInputSchema.parse({ ...values, expectedVersion: saved.version }) : createExhibitInputSchema.parse({ ...values, expectedMuseumVersion: museum.version });
      const result = await apiRequest(saved ? `${path}/${saved.id}` : path, exhibitDraftSchema, jsonRequest(saved ? 'PATCH' : 'POST', input));
      await acceptSaved(result, '展品已保存。公开内容变化后需要重新确认。');
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  async function confirm() {
    if (!saved) return;
    pending('确认'); setError(null); setMessage(null);
    try {
      const result = await apiRequest(`${path}/${saved.id}/confirm`, exhibitDraftSchema, jsonRequest('POST', confirmExhibitInputSchema.parse({ expectedVersion: saved.version, confirmationNote: note })));
      await acceptSaved(result, `已记录对展品版本 ${result.version} 的人工确认。`);
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  async function remove() {
    if (!saved || !window.confirm(`从草稿移除“${saved.name}”？已发布的快照仍保留原内容。`)) return;
    pending('移除'); setError(null);
    try {
      await apiRequest(`${path}/${saved.id}`, z.strictObject({ ok: z.literal(true) }), jsonRequest('DELETE', { expectedVersion: saved.version }));
      onDirty(false); await onDeleted();
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  async function generate() {
    if (!saved) return;
    pending('AI 整理'); setError(null); setMessage(null);
    try { setAiDraft(await apiRequest(`${path}/${saved.id}/ai`, aiDraftSchema, jsonRequest('POST', { expectedVersion: saved.version }))); }
    catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  async function adopt(caption: string) {
    if (!saved || !aiDraft) return;
    pending('采纳'); setError(null);
    try {
      const input = adoptAiInputSchema.parse({ expectedVersion: saved.version, draftId: aiDraft.id, caption });
      const result = await apiRequest(`${path}/${saved.id}/ai/adopt`, exhibitDraftSchema, jsonRequest('POST', input));
      await acceptSaved(result, '展签已采纳为新的未确认版本，请再次核对物主确认。'); setAiDraft(null);
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  return <section className={panelClass} aria-label="展品编辑">
    <header className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl">{saved ? saved.name : '收录新旧物'}</h2><p className="mt-2 text-xs text-stone-400">{saved ? `版本 ${saved.version} · ${saved.confirmedVersion === saved.version ? '本版本已确认' : '尚未确认'}` : '先保存资料，再整理和确认故事'}{dirty ? ' · 有未保存内容' : ''}</p></div>{saved && <button type="button" className={`${buttonClass} text-red-200`} disabled={busy !== null} onClick={remove}>移除草稿展品</button>}</header>
    <Notice error={error} message={message} />
    <form className="mt-6 space-y-6" onSubmit={save}>
      <fieldset disabled={busy !== null && busy !== 'AI 整理'} className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2"><Field label="旧物名称"><input className={inputClass} required maxLength={80} value={fields.name} onChange={(event) => change('name', event.target.value)} /></Field><Field label="约略年代" hint="未经核实可填写“年代待考”，保留“约”等不确定性。"><input className={inputClass} required maxLength={80} value={fields.era} onChange={(event) => change('era', event.target.value)} /></Field></div>
        <div className="grid gap-5 sm:grid-cols-2"><Field label="柜格位置"><select className={inputClass} value={fields.slotIndex} onChange={(event) => change('slotIndex', Number(event.target.value))}>{Array.from({ length: 6 }, (_, index) => <option key={index} value={index} disabled={museum.exhibits.some((item) => item.slotIndex === index && item.id !== saved?.id)}>{index < 3 ? '上排' : '下排'} · 第 {index % 3 + 1} 格</option>)}</select></Field><Field label="展示模型"><select className={inputClass} value={fields.modelKey} onChange={(event) => change('modelKey', modelKeySchema.parse(event.target.value))}><option value="photo-plane">实拍薄片</option><option value="camera-01">复古相机 · 演示模型</option><option value="cassette">手录磁带 · 演示模型</option><option value="ticket">旧车票 · 演示模型</option></select></Field></div>
        <AssetFields museumId={museum.id} photoAssetId={fields.photoAssetId} audioAssetId={fields.audioAssetId} busy={busy !== null} onAsset={(asset) => change(asset.kind === 'image' ? 'photoAssetId' : 'audioAssetId', asset.id)} onBusy={(uploading) => pending(uploading ? '上传素材' : null)} onError={setError} />
        {(fields.photoAssetId || fields.audioAssetId) && <div className="flex flex-wrap gap-3">{fields.photoAssetId && <button type="button" className={buttonClass} onClick={() => change('photoAssetId', null)}>移除图片关联</button>}{fields.audioAssetId && <button type="button" className={buttonClass} onClick={() => change('audioAssetId', null)}>移除录音关联</button>}</div>}
        <Field label="原始讲述" hint="原样保留物主讲述，空行分段。与录音整理文本合计最多 12000 字。"><textarea className={inputClass} rows={6} value={fields.rawStory} onChange={(event) => change('rawStory', event.target.value)} /></Field>
        <Field label="录音整理文本（可选）" hint="人工整理的录音文字，与原始讲述分别保存。"><textarea className={inputClass} rows={4} value={fields.transcript ?? ''} onChange={(event) => change('transcript', event.target.value || null)} /></Field>
        <Field label="展签" hint="随展品公开展示的短文，最多 120 字。AI 草稿需审阅后才能采纳。"><textarea className={inputClass} rows={4} value={fields.caption} onChange={(event) => change('caption', event.target.value)} /></Field>
        <Field label="模型近似程度" hint="说明哪些细节为示意，不能把演示模型称为物主藏品的精确复原。"><textarea className={inputClass} rows={2} required value={fields.approximation} onChange={(event) => change('approximation', event.target.value)} /></Field>
        <Field label="素材来源与使用说明" hint="公开展示来源和演示标识；授权范围需有真实依据。"><textarea className={inputClass} rows={2} required value={fields.sourceNotice} onChange={(event) => change('sourceNotice', event.target.value)} /></Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3"><button className={primaryClass} disabled={busy !== null}>{busy === '保存' ? '正在保存…' : '保存展品'}</button><button type="button" className={buttonClass} disabled={busy !== null || dirty || !saved || saved.sourceSegments.length === 0} onClick={generate}>{busy === 'AI 整理' ? '正在整理…' : 'AI 整理已保存讲述'}</button></div>
    </form>
    {aiDraft && saved && <AiDraftPanel key={aiDraft.id} draft={aiDraft} saved={saved} busy={busy !== null} dirty={dirty} onAdopt={adopt} />}
    {saved && <section className="mt-8 border-t border-stone-700 pt-6"><h3 className="text-lg">记录物主确认</h3><p className="my-3 text-sm leading-6 text-stone-400">先在线下或已有渠道核对当前版本，再填写对应记录。此操作不会替物主确认事实。</p>{saved.confirmedVersion === saved.version ? <p className="text-sm text-amber-100/80">{saved.confirmationNote}</p> : <><Field label="确认记录" hint="例如确认日期、渠道及对应版本，不填写未经发生的确认。"><textarea className={inputClass} rows={2} value={note} onChange={(event) => { setNote(event.target.value); onDirty(dirty || event.target.value.length > 0); }} disabled={busy !== null} /></Field><button className={`${primaryClass} mt-4`} type="button" disabled={busy !== null || dirty || !note.trim()} onClick={confirm}>确认当前版本</button></>}</section>}
  </section>;
}
