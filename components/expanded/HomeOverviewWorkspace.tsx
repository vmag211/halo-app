'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, ClipboardList, Droplets, FileText, Fish, Plus, Refrigerator, Sprout, Wrench } from 'lucide-react';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { testStatusLabels, type TestRecord } from '@/lib/frontend/home-test-preview';
import type { HomeAsset, MoistureObservation } from '@/lib/frontend/home-maintenance-preview';
import type { GardenSite } from '@/lib/frontend/home-food-preview';
import './home-overview.css';

type Href = (tab: string, destination?: string) => string;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
function RecordDate({ value }: { value: string }) {
  const day = value.slice(0, 10); const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return <span>Date unavailable</span>;
  const full = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone:'UTC' }).format(date);
  return <time dateTime={day} title={full} aria-label={full}>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone:'UTC' }).format(date)}</time>;
}

function TestContinuation({ record, href }: { record:TestRecord; href:string }) {
  const stages=[{label:'Arranged',recorded:record.arrangedByUser===true},{label:'Collected',recorded:!!record.collectionStart},{label:'Result',recorded:record.rows.length>0}];
  return <aside className="how-continue" aria-label="Continue your home task"><div className="how-record-line"><span><strong>{record.title}</strong><small>{testStatusLabels[record.status]}</small></span><Link className="how-action" aria-label="Continue test" href={href} prefetch={false}>Continue <ArrowRight size={17} aria-hidden="true" /></Link></div><details className="how-stage-details"><summary aria-label="Stages recorded">Stages <span>{stages.filter(stage=>stage.recorded).length} of {stages.length}</span></summary><ol className="how-test-track" aria-label={`Recorded milestones for ${record.title}`}>{stages.map(stage=><li key={stage.label} data-recorded={stage.recorded}><span aria-hidden="true" /><strong>{stage.label}</strong><small>{stage.recorded?'Recorded':'Not recorded'}</small></li>)}</ol></details></aside>;
}

