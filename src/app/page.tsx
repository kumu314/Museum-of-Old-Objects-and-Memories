import Image from 'next/image';
import { OrnateFrame } from '../features/ornaments/ornate-frame';
import { FloatingDust } from '../features/ornaments/floating-dust';
import { Brand } from '../features/navigation/brand';
import Link from '../features/navigation/navigation-link';
import { HomeCabinetStage } from '../features/cabinet/home-stage';
import { DeferredCameraStage } from '../features/cabinet/deferred-camera-stage';
import memoriesImage from '../features/cabinet/assets/memories-letters.webp';
import cameraImage from '../features/cabinet/assets/collector-camera.webp';
import './wunderkammer-home.css';

export default function Home() {
  return <main className="lacquer-home wunderkammer-home">
    <FloatingDust />
    <section className="museum-hero">
      <div className="museum-tyndall museum-tyndall--window" aria-hidden="true"><i /><i /><i /></div>
      <header className="museum-header">
        <div className="museum-width museum-header__inner">
          <Link href="/" aria-label="拾物馆首页"><Brand /></Link>
          <nav aria-label="主导航">
            <a href="#cabinet" aria-current="page">首页</a><a href="#explore">关于我们</a><a href="#how">展览欣赏</a><a href="#stories">故事投稿</a>
          </nav>
        </div>
      </header>
      <div className="museum-width museum-hero__body">
        <div className="museum-hero__copy">
          <p className="museum-kicker museum-hero__preface">每一件旧物<br />都是一段走过的时光</p>
          <h1>拾起时光，<br />让记忆重现</h1>
          <p className="museum-hero__signature" lang="en">The Museum of Lost Things</p>
          <p className="museum-description">在这里，旧物不再被遗忘。<br />用数字的方式，收藏生活的温度，<br />让时光的痕迹，依然被看见。</p>
          <div className="museum-actions"><Link href="/studio" className="museum-gold-button">开始收藏 <span aria-hidden="true">→</span></Link><a href="#cabinet" className="museum-outline-button">浏览展柜</a></div>
          <div className="museum-hero__folio" aria-hidden="true"><span>01</span><i /><span>时光藏室</span></div>
        </div>
        <div id="cabinet" className="museum-hero__cabinet">
          <div className="museum-cabinet-crest" aria-hidden="true"><span>拾 物 馆</span><small>THE MUSEUM OF LOST THINGS</small></div>
          <HomeCabinetStage />
          <p className="museum-stage-caption">六格展柜 · 点击旧物，取出检视</p>
          <p className="museum-stage-note">内置演示藏品 · 两个空位等待收藏</p>
        </div>
      </div>
    </section>
    <section id="explore" className="museum-explore museum-section">
      <div className="museum-width">
        <div className="museum-section-heading"><div><h2>探索更多可能</h2><p className="museum-kicker">EXPLORE MORE</p></div><i aria-hidden="true" /><p>在数字世界，为旧物建立永恒的展柜，<br />让每一段平凡的经历，都值得被珍藏。</p></div>
        <div className="museum-collection-grid">
          <OrnateFrame as="article" className="home-collection-card museum-collection-card">
            <Image src={cameraImage} alt="" fill sizes="(max-width: 760px) 100vw, 50vw" className="museum-collection-image" />
            <div className="museum-collection-shade" aria-hidden="true" />
            <div className="museum-collection-copy"><span className="museum-collection-number">01</span><h3>创建个人展柜</h3><p>为每一件旧物建立专属的数字展柜，<br />记录它的来历、岁月与心情，<br />在这里，你的回忆被温柔保存。</p><Link href="/studio" className="museum-card-link"><span aria-hidden="true">→</span>开始创建展柜</Link></div>
            <small className="museum-card-footer" aria-hidden="true">CREATE<br />YOUR COLLECTIONS</small>
          </OrnateFrame>
          <OrnateFrame as="article" className="home-collection-card museum-collection-card">
            <Image src={memoriesImage} alt="" fill sizes="(max-width: 760px) 100vw, 50vw" className="museum-collection-image" />
            <div className="museum-collection-shade" aria-hidden="true" />
            <div className="museum-collection-copy"><span className="museum-collection-number">02</span><h3>共同纪念</h3><p>看见他人的时光，也照见自己的。<br />将旧物与故事安放在展柜中，<br />确认后，分享给同样珍惜它的人。</p><Link href="/studio" className="museum-card-link"><span aria-hidden="true">→</span>整理我的旧物故事</Link></div>
            <small className="museum-card-footer" aria-hidden="true">PRESERVE<br />YOUR MEMORIES</small>
          </OrnateFrame>
        </div>
      </div>
    </section>
    <section id="how" className="museum-inspection museum-section">
      <div className="museum-width museum-inspection__inner">
        <div className="museum-inspection__copy"><p className="museum-kicker">HOW IT WORKS</p><h2>从安放到检视，<br />让旧物重新被看见</h2><p className="museum-description">不只是保存，更是一场与记忆的再次相遇。<br />通过沉浸式的展柜体验，感受旧物背后的<br className="museum-desktop-break" />故事与温度。</p><a href="#camera-inspection" className="museum-gold-button">探索 360° 检视 <span aria-hidden="true">→</span></a><ol className="museum-journey"><li><span>01</span><b>安放</b><small>上传与记录</small></li><li><span>02</span><b>检视</b><small>旋转看细节</small></li><li><span>03</span><b>珍藏</b><small>确认后分享</small></li></ol></div>
        <div id="camera-inspection" className="museum-inspection__stage"><div className="museum-tyndall museum-tyndall--spotlight" aria-hidden="true"><i /><i /></div><DeferredCameraStage /></div>
      </div>
    </section>
    <section id="stories" className="museum-stories museum-section"><div className="museum-width museum-stories__inner"><div><p className="museum-kicker">EVERY OBJECT HOLDS A STORY</p><h2>下一件珍藏，是你的故事</h2><p className="museum-description">一张旧照片，一段熟悉的声音。<br />从今天开始，让记忆有处安放。</p></div><Link href="/studio" className="museum-gold-button">创建我的展柜 <span aria-hidden="true">→</span></Link></div></section>
    <footer className="museum-footer museum-width"><span>拾物馆 <small>MEMORIES MUSEUM</small></span><p>收藏平凡的日子 · 也收藏独一无二的你</p><small>首版制作中</small></footer>
  </main>;
}
