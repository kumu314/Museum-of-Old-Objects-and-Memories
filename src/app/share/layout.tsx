import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '参观展馆 · 拾物馆', robots: { index: false, follow: false }, referrer: 'no-referrer' };

// This segment owns the shared not-found boundary, including a cold server request.
export default function ShareLayout({ children }: { children: ReactNode }) {
  return children;
}
