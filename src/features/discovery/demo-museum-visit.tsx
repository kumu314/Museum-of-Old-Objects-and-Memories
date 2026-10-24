'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { memoirDemoStateSchema, publicMemoirChapterSchema, type DiscoveryMuseum } from '../../contracts';
import { CabinetPreview } from '../studio/cabinet-preview';
import type { CabinetExhibit } from '../studio/cabinet-items';
import { useDemoStorage } from '../direction1/use-demo-storage';
import { createMemoirDemo } from '../memoir/demo';
import { DemoBook } from '../memoir/demo-book';
import { discoveryDemoActors } from './demo';
import styles from '../direction1/demo.module.css';
import '../studio/workbench.css';

export function DemoMuseumVisit({ museum, viewerId }: { museum: DiscoveryMuseum; viewerId: string }) {
  const [selectedSlot, setSelectedSlot] = useState(0);
  const memoir = useDemoStorage(`direction1:memoir:v1:${viewerId}`, memoirDemoStateSchema, createMemoirDemo);
  const ownDemoBook = museum.owner.userId === discoveryDemoActors[2].userId;
  const workspace = memoir.hydrated && !memoir.blocked && memoir.value.data.state === 'ready' ? memoir.value.data.workspace : null;
  const publication = workspace?.publications.findLast((item) => item.revokedAt === null);
  const chapter = ownDemoBook ? publication?.publicData ?? null : publicMemoirChapterSchema.parse({
    publicationId: museum.accessEpoch, chapterId: museum.museumId, title: '一段合成的日常',
    paragraphs: ['【固定合成样例】这是一段用于体验书籍阅读的虚构文字，不对应真实人物，也不是实时 AI 生成。',
      '我想记录的，是一件旧物陪伴日常的样子。这个样例只演示已授权章节的阅读方式。'], publishedAt: museum.publishedAt,
  });
  const modelKey = museum.exhibitNames.some((name) => name.includes('相机')) ? 'camera-01'
    : museum.exhibitNames.some((name) => name.includes('车票')) ? 'ticket' : 'cassette';
  const name = modelKey === 'camera-01' ? '内置旧相机样例' : modelKey === 'ticket' ? '内置车票样例' : '内置磁带样例';
  const exhibits = useMemo<readonly CabinetExhibit[]>(() => [
    { id: museum.museumId, name, era: 'DEMO 合成样例', slotIndex: 0, modelKey, photoAssetId: null },
  ], [museum.museumId, name, modelKey]);
  return <section className={styles.panel} aria-label="演示馆内参观">
    <span className={styles.eyebrow}>DEMO / 内置模型与合成故事</span><h2>{museum.title} · 馆内参观</h2>
    <p className={styles.muted}>可选中样例旧物并进入检视；下方书籍可打开阅读。这里使用项目内置模型，不是根据上传照片生成的结果。</p>
    <CabinetPreview exhibits={exhibits} selectedSlot={selectedSlot} disabled={false} onSelectSlot={setSelectedSlot} assetBase="/api/demo-no-assets" mode="visit" />
    <DemoBook key={chapter?.publicationId ?? 'private'} chapter={chapter} author={museum.owner.nickname} />
    {ownDemoBook && <p className={styles.muted}>这是你在“自传 DEMO”中单独授权的章节；未授权、撤销或删除后不展示正文。<Link href="/memoir">去整理并授权一章 →</Link></p>}
    {memoir.warning && ownDemoBook && <p role="alert" className={styles.error}>{memoir.warning}</p>}
  </section>;
}
