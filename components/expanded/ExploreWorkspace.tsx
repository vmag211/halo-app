'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, FileText, Mail, NotebookPen, Search, Users } from 'lucide-react';
import { useExpandedPreview } from './ExpandedPreviewState';
import { useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { ExplorePhoto, ExplorePhotoCredits } from './ExploreVisuals';
import { CommunityGuide, ExploreAreaChooser, VolunteeringFinder } from './ExploreDiscovery';
import ExploreOutreach from './ExploreOutreach';
import ExploreNotes from './ExploreNotes';
import ExploreMapPreview from './ExploreMapPreview';
import ExploreContinuations from './ExploreContinuations';
import VolunteerCommitments from './ExploreVolunteer';
import ExploreProjects from './ExploreProjects';
import ExploreOutcome from './ExploreOutcome';
import { SaveExplore } from './ExploreShared';
import { exploreCauses, exploreSections, organizations, type ExploreSection } from '@/lib/frontend/explore-preview';
import './explore.css';

type Props = { destination?: string; href: (tab: string, destination?: string) => string; mapHref: (layer: string) => string };
type Go = (section?: ExploreSection, view?: string, id?: string) => void;
type DetailProps = { go: Go; view: string; id: string; href: Props['href']; mapHref: Props['mapHref'] };
const sectionDescriptions: Record<ExploreSection, string> = {
  opportunities: 'Find a way to give your time.',
  community: 'Understand the place you call home.',
  organizations: 'Get to know the people working on what matters.',
  projects: 'Practical steps, at your own pace.',
  observations: 'Your questions, observations and ideas.',
  outreach: 'Find the right contact. Start a useful conversation.',
};

export default function ExploreWorkspace({ destination, href, mapHref }: Props) {
  const router = useRouter(); const query = useSearchParams(); const workspace = useHomeWorkspace();
  const heading = useRef<HTMLHeadingElement>(null);
  const section = destination && Object.hasOwn(exploreSections, destination) ? destination as ExploreSection : undefined;
  const view = query.get('exploreView') ?? 'list'; const id = query.get('exploreRecord') ?? '';
  const go: Go = (next, nextView = 'list', record) => router.push(`${href('act', next)}${nextView !== 'list' ? `&exploreView=${encodeURIComponent(nextView)}` : ''}${record ? `&exploreRecord=${encodeURIComponent(record)}` : ''}`);
  useEffect(() => { if (section) heading.current?.focus({ preventScroll: true }); }, [section, view, id]);
  const detailProps = { go, view, id, href, mapHref };
  return <div className="halo-explore" data-explore-section={section ?? 'overview'}>
    {section && <button className="ex-back" onClick={() => go()}><ArrowLeft size={17} aria-hidden="true" />Back to Explore</button>}
    <header className="ex-intro"><h2 ref={heading} tabIndex={-1}>{section ? exploreSections[section] : 'Your community, your way.'}</h2><p>{section ? sectionDescriptions[section] : 'Understand your area. Find a way to help.'}</p></header>
    <details className="ex-sample"><summary>About this preview</summary><p>Notes and organization records are sample-only and reset on reload. Official resource links open separately. No local search, registration, AI processing or email sending occurs.</p></details>
    {section && <nav className="ex-subnav" aria-label="Explore sections">{(Object.keys(exploreSections) as ExploreSection[]).map(key => <button key={key} aria-current={key === section ? 'page' : undefined} onClick={() => go(key)}>{exploreSections[key]}</button>)}</nav>}
    {workspace.message && <p className="ex-notice" role="status">{workspace.message}</p>}
    {workspace.scenario === 'offline' && <p className="ex-notice">Offline sample view. Notes remain readable; saving and send previews are unavailable. Official links need a connection.</p>}
    {workspace.scenario === 'loading' || workspace.scenario === 'error' ? <div className="ex-empty" role="status"><h3>{workspace.scenario === 'loading' ? 'Opening Explore' : 'Explore could not load'}</h3><p>Your drafts stay in this visit.</p><button className="ex-button" onClick={() => workspace.setScenario('ready')}>Retry sample view</button></div>
      : section === 'opportunities' ? <>{view === 'list' ? <><VolunteeringFinder go={go} /><VolunteerCommitments go={go} /></> : <VolunteerCommitments go={go} view={view} id={id} />}</>
      : section === 'community' ? <CommunityGuide go={go} mapHref={mapHref} href={href} />
      : section === 'organizations' ? <ExploreOrganizations {...detailProps} />
      : section === 'projects' ? <ExploreProjects {...detailProps} />
      : section === 'outreach' ? <ExploreOutreach />
      : section === 'observations' ? <ExploreNotes go={go} view={view} id={id} mapHref={mapHref} />
      : <ExploreOverview go={go} href={href} mapHref={mapHref} />}
    <ExplorePhotoCredits />
  </div>;
}

function ExploreOverview({ go, href, mapHref }: { go: Go; href: Props['href']; mapHref: Props['mapHref'] }) {
  const state = useExpandedPreview();
  const saved = state?.actions.filter(action => action.key.startsWith('explore:') && action.state !== 'completed') ?? [];
  return <>
    <ExploreAreaChooser />
    <ExploreMapPreview mapHref={mapHref} />
    <section className="ex-hub-section"><h3>Get involved</h3><div className="ex-photo-paths">
      <button className="ex-volunteer-path" onClick={() => go('opportunities')}><ExplorePhoto scene="trail" /><span><strong>Volunteer</strong><small>Find opportunities with official organizers.</small><span className="ex-inline-link">Find your route <ArrowRight size={16} aria-hidden="true" /></span></span></button>
      <button className="ex-help-path" onClick={() => go('projects')}><ExplorePhoto scene="garden" /><span><strong>Ways to help</strong><small>A water question. A habitat idea. A small next step.</small><span className="ex-inline-link">Choose a project <ArrowRight size={16} aria-hidden="true" /></span></span></button>
    </div></section>
    <section className="ex-hub-section"><h3>Understand & connect</h3><div className="ex-paths">
      <button className="ex-hub-row" onClick={() => go('community')}><ExplorePhoto scene="river" className="ex-community-thumb" /><span className="ex-hub-icon"><BookOpen size={22} aria-hidden="true" /></span><span><strong>Your community</strong><small>Learn what the evidence means and what you can do.</small></span><ChevronRight size={18} aria-hidden="true" /></button>
      <button className="ex-hub-row" onClick={() => go('organizations')}><span className="ex-hub-icon"><Users size={22} aria-hidden="true" /></span><span><strong>Organizations</strong><small>Find a group, understand its work, and make contact.</small></span><ChevronRight size={18} aria-hidden="true" /></button>
    </div></section>
    <section className="ex-hub-section"><h3>Your space to follow through</h3><div className="ex-personal-paths ex-paths">
      <button className="ex-hub-row" onClick={() => go('observations')}><span className="ex-hub-icon"><NotebookPen size={22} aria-hidden="true" /></span><span><strong>My notes</strong><small>Connect observations, questions and follow-ups.</small></span><ChevronRight size={18} aria-hidden="true" /></button>
      <button className="ex-hub-row" onClick={() => go('outreach')}><span className="ex-hub-icon"><Mail size={22} aria-hidden="true" /></span><span><strong>Ask a question</strong><small>Ask for an answer, record a reply and act on it.</small></span><ChevronRight size={18} aria-hidden="true" /></button>
    </div></section>
    <ExploreContinuations go={go} />
    {saved.length > 0 && <section className="ex-feature"><h3>Pick up where you left off</h3>{saved.slice(0, 3).map(action => <button key={action.id} className="ex-text-button" onClick={() => state?.open(action)}>{action.title}<ChevronRight size={17} aria-hidden="true" /></button>)}<Link className="ex-text-button" href={href('plan')}>All saved steps in My Week</Link></section>}
    <Link className="ex-summary-link" href={href('home', 'summary')}><FileText size={20} aria-hidden="true" /><span>Bring your records together<small>Create a household summary</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
  </>;
}

function Facts({ rows }: { rows: [string, string][] }) { return <dl className="ex-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }
function Missing({ go }: { go: Go }) { return <div className="ex-empty"><h3>This item is unavailable</h3><p>Return to Explore to choose another item.</p><button className="ex-button" onClick={() => go()}>Back to Explore</button></div>; }

function ExploreOrganizations({ go, view, id, mapHref }: DetailProps) {
  const workspace = useHomeWorkspace();
  const [filters, setFilters] = useHomeDraft('explore:filters:organizations', { search: '', cause: 'All causes', area: 'All areas' });
  const [flag, setFlag] = useHomeDraft('explore:listing-feedback', '');
  if (view === 'detail') {
    const org = organizations.find(item => item.id === id);
    if (!org) return <Missing go={go} />;
    return <section className="ex-detail"><button className="ex-text-button" onClick={() => go('organizations')}>All organizations</button><span className="ex-kicker">{org.cause} · {org.area}</span><h3>{org.title}</h3><p>{org.mission}</p><div className="ex-about"><h4>What they do</h4><p>{org.activities}</p><h4>Access and participation</h4><p>{org.access}</p></div><p className="ex-notice">Fictional group, not verified. No contact details or official website are connected.</p><SaveExplore origin={`organization:${org.id}`} title={`Ask ${org.title} about getting involved`} reason="Confirm this group's actual scope and source before making contact." /><button className="ex-text-button" onClick={() => go('opportunities')}>Find volunteering routes</button><ExploreOutcome origin={`organization:${org.id}`} title="My connection with this group" goal={`Ask ${org.title} which supervised activities or resources fit my interest and access needs.`} mechanism="A reviewed conversation helps you find suitable stewardship work rather than guessing what a group offers." /><button className="ex-text-button" onClick={() => go('outreach')}>Prepare a question for a group</button><details className="ex-disclosure"><summary>Listing details and review</summary><Facts rows={[[ 'Service area', org.area ], [ 'Cause', org.cause ], [ 'Link checked', `${org.checked} (sample metadata)` ], [ 'Human verification', org.reviewed ]]} /><button className="ex-text-button" onClick={() => setFlag(`Review requested for ${org.title} in this sample visit. Nothing was sent.`)}>Flag listing for review</button>{flag && <p role="status">{flag}</p>}</details><Link className="ex-text-button" href={mapHref('')}>Explore regional context</Link></section>;
  }
  const matches = workspace.scenario === 'empty' ? [] : organizations.filter(item => `${item.title} ${item.mission} ${item.cause} ${item.area}`.toLowerCase().includes(filters.search.toLowerCase()) && (filters.cause === 'All causes' || item.cause === filters.cause) && (filters.area === 'All areas' || item.area === filters.area));
  const narrowed = filters.cause !== 'All causes' || filters.area !== 'All areas';
  return <><div className="ex-section-heading"><h3>People with a shared purpose.</h3><p>Look at what a group does, where it works and what has been verified before getting involved.</p></div><div className="ex-filters"><label>Search organizations<span className="ex-search"><Search size={18} aria-hidden="true" /><input type="search" placeholder="A cause, group or area" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></span></label><details className="ex-disclosure" open={narrowed}><summary>Narrow your search{narrowed ? ' (filters on)' : ''}</summary><div className="ex-filter-fields"><label>Cause<select value={filters.cause} onChange={event => setFilters({ ...filters, cause: event.target.value })}>{exploreCauses.map(cause => <option key={cause}>{cause}</option>)}</select></label><label>Area<select value={filters.area} onChange={event => setFilters({ ...filters, area: event.target.value })}>{['All areas', 'Example County', 'Another County', 'Outside sample coverage'].map(area => <option key={area}>{area}</option>)}</select></label></div><button className="ex-text-button" onClick={() => setFilters({ search: '', cause: 'All causes', area: 'All areas' })}>Reset filters</button></details></div><p className="ex-meta">Fictional directory examples, not live local search.</p><div className="ex-results">{matches.map(item => <button key={item.id} className="ex-result" onClick={() => go('organizations', 'detail', item.id)}><Users size={22} aria-hidden="true" /><span><small>{item.cause} · {item.area}</small><strong>{item.title}</strong><small>Fictional group, not verified</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</div>{!matches.length && <div className="ex-empty"><h3>{filters.area === 'Outside sample coverage' ? 'No sample coverage here' : 'No matching listings'}</h3><p>Broaden the cause or area to explore the sample directory.</p></div>}<button className="ex-text-button" onClick={() => go('opportunities')}>Browse official volunteering resources <ArrowRight size={16} aria-hidden="true" /></button></>;
}

export function ExploreReviewControls() {
  const workspace = useHomeWorkspace();
  const [sendScenario, setSendScenario] = useHomeDraft('explore:send-scenario', 'submitted');
  const [reconcile, setReconcile] = useHomeDraft('explore:send-reconcile', 'unknown');
  return <>
    <label>Explore workspace state<select value={workspace.scenario} onChange={event => workspace.setScenario(event.target.value as typeof workspace.scenario)}>{['ready', 'empty', 'loading', 'error', 'offline', 'stale', 'conflict', 'save-error'].map(value => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select></label>
    <label>Email preview outcome<select value={sendScenario} onChange={event => setSendScenario(event.target.value)}><option value="submitted">Submitted (simulated)</option><option value="failed">Failed (simulated)</option><option value="unknown">Outcome unknown (simulated)</option></select></label>
    <label>Email attempt check outcome<select value={reconcile} onChange={event => setReconcile(event.target.value)}><option value="unknown">Still unknown (simulated)</option><option value="submitted">Submission recorded (simulated)</option><option value="not-submitted">No submission recorded (simulated)</option></select></label>
  </>;
}
