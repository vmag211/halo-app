'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, BookOpen, CircleHelp, Hand, House, Info, Map as MapIcon, Notebook, Settings, Sunrise, WifiOff } from 'lucide-react';
import Button from '@/components/ui/Button';
import SeverityPill from '@/components/ui/SeverityPill';
import { AccordionRow, BottomSheet, Callout, Card, ConfidencePill, ContributionBar, EmptyState, ExpandableCard, ProvenancePill, RiskBar, ScoreRing, SegmentedControl, Skeleton, SwipeRow, Switch, ToggleChip, type ContributionSegment } from '@/components/ui/Foundation';
import { foundationScenarios, previewTabs, routeTitles, sampleFactors, tabLabels, type FoundationScenario, type PreviewRoute, type PreviewSheet } from '@/lib/frontend/foundation-preview';
import { foundationCopy as c } from '@/lib/frontend/copy/foundation-preview';
import { factorReadings, type FactorKey, type PreviewPreferences } from '@/lib/frontend/factor-preview';
import PersonalHero, { FactorDetail } from './PersonalHero';
import { SceneProvider, useSceneExperience } from './SceneExperience';
import EnvironmentalScene from './EnvironmentalScene';
import FamilyGuidance from './FamilyGuidance';
import { HomeMemberGuidance } from './HomeHousehold';
import { PreviewHouseholdPicker, usePreviewHousehold } from './PreviewHousehold';
import { homeMemberKeys, memberCatalog, type HomeMemberKey } from '@/lib/frontend/home-household';
import type { MotionMode, SceneTime } from '@/lib/frontend/scene-clock';
import LunaAssistant from './LunaAssistant';
import LunaMark from './LunaMark';

const tabIcons = { today: Sunrise, home: House, map: MapIcon, journal: Notebook, act: Hand };
const topics = ['pfas', 'radon', 'lead', 'air', 'pollen', 'uv', 'mold'];
const sections = [...new Set(foundationScenarios.map(s => s[1]))];
type SheetState = { type: PreviewSheet; height: 'standard' | 'tall' | 'content'; state?: 'loading' | 'error' | 'empty'; topic?: string; generic?: boolean };
type ToastState = { id: number; message: string; action?: () => void };

export default function FoundationPreview({ initialScenario, initialFactor, initialFamily = false, initialMember, preferences = {} }: { initialScenario: FoundationScenario; initialFactor?: FactorKey; initialFamily?: boolean; initialMember?: HomeMemberKey; preferences?: PreviewPreferences }) {
  const [scenario, setScenario] = useState(initialScenario);
  const [mode, setMode] = useState(preferences.appearance ?? 'system');
  const [scale, setScale] = useState(preferences.scale ?? '100');
  const [contrast, setContrast] = useState(preferences.contrast ?? false);
  const [motion, setMotion] = useState<MotionMode>(preferences.motion ?? 'system');
  const [time, setTime] = useState<SceneTime>(preferences.time ?? 'live');
  useEffect(() => {
    const url = new URL(window.location.href);
    // Only review settings live in the URL. No household information is persisted.
    url.searchParams.set('appearance', mode);
    url.searchParams.set('scale', scale);
    url.searchParams.set('motion', String(motion));
    url.searchParams.set('contrast', String(contrast));
    url.searchParams.set('time', time);
    window.history.replaceState(window.history.state, '', url);
  }, [mode, scale, motion, contrast, time]);
  function changeScenario(value: FoundationScenario) {
    const url = new URL(window.location.href);
    ['tab', 'sheet', 'learn'].forEach(key => url.searchParams.delete(key));
    url.searchParams.set('scenario', value);
    window.history.replaceState({ ...window.history.state, _foundationSheet: false }, '', url);
    setScenario(value);
  }
  return <div className="halo-f-review" data-mode={mode}>
    <details className="halo-f-review-tools">
      <summary>{c.review}</summary><p>{c.status}</p>
      <p>Today covers air quality, UV, pollen, and mold. PFAS belongs only to Homeguard and does not contribute to Today. Scores and contribution shares in this review are illustrative sample values, not live API results.</p>
      <label>{c.scenario}<select aria-label={c.scenario} value={scenario} onChange={e => changeScenario(e.target.value as FoundationScenario)}>{sections.map(section => <optgroup key={section} label={section}>{foundationScenarios.filter(s => s[1] === section).map(([key, , label]) => <option key={key} value={key}>{label}</option>)}</optgroup>)}</select></label>
      <div className="halo-f-tool-grid"><label>{c.appearance}<select aria-label={c.appearance} value={mode} onChange={e => setMode(e.target.value)}><option value="system">{c.system}</option><option value="light">{c.light}</option><option value="dark">{c.dark}</option></select></label><label>{c.scale}<select aria-label={c.scale} value={scale} onChange={e => setScale(e.target.value)}>{['100', '115', '130', '150'].map(n => <option key={n} value={n}>{n}%</option>)}</select></label></div>
      <div className="halo-f-tool-grid"><label>Animation<select aria-label="Animation" value={motion} onChange={e => setMotion(e.target.value as MotionMode)}><option value="system">Follow device preference</option><option value="full">Play animations</option><option value="reduce">Reduce motion</option></select></label><label>Scene lighting<select aria-label="Scene lighting" value={time} onChange={e => setTime(e.target.value as SceneTime)}><option value="live">Local clock</option><option value="dawn">Dawn</option><option value="day">Day</option><option value="dusk">Dusk</option><option value="night">Night</option></select></label></div>
      <div className="halo-f-tool-grid"><label className="halo-f-tool-check"><input type="checkbox" checked={contrast} onChange={e => setContrast(e.target.checked)} />{c.contrast}</label><label className="halo-f-tool-check"><input type="checkbox" checked={motion === 'reduce'} onChange={e => setMotion(e.target.checked ? 'reduce' : 'system')} />{c.motion}</label></div>
      <p>Scene lighting follows the device’s local clock, independently of app appearance. This is decorative scenery, not local weather or a sunrise forecast. Play animations overrides the device preference for this preview only.</p>
      <PreviewHouseholdPicker />
    </details>
    <SceneProvider mode={motion} time={time}><Product key={`${scenario}:${initialMember ?? initialFactor ?? (initialFamily ? 'family' : 'overview')}`} scenario={scenario} initialFactor={initialFactor} initialFamily={initialFamily} initialMember={initialMember} appearance={mode} scale={Number(scale) / 100} contrast={contrast} motion={motion} time={time} /></SceneProvider>
  </div>;
}

