'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Pencil } from 'lucide-react';
import { useSceneExperience } from '@/components/foundation/SceneExperience';
import './test-progress.css';

export type TestProgressStep = { label: string; done: boolean; detail: string; editLabel: string; onEdit: () => void };
const TRAVEL_DURATION = 4200;

/** Decorative guide, never a lab status or an AI review of a report. */
export function LunaRunner() {
  return <svg className="hg-luna-runner" viewBox="0 0 64 80" fill="none" aria-hidden="true" focusable="false">
    <path className="hg-luna-leg hg-luna-leg-one" d="m25 62-5 9-8 1" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path className="hg-luna-leg hg-luna-leg-two" d="m39 62 5 10 8 1" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <g className="hg-luna-runner-body">
      <path d="M32 13V7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><circle cx="32" cy="4.5" r="3" fill="currentColor" />
      <rect x="7" y="22" width="5" height="12" rx="2.5" fill="currentColor" /><rect x="52" y="22" width="5" height="12" rx="2.5" fill="currentColor" />
      <rect x="11" y="13" width="42" height="29" rx="11" fill="var(--luna-shell)" stroke="currentColor" strokeWidth="2.5" />
      <rect x="17" y="19" width="30" height="16" rx="6" fill="var(--luna-face)" />
      <circle cx="24" cy="26" r="2.6" fill="var(--luna-eye)" /><circle cx="40" cy="26" r="2.6" fill="var(--luna-eye)" />
      <path d="M29 31q3 2.5 6 0" stroke="var(--luna-eye)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="19" y="43" width="26" height="21" rx="7" fill="var(--luna-shell)" stroke="currentColor" strokeWidth="2.5" />
      <g className="hg-luna-papers">
        <path d="M15 52h34v10H15z" fill="var(--luna-paper)" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M17 55h30m-30 3h30" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <g className="hg-luna-paper-top hg-luna-paper-top-one"><path d="m16 50 32-2 1 5-32 2-1-5Z" fill="var(--luna-paper)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></g>
        <g className="hg-luna-paper-top hg-luna-paper-top-two"><path d="m18 45 30 3-1 4-30-3 1-4Z" fill="var(--luna-paper)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="m23 47 17 1.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></g>
      </g>
      <path className="hg-luna-arm hg-luna-arm-left" d="M17 45c-7 1-8 9-4 15 2 2 5 2 8 0" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path className="hg-luna-arm hg-luna-arm-right" d="M47 45c7 1 8 9 4 15-2 2-5 2-8 0" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>;
}

export default function TestProgress({ steps, children }: { steps: TestProgressStep[]; children?: ReactNode }) {
  const { ready, enabled, deviceReduced } = useSceneExperience();
  const body = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [entered, setEntered] = useState(false);
  const [moving, setMoving] = useState(false);
  const [tooltip, setTooltip] = useState(false);
  const [geometry, setGeometry] = useState({ start: 14, height: 0, travel: 0, delays: [] as number[] });
  const current = Math.max(0, steps.reduce((last, step, index) => step.done ? index : last, 0));
  const completed = steps.filter(step => step.done).length;

  useEffect(() => {
    const element = body.current;
    if (!element || !ready) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const origin = element.getBoundingClientRect();
        const points = [...element.querySelectorAll<HTMLElement>('[data-progress-marker]')].map(marker => { const rect = marker.getBoundingClientRect(); return rect.top - origin.top + rect.height / 2; });
        const start = points[0] ?? 14;
        const travel = Math.max(0, (points[current] ?? start) - start);
        setGeometry({ start, height: Math.max(0, (points.at(-1) ?? start) - start), travel, delays: points.map(point => travel ? Math.min(1, (point - start) / travel) * TRAVEL_DURATION : 0) });
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [current, steps.length, ready]);

  useEffect(() => {
    const element = body.current;
    if (!element || !ready) return;
    if (typeof IntersectionObserver === 'undefined') { const frame = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(frame); }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setEntered(true); observer.disconnect(); }
    }, { threshold: 0.08 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    if (!entered) return;
    const reduced = !enabled || deviceReduced;
    const frame = requestAnimationFrame(() => setMoving(!reduced && geometry.travel > 0));
    const timer = window.setTimeout(() => setMoving(false), TRAVEL_DURATION + 300);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [entered, current, geometry.travel, enabled, deviceReduced]);

  const style = { '--test-track-start': `${geometry.start}px`, '--test-track-height': `${geometry.height}px`, '--test-travel': `${geometry.travel}px`, '--test-fill': geometry.height ? geometry.travel / geometry.height : 0, '--test-travel-duration': `${TRAVEL_DURATION}ms` } as CSSProperties;
  return <section className="hg-card hg-test-progress" aria-label="Test progress">
    <h2>Test progress</h2>
    <div ref={body} className="hg-test-progress-body" style={style} data-entered={entered} data-moving={moving}>
      <p className="hg-meta hg-test-progress-note">Checkmarks show saved steps. Empty circles mean a step has not been recorded.</p>
      <div className="hg-test-progress-track" aria-hidden="true"><span /></div>
      <ol className="hg-progress-list">
        {steps.map((step, index) => <li key={step.label} className={step.done ? 'is-complete' : ''} aria-current={index === current ? 'step' : undefined} style={{ '--test-check-delay': `${geometry.delays[index] ?? 0}ms` } as CSSProperties}>
          <span className="hg-test-progress-marker" data-progress-marker aria-hidden="true">{step.done && <Check size={13} strokeWidth={2.5} />}</span>
          <div className="hg-test-progress-copy"><strong>{step.label}</strong><p className="hg-meta">{step.done ? step.detail : 'Not recorded'}</p><span className="hg-test-sr-only">{step.done ? 'Recorded' : 'Not recorded'}</span></div>
          {step.done && <button type="button" className="hg-test-edit" aria-label={step.editLabel} title={step.editLabel} onClick={step.onEdit}><Pencil size={16} aria-hidden="true" /></button>}
        </li>)}
      </ol>
      <div className="hg-test-luna-position">
        <button type="button" className="hg-test-luna" aria-label="Meet Luna" aria-describedby={tooltip ? tooltipId : undefined} onMouseEnter={() => setTooltip(true)} onMouseLeave={() => setTooltip(false)} onFocus={() => setTooltip(true)} onBlur={() => setTooltip(false)} onClick={() => setTooltip(true)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setTooltip(false); } }}><LunaRunner /></button>
        {tooltip && <span role="tooltip" id={tooltipId} className="hg-test-luna-tooltip">I’m Luna. Keeping your paperwork on track.</span>}
      </div>
    </div>
    <p className="hg-meta hg-test-progress-caption">{completed} of {steps.length} stages recorded. An existing report can skip earlier steps. Updates come from you, not the lab.</p>
    {children}
  </section>;
}
