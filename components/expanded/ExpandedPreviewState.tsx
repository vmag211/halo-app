'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BottomSheet, Callout } from '@/components/ui/Foundation';
import Button from '@/components/ui/Button';
import { actionDraftError, type ActionSeed, type PreviewAction } from '@/lib/frontend/expanded-preview';
import type { HouseholdBands } from '@/lib/frontend/home-household';
import { HomeWorkspaceReviewControls } from '@/components/homeguard/HomeWorkspaceState';
import { ExploreReviewControls } from './ExploreWorkspace';

type Draft = { seed: ActionSeed; title: string; date: string };
type PreviewState = {
  actions: PreviewAction[]; draft: Draft | null; visible: boolean; fail: boolean;
  householdDraft: HouseholdBands | null; setHouseholdDraft: (draft: HouseholdBands | null) => void;
  open: (seed: ActionSeed) => void; close: () => void; setDraft: (draft: Draft) => void;
  setFail: (fail: boolean) => void; save: () => void;
  changeState: (id: string, state: PreviewAction['state']) => void; reset: () => void;
  addActions: (seeds: ActionSeed[], date: string) => boolean;
  updateAction: (id: string, revision: number, patch: Pick<PreviewAction, 'title' | 'date'>) => boolean;
};
const State = createContext<PreviewState | null>(null);
const Mode = createContext(false);
export const ExpandedMode = Mode.Provider;
export const useExpandedMode = () => useContext(Mode);
export const useExpandedPreview = () => useContext(State);

/** Review-only memory. Never imports the live client or persists household data. */
export function ExpandedPreviewProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<PreviewAction[]>([]);
  const actionsRef = useRef<PreviewAction[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [visible, setVisible] = useState(false);
  const [fail, setFail] = useState(false);
  const [householdDraft, setHouseholdDraft] = useState<HouseholdBands | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    const back = () => setVisible(window.history.state?.haloExpandedAction === true && !!draftRef.current);
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const close = () => {
    setVisible(false);
    if (window.history.state?.haloExpandedAction) window.history.back();
  };
  const open = (seed: ActionSeed) => {
    const existing = actions.find(action => action.key === seed.key);
    setDraft(previous => previous?.seed.key === seed.key ? previous : { seed: existing ?? seed, title: existing?.title ?? seed.title, date: existing?.date ?? seed.date ?? '' });
    if (!window.history.state?.haloExpandedAction) window.history.pushState({ ...window.history.state, haloExpandedAction: true }, '', window.location.href);
    setVisible(true);
  };
  const save = () => {
    if (!draft || actionDraftError(draft.title, draft.date)) return;
    setActions(previous => {
      const existing = previous.find(action => action.key === draft.seed.key);
      const next: PreviewAction = { ...draft.seed, id: existing?.id ?? crypto.randomUUID(), title: draft.title.trim(), date: draft.date, state: existing?.state ?? 'saved', revision: existing ? (existing.revision ?? 1) + 1 : 1 };
      const result = existing ? previous.map(action => action.id === existing.id ? next : action) : [...previous, next];
      actionsRef.current = result; return result;
    });
    close();
  };
  const addActions = (seeds: ActionSeed[], date: string) => {
    if (fail || !seeds.length || seeds.some(seed => actionDraftError(seed.title, date))) return false;
    setActions(previous => { const result = seeds.reduce((next, seed) => {
      // One canonical action per origin. Re-selecting a project step never resets its state or user-edited title/date.
      if (next.some(action => action.key === seed.key)) return next;
      return [...next, { ...seed, id: crypto.randomUUID(), date, state: 'saved' as const, revision: 1 }];
    }, previous); actionsRef.current = result; return result; });
    return true;
  };
  const updateAction = (id: string, revision: number, patch: Pick<PreviewAction, 'title' | 'date'>) => {
    const current = actionsRef.current.find(action => action.id === id);
    if (fail || !current || (current.revision ?? 1) !== revision || actionDraftError(patch.title, patch.date)) return false;
    const result = actionsRef.current.map(action => action.id === id ? { ...action, ...patch, title: patch.title.trim(), revision: revision + 1 } : action);
    actionsRef.current = result; setActions(result); return true;
  };
  return <State.Provider value={{ actions, draft, visible, fail, householdDraft, setHouseholdDraft, open, close, setDraft, setFail, save, addActions, updateAction, changeState: (id, state) => setActions(previous => { const result = previous.map(action => action.id === id ? { ...action, state, revision: (action.revision ?? 1) + 1 } : action); actionsRef.current = result; return result; }), reset: () => { close(); actionsRef.current = []; setActions([]); setDraft(null); setFail(false); } }}>{children}</State.Provider>;
}

export function ExpandedReviewControls() {
  const state = useExpandedPreview();
  if (!state) return null;
  return <><div className="halo-f-tool-grid"><label className="halo-f-tool-check"><input type="checkbox" checked={state.fail} onChange={e => state.setFail(e.target.checked)} />Simulate failed action save</label><button type="button" onClick={state.reset}>Reset sample actions</button></div><HomeWorkspaceReviewControls /><ExploreReviewControls /></>;
}

export function ExpandedActionDialog({ offline }: { offline: boolean }) {
  const state = useExpandedPreview();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    // Browser Back also cancels a simulated write, not just the Close button.
    if (!state?.visible && timer.current) clearTimeout(timer.current);
    if (!state?.visible) queueMicrotask(() => { setPending(false); setError(''); });
  }, [state?.visible]);
  if (!state?.visible || !state.draft) return null;
  const draft = state.draft;
  const exists = state.actions.some(action => action.key === draft.seed.key);
  function submit() {
    if (!state?.draft || pending) return;
    const invalid = actionDraftError(state.draft.title, state.draft.date);
    setError(invalid ?? '');
    if (invalid || offline) return;
    setPending(true);
    timer.current = setTimeout(() => {
      setPending(false);
      if (state.fail) setError('The sample save failed. Your changes are still here. Turn off the failure simulation and retry.');
      else state.save();
    }, 400);
  }
  return <BottomSheet id="expanded-action" title={exists ? 'Your saved action' : 'Save a practical step'} height="standard" onClose={() => { if (timer.current) clearTimeout(timer.current); setPending(false); setError(''); state.close(); }}>
    <form className="halo-expanded-form" onSubmit={e => { e.preventDefault(); submit(); }}>
      <p className="halo-f-meta">Design review only. Actions stay in memory during this visit, not in your HALO account. Use sample text only.</p>
      {exists && <Callout tone="info"><p>This step is already in My Week. Update the same action here.</p></Callout>}
      <label>Action title<input maxLength={160} required value={draft.title} disabled={pending} onChange={e => state.setDraft({ ...draft, title: e.target.value })} /></label>
      <p>{draft.seed.reason}</p>
      <label>All-day date (optional)<input type="date" value={draft.date} disabled={pending} onChange={e => state.setDraft({ ...draft, date: e.target.value })} /></label>
      <p className="halo-f-meta">{draft.date ? `Planned for ${draft.date}. This is a calendar date, not a timed reminder.` : 'No date selected. This action will stay in Saved for later.'} Timed reminders and recurring schedules are not connected in this review.</p>
      {offline && <Callout tone="notice"><p>You are offline. Your draft stays here, but this review does not queue saves.</p></Callout>}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" busy={pending} disabled={offline}>{exists ? 'Update sample action' : 'Save sample action'}</Button>
      <Button type="button" variant="tertiary" disabled={pending} onClick={() => { setError(''); state.close(); }}>Close and keep draft</Button>
    </form>
  </BottomSheet>;
}