function startingRoute(scenario: FoundationScenario): PreviewRoute {
  const match = scenario.replace('shell-', '');
  return [...previewTabs, 'settings'].includes(match) ? match as PreviewRoute : 'today';
}
function startingSheet(scenario: FoundationScenario): SheetState | null {
  if (!scenario.startsWith('sheet-')) return null;
  if (scenario === 'sheet-tall') return { type: 'assistant', height: 'tall' };
  if (scenario === 'sheet-content') return { type: 'map', height: 'content' };
  const state = scenario.replace('sheet-', '');
  return { type: 'learn', height: 'standard', topic: 'air', state: ['loading', 'error', 'empty'].includes(state) ? state as SheetState['state'] : undefined };
}

function Product({ scenario, initialFactor, initialFamily, initialMember, appearance, scale, contrast, motion, time }: { scenario: FoundationScenario; initialFactor?: FactorKey; initialFamily?: boolean; initialMember?: HomeMemberKey; appearance: string; scale: number; contrast: boolean; motion: MotionMode; time: SceneTime }) {
  const router = useRouter();
  const experience = useSceneExperience();
  const factorTab = initialFactor ? (['pfas', 'radon', 'lead'].includes(initialFactor) ? 'home' : 'today') : undefined;
  const [route, setRoute] = useState<PreviewRoute>(initialMember ? 'home' : factorTab ?? startingRoute(scenario));
  const inDetail = !!(initialFactor || initialFamily || initialMember);
  const backTab = initialFamily ? 'today' : initialMember ? 'home' : route;
  function previewHref(tab: PreviewRoute, factor?: FactorKey) {
    const params = new URLSearchParams({ scenario, tab, appearance, scale: String(Math.round(scale * 100)), motion, time, contrast: String(contrast) });
    return `/foundation/preview${factor ? `/factor/${factor}` : ''}?${params}`;
  }
  const factorHref = (factor: FactorKey) => previewHref(['pfas', 'radon', 'lead'].includes(factor) ? 'home' : 'today', factor);
  const familyHref = previewHref('today').replace('/foundation/preview?', '/foundation/preview/family?');
  const memberHref = (member: HomeMemberKey) => previewHref('home').replace('/foundation/preview?', `/foundation/preview/household/${member}?`);
  const routeRef = useRef(route);
  const scrollMemory = useRef<Record<string, number>>({});
  const [sheet, setSheet] = useState<SheetState | null>(startingSheet(scenario));
  const sheetRef = useRef(sheet);
  useEffect(() => { routeRef.current = route; }, [route]);
  useEffect(() => { sheetRef.current = sheet; }, [sheet]);
  const sheetEntry = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastSequence = useRef(0);
  const [deleted, setDeleted] = useState(scenario === 'toast-undo');
  const [unread, setUnread] = useState(scenario === 'shell-no-alerts' ? 0 : scenario === 'shell-badge-cap' ? 12 : 3);
  const [expanded, setExpanded] = useState<string | null>(scenario === 'card-loading' || scenario === 'card-no-data' ? 'air' : null);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const assistantEnabled = scenario !== 'shell-no-assistant' && process.env.NEXT_PUBLIC_HALO_ASSISTANT !== 'off';
  const showToast = (message: string, action?: () => void) => setToast({ id: ++toastSequence.current, message, action });
  function mockRequest(onComplete: () => void) {
    setBusy(true); timers.current.push(setTimeout(() => { setBusy(false); onComplete(); }, 650));
  }
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 8000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (scenario === 'toast') setToast({ id: ++toastSequence.current, message: c.saved });
    if (scenario === 'toast-undo') setToast({ id: ++toastSequence.current, message: c.deleteConfirm, action: () => setDeleted(false) });
    const url = new URL(window.location.href);
    if (factorTab) { url.searchParams.set('tab', factorTab); window.history.replaceState(window.history.state, '', url); }
    else if (!initialMember && url.searchParams.has('tab') && [...previewTabs, 'settings'].includes(url.searchParams.get('tab') ?? '')) setRoute(url.searchParams.get('tab') as PreviewRoute);
    const learn = url.searchParams.get('learn');
    if (learn && topics.includes(learn)) { setSheet({ type: 'learn', height: 'standard', topic: learn, generic: !['air', 'uv', 'pollen', 'mold'].includes(learn) }); sheetEntry.current = false; }
    else if (url.searchParams.has('sheet')) { sheetEntry.current = !!window.history.state?._foundationSheet; }
    else if (window.history.state?._foundationClosedScenario === scenario) { setSheet(null); }
    else if (scenario === 'sheet-deep-link') { url.searchParams.set('learn', 'air'); window.history.replaceState({ ...window.history.state, _foundationSheet: false }, '', url); }
    else if (startingSheet(scenario)) {
      window.history.replaceState({ ...window.history.state, _foundationClosedScenario: scenario }, '', url);
      url.searchParams.set('sheet', startingSheet(scenario)!.type); window.history.pushState({ ...window.history.state, _foundationSheet: true }, '', url); sheetEntry.current = true;
    }
    const onBack = () => {
      const location = new URL(window.location.href);
      const tab = location.searchParams.get('tab');
      const nextRoute = factorTab ?? ([...previewTabs, 'settings'].includes(tab ?? '') ? tab as PreviewRoute : startingRoute(scenario));
      scrollMemory.current[routeRef.current] = window.scrollY;
      setRoute(nextRoute);
      const kind = location.searchParams.get('sheet') as PreviewSheet | null;
      setSheet(kind && ['learn', 'alerts', 'assistant', 'map'].includes(kind) ? { type: kind, height: kind === 'assistant' ? 'tall' : kind === 'map' ? 'content' : 'standard' } : null);
      sheetEntry.current = !!window.history.state?._foundationSheet;
      if (!kind) requestAnimationFrame(() => window.scrollTo(0, scrollMemory.current[nextRoute] ?? 0));
    };
    window.addEventListener('popstate', onBack); return () => window.removeEventListener('popstate', onBack);
  }, [scenario, initialMember, factorTab]);
  function openSheet(next: SheetState) {
    const url = new URL(window.location.href); url.searchParams.delete('learn'); url.searchParams.set('sheet', next.type);
    if (sheetRef.current) window.history.replaceState({ ...window.history.state, _foundationSheet: sheetEntry.current }, '', url);
    else { window.history.pushState({ ...window.history.state, _foundationSheet: true }, '', url); sheetEntry.current = true; }
    setSheet(next);
  }
  function closeSheet() {
    if (sheetEntry.current) window.history.back();
    else { const url = new URL(window.location.href); url.searchParams.delete('sheet'); url.searchParams.delete('learn'); window.history.replaceState({ ...window.history.state, _foundationSheet: false }, '', url); setSheet(null); }
  }
  function navigate(next: PreviewRoute, fromSheet = false) {
    if (inDetail) { router.push(previewHref(next)); return; }
    const url = new URL(window.location.href);
    if (fromSheet) { url.searchParams.delete('sheet'); url.searchParams.delete('learn'); window.history.replaceState({ ...window.history.state, _foundationSheet: false }, '', url); sheetEntry.current = false; setSheet(null); }
    scrollMemory.current[route] = window.scrollY;
    url.searchParams.set('tab', next); window.history.pushState({ ...window.history.state, _foundationSheet: false, _foundationSettingsReturn: next === 'settings' ? route : null }, '', url);
    setRoute(next); requestAnimationFrame(() => window.scrollTo(0, scrollMemory.current[next] ?? 0));
  }
  function expandFactor(key: string) {
    setExpanded(key);
    requestAnimationFrame(() => document.getElementById(`factor-${key}`)?.scrollIntoView({ behavior: experience.motion ? 'smooth' : 'instant', block: 'nearest' }));
  }
  function backFromSettings() {
    if (window.history.state?._foundationSettingsReturn) window.history.back();
    else {
      const url = new URL(window.location.href); url.searchParams.set('tab', 'today');
      window.history.replaceState({ ...window.history.state, _foundationSettingsReturn: null }, '', url); setRoute('today');
    }
  }
  function removeEntry() { setDeleted(true); showToast(c.deleteConfirm, () => setDeleted(false)); }
  const current = resolved ? 'shell' : scenario;
  const offline = current === 'offline' || current === 'offline-empty';
  const isGate = (current.startsWith('gate-') && current !== 'gate-error') || current === 'not-found';
  const ariaTitle = foundationScenarios.find(s => s[0] === scenario)?.[2] ?? c.pageLabel;
  const toastElement = toast && <div className="halo-f-toast" role="status"><span>{toast.message}</span>{toast.action && <button onClick={() => { toast.action?.(); setToast(null); }}>{c.undo}</button>}</div>;
  const readingView = current === 'cards' ? <Readings scenario={current} expanded={expanded} setExpanded={setExpanded} onLearn={() => openSheet({ type: 'learn', height: 'standard', topic: 'air' })} onSelect={expandFactor} /> : <PersonalHero scenario={current} factorHref={factorHref} familyHref={familyHref} memberHref={memberHref} home={route === 'home'} />;
  let content: ReactNode = readingView;
  if (current === 'loading' || current === 'gate-loading') content = <Loading gate={current === 'gate-loading'} />;
  else if (current === 'error' || current === 'gate-error') content = <><Callout tone="error"><p>{current === 'gate-error' ? c.gateError : c.error}</p><Button variant="secondary" aria-label={c.retry} busy={busy} onClick={() => mockRequest(() => setResolved(true))}>{c.retry}</Button></Callout>{current === 'gate-error' && readingView}</>;
  else if (['empty', 'empty-no-action', 'offline-empty'].includes(current)) content = <EmptyState icon={<BookOpen size={32} />} heading={c.emptyHeading} body={current === 'offline-empty' ? c.offlineEmpty : c.emptyBody} action={current === 'empty' ? <Button onClick={() => navigate('journal')}>{c.continue}</Button> : undefined} />;
  else if (current === 'gate-incomplete' || current === 'gate-location') content = <EmptyState icon={<House size={32} />} heading={current === 'gate-location' ? c.gateLocation : c.gateIncomplete} body={current === 'gate-location' ? c.gateLocationBody : c.gateIncompleteBody} action={<Button onClick={() => mockRequest(() => setResolved(true))} busy={busy}>{c.setup}</Button>} />;
  else if (current === 'not-found') content = <EmptyState icon={<CircleHelp size={32} />} heading={c.unknownHeading} body={c.unknownBody} action={<Button onClick={() => setResolved(true)}>{c.goToday}</Button>} />;
  else if (current === 'pills') content = <><Intro title={c.pills} /><Card title={c.labels.severity}><div className="halo-f-pills">{['good', 'moderate', 'elevated', 'high', 'severe', 'no_data'].map(s => <SeverityPill key={s} severity={s} />)}</div></Card><Card title={c.provenance}><div className="halo-f-pills">{(['measured', 'modeled', 'estimate'] as const).map(s => <ProvenancePill key={s} provenance={s} />)}</div></Card><Card title={c.confidence}><div className="halo-f-pills">{(['full', 'limited', 'stale', 'none'] as const).map(s => <ConfidencePill key={s} confidence={s} />)}</div><p>{c.confidenceNote}</p></Card></>;
  else if (current === 'callouts') content = <><Intro title={c.labels.inline} />{(['info', 'caution', 'notice', 'error'] as const).map(tone => <Callout key={tone} tone={tone} title={tone === 'error' ? c.errorTitle : c[tone]}><p>{tone === 'error' ? c.saveError : c[`${tone}Body`]}</p></Callout>)}</>;
  else if (current === 'bars') content = <Bars onLearn={() => openSheet({ type: 'learn', height: 'standard', topic: 'pfas', generic: true })} />;
  else if (current === 'buttons') content = <><Intro title={c.buttonHeading} /><Card title={c.labels.primary}><Button busy={busy} onClick={() => mockRequest(() => showToast(c.saved))}>{c.save}</Button></Card><Card title={c.labels.secondary}><Button variant="secondary" onClick={() => showToast(c.saved)}>{c.continue}</Button><Button variant="tertiary" onClick={() => showToast(c.saved)}>{c.cancel}</Button></Card><Card title={c.labels.availability}><Button variant="secondary" busy>{c.save}</Button><Button variant="secondary" disabled>{c.unavailable}</Button></Card><Card title={c.labels.destructive}><Button variant="secondary" className="halo-f-destructive" onClick={removeEntry}>{c.destructive}</Button><button className="halo-f-icon" aria-label={c.labels.settingsExample} onClick={() => navigate('settings')}><Settings size={22} aria-hidden="true" /></button></Card></>;
  else if (current.startsWith('controls')) content = <Controls fail={current === 'controls-failure'} showToast={showToast} />;
  else if (current.startsWith('form') || current === 'long-text') content = <Form scenario={current} showToast={showToast} />;
  else if (['swipe', 'toast', 'toast-undo'].includes(current)) content = <><Intro title={c.swipeHeading} body={c.swipeBody} />{!deleted ? <SwipeRow actionLabel={c.destructive} onAction={removeEntry}><strong>{c.entry}</strong><p className="halo-f-truncate">{c.entryNote}</p></SwipeRow> : <EmptyState icon={<BookOpen size={32} />} heading={c.emptyHeading} body={c.emptyBody} />}<Button variant="secondary" onClick={() => showToast(c.saved)}>{c.replaceToast}</Button></>;
  else if (current.startsWith('sheet')) content = <><Intro title={c.sheets} body={c.sheetNote} /><Card title={c.labels.sheetSizes}><Button variant="secondary" onClick={() => openSheet({ type: 'learn', height: 'standard', topic: 'air' })}>{c.standard}</Button><Button variant="secondary" onClick={() => openSheet({ type: 'assistant', height: 'tall' })}>{c.tall}</Button><Button variant="secondary" onClick={() => openSheet({ type: 'map', height: 'content' })}>{c.compact}</Button></Card>{readingView}</>;
  else if (current === 'identity') content = <Identity />;
  else if (current === 'cards') content = <><Intro title={c.labels.cardFamily} /><Card title={c.labels.staticCard}><p>{c.cardDetail}</p></Card><Card title={c.labels.tappableCard} onClick={() => openSheet({ type: 'learn', height: 'standard', topic: 'air' })}><p>{c.learn}</p></Card>{readingView}</>;
  else if (route !== 'today' && route !== 'home') content = <><Intro title={routeTitles[route]} body={c.notPage(routeTitles[route])} />{route === 'map' ? <div className="halo-f-map-placeholder"><MapIcon size={50} aria-hidden="true" /><p>{c.notPage('Map')}</p><Button variant="secondary" onClick={() => openSheet({ type: 'map', height: 'content' })}>{c.compact}</Button></div> : route === 'settings' ? <Controls household showToast={showToast} /> : readingView}</>;
  if (initialFactor && !['loading', 'error', 'offline-empty'].includes(current) && !isGate) content = <FactorDetail factorKey={initialFactor} scenario={current} factorHref={factorHref} parentHref={previewHref(route)} />;
  if (initialFamily && !['loading', 'error', 'offline-empty'].includes(current) && !isGate) content = <FamilyGuidance scenario={current} factorHref={factorHref} parentHref={previewHref('today')} />;
  if (initialMember && !['loading', 'error', 'offline-empty'].includes(current) && !isGate) content = <HomeMemberGuidance member={initialMember} scenario={current} memberHref={memberHref} factorHref={factorHref} parentHref={`${previewHref('home')}#household`} />;
  return <div className="halo-app halo-f-app" data-testid="foundation-product" data-wide={route === 'map'} data-contrast={contrast ? 'high' : 'normal'} data-motion={motion} data-animate={experience.enabled} data-text-scale={scale * 100} style={{ '--halo-text-scale': scale, '--factor-accent': `var(--factor-${initialFactor ?? 'air'})` } as CSSProperties}>
    <EnvironmentalScene page variant={initialFactor ?? (route === 'home' ? 'home' : 'landscape')} />
    {!isGate && <header className="halo-f-header">{inDetail ? <Link className="halo-f-icon" href={previewHref(backTab)} aria-label={`Back to ${routeTitles[backTab]}`} prefetch={false}><ArrowLeft size={22} aria-hidden="true" /></Link> : route === 'settings' && <button className="halo-f-icon" aria-label={c.labels.back} onClick={backFromSettings}><ArrowLeft size={22} aria-hidden="true" /></button>}<h1>{initialMember ? memberCatalog[initialMember].label : initialFamily ? 'Your household' : initialFactor ? factorReadings[initialFactor].title : routeTitles[route]}</h1><div className="halo-f-header-actions">{route === 'today' && !inDetail && <button className="halo-f-icon halo-f-bell" aria-label={c.unread(unread)} onClick={() => openSheet({ type: 'alerts', height: 'standard' })}><Bell size={22} aria-hidden="true" />{unread > 0 && <span className="halo-f-badge">{unread > 9 ? '9+' : unread}</span>}</button>}{route !== 'settings' && <button className="halo-f-icon" aria-label={c.labels.settings} onClick={() => navigate('settings')}><Settings size={22} aria-hidden="true" /></button>}</div></header>}
    {offline && <div className="halo-f-offline"><WifiOff size={18} aria-hidden="true" /><p>{current === 'offline-empty' ? c.offlineEmpty : c.offline}</p></div>}
    <main className="halo-f-main" aria-label={ariaTitle}>{!isGate && <p className="halo-f-eyebrow">{initialFactor ? 'A closer look' : 'Your world, understood'} · Sample preview</p>}{current === 'stale' && <Callout tone="notice"><p>{c.stale}</p><button className="halo-text-button" onClick={() => mockRequest(() => setResolved(true))} disabled={busy}>{c.retry}</button></Callout>}{current === 'refreshing' && <p role="status" className="halo-f-refreshing"><span className="halo-spinner" aria-hidden="true" />{c.refreshing}</p>}{content}</main>
    {!isGate && <><nav className="halo-f-tabs" aria-label={c.labels.navigation}>{previewTabs.map(tab => { const Icon = tabIcons[tab]; return <a key={tab} href={previewHref(tab)} aria-current={route === tab ? 'page' : undefined} onClick={e => { e.preventDefault(); if (route !== tab || inDetail) navigate(tab); }}><Icon size={23} aria-hidden="true" /><span>{tabLabels[tab]}</span></a>; })}</nav>{assistantEnabled && !sheet && route !== 'settings' && <button className="halo-f-assistant" aria-label={c.labels.assistant} onClick={() => openSheet({ type: 'assistant', height: 'tall' })}><LunaMark size={28} /></button>}</>}
    {!sheet && toastElement}
    {sheet?.type === 'assistant' && <LunaAssistant onClose={closeSheet} factorHref={factorHref} factor={initialFactor} home={route === 'home'} offline={offline} missing={['no-data', 'card-no-data', 'offline-empty'].includes(current)} />}
    {sheet && sheet.type !== 'assistant' && <BottomSheet id="foundation-sheet" title={c.sheetTitles[sheet.type]} height={sheet.height} onClose={closeSheet}>
      {offline && <Callout tone="notice"><p>{c.offline}</p></Callout>}
      <Callout tone="info"><p>{c.sheetPlaceholder}</p></Callout>
      {sheet.state === 'loading' ? <div className="halo-f-stack" role="status" aria-label={c.labels.loadingSheet}><Skeleton height="8rem" /><Skeleton shape="text" /><Skeleton shape="text" width="75%" /></div> : sheet.state === 'error' ? <><Callout tone="error"><p>{c.error}</p></Callout><Button onClick={() => mockRequest(() => setSheet({ ...sheet, state: undefined }))} busy={busy}>{c.retry}</Button></> : sheet.state === 'empty' ? <EmptyState icon={<Info size={28} />} heading={c.emptyHeading} body={c.emptyBody} /> : <>
        {sheet.type === 'alerts' ? <><p>{c.alertBody}</p><SwipeRow actionLabel={c.labels.dismiss} onAction={() => { const previous = unread; setUnread(Math.max(0, unread - 1)); showToast(c.dismissConfirm, () => setUnread(previous)); }}><button className="halo-text-button" onClick={() => setUnread(Math.max(0, unread - 1))}>{c.markRead}</button><p>{c.alert}</p></SwipeRow><Button variant="secondary" onClick={() => setUnread(0)}>{c.markAll}</Button></> : <><p>{c.sheetNote}</p>{sheet.type === 'learn' && <Card title={sheet.topic === 'pfas' ? c.labels.pfas : c.labels.air}>{sheet.generic ? <p>{c.genericLearn}</p> : <><p>{c.yourReading}</p><SeverityPill severity="good" /><span className="halo-f-value">AQI 37</span></>}</Card>}{sheet.type === 'map' && <Card title={c.labels.waterSystem}><code>NC0190010</code><p className="halo-f-utility">{c.longAddress}</p></Card>}<Button variant="secondary" onClick={() => openSheet({ type: 'learn', height: 'standard', topic: 'pfas', generic: true })}>{c.replaceSheet}</Button><Button variant="tertiary" onClick={() => navigate('today', true)}>{c.goToday}</Button></>}
      </>}{toastElement}
    </BottomSheet>}
  </div>;
}

