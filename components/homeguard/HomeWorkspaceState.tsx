'use client';

import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { sampleTests } from '@/lib/frontend/home-test-preview';
import { sampleAssets, sampleObservations } from '@/lib/frontend/home-maintenance-preview';
import { initialGardens, initialUsage } from '@/lib/frontend/home-food-preview';
import {recordFingerprint} from '@/lib/frontend/settings-preview';
import { acceptedHomeReceipt, homeReceiptCoversCommand, validHomeChanges, validHomeRecords, type HomeCollectionSnapshot, type HomeWorkspaceCommand, type HomeWorkspaceReceipt, type HomeWorkspaceService } from '@/lib/frontend/production/home-service';
import { validProductionCollection } from '@/lib/frontend/production/home-records';
import { clearHomeDraft } from '@/lib/frontend/home-drafts';
import { collectionView, homeSaveOffMessage } from '@/lib/frontend/collection-availability';

export type HomeScenario = 'ready' | 'empty' | 'loading' | 'error' | 'offline' | 'stale' | 'conflict' | 'save-error';
export type HomeRecord = { id: string; title: string; revision: number; homeContextId?:string };
export type Collections = Record<string, HomeRecord[]>;
type CollectionState = { status: 'loading' | 'ready' | 'error'; complete: boolean; revision?: string | number; message?: string; featureUnavailable?: boolean };
type State = {
  mode: 'preview' | 'production'; service?: HomeWorkspaceService;
  collectionStates: Record<string, CollectionState>;
  unknownOperations: { operationId: string; message: string }[];
  retry: (collection?: string) => Promise<void>; reconcile: (operationId: string) => Promise<boolean>;
  applyCanonical: (change: { drafts?: Record<string, unknown>; collections?: Collections }) => void;
  getRecord: (collection: string, id: string) => HomeRecord | undefined;
  trackPendingOperation: (operationId: string, domain: 'workspace' | 'attachments') => void;
  resolvePendingOperation: (operationId: string) => void;
  collections: Collections; drafts: Record<string, unknown>; scenario: HomeScenario; message: string; pending: boolean;
  setScenario: (next: HomeScenario) => void; clearMessage: () => void;
  seed: (key: string, initial: HomeRecord[]) => void;
  write: (key: string, record: HomeRecord, checkCurrent?:()=>boolean) => Promise<boolean>;
  remove: (key: string, id: string, expectedRevision?: number) => Promise<boolean>;
  removeNotes: (selection: { id: string; revision: number }[]) => Promise<boolean>;
  clearPrivate: (scope:'journal'|'all', expected:string, checkOther?:()=>boolean) => Promise<boolean>;
  setDraft: (key: string, update: (previous: unknown) => unknown) => void;
  clearDraft: (key: string, expected?: unknown) => void; reset: () => void;
};
const Context = createContext<State | null>(null);
const sharedCollectionKeys = ['tests', 'assets', 'observations', 'gardens', 'usage', 'pantryItems', 'foodQuestions', 'fishNotes', 'foodFollows', 'growerInquiries', 'homeTransitions', 'exploreNotes', 'exploreOutcomes', 'exploreProjects', 'exploreEngagements', 'weekJournal'];
function initialCollections(): Collections {
  // Every entry point sees the same sample records, even before its editor is visited.
  const result:Collections=structuredClone({ tests: sampleTests, assets: sampleAssets, observations: sampleObservations, gardens: initialGardens, usage: initialUsage });
  for(const key of ['assets','observations','gardens','usage'])result[key]=result[key].map(record=>({...record,homeContextId:'sample-current-home'}));
  return result;
}

/** Scope remount happens before paint, so a new account never sees the previous account's drafts. */
export function HomeWorkspaceProvider({ children, service }: { children: ReactNode; service?: HomeWorkspaceService }) {
  return <HomeWorkspaceSession key={service?.scopeKey ?? 'isolated-preview'} service={service}>{children}</HomeWorkspaceSession>;
}

