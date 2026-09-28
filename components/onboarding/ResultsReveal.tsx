"use client";

import { useCallback, useEffect, useState } from 'react';
import { Check, Info, Minus } from 'lucide-react';
import Button from '@/components/ui/Button';
import DataState from '@/components/ui/DataState';
import SeverityPill from '@/components/ui/SeverityPill';
import { copy } from '@/lib/frontend/copy';
import { getRevealRows, isOutsideNC } from '@/lib/frontend/onboarding';
import { useHaloData, type HaloDataState } from '@/lib/frontend/useHaloData';
import type { DailyResponse, DataResult, ErrorCode, HomeResponse, OnboardResponse, OnboardingApi } from '@/lib/frontend/types';

function result<T extends HomeResponse | DailyResponse>(state: HaloDataState<T>): DataResult<T> {
  if (state.data) return { status: 'success', data: state.data };
  if (state.status === 'error') return { status: 'error', error: state.error ?? 'generic' };
  return state.status === 'empty' ? { status: 'empty' } : { status: 'loading' };
}

export default function ResultsReveal({ api, location, fresh, onComplete, onInvalidLocation }: {
  api: OnboardingApi; location: OnboardResponse | null; fresh: boolean;
  onComplete: () => void; onInvalidLocation: (code: ErrorCode) => void;
}) {
  const getHome = useCallback((signal?: AbortSignal) => api.getHome(signal), [api]);
  const getDaily = useCallback((signal?: AbortSignal) => api.getDaily(signal, { fresh }), [api, fresh]);
  // This fresh reveal deliberately does not load a previous home's cache.
  const home = useHaloData('/api/home-guard', { loader: getHome });
  const daily = useHaloData('/api/daily-score', { loader: getDaily });
  const [visibleRows, setVisibleRows] = useState(1);
  const invalid = [home.error, daily.error].find(code => code === 'session_changed' || code === 'no_location');

  useEffect(() => { if (invalid) onInvalidLocation(invalid); }, [invalid, onInvalidLocation]);
  useEffect(() => {
    let active = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { if (motion.matches) setVisibleRows(4); };
    queueMicrotask(() => { if (active) update(); });
    const timers = motion.matches ? [] : [1, 2, 3].map(i => setTimeout(() => setVisibleRows(i + 1), i * 450));
    motion.addEventListener('change', update);
    return () => { active = false; timers.forEach(clearTimeout); motion.removeEventListener('change', update); };
  }, []);

  const rows = getRevealRows(location, result(home), result(daily));
  const pending = home.status === 'loading' || daily.status === 'loading';
  const error = home.error ?? daily.error;
  const retry = () => {
    if (home.error) void home.refresh();
    if (daily.error) void daily.refresh();
  };

  return <>
    <h1 className="halo-sr">{copy.reveal.title}</h1>
    <div className="halo-reveal-head"><div className="halo-logo halo-reveal-logo" aria-hidden="true" /></div>
    <div className="halo-reveal-lines" aria-live="polite">
      {rows.map((row, index) => <div key={row.key} className="halo-reveal-line" style={index >= visibleRows ? { visibility: 'hidden' } : undefined} aria-hidden={index >= visibleRows || undefined}>
        <span className="halo-resolve-icon" data-missing={row.missing}>{row.pending ? <span className="halo-spinner" aria-hidden="true" /> : row.missing ? <Minus size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}</span>
        <div className="halo-reveal-label">{row.label}</div>
        <div className="halo-result">{row.pending ? <><span className="halo-result-skeleton" aria-hidden="true" /><span className="halo-result-skeleton" aria-hidden="true" /><span className="halo-sr">{copy.common.checking}</span></> : row.severity ? <SeverityPill severity={row.severity} /> : row.result}</div>
      </div>)}
    </div>
    {isOutsideNC(location) && <div className="halo-region-note"><Info size={18} aria-hidden="true" /><p>{copy.reveal.outside}</p></div>}
    <div className="halo-footer">
      <DataState status={error ? 'error' : 'success'} error={error} errorMessage={copy.reveal.failureNote} loading={null} retry={retry}>{null}</DataState>
      <Button onClick={onComplete} disabled={pending || visibleRows < 4}>{copy.home.results}</Button>
    </div>
  </>;
}
