'use client';

import Link from 'next/link';
import { ArrowUpRight, Check, FlaskConical, HandHeart, NotebookPen, Sprout, Wrench } from 'lucide-react';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { PreviewAction } from '@/lib/frontend/expanded-preview';
import { resolveWeekActivity, weekActivityHref, type WeekActivityCollections } from '@/lib/frontend/week-activity';
import { ExplorePhoto } from './ExploreVisuals';
import './week-activity.css';

export default function WeekActivityDetails({ action, collections, actions, href }: { action: PreviewAction; collections: WeekActivityCollections; actions: PreviewAction[]; href: (tab: string, destination?: string) => string }) {
  const workspace = useHomeWorkspace();
  const activity = resolveWeekActivity(action, collections, actions);
  const target = weekActivityHref(activity, href);
  const Icon = activity.kind === 'project' ? Sprout : activity.kind === 'volunteering' ? HandHeart : activity.kind === 'routine' ? Wrench : activity.kind === 'test' ? FlaskConical : NotebookPen;
  if (activity.kind === 'generic' && !activity.missingRecord) return null;
  return <section className="mw-activity-detail" data-activity={activity.kind} aria-label={`${activity.label} context`}>
    <div className="mw-activity-cover">{activity.image ? <ExplorePhoto scene={activity.image} className="mw-activity-photo" /> : <Icon size={33} aria-hidden="true" />}<div><small>{activity.label}</small><strong>{activity.guide ? activity.guide.title : activity.subtitle}</strong>{activity.guide && <span>Step {(activity.stepIndex ?? 0) + 1} of {activity.guide.steps.length}</span>}</div></div>
    {activity.missingRecord ? <p className="mw-activity-caption">The original record is unavailable. This saved task has been kept.</p> : <>
      {activity.fields.length > 0 && <dl className="mw-activity-facts">{activity.fields.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
      {activity.milestones && <ol className="mw-activity-milestones" aria-label="Recorded test facts">{activity.milestones.map(item => <li key={item.label} data-recorded={item.done}><span aria-hidden="true">{item.done ? <Check size={14} /> : <span/>}</span><strong>{item.label}</strong><small>{item.done ? 'Recorded' : 'Not recorded'}</small></li>)}</ol>}
      {activity.instructions && <details className="mw-activity-expand"><summary>How to do this step</summary><ol>{activity.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol></details>}
      {activity.preparation && <details className="mw-activity-expand"><summary>{activity.kind === 'volunteering' ? 'My preparation' : activity.kind === 'routine' ? 'Care instructions' : activity.kind === 'project' ? 'Before you begin' : 'Record details'}</summary><p>{activity.preparation}</p></details>}
      <div className="mw-activity-links">{target && <Link href={target} onClick={() => { if (activity.guide && activity.stepIndex !== undefined) workspace.setDraft(`explore:project-step:${activity.guide.id}`, () => activity.stepIndex); }}>Open {activity.kind === 'project' ? 'project' : activity.kind === 'volunteering' ? 'participation' : 'record'}<ArrowUpRight size={16} aria-hidden="true" /></Link>}{activity.sourceLinks?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={14} aria-hidden="true" /></a>)}</div>
      {activity.kind === 'volunteering' && <small className="mw-activity-caption">Your status is self-reported. Saving is not registration.</small>}
      {activity.image && <small className="mw-activity-caption">Context photo, not your project or location.</small>}
    </>}
  </section>;
}
