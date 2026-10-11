'use client';

import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { sampleTests } from '@/lib/frontend/home-test-preview';
import { sampleAssets, sampleObservations } from '@/lib/frontend/home-maintenance-preview';
import { initialGardens, initialUsage } from '@/lib/frontend/home-food-preview';

export type HomeScenario = 'ready' | 'empty' | 'loading' | 'error' | 'offline' | 'stale' | 'conflict' | 'save-error';
export type HomeRecord = { id: string; title: string; revision: number };
type Collections = Record<string, HomeRecord[]>;
type State = {
  collections: Collections; drafts: Record<string, unknown>; scenario: HomeScenario; message: string; pending: boolean;
  setScenario: (next: HomeScenario) => void; clearMessage: () => void;
  seed: (key: string, initial: HomeRecord[]) => void;
  write: (key: string, record: HomeRecord) => Promise<boolean>;
  remove: (key: string, id: string) => Promise<boolean>;
  removeNotes: (selection: { id: string; revision: number }[]) => Promise<boolean>;
  setDraft: (key: string, update: (previous: unknown) => unknown) => void;
  clearDraft: (key: string) => void; reset: () => void;
};
const Context = createContext<State | null>(null);
function initialCollections(): Collections {
  // Every entry point sees the same sample records, even before its editor is visited.
  return structuredClone({ tests: sampleTests, assets: sampleAssets, observations: sampleObservations, gardens: initialGardens, usage: initialUsage });
}

/** Isolated, in-memory wireframe records. No transport, authentication or storage. */
export function HomeWorkspaceProvider({ children }: { children: ReactNode }) {
  const [collections, setCollections] = useState<Collections>(initialCollections);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [scenario, changeScenario] = useState<HomeScenario>('ready');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const recordsRef = useRef(collections);
  const scenarioRef = useRef(scenario);
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => { generation.current++; alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!Object.keys(drafts).some(key => /^(tests:|asset:|observation:|pantry:|garden-|fish-note-|food-question-|grower-(?!filters)|usage-(?!comparison)|explore:(note:|quick-note:|outreach-drafts|outcome:|commitment:|project-notes:|project-outcome:))/.test(key))) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  function commit(next: Collections) { recordsRef.current = next; setCollections(next); }
  function seed(key: string, initial: HomeRecord[]) {
    if (Object.hasOwn(recordsRef.current, key)) return;
    commit({ ...recordsRef.current, [key]: scenarioRef.current === 'empty' ? [] : initial });
  }
  function setScenario(next: HomeScenario) {
    generation.current++; scenarioRef.current = next; changeScenario(next); setMessage('');
    if (next === 'empty') commit(Object.fromEntries(Object.keys(recordsRef.current).map(key => [key, []])));
  }
  async function mutate(key: string, id: string, change: () => boolean) {
    const lock = `${key}:${id}`;
    if (locks.current.has(lock)) return false;
    if (scenarioRef.current === 'offline' || typeof navigator !== 'undefined' && !navigator.onLine) {
      setMessage('Offline: your draft remains here. Nothing has been saved or queued.'); return false;
    }
    const version = generation.current;
    locks.current.add(lock); setPending(true); setMessage('Saving this sample change...');
    await new Promise(resolve => setTimeout(resolve, 260));
    locks.current.delete(lock);
    if (!alive.current) return false;
    setPending(locks.current.size > 0);
    if (version !== generation.current) { setMessage('The review state changed. Your draft is retained; check it before retrying.'); return false; }
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setMessage('Connection lost before saving. Your draft remains here. Nothing was saved or queued.'); return false; }
    if (scenarioRef.current === 'save-error') { setMessage('The sample save failed. Your draft is retained. Choose Ready in review controls, then retry.'); return false; }
    if (scenarioRef.current === 'conflict') { setMessage('Revision conflict: nothing was overwritten. Your local draft is retained. Return to the record to compare it, then retry after resolving the review scenario.'); return false; }
    const result = change();
    if (result) setMessage('Updated in this sample session only. Reloading clears your changes.');
    return result;
  }
  async function write(key: string, record: HomeRecord) {
    return mutate(key, record.id, () => {
      const records = recordsRef.current[key] ?? [];
      const existing = records.find(item => item.id === record.id);
      if (existing && existing.revision !== record.revision) { setMessage('This record changed since you opened it. Your draft is retained; review the latest version before saving.'); return false; }
      const next = { ...record, revision: (existing?.revision ?? 0) + 1 };
      commit({ ...recordsRef.current, [key]: existing ? records.map(item => item.id === next.id ? next : item) : [...records, next] });
      return true;
    });
  }
  async function remove(key: string, id: string) {
    return mutate(key, id, () => {
      const next = { ...recordsRef.current, [key]: (recordsRef.current[key] ?? []).filter(item => item.id !== id) };
      if (key === 'exploreNotes') {
        // The case and its history belong to this note. Independently saved Plan actions and outreach snapshots do not.
        next.exploreOutcomes = (next.exploreOutcomes ?? []).filter(item => item.id !== `note-case:${id}`);
        setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([draftKey]) => ![`explore:note:${id}`, `explore:reference:${id}`, `explore:outcome:note-case:${id}`].includes(draftKey))));
      }
      if (key === 'exploreEngagements') setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([draftKey]) => draftKey !== `explore:commitment:${id}`)));
      commit(next); return true;
    });
  }
  async function removeNotes(selection: { id: string; revision: number }[]) {
    return mutate('exploreNotes', 'confirmed-bundle', () => {
      const current = recordsRef.current.exploreNotes ?? [];
      const ids = new Set(selection.map(item => item.id));
      if (!selection.length || ids.size !== selection.length || !selection.every(item => current.some(record => record.id === item.id && record.revision === item.revision))) {
        setMessage('One of the selected notes changed or is no longer available. Review the selection again. No notes were removed.'); return false;
      }
      // One memory commit mirrors the required atomic owned transaction.
      commit({ ...recordsRef.current, exploreNotes: current.filter(item => !ids.has(item.id)), exploreOutcomes: (recordsRef.current.exploreOutcomes ?? []).filter(item => !selection.some(note => item.id === `note-case:${note.id}`)) });
      setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !selection.some(note => [`explore:note:${note.id}`, `explore:reference:${note.id}`, `explore:outcome:note-case:${note.id}`].includes(key)))));
      return true;
    });
  }
  return <Context.Provider value={{ collections, drafts, scenario, message, pending, setScenario, clearMessage: () => setMessage(''), seed, write, remove, removeNotes,
    setDraft: (key, update) => setDrafts(previous => ({ ...previous, [key]: update(previous[key]) })),
    clearDraft: key => setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; }),
    reset: () => { generation.current++; commit(initialCollections()); setDrafts({}); setScenario('ready'); setMessage('Sample workspace reset. No account data was changed.'); },
  }}>{children}</Context.Provider>;
}

