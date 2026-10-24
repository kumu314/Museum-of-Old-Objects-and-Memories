'use client';

export default function ShareError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl px-6 py-24 text-center"><p className="text-sm text-amber-100/60">拾物馆</p><h1 className="mt-5 font-serif text-3xl">展馆暂时无法读取</h1><p className="mt-5 leading-7 text-stone-400">请稍后重试，或向制作人员核对参观链接。</p><button className="mt-6 rounded-lg border border-stone-600 px-5 py-3" onClick={reset}>重新读取展馆</button></main>;
}
