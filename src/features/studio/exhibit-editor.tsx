'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { adoptAiInputSchema, aiDraftSchema, type AiDraft } from '../../contracts/ai';
import { confirmExhibitInputSchema, createExhibitInputSchema, displayPhotoRequiredMessage, exhibitDraftSchema, missingDisplayPhoto, updateExhibitInputSchema, type CreateExhibitInput, type ExhibitDraft, type MuseumDraft } from '../../contracts/museum';
import { modelKeySchema } from '../../contracts/primitives';
import { apiRequest, describeFailure, jsonRequest } from './api';
import { AiDraftPanel } from './ai-draft-panel';
import { AssetFields } from './asset-fields';
import { ModelGenerationFields } from './model-generation-fields';
import { cabinetPage, cabinetPageCount, cabinetPosition, slotsPerPage } from './cabinet-pages';
import { sourceSegmentsFromText } from './source-segments';
import { Field, Notice } from './ui';

type Editable = Omit<CreateExhibitInput, 'expectedMuseumVersion'>;
type Tab = 'materials' | 'story' | 'confirmation';
const tabs: readonly { id: Tab; label: string }[] = [
  { id: 'materials', label: '素材' }, { id: 'story', label: '故事' }, { id: 'confirmation', label: '确认' },
];

function editable(exhibit: ExhibitDraft | null, slotIndex: number): Editable {
  if (!exhibit) return {
    name: '', era: '年代待考', slotIndex, modelKey: 'photo-plane', caption: '',
    photoAssetId: null, audioAssetId: null, modelInput: { mode: 'single', imageAssetId: null },
    approximation: '当前以实拍照片平面展示，不是三维复原。',
    sourceNotice: '', rawStory: '', transcript: null, sourceSegments: [],
  };
  return {
    name: exhibit.name, era: exhibit.era, slotIndex: exhibit.slotIndex, modelKey: exhibit.modelKey,
    caption: exhibit.caption, photoAssetId: exhibit.photoAssetId, audioAssetId: exhibit.audioAssetId,
    approximation: exhibit.approximation, sourceNotice: exhibit.sourceNotice, rawStory: exhibit.rawStory,
    transcript: exhibit.transcript, sourceSegments: exhibit.sourceSegments, modelInput: exhibit.modelInput,
  };
}

