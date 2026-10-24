'use client';

import { OrnateFrame } from '../ornaments/ornate-frame';
import { ConfirmationSeal } from '../ornaments/confirmation-seal';
import { ObjectEngraving, WaxSeal } from './curator-details';
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { adoptAiInputSchema, aiDraftSchema, type AiDraft } from '../../contracts/ai';
import { confirmExhibitInputSchema, createExhibitInputSchema, displayPhotoRequiredMessage, exhibitDraftSchema, missingDisplayPhoto, museumDraftSchema, updateExhibitInputSchema, type CreateExhibitInput, type ExhibitDraft, type MuseumDraft } from '../../contracts/museum';
import { modelKeySchema } from '../../contracts/primitives';
import { apiRequest, describeFailure, jsonRequest } from './api';
import { AiDraftPanel } from './ai-draft-panel';
import { AssetFields } from './asset-fields';
import { ModelGenerationFields } from './model-generation-fields';
import { cabinetPage, cabinetPageCount, cabinetPosition, slotsPerPage } from './cabinet-pages';
import { sourceSegmentsFromText } from './source-segments';
import { WorkbenchDialog } from './workbench-dialog';
import { Field, Notice } from './ui';

type Editable = Omit<CreateExhibitInput, 'expectedMuseumVersion'>;
type Tab = 'materials' | 'story' | 'confirmation';
export type ReviewRequest = { revision: number; tab: Tab };
const fieldLabels: Record<string, string> = { name: '旧物名称', era: '约略年代', caption: '展签', sourceNotice: '素材来源与使用说明', approximation: '展示近似程度', rawStory: '原始讲述', transcript: '录音整理文本', sourceSegments: '讲述来源', slotIndex: '柜格位置', modelKey: '展示方式', modelInput: '建模照片' };
const tabs: readonly { id: Tab; label: string }[] = [
  { id: 'materials', label: '展柜' }, { id: 'story', label: '档案' }, { id: 'confirmation', label: '审阅' },
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

export function ExhibitEditor({ museum, initial, slotIndex, resetKey, cabinet, toolbar, reviewRequest, blocked, onSaved, onRefreshed, onDeleted, onDirty, onBusy }: {
  museum: MuseumDraft; initial: ExhibitDraft | null; slotIndex: number;
  resetKey: string; cabinet: ReactNode; toolbar: (controls: ReactNode) => ReactNode; reviewRequest: ReviewRequest | null; blocked: boolean;
  onSaved: (exhibit: ExhibitDraft) => Promise<void>; onRefreshed: (museum: MuseumDraft) => void; onDeleted: () => Promise<void>;
  onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const [editorKey, setEditorKey] = useState(resetKey);
  const [saved, setSaved] = useState(initial);
  const [fields, setFields] = useState(() => editable(initial, slotIndex));
  const [clearGeneratedModel, setClearGeneratedModel] = useState(false);
  const [tab, setTab] = useState<Tab>('story');
  const [lastReview, setLastReview] = useState(reviewRequest);
  if (lastReview !== reviewRequest) {
    setLastReview(reviewRequest);
    if (reviewRequest) setTab(reviewRequest.tab === 'materials' ? 'story' : reviewRequest.tab);
  }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(initial?.transcript !== null && initial?.transcript !== undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [draftEdited, setDraftEdited] = useState(false);
  // Reset only the editing fields on an explicit selection/reload; the scene stays mounted.
  if (editorKey !== resetKey) {
    setEditorKey(resetKey); setClearGeneratedModel(false); setSaved(initial); setFields(editable(initial, slotIndex));
    setSettingsOpen(false); setTranscriptOpen(initial?.transcript !== null && initial?.transcript !== undefined); setNote(''); setBusy(null); setError(null); setMessage(null); setAiDraft(null); setDraftEdited(false);
  }
  const dirty = clearGeneratedModel || JSON.stringify(fields) !== JSON.stringify(editable(saved, slotIndex));
  const disabled = blocked || busy !== null;
  const refreshGuard = useRef({ resetKey, dirty: false, disabled: false, exhibitId: saved?.id });
  useLayoutEffect(() => {
    refreshGuard.current = { resetKey, dirty: dirty || note.length > 0 || draftEdited, disabled, exhibitId: saved?.id };
  }, [resetKey, dirty, note, draftEdited, disabled, saved?.id]);
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

  function selectTab(next: Tab) {
    setTab(next);
    requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 900px)').matches) {
        document.getElementById(`${id}-tabs`)?.scrollIntoView({ block: 'start' });
      }
    });
  }
  function openGeneration() {
    setSettingsOpen(true);
    requestAnimationFrame(() => document.getElementById(`${id}-generation`)?.focus());
  }
  function focusField(key: string) {
    setTab(key === 'caption' ? 'confirmation' : 'story');
    setSettingsOpen(['slotIndex', 'modelKey', 'approximation', 'modelInput'].includes(key));
    if (key === 'transcript') setTranscriptOpen(true);
    requestAnimationFrame(() => {
      const target = document.getElementById(`${id}-${key === 'sourceSegments' ? 'rawStory' : key}-input`);
      let ancestor = target?.parentElement;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      target?.focus();
      target?.scrollIntoView({ block: 'center' });
    });
  }
  function goToMaterials(kind: 'image' | 'audio' = 'image') {
    setTab('story');
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLInputElement>(`#workbench-uploads input[aria-label="${kind === 'image' ? '上传旧物照片' : '上传原声录音'}"]`);
      target?.focus();
      target?.scrollIntoView({ block: 'center' });
    });
  }

  function change<K extends keyof Editable>(key: K, value: Editable[K]) {
    const next = { ...fields, [key]: value };
    setFields(next);
    onDirty(clearGeneratedModel || JSON.stringify(next) !== JSON.stringify(editable(saved, slotIndex)) || note.length > 0 || draftEdited);
    setMessage(null);
  }
  function pending(value: string | null) { setBusy(value); onBusy(value !== null); }
  async function acceptSaved(exhibit: ExhibitDraft, messageText: string, keepDraftEdits = draftEdited) {
    setClearGeneratedModel(false); setSaved(exhibit); setFields(editable(exhibit, slotIndex)); setNote('');
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
        ? updateExhibitInputSchema.parse({ ...values, ...(clearGeneratedModel ? { clearGeneratedModel: true } : {}), expectedVersion: saved.version })
        : createExhibitInputSchema.parse({ ...values, expectedMuseumVersion: museum.version });
      const result = await apiRequest(saved ? `${path}/${saved.id}` : path, exhibitDraftSchema, jsonRequest(saved ? 'PATCH' : 'POST', input));
      await acceptSaved(result, '草稿已保存。确认与发布由你分别决定。');
    } catch (failure) {
      setError(failure instanceof z.ZodError
        ? failure.issues.map((issue) => `${fieldLabels[String(issue.path[0])] ?? '收录信息'}：${issue.message}`).join('；')
        : describeFailure(failure));
      if (failure instanceof z.ZodError) {
        const key = failure.issues[0]?.path[0];
        if (typeof key === 'string') focusField(key);
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
  async function refreshModel(exhibitId: string, signal: AbortSignal): Promise<boolean> {
    const key = resetKey;
    const refreshed = await apiRequest(`/api/museums/${museum.id}`, museumDraftSchema, { signal });
    const updated = refreshed.exhibits.find((exhibit) => exhibit.id === exhibitId);
    const current = refreshGuard.current;
    if (signal.aborted || current.resetKey !== key || current.exhibitId !== exhibitId || current.dirty || current.disabled) return false;
    if (!updated) throw new Error('旧物已被移除，请重新读取展馆。');
    setSaved(updated); setFields(editable(updated, slotIndex)); setClearGeneratedModel(false);
    // The guarded response already contains the entire museum; avoid a second unguarded read.
    onRefreshed(refreshed);
    return true;
  }
  async function adoptModel(jobId: string) {
    if (!saved) return;
    pending('采纳模型');
    setError(null);
    try {
      const updated = await apiRequest(`${path}/${saved.id}/model/jobs/${jobId}/adopt`, exhibitDraftSchema, jsonRequest('POST', { expectedVersion: saved.version }));
      setClearGeneratedModel(false); setSaved(updated); setFields(editable(updated, slotIndex)); onDirty(false);
      setMessage('模型已采纳，展柜将改为展示生成的模型；确认与发布仍需重新完成。');
      await onSaved(updated);
    } catch (error) { setError(describeFailure(error)); }
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
      setAiDraft(null); setDraftEdited(false); selectTab('confirmation');
    } catch (failure) { setError(describeFailure(failure)); }
    finally { pending(null); }
  }
  function dismissDraft() {
    if (draftEdited && !window.confirm('放弃这份尚未采纳的草稿修订？')) return;
    setAiDraft(null); setDraftEdited(false); onDirty(dirty || note.length > 0);
  }

  return <>
    {toolbar(<><span className="workbench-save-status" role="status">{saveStatus}</span><button className="wb-primary" type="submit" form={`${id}-form`} disabled={disabled || (!dirty && saved !== null)}>保存草稿</button></>)}
    <div className="workbench-toolbar"><span>{cabinetPosition(fields.slotIndex)}</span><h1>{fields.name || '未命名旧物'}</h1><span className="wb-badge">{confirmationLabel}</span></div>
    <Notice error={error} message={message} />
    <div id={`${id}-tabs`} className="workbench-tabs" role="tablist" aria-label="编辑步骤">{tabs.map((item, index) =>
      <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-controls={`${id}-${item.id}`}
        aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => selectTab(item.id)}
        onKeyDown={(event) => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          const target = tabs[next];
          if (target) { event.preventDefault(); selectTab(target.id); document.getElementById(`${id}-tab-${target.id}`)?.focus(); }
        }}>{item.label}</button>)}</div>
    {/* One editor and one cabinet stay mounted across mobile tabs. */}
    <form id={`${id}-form`} className="workbench-grid" onSubmit={save} noValidate>
      <OrnateFrame as="section" className="workbench-column workbench-navigation" id={`${id}-materials`} role="tabpanel" aria-labelledby={`${id}-tab-materials`} data-active={tab === 'materials'}>
        <header className="workbench-section-heading"><h2>展柜</h2><button type="button" className="wb-secondary workbench-generation-entry" disabled={disabled} aria-label="打开 3D 生成" onClick={openGeneration}>生成 3D 模型</button></header>
        {cabinet}
      </OrnateFrame>
      <OrnateFrame as="section" className="workbench-column workbench-archive" id={`${id}-story`} role="tabpanel" aria-labelledby={`${id}-tab-story`} data-active={tab === 'story'}>
        <header className="workbench-section-heading"><h2>旧物档案</h2><button type="button" className="wb-text-link" disabled={disabled} onClick={() => setSettingsOpen(true)}>展示设置</button></header>
        <fieldset disabled={disabled} className="workbench-fields">
          <div className="workbench-basic-fields">
            <Field label="旧物名称"><input id={`${id}-name-input`} required maxLength={80} value={fields.name} placeholder="填写旧物名称" onChange={(event) => change('name', event.target.value)} /></Field>
            <Field label="约略年代"><input id={`${id}-era-input`} required maxLength={80} value={fields.era} placeholder="年代不详可填年代待考" onChange={(event) => change('era', event.target.value)} /></Field>
          </div>
          <AssetFields key={resetKey} museumId={museum.id} photoAssetId={fields.photoAssetId} audioAssetId={fields.audioAssetId} busy={disabled}
            onAsset={(asset) => change(asset.kind === 'image' ? 'photoAssetId' : 'audioAssetId', asset.id)}
            onRemove={(kind) => change(kind === 'image' ? 'photoAssetId' : 'audioAssetId', null)}
            onBusy={(uploading) => pending(uploading ? '上传素材' : null)} onError={setError} />
          <div className="workbench-manuscript">
            <div className="workbench-manuscript-toolbar"><span>{Array.from(fields.rawStory).length + Array.from(fields.transcript ?? '').length} / 12000 字</span><button type="button" className="wb-text-link" aria-expanded={transcriptOpen} aria-controls={`${id}-transcript`} onClick={() => setTranscriptOpen(!transcriptOpen)}>＋ 录音转写文本</button><button type="button" className="wb-secondary brass-action" disabled={disabled || dirty || draftEdited || !saved || saved.sourceSegments.length === 0} onClick={generate}><span aria-hidden="true">✧ </span>{busy === '整理故事' ? '生成中…' : 'AI 整理故事'}</button></div>
            <div className="workbench-manuscript-paper">
              <div className="workbench-manuscript-title"><h3>{fields.name || '旧物的故事'}</h3><ConfirmationSeal /></div>
              <ObjectEngraving />
              <Field label="原始讲述" hint="原始讲述和录音文字分别保存，当前编辑器中两项合计最多 12000 字。"><textarea id={`${id}-rawStory-input`} className="workbench-story-input" rows={9} value={fields.rawStory} placeholder="记录与这件旧物有关的人、时间和经历。记不清的内容可保留不确定表述。" onChange={(event) => change('rawStory', event.target.value)} /></Field>
            </div>
          </div>
          <section className="workbench-draft-area" aria-label="AI 展签草稿">
            {aiDraft && saved ? <AiDraftPanel key={aiDraft.id} draft={aiDraft} saved={saved} busy={disabled} dirty={dirty} onAdopt={adopt}
              onDirty={(value) => { setDraftEdited(value); onDirty(dirty || note.length > 0 || value); }} onDismiss={dismissDraft} />
              : <p className="wb-hint">保存讲述后，可基于原文整理 60–120 字展签草稿与追问。</p>}
          </section>
          <div id={`${id}-transcript`} hidden={!transcriptOpen}><Field label="录音整理文本" hint="暂无自动转写，可粘贴或手工整理；与原始讲述分别保存。"><textarea id={`${id}-transcript-input`} rows={4} value={fields.transcript ?? ''} onChange={(event) => change('transcript', event.target.value || null)} /></Field></div>
          <Field label="素材来源与使用说明" hint="必填，随展品公开。"><textarea id={`${id}-sourceNotice-input`} required rows={1} value={fields.sourceNotice} placeholder="提供者及允许使用的范围" onChange={(event) => change('sourceNotice', event.target.value)} /></Field>
        </fieldset>
      </OrnateFrame>
      <OrnateFrame as="section" className="workbench-column workbench-review" id={`${id}-confirmation`} role="tabpanel" aria-labelledby={`${id}-tab-confirmation`} data-active={tab === 'confirmation'}>
        <header className="workbench-section-heading"><h2>展签预览</h2><span className="wb-badge">{confirmationLabel}</span></header>
        <OrnateFrame className="workbench-label-parchment">
          <div className="workbench-label-brand"><WaxSeal className={confirmed && !dirty && !photoMissing ? 'is-confirmed' : 'is-pending'} /><span>拾物馆<small>THE MUSEUM OF LOST THINGS</small></span></div>
          <div className="workbench-label-identity"><h3>{fields.name || '未命名旧物'}</h3><p>{fields.era || '年代待考'}</p></div>
          <Field label="公开展签 · 可直接修订"><textarea id={`${id}-caption-input`} className="workbench-caption-input" rows={7} disabled={disabled} value={fields.caption}
            aria-invalid={captionLength > 120} aria-describedby={`${id}-caption-count`} placeholder="写下展签，或采纳故事草稿后修订。" onChange={(event) => change('caption', event.target.value)} /></Field>
          <p id={`${id}-caption-count`} className={`workbench-count ${captionLength > 120 ? 'wb-error' : ''}`}>{captionLength} / 120 字</p>
          <blockquote className="workbench-label-quote"><span aria-hidden="true">“</span><p>{fields.caption.trim() ? Array.from(fields.caption.trim().split(/[。！？\n]/u)[0] ?? '').slice(0, 42).join('') : '等待你为旧物留下记忆。'}</p></blockquote>
          <ObjectEngraving />
        </OrnateFrame>
        {photoMissing && <p className="wb-hint" role="status">{displayPhotoRequiredMessage}<button type="button" className="wb-text-link" onClick={() => goToMaterials()}>补充实拍照片</button></p>}
        {confirmed && !dirty && !photoMissing ? <div className="workbench-confirmed"><ConfirmationSeal /><p>当前版本已确认<span>{saved.confirmationNote}</span></p></div>
          : <div className="workbench-fields workbench-confirm-fields"><Field label="确认备注"><textarea rows={1} value={note} disabled={disabled || !saved} placeholder="记录核对结果" onChange={(event) => { setNote(event.target.value); onDirty(dirty || draftEdited || event.target.value.length > 0); }} /></Field>
            <button type="button" className="wb-primary wb-full workbench-seal-action" disabled={disabled || dirty || draftEdited || !saved || !note.trim() || photoMissing || captionLength === 0 || captionLength > 120} onClick={confirm}><WaxSeal /><span>确认当前版本 →</span></button>
            <p className="wb-hint">{!saved || dirty ? '请先保存当前修改。' : draftEdited ? '请先采纳或放弃草稿修订。' : '确认范围包含展签、展示方式及素材；公开内容修改后需重新确认。'}</p></div>}
        {saved && <button type="button" className="wb-text-link wb-danger workbench-remove" disabled={disabled} onClick={remove}>移除旧物草稿</button>}
      </OrnateFrame>
    </form>
    <WorkbenchDialog open={settingsOpen} title="展示设置" onClose={() => setSettingsOpen(false)}>
      <fieldset disabled={disabled} className="workbench-fields">
        <Field label="柜格位置"><select id={`${id}-slotIndex-input`} value={fields.slotIndex} onChange={(event) => change('slotIndex', Number(event.target.value))}>{availablePositions.map((index) => <option key={index} value={index} disabled={museum.exhibits.some((item) => item.slotIndex === index && item.id !== saved?.id)}>{cabinetPosition(index)}</option>)}</select></Field>
        <Field label="当前展示方式"><select id={`${id}-modelKey-input`} value={saved?.generatedModelAssetId && !clearGeneratedModel ? 'generated' : fields.modelKey} onChange={(event) => {
          const generated = event.target.value === 'generated';
          const clear = Boolean(saved?.generatedModelAssetId) && !generated;
          const next = generated ? fields : { ...fields, modelKey: modelKeySchema.parse(event.target.value) };
          setClearGeneratedModel(clear); setFields(next); setMessage(null);
          onDirty(clear || JSON.stringify(next) !== JSON.stringify(editable(saved, slotIndex)) || note.length > 0 || draftEdited);
        }}>{saved?.generatedModelAssetId && <option value="generated">已采纳的生成模型</option>}<option value="photo-plane">实拍照片平面展示</option><option value="camera-01">复古相机 · 内置演示模型</option><option value="cassette">手录磁带 · 内置演示模型</option><option value="ticket">旧车票 · 内置演示模型</option></select></Field>
        <Field label="展示近似程度" hint="与展示方式保持一致，不将照片平面或演示模型描述为精确复原。"><textarea id={`${id}-approximation-input`} required rows={3} value={fields.approximation} onChange={(event) => change('approximation', event.target.value)} /></Field>
        <div id={`${id}-generation`} tabIndex={-1} className="workbench-generation-panel"><ModelGenerationFields museumId={museum.id} exhibitId={saved?.id ?? null} exhibitVersion={saved?.version ?? null} generatedModelAssetId={saved?.generatedModelAssetId ?? null} onRefresh={refreshModel} dirty={dirty || note.length > 0 || draftEdited} input={fields.modelInput} photoAssetId={fields.photoAssetId} disabled={disabled} onChange={(input) => change('modelInput', input)} onBusy={(uploading) => pending(uploading ? '上传建模照片' : null)} onError={setError} onAdopt={adoptModel} /></div>
        <Notice error={error} message={message} />
        <button type="submit" form={`${id}-form`} className="wb-primary" disabled={disabled}>保存旧物草稿</button>
      </fieldset>
    </WorkbenchDialog>
  </>;
}
