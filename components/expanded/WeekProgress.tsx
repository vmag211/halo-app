'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Check, FlaskConical, HandHeart, Sprout } from 'lucide-react';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { PreviewAction } from '@/lib/frontend/expanded-preview';
import { type WeekMeta } from '@/lib/frontend/week-preview';
import { canonicalProjectKey,weekActivityHref, weekProgressEntries, type WeekProgressEntry } from '@/lib/frontend/week-activity';
import { ExplorePhoto } from './ExploreVisuals';
import { useExpandedPreview } from './ExpandedPreviewState';
import './week-activity.css';

export default function WeekProgress({ href, actions, metas }: { href: (tab: string, destination?: string) => string; actions: PreviewAction[]; metas: Record<string, WeekMeta> }) {
  const workspace = useHomeWorkspace(); const state = useExpandedPreview();
  const [message, setMessage] = useState('');
  const entries = weekProgressEntries(workspace.collections, actions, metas);
  const unavailable = ['loading', 'error'].includes(workspace.scenario);
  const blocked = workspace.pending || ['offline', 'loading', 'error', 'save-error', 'conflict'].includes(workspace.scenario) || state?.fail;
  function continueWork(entry: WeekProgressEntry) { if (entry.guide && entry.stepIndex !== undefined) workspace.setDraft(`explore:project-step:${entry.project?.id??entry.guide.id}`, () => entry.stepIndex); }
  async function finishStep(entry: WeekProgressEntry) {
    const action = entry.currentAction;
    if (blocked || !navigator.onLine || !action || entry.project?.status === 'Paused' || metas[action.key]?.paused || metas[action.key]?.archived) { setMessage('This step could not be saved. Your work is kept; retry when saving is available.'); return; }
    if (!await state?.changeState(action.id, 'completed')) { setMessage('This step could not be confirmed. Review its task or save status before retrying.'); return; }
    setMessage('Step completed by you. The project’s next step is ready.');
  }
  const row = (entry: WeekProgressEntry) => {
    const Icon = entry.kind === 'project' ? Sprout : entry.kind === 'volunteering' ? HandHeart : FlaskConical;
    const target = weekActivityHref(entry, href);
    return <article className="mw-progress-item" data-activity={entry.kind} data-progress-id={entry.id} key={entry.id}>
      {target && <Link href={target} onClick={() => continueWork(entry)} className="mw-progress-open">{entry.image ? <ExplorePhoto scene={entry.image} className="mw-progress-photo" /> : <span className="mw-progress-symbol"><Icon size={24} aria-hidden="true" /></span>}<span><small>{entry.label} · {entry.status}</small><strong>{entry.title}</strong><span className="mw-progress-next">{entry.subtitle}</span></span><ArrowRight size={16} aria-hidden="true" /></Link>}
      {entry.guide && <div className="mw-progress-footer"><div className="mw-progress-track" aria-label={`${entry.completed} of ${entry.guide.steps.length} steps completed by you`}>{entry.guide.steps.map((_, index) => <span key={index} data-complete={actions.some(action => action.key === canonicalProjectKey(entry.guide!, index,entry.project) && action.state === 'completed')}/>)}</div><small>{entry.completed}/{entry.guide.steps.length} steps</small>{entry.currentAction && entry.status === 'Active' && entry.currentAction.state !== 'completed' && <button disabled={Boolean(blocked)} aria-label={`Complete current step of ${entry.title}`} onClick={() => finishStep(entry)}><Check size={14} aria-hidden="true" />Complete step</button>}</div>}
    </article>;
  };
  return <section className="mw-in-progress" aria-label="In progress"><div className="mw-section-head"><h3>Pick up your work</h3><span>{unavailable ? '' : entries.length}</span></div>
    {unavailable ? <p className="mw-muted">Your connected work is unavailable.</p> : entries.length ? <>{entries.slice(0, 2).map(row)}{entries.length > 2 && <details className="mw-progress-all"><summary>All in progress <span>{entries.length - 2} more</span></summary>{entries.slice(2).map(row)}</details>}</> : <div className="mw-progress-empty"><Sprout size={24} aria-hidden="true" /><p>A project, community plan or test you start will be ready to continue here.</p><Link href={href('act', 'projects')}>Find a project <ArrowRight size={15} aria-hidden="true" /></Link></div>}
    {message && <p role="status" className="mw-feedback">{message}</p>}
  </section>;
}
