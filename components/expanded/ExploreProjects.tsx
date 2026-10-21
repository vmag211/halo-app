'use client';
import DateInput from '@/components/ui/DateInput';
import HaloLoading from '@/components/ui/HaloLoading';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Bug, Check, ChevronRight, Droplets, ExternalLink, HandHeart, ListOrdered, Pause, Play, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sprout, Sun, Wind } from 'lucide-react';
import { BottomSheet } from '@/components/ui/Foundation';
import { Confirm } from '@/components/homeguard/HomeWorkspaceUI';
import { useHomeCollection, useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { ExploreSection } from '@/lib/frontend/explore-preview';
import { findProjectGuide, projectActionKey, projectCompletionError, projectGuideCauses, projectStepIndex, type ProjectGuide } from '@/lib/frontend/explore-project-guides';
import { createProjectGeneration, getPreviewProjectContext, projectGenerationNotice, type ProjectConstraints, type ProjectGenerationState, type ProjectSuggestion } from '@/lib/frontend/explore-personalization';
import { noProjects, validDay, type ProjectRecord } from '@/lib/frontend/explore-workspace';
import type { ActionSeed } from '@/lib/frontend/expanded-preview';
import { useExpandedPreview } from './ExpandedPreviewState';
import { ExplorePhoto } from './ExploreVisuals';
import { SaveExplore } from './ExploreShared';
import ExploreOutcome from './ExploreOutcome';
import './explore-project-guides.css';
import { useProductionProjectGeneration } from './ProductionProjectGeneration';
import { useProductionResource, useProductionRuntime } from '@/components/production/ProductionContext';
import { validProjectGuide } from '@/lib/frontend/production/explore-service';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
import {validProductionRecord,validProductionCollection} from '@/lib/frontend/production/home-records';

type Go = (section?: ExploreSection, view?: string, id?: string) => void;
const guideIcons = { plant: Sprout, bee: Bug, cleanup: HandHeart, sun: Sun, water: Droplets, air: Wind };

export default function ExploreProjects({ go, view, id, href, environmentAvailable = true }: { go: Go; view: string; id: string; href: (tab: string, destination?: string) => string; environmentAvailable?: boolean }) {
  const workspace = useHomeWorkspace();
  const state = useExpandedPreview();
  const collection = useHomeCollection<ProjectRecord>('exploreProjects', noProjects);
  const [step, setStep] = useHomeDraft(`explore:project-step:${id}`, 0);
  const [selected, setSelected] = useHomeDraft<number[]>(`explore:project-selected:${id}`, []);
  const [schedule, setSchedule] = useHomeDraft(`explore:project-schedule:${id}`, '');
  const [notes, setNotes] = useHomeDraft<Record<string, string>>(`explore:project-notes:${id}`, {});
  const [outcome, setOutcome] = useHomeDraft(`explore:project-outcome:${id}`, '');
  const [query, setQuery] = useHomeDraft('explore:project-search', '');
  const [cause, setCause] = useHomeDraft('explore:project-cause', 'All projects');
  const [confirmBundle, setConfirmBundle] = useState(false);
  const [error, setError] = useState('');
  const [starting,setStarting]=useState(false);
  const [startAttempt,setStartAttempt]=useHomeDraft<{id:string;guideId:string;version:string}|null>('explore:project-start-operation',null);
  const [resultError, setResultError] = useState<{ id: string; message: string } | null>(null);
  const generation = useProjectGeneration(environmentAvailable);
  const runtime=useProductionRuntime();
  const guideRead=useProductionResource<unknown>('projects.guide',{id},Boolean(runtime&&id&&view==='detail'));
  const record = collection.records.find(item => item.id === id);
  const project = runtime&&record?validProjectGuide(record.guide)&&record.guide.id===record.guideId&&record.guide.version===record.guideVersion?record.guide:undefined:generation.findGuide(id) ?? (runtime&&validProjectGuide(guideRead.data)?guideRead.data:undefined);
  async function startProject(){
    if(!project||starting)return;
    if(!runtime){await collection.save({ id: project.id, title: project.title, revision: 0, status: 'Active', goal: project.purpose, stepNotes: {}, outcome: '', reviewDate: '', history: [{ status: 'Active', note: `I chose to start guide ${project.version}.` }] });return;}
    if(startAttempt&&(startAttempt.guideId!==project.id||startAttempt.version!==project.version)){setError('Check your previous project start before starting another.');return;}
    const attempt=startAttempt??{id:crypto.randomUUID(),guideId:project.id,version:project.version};setStartAttempt(attempt);setStarting(true);setError('');
    try{const result:unknown=await runtime.request('projects.start',{guideId:attempt.guideId,guideVersion:attempt.version},{idempotencyKey:attempt.id});if(!result||typeof result!=='object'||!('record' in result)||!('collection' in result))throw new Error('invalid project receipt');const row=result.record;if(!validProductionRecord('exploreProjects',row)||!validProductionCollection('exploreProjects',result.collection)||!('guide' in row)||!validProjectGuide(row.guide)||row.guide.id!==attempt.guideId||row.guide.version!==attempt.version||!result.collection.some(item=>item.id===row.id&&item.revision===row.revision))throw new Error('invalid project receipt');workspace.applyCanonical({collections:{exploreProjects:result.collection}});setStartAttempt(null);go('projects','detail',row.id);}
    catch(error){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setStartAttempt(null);setError(serviceMessage(error));}finally{setStarting(false);}
  }

  if (view !== 'detail') {
    const terms = query.toLocaleLowerCase('en').trim().split(/\s+/).filter(Boolean);
    const available = generation.batch.items.filter(item => { const guide = generation.findGuide(item.id); return guide && (cause === 'All projects' || guide.cause === cause) && terms.every(term => `${item.title} ${guide.description} ${guide.materials.join(' ')}`.toLocaleLowerCase('en').includes(term)); });
    return <section className="ex-detail ex-guide-library ex-generated-library">
      <div className="ex-generated-title"><div><h3>Projects for you</h3><p>{generation.batch.items.length ? `${generation.batch.items.length} practical ideas. Choose one and work through it.` : 'Your interests, your space, a practical next step.'}</p></div></div>
      <ProjectInterestInput generation={generation} />
      {collection.records.length > 0 && <details className="ex-project-continuation"><summary>My projects ({collection.records.length})</summary>{collection.records.map(item => <button className="ex-text-button" key={item.id} onClick={() => go('projects', 'detail', item.id)}>{item.title} · {item.status}<ArrowRight size={16} aria-hidden="true" /></button>)}</details>}
      {generation.batch.items.length > 0 && <div className="ex-generated-controls"><div className="ex-guide-find"><label><Search size={17} aria-hidden="true" /><span className="ex-sr">Find a project</span><input type="search" value={query} placeholder="Find an idea in this set" onChange={event => setQuery(event.target.value)} /></label><label>Focus<select value={cause} onChange={event => setCause(event.target.value)}>{projectGuideCauses.map(item => <option key={item}>{item}</option>)}</select></label></div><button className="ex-text-button" disabled={generation.busy} onClick={() => generation.regenerate()}><RefreshCw size={16} aria-hidden="true" />Refresh ideas</button></div>}
      <ProjectGenerationStatus generation={generation} />
      <div className="ex-generated-list" role="group" aria-label="Generated project ideas" aria-busy={generation.busy}>{available.map(item => <SuggestedProject key={item.id} item={item} guide={generation.findGuide(item.id)!} go={go} />)}</div>
      {!available.length && !generation.busy && Boolean(generation.batch.generation) && <div className="ex-empty"><h4>No projects match these choices</h4><p>Broaden your search or adjust your preferences.</p><button className="ex-text-button" onClick={() => { setQuery(''); setCause('All projects'); }}>Clear project filters</button></div>}
      <GenerationDetails generation={generation} />
      {generation.fitOpen && <ProjectFitSheet generation={generation} />}
    </section>;
  }
  if (!project) return <div className="ex-empty" role="status"><h3>{guideRead.loading?'Loading project instructions':'This project is unavailable'}</h3><p>Your other project workspaces remain available.</p>{runtime&&<button className="ex-text-button" disabled={guideRead.loading} onClick={guideRead.retry}>Try again</button>}<button className="ex-button" onClick={() => go('projects')}>All projects</button></div>;

  const current = projectStepIndex(step, project.steps.length);
  const currentStep = project.steps[current];
  const keyFor = (index: number) => runtime ? `explore:project:${id}:step:${(project.steps[index] as {id?:string}|undefined)?.id??''}` : projectActionKey(project.id, index)!;
  const stepNoteKey=runtime&&validProjectGuide(project)?project.steps[current].id:String(current);
  const validSelected = selected.filter(index => index>=0&&index<project.steps.length&&Number.isInteger(index));
  const action = state?.actions.find(item => item.key === keyFor(current));
  const completed = project.steps.filter((_, index) => state?.actions.some(item => item.key === keyFor(index) && item.state === 'completed')).length;
  const disabled = workspace.pending || starting || workspace.scenario === 'offline'||Boolean(state?.pending||state?.unknownOperation||state?.readiness!=='ready');
  const paused = record?.status === 'Paused';
  const currentOutcome = Object.hasOwn(workspace.drafts, `explore:project-outcome:${id}`) ? outcome : record?.outcome ?? '';
  const needsReview = record?.status === 'Completed' && completed !== project.steps.length;
  const Icon = guideIcons[project.icon];
  const seeds: ActionSeed[] = validSelected.map(index => ({ key: keyFor(index), title: project.steps[index].title, reason: `Chosen step ${index + 1} in ${project.title}. Guide ${project.version}. ${project.steps[index].checkpoint} Record actual work, not an estimated benefit.`, origin: 'Explore' }));

  function openStep(index: number) { setStep(index); setError(''); }
  function recordCompletion() {
    if (!record || !project) return;
    const invalid = projectCompletionError(completed, project.steps.length, currentOutcome);
    if (invalid) { setResultError({ id: project.id, message: invalid }); return; }
    setResultError(null);
    collection.save({ ...record, status: 'Completed', outcome: currentOutcome.trim(), history: [...record.history, { status: 'Completed', note: currentOutcome.trim() }] });
  }

  return <section className="ex-detail ex-project-workspace ex-guide-workspace" data-project-id={project.id} data-guide-version={project.version}>
    <button className="ex-text-button" onClick={() => go('projects')}><ArrowLeft size={16} aria-hidden="true" />All projects</button>
    <header className="ex-project-intro"><div className="ex-guide-cover"><div className="ex-guide-photo-frame"><ExplorePhoto scene={project.scene} className="ex-detail-photo" eager /></div><span className="ex-guide-cover-caption"><Icon size={18} aria-hidden="true" />{project.cause} · Context photo, not build instructions</span></div><div className="ex-project-intro-copy"><span className="ex-kicker">{project.effort} · {needsReview ? 'Completion needs review' : record?.status ?? 'Not started'}</span><h3>{project.title}</h3><p>{project.description}</p><div className="ex-project-guide-facts"><span>{project.steps.length} guided steps</span><span>{project.cost}</span></div></div></header>
    <details className="ex-guide-purpose"><summary>Purpose and fit</summary><p>{project.purpose}</p><p>{project.suitability}</p></details>
    {!record ? <button className="ex-button" disabled={disabled} onClick={()=>void startProject()}><Play size={17} aria-hidden="true" />{starting?'Starting project...':startAttempt?'Check project start':'Start my project workspace'}</button> : <div className="ex-project-progress"><div><strong>{completed} of {project.steps.length} saved steps completed by you</strong><small>Your recorded actions, not an environmental benefit total.</small></div><progress aria-label="Project action progress" value={completed} max={project.steps.length} /><button className="ex-text-button" disabled={disabled} onClick={() => collection.save({ ...record, status: paused ? 'Active' : 'Paused', history: [...record.history, { status: paused ? 'Active' : 'Paused', note: paused ? 'I resumed my project.' : 'I paused my project.' }] })}>{paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}{paused ? 'Resume project' : 'Pause project'}</button></div>}
    {paused && <p className="ex-notice">This project is paused. Your saved tasks and notes remain. Resume before changing step progress here.</p>}
    {error && <p role="alert" className="ex-notice">{error}</p>}
    <details className="ex-guide-preparation-detail"><summary><ShieldCheck size={18} aria-hidden="true" />Materials, permissions and safety</summary><div className="ex-guide-preparation"><section><h4>Gather these</h4><ul>{project.materials.map(item => <li key={item}>{item}</li>)}</ul><p className="ex-meta">{project.cost}</p></section><section><h4>Before you begin</h4><p>{project.suitability}</p><ul>{project.constraints.map(item => <li key={item}>{item}</li>)}</ul></section></div></details>
    <p className="ex-guide-safety-note"><ShieldCheck size={16} aria-hidden="true" /><span>{project.constraints[0]}</span></p>
    {project.buildPlan && <details className="ex-guide-build"><summary>{project.buildPlan.title}</summary><p>{project.buildPlan.note}</p><dl>{project.buildPlan.parts.map(part => <div key={part.name}><dt>{part.name} ({part.quantity})</dt><dd>{part.size}</dd></div>)}</dl><ol>{project.buildPlan.assembly.map(text => <li key={text}>{text}</li>)}</ol><a href={project.sources.find(item => item.id === project.buildPlan?.sourceId)?.url} target="_blank" rel="noreferrer">Open the measured source diagrams<ExternalLink size={13} aria-hidden="true" /></a></details>}

    <div className="ex-project-guide-desk"><nav className="ex-step-outline" aria-label="Project guide steps"><h4>Your guide</h4><ol>{project.steps.map((item, index) => <li key={item.title}><button aria-current={current === index ? 'step' : undefined} onClick={() => openStep(index)}><span>{state?.actions.some(action => action.key === keyFor(index) && action.state === 'completed') ? <Check size={15} aria-label="Completed by you" /> : index + 1}</span>{item.title}</button></li>)}</ol></nav><section className="ex-project-step ex-guide-current-step" aria-label="Current project step">
      <div className="ex-guide-step-heading"><Icon size={25} aria-hidden="true" /><span className="ex-kicker">Step {current + 1} of {project.steps.length}</span></div>
      <h4>{currentStep.title}</h4>
      <ol className="ex-guide-instructions">{currentStep.instructions.map(text => <li key={text}>{text}</li>)}</ol>
      <div className="ex-guide-checkpoint"><Check size={18} aria-hidden="true" /><div><strong>What to keep from this step</strong><p>{currentStep.checkpoint}</p></div></div>
      <div className="ex-guide-step-sources">{project.sources.filter(item => currentStep.sourceIds.includes(item.id)).map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">{item.publisher}: {item.title}<ExternalLink size={13} aria-hidden="true" /></a>)}</div>
      <div className="ex-step-controls"><button aria-label="Previous project step" disabled={current === 0} onClick={() => openStep(current - 1)}><ArrowLeft size={20} /></button><span>Work at your pace</span><button aria-label="Next project step" disabled={current === project.steps.length - 1} onClick={() => openStep(current + 1)}><ArrowRight size={20} /></button></div>
      <SaveExplore disabled={Boolean(runtime&&!record)} origin={keyFor(current).replace(/^explore:/,'')} title={currentStep.title} reason={`Chosen step ${current + 1} of ${project.title}. Guide ${project.version}. ${currentStep.checkpoint} Opening this guide does not complete the step.`} />
      {action && <><p className="ex-meta">{action.state === 'completed' ? 'Completed by you' : action.state === 'waiting' ? 'Waiting' : 'Saved for later'}</p><div className="ex-guide-progress-controls"><button className="ex-text-button" disabled={disabled || paused} onClick={async () => await state?.changeState(action.id, action.state === 'completed' ? 'saved' : 'completed')}>{action.state === 'completed' ? 'Reopen this step' : 'Mark this step completed'}</button><button className="ex-text-button" disabled={disabled || paused} onClick={async () => await state?.changeState(action.id, action.state === 'waiting' ? 'saved' : 'waiting')}>{action.state === 'waiting' ? 'Resume saved step' : 'Mark this step waiting'}</button></div></>}
      {record && <details className="ex-guide-step-note"><summary>Add a step note</summary><label>What I did or learned at this step<textarea maxLength={1000} value={notes[stepNoteKey] ?? record.stepNotes[stepNoteKey] ?? ''} onChange={event => setNotes({ ...notes, [stepNoteKey]: event.target.value })} /></label><button className="ex-text-button" disabled={disabled || paused} onClick={() => collection.save({ ...record, stepNotes: { ...record.stepNotes, [stepNoteKey]: notes[stepNoteKey] ?? record.stepNotes[stepNoteKey] ?? '' } })}>Save this step note</button></details>}
    </section></div>

    <details className="ex-guide-scan"><summary><ListOrdered size={19} aria-hidden="true" />Read the whole guide</summary><ol>{project.steps.map((item, index) => <li key={item.title}><h4>{item.title}</h4><ul>{item.instructions.map(text => <li key={text}>{text}</li>)}</ul><p className="ex-meta">Keep: {item.checkpoint}</p><button className="ex-text-button" onClick={() => { openStep(index); document.querySelector('.ex-guide-current-step')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }}>Work on step {index + 1}<ChevronRight size={15} aria-hidden="true" /></button></li>)}</ol><p>Reading or moving between steps never marks them complete.</p></details>
    <details className="ex-guide-plan-detail"><summary>Choose steps for My Week</summary><div className="ex-guide-plan-entry"><p>Save the project as one reminder, or choose its individual steps. Saving is not completion.</p><SaveExplore disabled={Boolean(runtime&&!record)} origin={`project:${runtime?id:project.id}`} title={project.title} reason={`${project.purpose} Guide ${project.version}. Individual step actions retain their separate IDs.`} /></div><section className="ex-project-plan"><h4>Put the right steps in My Week</h4><p>Choose the work you intend to do. Re-selecting an existing step keeps its title, schedule and completion state.</p><div className="ex-checklist">{project.steps.map((item, index) => <label className="ex-check" key={item.title}><input type="checkbox" checked={validSelected.includes(index)} onChange={event => setSelected(event.target.checked ? [...validSelected, index].sort((a, b) => a - b) : validSelected.filter(item => item !== index))} /><span><small>Step {index + 1}</small>{item.title}{state?.actions.some(item => item.key === keyFor(index) && item.state === 'completed') && <small><Check size={13} aria-hidden="true" /> Already completed by you</small>}</span></label>)}</div><label>Initial check-back date (optional)<DateInput value={schedule} onChange={event => setSchedule(event.target.value)} /></label><button className="ex-button" disabled={!validSelected.length || disabled || paused||Boolean(runtime&&!record)} onClick={() => { if (schedule && !validDay(schedule)) { setError('Choose a valid check-back date.'); return; } setError(''); setConfirmBundle(true); }}>Review selected steps for My Week</button>{error && <p role="alert">{error}</p>}</section></details>

    {record && <details className="ex-guide-result-detail"><summary>Record the result and follow-up</summary><section className="ex-project-reflection"><h4>Keep the result, then look ahead.</h4><p>{project.completion}</p><label>My project result<textarea maxLength={2000} value={currentOutcome} aria-invalid={resultError?.id === project.id || undefined} aria-describedby={resultError?.id === project.id ? 'ex-project-result-error' : undefined} onChange={event => { setOutcome(event.target.value); setResultError(null); }} /></label><button className="ex-button" disabled={disabled || paused || completed !== project.steps.length} onClick={recordCompletion}>Record project completion</button>{resultError?.id === project.id && <p id="ex-project-result-error" role="alert">{resultError.message}</p>}{completed !== project.steps.length && <p className="ex-meta">Save and explicitly complete each project step before recording whole-project completion.</p>}<p>{project.followup}</p><ExploreOutcome origin={`project-review:${runtime?id:project.id}`} title="Review what happens next" goal={project.followup} mechanism="A care check, organizer reply or another measured experiment keeps your practical work moving." /></section></details>}
    {record && <details className="ex-guide-history"><summary>My project history</summary><ol>{record.history.map((item, index) => <li key={index}><strong>{item.status}</strong><p>{item.note}</p></li>)}</ol></details>}
    <GuideSources project={project} />
    <details className="ex-guide-related"><summary>Related actions</summary><div className="ex-tools"><Link className="ex-text-button" href={project.cause === 'Air' ? href('today') : href('home', project.cause === 'Water' ? 'tests' : 'food')}>{project.cause === 'Air' ? 'Open air and outdoor readings' : project.cause === 'Water' ? 'Continue into tests and home records' : 'Open Food and Garden in Homeguard'}</Link><button onClick={() => go('outreach')}>Prepare a question for a qualified resource</button><button onClick={() => go('observations', 'new')}>Keep a project observation</button>{project.cause === 'Community' && <button onClick={() => go('opportunities')}>Find an organizer</button>}</div></details>
    {confirmBundle && <Confirm title="Add these steps to My Week?" confirmLabel="Add selected steps" cancelLabel="Keep planning" onCancel={() => setConfirmBundle(false)} onConfirm={async () => { if (disabled || paused || ['save-error', 'conflict'].includes(workspace.scenario) || !await state?.addActions(seeds, schedule)) { setError('Could not save the plan. Your choices are kept.'); setConfirmBundle(false); return; } setConfirmBundle(false); setError('Selected steps are in My Week. Existing actions were kept unchanged.'); }}><p>{validSelected.length} deliberately selected step{validSelected.length === 1 ? '' : 's'}. {schedule ? `Initial date: ${schedule}.` : 'No date: saved for later.'}</p><ul>{seeds.map(seed => <li key={seed.key}>{seed.title}</li>)}</ul><p>No step is marked completed and no external action is performed.</p></Confirm>}
  </section>;
}

function GuideSources({ project }: { project: ProjectGuide }) {
  return <details className="ex-guide-sources"><summary>Sources and guide limits</summary><p>{project.scope}</p><p>Guide {project.version}. Check site suitability and source instructions before physical work.</p><ul>{project.sources.map(item => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.publisher}: {item.title}<ExternalLink size={13} aria-hidden="true" /></a><small>{item.published ? `Source date: ${item.published}. ` : 'Source publication date not supplied. '}Checked: {item.checked}.</small></li>)}</ul><p>Saved plans are private.</p></details>;
}

function useProjectGeneration(environmentAvailable = true) {
  const production=useProductionProjectGeneration();
  const workspace = useHomeWorkspace();
  const context = production?.context ?? getPreviewProjectContext(workspace.collections, undefined, environmentAvailable);
  const [batch, setBatch] = useHomeDraft<ProjectGenerationState>('explore:generated-projects', production?.batch ?? createProjectGeneration(context));
  const [intent, , clearIntent] = useHomeDraft('explore:project-generation-intent', '');
  const [fitOpen, setFitOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [serviceState, setServiceState] = useHomeDraft('explore:generation-review-state', 'ready');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const contextRef = useRef(context); const batchRef = useRef(batch);
  const pending = useRef<{ constraints: ProjectConstraints; request: string; interpret: boolean; done?: () => void } | null>(null);
  useEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => { batchRef.current = batch; }, [batch]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!intent || production) return;
    if (intent !== batch.request) setBatch(previous => createProjectGeneration(context, previous.constraints, intent, previous.generation + 1));
    clearIntent();
  }, [intent, batch.request, context, setBatch, clearIntent,production]);
  function regenerate(constraints = batch.constraints, request = batch.request, interpret = false, done?: () => void) {
    if (timer.current) clearTimeout(timer.current);
    pending.current = { constraints, request, interpret, done };
    if (workspace.scenario === 'offline') { setMessage('Reconnect to generate new ideas. Your current set and input are kept.'); return; }
    setBusy(true); setMessage('');
    const expectedContext = context.key;
    timer.current = setTimeout(() => {
      timer.current = null; setBusy(false);
      if (serviceState === 'failed') { setMessage('Could not generate ideas. Your current set is kept.'); return; }
      if (contextRef.current.key !== expectedContext) { setMessage('Your HALO context changed. Try again with the current records; your existing ideas are kept.'); return; }
      if (JSON.stringify(batchRef.current) !== JSON.stringify(batch)) { setMessage('Another project request updated your ideas. That set was kept; retry if you still want this request.'); return; }
      try {
        const sameChoices = JSON.stringify(constraints) === JSON.stringify(batch.constraints) && request === batch.request;
        const next = createProjectGeneration({ ...contextRef.current, previousIdeaIds: sameChoices ? batch.items.map(item => item.id) : [], interestOnly: interpret }, constraints, request, batch.generation + 1, interpret);
        if (interpret && !next.items.length) { setMessage('No source-backed match. Try another interest or adjust preferences.'); return; }
        setBatch(next); pending.current = null; setMessage(`${next.items.length} idea${next.items.length === 1 ? '' : 's'} ready.`); done?.();
      } catch { setMessage('The ideas could not be prepared. Your current set and choices are kept.'); }
    }, serviceState === 'slow' ? 6000 : 1200);
  }
  function cancel() { if (timer.current) clearTimeout(timer.current); timer.current = null; setBusy(false); setMessage('Generation cancelled. Your current ideas and input are kept.'); }
  function retry() { const input = pending.current; if (input) regenerate(input.constraints, input.request, input.interpret, input.done); }
  // Keep the request and preferences, not stale reasons from a different home or
  // record revision. This changes unsaved suggestions, never owned project plans.
  const activeBatch = batch.contextKey !== context.key ? createProjectGeneration(context, batch.constraints, batch.request, batch.generation, false) : batch;
  return production ?? { production:false,off:false,pendingGeneration:false,canRetry:false, context, batch: activeBatch, fitOpen, setFitOpen, regenerate, busy, message, cancel, retry, serviceState, setServiceState,findGuide:findProjectGuide };
}
type Generation = ReturnType<typeof useProjectGeneration>;

