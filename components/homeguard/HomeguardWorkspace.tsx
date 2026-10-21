'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import HaloLoading from '@/components/ui/HaloLoading';
import { ArrowLeft } from 'lucide-react';
import TestsWorkspace from './TestsWorkspace';
import MaintenanceWorkspace from './MaintenanceWorkspace';
import FoodGardenWorkspace from './FoodGardenWorkspace';
import SummaryWorkspace from './SummaryWorkspace';
import { useHomeWorkspace } from './HomeWorkspaceState';
import { Empty, type HomeSection, type WorkspaceProps } from './HomeWorkspaceUI';
import type { FactorKey } from '@/lib/frontend/factor-preview';
import './homeguard-workspace.css';
import WorkspaceFeedback from '@/components/expanded/WorkspaceFeedback';
import { WorkspaceArtworkProvider, workspaceArtwork } from './WorkspaceArtwork';
import './workspace-editorial.css';
import { collectionsOff, homeguardOffMessage } from '@/lib/frontend/collection-availability';

const sections = { tests: { name: 'Tests' }, maintenance: { name: 'Home care' }, food: { name: 'Food and Garden' }, summary: { name: 'Summary' } };
export default function HomeguardWorkspace({ section, href }: { section: HomeSection; href: (tab: string, destination?: string) => string }) {
  const search = useSearchParams(); const router = useRouter(); const state = useHomeWorkspace();
  const didOpen = useRef(false);
  const previousSection = useRef(section);
  const view = /^[a-z][a-z0-9-]{0,45}$/.test(search.get('homeView') ?? '') ? search.get('homeView')! : 'list';
  const recordId = /^[a-zA-Z0-9_-]{1,100}$/.test(search.get('record') ?? '') ? search.get('record')! : undefined;
  const fromFactor = search.get('fromFactor');
  const factor = fromFactor && ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'].includes(fromFactor) ? fromFactor as FactorKey : undefined;
  const requiredCollections = section === 'tests' ? ['tests', 'gardens'] : section === 'maintenance' ? ['assets', 'observations', 'tests'] : section === 'summary' ? ['tests', 'assets', 'observations', 'gardens'] : ['gardens', 'pantryItems', 'foodQuestions', 'fishNotes', 'foodFollows', 'growerInquiries', 'usage', 'tests'];
  const pendingCollections = state.mode === 'production' ? requiredCollections.filter(key => !state.collectionStates[key] || state.collectionStates[key].status === 'loading') : [];
  // A ready auxiliary collection must not turn still-pending tests into an empty list.
  // Other ready collections remain usable while their independent reads finish.
  const productionLoading = pendingCollections.length > 0 && (requiredCollections.every(key => !state.collections[key]) || section === 'tests' && pendingCollections.includes('tests') && !state.collections.tests);
  // A switched-off capability (503 feature_unavailable) is settled: say so once, with no retry.
  const productionFailure = state.mode === 'production' && requiredCollections.find(key => state.collectionStates[key]?.status === 'error' && !state.collectionStates[key].featureUnavailable);
  const productionOff = state.mode === 'production' && collectionsOff(state.collectionStates, requiredCollections);
  const incomplete = state.mode === 'production' && requiredCollections.some(key => state.collectionStates[key]?.status === 'ready' && !state.collectionStates[key].complete);
  const go: WorkspaceProps['go'] = (destination, nextView = 'list', id) => {
    const url = new URL(href('home', destination), window.location.origin);
    if (nextView !== 'list') url.searchParams.set('homeView', nextView);
    if (id) url.searchParams.set('record', id);
    if (factor && destination === section) url.searchParams.set('fromFactor', factor);
    router.push(url.pathname + url.search, { scroll: false });
  };
  useEffect(() => {
    const isFirstOpen = !didOpen.current;
    const sectionChanged = previousSection.current !== section;
    const frame = requestAnimationFrame(() => {
      // Record the entry only once it is handled: a cancelled frame (Strict Mode's
      // effect replay, or a quick re-render) must not turn first entry into a revisit.
      didOpen.current = true;
      previousSection.current = section;
      // Preserve early keyboard/pointer focus, including a scrollable table. A
      // new route's heading must not interrupt an already focused control.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('button, a, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]') && (isFirstOpen || active.closest('.hg-content'))) return;
      const heading = document.querySelector<HTMLElement>('[data-home-heading]');
      heading?.focus({ preventScroll: true });
      // Keep the workspace switcher and return path in view on entry. Within a
      // workspace, bring the requested record/editor into view instead.
      const target = isFirstOpen || sectionChanged
        ? document.querySelector('.hg-workspace-nav')
        : heading?.closest('.hg-intro') ?? heading;
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, view, recordId]);
  const props: WorkspaceProps = { view, recordId, factor, go, navigate: (next, id) => go(section, next, id) };
  return <WorkspaceArtworkProvider kind={workspaceArtwork(section, view)}><div className="hg-workspace" data-home-section={section} data-home-view={view}>
    <div className="hg-workspace-nav">
    <Link className="hg-back" href={href('home')}><ArrowLeft size={17} />Back to Homeguard</Link>
    <div className="hg-workspace-select"><label><span>Home workspace</span><select value={section} onChange={event => go(event.target.value as HomeSection)}>{(Object.keys(sections) as HomeSection[]).map(key => <option value={key} key={key}>{sections[key].name}</option>)}</select></label></div>
    </div>{view !== 'list' && <button className="hg-back" onClick={() => go(section)}>Workspace overview</button>}
    <WorkspaceFeedback />
    {productionFailure && <div className="hg-error" role="alert"><p>{state.collectionStates[productionFailure].message || 'Some records could not load. Your other records are unchanged.'}</p><button className="hg-button-secondary" onClick={() => void state.retry(productionFailure)}>Try again</button></div>}
    {productionOff && <p className="hg-notice" role="status">{homeguardOffMessage}</p>}
    {!productionLoading && pendingCollections.length > 0 && <HaloLoading label="Loading remaining home records" />}
    {incomplete && <p className="hg-notice">Some records are not included in this view. Reload the complete collection before exporting or clearing it.</p>}
    {state.scenario === 'stale' && <p className="hg-notice">Some sources are out of date. Check their original dates.</p>}
    {state.scenario === 'offline' && <p className="hg-notice">Offline. Saved records are available to read. Changes are not queued.</p>}
    {state.scenario === 'loading' || productionLoading ? <div className="hg-empty"><HaloLoading layout="panel" label="Opening your home workspace" />{state.mode === 'preview' && <button className="hg-button-secondary" onClick={() => state.setScenario('ready')}>Try again</button>}</div> : state.scenario === 'error' ? <Empty title="This section could not load"><p>Your other home information is unchanged.</p><button className="hg-button" onClick={() => state.setScenario('ready')}>Try again</button></Empty> : <div className="hg-content" key={`${section}:${view}:${recordId ?? ''}`}>{section === 'tests' ? <TestsWorkspace {...props} /> : section === 'maintenance' ? <MaintenanceWorkspace {...props} /> : section === 'food' ? <FoodGardenWorkspace {...props} /> : <SummaryWorkspace {...props} />}</div>}
  </div></WorkspaceArtworkProvider>;
}