export function useHomeWorkspace() {
  const state = useContext(Context);
  if (!state) throw new Error('Homeguard wireframes require the isolated workspace provider.');
  return state;
}
export function useHomeCollection<T extends HomeRecord>(key: string, initial: T[]) {
  const state = useHomeWorkspace();
  useEffect(() => { state.seed(key, initial); }, [key, initial, state]);
  return { records: (state.collections[key] ?? (state.scenario === 'empty' ? [] : initial)) as T[], save: (record: T) => state.write(key, record), remove: (id: string) => state.remove(key, id) };
}
export function useHomeDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>, () => void] {
  const state = useHomeWorkspace();
  const draft = (Object.hasOwn(state.drafts, key) ? state.drafts[key] : initial) as T;
  const update: Dispatch<SetStateAction<T>> = value => state.setDraft(key, previous => typeof value === 'function' ? (value as (value: T) => T)((previous ?? initial) as T) : value);
  return [draft, update, () => state.clearDraft(key)];
}

export function HomeWorkspaceReviewControls() {
  const state = useHomeWorkspace();
  const [summaryFailure, setSummaryFailure] = useHomeDraft<string>('summary-section-failure', '');
  return <div className="halo-f-tool-grid"><label>Homeguard workspace state<select value={state.scenario} onChange={e => state.setScenario(e.target.value as HomeScenario)}>{(['ready', 'empty', 'loading', 'error', 'offline', 'stale', 'conflict', 'save-error'] as const).map(value => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select></label><label>Simulate summary section failure<select value={summaryFailure} onChange={e => setSummaryFailure(e.target.value)}><option value="">All selected sections available</option>{Object.entries({ tests: 'Test reports', actions: 'Saved actions', maintenance: 'Maintenance records', observations: 'Moisture observations', gardens: 'Garden records' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" onClick={state.reset}>Reset Homeguard sample records</button></div>;
}