export default function HomeOverviewWorkspace({ href }: { href: Href }) {
  const workspace = useHomeWorkspace();
  const addMenu = useRef<HTMLDetailsElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const closeAdd = () => { if (addMenu.current) addMenu.current.open = false; };
  useEffect(() => {
    if (!addOpen) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !addMenu.current?.contains(event.target)) closeAdd(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeAdd(); addMenu.current?.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [addOpen]);
  const unavailable = workspace.scenario === 'loading' || workspace.scenario === 'error';
  const tests = ((workspace.collections.tests ?? []) as TestRecord[]).filter(record => !record.archived);
  const active = tests.filter(record => ['draft', 'arranged', 'sampled', 'awaiting'].includes(record.status));
  const reports = tests.filter(record => record.rows.length > 0);
  const currentContext=workspace.collections.homeTransitions?.at(-1)?.id??'sample-current-home';
  const currentTest = active.find(record => record.contextId === currentContext) ?? (currentContext==='sample-current-home'?active[0]:undefined);
  const routines = ((workspace.collections.assets ?? []) as HomeAsset[]).filter(record => record.status !== 'replaced');
  const currentRecordIds=new Set(Object.values(workspace.collections).flat().filter(record=>!record.homeContextId||record.homeContextId===currentContext).map(record=>record.id));
  const nextRoutine = routines.filter(record => currentRecordIds.has(record.id) && record.status === 'active' && (record.snoozedUntil || record.nextDue)).sort((a, b) => (a.snoozedUntil || a.nextDue).localeCompare(b.snoozedUntil || b.nextDue))[0];
  const observations = (workspace.collections.observations ?? []) as MoistureObservation[];
  const recentObservation = observations.filter(record=>currentRecordIds.has(record.id)).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const gardens = (workspace.collections.gardens ?? []) as GardenSite[];
  const foods = workspace.collections.pantryItems ?? [];
  const lastSummary = workspace.drafts['summary-last-created'] as { at: string; pages: number } | undefined;
  const link = (destination: string, view?: string, id?: string) => `${href('home', destination)}${view ? `&homeView=${view}` : ''}${id ? `&record=${encodeURIComponent(id)}` : ''}`;
  return <section id="home-workspace" tabIndex={-1} className="halo-home-workspace" aria-labelledby="home-workspace-title">
    <header className="how-heading"><h2 id="home-workspace-title">Your home workspace</h2><details className="how-add-menu" ref={addMenu} onToggle={event => setAddOpen(event.currentTarget.open)}><summary aria-label="Add a home record"><Plus size={16} aria-hidden="true" />Add</summary><nav aria-label="Add home records"><Link href={link('tests','new')} prefetch={false} onClick={closeAdd}><ClipboardList size={16} aria-hidden="true" />Plan a test</Link><Link href={link('tests','report')} prefetch={false} onClick={closeAdd}><FileText size={16} aria-hidden="true" />Add a report</Link><Link href={link('maintenance','create')} prefetch={false} onClick={closeAdd}><Wrench size={16} aria-hidden="true" />Add routine</Link><Link href={link('maintenance','observation')} prefetch={false} onClick={closeAdd}><Droplets size={16} aria-hidden="true" />Record moisture</Link></nav></details></header>
    {unavailable ? <div className="how-notice" role="status"><p>{workspace.scenario === 'loading' ? 'Loading your home workspace.' : 'Your home records could not load.'}</p><button className="how-action" onClick={() => workspace.setScenario('ready')}>Try again</button></div> : <>
      {workspace.scenario === 'offline' && <p className="how-notice">Offline. Reconnect to save changes.</p>}
      {workspace.scenario === 'stale' && <p className="how-notice">Older records: check their source dates.</p>}
      {currentContext!=='sample-current-home'&&<p className="how-notice">Your record library includes previous homes.</p>}
    </>}
    <nav className="how-overview" aria-label="Home workspace features">
      <Link className="how-overview-row how-tests" aria-label="Open test records" href={link('tests')} prefetch={false}><ClipboardList size={22} aria-hidden="true" /><span><strong>Tests</strong><small>{unavailable ? 'Tests and reports' : `${active.length} active · ${plural(reports.length, 'report')}`}</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
      <Link className="how-overview-row how-care" aria-label="Open home care" href={link('maintenance')} prefetch={false}><Wrench size={22} aria-hidden="true" /><span><strong>Home care</strong><small>{unavailable ? 'Routines and moisture' : nextRoutine ? <>Scheduled <RecordDate value={nextRoutine.snoozedUntil || nextRoutine.nextDue} /></> : `${plural(routines.length, 'routine')} · ${plural(observations.length, 'observation')}`}</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
      <Link className="how-overview-row how-food" aria-label="Open Food and Garden" href={link('food')} prefetch={false}><Sprout size={22} aria-hidden="true" /><span><strong>Food and Garden</strong><small>{unavailable ? 'Kitchen, gardens, fish and water' : `${plural(foods.length, 'food')} · ${plural(gardens.length, 'site')}`}</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
      <Link className="how-overview-row how-summary" aria-label={lastSummary ? 'Create a new summary' : 'Create summary'} href={link('summary', 'selection')} prefetch={false}><FileText size={22} aria-hidden="true" /><span><strong>Summary</strong><small>{!unavailable && lastSummary ? <>PDF: <RecordDate value={lastSummary.at} /> · {plural(lastSummary.pages, 'page')}</> : 'Create a private PDF'}</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
    </nav>
    <details className="how-shortcuts"><summary>Quick access <ChevronRight size={15} aria-hidden="true" /></summary><div className="how-modules">
      <section className="how-workbench" aria-label="Records and home care">
      <section className="how-module how-tests" aria-label="Tests and records"><div className="how-module-heading"><ClipboardList size={23} aria-hidden="true" /><div><h3 id="how-tests-title">Current test</h3></div></div>
        {!unavailable && currentTest && <TestContinuation record={currentTest} href={link('tests','detail',currentTest.id)} />}
        {!unavailable && !currentTest && <p className="how-empty">{tests.length ? 'Open a report or prepare your next test.' : 'Start with a test you are planning or a report you already have.'}</p>}
      </section>
      <section className="how-module how-care" aria-label="Maintenance and moisture"><div className="how-module-heading"><Wrench size={23} aria-hidden="true" /><div><h3 id="how-care-title">Recent home care</h3></div></div>
        {!unavailable && <div className="how-care-list">{nextRoutine ? <Link href={link('maintenance', 'detail', nextRoutine.id)} prefetch={false}><Wrench size={18} aria-hidden="true" /><span><strong>{nextRoutine.title}</strong><small>Scheduled <RecordDate value={nextRoutine.snoozedUntil || nextRoutine.nextDue} /></small></span><ChevronRight size={17} aria-hidden="true" /></Link> : <p className="how-empty">{routines.length ? 'No active routine has a next date.' : 'Add a routine for the equipment you care for.'}</p>}{recentObservation ? <Link href={link('maintenance', 'observation-detail', recentObservation.id)} prefetch={false}><Droplets size={18} aria-hidden="true" /><span><strong>{recentObservation.title}</strong><small>Observed <RecordDate value={recentObservation.observedAt} /></small></span><ChevronRight size={17} aria-hidden="true" /></Link> : <p className="how-empty">Record dampness, a leak or a measured reading when you have one.</p>}</div>}
      </section>
      </section>
      <section className="how-module how-food" aria-labelledby="how-food-title"><div className="how-module-heading"><Sprout size={23} aria-hidden="true" /><div><h3 id="how-food-title">Food and Garden</h3></div></div><nav className="how-food-entries" aria-label="Food and Garden workspaces">
        {[{ title: 'Kitchen', label:'Your kitchen', description: unavailable ? 'Saved foods' : foods.length ? plural(foods.length, 'food') : 'Add food', view: 'pantry', Icon: Refrigerator }, { title: 'Gardens', label:'Your gardens', description: unavailable ? 'Your sites' : gardens.length ? plural(gardens.length, 'site') : 'Add site', view: 'gardens', Icon: Sprout }, { title: 'Fish', label:'Fish and waterways', description: 'Advisories', view: 'fish', Icon: Fish }, { title: 'Water', label:'Water stewardship', description: 'Notices & usage', view: 'water', Icon: Droplets }].map(({ title, label, description, view, Icon }) => <Link key={view} aria-label={label} href={link('food', view)} prefetch={false}><Icon size={21} strokeWidth={1.6} aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={15} aria-hidden="true" /></Link>)}
      </nav>{!unavailable && gardens[0] && <Link className="how-garden-return" aria-label={`Continue with ${gardens[0].title}`} href={link('food', 'garden-detail', gardens[0].id)} prefetch={false}><Sprout size={18} aria-hidden="true" /><span>{gardens[0].title}</span><small>Continue</small><ChevronRight size={17} aria-hidden="true" /></Link>}</section>
    </div>
    <Link className="how-plan-return how-text-action" aria-label="View saved home tasks in My Week" href={href('plan')} prefetch={false}>Saved home tasks <span>My Week</span><ArrowRight size={17} aria-hidden="true" /></Link>
    </details>
  </section>;
}
