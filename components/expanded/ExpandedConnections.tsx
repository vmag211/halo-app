'use client';

import Link from 'next/link';
import { ArrowUpRight, CalendarDays, MapPin, NotebookPen } from 'lucide-react';
import { destinations, followThrough, isDestination, type ExpandedDestination } from '@/lib/frontend/expanded-preview';
import type { FactorKey } from '@/lib/frontend/factor-preview';
import { useExpandedMode, useExpandedPreview } from './ExpandedPreviewState';
import './expanded.css';
import HomeguardWorkspace from '@/components/homeguard/HomeguardWorkspace';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { TestRecord } from '@/lib/frontend/home-test-preview';
import ExploreWorkspace from './ExploreWorkspace';
import MyWeekWorkspace from './MyWeekWorkspace';
import SettingsWorkspace,{type SettingsProps} from './SettingsWorkspace';

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
  if (home) return null;
  const saved = state.actions.filter(action => action.state !== 'completed')[0];
  return <section className="halo-expanded-section"><details className="halo-expanded-change"><summary>Understand changes in your readings</summary><p>{['no-data', 'offline-empty'].includes(scenario) ? 'There is not enough evidence to compare periods.' : 'Readings and source coverage can change independently. Open a factor to review its dates and sources.'}</p><p className="halo-f-meta">No comparison is available yet.</p></details><div className="halo-expanded-links"><Link href={href('plan')} prefetch={false}><CalendarDays size={22} /><span><strong>{saved ? saved.title : 'Make room for a useful next step'}</strong><small>{saved ? 'Continue in My Week' : 'Saved actions and your week, together'}</small></span><ArrowUpRight size={17} /></Link><Link href={href('plan', 'journal')} prefetch={false}><NotebookPen size={20} /><span>Optional daily check-in</span><ArrowUpRight size={17} /></Link></div></section>;
}

function HomeFactorRecords({ factor, href }: { factor: FactorKey; href: Href }) {
  const state = useHomeWorkspace();
  if (!['pfas', 'radon', 'lead'].includes(factor)) return null;
  const kind = factor === 'pfas' ? 'water' : factor;
  const records = (state.collections.tests ?? []) as TestRecord[];
  const currentContext=state.collections.homeTransitions?.at(-1)?.id??'sample-current-home';
  const matches = records.filter(record => record.kind === kind && record.contextId === currentContext && !record.archived);
  return <details className="halo-expanded-change"><summary>Your records ({matches.length})</summary><p>Your tests are separate from public readings and do not change the score.</p>{matches.map(record => <p key={record.id}><Link className="halo-text-button" href={`${href('home', 'tests')}&homeView=detail&record=${encodeURIComponent(record.id)}&fromFactor=${factor}`}>{record.title}</Link></p>)}<Link className="halo-text-button" href={`${href('home', 'tests')}&homeView=new&fromFactor=${factor}`}>Prepare a {kind} test record</Link></details>;
}

export function ExpandedDestinationPage({ destination, href, mapHref, environmentAvailable = true }: { destination: string; href: Href; mapHref: (layer: string) => string; environmentAvailable?: boolean }) {
  if (['journal','patterns','recap','outdoors'].includes(destination)) return <MyWeekWorkspace href={href} destination={destination} />;
  if (['community', 'organizations', 'opportunities', 'projects', 'outreach', 'observations'].includes(destination)) return <ExploreWorkspace destination={destination} href={href} mapHref={mapHref} environmentAvailable={environmentAvailable} />;
  if (destination === 'tests' || destination === 'maintenance' || destination === 'food' || destination === 'summary') return <HomeguardWorkspace section={destination} href={href} />;
  if (!isDestination(destination)) return <section className="halo-expanded-section"><h2>This destination is unavailable</h2><Link className="halo-text-button" href={href('today')}>Return to Today</Link></section>;
  const page = destinations[destination];
  return <section className="halo-expanded-section" aria-label={page.title}><Link className="halo-text-button" href={href(page.tab)}>Back to {page.tab === 'home' ? 'Homeguard' : page.tab === 'act' ? 'Explore' : 'My Week'}</Link><span className="halo-ph-kicker"></span><h2>{page.title}</h2><p>{page.description}</p><ol className="halo-expanded-outline">{page.steps.map(step => <li key={step}>{step}</li>)}</ol><aside className="halo-expanded-dependency"><strong>Still to build</strong><p>{page.dependency}</p></aside></section>;
}

export function ExpandedAct({ href, mapHref, environmentAvailable = true }: { href: Href; mapHref: (layer: string) => string; environmentAvailable?: boolean }) {
  return <ExploreWorkspace href={href} mapHref={mapHref} environmentAvailable={environmentAvailable} />;
}

export function ExpandedPlan({ href, scoreScenario }: { href: Href; scoreScenario?:string }) {
  return <MyWeekWorkspace href={href} scoreScenario={scoreScenario} />;
}

export function ExpandedSettings(props:SettingsProps) {return <SettingsWorkspace {...props}/>;}
