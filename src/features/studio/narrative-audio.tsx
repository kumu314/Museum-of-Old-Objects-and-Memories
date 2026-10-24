import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

function clock(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export function NarrativeAudio({ src, disabled }: { src: string | null; disabled: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const element = audio.current; return () => { element?.pause(); }; }, []);
  function updateDuration(event: SyntheticEvent<HTMLAudioElement>) {
    const seconds = event.currentTarget.duration;
    if (Number.isFinite(seconds)) setDuration(seconds);
  }
  async function toggle() {
    if (!audio.current || !src) return;
    setError(null);
    if (!audio.current.paused) { audio.current.pause(); return; }
    try { await audio.current.play(); } catch { setError('原声暂时无法播放，请重试或替换录音。'); }
  }
  return <div className="workbench-audio-player">
    <button type="button" className="workbench-audio-play" disabled={disabled || !src} aria-label={playing ? '暂停原声' : '播放原声'} onClick={toggle}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zm8 0h4v16h-4Z"/> : <path d="m8 4 13 8-13 8Z"/>}</svg>
    </button>
    <div className="workbench-wave-track" data-playing={playing} data-empty={!src}>
      <svg className="workbench-waveform" viewBox="0 0 520 60" preserveAspectRatio="none" aria-hidden="true">
        {Array.from({ length: 87 }, (_, index) => {
          const height = 3 + Math.abs(Math.sin(index * 1.9)) * (10 + 40 * Math.pow(Math.sin(index * .065), 6));
          return <path key={index} d={`M${index * 6 + 2} ${30 - height / 2}v${height}`} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>;
        })}
      </svg>
      <div className="workbench-audio-time"><span>{clock(elapsed)} / {clock(duration)}</span><span>{src ? '原声录音' : '等待一段旧物的声音'}</span></div>
      {src && <input className="workbench-audio-seek" type="range" aria-label="原声播放进度" min={0} max={duration || 0} step={.1} value={elapsed} disabled={disabled || !duration} onChange={(event) => { if (audio.current) { audio.current.currentTime = Number(event.target.value); setElapsed(Number(event.target.value)); } }}/>}
    </div>
    {src && <audio ref={audio} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)} onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
      onError={() => setError('录音读取失败，可重新上传或替换。')} />}
    {error && <p className="wb-hint" role="alert">{error}</p>}
  </div>;
}
