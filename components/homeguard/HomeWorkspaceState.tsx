'use client';

import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { sampleTests } from '@/lib/frontend/home-test-preview';
import { sampleAssets, sampleObservations } from '@/lib/frontend/home-maintenance-preview';
import { initialGardens, initialUsage } from '@/lib/frontend/home-food-preview';
import {recordFingerprint} from '@/lib/frontend/settings-preview';

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
  clearPrivate: (scope:'journal'|'all', expected:string, checkOther?:()=>boolean) => Promise<boolean>;
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
    const conversation = drafts['luna:conversation'] as { draft?: string; messages?: { proposal?: { status?: string } }[] } | undefined;
    const lunaDraft = Boolean(conversation?.draft?.trim() || conversation?.messages?.some(message => message.proposal?.status === 'review'));
    const projectInput = String(drafts['explore:project-direct-interest'] ?? '').trim();
    const generated = drafts['explore:generated-projects'] as { request?: string } | undefined;
    const projectDraft = Boolean(projectInput && projectInput !== generated?.request || drafts['explore:project-generation-fit']);
    const journal = drafts['week:journal-draft'] as { symptoms?: string[]; fine?: boolean; note?: string } | undefined;
    const outdoor = drafts['week:outdoor-draft'] as { activity?: string } | undefined;
    const weekDraft = Boolean(journal?.fine || journal?.symptoms?.length || journal?.note?.trim() || outdoor?.activity?.trim());
    const settingsDraft=Object.keys((drafts['settings:edits']??{})as object).length>0;
    if (!lunaDraft && !projectDraft && !weekDraft && !settingsDraft && !Object.keys(drafts).some(key => /^(tests:|asset:|observation:|pantry:|garden-|fish-note-|food-question-|grower-(?!filters)|usage-(?!comparison)|explore:(note:|outreach-drafts|outcome:|commitment:|project-notes:|project-outcome:))/.test(key))) return;
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
    locks.current.add(lock); setPending(true); setMessage('Saving...');
    await new Promise(resolve => setTimeout(resolve, 260));
    locks.current.delete(lock);
    if (!alive.current) return false;
    setPending(locks.current.size > 0);
    if (version !== generation.current) { setMessage('Saving was interrupted. Your draft is kept. Review it before retrying.'); return false; }
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setMessage('Connection lost before saving. Your draft remains here. Nothing was saved or queued.'); return false; }
    if (scenarioRef.current === 'save-error') { setMessage('Could not save. Your draft is kept. Please try again.'); return false; }
    if (scenarioRef.current === 'conflict') { setMessage('This record changed. Your draft is kept. Review the latest version before saving.'); return false; }
    const result = change();
    if (result) setMessage('Saved.');
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
  async function clearPrivate(scope:'journal'|'all',expected:string,checkOther?:()=>boolean) {
    return mutate('privacy',scope,()=>{
      if(recordFingerprint(recordsRef.current,scope)!==expected||checkOther&&!checkOther()){setMessage('Records changed. Nothing was deleted. Reopen the review.');return false;}
      commit(Object.fromEntries(Object.entries(recordsRef.current).map(([key,rows])=>[key,scope==='all'||key==='weekJournal'?[]:rows])));
      setDrafts(previous=>scope==='all'?{}:Object.fromEntries(Object.entries(previous).filter(([key])=>!/^week:(journal|season|pattern)/.test(key))));
      // Prevent a not-yet-mounted collection from restoring its fixture after erasure.
      if(scope==='all'){scenarioRef.current='empty';changeScenario('empty');}
      return true;
    });
  }
  return <Context.Provider value={{ collections, drafts, scenario, message, pending, setScenario, clearMessage: () => setMessage(''), seed, write, remove, removeNotes,clearPrivate,
    setDraft: (key, update) => setDrafts(previous => ({ ...previous, [key]: update(previous[key]) })),
    clearDraft: key => setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; }),
    reset: () => { generation.current++; commit(initialCollections()); setDrafts({}); setScenario('ready'); setMessage('Workspace reset.'); },
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
