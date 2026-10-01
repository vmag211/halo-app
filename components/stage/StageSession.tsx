'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { createLiveStageApi, type AlertsResponse, type HistoryResponse, type LearnResponse, type LiveStageApi } from '@/lib/frontend/stage-api';
import { buildStageData } from '@/lib/frontend/stage-data';
import { errorCode, withDeadline } from '@/lib/frontend/api';
import { clearOnboardingStorage, hasCompletedOnboarding, markCompleted, readReading } from '@/lib/frontend/storage';
import { isProfileComplete, normalizeHousehold } from '@/lib/frontend/onboarding';
import type { DailyResponse, ErrorCode, HomeResponse, ProfileResponse } from '@/lib/frontend/types';
import { factorKeys, isFactorKey, type FactorKey } from '@/lib/frontend/factor-preview';
import { StageRuntimeProvider } from '@/components/foundation/StageRuntime';
import { HouseholdProvider } from '@/components/foundation/PreviewHousehold';

const liveApi = createLiveStageApi();
type Reading<T> = { data: T | null; loading: boolean; error: ErrorCode | null; cached: boolean };
const blank = <T,>(): Reading<T> => ({ data: null, loading: false, error: null, cached: false });
type Session = {
  api: LiveStageApi; gate: 'loading' | 'ready' | 'error'; gateError: ErrorCode | null;
  profile: ProfileResponse | null; profileWarning: boolean; offline: boolean;
  daily: Reading<DailyResponse>; home: Reading<HomeResponse>; historyFailed: boolean;
  alerts: AlertsResponse | null; alertsError: ErrorCode | null; alertsPending: boolean;
  refresh: (fresh?: boolean) => Promise<void>; refreshAlerts: () => Promise<void>; restart: () => Promise<void>;
};
const Context = createContext<Session | null>(null);
export function useStageSession() { const value = useContext(Context); if (!value) throw new Error('StageSession is required'); return value; }

/** Profile/household/chat stay in memory. Only the established, sanitized,
 * identity-scoped environmental cache is read or written by this stage. */