function Intro({ title, body }: { title: string; body?: string }) { return <div className="halo-f-intro"><h2>{title}</h2>{body && <p>{body}</p>}</div>; }
function Loading({ gate = false }: { gate?: boolean }) {
  return <div className="halo-f-stack" role="status" aria-label={gate ? c.gateLoading : c.labels.loadingReadings}>{gate ? <Skeleton height="7rem" /> : <section className="halo-f-score-example"><Skeleton width="140px" height="140px" /><Skeleton shape="text" width="70%" height="30px" /><p className="halo-f-skeleton-copy" aria-hidden="true">{c.sample}</p><div className="halo-f-contribution"><Skeleton shape="text" width="70%" height="19.5px" /><div className="halo-f-contribution-track"><Skeleton height="44px" /></div><div className="halo-f-skeleton-legend"><Skeleton shape="text" /></div></div></section>}{[0, 1, 2, 3].map(n => <Skeleton key={n} height="94px" />)}</div>;
}
function Readings({ scenario, expanded, setExpanded, onLearn, onSelect }: { scenario: FoundationScenario; expanded: string | null; setExpanded: (value: string | null) => void; onLearn: () => void; onSelect: (key: string) => void }) {
  const missing = scenario === 'no-data'; const partial = scenario === 'partial';
  const score = missing ? null : scenario === 'score-zero' ? 0 : scenario === 'score-full' || scenario === 'contribution-zero' ? 100 : 78;
  const severity = missing ? 'no_data' : scenario === 'score-zero' ? 'severe' : 'good';
  let segments: ContributionSegment[] = sampleFactors.slice(0, 3).map(f => ({ key: f.key, label: f.title, shortLabel: c.shortFactorLabels[f.key], share: f.share, severity: f.severity }));
  if (partial) segments[2] = { ...segments[2], share: null, severity: 'no_data' };
  if (scenario === 'contribution-zero') segments = segments.map(s => ({ ...s, share: 0, severity: 'good' }));
  if (scenario === 'contribution-single') segments = [segments[0]];
  if (scenario === 'contribution-sliver') segments = segments.map((s, i) => ({ ...s, share: [95, 5, 0][i] }));
  return <><section className="halo-f-score-example"><ScoreRing score={score} severity={severity} partial={partial} /><h2>{c.readingExample}</h2><p>{c.sample}</p>{partial && <Callout tone="notice"><p>{c.noticeBody}</p></Callout>}{missing ? <p>{c.noDataBody}</p> : <ContributionBar segments={segments} onSelect={onSelect} />}</section>
    {sampleFactors.map((factor, i) => { const noData = missing || (partial && i === 2) || factor.severity === 'no_data'; return <ExpandableCard key={factor.key} id={factor.key} title={factor.title} summary={noData ? '' : factor.summary} severity={noData ? 'no_data' : factor.severity} open={expanded === factor.key} onOpenChange={open => setExpanded(open ? factor.key : null)}>
      {scenario === 'card-loading' && factor.key === 'air' ? <div role="status" aria-label={c.labels.loadingDetail}><Skeleton shape="text" /><Skeleton height="7rem" /></div> : <><p>{scenario === 'card-no-data' || noData ? c.cardNoData : c.cardDetail}</p><ProvenancePill provenance={factor.provenance} /><button className="halo-text-button" onClick={onLearn}>{c.learn}</button></>}
    </ExpandableCard>; })}</>;
}

