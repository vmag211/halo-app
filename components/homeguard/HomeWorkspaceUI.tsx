'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { ArrowUpRight, CalendarPlus, Check, FolderOpen, Trash2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/Foundation';
import { useExpandedPreview } from '@/components/expanded/ExpandedPreviewState';
import type { FactorKey } from '@/lib/frontend/factor-preview';
import { useHomeWorkspace } from './HomeWorkspaceState';
import { WorkspaceArtwork, type WorkspaceArtworkKind } from './WorkspaceArtwork';
import { LoadingSymbol } from '@/components/ui/HaloLoading';

export type HomeSection = 'tests' | 'maintenance' | 'food' | 'summary';
export type WorkspaceProps = { view: string; recordId?: string; navigate: (view: string, recordId?: string) => void; go: (section: HomeSection, view?: string, recordId?: string) => void; factor?: FactorKey };
export function PageIntro({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon?: ReactNode }) {
  return <header className="hg-intro"><WorkspaceArtwork /><span className="hg-kicker">{icon && <span className="hg-intro-icon" aria-hidden="true">{icon}</span>}{eyebrow}</span><h2 tabIndex={-1} data-home-heading>{title}</h2><p>{description}</p></header>;
}
type RecordDeletion = { remove: () => Promise<boolean>; description: string };
export function WorkspaceLink({ onClick, title, detail, icon, deletion, artwork }: { onClick: () => void; title: string; detail?: string; icon?: ReactNode; deletion?: RecordDeletion; artwork?: WorkspaceArtworkKind }) {
  const link = <button type="button" className="hg-link" onClick={onClick}>{artwork ? <WorkspaceArtwork kind={artwork} compact /> : icon && <span className="hg-link-icon" aria-hidden="true">{icon}</span>}<span><strong>{title}</strong>{detail && <small>{detail}</small>}</span><ArrowUpRight size={18} aria-hidden="true" /></button>;
  return deletion ? <DeletableRecord title={title} deletion={deletion}>{link}</DeletableRecord> : link;
}
export function DeletableRecord({ title, deletion, children }: { title: string; deletion: RecordDeletion; children: ReactNode }) {
  const [confirming, setConfirming] = useState<{ title: string; deletion: RecordDeletion } | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const deletionFocus = useRef<HTMLElement | null>(null);
  return <><div className="hg-deletable-record" ref={row}>{children}<DeleteButton compact label={`Delete ${title}`} onClick={() => setConfirming({ title, deletion })} /></div>{confirming && <Confirm title="Are you sure?" danger fallbackFocus={deletionFocus} confirmLabel="Yes, delete" cancelLabel="No, keep it" onCancel={() => setConfirming(null)} onConfirm={async () => {
    // The row and its opener disappear together. Let modal cleanup focus the
    // surviving heading, rather than racing cleanup with an animation frame.
    deletionFocus.current = row.current?.closest('.hg-workspace, .halo-explore')?.querySelector<HTMLElement>('[data-home-heading], h2[tabindex]') ?? null;
    if (await confirming.deletion.remove()) {
      setConfirming(null);
    }
  }}><p>Delete <strong>{confirming.title}</strong>?</p><p>{confirming.deletion.description}</p><p className="hg-meta">This cannot be undone.</p></Confirm>}</>;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="hg-empty"><span aria-hidden="true"><FolderOpen size={30} /></span><h3>{title}</h3>{children}{action}</section>;
}
export function SourceNote({ children }: { children: ReactNode }) { return <aside className="hg-source-note">{children}</aside>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="hg-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function RecordForm({ onSubmit, children, submitLabel = 'Save record', onCancel, onConfirmed, busy }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<unknown>; children: ReactNode; submitLabel?: string; onCancel?: () => void; onConfirmed?: (recordId: string) => void; busy?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Saves of this form that ended unconfirmed. Until their status is checked the draft is held as sent
  // (not editable), so a confirmed save can finish exactly as a direct success would.
  const [awaiting, setAwaiting] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const workspace = useHomeWorkspace();
  const { scenario, pending, unknownOperations } = workspace;
  const settle = useRef(onConfirmed);
  const settling = useRef<string[] | null>(null);
  useEffect(() => { settle.current = onConfirmed; }, [onConfirmed]);
  useEffect(() => {
    if (!awaiting.length || settling.current === awaiting || awaiting.some(id => unknownOperations.some(item => item.operationId === id))) return;
    settling.current = awaiting;
    const outcomes = awaiting.map(id => workspace.operationOutcome(id));
    const recordId = outcomes.at(-1)?.recordId ?? '';
    // A failed or unknown settlement keeps the draft for a deliberate retry; only a confirmed save closes the form.
    queueMicrotask(() => {
      setAwaiting([]);
      if (!outcomes.every(outcome => outcome?.status === 'succeeded')) return;
      if (settle.current) settle.current(recordId); else setConfirmed(true);
    });
  }, [awaiting, unknownOperations, workspace]);
  const disabled = saving || !!busy || pending;
  if (confirmed) return <div className="hg-notice" role="status"><p>Saved. Your change was confirmed.</p>{onCancel && <button type="button" className="hg-button-secondary" onClick={onCancel}>Close</button>}</div>;
  return <><form className="hg-form" onChangeCapture={() => setDirty(true)} onSubmit={async event => { event.preventDefault(); if (disabled || unknownOperations.length) return; setSaving(true); const before = new Set(workspace.unknownOperationIds()); try { await onSubmit(event); } finally { setSaving(false); const added = workspace.unknownOperationIds().filter(id => !before.has(id)); if (added.length) setAwaiting(added); } }}><fieldset disabled={disabled || awaiting.length > 0}>{children}</fieldset><div className="hg-actions"><button className="hg-button" type="submit" aria-busy={disabled || undefined} disabled={disabled || unknownOperations.length > 0 || scenario === 'offline'}>{disabled && <LoadingSymbol small />}{disabled ? 'Saving...' : submitLabel}</button>{onCancel && <button type="button" className="hg-button-secondary" disabled={disabled} onClick={() => dirty ? setCancel(true) : onCancel()}>Cancel</button>}</div>{awaiting.length > 0 && <p className="hg-meta" role="status">This save is not confirmed yet. Check its status. Your draft is kept as sent.</p>}{scenario === 'offline' && <p className="hg-meta">Offline. Your draft is kept here, but changes are not queued.</p>}</form>{cancel && <Confirm title="Leave this form?" onCancel={() => setCancel(false)} onConfirm={() => { setCancel(false); onCancel?.(); }}>Your saved record is unchanged. Unsaved edits may be lost.</Confirm>}</>;
}
export function DeleteButton({ label, onClick, disabled, compact = false }: { label: string; onClick: () => void; disabled?: boolean; compact?: boolean }) {
  const { pending, scenario } = useHomeWorkspace();
  return <button type="button" className={`hg-delete-button${compact ? ' hg-delete-compact' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled || pending || scenario === 'offline'}><Trash2 size={18} aria-hidden="true" />{!compact && <span>Delete</span>}</button>;
}
export function Confirm({ title, children, onConfirm, onCancel, danger = false, confirmLabel, cancelLabel, fallbackFocus, revisionKey, unknownRecovery }: { title: string; children: ReactNode; onConfirm: () => void | Promise<unknown>; onCancel: () => void; danger?: boolean; confirmLabel?: string; cancelLabel?: string; fallbackFocus?: RefObject<HTMLElement | null>; revisionKey?: string; unknownRecovery?: { label: string; check: () => void | Promise<unknown> } }) {
  const id = useId(); const [busy, setBusy] = useState(false), [capturedRevision] = useState(revisionKey);
  const changed = capturedRevision !== revisionKey;
  const workspace = useHomeWorkspace(); const [attempted, setAttempted] = useState(false); const [error, setError] = useState('');
  const feedback = error || (danger && attempted && !busy ? workspace.message : '');
  return <BottomSheet id={`home-confirm-${id}`} title={title} height="content" fallbackFocus={fallbackFocus} onClose={() => { if (!busy) onCancel(); }}><div className="hg-stack">{children}{changed && <p role="alert">This record changed. Close this review and open the current record.</p>}{workspace.unknownOperations.length > 0 && <div role="status"><p>A change is not yet confirmed. Check its status before continuing.</p>{unknownRecovery ? <button type="button" className="hg-button-secondary" disabled={busy || workspace.pending} onClick={() => void unknownRecovery.check()}>{unknownRecovery.label}</button> : workspace.unknownOperations.map(item => <button key={item.operationId} type="button" className="hg-button-secondary" disabled={busy || workspace.pending} onClick={() => void workspace.reconcile(item.operationId)}>Check save status</button>)}</div>}{feedback && <p role="alert" className="hg-error">{feedback}</p>}<div className="hg-actions"><button type="button" className={danger ? 'hg-button hg-danger' : 'hg-button'} disabled={busy || changed || workspace.pending || workspace.unknownOperations.length > 0 || (danger && workspace.scenario === 'offline')} onClick={async () => { if (busy || changed || workspace.unknownOperations.length) return; setBusy(true); setAttempted(true); setError(''); workspace.clearMessage(); try { await onConfirm(); } catch { setError('This change could not be completed. Your record is still here. Please try again.'); } finally { setBusy(false); } }}>{busy ? 'Working...' : confirmLabel ?? (danger ? 'Yes, delete' : 'Confirm')}</button><button type="button" className="hg-button-secondary" disabled={busy} onClick={onCancel}>{cancelLabel ?? (danger ? 'No, keep it' : 'Keep editing')}</button></div></div></BottomSheet>;
}
export function ActionButton({ title, reason, factor, originId, date, buttonLabel }: { title: string; reason: string; factor: string; originId: string; date?: string; buttonLabel?: string }) {
  const state = useExpandedPreview(); const workspace = useHomeWorkspace();
  const key = `home:${originId}`;
  const exists = state?.actions.some(action => action.key === key);
  return <button className="hg-button-secondary" disabled={!state || workspace.scenario === 'offline'} type="button" onClick={() => state?.open({ key, title, reason, origin: factor, date })}>{exists ? <Check size={17} aria-hidden="true" /> : <CalendarPlus size={17} aria-hidden="true" />}{exists ? buttonLabel ? `Open ${buttonLabel.toLowerCase()}` : 'Open saved action' : buttonLabel || 'Save to My Week'}</button>;
}

export function downloadPreview(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
