'use client';

import { useState } from 'react';

const CAMERA = 'https://images.unsplash.com/photo-1510127034890-ba27508e9f1c?auto=format&fit=crop&w=1000&h=1000&q=78';
const VIEWS = [
  { label: '角度一', pos: '50% 50%', crop: 'w=1000&h=1000&q=78' },
  { label: '角度二', pos: '16% 34%', crop: 'w=1000&h=1000&q=78&crop=entropy' },
  { label: '角度三', pos: '84% 62%', crop: 'w=1000&h=1000&q=78&crop=edges' },
  { label: '角度四', pos: '50% 88%', crop: 'w=1000&h=1000&q=78&flipv' },
] as const;

export function AngleViewer() {
  const [active, setActive] = useState(0);
  const view = VIEWS[active] ?? VIEWS[0];
  return <div className="grid grid-cols-[1fr_auto] items-stretch gap-4">
    <div className="relative grid place-items-center overflow-hidden rounded-xl border border-[#3A2D20] aspect-[1.06/1]"
      style={{ background: 'radial-gradient(85% 62% at 50% 16%, rgba(225,197,142,.18), transparent 60%), radial-gradient(120% 60% at 50% 112%, rgba(58,45,26,.45), transparent 60%), linear-gradient(180deg, #1D160F 0%, #140F0A 100%)', boxShadow: 'inset 0 0 90px rgba(0,0,0,.65)' }}>
      <img src={`${CAMERA.replace(/w=\d+&h=\d+&q=78/, view.crop)}`} alt="展柜中的复古相机，可从不同角度检视" className="w-[70%] aspect-square rounded-lg object-cover"
        style={{ filter: 'sepia(.45) contrast(1.15) brightness(.62) saturate(.85)', objectPosition: view.pos, boxShadow: '0 40px 64px -26px rgba(0,0,0,.95), 0 0 0 1px rgba(200,165,107,.16)' }} />
      <span className="absolute bottom-[8%] left-1/2 h-9 w-[60%] -translate-x-1/2 rounded-[50%]" aria-hidden="true"
        style={{ background: 'radial-gradient(closest-side, #45331C 0%, #221507 72%)', boxShadow: '0 20px 34px -10px rgba(0,0,0,.9), inset 0 2px 0 rgba(200,165,107,.3)' }} />
      <span className="absolute left-[7%] top-[9%] -rotate-[4deg] font-serif text-[15px] tracking-[.16em]" aria-hidden="true">360° 检视</span>
      <span className="absolute bottom-[13%] right-[9%] font-serif text-[17px] tracking-[.1em] text-[#C8A56B]" aria-hidden="true">360°</span>
      <span className="pointer-events-none absolute h-[62%] w-[76%] rounded-[50%] border-[1.5px] border-dashed border-[#F3ECE1]/25 -rotate-12 border-t-[#F3ECE1]/30 border-l-[#F3ECE1]/45" aria-hidden="true" />
      <span className="pointer-events-none absolute h-[52%] w-[68%] rounded-[50%] border-[1.5px] border-dashed border-[#E1C58E]/40 rotate-12 border-r-[#E1C58E]/55" aria-hidden="true" />
    </div>
    <div className="grid justify-items-center gap-3" role="group" aria-label="相机不同角度">
      <span className="mb-1 text-[10.5px] tracking-[.26em] text-[#7A6C5B] [writing-mode:vertical-rl]">A CLOSER LOOK AT MEMORIES</span>
      {VIEWS.map((item, index) => (
        <button key={item.label} type="button" aria-pressed={index === active} aria-label={item.label}
          onClick={() => setActive(index)}
          className={`h-16 w-16 overflow-hidden rounded-lg border transition ${index === active ? 'border-[#C8A56B] opacity-100 shadow-[0_0_0_1px_#C8A56B,0_10px_22px_-12px_rgba(200,165,107,.75)]' : 'border-[#3A2D20] opacity-55 hover:opacity-90'}`}>
          <img src={`https://images.unsplash.com/photo-1510127034890-ba27508e9f1c?auto=format&fit=crop&w=160&h=160&q=70&${item.crop}`} alt="" className="h-full w-full object-cover" style={{ filter: 'sepia(.45) contrast(1.15) brightness(.6) saturate(.85)' }} />
        </button>
      ))}
    </div>
  </div>;
}
