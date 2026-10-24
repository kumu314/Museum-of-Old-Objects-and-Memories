import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PublicExhibit } from '../../contracts/museum';
import type { SharedContribution } from '../../contracts/contributors';
import { authorLabel } from './shared-contributions';
import './inspection-ui.css';

type Story = Pick<PublicExhibit, 'name' | 'era' | 'caption' | 'approximation' | 'sourceNotice' | 'modelKey'>;

function timeLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function InspectionGuide() {
  return <div className="inspection-guide">
    <div className="inspection-guide__icons" aria-hidden="true">
      <svg viewBox="0 0 180 38" fill="none"><path d="M20 12C-12 25 37 35 88 35s101-10 73-23M20 12l-10 1 6 6m145-7 10 1-6 6" /></svg>
      <svg viewBox="0 0 28 30" fill="none"><circle cx="11" cy="11" r="8"/><path d="m17 17 8 10M7 11h8m-4-4v8"/></svg>
    </div>
    <p>拖动旋转 · 滚轮缩放</p>
    <span className="inspection-sr-only">触屏双指缩放，方向键旋转，加减键缩放，双击复位视角。</span>
  </div>;
}

export function ExhibitStory({ exhibit, photoUrl, audioUrl, active, contributions }: {
  exhibit: Story; photoUrl: string | null; audioUrl: string | null; active: boolean;
  /** 这件展品上已公开的多人讲述。空数组表示没人讲过，不是"加载失败"——失败在调用方就已经降级掉了。 */
  contributions: readonly SharedContribution[];
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoDetail, setPhotoDetail] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const element = audio.current;
    return () => { if (element) { element.pause(); element.currentTime = 0; } };
  }, []);
  useEffect(() => {
    if (!active) {
      if (audio.current) { audio.current.pause(); audio.current.currentTime = 0; }
      dialog.current?.close();
    }
  }, [active]);

  async function toggleAudio() {
    const element = audio.current;
    if (!element || !active) return;
    if (!element.paused) { element.pause(); return; }
    if (audioFailed) element.load();
    setAudioFailed(false);
    try { await element.play(); }
    catch (error: unknown) {
      // Switching exhibits or returning can cancel a pending play request.
      if (element.isConnected && !(error instanceof DOMException && error.name === 'AbortError')) setAudioFailed(true);
    }
  }
  function openPhoto(detail: boolean) {
    setPhotoDetail(detail);
    dialog.current?.showModal();
  }

  return <div className="exhibit-story">
    <h2 className="exhibit-story__title">{exhibit.name}</h2>
    <p className="exhibit-story__era">{exhibit.era}</p>
    <p className="exhibit-story__caption">{exhibit.caption}</p>
    <details className="exhibit-story__sources"><summary>模型为近似展示 · 查看说明</summary><p>{exhibit.approximation}</p><p>{exhibit.sourceNotice}</p>{exhibit.modelKey === 'photo-plane' && <p>三维展示为实拍照片薄片，背面为示意。</p>}</details>
    <div className="exhibit-audio" data-playing={playing}>
      <button className="exhibit-audio__play" type="button" disabled={audioUrl === null || !active} aria-label={playing ? '暂停物主原声' : '播放物主原声'} aria-pressed={playing} onClick={() => void toggleAudio()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M7 5h4v14H7zm6 0h4v14h-4z"/> : <path d="m8 5 12 7-12 7z"/>}</svg>
      </button>
      <div className="exhibit-audio__body">
        <p className="exhibit-audio__label">物主原声讲述{duration > 0 && ` · ${timeLabel(duration)}`}</p>
        <div className="exhibit-audio__timeline"><span>{timeLabel(elapsed)}</span><input type="range" min="0" max={duration || 1} step="0.1" value={elapsed} disabled={audioUrl === null || duration === 0 || !active} aria-label="原声播放进度" aria-valuetext={`${timeLabel(elapsed)}，共 ${timeLabel(duration)}`} style={{ '--audio-progress': `${duration > 0 ? elapsed / duration * 100 : 0}%` } as CSSProperties} onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (audio.current) { audio.current.currentTime = value; setElapsed(value); }
        }}/></div>
      </div>
      <div className="exhibit-audio__wave" aria-hidden="true">{[9, 16, 23, 13, 28, 19, 11, 23, 17, 26, 12].map((height, index) => <i key={index} style={{ height, animationDelay: `${index * -0.09}s` }}/>)}</div>
      {audioUrl === null && <p className="exhibit-media-note">此展品尚未提供原声。</p>}
      {audioFailed && <p className="exhibit-media-error" role="alert">原声暂时无法播放，请检查网络或核对分享状态后重试。</p>}
      {audioUrl !== null && <audio ref={audio} src={audioUrl} preload="metadata" onLoadedMetadata={(event) => {
        const value = event.currentTarget.duration;
        if (Number.isFinite(value)) setDuration(value);
      }} onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setAudioFailed(true)} />}
    </div>
    {contributions.length > 0 && <details className="exhibit-contributions">
      <summary>多人讲述 · {contributions.length} 份</summary>
      <ol className="exhibit-contributions__list">
        {contributions.map((item) => <li key={item.id}>
          <p className="exhibit-contributions__byline"><span className="exhibit-contributions__author">{item.authorName}</span><span className="exhibit-contributions__role" data-role={item.authorRole}>{authorLabel(item.authorRole)}</span></p>
          <p className="exhibit-contributions__story">{item.story}</p>
          <p className="exhibit-contributions__source">来源 · {item.sourceNote}</p>
        </li>)}
      </ol>
      <p className="exhibit-contributions__note">每份讲述各自署名、各自授权，不做合并，也不生成共同摘要；作者撤回后，重新读取时不再显示。</p>
    </details>}
    <div className="exhibit-photos">
      {photoUrl !== null && !photoFailed ? <>
        <div className="exhibit-photos__grid">
          <button type="button" className="exhibit-photos__print" aria-label={`放大${exhibit.name}的实拍全图`} onClick={() => openPhoto(false)}><div className="exhibit-photos__frame"><StoryImage src={photoUrl} alt={`${exhibit.name}的实拍`} onError={() => setPhotoFailed(true)}/></div></button>
          <button type="button" className="exhibit-photos__print exhibit-photos__detail" aria-label={`放大${exhibit.name}的局部，同一实拍裁切`} onClick={() => openPhoto(true)}><div className="exhibit-photos__frame"><StoryImage src={photoUrl} alt="同一实拍的局部裁切" onError={() => setPhotoFailed(true)}/></div><span>局部 · 同一实拍裁切</span></button>
        </div>
        <button type="button" className="exhibit-photos__original" onClick={() => openPhoto(false)}>查看实拍原图 <span aria-hidden="true">›</span></button>
      </> : <>
        <div className="exhibit-photos__grid" aria-hidden="true"><div className="exhibit-photos__empty">正面实拍<span>尚未提供</span></div><div className="exhibit-photos__empty">细节实拍<span>尚未提供</span></div></div>
        {photoFailed ? <p className="exhibit-media-error" role="alert">实拍暂时无法读取。<button type="button" onClick={() => setPhotoFailed(false)}>重试实拍</button></p> : <p className="exhibit-media-note">此展品尚未提供实拍，接入后可放大查看。</p>}
      </>}
    </div>
    {photoUrl !== null && <dialog className="exhibit-photo-dialog" ref={dialog} aria-label={`${exhibit.name}的实拍大图`} onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button type="button" className="exhibit-photo-dialog__close" autoFocus onClick={() => dialog.current?.close()}>关闭实拍 <span aria-hidden="true">×</span></button>
      {photoFailed ? <p role="alert">实拍暂时无法读取，请关闭后重试。</p> : <div className="exhibit-photo-dialog__image" data-detail={photoDetail}><StoryImage src={photoUrl} alt={`${exhibit.name}的${photoDetail ? '局部裁切' : '实拍全图'}`} onError={() => setPhotoFailed(true)}/></div>}
      <p>{photoDetail ? '局部 · 同一实拍裁切' : '实拍全图'} · 展示经隐私处理的照片</p>
    </dialog>}
  </div>;
}

// Authenticated, revocable asset URLs are shared with the standalone Vite viewer.
function StoryImage({ src, alt, onError }: { src: string; alt: string; onError: () => void }) {
  // eslint-disable-next-line @next/next/no-img-element -- This component also runs outside Next; image requests must use the authorized asset URL directly.
  return <img src={src} alt={alt} width={960} height={960} decoding="async" onError={onError}/>;
}