/** Compact hub entrance shares the exact generation used by the full Projects page and Luna. */
export function PersonalizedProjectsPreview({ go, environmentAvailable = true }: { go: Go; environmentAvailable?: boolean }) {
  const generation = useProjectGeneration(environmentAvailable);
  const [lead] = generation.batch.items;
  return <section className="ex-personalized-preview" aria-label="Projects for you">
    <button className="ex-destination" onClick={() => go('projects')} aria-label={generation.batch.items.length ? `Projects for you: see all ${generation.batch.items.length}` : 'Projects for you: find ideas'}><ExplorePhoto scene={lead ? generation.findGuide(lead.id)?.scene ?? 'garden' : 'garden'} eager /><span className="ex-destination-copy"><span className="ex-destination-category">At your own pace</span><h3>Projects for you</h3><span className="ex-destination-description">{lead ? lead.title : 'Ideas shaped around your interests and home.'}</span><span className="ex-destination-location">{lead?.tags[0] || 'Choose your time, space and supplies'}</span><span className="ex-destination-action">{generation.batch.items.length ? `See all ${generation.batch.items.length}` : 'Find ideas'}<ArrowRight size={17} aria-hidden="true" /></span></span></button>
  </section>;
}

function SuggestedProject({ item, guide, go }: { item: ProjectSuggestion; guide:NonNullable<ReturnType<typeof findProjectGuide>>; go: Go }) {
  const Icon = guideIcons[guide.icon];
  return <article className="ex-generated-item ex-guide-entry" data-project-id={item.id} data-fit={item.fit}>
    <button className="ex-generated-open" onClick={() => go('projects', 'detail', item.id)}><ExplorePhoto scene={guide.scene} /><span><span className="ex-generated-topic"><Icon size={15} aria-hidden="true" />{guide.cause}</span><strong>{item.title}</strong><small>{item.tags.slice(0, 2).join(' · ')}</small></span><ArrowRight size={18} aria-hidden="true" /></button>
    <details className="ex-generated-reason"><summary>Why this idea?</summary><p>{item.reason}</p>{item.needsCheck.length > 0 && <ul>{item.needsCheck.map(check => <li key={check}>{check}</li>)}</ul>}<p className="ex-meta">{item.evidenceIds.length ? 'Uses the dated records in Generation details.' : 'General or interest-based choice. No condition at your home is inferred.'} Instructions use {guide.sources.map(source => source.publisher).filter((publisher, position, publishers) => publishers.indexOf(publisher) === position).join(', ')}.</p></details>
  </article>;
}

