'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

const sections = { tests: { name: 'Tests' }, maintenance: { name: 'Maintenance' }, food: { name: 'Food and Garden' }, summary: { name: 'Summary' } };
export default function HomeguardWorkspace({ section, href }: { section: HomeSection; href: (tab: string, destination?: string) => string }) {
  const search = useSearchParams(); const router = useRouter(); const state = useHomeWorkspace();
  const didOpen = useRef(false);
  const view = /^[a-z][a-z0-9-]{0,45}$/.test(search.get('homeView') ?? '') ? search.get('homeView')! : 'list';
  const recordId = /^[a-zA-Z0-9_-]{1,100}$/.test(search.get('record') ?? '') ? search.get('record')! : undefined;
  const fromFactor = search.get('fromFactor');
  const factor = fromFactor && ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'].includes(fromFactor) ? fromFactor as FactorKey : undefined;
  const go: WorkspaceProps['go'] = (destination, nextView = 'list', id) => {
    const url = new URL(href('home', destination), window.location.origin);
    if (nextView !== 'list') url.searchParams.set('homeView', nextView);
    if (id) url.searchParams.set('record', id);
    if (factor && destination === section) url.searchParams.set('fromFactor', factor);
    router.push(url.pathname + url.search, { scroll: false });
  };
  useEffect(() => {
    const isFirstOpen = !didOpen.current;
    didOpen.current = true;
    const frame = requestAnimationFrame(() => {
      // Do not steal an early keyboard interaction while the first page hydrates.
      const active = document.activeElement;
      if (isFirstOpen && active instanceof HTMLElement && active.matches('button, a, input, select, textarea, summary')) return;
      const heading = document.querySelector<HTMLElement>('[data-home-heading]');
      heading?.focus({ preventScroll: true }); (heading?.closest('.hg-intro') ?? heading)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, view, recordId]);
  const props: WorkspaceProps = { view, recordId, factor, go, navigate: (next, id) => go(section, next, id) };
  return <WorkspaceArtworkProvider kind={workspaceArtwork(section, view)}><div className="hg-workspace" data-home-section={section} data-home-view={view}>
    <div className="hg-workspace-nav">
    <Link className="hg-back" href={href('home')}><ArrowLeft size={17} />Back to Homeguard</Link>
    <div className="hg-workspace-select"><label><span>Home workspace</span><select value={section} onChange={event => go(event.target.value as HomeSection)}>{(Object.keys(sections) as HomeSection[]).map(key => <option value={key} key={key}>{sections[key].name}</option>)}</select></label></div>
    </div>{view !== 'list' && <button className="hg-back" onClick={() => go(section)}>Workspace overview</button>}
    <details className="hg-session-note"><summary>Design preview · Sample records only</summary><p>Try the actions with fictional details. Changes reset on reload, and files are not uploaded. Food guide source links are real; local notices and test results are examples.</p></details>
    <WorkspaceFeedback />
    {state.scenario === 'stale' && <p className="hg-notice">Sample evidence is out of date. Review source dates before using it; your own records are shown separately.</p>}
    {state.scenario === 'offline' && <p className="hg-notice">Offline review: retained sample records can be read. Changes are not saved or queued.</p>}
    {state.scenario === 'loading' ? <div className="hg-empty" role="status"><span className="halo-spinner" /><h2>Opening your home workspace</h2><button className="hg-button-secondary" onClick={() => state.setScenario('ready')}>Finish loading sample</button></div> : state.scenario === 'error' ? <Empty title="This section could not load"><p>Your other home information is unchanged.</p><button className="hg-button" onClick={() => state.setScenario('ready')}>Retry sample section</button></Empty> : <div className="hg-content" key={`${section}:${view}:${recordId ?? ''}`}>{section === 'tests' ? <TestsWorkspace {...props} /> : section === 'maintenance' ? <MaintenanceWorkspace {...props} /> : section === 'food' ? <FoodGardenWorkspace {...props} /> : <SummaryWorkspace {...props} />}</div>}
  </div></WorkspaceArtworkProvider>;
}
