'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, CalendarDays, MapPin, NotebookPen } from 'lucide-react';
import { destinations, followThrough, isDestination, type ExpandedDestination, type PreviewAction } from '@/lib/frontend/expanded-preview';
import type { FactorKey } from '@/lib/frontend/factor-preview';
import { useExpandedMode, useExpandedPreview } from './ExpandedPreviewState';
import { usePreviewHousehold } from '@/components/foundation/PreviewHousehold';
import { homeMemberKeys, memberCatalog } from '@/lib/frontend/home-household';
import './expanded.css';
import HomeguardWorkspace from '@/components/homeguard/HomeguardWorkspace';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { TestRecord } from '@/lib/frontend/home-test-preview';
import HomeOverviewWorkspace from './HomeOverviewWorkspace';
import ExploreWorkspace from './ExploreWorkspace';

type Href = (tab: string, destination?: string) => string;
export function ExpandedConnections({ home, factor, household, href, mapHref, scenario }: {
  home: boolean; factor?: FactorKey; household?: boolean; href: Href; mapHref: (layer: string) => string; scenario: string;
}) {
  const enabled = useExpandedMode();
  const state = useExpandedPreview();
  if (!enabled || !state) return null;
  if (factor) {
    const connection = followThrough[factor];
    const owner = destinations[connection.destination as ExpandedDestination].tab;
    return <section className="halo-expanded-section" aria-label="Follow through"><span className="halo-ph-kicker">Put the guidance to use</span><h2>A next step, when you need it</h2><div className="halo-expanded-links">
      <Link href={`${href(owner, connection.destination)}&fromFactor=${factor}`} prefetch={false}><CalendarDays size={20} /><span>{connection.label}</span><ArrowUpRight size={17} /></Link>
      {connection.layer && <Link href={mapHref(connection.layer)} prefetch={false}><MapPin size={20} /><span>{home ? 'Explore regional evidence' : 'Explore air monitors'}</span><ArrowUpRight size={17} /></Link>}
      {!home && factor !== 'mold' && <Link href={href('plan', 'journal')} prefetch={false}><NotebookPen size={20} /><span>Optional daily check-in</span><ArrowUpRight size={17} /></Link>}
    </div><HomeFactorRecords factor={factor} href={href} /></section>;
  }
  if (household) return <section className="halo-expanded-section"><h2>Follow through together</h2><p>Find your saved tasks and scheduled follow-ups in My Week.</p><Link className="halo-text-button" href={href('plan')}>Open My Week</Link>{home && <Link className="halo-text-button" href={href('home', 'tests')}>Review home tests and records</Link>}</section>;
  if (home) return <HomeOverviewWorkspace href={href} />;
  const saved = state.actions.filter(action => action.state !== 'completed')[0];
  return <section className="halo-expanded-section"><details className="halo-expanded-change"><summary>Understand changes in your readings</summary><p>{['no-data', 'offline-empty'].includes(scenario) ? 'There is not enough evidence to compare periods.' : 'A changed reading, a newly published sample and changed source coverage mean different things. The new backend will distinguish these before HALO explains a change.'}</p><p className="halo-f-meta">No numerical change or cause has been inferred from this sample.</p></details><div className="halo-expanded-links"><Link href={href('plan')} prefetch={false}><CalendarDays size={22} /><span><strong>{saved ? saved.title : 'Make room for a useful next step'}</strong><small>{saved ? 'Continue in My Week' : 'Saved actions and your week, together'}</small></span><ArrowUpRight size={17} /></Link><Link href={href('plan', 'journal')} prefetch={false}><NotebookPen size={20} /><span>Optional daily check-in</span><ArrowUpRight size={17} /></Link></div></section>;
}

function HomeFactorRecords({ factor, href }: { factor: FactorKey; href: Href }) {
  const state = useHomeWorkspace();
  if (!['pfas', 'radon', 'lead'].includes(factor)) return null;
  const kind = factor === 'pfas' ? 'water' : factor;
  const records = (state.collections.tests ?? []) as TestRecord[];
  const matches = records.filter(record => record.kind === kind && record.contextId === 'sample-current-home' && !record.archived);
  return <details className="halo-expanded-change"><summary>Your sample records ({matches.length})</summary><p>These are your own test records, separate from the public evidence above. They do not alter this sample score.</p>{matches.map(record => <p key={record.id}><Link href={`${href('home', 'tests')}&homeView=detail&record=${encodeURIComponent(record.id)}&fromFactor=${factor}`}>{record.title}</Link></p>)}<Link className="halo-text-button" href={`${href('home', 'tests')}&homeView=new&fromFactor=${factor}`}>Prepare a {kind} test record</Link></details>;
}

export function ExpandedDestinationPage({ destination, href, mapHref, environmentAvailable = true }: { destination: string; href: Href; mapHref: (layer: string) => string; environmentAvailable?: boolean }) {
  if (['community', 'organizations', 'opportunities', 'projects', 'outreach', 'observations'].includes(destination)) return <ExploreWorkspace destination={destination} href={href} mapHref={mapHref} environmentAvailable={environmentAvailable} />;
  if (destination === 'tests' || destination === 'maintenance' || destination === 'food' || destination === 'summary') return <HomeguardWorkspace section={destination} href={href} />;
  if (!isDestination(destination)) return <section className="halo-expanded-section"><h2>This destination is unavailable</h2><Link href={href('today')}>Return to Today</Link></section>;
  const page = destinations[destination];
  return <section className="halo-expanded-section" aria-label={page.title}><Link className="halo-text-button" href={href(page.tab)}>Back to {page.tab === 'home' ? 'Homeguard' : page.tab === 'act' ? 'Explore' : 'My Week'}</Link><span className="halo-ph-kicker">Workflow outline · Not a finished screen</span><h2>{page.title}</h2><p>{page.description}</p><ol className="halo-expanded-outline">{page.steps.map(step => <li key={step}>{step}</li>)}</ol><aside className="halo-expanded-dependency"><strong>Still to build</strong><p>{page.dependency}</p></aside></section>;
}