function HomeWorkspaceSession({ children, service }: { children: ReactNode; service?: HomeWorkspaceService }) {
  const [collections, setCollections] = useState<Collections>(() => service ? {} : initialCollections());
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [scenario, changeScenario] = useState<HomeScenario>('ready');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [collectionStates, setCollectionStates] = useState<Record<string, CollectionState>>({});
  const [unknownOperations, setUnknownOperations] = useState<{ operationId: string; message: string }[]>([]);
  const recordsRef = useRef(collections);
  const statesRef = useRef(collectionStates);
  const unknownRef = useRef(new Map<string, HomeWorkspaceCommand | { kind: 'recovered'; operationId: string; domain: 'workspace' | 'attachments' }>());
  const resolvedOperations = useRef(new Set<string>());
  const loadVersions = useRef(new Map<string, number>());
  const requests = useRef(new Set<AbortController>());
  const scenarioRef = useRef(scenario);
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    generation.current++; alive.current = true;
    if (service) for (const key of sharedCollectionKeys) void loadCollection(key, statesRef.current[key]?.status === 'loading');
    const activeRequests = requests.current;
    return () => { alive.current = false; for (const request of activeRequests) request.abort(); };
    // Identity/context is an immutable service scope and remounts this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  function collectionState(key: string, next: CollectionState) {
    statesRef.current = { ...statesRef.current, [key]: next }; setCollectionStates(statesRef.current);
  }
  function applyCanonical(change: { drafts?: Record<string, unknown>; collections?: Collections }) {
    if (change.collections) {
      if (!validHomeChanges(change.collections) || service && !Object.entries(change.collections).every(([key, rows]) => validProductionCollection(key, rows))) throw new Error('Invalid canonical workspace response.');
      for (const key of Object.keys(change.collections)) {
        loadVersions.current.set(key, (loadVersions.current.get(key) ?? 0) + 1);
        collectionState(key, { ...statesRef.current[key], status: 'ready', complete: true });
      }
      commit({ ...recordsRef.current, ...change.collections });
    }
    if (change.drafts) setDrafts(previous => ({ ...previous, ...change.drafts }));
  }
  async function loadCollection(key: string, force = false, background = false) {
    if (!service || !alive.current || (!force && statesRef.current[key])) return;
    const version = (loadVersions.current.get(key) ?? 0) + 1; loadVersions.current.set(key, version);
    const request = new AbortController(); requests.current.add(request);
    // A background refresh keeps the records usable while the latest copy is fetched.
    if (!background) collectionState(key, { ...statesRef.current[key], status: 'loading', complete: false });
    try {
      const snapshot: HomeCollectionSnapshot = await service.load(key, request.signal);
      if (!alive.current || request.signal.aborted || loadVersions.current.get(key) !== version) return;
      if (!validHomeRecords(snapshot.records) || !validProductionCollection(key, snapshot.records)) throw new Error('The records could not be read. Try again.');
      if (!Array.isArray(snapshot.pendingOperations) || !snapshot.pendingOperations.every(item => item && typeof item.operationId === 'string' && item.operationId && ['workspace', 'attachments'].includes(item.domain))) throw new Error('Pending changes could not be checked. Refresh before editing.');
      for (const item of snapshot.pendingOperations) if (!resolvedOperations.current.has(item.operationId) && !unknownRef.current.has(item.operationId)) unknownRef.current.set(item.operationId, { kind: 'recovered', operationId: item.operationId, domain: item.domain });
      if (unknownRef.current.size) { setUnknownOperations([...unknownRef.current.keys()].map(operationId => ({ operationId, message: 'An earlier change needs a status check.' }))); setMessage('Check earlier changes before making another change.'); }
      if (snapshot.availability === 'unavailable') throw new Error(snapshot.message || 'This collection is unavailable. Your saved records are unchanged.');
      commit({ ...recordsRef.current, [key]: snapshot.records });
      collectionState(key, { status: 'ready', revision: snapshot.revision, complete: snapshot.complete !== false && !snapshot.nextCursor && snapshot.availability !== 'partial', message: snapshot.message });
    } catch (error) {
      if (alive.current && !request.signal.aborted && loadVersions.current.get(key) === version) collectionState(key, { ...statesRef.current[key], status: 'error', complete: false, featureUnavailable: (error as { reason?: unknown } | null)?.reason === 'feature_unavailable', message: error instanceof Error ? error.message.replaceAll('\u2014', ',') : 'This collection could not load. Try again.' });
    } finally { requests.current.delete(request); }
  }
  async function retry(key?: string) {
    if (!service) { setScenario('ready'); return; }
    await Promise.all((key ? [key] : Object.keys(statesRef.current)).map(name => loadCollection(name, true)));
  }
  function seed(key: string, initial: HomeRecord[]) {
    if (service) { void loadCollection(key); return; }
    if (Object.hasOwn(recordsRef.current, key)) return;
    commit({ ...recordsRef.current, [key]: scenarioRef.current === 'empty' ? [] : initial });
  }
  function setScenario(next: HomeScenario) {
    if (service) { if (next === 'ready') void retry(); return; }
    generation.current++; scenarioRef.current = next; changeScenario(next); setMessage('');
    if (next === 'empty') commit(Object.fromEntries(Object.keys(recordsRef.current).map(key => [key, []])));
  }
  function unresolved(command: HomeWorkspaceCommand | { kind: 'recovered'; operationId: string; domain: 'workspace' | 'attachments' }, message: string, announce = true) {
    unknownRef.current.set(command.operationId, command);
    setUnknownOperations([...unknownRef.current.keys()].map(operationId => ({ operationId, message })));
    if (announce) setMessage(message);
  }
  function applyReceipt(command: HomeWorkspaceCommand | { kind: 'recovered'; operationId: string; domain: 'workspace' | 'attachments' }, receipt: HomeWorkspaceReceipt): boolean {
    if (receipt.operationId !== command.operationId || !['succeeded', 'failed', 'pending', 'unknown'].includes(receipt.status)) {
      unresolved(command, 'The save result could not be verified. Check its status before trying another change.'); return false;
    }
    if (receipt.status === 'pending' || receipt.status === 'unknown') {
      unresolved(command, receipt.message || 'The save is not yet confirmed. Check its status before trying another change.'); return false;
    }
    if (receipt.status === 'succeeded' && !(command.kind === 'recovered' ? acceptedHomeReceipt(receipt, command.operationId) : homeReceiptCoversCommand(command, receipt))) {
      unresolved(command, 'The saved response could not be read. Check its status before trying another change.'); return false;
    }
    if (receipt.status === 'succeeded') applyCanonical({ collections: receipt.changes });
    resolvedOperations.current.add(command.operationId);
    unknownRef.current.delete(command.operationId);
    setUnknownOperations(previous => previous.filter(item => item.operationId !== command.operationId));
    if (receipt.status === 'failed') {
      setMessage(receipt.message || 'The change was not saved. Your draft is kept.');
      // A refused revision means this copy is stale. Fetch the latest so it can actually be reviewed;
      // drafts live separately and are kept.
      if (receipt.code === 'conflict' && command.kind !== 'recovered') for (const key of command.kind === 'write' || command.kind === 'remove' ? [command.collection] : command.kind === 'remove-notes' ? ['exploreNotes', 'exploreOutcomes'] : []) void loadCollection(key, true, true);
      return false;
    }
    for (const [key, revision] of Object.entries(receipt.revisions ?? {})) collectionState(key, { ...statesRef.current[key], status: 'ready', complete: true, revision });
    if (command.kind === 'clear-private') {
      if (command.scope === 'all') commit(Object.fromEntries(Object.keys(recordsRef.current).map(key => [key, []])));
      setDrafts(previous => command.scope === 'all' ? {} : Object.fromEntries(Object.entries(previous).filter(([key]) => !/^week:(journal|season|pattern)/.test(key))));
    }
    setMessage('Saved.'); return true;
  }
  async function execute(command: HomeWorkspaceCommand): Promise<boolean> {
    if (!service || pending || locks.current.size) return false;
    if (unknownRef.current.size) { setMessage('Check the pending save status before making another change. Your draft is kept.'); return false; }
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setMessage('Offline: your draft remains here. Nothing has been saved or queued.'); return false; }
    const request = new AbortController(); requests.current.add(request); locks.current.add(command.operationId); setPending(true); setMessage('Saving...');
    try {
      const receipt = await service.execute(command, request.signal);
      return alive.current && !request.signal.aborted ? applyReceipt(command, receipt) : false;
    } catch {
      if (alive.current) unresolved(command, 'The connection ended before the result was confirmed. Check save status before retrying.');
      return false;
    } finally { requests.current.delete(request); locks.current.delete(command.operationId); if (alive.current) setPending(locks.current.size > 0); }
  }
  async function reconcile(operationId: string): Promise<boolean> {
    const command = unknownRef.current.get(operationId);
    if (!service || !command || locks.current.size) return false;
    const request = new AbortController(); requests.current.add(request); locks.current.add(operationId); setPending(true);
    try { const receipt = await service.reconcile(operationId, request.signal, command.kind === 'recovered' ? command.domain : 'workspace'); const accepted = alive.current && !request.signal.aborted ? applyReceipt(command, receipt) : false; if (accepted && command.kind === 'recovered') await retry(); return accepted; }
    catch { if (alive.current) setMessage('Save status is still unavailable. Your draft remains here. Do not repeat the change.'); return false; }
    finally { requests.current.delete(request); locks.current.delete(operationId); if (alive.current) setPending(false); }
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
  async function write(key: string, record: HomeRecord, checkCurrent?:()=>boolean) {
    if (service) {
      if (checkCurrent && !checkCurrent()) { setMessage('The reviewed information changed. Reopen the review. Your draft is kept.'); return false; }
      // A switched-off capability is a settled answer: no reload loop, and nothing is sent.
      if (collectionView(statesRef.current[key]) === 'off') { setMessage(homeSaveOffMessage); return false; }
      if (statesRef.current[key]?.status !== 'ready') { setMessage('Load the current records before saving. Your draft is kept.'); void loadCollection(key); return false; }
      const current = recordsRef.current[key]?.find(item => item.id === record.id);
      if (current && current.revision !== record.revision) { setMessage('This record changed. Your draft is kept. Review the latest version before saving.'); return false; }
      const homeOwned = ['assets','observations','gardens','usage','pantryItems'].includes(key);
      const scoped = !current && homeOwned && !record.homeContextId ? { ...record, homeContextId: service.context?.currentHomeId ?? undefined } : record;
      if (homeOwned && !scoped.homeContextId) { setMessage('Choose a home before saving this record. Your draft is kept.'); return false; }
      return execute({ kind: 'write', collection: key, record: scoped, expectedRevision: current?.revision ?? null, collectionRevision: statesRef.current[key]?.revision, operationId: crypto.randomUUID() });
    }
    return mutate(key, record.id, () => {
      if(checkCurrent&&!checkCurrent()){setMessage('The reviewed information changed. Nothing was saved. Reopen the review.');return false;}
      const records = recordsRef.current[key] ?? [];
      const existing = records.find(item => item.id === record.id);
      if (existing && existing.revision !== record.revision) { setMessage('This record changed since you opened it. Your draft is retained; review the latest version before saving.'); return false; }
      const homeContextId=['assets','observations','gardens','usage','pantryItems'].includes(key)?existing?.homeContextId??record.homeContextId??recordsRef.current.homeTransitions?.at(-1)?.id??'sample-current-home':undefined;
      const next = { ...record, ...(homeContextId?{homeContextId}:{}), revision: (existing?.revision ?? 0) + 1 };
      commit({ ...recordsRef.current, [key]: existing ? records.map(item => item.id === next.id ? next : item) : [...records, next] });
      return true;
    });
  }
  async function remove(key: string, id: string, expectedRevision?: number) {
    if (service) {
      const current = recordsRef.current[key]?.find(item => item.id === id);
      if (!current) { setMessage('This record is no longer available. Refresh the list before making another change.'); return false; }
      if (expectedRevision === undefined || current.revision !== expectedRevision) { setMessage('This record changed. Reopen its deletion review before continuing.'); return false; }
      return execute({ kind: 'remove', collection: key, recordId: id, expectedRevision: current.revision, collectionRevision: statesRef.current[key]?.revision, operationId: crypto.randomUUID() });
    }
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
    if (service) {
      const current = recordsRef.current.exploreNotes ?? [];
      if (!selection.length || new Set(selection.map(item => item.id)).size !== selection.length || !selection.every(item => current.some(record => record.id === item.id && record.revision === item.revision))) { setMessage('The selected notes changed. Nothing was removed. Review the selection again.'); return false; }
      return execute({ kind: 'remove-notes', selection, operationId: crypto.randomUUID() });
    }
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
    if (service) {
      // The review callback also mutates the separate action store. Only an atomic
      // acknowledged privacy service may coordinate production cross-store erasure.
      if (checkOther) { setMessage('Use the account privacy review to clear connected records together. Nothing was deleted.'); return false; }
      if (recordFingerprint(recordsRef.current, scope) !== expected) { setMessage('Records changed. Nothing was deleted. Reopen the review.'); return false; }
      return execute({ kind: 'clear-private', scope, expectedFingerprint: expected, operationId: crypto.randomUUID() });
    }
    return mutate('privacy',scope,()=>{
      if(recordFingerprint(recordsRef.current,scope)!==expected||checkOther&&!checkOther()){setMessage('Records changed. Nothing was deleted. Reopen the review.');return false;}
      commit(Object.fromEntries(Object.entries(recordsRef.current).map(([key,rows])=>[key,scope==='all'||key==='weekJournal'?[]:rows])));
      setDrafts(previous=>scope==='all'?{}:Object.fromEntries(Object.entries(previous).filter(([key])=>!/^week:(journal|season|pattern)/.test(key))));
      // Prevent a not-yet-mounted collection from restoring its fixture after erasure.
      if(scope==='all'){scenarioRef.current='empty';changeScenario('empty');}
      return true;
    });
  }
  return <Context.Provider value={{ mode: service ? 'production' : 'preview', service, collectionStates, unknownOperations, retry, reconcile, applyCanonical, getRecord: (key, id) => recordsRef.current[key]?.find(item => item.id === id),
    // An upload in flight blocks other changes, but is not yet a failure: its own form reports the
    // outcome, so tracking it must not raise a workspace-wide "needs a status check" alert.
    trackPendingOperation: (operationId, domain) => unresolved({ kind: 'recovered', operationId, domain }, 'A private file request needs a status check before another change.', false),
    resolvePendingOperation: operationId => { resolvedOperations.current.add(operationId); unknownRef.current.delete(operationId); setUnknownOperations(previous => previous.filter(item => item.operationId !== operationId)); },
    collections, drafts, scenario, message, pending, setScenario, clearMessage: () => { if (!unknownRef.current.size) setMessage(''); }, seed, write, remove, removeNotes,clearPrivate,
    setDraft: (key, update) => setDrafts(previous => ({ ...previous, [key]: update(previous[key]) })),
    clearDraft: (key, ...expected) => setDrafts(previous => clearHomeDraft(previous, key, ...expected)),
    reset: () => { if (service) { void retry(); return; } generation.current++; commit(initialCollections()); setDrafts({}); setScenario('ready'); setMessage('Workspace reset.'); },
  }}>{children}</Context.Provider>;
}