function ProjectInterestInput({ generation }: { generation: Generation }) {
  const [request, setRequest] = useHomeDraft('explore:project-direct-interest', '');
  return <form className="ex-project-interest" onSubmit={event => { event.preventDefault(); if (generation.off) return; if (request.trim()) generation.regenerate({ ...generation.batch.constraints, count: 3 }, request.trim().replace(/\u2014/g, ','), true); else generation.regenerate(); }}>
    <label>What interests you right now?<textarea rows={2} maxLength={500} value={request} onChange={event => setRequest(event.target.value)} placeholder="A solar experiment, native plants, or something to try with friends..." /></label>
    <div><button className="ex-button" type="submit" disabled={generation.busy||generation.off}>{request.trim() ? 'Generate a few ideas' : 'Generate project ideas'}<ArrowRight size={16} aria-hidden="true" /></button><button className="ex-text-button" type="button" disabled={generation.busy||generation.off} onClick={() => generation.setFitOpen(true)}><SlidersHorizontal size={17} aria-hidden="true" />Preferences</button></div>
  </form>;
}

function ProjectGenerationStatus({ generation }: { generation: Generation }) {
  if (generation.busy) return <div className="ex-project-generating">
    <HaloLoading label="Ideas taking shape" detail="Using your interests and available context" /><button className="ex-text-button" onClick={generation.cancel}>Cancel generation</button>
  </div>;
  return generation.message ? <div className="ex-generation-message" role={/failed|could not|changed|no source-backed/.test(generation.message) ? 'alert' : 'status'}><p>{generation.message}</p>{(generation.canRetry||/failed|could not|changed|cancelled|Reconnect/.test(generation.message)) && <button className="ex-text-button" onClick={generation.retry}>{generation.pendingGeneration?'Check existing generation':'Retry generation'}</button>}{generation.pendingGeneration&&<button className="ex-text-button" onClick={generation.cancel}>Cancel generation</button>}</div> : null;
}