export function ExpandedAct({ href, mapHref, environmentAvailable = true }: { href: Href; mapHref: (layer: string) => string; environmentAvailable?: boolean }) {
  return <ExploreWorkspace href={href} mapHref={mapHref} environmentAvailable={environmentAvailable} />;
}

export function ExpandedPlan({ href }: { href: Href }) {
  const state = useExpandedPreview();
  const [date, setDate] = usePlanDate();
  if (!state) return null;
  const dated = state.actions.filter(action => action.date === date);
  const unscheduled = state.actions.filter(action => !action.date);
  const row = (action: PreviewAction) => {
    return <article className="halo-expanded-agenda-row" key={action.id}><div><span className="halo-ph-kicker">{action.origin} · {action.state === 'completed' ? 'Completed by you' : action.state === 'waiting' ? 'Waiting' : 'Saved in this preview'}</span><h3>{action.title}</h3><button className="halo-text-button" onClick={() => state.open(action)}>View or edit action</button></div><select aria-label={`Status of ${action.title}`} value={action.state} onChange={e => state.changeState(action.id, e.target.value as PreviewAction['state'])}><option value="saved">Saved</option><option value="waiting">Waiting</option><option value="completed">Completed</option></select></article>;
  }
  return <section className="halo-expanded-section"><span className="halo-ph-kicker">One place for follow-through</span><h2>Your week, with room to breathe</h2><p>Your saved tasks and scheduled follow-ups appear here. No streaks, no automatic reminders.</p><label className="halo-expanded-date">Choose a day<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><h3>On this day</h3>{dated.length ? dated.map(row) : <p className="halo-expanded-empty">Nothing scheduled for this day in My Week.</p>}<h3>Saved for later</h3>{unscheduled.length ? unscheduled.map(row) : <p className="halo-expanded-empty">Save a follow-up from a test, home-care routine or another planning workflow. You can choose its date later.</p>}<details><summary>All dated actions ({state.actions.filter(action => action.date).length})</summary>{state.actions.filter(action => action.date).map(action => <div key={action.id}><time>{action.date}</time>{row(action)}</div>)}</details><div className="halo-expanded-links"><Link href={href('plan', 'outdoors')}><CalendarDays size={20} /><span>Plan time outdoors</span><ArrowUpRight size={17} /></Link><Link href={href('plan', 'journal')}><NotebookPen size={20} /><span>Journal and Patterns</span><ArrowUpRight size={17} /></Link></div><p className="halo-f-meta">This is the first shared-action review, not the full My Week feature. All sample actions disappear on reload. Recurrence, notifications, calendar exports and private records are not connected.</p></section>;
}

function usePlanDate() { return useState('2026-10-03'); }

export function ExpandedSettings({ offline }: { offline: boolean }) {
  const { bands, setBand } = usePreviewHousehold();
  const preview = useExpandedPreview();
  const draft = preview?.householdDraft ?? bands;
  const setDraft = preview?.setHouseholdDraft ?? (() => {});
  const [message, setMessage] = useState('');
  const dirty = homeMemberKeys.some(key => draft[memberCatalog[key].band] !== bands[memberCatalog[key].band]);
  return <section className="halo-expanded-section"><h2>Your household</h2><p>Choose the sample categories shown in the house. This review uses no real profile and does not save health information.</p><form className="halo-expanded-form" onSubmit={e => { e.preventDefault(); if (offline) return; homeMemberKeys.forEach(key => setBand(key, draft[memberCatalog[key].band])); setMessage('Sample household updated for this visit. Existing sample actions are unchanged.'); }}><fieldset className="halo-household-picker"><legend>Household categories</legend><div>{homeMemberKeys.map(key => <label key={key}><input type="checkbox" checked={draft[memberCatalog[key].band]} onChange={e => { setDraft({ ...draft, [memberCatalog[key].band]: e.target.checked }); setMessage(''); }} />{memberCatalog[key].label}</label>)}</div></fieldset><p role="status">{offline ? 'You are offline. Your changes remain in this form.' : dirty ? 'You have unsaved sample changes.' : message || 'Your sample choices are up to date.'}</p><button className="halo-primary" type="submit" disabled={offline || !dirty}>Save sample household</button><button className="halo-text-button" type="button" onClick={() => { setDraft(bands); setMessage('Changes cancelled.'); }}>Cancel changes</button></form><h2>Settings that grow with HALO</h2><p>Home details, explicit profile saves and device accessibility remain in the existing live Settings. Appearance follows your device.</p><ul><li>Notifications and followed sources</li><li>Privacy, data exports and separate Journal clearing</li><li>Reviewed language support and optional recovery</li><li>Sources, methods and feedback</li></ul><p className="halo-f-meta">These expanded sections still require their own design review and backend integration. No inactive toggle implies that they are enabled.</p></section>;
}
