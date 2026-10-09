'use client';

import Link from 'next/link';
import { ArrowRight, ChevronRight, ClipboardList, Droplets, FileText, Fish, Plus, Refrigerator, Sprout, Wrench } from 'lucide-react';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { testStatusLabels, type TestRecord } from '@/lib/frontend/home-test-preview';
import type { HomeAsset, MoistureObservation } from '@/lib/frontend/home-maintenance-preview';
import type { GardenSite } from '@/lib/frontend/home-food-preview';
import './home-overview.css';

type Href = (tab: string, destination?: string) => string;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
function dayLabel(day: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${day.slice(0, 10)}T12:00:00`));
}

export default function HomeOverviewWorkspace({ href }: { href: Href }) {
  const workspace = useHomeWorkspace();
  const unavailable = workspace.scenario === 'loading' || workspace.scenario === 'error';
  const tests = ((workspace.collections.tests ?? []) as TestRecord[]).filter(record => !record.archived);
  const active = tests.filter(record => ['draft', 'arranged', 'sampled', 'awaiting'].includes(record.status));
  const reports = tests.filter(record => record.rows.length > 0);
  const currentTest = active.find(record => record.contextId === 'sample-current-home') ?? active[0];
  const routines = ((workspace.collections.assets ?? []) as HomeAsset[]).filter(record => record.status !== 'replaced');
  const nextRoutine = routines.filter(record => record.status === 'active' && (record.snoozedUntil || record.nextDue)).sort((a, b) => (a.snoozedUntil || a.nextDue).localeCompare(b.snoozedUntil || b.nextDue))[0];
  const observations = (workspace.collections.observations ?? []) as MoistureObservation[];
  const recentObservation = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const gardens = (workspace.collections.gardens ?? []) as GardenSite[];
  const foods = workspace.collections.pantryItems ?? [];
  const lastSummary = workspace.drafts['summary-last-created'] as { at: string; pages: number } | undefined;
  const link = (destination: string, view?: string, id?: string) => `${href('home', destination)}${view ? `&homeView=${view}` : ''}${id ? `&record=${encodeURIComponent(id)}` : ''}`;
  return <section id="home-workspace" tabIndex={-1} className="halo-home-workspace" aria-labelledby="home-workspace-title">
    <header className="how-heading"><span className="halo-ph-kicker">Care for the place you call home</span><h2 id="home-workspace-title">Your home workspace</h2><p>A place for your records, everyday care and next steps.</p></header>
    <p className="how-preview-note">Sample records for this review. Changes stay in this visit.</p>
    {unavailable ? <div className="how-notice" role="status"><p>{workspace.scenario === 'loading' ? 'Loading your home workspace.' : 'Your home records could not load.'}</p><button className="how-action" onClick={() => workspace.setScenario('ready')}>{workspace.scenario === 'loading' ? 'Finish loading sample' : 'Retry sample records'}</button></div> : <>
      {workspace.scenario === 'offline' && <p className="how-notice">Offline review. You can view retained records; changes wait until you reconnect.</p>}
      {workspace.scenario === 'stale' && <p className="how-notice">Review the original dates on older sample evidence.</p>}
      {currentTest && <aside className="how-continue"><span className="how-kicker">Pick up a home task</span><div><ClipboardList size={22} aria-hidden="true" /><span><strong>{currentTest.title}</strong><small>{testStatusLabels[currentTest.status]}</small></span></div><Link className="how-action" href={link('tests', 'detail', currentTest.id)} prefetch={false}>Continue test <ArrowRight size={17} aria-hidden="true" /></Link></aside>}
    </>}
    <div className="how-modules">
      <section className="how-module how-tests" aria-labelledby="how-tests-title"><header><ClipboardList size={23} aria-hidden="true" /><h3 id="how-tests-title">Tests and records</h3></header><p>Keep preparation, samples and results together.</p>
        {!unavailable && <><p className="how-meta">{plural(active.length, 'active test')} · {plural(reports.length, 'report')}</p>{currentTest ? <ol className="how-test-track" aria-label={`Recorded milestones for ${currentTest.title}`}>
          {[{ label: 'Arranged', recorded: currentTest.arrangedByUser === true }, { label: 'Collected', recorded: !!currentTest.collectionStart }, { label: 'Result', recorded: currentTest.rows.length > 0 }].map(step => <li key={step.label} data-recorded={step.recorded}><span aria-hidden="true" /><strong>{step.label}</strong><small>{step.recorded ? 'Recorded' : 'Not recorded'}</small></li>)}
        </ol> : <p className="how-empty">{tests.length ? 'Open a report or prepare your next test.' : 'Start with a test you are planning or a report you already have.'}</p>}</>}
        <footer><Link className="how-action" href={link('tests')} prefetch={false}>View records <ChevronRight size={17} aria-hidden="true" /></Link><Link className="how-text-action" href={link('tests', 'new')} prefetch={false}><Plus size={17} aria-hidden="true" />Plan a test</Link><Link className="how-text-action" href={link('tests', 'report')} prefetch={false}>Add a report</Link></footer>
      </section>
      <section className="how-module how-care" aria-labelledby="how-care-title"><header><Wrench size={23} aria-hidden="true" /><h3 id="how-care-title">Maintenance and moisture</h3></header><p>Make room for everyday care and the things you notice.</p>
        {!unavailable && <div className="how-care-list">{nextRoutine ? <Link href={link('maintenance', 'detail', nextRoutine.id)} prefetch={false}><Wrench size={18} aria-hidden="true" /><span><strong>{nextRoutine.title}</strong><small>Scheduled {dayLabel(nextRoutine.snoozedUntil || nextRoutine.nextDue)}</small></span><ChevronRight size={17} aria-hidden="true" /></Link> : <p className="how-empty">{routines.length ? 'No active routine has a next date.' : 'Add a routine for the equipment you care for.'}</p>}{recentObservation ? <Link href={link('maintenance', 'observation-detail', recentObservation.id)} prefetch={false}><Droplets size={18} aria-hidden="true" /><span><strong>{recentObservation.title}</strong><small>Observed {dayLabel(recentObservation.observedAt)}</small></span><ChevronRight size={17} aria-hidden="true" /></Link> : <p className="how-empty">Record dampness, a leak or a measured reading when you have one.</p>}</div>}
        <footer><Link className="how-action" href={link('maintenance')} prefetch={false}>View home care <ChevronRight size={17} aria-hidden="true" /></Link><Link className="how-text-action" href={link('maintenance', 'create')} prefetch={false}><Plus size={17} aria-hidden="true" />Add routine</Link><Link className="how-text-action" href={link('maintenance', 'observation')} prefetch={false}>Record moisture</Link></footer>
      </section>
      <section className="how-module how-food" aria-labelledby="how-food-title"><header><Sprout size={23} aria-hidden="true" /><h3 id="how-food-title">Food and Garden</h3></header><p>From your kitchen to the places you grow and explore.</p><nav className="how-food-entries" aria-label="Food and Garden workspaces">
        {[{ title: 'Your kitchen', description: unavailable ? 'Foods you save' : foods.length ? plural(foods.length, 'saved food') : 'Add your first food', view: 'pantry', Icon: Refrigerator }, { title: 'Your gardens', description: unavailable ? 'Growing sites' : gardens.length ? plural(gardens.length, 'growing site') : 'Set up a growing site', view: 'gardens', Icon: Sprout }, { title: 'Fish and waterways', description: 'Explore advisory context', view: 'fish', Icon: Fish }, { title: 'Water stewardship', description: 'Notices and your usage', view: 'water', Icon: Droplets }].map(({ title, description, view, Icon }) => <Link key={view} href={link('food', view)} prefetch={false}><Icon size={34} strokeWidth={1.35} aria-hidden="true" /><strong>{title}</strong><small>{description}</small></Link>)}
      </nav>{!unavailable && gardens[0] && <Link className="how-garden-return" href={link('food', 'garden-detail', gardens[0].id)} prefetch={false}><Sprout size={18} aria-hidden="true" /><span>Continue with {gardens[0].title}</span><ChevronRight size={17} aria-hidden="true" /></Link>}<footer><Link className="how-action" href={link('food')} prefetch={false}>Explore Food and Garden <ChevronRight size={17} aria-hidden="true" /></Link></footer><p className="how-meta">Food evidence and grower resources are inside.</p></section>
      <section className="how-module how-summary" aria-labelledby="how-summary-title"><div className="how-report-art" aria-hidden="true"><FileText size={42} strokeWidth={1.2} /><span /><span /><span /></div><div><header><h3 id="how-summary-title">Household summary</h3></header><p>Bring the information you choose into one private report.</p><p className="how-meta">Scores and sources, plus records you select.</p>{lastSummary && <p className="how-meta">Last PDF created {dayLabel(lastSummary.at)} · {plural(lastSummary.pages, 'page')}</p>}<footer><Link className="how-action" href={link('summary', 'selection')} prefetch={false}>{lastSummary ? 'Create a new summary' : 'Create summary'} <ArrowRight size={17} aria-hidden="true" /></Link></footer></div></section>
    </div>
    <Link className="how-plan-return how-text-action" href={href('plan')} prefetch={false}>View saved home tasks in My Week <ArrowRight size={17} aria-hidden="true" /></Link>
  </section>;
}
