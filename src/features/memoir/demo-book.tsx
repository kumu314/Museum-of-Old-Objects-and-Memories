'use client';

import { useRef } from 'react';
import type { PublicMemoirChapter } from '../../contracts';
import styles from './demo-book.module.css';

export function DemoBook({ chapter, author }: { chapter: PublicMemoirChapter | null; author: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <div className={styles.bookcase}>
    <button className={styles.cover} disabled={!chapter} onClick={() => dialog.current?.showModal()} aria-label={chapter ? `打开${author}的演示自传` : '暂无已授权的演示章节'}>
      <span className={styles.stamp}>拾物馆 · DEMO</span><strong>留给岁月<br />的一本书</strong><span>{author}</span><small>{chapter ? '打开已授权章节 →' : '尚无公开章节'}</small>
    </button>
    <p>书中只显示单独确认并授权的章节。访谈原文与草稿保留在作者的演示编辑页。</p>
    {chapter && <dialog ref={dialog} className={styles.reader} aria-labelledby="demo-book-title" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className={styles.toolbar}><span>合成资料 · 公开阅读演示</span><button onClick={() => dialog.current?.close()} aria-label="关闭演示书籍">关闭 · Esc</button></div>
      <article><p className={styles.byline}>{author} / 已授权章节</p><h2 id="demo-book-title">{chapter.title}</h2>{chapter.paragraphs.map((text, index) => <p key={index}>{text}</p>)}</article>
    </dialog>}
  </div>;
}