function Controls({ fail = false, household = false, showToast }: { fail?: boolean; household?: boolean; showToast: (message: string) => void }) {
  const { bands, setBand } = usePreviewHousehold();
  const [mode, setMode] = useState<string>('Log'); const [renting, setRenting] = useState<string>('Owner');
  const [localSelected, setSelected] = useState<string[]>(['Adults']); const [reduce, setReduce] = useState(false); const [open, setOpen] = useState<string | null>('household');
  const selected = household ? c.groups.filter((_, index) => bands[memberCatalog[homeMemberKeys[index]].band]) : localSelected;
  const [error, setError] = useState(false); const pending = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => pending.current.forEach(clearTimeout), []);
  function toggle(group: string) {
    if (household) { const index = c.groups.findIndex(label => label === group); if (index >= 0) setBand(homeMemberKeys[index], !selected.includes(group)); showToast('Sample household updated for this visit.'); return; }
    const wasSelected = selected.includes(group); setError(false); setSelected(current => wasSelected ? current.filter(s => s !== group) : [...current, group]);
    if (fail) pending.current.push(setTimeout(() => { setSelected(current => wasSelected ? [...new Set([...current, group])] : current.filter(s => s !== group)); setError(true); }, 700));
    else showToast(c.saved);
  }
  return <><Intro title={c.controls} /><Card title={c.labels.segments}><SegmentedControl options={c.journalModes} value={mode} onChange={setMode} label={c.labels.journalMode} /><SegmentedControl options={c.renting} value={renting} onChange={setRenting} label={c.labels.tenure} /><SegmentedControl options={c.labels.filters} value={mode === 'Trends' ? 'Elevated' : 'All'} onChange={value => setMode(value === 'All' ? 'Log' : 'Trends')} label={c.labels.filter} /></Card>
    {error && <Callout tone="error"><p>{c.toggleFailed}</p></Callout>}
    <div className="halo-f-card"><AccordionRow id="household-options" title={c.household} summary={selected.join(', ') || c.optionalGroups} open={open === 'household'} onToggle={() => setOpen(open === 'household' ? null : 'household')}><p>{c.optionalGroups}</p><div className="halo-f-chips">{c.groups.map(group => <ToggleChip key={group} pressed={selected.includes(group)} onToggle={() => toggle(group)}>{group}</ToggleChip>)}<ToggleChip pressed={false} onToggle={() => {}} disabled>{c.unavailable}</ToggleChip></div></AccordionRow>
    <AccordionRow id="accessibility-options" title={c.accessibility} summary={reduce ? c.motion : c.textSummary} open={open === 'accessibility'} onToggle={() => setOpen(open === 'accessibility' ? null : 'accessibility')}><Switch label={c.switchLabel} checked={reduce} onChange={setReduce} /><Switch label={c.disabledSwitch} checked={false} onChange={() => {}} disabled /></AccordionRow></div>
    <Card title={c.labels.switchStates}><Switch label={c.switchLabel} checked={reduce} onChange={setReduce} /><Switch label={c.labels.enabledSwitch} checked={!reduce} onChange={value => setReduce(!value)} /><Switch label={c.disabledSwitch} checked={false} onChange={() => {}} disabled /></Card></>;
}

