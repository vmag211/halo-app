'use client';
import Link from 'next/link';
import { Lightbulb, Plus, X } from 'lucide-react';
import { actionCategory, dayLabel } from '@/lib/frontend/week-preview';
import type { PreviewAction } from '@/lib/frontend/expanded-preview';
import type { DatedWeekStarter } from '@/lib/frontend/week-starters';
import './week-starters.css';

type Href = (tab: string, destination?: string) => string;

/** Suggestions only: nothing here is a saved task until the person adds it. */
export default function WeekStarters({ starters, href, pending, disabled, onAdd, onDismiss, onDismissAll }: { starters: DatedWeekStarter[]; href: Href; pending: string; disabled: boolean; onAdd: (starter: DatedWeekStarter) => void; onDismiss: (id: string) => void; onDismissAll: () => void }) {
  if (!starters.length) return null;
  return <section className="mw-starters" aria-labelledby="mw-starters-title">
    <div className="mw-section-head"><h3 id="mw-starters-title">Ideas to start your week</h3><span>Suggestions</span></div>
    <p className="mw-starters-note">These are not saved. Add one to make it your task, or dismiss it.</p>
    <ul>{starters.map(starter => <li key={starter.id} className="mw-starter" data-kind={actionCategory({ key: starter.key, origin: starter.origin } as PreviewAction)}>
      <div className="mw-starter-body">
        <span className="mw-starter-tag"><Lightbulb size={13} aria-hidden="true" />Starter idea · Suggested for {dayLabel(starter.date)}</span>
        <strong>{starter.title}</strong>
        <p>{starter.reason}</p>
        <div className="mw-starter-actions">
          <button type="button" className="mw-starter-add" disabled={disabled || Boolean(pending)} aria-label={`Add to My Week: ${starter.title}`} onClick={() => onAdd(starter)}><Plus size={15} aria-hidden="true" />{pending === starter.id ? 'Adding...' : 'Add to My Week'}</button>
          <Link className="mw-text" href={starter.link.destination ? href(starter.link.tab, starter.link.destination) : href(starter.link.tab)}>{starter.link.label}</Link>
        </div>
      </div>
      <button type="button" className="mw-starter-dismiss" disabled={pending === starter.id} aria-label={`Dismiss: ${starter.title}`} title="Dismiss" onClick={() => onDismiss(starter.id)}><X size={16} aria-hidden="true" /></button>
    </li>)}</ul>
    <button type="button" className="mw-text mw-starters-hide" disabled={Boolean(pending)} onClick={onDismissAll}>Hide these ideas</button>
  </section>;
}
