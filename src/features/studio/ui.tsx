import type { ReactNode } from 'react';

export const inputClass = 'mt-2 w-full rounded-lg border border-stone-700 bg-stone-950/60 px-3 py-2.5 text-stone-100 placeholder:text-stone-500';
export const buttonClass = 'rounded-lg border border-stone-600 px-4 py-2 text-sm transition hover:border-amber-200 hover:text-amber-100 disabled:cursor-wait disabled:opacity-40';
export const primaryClass = `${buttonClass} border-amber-200/50 bg-amber-100/10 text-amber-100`;
export const panelClass = 'rounded-xl border border-stone-700/60 bg-stone-900/40 p-5 sm:p-6';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block text-sm text-stone-300"><span>{label}</span>{children}{hint && <span className="mt-1.5 block text-xs leading-5 text-stone-500">{hint}</span>}</label>;
}
export function Notice({ error, message }: { error: string | null; message?: string | null }) {
  return <div aria-live="polite">{error && <p role="alert" className="my-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm leading-6 text-red-200">{error}</p>}{message && <p className="my-4 text-sm text-amber-100/80">{message}</p>}</div>;
}
