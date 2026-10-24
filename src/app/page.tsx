import Link from 'next/link';
import { HomeCabinetStage } from '../features/cabinet/home-stage';
import { AngleViewer } from '../features/studio/angle-viewer';

const HERO_BG = 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1800&q=60';
const CARD_CAMERA = 'https://images.unsplash.com/photo-1510127034890-ba27508e9f1c?auto=format&fit=crop&w=1100&q=70';
const CARD_MEMORIES = 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=1100&q=70';
const CTA_BG = 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1800&q=60';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#100D0A] text-[#F0E8DA]">
      {/* ── 首屏：导航悬浮于暗调场景之上 ── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" aria-hidden="true">
          <img src={HERO_BG} alt="" className="h-full w-full object-cover opacity-[0.22]" style={{ filter: 'sepia(.4) brightness(.55) contrast(.92) saturate(.8) blur(3px)', transform: 'scale(1.06)' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(90% 65% at 70% 22%, rgba(200,165,107,.1), transparent 62%), linear-gradient(180deg, rgba(16,13,10,.8) 0%, rgba(16,13,10,.32) 44%, #100D0A 100%)' }} />
          <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 180px 50px rgba(8,6,4,.75)' }} />
        </div>

        <header className="relative z-10 border-b border-[#C8A56B]/15">
          <div className="mx-auto flex max-w-[1360px] items-center gap-5 px-5 py-4 sm:px-10">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 flex-none rotate-[-2deg] grid-cols-2 grid-rows-2 gap-0.5 rounded-md bg-[#A62B2B] p-[5px] shadow-[inset_0_0_0_1.5px_rgba(243,236,225,.4),0_6px_14px_-6px_rgba(166,43,43,.7)]" aria-hidden="true">
                <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
                <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
              </span>
              <span className="flex flex-col leading-tight">
                <b className="font-serif text-xl font-semibold tracking-[.14em]">旧物博物馆</b>
                <span className="text-[10px] tracking-[.3em] text-[#7A6C5B]">MEMORIES MUSEUM</span>
              </span>
            </div>
            <p className="hidden border-l border-[#C8A56B]/30 pl-6 text-[12.5px] leading-8 text-[#B7A994] md:block">收藏平凡的日子<br />也收藏独一无二的你</p>
            <nav className="ml-auto flex items-center gap-5" aria-label="主导航">
              <a href="#cabinet" aria-current="page" className="relative pb-1 text-sm text-[#F0E8DA] after:absolute after:left-1/2 after:-bottom-0.5 after:h-0.5 after:w-6 after:-translate-x-1/2 after:rounded after:bg-gradient-to-r after:from-[#E1C58E] after:to-[#C2A36B]">首页</a>
              <a href="#how" className="hidden pb-1 text-sm text-[#B7A994] hover:text-[#F0E8DA] sm:block">关于我们</a>
              <a href="#cabinet" className="hidden pb-1 text-sm text-[#B7A994] hover:text-[#F0E8DA] sm:block">展柜欣赏</a>
              <a href="#stories" className="hidden pb-1 text-sm text-[#B7A994] hover:text-[#F0E8DA] sm:block">故事投稿</a>
              <span className="hidden h-6 w-px bg-[#3A2D20] sm:block" aria-hidden="true" />
              <Link href="/login" className="rounded-full bg-gradient-to-b from-[#E1C58E] to-[#C2A36B] px-5 py-2 text-sm font-medium text-[#2B2014] shadow-[inset_0_1px_0_rgba(255,250,235,.5)] hover:brightness-105">开始收藏 →</Link>
            </nav>
          </div>
        </header>

        <div className="relative z-10 mx-auto grid max-w-[1360px] items-center gap-10 px-5 py-16 sm:px-10 lg:grid-cols-[42fr_58fr] lg:py-20">
          <div>
            <p className="text-sm leading-9 tracking-[.42em] text-[#B7A994]">每一件旧物<br />都是一段走过的时光</p>
            <h1 className="mt-6 font-serif text-[54px] font-semibold leading-[1.26] tracking-[.04em] text-[#F0E8DA] lg:text-[68px]" style={{ textShadow: '0 0 44px rgba(225,197,142,.3), 0 2px 2px rgba(0,0,0,.55)' }}>数字旧物博物馆</h1>
            <p className="mt-6 max-w-[27em] text-base leading-[2.1] text-[#B7A994]">在这里，旧物不再被遗忘。<br />用数字的方式，收藏生活的温度，<br />让时光的痕迹，依然被看见。</p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/login" className="rounded-full bg-gradient-to-b from-[#E1C58E] to-[#C2A36B] px-8 py-3 font-medium tracking-[.08em] text-[#2B2014] shadow-[inset_0_1px_0_rgba(255,250,235,.5),0_16px_34px_-16px_rgba(200,165,107,.7)] hover:brightness-105">开始收藏 →</Link>
              <a href="#cabinet" className="rounded-full border border-[#C8A56B]/55 bg-[#16100B]/60 px-8 py-3 tracking-[.08em] text-[#F0E8DA] hover:border-[#C8A56B]">浏览展柜</a>
            </div>
          </div>

          <div id="cabinet">
            <HomeCabinetStage />
            <p className="mt-4 text-center text-xs tracking-[.1em] text-[#7A6C5B]">六格展柜 · 点击展品可取出、旋转与放回 · 三个空位等待收藏，信件展品筹备中</p>
          </div>
        </div>

        <div className="relative z-10 mx-auto flex max-w-[1360px] items-center justify-between gap-4 border-t border-[#C8A56B]/20 px-5 py-4 text-[11.5px] tracking-[.28em] text-[#7A6C5B] sm:px-10">
          <span>PRESERVE ORDINARY DAYS</span>
          <span className="flex items-center gap-3">01 <i className="inline-block h-px w-14 bg-[#7A6C5B]" aria-hidden="true" /> 04</span>
        </div>
      </div>

      {/* ── 双栏模式介绍 ── */}
      <section className="border-y border-[#C8A56B]/15 bg-[#19140F]">
        <div className="mx-auto grid max-w-[1360px] gap-6 px-5 py-14 sm:px-10 md:grid-cols-2 lg:py-20">
          <article className="relative flex min-h-[360px] items-center overflow-hidden rounded-xl border border-[#3A2D20] bg-[#211912]">
            <img src={CARD_CAMERA} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: 'sepia(.3) contrast(1.07) brightness(.8)' }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #17120D 30%, rgba(23,18,13,.4) 78%, rgba(23,18,13,.2) 100%)' }} />
            <div className="relative max-w-[30em] p-8 sm:p-10">
              <span className="grid h-9 w-9 rotate-[-2deg] grid-cols-2 grid-rows-2 gap-0.5 rounded bg-[#A62B2B] p-1 shadow-[inset_0_0_0_1.5px_rgba(243,236,225,.4)]" aria-hidden="true">
                <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
                <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
              </span>
              <h2 className="mt-5 font-serif text-[28px] font-semibold tracking-[.08em] sm:text-3xl">个人展柜</h2>
              <p className="mt-2 text-sm tracking-[.12em] text-[#C8A56B]">安放属于你的旧物故事</p>
              <p className="mt-4 text-[14.5px] leading-[2.05] text-[#B7A994]">为每一件旧物建立专属的数字展柜，<br />记录它的来历、岁月与心情，<br />在这里，你的回忆被温柔保存。</p>
              <Link href="/login" className="mt-6 inline-flex items-center gap-3 text-[14.5px] tracking-[.1em] text-[#F0E8DA]">
                <i className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-b from-[#E1C58E] to-[#C2A36B] font-serif not-italic text-[#2B2014] shadow-[0_8px_18px_-8px_rgba(200,165,107,.8)] transition-transform hover:translate-x-1">→</i>开始创建展柜
              </Link>
            </div>
            <div className="pointer-events-none absolute bottom-3 right-6 text-right font-serif text-[#F3ECE1]/10" aria-hidden="true">
              <b className="block text-6xl font-semibold leading-none">01</b><span className="text-[11px] tracking-[.32em]">MY COLLECTION</span>
            </div>
          </article>

          <article className="relative flex min-h-[360px] items-center overflow-hidden rounded-xl border border-[#3A2D20] bg-[#211912]">
            <img src={CARD_MEMORIES} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: 'sepia(.32) contrast(1.05) brightness(.78)' }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #17120D 30%, rgba(23,18,13,.42) 78%, rgba(23,18,13,.22) 100%)' }} />
            <div className="relative max-w-[30em] p-8 sm:p-10">
              <span className="grid h-9 w-9 rotate-[-2deg] grid-cols-2 grid-rows-2 gap-0.5 rounded bg-[#A62B2B] p-1 shadow-[inset_0_0_0_1.5px_rgba(243,236,225,.4)]" aria-hidden="true">
                <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
                <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
              </span>
              <h2 className="mt-5 font-serif text-[28px] font-semibold tracking-[.08em] sm:text-3xl">共同纪念</h2>
              <p className="mt-2 text-sm tracking-[.12em] text-[#C8A56B]">看见他人的时光，也照见自己的</p>
              <p className="mt-4 text-[14.5px] leading-[2.05] text-[#B7A994]">在这里，遇见别人的旧物与故事，<br />那些看似平凡的物件，<br />也许正承载着与你相似的时光。</p>
              <Link href="/login" className="mt-6 inline-flex items-center gap-3 text-[14.5px] tracking-[.1em] text-[#F0E8DA]">
                <i className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-b from-[#E1C58E] to-[#C2A36B] font-serif not-italic text-[#2B2014] shadow-[0_8px_18px_-8px_rgba(200,165,107,.8)] transition-transform hover:translate-x-1">→</i>浏览展柜故事
              </Link>
            </div>
            <div className="pointer-events-none absolute bottom-3 right-6 text-right font-serif text-[#F3ECE1]/10" aria-hidden="true">
              <b className="block text-6xl font-semibold leading-none">02</b><span className="text-[11px] tracking-[.32em]">OUR MEMORIES</span>
            </div>
          </article>
        </div>
      </section>

      {/* ── 检视体验 ── */}
      <section id="how" className="bg-[#100D0A]">
        <div className="mx-auto grid max-w-[1360px] items-center gap-10 px-5 py-16 sm:px-10 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="text-[11.5px] tracking-[.34em] text-[#7A6C5B]">HOW IT WORKS</p>
            <h2 className="mt-4 font-serif text-3xl font-semibold leading-[1.42] sm:text-4xl">从安放到检视，<br />让旧物重新被看见</h2>
            <p className="mt-5 max-w-[30em] text-[15px] leading-[2.1] text-[#B7A994]">不只是保存，更是一场与记忆的再次相遇。<br />通过沉浸式的展柜体验，感受旧物背后的故事与温度。</p>
            <ol className="mt-10 flex flex-wrap items-start gap-2.5">
              {[
                { no: '01', title: '安放', lines: ['上传旧物', '建立专属展柜'] },
                { no: '02', title: '聚焦', lines: ['记录细节', '补充故事背景'] },
                { no: '03', title: '检视', lines: ['沉浸式查看', '360°细节欣赏'], hot: true },
                { no: '04', title: '收回', lines: ['将记忆珍藏', '随时重温'] },
              ].map((step, index) => (
                <li key={step.no} className="contents">
                  <div className="grid justify-items-start gap-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className={`grid h-10 w-10 flex-none place-items-center rounded-full border font-serif text-[13px] ${step.hot ? 'border-transparent bg-gradient-to-b from-[#E1C58E] to-[#C2A36B] text-[#2B2014] shadow-[0_10px_24px_-12px_rgba(200,165,107,.85),inset_0_1px_0_rgba(255,250,235,.5)]' : 'border-[#3A2D20] bg-[#211912]/60 text-[#B7A994]'}`}>{step.no}</span>
                      <b className="text-[15px] font-medium tracking-[.08em] text-[#F0E8DA]">{step.title}</b>
                    </span>
                    <small className="text-xs leading-[1.8] text-[#7A6C5B]">{step.lines[0]}<br />{step.lines[1]}</small>
                  </div>
                  {index < 3 && <span className="pt-2.5 font-serif text-[#7A6C5B]" aria-hidden="true">→</span>}
                </li>
              ))}
            </ol>
            <blockquote className="relative mt-10 max-w-[34em] rounded-xl border border-[#3A2D20] bg-[#211912]/50 px-7 pb-5 pt-6">
              <span className="absolute -top-7 left-4 font-serif text-7xl leading-none text-[#C8A56B] opacity-80" aria-hidden="true">“</span>
              <p className="text-[15px] leading-[2.1]">旧物的意义，不在于它的价值，<br />而在于它曾陪伴我们走过怎样的时光。</p>
              <div className="mt-2 text-right text-[13px] text-[#7A6C5B]">—— 旧物博物馆</div>
            </blockquote>
          </div>

          <div>
            <AngleViewer />
          </div>
        </div>
      </section>

      {/* ── 底部引导 ── */}
      <section id="stories" className="relative overflow-hidden border-t border-[#C8A56B]/15 bg-[#19140F]">
        <div className="absolute inset-0" aria-hidden="true">
          <img src={CTA_BG} alt="" className="h-full w-full scale-105 object-cover opacity-25" style={{ filter: 'sepia(.4) brightness(.46) saturate(.75) blur(1.5px)' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(56% 110% at 50% 128%, rgba(225,197,142,.18), transparent 58%), linear-gradient(180deg, rgba(16,13,10,.62), rgba(16,13,10,.85))' }} />
        </div>
        <div className="relative mx-auto grid max-w-[1360px] items-center gap-8 px-5 py-16 text-center sm:px-10 md:grid-cols-[1fr_auto_1fr] md:text-left lg:py-20">
          <p className="font-serif text-[13px] leading-[2.1] tracking-[.4em] text-[#C8A56B]/40">LET MEMORIES<br />LIVE LONGER</p>
          <div>
            <h2 className="font-serif text-3xl font-semibold tracking-[.1em] sm:text-4xl" style={{ textShadow: '0 0 30px rgba(225,197,142,.22)' }}>从今天开始，整理你的旧物</h2>
            <p className="mt-3 text-[14.5px] text-[#B7A994]">让那些被时光珍藏的瞬间，在这里继续发光。</p>
          </div>
          <div className="grid justify-items-center gap-3 md:justify-self-end">
            <Link href="/login" className="rounded-full bg-gradient-to-b from-[#E1C58E] to-[#C2A36B] px-8 py-3 font-medium tracking-[.08em] text-[#2B2014] shadow-[inset_0_1px_0_rgba(255,250,235,.5),0_16px_34px_-16px_rgba(200,165,107,.7)] hover:brightness-105">开始收藏 →</Link>
            <small className="text-xs tracking-[.12em] text-[#7A6C5B]">创建你的第一个数字展柜</small>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#C8A56B]/15 bg-[#100D0A]">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[12.5px] text-[#7A6C5B] sm:px-10">
          <span className="font-serif tracking-[.14em] text-[#B7A994]">旧物博物馆 MEMORIES MUSEUM</span>
          <span>收藏平凡的日子 · 也收藏独一无二的你</span>
          <span>首版制作中</span>
        </div>
      </footer>
    </main>
  );
}
