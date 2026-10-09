'use client';

import Link from 'next/link';
import { CalendarDays, Hand, House, Sunrise } from 'lucide-react';
import { appTabs, type AppTab } from '@/lib/frontend/navigation';

const icons = { today: Sunrise, home: House, act: Hand, plan: CalendarDays };
export default function AppNavigation({ active, href, onNavigate, live = false, onUnavailable }: {
  active: AppTab | null;
  href?: (tab: AppTab) => string;
  onNavigate?: (tab: AppTab) => void;
  live?: boolean;
  onUnavailable?: (label: string) => void;
}) {
  return <nav className="halo-f-tabs" aria-label="Main navigation">{appTabs.map(tab => {
    const Icon = icons[tab.key];
    const label = <><Icon size={23} aria-hidden="true" /><span>{tab.label}</span></>;
    return live && !tab.delivered
      ? <button key={tab.key} aria-disabled="true" aria-label={`${tab.label}, coming in a later stage`} onClick={() => onUnavailable?.(tab.label)}>{label}</button>
      : <Link key={tab.key} prefetch={false} scroll={false} href={href?.(tab.key) ?? tab.href} aria-current={active === tab.key ? 'page' : undefined} onClick={onNavigate ? e => { e.preventDefault(); onNavigate(tab.key); } : undefined}>{label}</Link>;
  })}</nav>;
}