function GenerationDetails({ generation }: { generation: Generation }) {
  const changed = generation.context.key !== generation.batch.contextKey;
  const used = new Set(generation.batch.items.flatMap(item => item.evidenceIds));
  return <details className="ex-generation-details"><summary>Generation details and sources</summary><p>{generation.production?generation.batch.items.length?'These ideas use your chosen preferences and the available dated context.':'Generate a set to see its sources and fit.':projectGenerationNotice(generation.context, generation.batch)}</p>{generation.batch.request && <p>Your request: {generation.batch.request.replace(/\u2014/g, ', ')}</p>}{changed && <p role="status">Your HALO context changed. Refresh ideas to use the latest record revisions; existing projects remain unchanged.</p>}<p>{generation.production ? 'Ideas use the dated context and sources listed below. Conditions may have changed.' : generation.context.evidence.some(item => item.id.startsWith('preview:today:')) ? 'Outdoor readings are dated September 30, not current work conditions. Utility tests, county estimates and observations have different scopes.' : 'Public environmental readings are unavailable in this view. Ideas use only explicitly supplied private records or general interests.'} Project selection does not diagnose a home or calculate environmental benefit.</p><ul>{generation.context.evidence.filter(item => used.has(item.id)).map(item => <li key={item.id}><strong>{item.label}: {item.value}</strong><small>{item.asOf} · {item.provenance}{item.stale ? ' · Older reading' : ''}</small><p>{item.scope}</p></li>)}</ul><p>Notes and Journal are not included automatically. Check regional suitability before starting.</p></details>;
}