export function ExhibitEditor({ museum, initial, slotIndex, resetKey, cabinet, publishing, blocked, onSaved, onDeleted, onDirty, onBusy }: {
  museum: MuseumDraft; initial: ExhibitDraft | null; slotIndex: number;
  resetKey: string; cabinet: ReactNode; publishing: ReactNode; blocked: boolean;
  onSaved: (exhibit: ExhibitDraft) => Promise<void>; onDeleted: () => Promise<void>;
  onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const [editorKey, setEditorKey] = useState(resetKey);
  const [saved, setSaved] = useState(initial);
  const [fields, setFields] = useState(() => editable(initial, slotIndex));
  const [tab, setTab] = useState<Tab>('materials');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [draftEdited, setDraftEdited] = useState(false);
  // Reset only the editing fields on an explicit selection/reload; the scene stays mounted.
  if (editorKey !== resetKey) {
    setEditorKey(resetKey); setSaved(initial); setFields(editable(initial, slotIndex));
    setNote(''); setBusy(null); setError(null); setMessage(null); setAiDraft(null); setDraftEdited(false);
  }
  const dirty = JSON.stringify(fields) !== JSON.stringify(editable(saved, slotIndex));
  const disabled = blocked || busy !== null;
  const captionLength = Array.from(fields.caption.trim()).length;
  const confirmed = saved !== null && saved.confirmedVersion === saved.version;
  const photoMissing = missingDisplayPhoto(fields);
  const path = `/api/museums/${museum.id}/exhibits`;
  const positionPages = new Set([0, cabinetPage(fields.slotIndex), cabinetPageCount(museum.exhibits), ...museum.exhibits.map(({ slotIndex: slot }) => cabinetPage(slot))]);
  const availablePositions = [...positionPages].sort((a, b) => a - b).flatMap((page) => Array.from({ length: slotsPerPage }, (_, slot) => page * slotsPerPage + slot));
  let confirmationLabel = '尚未保存';
  if (saved) confirmationLabel = `v${saved.version} · 待确认`;
  if (saved && confirmed && !dirty) confirmationLabel = `v${saved.version} · 已确认`;
  if (saved && photoMissing) confirmationLabel = `v${saved.version} · 待补图片`;
  let saveStatus = '尚未保存';
  if (saved) saveStatus = `已保存 · v${saved.version}`;
  if (dirty) saveStatus = '有未保存修改';
  if (busy !== null) saveStatus = `${busy}中…`;
  if (blocked) saveStatus = '请核对展馆状态';

  function change<K extends keyof Editable>(key: K, value: Editable[K]) {
    const next = { ...fields, [key]: value };
    setFields(next);
    onDirty(JSON.stringify(next) !== JSON.stringify(editable(saved, slotIndex)) || note.length > 0 || draftEdited);
    setMessage(null);
  }
  function pending(value: string | null) { setBusy(value); onBusy(value !== null); }
  async function acceptSaved(exhibit: ExhibitDraft, messageText: string, keepDraftEdits = draftEdited) {
    setSaved(exhibit); setFields(editable(exhibit, slotIndex)); setNote('');
    onDirty(keepDraftEdits); setMessage(messageText);
    await onSaved(exhibit);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    pending('保存'); setError(null); setMessage(null);
    try {
      const values = { ...fields, sourceSegments: sourceSegmentsFromText(fields.rawStory, fields.transcript, saved?.sourceSegments ?? []) };
      const input = saved
        ? updateExhibitInputSchema.parse({ ...values, expectedVersion: saved.version })
        : createExhibitInputSchema.parse({ ...values, expectedMuseumVersion: museum.version });
      const result = await apiRequest(saved ? `${path}/${saved.id}` : path, exhibitDraftSchema, jsonRequest(saved ? 'PATCH' : 'POST', input));
      await acceptSaved(result, '草稿已保存。确认与发布由你分别决定。');
    } catch (failure) {
      setError(describeFailure(failure));
      if (failure instanceof z.ZodError) {
        const key = failure.issues[0]?.path[0];
        if (key === 'caption') setTab('confirmation');
        else if (key === 'rawStory' || key === 'transcript' || key === 'sourceSegments') setTab('story');
        else setTab('materials');
      }
    } finally { pending(null); }
  }
  async function confirm() {
    if (!saved || disabled || dirty || draftEdited || missingDisplayPhoto(saved)) return;
    pending('确认'); setError(null); setMessage(null);
    try {
      const input = confirmExhibitInputSchema.parse({ expectedVersion: saved.version, confirmationNote: note });
      const result = await apiRequest(`${path}/${saved.id}/confirm`, exhibitDraftSchema, jsonRequest('POST', input));
      await acceptSaved(result, `已确认版本 v${result.version} 的展签、展示方式和素材。`);
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  async function remove() {
    if (!saved || disabled) return;
    if (!window.confirm(`从草稿移除“${saved.name}”？已发布的快照仍保留原内容。${dirty || draftEdited || note ? '本页未保存内容也将放弃。' : ''}`)) return;
    pending('移除'); setError(null);
    try {
      await apiRequest(`${path}/${saved.id}`, z.strictObject({ ok: z.literal(true) }), jsonRequest('DELETE', { expectedVersion: saved.version }));
      onDirty(false); await onDeleted();
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  async function generate() {
    if (!saved || disabled || dirty || draftEdited) return;
    pending('整理故事'); setError(null); setMessage(null);
    try {
      setAiDraft(await apiRequest(`${path}/${saved.id}/ai`, aiDraftSchema, jsonRequest('POST', { expectedVersion: saved.version })));
      setDraftEdited(false);
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  async function adopt(caption: string) {
    if (!saved || !aiDraft || disabled || dirty) return;
    pending('采纳展签'); setError(null);
    try {
      const input = adoptAiInputSchema.parse({ expectedVersion: saved.version, draftId: aiDraft.id, caption });
      const result = await apiRequest(`${path}/${saved.id}/ai/adopt`, exhibitDraftSchema, jsonRequest('POST', input));
      await acceptSaved(result, '草稿已采纳为新版本。请再次核对并确认。', false);
      setAiDraft(null); setDraftEdited(false); setTab('confirmation');
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  function dismissDraft() {
    if (draftEdited && !window.confirm('放弃这份尚未采纳的草稿修订？')) return;
    setAiDraft(null); setDraftEdited(false); onDirty(dirty || note.length > 0);
  }

  return <>
    <div className="workbench-toolbar">
      <div><span className="workbench-eyebrow">{cabinetPosition(fields.slotIndex)} · {saved ? '旧物记录' : '收录新旧物'}</span>
        <h1>{fields.name || '给一件旧物，留一个位置'}</h1></div>
      <div className="workbench-save"><span role="status">{saveStatus}</span>
        <button className="wb-primary" type="submit" form={`${id}-form`} disabled={disabled || (!dirty && saved !== null)}>保存草稿</button></div>
    </div>
    <Notice error={error} message={message} />
    <div className="workbench-tabs" role="tablist" aria-label="编辑步骤">{tabs.map((item, index) =>
      <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-controls={`${id}-${item.id}`}
        aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}
        onKeyDown={(event) => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          const target = tabs[next];
          if (target) { event.preventDefault(); setTab(target.id); document.getElementById(`${id}-tab-${target.id}`)?.focus(); }
        }}>{item.label}</button>)}</div>
    {/* Panels stay mounted so changing tabs or viewport width preserves input. */}
    <form id={`${id}-form`} className="workbench-grid" onSubmit={save} noValidate>
      <section className="workbench-column" id={`${id}-materials`} role="tabpanel" aria-labelledby={`${id}-tab-materials`} data-active={tab === 'materials'}>
        <header className="workbench-section-heading"><h2>格位与素材收录</h2><span>01 / 留下实物</span></header>
        {cabinet}
        <fieldset disabled={disabled} className="workbench-fields">
          <Field label="旧物名称"><input required maxLength={80} value={fields.name} placeholder="例如：父亲的旧相机" onChange={(event) => change('name', event.target.value)} /></Field>
          {!saved && <p className="wb-hint">先为它取个名字，再写下你们的共同回忆。<button type="button" className="wb-text-link" onClick={() => { setTab('story'); requestAnimationFrame(() => document.getElementById(`${id}-story-input`)?.focus()); }}>去写回忆 →</button></p>}
          <AssetFields key={resetKey} museumId={museum.id} photoAssetId={fields.photoAssetId} audioAssetId={fields.audioAssetId} busy={disabled}
            onAsset={(asset) => change(asset.kind === 'image' ? 'photoAssetId' : 'audioAssetId', asset.id)}
            onBusy={(uploading) => pending(uploading ? '上传素材' : null)} onError={setError} />
          {(fields.photoAssetId || fields.audioAssetId) && <div className="wb-actions">{fields.photoAssetId && <button type="button" className="wb-text-link" onClick={() => change('photoAssetId', null)}>移除图片关联</button>}{fields.audioAssetId && <button type="button" className="wb-text-link" onClick={() => change('audioAssetId', null)}>移除录音关联</button>}</div>}
          <ModelGenerationFields museumId={museum.id} exhibitId={saved?.id ?? null} exhibitVersion={saved?.version ?? null} dirty={dirty} input={fields.modelInput} photoAssetId={fields.photoAssetId} disabled={disabled} onChange={(input) => change('modelInput', input)} onBusy={(uploading) => pending(uploading ? '上传建模照片' : null)} onError={setError} />
          <Field label="素材来源与使用说明" hint="请据实说明照片、录音的来源及允许的使用范围。保存前需填写，随展品公开。"><textarea required rows={2} value={fields.sourceNotice} placeholder="这些照片和录音由谁提供，允许用于什么用途？" onChange={(event) => change('sourceNotice', event.target.value)} /></Field>
          <details className="workbench-details"><summary>年代、格位与展示说明</summary><div className="workbench-fields">
            <Field label="约略年代" hint="记不清可以保留“年代待考”。"><input required maxLength={80} value={fields.era} onChange={(event) => change('era', event.target.value)} /></Field>
            <Field label="柜格位置"><select value={fields.slotIndex} onChange={(event) => change('slotIndex', Number(event.target.value))}>{availablePositions.map((index) => <option key={index} value={index} disabled={museum.exhibits.some((item) => item.slotIndex === index && item.id !== saved?.id)}>{cabinetPosition(index)}</option>)}</select></Field>
            <Field label="当前展示方式"><select value={fields.modelKey} onChange={(event) => change('modelKey', modelKeySchema.parse(event.target.value))}><option value="photo-plane">实拍照片平面展示</option><option value="camera-01">复古相机 · 内置演示模型</option><option value="cassette">手录磁带 · 内置演示模型</option><option value="ticket">旧车票 · 内置演示模型</option></select></Field>
            <Field label="展示近似程度" hint="照片平面和演示模型都不是实物的精确复原；请与上面的展示方式保持一致。"><textarea required rows={3} value={fields.approximation} onChange={(event) => change('approximation', event.target.value)} /></Field>
          </div></details>
        </fieldset>
      </section>
      <section className="workbench-column" id={`${id}-story`} role="tabpanel" aria-labelledby={`${id}-tab-story`} data-active={tab === 'story'}>
        <header className="workbench-section-heading"><h2>关于它，也关于你们</h2><span>02 / 记下回忆</span></header>
        <fieldset disabled={disabled} className="workbench-fields">
          <Field label="共同回忆 · 原始讲述" hint="按自己的话写，记不清的地方也可以留下。原始讲述和录音文字各自最多 12000 字。"><textarea id={`${id}-story-input`} className="workbench-story-input" rows={8} value={fields.rawStory} placeholder="它与你和谁有关？你们一起经历过什么？为什么想把它留下来？从最想说的那一段开始。" onChange={(event) => change('rawStory', event.target.value)} /></Field>
          <details className="workbench-details"><summary>添加录音整理文本（可选）</summary><Field label="人工整理的录音文字" hint="与上面的讲述分别保存。当前没有自动转写，请复听录音后填写。"><textarea rows={4} value={fields.transcript ?? ''} onChange={(event) => change('transcript', event.target.value || null)} /></Field></details>
        </fieldset>
        <div className="workbench-story-action"><div><h3>整理成一段展签</h3><p className="wb-hint">只整理你提供的事实，保留不确定的表达。</p></div><button type="button" className="wb-secondary" disabled={disabled || dirty || draftEdited || !saved || saved.sourceSegments.length === 0} onClick={generate}>{busy === '整理故事' ? '正在整理…' : '整理故事'}</button></div>
        {(dirty || !saved) && <p className="wb-hint">先保存讲述，再整理故事；你也可以直接在右侧写展签。</p>}
        {aiDraft && saved ? <AiDraftPanel key={aiDraft.id} draft={aiDraft} saved={saved} busy={disabled} dirty={dirty} onAdopt={adopt}
          onDirty={(value) => { setDraftEdited(value); onDirty(dirty || note.length > 0 || value); }} onDismiss={dismissDraft} />
          : <div className="workbench-empty"><span>等待一段回忆</span><p>整理后的草稿会放在这里。你可以核对来源、修订文字，再决定是否采纳。</p></div>}
      </section>
      <section className="workbench-column" id={`${id}-confirmation`} role="tabpanel" aria-labelledby={`${id}-tab-confirmation`} data-active={tab === 'confirmation'}>
        <header className="workbench-section-heading"><h2>展签确认与发布</h2><span>03 / 给回忆落款</span></header>
        <div className="workbench-caption-heading"><h3>人工确认展签</h3><span className="wb-badge">{confirmationLabel}</span></div>
        <Field label="随展品公开的文字"><textarea className="workbench-caption-input" rows={9} disabled={disabled} value={fields.caption}
          aria-invalid={captionLength > 120} aria-describedby={`${id}-caption-count`} placeholder="把你希望参观者读到的回忆写在这里。也可以从故事草稿中采纳，再亲自修订。" onChange={(event) => change('caption', event.target.value)} /></Field>
        <p id={`${id}-caption-count`} className={`workbench-count ${captionLength > 120 ? 'wb-error' : ''}`}>{captionLength} / 120 字</p>
        <p className="wb-hint">确认前请核对展签、展示方式和素材。修改公开内容后，需要重新确认。</p>
        {photoMissing && <p className="wb-hint" role="status">{displayPhotoRequiredMessage}<button type="button" className="wb-text-link" onClick={() => setTab('materials')}>前往素材补图 →</button></p>}
        {confirmed && !dirty && !photoMissing ? <p className="workbench-confirmed">✓ 当前版本已确认<span>{saved.confirmationNote}</span></p>
          : <div className="workbench-fields"><Field label="确认记录" hint="仅自己可见，例如“已核对照片与讲述一致”。"><textarea rows={2} value={note} disabled={disabled || !saved} onChange={(event) => { setNote(event.target.value); onDirty(dirty || draftEdited || event.target.value.length > 0); }} /></Field>
            <button type="button" className="wb-primary wb-full" disabled={disabled || dirty || draftEdited || !saved || !note.trim() || photoMissing || captionLength === 0 || captionLength > 120} onClick={confirm}>明确确认当前版本</button>
            {(!saved || dirty) && <p className="wb-hint">请先保存草稿，确认只针对已保存的当前版本。</p>}</div>}
        {publishing}
        {saved && <button type="button" className="wb-text-link wb-danger" disabled={disabled} onClick={remove}>移除这件旧物的草稿</button>}
      </section>
    </form>
  </>;
}
