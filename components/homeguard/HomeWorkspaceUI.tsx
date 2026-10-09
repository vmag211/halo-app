'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, CalendarPlus, Check, FolderOpen, Trash2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/Foundation';
import { useExpandedPreview } from '@/components/expanded/ExpandedPreviewState';
import type { FactorKey } from '@/lib/frontend/factor-preview';
import { useHomeWorkspace } from './HomeWorkspaceState';
import { HomeWorkspaceScene } from './HomeWorkspaceScene';

export type HomeSection = 'tests' | 'maintenance' | 'food' | 'summary';
export type WorkspaceProps = { view: string; recordId?: string; navigate: (view: string, recordId?: string) => void; go: (section: HomeSection, view?: string, recordId?: string) => void; factor?: FactorKey };
export function PageIntro({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon?: ReactNode }) {
  return <header className="hg-intro"><HomeWorkspaceScene /><span className="hg-kicker">{icon && <span className="hg-intro-icon" aria-hidden="true">{icon}</span>}{eyebrow}</span><h2 tabIndex={-1} data-home-heading>{title}</h2><p>{description}</p></header>;
}
type RecordDeletion = { remove: () => Promise<boolean>; description: string };
export function WorkspaceLink({ onClick, title, detail, icon, deletion }: { onClick: () => void; title: string; detail?: string; icon?: ReactNode; deletion?: RecordDeletion }) {
  const link = <button type="button" className="hg-link" onClick={onClick}>{icon && <span className="hg-link-icon" aria-hidden="true">{icon}</span>}<span><strong>{title}</strong>{detail && <small>{detail}</small>}</span><ArrowUpRight size={18} aria-hidden="true" /></button>;
  return deletion ? <DeletableRecord title={title} deletion={deletion}>{link}</DeletableRecord> : link;
}
export function DeletableRecord({ title, deletion, children }: { title: string; deletion: RecordDeletion; children: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  return <><div className="hg-deletable-record" ref={row}>{children}<DeleteButton compact label={`Delete ${title}`} onClick={() => setConfirming(true)} /></div>{confirming && <Confirm title="Are you sure?" danger confirmLabel="Yes, delete" cancelLabel="No, keep it" onCancel={() => setConfirming(false)} onConfirm={async () => {
    // Capture a surviving focus target before successful removal unmounts this row.
    const next = row.current?.nextElementSibling?.querySelector<HTMLElement>('button');
    const previous = row.current?.previousElementSibling?.querySelector<HTMLElement>('button');
    const heading = row.current?.closest('.hg-workspace')?.querySelector<HTMLElement>('[data-home-heading]');
    if (await deletion.remove()) {
      setConfirming(false);
      requestAnimationFrame(() => (next?.isConnected ? next : previous?.isConnected ? previous : heading)?.focus({ preventScroll: true }));
    }
  }}><p>Delete <strong>{title}</strong>?</p><p>{deletion.description}</p><p className="hg-meta">This cannot be undone during this visit.</p></Confirm>}</>;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="hg-empty"><span aria-hidden="true"><FolderOpen size={30} /></span><h3>{title}</h3>{children}{action}</section>;
}
export function SourceNote({ children }: { children: ReactNode }) { return <aside className="hg-source-note">{children}</aside>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="hg-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function RecordForm({ onSubmit, children, submitLabel = 'Save sample record', onCancel, busy }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<unknown>; children: ReactNode; submitLabel?: string; onCancel?: () => void; busy?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { scenario, pending } = useHomeWorkspace();
  const disabled = saving || !!busy || pending;
  return <><form className="hg-form" onChangeCapture={() => setDirty(true)} onSubmit={async event => { event.preventDefault(); if (disabled) return; setSaving(true); try { await onSubmit(event); } finally { setSaving(false); } }}><fieldset disabled={disabled}>{children}</fieldset><div className="hg-actions"><button className="hg-button" type="submit" disabled={disabled || scenario === 'offline'}>{disabled ? 'Saving sample...' : submitLabel}</button>{onCancel && <button type="button" className="hg-button-secondary" disabled={disabled} onClick={() => dirty ? setCancel(true) : onCancel()}>Cancel</button>}</div><p className="hg-meta">{scenario === 'offline' ? 'Offline: keep your draft and return when connected. Nothing is queued.' : 'Sample session only. Use fictional information. No account data is sent.'}</p></form>{cancel && <Confirm title="Leave this form?" onCancel={() => setCancel(false)} onConfirm={() => { setCancel(false); onCancel?.(); }}>Your last saved record stays unchanged. Any draft retained by this form will remain available during this visit.</Confirm>}</>;
}
export function DeleteButton({ label, onClick, disabled, compact = false }: { label: string; onClick: () => void; disabled?: boolean; compact?: boolean }) {
  const { pending, scenario } = useHomeWorkspace();
  return <button type="button" className={`hg-delete-button${compact ? ' hg-delete-compact' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled || pending || scenario === 'offline'}><Trash2 size={18} aria-hidden="true" />{!compact && <span>Delete</span>}</button>;
}
export function Confirm({ title, children, onConfirm, onCancel, danger = false, confirmLabel, cancelLabel }: { title: string; children: ReactNode; onConfirm: () => void | Promise<unknown>; onCancel: () => void; danger?: boolean; confirmLabel?: string; cancelLabel?: string }) {
  const id = useId(); const [busy, setBusy] = useState(false);
  const workspace = useHomeWorkspace(); const [attempted, setAttempted] = useState(false); const [error, setError] = useState('');
  const feedback = error || (danger && attempted && !busy ? workspace.message : '');
  return <BottomSheet id={`home-confirm-${id}`} title={title} height="content" onClose={() => { if (!busy) onCancel(); }}><div className="hg-stack">{children}{feedback && <p role="alert" className="hg-error">{feedback}</p>}<div className="hg-actions"><button type="button" className={danger ? 'hg-button hg-danger' : 'hg-button'} disabled={busy || workspace.pending || (danger && workspace.scenario === 'offline')} onClick={async () => { if (busy) return; setBusy(true); setAttempted(true); setError(''); workspace.clearMessage(); try { await onConfirm(); } catch { setError('This change could not be completed. Your record is still here. Please try again.'); } finally { setBusy(false); } }}>{busy ? 'Working...' : confirmLabel ?? (danger ? 'Yes, delete' : 'Confirm')}</button><button type="button" className="hg-button-secondary" disabled={busy} onClick={onCancel}>{cancelLabel ?? (danger ? 'No, keep it' : 'Keep editing')}</button></div></div></BottomSheet>;
}
export function ActionButton({ title, reason, factor, originId, date, buttonLabel }: { title: string; reason: string; factor: string; originId: string; date?: string; buttonLabel?: string }) {
  const state = useExpandedPreview(); const workspace = useHomeWorkspace();
  const key = `home:${originId}`;
  const exists = state?.actions.some(action => action.key === key);
  return <button className="hg-button-secondary" disabled={!state || workspace.scenario === 'offline'} type="button" onClick={() => state?.open({ key, title, reason, origin: factor, date })}>{exists ? <Check size={17} aria-hidden="true" /> : <CalendarPlus size={17} aria-hidden="true" />}{exists ? buttonLabel ? `Open ${buttonLabel.toLowerCase()}` : 'Open saved action' : buttonLabel || 'Save to Plan'}</button>;
}

export function downloadPreview(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
