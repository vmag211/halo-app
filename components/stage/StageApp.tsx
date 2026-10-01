'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Bell, Hand, House, Map as MapIcon, Notebook, RefreshCw, Settings, Sunrise, WifiOff } from 'lucide-react';
import Button from '@/components/ui/Button';
import { BottomSheet, Callout, Skeleton } from '@/components/ui/Foundation';
import SeverityPill from '@/components/ui/SeverityPill';
import { copy } from '@/lib/frontend/copy';
import { errorCode } from '@/lib/frontend/api';
import { isFactorKey, type FactorKey } from '@/lib/frontend/factor-preview';
import { homeMemberKeys, memberCatalog, type HomeMemberKey } from '@/lib/frontend/home-household';
import PersonalHero, { FactorDetail } from '@/components/foundation/PersonalHero';
import FamilyGuidance from '@/components/foundation/FamilyGuidance';
import { HomeMemberGuidance } from '@/components/foundation/HomeHousehold';
import EnvironmentalScene from '@/components/foundation/EnvironmentalScene';
import { SceneProvider, useSceneExperience } from '@/components/foundation/SceneExperience';
import { useStageRuntime } from '@/components/foundation/StageRuntime';
import LunaAssistant from '@/components/foundation/LunaAssistant';
import LunaMark from '@/components/foundation/LunaMark';
import StageSession, { useStageSession } from './StageSession';
import StageSettings from './StageSettings';
import type { AlertMutation } from '@/lib/frontend/stage-api';
import type { MotionMode } from '@/lib/frontend/scene-clock';
import './stage.css';
import { HomeActionPlan, HomeEvidence } from './HomeEvidence';

export const factorHref = (key: FactorKey) => `/factors/${key}`;
const memberHref = (key: HomeMemberKey) => `/household/${key}`;
const tabItems = [{ key: 'today', label: 'Today', icon: Sunrise }, { key: 'home', label: 'Homeguard', icon: House }, { key: 'map', label: 'Map', icon: MapIcon }, { key: 'journal', label: 'Journal', icon: Notebook }, { key: 'act', label: 'Act', icon: Hand }] as const;
type Sheet = 'assistant' | 'alerts' | null;
type DevicePreferences = { scale: number; reduced: boolean; contrast: boolean };
const defaultPreferences = { scale: 100, reduced: false, contrast: false };

export default function StageApp({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [preferences, setPreferences] = useState<DevicePreferences>(defaultPreferences);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = JSON.parse(localStorage.getItem('halo.device.accessibility') || 'null');
        if (raw) setPreferences({ scale: [100, 115, 130, 150].includes(raw.scale) ? raw.scale : 100, reduced: raw.reduced === true, contrast: raw.contrast === true });
      } catch { /* Restricted storage falls back to device settings. */ }
    });
    return () => { active = false; };
  }, []);
  function updatePreferences(next: DevicePreferences) {
    setPreferences(next);
    try { localStorage.setItem('halo.device.accessibility', JSON.stringify(next)); } catch { /* The current visit still works. */ }
  }
  const motion: MotionMode = preferences.reduced ? 'reduce' : 'system';
  const factorRoute = /^\/factors\/([^/]+)$/.exec(pathname);
  const memberRoute = /^\/household\/([^/]+)$/.exec(pathname);
  const supported = ['/today', '/home', '/family', '/settings'].includes(pathname) ||
    !!factorRoute && isFactorKey(factorRoute[1]) || !!memberRoute && homeMemberKeys.some(key => key === memberRoute[1]);
  if (!supported) return <>{children}</>;
  return <StageSession><SceneProvider mode={motion} time="live"><Frame preferences={preferences} updatePreferences={updatePreferences}>{children}</Frame></SceneProvider></StageSession>;
}

