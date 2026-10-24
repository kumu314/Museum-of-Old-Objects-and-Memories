import type { HTMLAttributes } from 'react';

type FrameProps = HTMLAttributes<HTMLElement> & { as?: 'div' | 'article' | 'section' };

/** Decorative layers never capture input or enter the accessibility tree. */
export function OrnateFrame({ as: Element = 'div', className = '', children, ...props }: FrameProps) {
  return <Element {...props} className={`ornate-frame ${className}`}>
    {children}
    <span className="ornate-frame__trim" aria-hidden="true">
      {['nw', 'ne', 'se', 'sw'].map((corner) => <svg key={corner} className={`ornate-frame__corner ornate-frame__corner--${corner}`} viewBox="0 0 64 64" fill="none">
        <path d="M2 62V18C2 8 8 2 18 2h44l-9 6H20C12 8 8 12 8 20v33Z" fill="currentColor" fillOpacity=".18" stroke="currentColor" />
        <path d="M5 47V19C5 10 10 5 19 5h28M12 38V22c0-6 4-10 10-10h16M13 13l23 23M15 29c-8-3-3-15 5-12 10 4 1 18-4 12m13-14c-3-8-15-3-12 5 4 10 18 1 12-4M30 30c9-8 14-1 8 4-4 4-7 0-4-3M22 41c5-3 5-8 1-11M41 22c-3 5-8 5-11 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        <path d="m42 7 4-3 4 3-4 3ZM7 42l3 4-3 4-3-4ZM24 24l4-2-2 4-4 2Z" fill="currentColor" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      </svg>)}
    </span>
  </Element>;
}
