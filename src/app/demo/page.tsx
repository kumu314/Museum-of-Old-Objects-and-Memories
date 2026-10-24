import Link from 'next/link';
import { requirePageUser } from '../../server/auth/page-user';
import styles from '../../features/direction1/demo.module.css';
import guide from './demo.module.css';

export const dynamic = 'force-dynamic';
export default async function DemoPage() {
  await requirePageUser();
  return <main className={styles.shell}>
    <header className={styles.header}><div><span className={styles.eyebrow}>拾物馆 / DIRECTION 01</span><h1>旧物之外，还有你的故事</h1></div><nav className={styles.nav}><Link href="/studio">我的工作台</Link></nav></header>
    <div className={styles.banner}><strong>方向一 · 可操作 DEMO</strong><br />「世界」与「自传」页面在当前标签页本地模拟，不写入真实展馆；标注「主仓库已有演示」的入口连接真实服务端，会真实保存。所有页面请只输入合成内容，AI 为明确标识的固定样例。</div>
    <div className={styles.cards}>
      <section className={[styles.card, guide.card].join(' ')}><span className={styles.eyebrow}>01 / 探索</span><h2>去世界看看</h2><p>搜索公开馆、关注账号、收藏展馆，体验留言与馆主管理。参观页可以检视内置 3D 旧物，打开一本演示自传。</p><Link className={styles.button} href="/world">进入世界 DEMO →</Link></section>
      <section className={[styles.card, guide.card].join(' ')}><span className={styles.eyebrow}>02 / 讲述</span><h2>把故事写成书</h2><p>选话题、保存回答、体验一个追问，再整理样例章节、编辑、核对来源，单独确认和授权公开。</p><Link className={styles.button} href="/memoir">进入自传 DEMO →</Link></section>
      <section className={[styles.card, guide.card].join(' ')}><span className={styles.eyebrow}>03 / 保管</span><h2>由自己决定</h2><p>章节许可可以撤销，资料可导出 Markdown / JSON 或删除。演示额度用完后仍可整理、编辑和导出。</p><Link className={styles.secondary} href="/memoir">查看资料与许可 →</Link></section>
      <section className={[styles.card, guide.card].join(' ')}><span className={styles.eyebrow}>04 / 主仓库已有演示</span><h2>记忆地图与浏览榜</h2><p>城市分布与累计榜读取真实服务端聚合；目前仅登记的演示账号可被收录，馆与内容均为合成资料。</p><Link className={styles.secondary} href="/discover">查看地图与榜单 DEMO →</Link></section>
      <section className={[styles.card, guide.card].join(' ')}><span className={styles.eyebrow}>05 / 主仓库已有演示</span><h2>共同作者与多人记忆</h2><p>体验邀请、独立署名、本人同意与撤回。这个入口连接真实服务端，草稿与撤回都会真实保存，请只输入合成内容。</p><Link className={styles.secondary} href="/coauthor">查看共同作者 DEMO →</Link></section>
    </div>
    <section className={styles.panel}><h2>建议这样走一遍</h2><ol><li>进入世界，参观“木盒里的四季”，检视旧相机并打开样例书。</li><li>进入自传，输入一句虚构回答，保存并整理样例章节，保存编辑稿、核对确认，再单独授权。</li><li>返回世界，参观“留声的房间”，打开刚授权的章节；回到自传撤销许可后，再确认书中已无公开正文。</li></ol><p className={styles.muted}>「世界」与「自传」演示的固定样例和标签页操作不会发布到真实展馆；「主仓库已有演示」入口的写入是真实服务端操作，请只用合成资料体验。</p></section>
  </main>;
}
