'use client';
import DateInput from '@/components/ui/DateInput';

import { createContext, useCallback,useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BottomSheet, Callout } from '@/components/ui/Foundation';
import Button from '@/components/ui/Button';
import { actionDraftError, type ActionRevision, type ActionSeed, type PreviewAction } from '@/lib/frontend/expanded-preview';
import type { HouseholdBands } from '@/lib/frontend/home-household';
import { HomeWorkspaceReviewControls, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { ExploreReviewControls } from './ExploreWorkspace';
import { WeekReviewControls } from './MyWeekWorkspace';
import {CompletionReviewControls} from './AccountWorkflows';
import {WeekEvidenceReviewControls} from './WeekEvidence';
import SourceOperationsReview from './SourceOperationsReview';
import {actionFingerprint} from '@/lib/frontend/settings-preview';
import { actionReceiptCoversCommand,applyReviewActionCommand, validActionSnapshot, type ActionCommand, type ActionCommitOptions, type ActionSnapshot, type ExpandedActionAdapter } from '@/lib/frontend/production/action-service';
import { dayLabel, emptyWeekMeta, type WeekMeta } from '@/lib/frontend/week-preview';
import { lunaCalendarAnchor } from '@/lib/frontend/luna-tools-preview';
import { saveNotRecorded } from '@/lib/frontend/production/runtime';
import { unresolvedWeekSources, weekSourceRefreshPlan, weekSourceStatus, type WeekSourceChecks } from '@/lib/frontend/week-activity';

/** Collections whose records give My Week tasks their context, re-read when the page regains focus. */
const weekLinkedCollections = ['exploreProjects', 'exploreEngagements', 'exploreNotes', 'exploreOutcomes', 'tests', 'assets', 'observations', 'gardens'];
const focusRefreshInterval = 30000;

type Draft = { seed: ActionSeed; title: string; date: string; revision?: number; id?: string };
type PreviewState = {
  actions: PreviewAction[]; draft: Draft | null; visible: boolean; fail: boolean;
  householdDraft: HouseholdBands | null; setHouseholdDraft: (draft: HouseholdBands | null) => void;
  open: (seed: ActionSeed) => void; close: () => void; setDraft: (draft: Draft) => void;
  setFail: (fail: boolean) => void; save: () => Promise<boolean>;
  pending: boolean; error: string; readiness: 'loading' | 'ready' | 'error'; production: boolean; unknownOperation: string; retryLoad: () => void; reconcile: () => Promise<boolean>;
  changeState: (id: string, state: PreviewAction['state']) => Promise<boolean>; reset: () => void;
  addActions: (seeds: ActionSeed[], date: string, options?: ActionCommitOptions) => Promise<boolean>;
  updateAction: (id: string, revision: number, patch: Pick<PreviewAction, 'title' | 'date'>, options?: ActionCommitOptions) => Promise<boolean>;
  reviseAction: (id: string, revision: number, patch: Pick<PreviewAction, 'title' | 'date' | 'state'>, options?: ActionCommitOptions) => Promise<boolean>;
  reviseActions: (changes:ActionRevision[], options?: ActionCommitOptions)=>Promise<boolean>;
  deleteAction: (id: string, revision: number) => Promise<boolean>;
  eraseActions: (expected:string) => boolean;
  getSnapshot: () => ActionSnapshot;
  /** Tasks whose origin record is still being re-read, or whose re-read failed. */
  sourceChecks: WeekSourceChecks;
};
const State = createContext<PreviewState | null>(null);
const Mode = createContext(false);
export const ExpandedMode = Mode.Provider;
export const useExpandedMode = () => useContext(Mode);
export const useExpandedPreview = () => useContext(State);

/** Shared action presentation. Only an explicitly injected service can persist. */
export function ExpandedPreviewProvider({ children, service }: { children: ReactNode; service?: ExpandedActionAdapter }) {
  const workspace = useHomeWorkspace();
  const workspaceRef = useRef(workspace);useEffect(()=>{workspaceRef.current=workspace;},[workspace]);
  const [actions, setActions] = useState<PreviewAction[]>([]);
  const actionsRef = useRef<PreviewAction[]>([]);
  const snapshotRef = useRef<ActionSnapshot>({actions:[],metas:{}});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [visible, setVisible] = useState(false);
  const [fail, setFail] = useState(false);
  const [householdDraft, setHouseholdDraft] = useState<HouseholdBands | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [readiness, setReadiness] = useState<'loading'|'ready'|'error'>(service ? 'loading' : 'ready');
  const [unknownOperation, setUnknownOperation] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const lock = useRef(false), alive = useRef(true), generation = useRef(0);
  /** The last save sent, kept so a status check that finds no record of it can send it again under the same id. */
  const unsent = useRef<{ operationId: string; command: ActionCommand; snapshot: ActionSnapshot } | null>(null);
  const requests = useRef(new Set<AbortController>());
  const commitSnapshot = useCallback((snapshot: ActionSnapshot) => {
    snapshotRef.current = snapshot;
    actionsRef.current = snapshot.actions; setActions(snapshot.actions);
    if(service){setUnknownOperation(snapshot.unresolvedOperations?.[0]??'');if(snapshot.unresolvedOperations?.length)setError('An earlier save needs checking before changing tasks.');}
    const drafts = { ...workspaceRef.current.drafts, 'week:metas': snapshot.metas, ...snapshot.preferences };
    // A second awaited command can begin before React renders the first receipt.
    workspaceRef.current = { ...workspaceRef.current, drafts };
    workspaceRef.current.applyCanonical({ drafts: { 'week:metas': snapshot.metas, ...snapshot.preferences } });
  },[service]);
  useEffect(() => {
    alive.current = true; const version = ++generation.current; const controller = new AbortController();const activeRequests=requests.current; activeRequests.add(controller);
    if (service) {
      queueMicrotask(() => { if (alive.current && version === generation.current) { setReadiness('loading'); setError(''); } });
      service.load(controller.signal).then(snapshot => {
        if (!alive.current || controller.signal.aborted || version !== generation.current) return;
        if (!validActionSnapshot(snapshot)) throw new Error('invalid');
        commitSnapshot(snapshot); setReadiness('ready');
      }).catch(() => { if (alive.current && !controller.signal.aborted && version === generation.current) { setReadiness('error'); setError('Your tasks could not load. Reconnect and try again.'); } }).finally(() => requests.current.delete(controller));
    }
    return () => { alive.current = false; controller.abort(); activeRequests.forEach(request => request.abort()); activeRequests.clear(); };
  }, [service, loadVersion,commitSnapshot]);
  // Every command start invalidates a background task read begun before it.
  const commands = useRef(0);
  const settled = useRef(false);
  useEffect(() => { settled.current = readiness === 'ready' && !unknownOperation; }, [readiness, unknownOperation]);
  // A task saved in another tab can arrive before this page has re-read the record it came from.
  // Re-read that collection quietly; the task says it is being checked until a real read answers.
  const production = workspace.mode === 'production';
  const sourceGaps = useMemo(() => production ? unresolvedWeekSources(actions, workspace.collections) : [], [production, actions, workspace.collections]);
  const [sourceResults, setSourceResults] = useState<Record<string, 'checked' | 'failed'>>({});
  const sourceReads = useRef(new Set<string>());
  useEffect(() => {
    const plan = weekSourceRefreshPlan(sourceGaps, sourceResults, sourceReads.current, collection => workspace.collectionStates[collection]?.status === 'loading');
    if (!plan.keys.length) return;
    for (const key of plan.keys) sourceReads.current.add(key);
    void workspaceRef.current.refresh(plan.collections).then(read => {
      for (const key of plan.keys) sourceReads.current.delete(key);
      setSourceResults(previous => ({ ...previous, ...Object.fromEntries(plan.keys.map(key => [key, read ? 'checked' : 'failed'] as const)) }));
    });
  }, [sourceGaps, sourceResults, workspace.collectionStates]);
  const sourceChecks = useMemo(() => weekSourceStatus(sourceGaps, sourceResults), [sourceGaps, sourceResults]);
  // Returning to the page re-reads tasks and their linked records in the background. A save in
  // progress, an unconfirmed save or an open editor's draft is never replaced by this read.
  useEffect(() => {
    if (!service) return;
    let last = Date.now();
    const controller = new AbortController();
    const reread = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < focusRefreshInterval || !settled.current || lock.current) return;
      last = Date.now();
      const version = generation.current, started = commands.current;
      service.load(controller.signal).then(snapshot => {
        if (controller.signal.aborted || version !== generation.current || started !== commands.current || lock.current || !settled.current || !validActionSnapshot(snapshot)) return;
        commitSnapshot(snapshot);
      }).catch(() => { /* The tasks already shown stay; the next return to the page tries again. */ });
      const states = workspaceRef.current.collectionStates;
      void workspaceRef.current.refresh(weekLinkedCollections.filter(key => states[key]?.status === 'ready'));
    };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => { controller.abort(); window.removeEventListener('focus', reread); document.removeEventListener('visibilitychange', reread); };
  }, [service, commitSnapshot]);
  const mutate = async (command: ActionCommand): Promise<boolean> => {
    if (lock.current || unknownOperation || service && readiness !== 'ready') return false;
    commands.current++;
    if (fail || ['offline','loading','error','save-error','conflict'].includes(workspaceRef.current.scenario) || typeof navigator !== 'undefined' && !navigator.onLine) { setError('Could not save. Your edits are kept. Reconnect or review the current record.'); return false; }
    lock.current = true; setPending(true); setError('');
    const operationId = crypto.randomUUID(), version = generation.current, controller = new AbortController(); requests.current.add(controller);
    try {
      const snapshot: ActionSnapshot = { actions: actionsRef.current, metas: (workspaceRef.current.drafts['week:metas'] ?? {}) as Record<string, WeekMeta> };
      if (service) {
        unsent.current = { operationId, command, snapshot };
        const receipt = await service.commit(command, { operationId, signal: controller.signal });
        if (!alive.current || version !== generation.current) return false;
        if (receipt.operationId !== operationId) throw new Error('invalid receipt');
        if (receipt.status === 'pending' || receipt.status === 'unknown') { setUnknownOperation(operationId); setError('The save outcome is not confirmed. Check its status before changing tasks again.'); return false; }
        if (receipt.status !== 'succeeded') { setError(receipt.message || 'Could not save. Your edits are kept.'); return false; }
        if (!validActionSnapshot(receipt.snapshot)||!actionReceiptCoversCommand(command,snapshot,receipt)) throw new Error('invalid snapshot');
        commitSnapshot(receipt.snapshot);
      } else {
        const next = applyReviewActionCommand(snapshot, command, () => crypto.randomUUID());
        if (!next) { setError('This task or schedule changed. Nothing was overwritten. Reopen its current details.'); return false; }
        commitSnapshot(next);
      }
      return true;
    } catch {
      if (service && alive.current) { setUnknownOperation(operationId); setError('The save outcome is not confirmed. Check its status before trying again.'); }
      return false;
    } finally { requests.current.delete(controller); lock.current = false; if (alive.current) setPending(false); }
  };
  const reconcile = async () => {
    if (!service || !unknownOperation || lock.current) return false;
    commands.current++; lock.current = true; setPending(true); const controller = new AbortController(); requests.current.add(controller);
    const sent = unsent.current?.operationId === unknownOperation ? unsent.current : null;
    try {
      let receipt, resent = false;
      try { receipt = await service.reconcile(unknownOperation, controller.signal); }
      catch (error) {
        // Never recorded: send the same save again under the same id, which the server applies at most once.
        if (!sent || !saveNotRecorded(error)) throw error;
        if (typeof navigator !== 'undefined' && !navigator.onLine) { if (alive.current) setError('You are offline. The save was not recorded, and your draft is kept. Reconnect, then check again.'); return false; }
        receipt = await service.commit(sent.command, { operationId: sent.operationId, signal: controller.signal }); resent = true;
        if (receipt.status === 'succeeded' && !actionReceiptCoversCommand(sent.command, sent.snapshot, receipt)) throw new Error('invalid snapshot');
      }
      if (!alive.current || receipt.operationId !== unknownOperation) return false;
      if (receipt.status === 'succeeded' && validActionSnapshot(receipt.snapshot)) { unsent.current = null; commitSnapshot(receipt.snapshot); setError(receipt.snapshot.unresolvedOperations?.length?'Another earlier save needs checking.':resent?'Saved.':'Saved. The existing task result was recovered.'); return true; }
      if (receipt.status === 'failed' || receipt.status === 'cancelled') { unsent.current = null; setUnknownOperation('');setLoadVersion(value=>value+1);setError(resent && receipt.message || 'No save was applied. Your draft is kept for review.'); return false; }
      setError('The outcome is still unconfirmed. No new save was sent.'); return false;
    } catch { if (alive.current) setError('Could not check this save. No new save was sent.'); return false; }
    finally { requests.current.delete(controller); lock.current = false; if (alive.current) setPending(false); }
  };
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
    setDraft(previous => previous?.seed.key === seed.key ? previous : { seed: existing ?? seed, title: existing?.title ?? seed.title, date: existing?.date ?? seed.date ?? '', id: existing?.id, revision: existing?.revision });
    if (!window.history.state?.haloExpandedAction) window.history.pushState({ ...window.history.state, haloExpandedAction: true }, '', window.location.href);
    setVisible(true);
  };
  const reviseActions = (changes: ActionRevision[], options?: ActionCommitOptions) => mutate({ kind: 'revise', changes, ...options });
  const reviseAction = (id: string, revision: number, patch: Pick<PreviewAction, 'title'|'date'|'state'>, options?: ActionCommitOptions) => reviseActions([{ id, revision, patch }], options);
  const addActions = (seeds: ActionSeed[], date: string, options?: ActionCommitOptions) => mutate({ kind: 'add', seeds, date, ...options });
  const updateAction = async (id: string, revision: number, patch: Pick<PreviewAction, 'title'|'date'>, options?: ActionCommitOptions) => { const current = actionsRef.current.find(action => action.id === id); return current ? reviseAction(id, revision, { ...patch, state: current.state }, options) : false; };
  const deleteAction = (id: string, revision: number) => mutate({ kind: 'delete', id, revision });
  const save = async () => {
    if (!draft || actionDraftError(draft.title, draft.date)) return false;
    const saved = draft.id ? await updateAction(draft.id, draft.revision ?? 1, { title: draft.title, date: draft.date }) : await addActions([{ ...draft.seed, title: draft.title }], draft.date);
    if (saved) close(); return saved;
  };
  const changeState = async (id: string, state: PreviewAction['state']) => {
    const current = actionsRef.current.find(action => action.id === id); if (!current) return false;
    const metas = (workspaceRef.current.drafts['week:metas'] ?? {}) as Record<string, WeekMeta>;
    const old = { ...emptyWeekMeta, ...metas[current.key] }; if (old.paused || old.archived) return false;
    const today = lunaCalendarAnchor(new Date(), String(workspaceRef.current.drafts['week:zone'] ?? old.zone));
    return reviseAction(id, current.revision ?? 1, { title: current.title, date: current.date, state }, { expectedMetadata: { [current.key]: JSON.stringify(metas[current.key] ?? null) }, metadata: { [current.key]: { ...old, completedOn: state === 'completed' ? today : '', history: [...old.history, `${dayLabel(today)}: ${state === 'completed' ? 'Completed' : state === 'waiting' ? 'Waiting' : 'Reopened'} by you.`] } } });
  };
  const eraseActions=(expected:string)=>{if(service||pending||unknownOperation||fail||actionFingerprint(actionsRef.current)!==expected)return false;actionsRef.current=[];setActions([]);setDraft(null);setVisible(false);setHouseholdDraft(null);return true;};
  return <State.Provider value={{ actions, draft, visible, fail, householdDraft, setHouseholdDraft, open, close, setDraft, setFail, save, pending, error, readiness, production: Boolean(service), unknownOperation, retryLoad: () => setLoadVersion(value => value + 1), reconcile, addActions, updateAction, reviseAction, reviseActions, deleteAction, eraseActions, changeState, getSnapshot:()=>snapshotRef.current, sourceChecks, reset: () => { if (service) return; close(); actionsRef.current = []; snapshotRef.current={actions:[],metas:{}}; setActions([]); setDraft(null); setFail(false); } }}>{children}</State.Provider>;
}