function Frame({ children, preferences, updatePreferences }: { children: ReactNode; preferences: DevicePreferences; updatePreferences: (next: DevicePreferences) => void }) {
  const session = useStageSession(); const data = useStageRuntime()!;
  const experience = useSceneExperience(); const pathname = usePathname(); const router = useRouter();
  const factorPart = pathname.startsWith('/factors/') ? pathname.split('/')[2] : null;
  const factor = isFactorKey(factorPart) ? factorPart : undefined;
  const memberPart = pathname.startsWith('/household/') ? pathname.split('/')[2] : null;
  const member = homeMemberKeys.find(key => key === memberPart);
  const family = pathname === '/family'; const settings = pathname === '/settings';
  const knownRoute = !!factor || !!member || family || settings || pathname === '/today' || pathname === '/home';
  const home = pathname === '/home' || !!member || !!factor && ['pfas', 'radon', 'lead'].includes(factor);
  const title = factor ? data.readings[factor].title : member ? memberCatalog[member].label : family ? 'Your household' : settings ? 'Settings' : home ? 'Homeguard' : 'Today';
  const back = home ? '/home' : '/today'; const detail = !!(factor || member || family || settings);
  const reading = home ? session.home : session.daily;
  const [sheet, setSheet] = useState<Sheet>(null);
  const sheetRef = useRef<Sheet>(null);
  const scrollMemory = useRef<Record<string, number>>({});
  const [toast, setToast] = useState('');
  const [seconds, setSeconds] = useState(0);
  const retryDeadline = useRef(0);
  useEffect(() => { sheetRef.current = sheet; }, [sheet]);
  useEffect(() => {
    const save = () => { if (!sheetRef.current) scrollMemory.current[pathname] = window.scrollY; };
    const url = new URL(window.location.href);
    // Existing links from alerts/specification now lead into the dedicated
    // approved detail pages instead of the superseded expanding-card layout.
    const legacy = url.searchParams.get('learn') ?? (pathname === '/home' ? url.searchParams.get('risk') : null);
    const mapped = legacy === 'water' ? 'pfas' : legacy;
    if (isFactorKey(mapped) && (pathname === '/home' ? ['pfas', 'radon', 'lead'].includes(mapped) : pathname === '/today' && ['air', 'uv', 'pollen', 'mold'].includes(mapped))) {
      router.replace(`${factorHref(mapped)}${url.searchParams.has('learn') ? '#reading-overview' : ''}`);
    }
    const frame = requestAnimationFrame(() => {
      if (!url.hash && !url.search) window.scrollTo(0, scrollMemory.current[pathname] ?? 0);
    });
    window.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', save); };
  }, [pathname, router]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 8000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (session.daily.error === 'rate_limited') retryDeadline.current = Date.now() + 300_000;
  }, [session.daily.error]);
  useEffect(() => {
    let active = true;
    // A successful cached/background refresh must not leave a stopped countdown
    // permanently disabling explicit refresh, or silently erase the cooldown.
    const update = () => { if (active) setSeconds(Math.max(0, Math.ceil((retryDeadline.current - Date.now()) / 1000))); };
    queueMicrotask(update); const timer = setInterval(update, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    const readSheet = () => {
      const kind = new URL(window.location.href).searchParams.get('sheet');
      setSheet(kind === 'assistant' || kind === 'alerts' ? kind : null);
    };
    readSheet(); window.addEventListener('popstate', readSheet);
    return () => window.removeEventListener('popstate', readSheet);
  }, [pathname]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active && session.gate !== 'ready') setSheet(null); });
    return () => { active = false; };
  }, [session.gate]);
  useEffect(() => {
    const saved = () => setToast('Your changes were saved. Readings are being updated.');
    window.addEventListener('halo:settings-changed', saved); return () => window.removeEventListener('halo:settings-changed', saved);
  }, []);
  function openSheet(kind: Exclude<Sheet, null>) {
    const url = new URL(window.location.href); url.searchParams.set('sheet', kind);
    if (sheetRef.current) window.history.replaceState({ ...window.history.state, haloStageSheet: true }, '', url);
    else window.history.pushState({ ...window.history.state, haloStageSheet: true }, '', url);
    setSheet(kind); if (kind === 'alerts') void session.refreshAlerts();
  }
  function closeSheet() {
    setSheet(null);
    if (window.history.state?.haloStageSheet) window.history.back();
    else { const url = new URL(window.location.href); url.searchParams.delete('sheet'); window.history.replaceState(window.history.state, '', url); }
    if (sheet === 'alerts') void session.refreshAlerts();
  }
  function routeFromSheet(href: string) {
    const url = new URL(window.location.href); url.searchParams.delete('sheet');
    window.history.replaceState({ ...window.history.state, haloStageSheet: false }, '', url);
    setSheet(null); router.push(href);
  }
  const waiting = session.gate === 'loading' || (session.gate === 'ready' && reading.loading && !reading.data && !settings);
  const ready = session.gate === 'ready';
  const scenario = session.offline ? 'offline' : 'shell';
  let content: ReactNode;
  if (factor) content = <FactorDetail factorKey={factor} scenario={scenario} factorHref={factorHref} parentHref={back} evidence={<HomeEvidence factor={factor} />} />;
  else if (member) content = <HomeMemberGuidance member={member} scenario={scenario} memberHref={memberHref} factorHref={factorHref} parentHref="/home#household" />;
  else if (family) content = <FamilyGuidance scenario={scenario} factorHref={factorHref} parentHref="/today" />;
  else if (settings) content = <><StageSettings /><section className="halo-f-card"><h2>Accessibility on this device</h2><label className="halo-stage-setting">Text size<select value={preferences.scale} onChange={e => updatePreferences({ ...preferences, scale: Number(e.target.value) })}>{[100, 115, 130, 150].map(scale => <option key={scale} value={scale}>{scale}%</option>)}</select></label><label className="halo-stage-check"><input type="checkbox" checked={preferences.reduced} onChange={e => updatePreferences({ ...preferences, reduced: e.target.checked })} />Reduce animation</label><label className="halo-stage-check"><input type="checkbox" checked={preferences.contrast} onChange={e => updatePreferences({ ...preferences, contrast: e.target.checked })} />Higher contrast</label><p className="halo-f-meta">Appearance follows your device. Animation also respects your device’s reduced-motion setting. These choices are saved only on this device.</p></section></>;
  else content = <><PersonalHero scenario={scenario} factorHref={factorHref} familyHref="/family" memberHref={memberHref} home={home} />{home && <HomeActionPlan />}</>;

  // Invalid dynamic routes belong to Next's not-found boundary, not a Today
  // fallback rendered alongside the 404. Keep all hooks above this branch.
  if (!knownRoute) return <>{children}</>;

  return <div className="halo-app halo-f-app halo-stage-app" data-testid="stage-product" data-motion={preferences.reduced ? 'reduce' : 'system'} data-animate={experience.enabled} data-contrast={preferences.contrast ? 'high' : 'normal'} data-text-scale={preferences.scale} style={{ '--halo-text-scale': preferences.scale / 100, '--factor-accent': `var(--factor-${factor ?? 'air'})` } as CSSProperties}>
    <a className="halo-stage-skip" href="#halo-main">Skip to content</a>
    <EnvironmentalScene page variant={factor ?? (home ? 'home' : 'landscape')} />
    <header className="halo-f-header">{detail && <Link className="halo-f-icon" href={back} prefetch={false} aria-label={`Back to ${home ? 'Homeguard' : 'Today'}`}><ArrowLeft size={22} aria-hidden="true" /></Link>}<h1>{title}</h1><div className="halo-f-header-actions">{!home && !detail && ready && <button className="halo-f-icon halo-f-bell" aria-label={session.alerts ? `Alerts, ${session.alerts.unread} unread` : 'Alerts'} onClick={() => openSheet('alerts')}><Bell size={22} aria-hidden="true" />{!!session.alerts?.unread && <span className="halo-f-badge">{session.alerts.unread > 9 ? '9+' : session.alerts.unread}</span>}</button>}{!settings && <Link className="halo-f-icon" href="/settings" prefetch={false} aria-label="Settings"><Settings size={22} aria-hidden="true" /></Link>}</div></header>
    {session.offline && <div className="halo-f-offline" role="status"><WifiOff size={18} aria-hidden="true" /><p>{reading.data ? 'You are offline. Showing stored readings with their original dates.' : 'You are offline. Connect to load your readings.'}</p></div>}
    <main id="halo-main" tabIndex={-1} className="halo-f-main" aria-label={title}>
      <p className="halo-f-eyebrow">{factor ? 'A closer look' : 'Your world, understood'}</p>
      {waiting ? <div className="halo-f-stack" role="status" aria-label={session.gate === 'loading' ? 'Checking your profile' : 'Loading readings'}><Skeleton height="22rem" /><Skeleton height="6rem" /><Skeleton height="10rem" /></div> : session.gate === 'error' ? <Callout tone="error"><p>{copy.errors[session.gateError ?? 'generic']}</p><Button onClick={() => void session.restart()}>Try again</Button>{['no_location', 'no_county'].includes(session.gateError ?? '') && <Link className="halo-text-button" href="/onboarding?change=1">Set your location</Link>}</Callout> : <>
        {session.profileWarning && <Callout tone="notice"><p>Your profile could not be checked. Stored readings remain available, but household-specific guidance and editing wait until your profile reconnects.</p><button className="halo-text-button" onClick={() => void session.restart()}>Reconnect profile</button></Callout>}
        {!settings && <div className="halo-stage-refresh"><button className="halo-text-button" onClick={() => void session.refresh(true)} disabled={reading.loading || session.offline || seconds > 0}><RefreshCw size={15} aria-hidden="true" />{reading.loading ? 'Updating readings' : seconds > 0 ? `Try again in ${seconds}s` : 'Refresh readings'}</button>{reading.cached && <span className="halo-f-meta">Stored readings</span>}</div>}
        {reading.error && !settings && <Callout tone="error"><p>{copy.errors[reading.error]}{reading.data ? ' Your previous readings remain visible with their original dates.' : ' General guidance is still available below.'}</p></Callout>}
        {session.historyFailed && factor && ['air', 'uv', 'pollen'].includes(factor) && <Callout tone="notice"><p>History could not be updated. Any dates shown are from the last successful history request.</p></Callout>}
        {content}
      </>}
      {children}
    </main>
    {ready && <><nav className="halo-f-tabs" aria-label="Main navigation">{tabItems.map(tab => { const Icon = tab.icon; const available = tab.key === 'today' || tab.key === 'home'; return available ? <Link key={tab.key} prefetch={false} scroll={false} href={`/${tab.key}`} aria-current={!settings && (home ? tab.key === 'home' : tab.key === 'today') ? 'page' : undefined}><Icon size={23} aria-hidden="true" /><span>{tab.label}</span></Link> : <button key={tab.key} aria-disabled="true" aria-label={`${tab.label}, coming in a later stage`} onClick={() => setToast(`${tab.label} is not part of this release yet.`)}><Icon size={23} aria-hidden="true" /><span>{tab.label}</span></button>; })}</nav>{!settings && !sheet && process.env.NEXT_PUBLIC_HALO_ASSISTANT !== 'off' && <button className="halo-f-assistant" aria-label="Open Luna" onClick={() => openSheet('assistant')}><LunaMark size={28} /></button>}</>}
    {toast && !sheet && <div className="halo-f-toast" role="status">{toast}</div>}
    {ready && sheet === 'assistant' && <LunaAssistant key={pathname} live={session.api} page={home ? 'homeguard' : settings ? 'settings' : 'today'} factor={factor} home={home} offline={session.offline} missing={!reading.data} onClose={closeSheet} factorHref={factorHref} onNavigate={routeFromSheet} />}
    {ready && sheet === 'alerts' && <BottomSheet id="halo-alerts" title="Alerts" height="standard" onClose={closeSheet}><AlertsContent onNavigate={routeFromSheet} /></BottomSheet>}
  </div>;
}

