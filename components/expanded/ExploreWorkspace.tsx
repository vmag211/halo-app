'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, FileText, Mail } from 'lucide-react';
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
import ExploreCompanion from './ExploreCompanion';
import { exploreSections, type ExploreSection } from '@/lib/frontend/explore-preview';
import './explore.css';

type Props = { destination?: string; href: (tab: string, destination?: string) => string; mapHref: (layer: string) => string };
type Go = (section?: ExploreSection, view?: string, id?: string) => void;
const descriptions: Record<ExploreSection, string> = {
  opportunities: 'Local groups, real routes to join, and your next commitment.',
  organizations: 'Local groups and volunteering, together.',
  community: 'Understand the evidence. Choose what to do next.',
  projects: 'Make something useful. Know how to do it.',
  observations: 'Your notebook, connected to what you do.',
  outreach: 'Find the responsible source and prepare a useful question.',
};
export default function ExploreWorkspace({ destination, href, mapHref }: Props) {
  const router = useRouter(); const query = useSearchParams(); const workspace = useHomeWorkspace(); const heading = useRef<HTMLHeadingElement>(null);
  const section = destination && Object.hasOwn(exploreSections, destination) ? destination === 'organizations' ? 'opportunities' : destination as ExploreSection : undefined;
  const view = destination === 'organizations' ? 'list' : query.get('exploreView') ?? 'list'; const id = query.get('exploreRecord') ?? '';
  const go: Go = (next, nextView = 'list', record) => router.push(`${href('act', next)}${nextView !== 'list' ? `&exploreView=${encodeURIComponent(nextView)}` : ''}${record ? `&exploreRecord=${encodeURIComponent(record)}` : ''}`);
  useEffect(() => { if (section) heading.current?.focus({ preventScroll: true }); }, [section, view, id]);
  return <div className="halo-explore" data-explore-section={section ?? 'overview'}>
    {section && <button className="ex-back" onClick={() => go()}><ArrowLeft size={17} aria-hidden="true" />Back to Explore</button>}
    <header className="ex-intro"><span className="ex-kicker">{section ? 'Explore, put into practice' : 'A little action, closer to home'}</span><h2 ref={heading} tabIndex={-1}>{section ? exploreSections[section] : 'Make a difference, nearby.'}</h2><p>{section ? descriptions[section] : 'Find your people. Make something useful. Keep going.'}</p></header>
    {section && <nav className="ex-subnav ex-focused-nav" aria-label="Explore sections"><button onClick={() => go()}>Discover</button><button aria-current={section === 'opportunities' ? 'page' : undefined} onClick={() => go('opportunities')}>Get involved</button><button aria-current={section === 'projects' ? 'page' : undefined} onClick={() => go('projects')}>Projects</button></nav>}
    <ExploreCompanion context={section ? exploreSections[section] : 'Explore'} go={go} />
    <details className="ex-sample"><summary>About this preview</summary><p>Official guidance and resource links are real. Your records and actions are visit-local samples, not account storage. Local lookup, AI and email are not connected.</p></details>
    {workspace.message && <p className="ex-notice" role="status">{workspace.message}</p>}
    {workspace.scenario === 'offline' && <p className="ex-notice">Offline sample view. Notes remain readable; saves are unavailable. Official links need a connection.</p>}
    {workspace.scenario === 'loading' || workspace.scenario === 'error' ? <div className="ex-empty" role="status"><h3>{workspace.scenario === 'loading' ? 'Opening Explore' : 'Explore could not load'}</h3><p>Your drafts stay in this visit.</p><button className="ex-button" onClick={() => workspace.setScenario('ready')}>Retry sample view</button></div>
      : section === 'opportunities' ? <>{view === 'list' ? <><VolunteeringFinder go={go} /><VolunteerCommitments go={go} /></> : <VolunteerCommitments go={go} view={view} id={id} />}</>
      : section === 'projects' ? <ExploreProjects go={go} view={view} id={id} href={href} />
      : section === 'community' ? <CommunityGuide go={go} mapHref={mapHref} href={href} />
      : section === 'outreach' ? <ExploreOutreach />
      : section === 'observations' ? <ExploreNotes go={go} view={view} id={id} mapHref={mapHref} />
      : <ExploreOverview go={go} href={href} mapHref={mapHref} />}
    {section !== 'outreach' && <aside className="ex-contact-utility"><Mail size={17} aria-hidden="true" /><span>Need an answer from someone local?</span><button onClick={() => go('outreach')}>Ask a question <ArrowRight size={16} aria-hidden="true" /></button></aside>}
    <ExplorePhotoCredits />
  </div>;
}

function ExploreOverview({ go, href, mapHref }: { go: Go; href: Props['href']; mapHref: Props['mapHref'] }) {
  const state = useExpandedPreview(); const saved = state?.actions.filter(action => action.key.startsWith('explore:') && action.state !== 'completed') ?? [];
  return <>
    <ExploreContinuations go={go} />
    <section className="ex-action-hub" aria-label="Choose how to help"><div className="ex-photo-paths">
      <button className="ex-volunteer-path" onClick={() => go('opportunities')}><ExplorePhoto scene="trail" /><span><small>WITH YOUR COMMUNITY</small><strong>Get involved</strong><small>Cleanups, gardens and local groups. Find a real route to join.</small><span className="ex-inline-link">Find volunteering <ArrowRight size={17} aria-hidden="true" /></span></span></button>
      <button className="ex-help-path" onClick={() => go('projects')}><ExplorePhoto scene="garden" /><span><small>ON YOUR OWN OR TOGETHER</small><strong>Projects</strong><small>Native planting, bee houses, cleanups and solar experiments.</small><span className="ex-inline-link">Choose a project <ArrowRight size={17} aria-hidden="true" /></span></span></button>
    </div></section>
    <section className="ex-area-workbench" aria-label="Your area"><div className="ex-area-workbench-head"><h3>Know your surroundings</h3><ExploreAreaChooser /></div><ExploreMapPreview mapHref={mapHref} /><button className="ex-community-bridge" onClick={() => go('community')}><ExplorePhoto scene="river" /><span><BookOpen size={20} aria-hidden="true" /><strong>What does it mean for my community?</strong><small>Understand water, air and local evidence, then choose a useful next step.</small></span><ChevronRight size={18} aria-hidden="true" /></button></section>
    {saved.length > 0 && <details className="ex-disclosure"><summary>My saved next steps ({saved.length})</summary>{saved.map(action => <button key={action.id} className="ex-text-button" onClick={() => state?.open(action)}>{action.title} <ArrowRight size={16} aria-hidden="true" /></button>)}<Link href={href('plan')}>Open My Week</Link></details>}
    <Link className="ex-summary-link" href={href('home', 'summary')}><FileText size={18} aria-hidden="true" /><span>Bring your records together<small>Create a household summary</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
  </>;
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