export default function StageSession({ children, api = liveApi }: { children: ReactNode; api?: LiveStageApi }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  const [gate, setGate] = useState<Session['gate']>('loading');
  const [gateError, setGateError] = useState<ErrorCode | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [profileWarning, setProfileWarning] = useState(false);
  const [offline, setOffline] = useState(false);
  const [daily, setDaily] = useState<Reading<DailyResponse>>(blank);
  const [home, setHome] = useState<Reading<HomeResponse>>(blank);
  const [history, setHistory] = useState<HistoryResponse>();
  const [historyFailed, setHistoryFailed] = useState(false);
  const [learn, setLearn] = useState<Partial<Record<FactorKey, LearnResponse>>>({});
  const [learnPending, setLearnPending] = useState(false);
  const [learnFailed, setLearnFailed] = useState(false);
  const [learnAttempt, setLearnAttempt] = useState(0);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [alertsError, setAlertsError] = useState<ErrorCode | null>(null);
  const [alertsPending, setAlertsPending] = useState(false);
  const bootstrap = useRef<AbortController | null>(null);
  const profileRequest = useRef<AbortController | null>(null);
  const readingsRequest = useRef<AbortController | null>(null);
  const alertsRequest = useRef<AbortController | null>(null);
  const explanationRequest = useRef<AbortController | null>(null);
  const lastRefresh = useRef(0);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const gateRef = useRef<Session['gate']>('loading');

  const cancelAll = useCallback(() => {
    ++epoch.current;
    bootstrap.current?.abort(); profileRequest.current?.abort(); readingsRequest.current?.abort();
    explanationRequest.current?.abort(); alertsRequest.current?.abort();
  }, []);
  const clearMemory = useCallback(() => {
    setDaily(blank()); setHome(blank()); setHistory(undefined); setHistoryFailed(false);
    setLearn({}); setLearnPending(false); setLearnFailed(false);
    setAlerts(null); setAlertsError(null); setAlertsPending(false); setProfile(null); setProfileWarning(false);
  }, []);
  const setupLocation = useCallback(() => {
    clearOnboardingStorage(); gateRef.current = 'loading'; setGate('loading');
    router.replace(`/onboarding?entry=1&next=${encodeURIComponent(pathRef.current)}`);
  }, [router]);

  const invalidateLocation = useCallback((code: ErrorCode) => {
    if (!['no_location', 'no_county', 'session_changed', 'signin_failed'].includes(code)) return false;
    cancelAll(); clearOnboardingStorage(); clearMemory();
    gateRef.current = 'error'; setGate('error'); setGateError(code);
    if (code === 'no_location' || code === 'no_county') setupLocation();
    return true;
  }, [cancelAll, clearMemory, setupLocation]);

  const refreshAlerts = useCallback(async () => {
    if (!mounted.current || gateRef.current !== 'ready') return;
    alertsRequest.current?.abort(); const controller = new AbortController(); alertsRequest.current = controller;
    const generation = epoch.current;
    const active = () => mounted.current && !controller.signal.aborted && generation === epoch.current && alertsRequest.current === controller;
    setAlertsPending(true); setAlertsError(null);
    try { const value = await api.getAlerts(controller.signal); if (active()) setAlerts(value); }
    catch (error) { if (active()) { const code = errorCode(error); if (!invalidateLocation(code)) setAlertsError(code); } }
    finally { if (active()) setAlertsPending(false); }
  }, [api, invalidateLocation]);

  const refresh = useCallback(async (fresh = false) => {
    if (!mounted.current || gateRef.current !== 'ready') return;
    readingsRequest.current?.abort(); const controller = new AbortController(); readingsRequest.current = controller;
    // Abort synchronously, before the loading render/effect cleanup. An old
    // explanation may resolve between this call and React's next commit.
    explanationRequest.current?.abort();
    const generation = epoch.current;
    const active = () => mounted.current && !controller.signal.aborted && generation === epoch.current && readingsRequest.current === controller;
    lastRefresh.current = Date.now();
    setLearn({}); setLearnPending(false); setLearnFailed(false);
    setDaily(previous => ({ ...previous, loading: true, error: null }));
    setHome(previous => ({ ...previous, loading: true, error: null }));
    setHistoryFailed(false);
    await Promise.all([
      api.getDaily(controller.signal, { fresh }).then(data => { if (active()) setDaily({ data, loading: false, error: null, cached: data.cached === true }); }).catch(error => {
        if (!active()) return; const code = errorCode(error);
        if (!invalidateLocation(code)) setDaily(previous => ({ ...previous, loading: false, error: code, cached: !!previous.data }));
      }),
      api.getHome(controller.signal).then(data => { if (active()) setHome({ data, loading: false, error: null, cached: false }); }).catch(error => {
        if (!active()) return; const code = errorCode(error);
        if (!invalidateLocation(code)) setHome(previous => ({ ...previous, loading: false, error: code, cached: !!previous.data }));
      }),
      api.getHistory(7, controller.signal).then(data => { if (active()) setHistory(data); }).catch(error => { if (active() && !invalidateLocation(errorCode(error))) setHistoryFailed(true); }),
    ]);
  }, [api, invalidateLocation]);

  const restart = useCallback(async () => {
    cancelAll(); const generation = epoch.current;
    const controller = new AbortController(); bootstrap.current = controller;
    gateRef.current = 'loading'; setGate('loading'); setGateError(null); clearMemory();
    const active = () => mounted.current && !controller.signal.aborted && generation === epoch.current;
    try {
      // This outer deadline also cancels initialization when the page unmounts
      // or the identity changes. The shared auth layer owns its single flight.
      await withDeadline(async signal => { await api.ensureSession(); if (!signal.aborted) await api.getIdentity?.(); }, 15000, controller.signal);
      if (!active()) return;
      try {
        const value = await api.getProfile(controller.signal); if (!active()) return;
        if (!isProfileComplete(value)) {
          setupLocation(); return;
        }
        markCompleted(value); setProfile(value);
      } catch (error) {
        if (!active()) return;
        const code = errorCode(error);
        if (['session_changed', 'signin_failed'].includes(code)) throw error;
        if (['no_location', 'no_county', 'invalid_response'].includes(code) || !hasCompletedOnboarding()) { setupLocation(); return; }
        // A previously verified device may still read its cached evidence. Never
        // invent household categories or treat a network failure as incomplete setup.
        setProfileWarning(true);
      }
      if (!active()) return;
      setDaily({ ...blank(), data: readReading<DailyResponse>('daily')?.data ?? null, cached: true });
      setHome({ ...blank(), data: readReading<HomeResponse>('home')?.data ?? null, cached: true });
      gateRef.current = 'ready'; setGate('ready'); void refresh(); void refreshAlerts();
    } catch (error) { if (active()) { gateRef.current = 'error'; setGate('error'); setGateError(errorCode(error)); } }
  }, [api, refresh, refreshAlerts, cancelAll, clearMemory, setupLocation]);

  const refreshProfile = useCallback(async () => {
    if (!mounted.current) return;
    if (gateRef.current !== 'ready') { void restart(); return; }
    profileRequest.current?.abort(); readingsRequest.current?.abort(); explanationRequest.current?.abort(); alertsRequest.current?.abort();
    const controller = new AbortController(); profileRequest.current = controller; const generation = epoch.current;
    const active = () => mounted.current && !controller.signal.aborted && generation === epoch.current && profileRequest.current === controller;
    // Keep Settings mounted so its unrelated, unsaved fields survive a save or
    // reconnection. Its profile-null state disables writes during this recheck.
    setProfile(null); setProfileWarning(false); setLearn({}); setLearnPending(false); setLearnFailed(false);
    setHistory(undefined); setHistoryFailed(false); setAlerts(null); setAlertsPending(false);
    setDaily({ ...blank(), loading: true }); setHome({ ...blank(), loading: true });
    try {
      const value = await api.getProfile(controller.signal); if (!active()) return;
      if (!isProfileComplete(value)) { invalidateLocation('no_location'); return; }
      setProfile(value); markCompleted(value);
    } catch (error) {
      if (!active()) return; const code = errorCode(error);
      if (invalidateLocation(code)) return;
      if (!hasCompletedOnboarding() || code === 'invalid_response') { setupLocation(); return; }
      setProfileWarning(true);
    }
    if (active()) { void refresh(); void refreshAlerts(); }
  }, [api, restart, refresh, refreshAlerts, invalidateLocation, setupLocation]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const online = () => { setOffline(!navigator.onLine); if (navigator.onLine) void refreshProfile(); };
    const offlineNow = () => setOffline(true);
    const reset = () => {
      // The identity event also reaches an open assistant/settings panel. Clear
      // its provider and close the live surface before another response paints.
      flushSync(() => { cancelAll(); clearMemory(); gateRef.current = 'loading'; setGate('loading'); setGateError(null); });
      void restart();
    };
    const settingsChanged = () => { void refreshProfile(); };
    queueMicrotask(() => { if (active && mounted.current) { setOffline(!navigator.onLine); void restart(); } });
    window.addEventListener('online', online); window.addEventListener('offline', offlineNow);
    window.addEventListener('halo:identity-changed', reset); window.addEventListener('halo:settings-changed', settingsChanged);
    return () => {
      active = false; mounted.current = false; cancelAll();
      window.removeEventListener('online', online); window.removeEventListener('offline', offlineNow);
      window.removeEventListener('halo:identity-changed', reset); window.removeEventListener('halo:settings-changed', settingsChanged);
    };
  }, [restart, refreshProfile, cancelAll, clearMemory]);

  useEffect(() => {
    const focus = () => { if (gate === 'ready' && !document.hidden && navigator.onLine && Date.now() - lastRefresh.current >= 15 * 60_000) void refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [gate, refresh]);

  const data = useMemo(() => buildStageData(daily.data, home.data, profile, history), [daily.data, home.data, profile, history]);
  const activeFactor = pathname.startsWith('/factors/') ? pathname.split('/')[2] : null;
  const topics = isFactorKey(activeFactor) ? [activeFactor] : pathname === '/family' ? factorKeys.slice(0, 4) : [];
  const topicKey = topics.join(',');
  useEffect(() => {
    const controller = new AbortController(); explanationRequest.current?.abort(); explanationRequest.current = controller;
    const generation = epoch.current;
    const active = () => mounted.current && !controller.signal.aborted && generation === epoch.current && explanationRequest.current === controller;
    queueMicrotask(() => {
      if (!active()) return;
      setLearn({}); setLearnFailed(false);
      if (gate !== 'ready' || offline || !topicKey || daily.loading || home.loading || !profile) { setLearnPending(false); return; }
      setLearnPending(true);
      void Promise.all(topicKey.split(',').map(async key => {
        const topic = key as FactorKey;
        try {
          const value = await api.getLearn(topic, { ...data.readings[topic].context, locale: profile.profile?.locale === 'es' ? 'es' : 'en' }, controller.signal);
          if (active()) setLearn(previous => ({ ...previous, [topic]: value }));
        } catch (error) { if (active()) { const code = errorCode(error); if (!invalidateLocation(code)) setLearnFailed(true); } }
      })).finally(() => { if (active()) setLearnPending(false); });
    });
    return () => controller.abort();
  }, [api, data, profile, topicKey, gate, offline, daily.loading, home.loading, learnAttempt, invalidateLocation]);

  const household = normalizeHousehold(profile?.household);
  const session: Session = { api, gate, gateError, profile, profileWarning, offline, daily, home, historyFailed, alerts, alertsError, alertsPending, refresh, refreshAlerts, restart };
  return <Context.Provider value={session}><StageRuntimeProvider value={{ ...data, household, learn, learnPending, learnFailed, retryLearn: () => setLearnAttempt(value => value + 1) }}><HouseholdProvider bands={household}>{children}</HouseholdProvider></StageRuntimeProvider></Context.Provider>;
}