function Form({ scenario, showToast }: { scenario: FoundationScenario; showToast: (message: string) => void }) {
  const long = scenario === 'long-text'; const disabled = scenario === 'form-disabled';
  const [address, setAddress] = useState(long ? c.longAddress : scenario === 'form-error' ? '28025' : '');
  const [year, setYear] = useState(scenario === 'form-error' ? '1975' : ''); const [water, setWater] = useState(scenario === 'form-error' ? 'Public water system' : '');
  const [note, setNote] = useState(''); const [illness, setIllness] = useState(false); const [size, setSize] = useState(100);
  const [longOpen, setLongOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [saveError, setSaveError] = useState(scenario === 'form-error'); const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function validation(key: string, value: string) {
    if (key === 'address') return value.trim().length < 5 ? c.addressError : '';
    if (key === 'water') return value ? '' : c.waterError;
    if (!value) return '';
    if (Number(value) > 2026) return c.futureError;
    return /^\d{4}$/.test(value) && Number(value) >= 1700 ? '' : c.yearError;
  }
  function validate(key: string, value: string) { setErrors(current => ({ ...current, [key]: validation(key, value) })); }
  function clearValid(key: string, value: string) { if (!validation(key, value)) setErrors(current => ({ ...current, [key]: '' })); }
  return <><Intro title={c.form} />{disabled && <Callout tone="notice"><p>{c.disabledNote}</p></Callout>}{saveError && <Callout tone="error"><p>{c.saveError}</p></Callout>}
    <form className="halo-f-form" onSubmit={e => { e.preventDefault(); const next = { address: validation('address', address), year: validation('year', year), water: validation('water', water) }; setErrors(next); if (Object.values(next).some(Boolean)) return; setBusy(true); timer.current = setTimeout(() => { setBusy(false); setSaveError(scenario === 'form-error'); if (scenario !== 'form-error') showToast(c.saved); }, 650); }}>
      <label className="halo-f-field">{c.address}<input className="halo-input" autoComplete="street-address" value={address} onChange={e => { setAddress(e.target.value); clearValid('address', e.target.value); }} onBlur={() => validate('address', address)} disabled={disabled || busy} aria-invalid={!!errors.address} aria-describedby={errors.address ? 'address-error' : undefined} />{errors.address && <span id="address-error" className="halo-error"><Info size={16} aria-hidden="true" />{errors.address}</span>}</label>
      <label className="halo-f-field">{c.year}<span className="halo-f-meta">{c.optional}</span><input className="halo-input" inputMode="numeric" maxLength={4} value={year} onChange={e => { const value = e.target.value.replace(/\D/g, ''); setYear(value); clearValid('year', value); }} onBlur={() => validate('year', year)} disabled={disabled || busy} aria-invalid={!!errors.year} aria-describedby={errors.year ? 'year-error' : undefined} />{errors.year && <span id="year-error" className="halo-error"><Info size={16} aria-hidden="true" />{errors.year}</span>}</label>
      <label className="halo-f-field">{c.water}<select className="halo-select" value={water} onChange={e => { setWater(e.target.value); clearValid('water', e.target.value); }} onBlur={() => validate('water', water)} disabled={disabled || busy} aria-invalid={!!errors.water} aria-describedby={errors.water ? 'water-error' : undefined}>{c.waterOptions.map((value, i) => <option key={value} value={i ? value : ''}>{value}</option>)}</select>{errors.water && <span id="water-error" className="halo-error"><Info size={16} aria-hidden="true" />{errors.water}</span>}</label>
      <label className="halo-f-field">{c.note}<textarea className="halo-input halo-f-textarea" value={note} onChange={e => setNote(e.target.value)} maxLength={500} disabled={disabled || busy} aria-describedby="note-hint" /><span id="note-hint" className="halo-f-meta">{c.noteHint}</span>{note.length > 400 && <span className="halo-f-meta" role="status">{note.length}/500</span>}</label>
      <label className="halo-f-checkbox"><input type="checkbox" checked={illness} onChange={e => setIllness(e.target.checked)} disabled={disabled || busy} />{c.checkbox}</label>
      <label className="halo-f-field">{c.slider}: {size}%<input type="range" min="100" max="150" step="5" value={size} onChange={e => setSize(Number(e.target.value))} disabled={disabled || busy} /></label>
      <Button type="submit" aria-label={long ? c.spanish : c.save} busy={busy} disabled={disabled}>{long ? c.spanish : c.save}</Button>
    </form>{long && <><ExpandableCard id="long" title={c.longTitle} summary={c.longSummary} severity="moderate" open={longOpen} onOpenChange={setLongOpen}><p>{c.longSummary}</p></ExpandableCard><Card title={c.labels.numbers}><span className="halo-f-large-value">12,400,000</span><p className="halo-f-utility">{c.longAddress}</p></Card></>}
  </>;
}

function Bars({ onLearn }: { onLearn: () => void }) {
  return <><Intro title={c.bars} body={c.thresholdNote} /><Card title={c.risk}><RiskBar risk={64} severity="moderate" /><SeverityPill severity="moderate" /><RiskBar risk={null} severity="no_data" /><SeverityPill severity="no_data" /><RiskBar risk={null} severity="no_data" notScored /><p className="halo-f-meta">{c.shownNotScored}</p></Card><Card title={c.labels.thresholdRows}>{[{ name: 'PFOA', ratio: 3.2, severity: 'high', value: '12.8 ppt' }, { name: 'PFOS', ratio: 2.1, severity: 'elevated', value: '8.3 ppt' }, { name: 'PFHxS', ratio: 0.5, severity: 'good', value: '5.0 ppt' }].map(row => <button key={row.name} className="halo-f-threshold" onClick={onLearn} aria-label={`${row.name}, ${row.value}, ${row.ratio} times the limit. ${row.ratio > 2 ? 'Continues past the chart. ' : ''}${c.pfas}`}><span className="halo-f-row"><strong>{row.name}</strong><span className="halo-f-value">{row.value} · {row.ratio.toFixed(1)}×</span></span><span className="halo-f-limit-track" data-severity={row.ratio <= 1 ? 'neutral' : row.severity}><span className="halo-f-limit-fill" style={{ width: `${Math.min(row.ratio / 2 * 100, 100)}%` }} /><span className="halo-f-limit-marker" />{row.ratio > 2 && <span className="halo-f-continues" aria-hidden="true">›</span>}</span><span className="halo-f-meta halo-f-limit-caption">{c.limit}</span></button>)}<div className="halo-f-unscored"><strong>Lithium</strong><span className="halo-f-value">25.0 µg/L</span><RiskBar risk={null} severity="no_data" notScored /><p className="halo-f-meta">{c.shownNotScored}</p></div></Card></>;
}
function Identity() {
  return <><Intro title={c.identity} body={c.identityBody} /><Card title={c.labels.approvedLogo}><div className="halo-f-logo" role="img" aria-label={c.labels.logoAlt} /><p>{c.fonts}</p><code>NC0190010 · NSF/ANSI 53</code></Card><Card title={c.tokens}><div className="halo-f-token-grid">{c.labels.tokenNames.map((name, i) => <div key={name}><span className="halo-f-swatch" data-token={i} /><span>{name}</span></div>)}</div><p>{c.tokenBody}</p>{c.heroTokens.map((name, i) => <div key={name} className="halo-f-hero-swatch" data-time={i}><strong>{name}</strong><p>{c.readingExample}</p></div>)}</Card><Callout tone="info"><p>{c.rawNormal}</p></Callout></>;
}