function AlertsContent({ onNavigate }: { onNavigate: (href: string) => void }) {
  const session = useStageSession(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function mutate(change: AlertMutation) {
    if (busy || controller.current) return; const request = new AbortController(); controller.current = request; setBusy(true); setMessage('');
    try { const response = await session.api.markAlerts(change, request.signal); if (!request.signal.aborted) { setMessage(response.updated ? 'Alerts updated.' : 'No alerts changed. The list has been refreshed.'); await session.refreshAlerts(); } }
    catch (error) { if (!request.signal.aborted) setMessage(copy.errors[errorCode(error)]); }
    finally { if (controller.current === request) controller.current = null; if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="halo-f-stack">
    {session.alertsPending && !session.alerts && <p role="status">Loading alerts.</p>}
    {session.alertsError && <Callout tone="error"><p>{copy.errors[session.alertsError]}</p><button className="halo-text-button" onClick={() => void session.refreshAlerts()}>Retry alerts</button></Callout>}
    {session.alerts && !session.alerts.alerts.length && <p>No alerts right now. You can still review your latest readings.</p>}
    {!!session.alerts?.unread && <Button variant="secondary" busy={busy} disabled={session.offline} onClick={() => void mutate({ all: true })}>Mark all as read</Button>}
    {session.alerts?.alerts.map(alert => <article className="halo-f-card" key={alert.id}><h3>{alert.title}</h3><p>{alert.message}</p><SeverityPill severity={alert.severity} />{alert.fired_at && <time className="halo-f-meta" dateTime={alert.fired_at}>{new Date(alert.fired_at).toLocaleString()}</time>}<div className="halo-stage-alert-actions">{!alert.read && <button className="halo-text-button" disabled={busy || session.offline} onClick={() => void mutate({ id: alert.id })}>Mark as read</button>}<button className="halo-text-button" disabled={busy || session.offline} onClick={() => void mutate({ id: alert.id, dismissed: true })}>Dismiss</button></div><button className="halo-text-button" onClick={() => onNavigate(alert.type === 'new_water_results' ? '/factors/pfas' : alert.type === 'radon_season' ? '/factors/radon' : '/today')}>View readings</button></article>)}
    {message && <p role="status">{message}</p>}
  </div>;
}
