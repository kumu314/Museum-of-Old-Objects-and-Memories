import type { AnchorHTMLAttributes } from 'react';
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} />; }
export function useLinkStatus() { return { pending: false }; }
