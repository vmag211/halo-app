'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, FileText, Mail, MoreHorizontal, NotebookPen } from 'lucide-react';
import { useExpandedPreview } from './ExpandedPreviewState';
import { useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { ExplorePhoto, ExplorePhotoCredits } from './ExploreVisuals';
import { CommunityGuide, ExploreAreaChooser } from './ExploreDiscovery';
import ExploreOpportunities, { GetInvolvedPreview } from './ExploreOpportunities';
import ExploreOutreach from './ExploreOutreach';
import ExploreNotes from './ExploreNotes';
import ExploreMapPreview from './ExploreMapPreview';
import ExploreContinuations from './ExploreContinuations';
import VolunteerCommitments from './ExploreVolunteer';
import ExploreProjects, { PersonalizedProjectsPreview } from './ExploreProjects';
import WorkspaceFeedback from './WorkspaceFeedback';
import LunaActionReviewControls from './LunaActionReviewControls';
import { exploreSections, type ExploreSection } from '@/lib/frontend/explore-preview';
import './explore.css';
import './explore-workbench.css';
import './explore-refinement.css';

type Props = { destination?: string; href: (tab: string, destination?: string) => string; mapHref: (layer: string) => string; environmentAvailable?: boolean };
type Go = (section?: ExploreSection, view?: string, id?: string) => void;
export default function ExploreWorkspace({ destination, href, mapHref, environmentAvailable = true }: Props) {
  const router = useRouter(); const query = useSearchParams(); const workspace = useHomeWorkspace(); const heading = useRef<HTMLHeadingElement>(null);
  const navigationRevision = useRef(0);
  const section = destination && Object.hasOwn(exploreSections, destination) ? destination === 'organizations' ? 'opportunities' : destination as ExploreSection : undefined;
  const view = destination === 'organizations' ? 'list' : query.get('exploreView') ?? 'list'; const id = query.get('exploreRecord') ?? '';
  const showArea = !section || section === 'community' || (view === 'list' && (section === 'opportunities' || section === 'projects'));
  const go: Go = (next, nextView = 'list', record) => {
    // Record intent before the asynchronous route transition can finish.
    navigationRevision.current++;
    router.push(`${href('act', next)}${nextView !== 'list' ? `&exploreView=${encodeURIComponent(nextView)}` : ''}${record ? `&exploreRecord=${encodeURIComponent(record)}` : ''}`);
  };
  const captureNavigation = () => {
    const revision = navigationRevision.current;
    return () => navigationRevision.current === revision;
  };
  useEffect(() => { if (section) heading.current?.focus({ preventScroll: true }); }, [section, view, id]);
  return <div className="halo-explore" data-explore-section={section ?? 'overview'}>
    <header className="ex-workbench-header">
      <div className="ex-workbench-bar">
        {section && <button className="ex-back" onClick={() => go()} aria-label="Back to Explore"><ArrowLeft size={18} aria-hidden="true" /></button>}
        <div className="ex-area-slot">{showArea && <ExploreAreaChooser />}</div>
        <div className="ex-header-utilities">{section !== 'observations' && <button className="ex-notebook-entry" onClick={() => go('observations')} aria-label="Open my notes"><NotebookPen size={20} aria-hidden="true" /></button>}<ExploreResources go={go} href={href} /></div>
      </div>
      {section && <h2 className="ex-section-title" ref={heading} tabIndex={-1}>{exploreSections[section]}</h2>}
    </header>
    <WorkspaceFeedback />
    {workspace.scenario === 'offline' && <p className="ex-offline" role="status">Offline. Read your notes; reconnect to save or open official links.</p>}
    {workspace.scenario === 'loading' || workspace.scenario === 'error' ? <div className="ex-empty" role="status"><h3>{workspace.scenario === 'loading' ? 'Opening Explore' : 'Explore could not load'}</h3><p>Your drafts are kept.</p><button className="ex-button" onClick={() => workspace.setScenario('ready')}>Try again</button></div>
      : section === 'opportunities' ? <>{view === 'list' ? <><ExploreOpportunities go={go} href={href} /><details className="ex-opportunity-programs"><summary>My volunteering</summary><VolunteerCommitments go={go} /></details></> : <VolunteerCommitments go={go} view={view} id={id} />}</>
      : section === 'projects' ? <ExploreProjects go={go} view={view} id={id} href={href} environmentAvailable={environmentAvailable} />
      : section === 'community' ? <CommunityGuide go={go} mapHref={mapHref} href={href} />
      : section === 'outreach' ? <ExploreOutreach />
      : section === 'observations' ? <ExploreNotes go={go} view={view} id={id} mapHref={mapHref} captureNavigation={captureNavigation} />
      : <ExploreOverview go={go} mapHref={mapHref} environmentAvailable={environmentAvailable} />}
  </div>;
}

function ExploreOverview({ go, mapHref, environmentAvailable }: { go: Go; mapHref: Props['mapHref']; environmentAvailable: boolean }) {
  return <>
    <div className="ex-overview-heading"><h2>Find your next step.</h2><p>Make something useful. Join in nearby.</p></div>
    <div className="ex-fieldwork-layout">
      <GetInvolvedPreview go={go} />
      <PersonalizedProjectsPreview go={go} environmentAvailable={environmentAvailable} />
      <div className="ex-place-context"><ExploreMapPreview mapHref={mapHref} /><button className="ex-community-bridge" onClick={() => go('community')} aria-label="Understand your community: water, air and public records"><ExplorePhoto scene="river" /><span><BookOpen size={17} aria-hidden="true" /><strong>Understand your community</strong><small>Water, air and public records</small></span><ChevronRight size={17} aria-hidden="true" /></button></div>
    </div>
    <ExploreContinuations go={go} />
  </>;
}

function ExploreResources({ go, href }: { go: Go; href: Props['href'] }) {
  const state = useExpandedPreview(); const menu = useRef<HTMLDetailsElement>(null); const [open, setOpen] = useState(false);
  const saved = state?.actions.filter(action => action.key.startsWith('explore:') && action.state !== 'completed') ?? [];
  const close = () => { if (menu.current) menu.current.open = false; };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); menu.current?.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <details className="ex-resources" ref={menu} onToggle={event => setOpen(event.currentTarget.open)}><summary aria-label="Explore resources"><MoreHorizontal size={21} aria-hidden="true" /></summary><div className="ex-resource-menu"><button onClick={() => { close(); go('outreach'); }}><Mail size={17} aria-hidden="true" />Ask a question<ChevronRight size={16} aria-hidden="true" /></button><Link href={href('plan')} onClick={close}><ArrowRight size={17} aria-hidden="true" />My saved next steps{saved.length > 0 && <span>{saved.length}</span>}</Link><Link href={href('home', 'summary')} onClick={close}><FileText size={17} aria-hidden="true" />Household summary<ChevronRight size={16} aria-hidden="true" /></Link><ExplorePhotoCredits /></div></details>;
}