/** quietLoading: the screen already shows its own loading placeholder, so the loading line is announced but takes no space. */
/** onRecovered: a sheet whose save was unconfirmed closes once the check confirms that save. */
export function ExpandedActionStatus({ quietLoading = false, onRecovered }: { quietLoading?: boolean; onRecovered?: () => void } = {}) {
  const state = useExpandedPreview(); if (!state || !state.error && state.readiness !== 'loading') return null;
  return <div role="status" className={quietLoading && !state.error && state.readiness === 'loading' ? 'mw-notice halo-sr-only' : 'mw-notice'}><p>{state.readiness === 'loading' ? 'Loading your tasks...' : state.error}</p>{state.unknownOperation ? <button className="mw-text" disabled={state.pending} onClick={() => void state.reconcile().then(saved => { if (saved) onRecovered?.(); })}>Check save status</button> : state.readiness === 'error' ? <button className="mw-text" onClick={state.retryLoad}>Try again</button> : null}</div>;
}

export function ExpandedReviewControls() {
  const state = useExpandedPreview();
  if (!state) return null;
  return <><div className="halo-f-tool-grid"><label className="halo-f-tool-check"><input type="checkbox" checked={state.fail} onChange={e => state.setFail(e.target.checked)} />Simulate failed action save</label><button type="button" onClick={state.reset}>Reset sample actions</button><WeekReviewControls /><WeekEvidenceReviewControls /><CompletionReviewControls /></div><HomeWorkspaceReviewControls /><ExploreReviewControls /><SourceOperationsReview /></>;
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
  async function submit() {
    if (!state?.draft || pending) return;
    const invalid = actionDraftError(state.draft.title, state.draft.date);
    setError(invalid ?? '');
    if (invalid || offline) return;
    setPending(true);
    if (!state.production) await new Promise<void>(resolve => { timer.current = setTimeout(resolve, 400); });
    if (state.fail || !await state.save()) setError('Could not confirm this save. Your edits are kept. Review its status before retrying.');
    setPending(false);
  }
  return <BottomSheet id="expanded-action" title={exists ? 'Your saved action' : 'Save a practical step'} height="standard" onClose={() => { if (timer.current) clearTimeout(timer.current); setPending(false); setError(''); state.close(); }}>
    <form className="halo-expanded-form" onSubmit={e => { e.preventDefault(); submit(); }}>

      {exists && <Callout tone="info"><p>This step is already in My Week. Update the same action here.</p></Callout>}
      <label>Action title<input maxLength={160} required value={draft.title} disabled={pending} onChange={e => state.setDraft({ ...draft, title: e.target.value })} /></label>
      <p>{draft.seed.reason}</p>
      <label>All-day date (optional)<DateInput value={draft.date} disabled={pending} onChange={e => state.setDraft({ ...draft, date: e.target.value })} /></label>
      <p className="halo-f-meta">{draft.date ? `Planned for ${draft.date}. This is a calendar date, not a timed reminder.` : 'No date selected. This action will stay in Saved for later.'}</p>
      {offline && <Callout tone="notice"><p>Offline. Your draft is kept. Reconnect to save.</p></Callout>}
      {error && <p role="alert">{error}</p>}
      <ExpandedActionStatus />
      <Button type="submit" busy={pending} disabled={offline || Boolean(state.unknownOperation) || state.readiness !== 'ready'}>{exists ? 'Update action' : 'Save action'}</Button>
      <Button type="button" variant="tertiary" disabled={pending} onClick={() => { setError(''); state.close(); }}>Close and keep draft</Button>
    </form>
  </BottomSheet>;
}
