'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';

function NavigationStatus() {
  const { pending } = useLinkStatus();
  return pending ? <span role="status" className="fixed bottom-5 right-5 z-50 rounded-lg border border-[#C8A56B]/40 bg-[#19140F] px-4 py-3 text-sm font-normal tracking-normal text-[#F0E8DA] shadow-lg">正在打开页面…</span> : null;
}

export default function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<NavigationStatus /></Link>;
}