export function ExploreReviewControls() {
  const workspace = useHomeWorkspace();
  const [sendScenario, setSendScenario] = useHomeDraft('explore:send-scenario', 'submitted');
  const [reconcile, setReconcile] = useHomeDraft('explore:send-reconcile', 'unknown');
  const [lunaState, setLunaState] = useHomeDraft('luna:review-state', 'ready');
  const [failPreparation, setFailPreparation] = useHomeDraft('luna:preparation-failure', false);
  const [generationState, setGenerationState] = useHomeDraft('explore:generation-review-state', 'ready');
  return <>
    <label>Assistant service review state<select value={lunaState} onChange={event => setLunaState(event.target.value)}>{['ready','no-source','unavailable','unconfigured','rate-limit','slow'].map(value => <option key={value}>{value}</option>)}</select></label>
    <LunaActionReviewControls />
    <label><input type="checkbox" checked={failPreparation} onChange={event => setFailPreparation(event.target.checked)} />Simulate project preparation save failure</label>
    <label>Project generation review state<select value={generationState} onChange={event => setGenerationState(event.target.value)}>{['ready','failed','slow'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Explore workspace state<select value={workspace.scenario} onChange={event => workspace.setScenario(event.target.value as typeof workspace.scenario)}>{['ready', 'empty', 'loading', 'error', 'offline', 'stale', 'conflict', 'save-error'].map(value => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select></label>
    <label>Email preview outcome<select value={sendScenario} onChange={event => setSendScenario(event.target.value)}><option value="submitted">Submitted (simulated)</option><option value="failed">Failed (simulated)</option><option value="unknown">Outcome unknown (simulated)</option></select></label>
    <label>Email attempt check outcome<select value={reconcile} onChange={event => setReconcile(event.target.value)}><option value="unknown">Still unknown (simulated)</option><option value="submitted">Submission recorded (simulated)</option><option value="not-submitted">No submission recorded (simulated)</option></select></label>
  </>;
}
