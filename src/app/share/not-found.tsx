import { shareNotFoundMessage } from '../../contracts/errors';

export default function ShareNotFound() {
  return <main className="mx-auto max-w-xl px-6 py-24 text-center"><p className="text-sm text-amber-100/60">拾物馆</p><h1 className="mt-5 font-serif text-3xl">{shareNotFoundMessage}</h1><p className="mt-5 leading-7 text-stone-400">请向制作人员索取当前参观链接。</p></main>;
}