export function useHomeWorkspace() {
  const state = useContext(Context);
  if (!state) throw new Error('The Homeguard workspace provider is required.');
  return state;
}
export function useHomeCollection<T extends HomeRecord>(key: string, initial: T[]) {
  const state = useHomeWorkspace();
  useEffect(() => { state.seed(key, initial); }, [key, initial, state]);
  const records = (state.collections[key] ?? (state.mode === 'production' || state.scenario === 'empty' ? [] : initial)) as T[];
  return { records, save: (record: T) => state.write(key, record), remove: (id: string, expectedRevision?: number) => state.remove(key, id, expectedRevision ?? records.find(item => item.id === id)?.revision), status: state.collectionStates[key], retry: () => state.retry(key) };
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
  if (state.mode === 'production') return null;
  return <div className="halo-f-tool-grid"><label>Homeguard workspace state<select value={state.scenario} onChange={e => state.setScenario(e.target.value as HomeScenario)}>{(['ready', 'empty', 'loading', 'error', 'offline', 'stale', 'conflict', 'save-error'] as const).map(value => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select></label><label>Simulate summary section failure<select value={summaryFailure} onChange={e => setSummaryFailure(e.target.value)}><option value="">All selected sections available</option>{Object.entries({ tests: 'Test reports', actions: 'Saved actions', maintenance: 'Maintenance records', observations: 'Moisture observations', gardens: 'Garden records' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" onClick={state.reset}>Reset Homeguard sample records</button></div>;
}
