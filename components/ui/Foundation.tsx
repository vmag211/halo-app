'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent } from 'react';
import { Check, ChevronDown, CircleHelp, Info, TriangleAlert, X } from 'lucide-react';
import SeverityPill from './SeverityPill';
import { foundationCopy as c } from '@/lib/frontend/copy/foundation-preview';
import { normalizeSeverity } from '@/lib/frontend/onboarding';

/** New shared UI proposals. Scoped styling is preview-only until visual approval. */
export function Card({ title, children, onClick }: { title: string; children: ReactNode; onClick?: () => void }) {
  return onClick ? <button className="halo-f-card halo-f-tappable" onClick={onClick}><h2>{title}</h2>{children}</button> : <section className="halo-f-card"><h2>{title}</h2>{children}</section>;
}

export function ExpandableCard({ id, title, summary, severity, open, onOpenChange, children }: { id: string; title: string; summary: string; severity: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return <section className="halo-f-card halo-f-expandable" id={`factor-${id}`}>
    <button className="halo-f-card-toggle" aria-expanded={open} aria-controls={`detail-${id}`} onClick={() => onOpenChange(!open)}>
      <span className="halo-f-card-copy"><span className="halo-f-card-title">{title}</span><span className="halo-f-card-summary">{summary}</span></span>
      <span className="halo-f-card-end"><SeverityPill severity={severity} /><ChevronDown size={18} aria-hidden="true" data-open={open} /></span>
    </button>
    {open && <div className="halo-f-card-detail" id={`detail-${id}`}><span className="halo-sr">{title}. {summary}.</span>{children}</div>}
  </section>;
}

export function ScoreRing({ score, severity, partial = false }: { score: number | null; severity: string; partial?: boolean }) {
  const circumference = 2 * Math.PI * 58;
  const level = normalizeSeverity(severity);
  const missing = score === null || level === 'no_data' || !Number.isFinite(score) || score < 0 || score > 100;
  return <div className="halo-f-ring" role="img" aria-label={missing ? c.noData : c.ringLabel(score!, level, partial)} data-severity={missing ? 'no_data' : level} data-partial={partial}>
    <svg viewBox="0 0 140 140" aria-hidden="true"><circle className="halo-f-ring-track" cx="70" cy="70" r="58" />
      {!missing && <circle className="halo-f-ring-arc" cx="70" cy="70" r="58" pathLength="100" strokeDasharray={`${score} ${100 - score}`} style={{ '--halo-ring-circumference': circumference } as CSSProperties} />}
      {partial && !missing && <circle className="halo-f-ring-partial" cx="70" cy="70" r="66" />}
    </svg><span className={missing ? 'halo-f-ring-missing' : 'halo-f-ring-number'}>{missing ? c.noData : score}</span>
  </div>;
}

export type ContributionSegment = { key: string; label: string; shortLabel?: string; share: number | null; severity: string };
export function ContributionBar({ segments, onSelect }: { segments: ContributionSegment[]; onSelect: (key: string) => void }) {
  // Display geometry only. Scores, risk shares and severities come from the adapter.
  const present = segments.filter(s => s.share !== null || s.severity === 'no_data');
  const total = present.reduce((sum, s) => sum + (s.share ?? 0), 0);
  if (total === 0 && !present.some(s => s.severity === 'no_data')) return null;
  return <div className="halo-f-contribution"><p className="halo-f-meta">{c.contribution}</p>
    <div className="halo-f-contribution-track" aria-hidden="true">{present.map(s => <span key={s.key} data-severity={s.severity} className="halo-f-contribution-segment" style={{ flex: Math.max(s.share ?? 8, 3) }} onClick={() => onSelect(s.key)}>{(s.share ?? 0) >= 10 && <span>{s.shortLabel ?? s.label}</span>}</span>)}</div>
    <div className="halo-f-legend">{present.map(s => <button key={s.key} onClick={() => onSelect(s.key)} aria-label={c.factorLabel(s.label, s.severity, s.share)}><span className="halo-f-dot" data-severity={s.severity} />{s.label} <span className="halo-f-meta">{s.severity === 'no_data' ? c.noData : `${s.share}%`}</span></button>)}</div>
  </div>;
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'caution' | 'notice' | 'error'; title?: string; children: ReactNode }) {
  const Icon = tone === 'caution' || tone === 'error' ? TriangleAlert : tone === 'notice' ? CircleHelp : Info;
  return <aside className="halo-f-callout" data-tone={tone} role={tone === 'error' ? 'alert' : undefined}><Icon size={20} aria-hidden="true" /><div>{title && <strong>{title}</strong>}{children}</div></aside>;
}
export function Skeleton({ shape = 'block', width = '100%', height }: { shape?: 'block' | 'text'; width?: CSSProperties['width']; height?: CSSProperties['height'] }) {
  return <span className="halo-f-skeleton" data-shape={shape} style={{ width, height }} aria-hidden="true" />;
}
export function EmptyState({ icon, heading, body, action }: { icon: ReactNode; heading: string; body: string; action?: ReactNode }) {
  return <section className="halo-f-empty"><span className="halo-f-empty-icon" aria-hidden="true">{icon}</span><h2>{heading}</h2><p>{body}</p>{action}</section>;
}
export function SegmentedControl({ options, value, onChange, label }: { options: readonly string[]; value: string; onChange: (value: string) => void; label: string }) {
  const group = useRef<HTMLDivElement>(null);
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault(); onChange(options[next]); group.current?.querySelectorAll('button')[next]?.focus();
  }
  return <div className="halo-f-segments" role="radiogroup" aria-label={label} ref={group}>{options.map((option, i) => <button key={option} role="radio" aria-checked={option === value} tabIndex={option === value ? 0 : -1} onClick={() => onChange(option)} onKeyDown={e => keyDown(e, i)}>{option}</button>)}</div>;
}
export function ToggleChip({ pressed, onToggle, children, disabled = false }: { pressed: boolean; onToggle: () => void; children: ReactNode; disabled?: boolean }) {
  return <button className="halo-chip" aria-pressed={pressed} onClick={onToggle} disabled={disabled}><span className="halo-chip-mark">{pressed ? <Check size={17} aria-hidden="true" /> : <span aria-hidden="true">○</span>}</span>{children}</button>;
}
export function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <button className="halo-f-switch-row" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span>{label}</span><span className="halo-f-switch-track"><span /></span></button>;
}
export function AccordionRow({ id, title, summary, open, onToggle, children }: { id: string; title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="halo-f-accordion"><button onClick={onToggle} aria-expanded={open} aria-controls={id}><span><strong>{title}</strong>{!open && <span className="halo-f-meta">{summary}</span>}</span><ChevronDown size={20} aria-hidden="true" data-open={open} /></button>{open && <div id={id} className="halo-f-accordion-body">{children}</div>}</section>;
}
export function SwipeRow({ actionLabel, onAction, children }: { actionLabel: string; onAction: () => void; children: ReactNode }) {
  const start = useRef<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  return <div className="halo-f-swipe" data-revealed={revealed} onTouchStart={e => { start.current = e.touches[0].clientX; }} onTouchEnd={e => { if (start.current !== null) setRevealed(start.current - e.changedTouches[0].clientX > 50); start.current = null; }}><div>{children}</div><button className="halo-f-destructive" onClick={onAction}>{actionLabel}</button></div>;
}
export function ProvenancePill({ provenance }: { provenance: 'measured' | 'modeled' | 'estimate' | null }) {
  return provenance ? <span className="halo-f-quiet-pill">{provenance}</span> : null;
}
export function ConfidencePill({ confidence }: { confidence: 'full' | 'limited' | 'stale' | 'none' }) {
  const label = { full: null, limited: c.confidenceLabels[0], stale: c.confidenceLabels[1], none: c.confidenceLabels[2] }[confidence];
  return label ? <span className="halo-f-quiet-pill">{label}</span> : null;
}
export function RiskBar({ risk, severity, notScored = false }: { risk: number | null; severity: string; notScored?: boolean }) {
  return <div className="halo-f-risk-track" data-severity={severity} role="img" aria-label={notScored ? c.shownNotScored : risk === null ? c.noData : c.riskLabel(risk, severity)}>
    {risk !== null && !notScored && <span style={{ width: `${risk}%` }} />}
  </div>;
}

export function BottomSheet({ id, title, height, onClose, children }: { id: string; title: string; height: 'standard' | 'tall' | 'content'; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dragStart = useRef<number | null>(null);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const y = window.scrollY;
    const saved = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    document.body.style.position = 'fixed'; document.body.style.top = `${-y}px`; document.body.style.width = '100%';
    element?.showModal();
    return () => { element?.close(); Object.assign(document.body.style, saved); window.scrollTo(0, y); opener?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} id={id} className="halo-f-sheet" data-height={height} aria-labelledby={`${id}-title`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
  }}>
    <div className="halo-f-sheet-grab" aria-label={c.drag} onPointerDown={e => { dragStart.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { if (dragStart.current !== null && e.clientY - dragStart.current > 60) onClose(); dragStart.current = null; }}><span /></div>
    <header className="halo-f-sheet-head"><h2 id={`${id}-title`}>{title}</h2><button className="halo-f-icon" onClick={onClose} aria-label={c.close} autoFocus><X size={22} aria-hidden="true" /></button></header>
    <div className="halo-f-sheet-body">{children}</div>
  </dialog>;
}
