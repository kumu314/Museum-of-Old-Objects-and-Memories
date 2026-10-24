import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-8 py-24">
      <h1 className="font-serif text-5xl">拾物馆</h1>
      <p className="mt-6 text-xl">家人的旧物纪念展</p>
      <p className="mt-10 leading-8 text-stone-300">收录旧物，整理讲述，把确认过的记忆放进一座可以分享的收藏柜。</p>
      <Link className="mt-8 inline-block rounded border border-amber-200/40 px-6 py-3 text-amber-100 hover:bg-amber-100/10" href="/login">注册并开始制作</Link>
      <p className="mt-8 text-sm text-stone-400">参观者无需账号，打开作者分享的参观链接即可查看展馆。</p>
    </main>
  );
}