function ProjectFitSheet({ generation }: { generation: Generation }) {
  const [draft, setDraft, clearDraft] = useHomeDraft('explore:project-generation-fit', { constraints: generation.batch.constraints, request: generation.batch.request });
  function change<K extends keyof ProjectConstraints>(key: K, value: ProjectConstraints[K]) { setDraft(previous => ({ ...previous, constraints: { ...previous.constraints, [key]: value } })); }
  return <BottomSheet id="project-fit" title="Make these projects fit me" height="tall" onClose={() => generation.setFitOpen(false)}><form className="ex-project-fit-form" onSubmit={event => { event.preventDefault(); generation.regenerate(draft.constraints, draft.request, false, clearDraft); generation.setFitOpen(false); }}><p>Choose what is practical. These choices shape the ideas, not your environmental readings.</p><div className="ex-project-fit-fields">
    <label>Where could you do this?<select value={draft.constraints.space} onChange={event => change('space', event.target.value as ProjectConstraints['space'])}><option value="any">I am open to different spaces</option><option value="indoors">Inside my home</option><option value="balcony">Balcony or small outdoor space</option><option value="yard">A yard or garden</option><option value="community">Somewhere in the community</option></select></label>
    <label>Who would take part?<select value={draft.constraints.mode} onChange={event => change('mode', event.target.value as ProjectConstraints['mode'])}><option value="any">Solo or together</option><option value="solo">On my own</option><option value="group">With other people</option></select></label>
    <label>How would you like to start?<select value={draft.constraints.time} onChange={event => change('time', event.target.value as ProjectConstraints['time'])}><option value="any">I am flexible</option><option value="quick">A small first step</option><option value="half-day">A build or planting session</option><option value="ongoing">Something I can keep working on</option></select></label>
    <label>Materials and spending<select value={draft.constraints.budget} onChange={event => change('budget', event.target.value as ProjectConstraints['budget'])}><option value="any">Show different options</option><option value="reuse">Start with what I have</option><option value="low">Basic supplies only</option></select></label>
    <label>How many ideas?<select value={draft.constraints.count} onChange={event => change('count', Number(event.target.value) as ProjectConstraints['count'])}>{[3, 5, 10, 11, 12, 13, 14, 15].map(count => <option key={count} value={count}>{count} ideas</option>)}</select></label>
  </div><label>Anything else you want to try? (optional)<textarea maxLength={500} value={draft.request} onChange={event => setDraft(previous => ({ ...previous, request: event.target.value }))} placeholder="For example, a small solar experiment or something I can do with friends" /></label><p className="ex-meta">A material price, permission or available organization is still something to confirm. If fewer reviewed ideas fit, HALO keeps that limit honest.</p><button className="ex-button" type="submit">Generate my project ideas<ArrowRight size={17} aria-hidden="true" /></button><button className="ex-text-button" type="button" onClick={() => generation.setFitOpen(false)}>Keep current ideas</button></form></BottomSheet>;
}
