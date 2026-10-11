'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Bug, Check, ChevronRight, Droplets, ExternalLink, HandHeart, ListOrdered, Pause, Play, Search, ShieldCheck, Sprout, Sun } from 'lucide-react';
import { Confirm } from '@/components/homeguard/HomeWorkspaceUI';
import { useHomeCollection, useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { ExploreSection } from '@/lib/frontend/explore-preview';
import { findProjectGuide, projectActionKey, projectCompletionError, projectGuideCauses, projectStepIndex, searchProjectGuides, type ProjectGuide } from '@/lib/frontend/explore-project-guides';
import { noProjects, validDay, type ProjectRecord } from '@/lib/frontend/explore-workspace';
import type { ActionSeed } from '@/lib/frontend/expanded-preview';
import { useExpandedPreview } from './ExpandedPreviewState';
import { ExplorePhoto } from './ExploreVisuals';
import { SaveExplore } from './ExploreShared';
import ExploreOutcome from './ExploreOutcome';
import ExploreCompanion from './ExploreCompanion';
import './explore-project-guides.css';

type Go = (section?: ExploreSection, view?: string, id?: string) => void;
const guideIcons = { plant: Sprout, bee: Bug, cleanup: HandHeart, sun: Sun, water: Droplets };

export default function ExploreProjects({ go, view, id, href }: { go: Go; view: string; id: string; href: (tab: string, destination?: string) => string }) {
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
  const project = findProjectGuide(id);
  const record = collection.records.find(item => item.id === id);

  if (view !== 'detail') {
    const available = workspace.scenario === 'empty' ? [] : searchProjectGuides(query, cause);
    return <section className="ex-detail ex-guide-library">
      <div className="ex-section-heading"><span className="ex-kicker">Make something happen</span><h3>Good ideas, clear instructions.</h3><p>A planting, a small build or a group effort. Know what you need, work through the guide and keep your next step in My Week.</p></div>
      {collection.records.length > 0 && <section className="ex-project-continuation"><h4>My project workspaces</h4>{collection.records.map(item => <button className="ex-text-button" key={item.id} onClick={() => go('projects', 'detail', item.id)}>{item.title} · {item.status}<ArrowRight size={16} aria-hidden="true" /></button>)}</section>}
      <div className="ex-guide-find"><label><Search size={17} aria-hidden="true" /><span className="ex-sr">Find a project</span><input type="search" value={query} placeholder="Try planting, bee house or solar" onChange={event => setQuery(event.target.value)} /></label><label>Focus<select value={cause} onChange={event => setCause(event.target.value)}>{projectGuideCauses.map(item => <option key={item}>{item}</option>)}</select></label></div>
      <div className="ex-guide-catalogue">{available.map(item => { const Icon = guideIcons[item.icon]; return <button key={item.id} className="ex-project-entry ex-guide-entry" onClick={() => go('projects', 'detail', item.id)}><ExplorePhoto scene={item.scene} /><span><span className="ex-guide-category"><Icon size={18} aria-hidden="true" />{item.cause}</span><strong>{item.title}</strong><small>{item.description}</small><span className="ex-guide-effort">{item.effort}</span><span className="ex-inline-link">See materials and instructions <ArrowRight size={17} aria-hidden="true" /></span></span></button>; })}</div>
      {!available.length && <div className="ex-empty"><h4>{workspace.scenario === 'empty' ? 'No project guides in this sample state' : 'No projects match that search'}</h4><p>{workspace.scenario === 'empty' ? 'Your notes, community resources and other Explore paths remain available.' : 'Try a broader word or show all projects.'}</p>{workspace.scenario !== 'empty' && <button className="ex-text-button" onClick={() => { setQuery(''); setCause('All projects'); }}>Show all projects</button>}</div>}
      <p className="ex-guide-preview-note">Source-backed guide drafts for review. Your workspace stays in this visit only. Local suitability and specialist review are required before production release.</p>
    </section>;
  }
  if (!project) return <div className="ex-empty"><h3>This project is unavailable</h3><p>Your other project workspaces remain available.</p><button className="ex-button" onClick={() => go('projects')}>All projects</button></div>;

  const current = projectStepIndex(step, project.steps.length);
  const currentStep = project.steps[current];
  const validSelected = selected.filter(index => projectActionKey(project.id, index));
  const keyFor = (index: number) => projectActionKey(project.id, index)!;
  const action = state?.actions.find(item => item.key === keyFor(current));
  const completed = project.steps.filter((_, index) => state?.actions.some(item => item.key === keyFor(index) && item.state === 'completed')).length;
  const disabled = workspace.pending || workspace.scenario === 'offline';
  const paused = record?.status === 'Paused';
  const currentOutcome = Object.hasOwn(workspace.drafts, `explore:project-outcome:${id}`) ? outcome : record?.outcome ?? '';
  const needsReview = record?.status === 'Completed' && completed !== project.steps.length;
  const Icon = guideIcons[project.icon];
  const seeds: ActionSeed[] = validSelected.map(index => ({ key: keyFor(index), title: project.steps[index].title, reason: `Chosen step ${index + 1} in ${project.title}. Guide ${project.version}. ${project.steps[index].checkpoint} Record actual work, not an estimated benefit.`, origin: 'Explore' }));

  function openStep(index: number) { setStep(index); setError(''); }
  function recordCompletion() {
    if (!record || !project) return;
    const invalid = projectCompletionError(completed, project.steps.length, currentOutcome);
    if (invalid) { setError(invalid); return; }
    setError('');
    collection.save({ ...record, status: 'Completed', outcome: currentOutcome.trim(), history: [...record.history, { status: 'Completed', note: currentOutcome.trim() }] });
  }

  return <section className="ex-detail ex-project-workspace ex-guide-workspace" data-project-id={project.id} data-guide-version={project.version}>
    <button className="ex-text-button" onClick={() => go('projects')}><ArrowLeft size={16} aria-hidden="true" />All projects</button>
    <div className="ex-guide-cover"><ExplorePhoto scene={project.scene} className="ex-detail-photo" /><span className="ex-guide-cover-caption"><Icon size={18} aria-hidden="true" />{project.cause} · Practical guide</span></div>
    <span className="ex-kicker">{project.effort} · {needsReview ? 'Completion needs review' : record?.status ?? 'Not started'}</span>
    <h3>{project.title}</h3><p>{project.description}</p>
    <div className="ex-guide-purpose"><h4>What you are working toward</h4><p>{project.purpose}</p></div>
    {!record ? <button className="ex-button" disabled={disabled} onClick={() => collection.save({ id: project.id, title: project.title, revision: 0, status: 'Active', goal: project.purpose, stepNotes: {}, outcome: '', reviewDate: '', history: [{ status: 'Active', note: `I chose to start guide ${project.version}.` }] })}><Play size={17} aria-hidden="true" />Start my project workspace</button> : <div className="ex-project-progress"><div><strong>{completed} of {project.steps.length} saved steps completed by you</strong><small>Your recorded actions, not an environmental benefit total.</small></div><progress aria-label="Project action progress" value={completed} max={project.steps.length} /><button className="ex-text-button" disabled={disabled} onClick={() => collection.save({ ...record, status: paused ? 'Active' : 'Paused', history: [...record.history, { status: paused ? 'Active' : 'Paused', note: paused ? 'I resumed my project.' : 'I paused my project.' }] })}>{paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}{paused ? 'Resume project' : 'Pause project'}</button></div>}
    {paused && <p className="ex-notice">This project is paused. Your saved tasks and notes remain. Resume before changing step progress here.</p>}
    <div className="ex-guide-preparation"><section><h4>Gather these</h4><ul>{project.materials.map(item => <li key={item}>{item}</li>)}</ul><p className="ex-meta">{project.cost}</p></section><section><h4><ShieldCheck size={18} aria-hidden="true" />Before you begin</h4><p>{project.suitability}</p><ul>{project.constraints.map(item => <li key={item}>{item}</li>)}</ul></section></div>
    {project.buildPlan && <details className="ex-guide-build"><summary>{project.buildPlan.title}</summary><p>{project.buildPlan.note}</p><dl>{project.buildPlan.parts.map(part => <div key={part.name}><dt>{part.name} ({part.quantity})</dt><dd>{part.size}</dd></div>)}</dl><ol>{project.buildPlan.assembly.map(text => <li key={text}>{text}</li>)}</ol><a href={project.sources.find(item => item.id === project.buildPlan?.sourceId)?.url} target="_blank" rel="noreferrer">Open the measured source diagrams<ExternalLink size={13} aria-hidden="true" /></a></details>}
    <div className="ex-guide-plan-entry"><p>Save the project as one reminder, or choose its individual steps below. Saving is not completion.</p><SaveExplore origin={`project:${project.id}`} title={project.title} reason={`${project.purpose} Guide ${project.version}. Individual step actions retain their separate IDs.`} /></div>

    <section className="ex-project-step ex-guide-current-step" aria-label="Current project step">
      <div className="ex-guide-step-heading"><Icon size={25} aria-hidden="true" /><span className="ex-kicker">Step {current + 1} of {project.steps.length}</span></div>
      <h4>{currentStep.title}</h4>
      <ol className="ex-guide-instructions">{currentStep.instructions.map(text => <li key={text}>{text}</li>)}</ol>
      <div className="ex-guide-checkpoint"><Check size={18} aria-hidden="true" /><div><strong>What to keep from this step</strong><p>{currentStep.checkpoint}</p></div></div>
      <div className="ex-guide-step-sources">{project.sources.filter(item => currentStep.sourceIds.includes(item.id)).map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">{item.publisher}: {item.title}<ExternalLink size={13} aria-hidden="true" /></a>)}</div>
      <ExploreCompanion context={`${project.title}, step ${current + 1}`} go={go} guide={{ title: currentStep.title, instructions: currentStep.instructions, source: project.sources.find(item => currentStep.sourceIds.includes(item.id))?.url ?? project.sources[0].url }} />
      <div className="ex-step-controls"><button aria-label="Previous project step" disabled={current === 0} onClick={() => openStep(current - 1)}><ArrowLeft size={20} /></button><span>Work at your pace</span><button aria-label="Next project step" disabled={current === project.steps.length - 1} onClick={() => openStep(current + 1)}><ArrowRight size={20} /></button></div>
      <SaveExplore origin={`project:${project.id}:step:${current}`} title={currentStep.title} reason={`Chosen step ${current + 1} of ${project.title}. Guide ${project.version}. ${currentStep.checkpoint} Opening this guide does not complete the step.`} />
      {action && <><p className="ex-meta">{action.state === 'completed' ? 'Completed by you' : action.state === 'waiting' ? 'Waiting' : 'Saved for later'}</p><div className="ex-guide-progress-controls"><button className="ex-text-button" disabled={disabled || paused} onClick={() => state?.changeState(action.id, action.state === 'completed' ? 'saved' : 'completed')}>{action.state === 'completed' ? 'Reopen this step' : 'Mark this step completed'}</button><button className="ex-text-button" disabled={disabled || paused} onClick={() => state?.changeState(action.id, action.state === 'waiting' ? 'saved' : 'waiting')}>{action.state === 'waiting' ? 'Resume saved step' : 'Mark this step waiting'}</button></div></>}
      {record && <><label>What I did or learned at this step<textarea maxLength={1000} value={notes[String(current)] ?? record.stepNotes[String(current)] ?? ''} onChange={event => setNotes({ ...notes, [current]: event.target.value })} /></label><button className="ex-text-button" disabled={disabled || paused} onClick={() => collection.save({ ...record, stepNotes: { ...record.stepNotes, [current]: notes[String(current)] ?? record.stepNotes[String(current)] ?? '' } })}>Save this step note</button></>}
    </section>

    <details className="ex-guide-scan"><summary><ListOrdered size={19} aria-hidden="true" />Read the whole guide</summary><ol>{project.steps.map((item, index) => <li key={item.title}><h4>{item.title}</h4><ul>{item.instructions.map(text => <li key={text}>{text}</li>)}</ul><p className="ex-meta">Keep: {item.checkpoint}</p><button className="ex-text-button" onClick={() => { openStep(index); document.querySelector('.ex-guide-current-step')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }}>Work on step {index + 1}<ChevronRight size={15} aria-hidden="true" /></button></li>)}</ol><p>Reading or moving between steps never marks them complete.</p></details>
    <section className="ex-project-plan"><h4>Put the right steps in My Week</h4><p>Choose the work you intend to do. Re-selecting an existing step keeps its title, schedule and completion state.</p><div className="ex-checklist">{project.steps.map((item, index) => <label className="ex-check" key={item.title}><input type="checkbox" checked={validSelected.includes(index)} onChange={event => setSelected(event.target.checked ? [...validSelected, index].sort((a, b) => a - b) : validSelected.filter(item => item !== index))} /><span><small>Step {index + 1}</small>{item.title}{state?.actions.some(item => item.key === keyFor(index) && item.state === 'completed') && <small><Check size={13} aria-hidden="true" /> Already completed by you</small>}</span></label>)}</div><label>Initial check-back date (optional)<input type="date" value={schedule} onChange={event => setSchedule(event.target.value)} /></label><button className="ex-button" disabled={!validSelected.length || disabled || paused} onClick={() => { if (schedule && !validDay(schedule)) { setError('Choose a valid check-back date.'); return; } setError(''); setConfirmBundle(true); }}>Review selected steps for My Week</button>{error && <p role="alert">{error}</p>}</section>

    {record && <section className="ex-project-reflection"><h4>Keep the result, then look ahead.</h4><p>{project.completion}</p><label>My project result<textarea maxLength={2000} value={currentOutcome} onChange={event => setOutcome(event.target.value)} /></label><button className="ex-button" disabled={disabled || paused || completed !== project.steps.length} onClick={recordCompletion}>Record project completion</button>{completed !== project.steps.length && <p className="ex-meta">Save and explicitly complete each project step before recording whole-project completion.</p>}<p>{project.followup}</p><ExploreOutcome origin={`project-review:${project.id}`} title="Review what happens next" goal={project.followup} mechanism="A care check, organizer reply or another measured experiment keeps your practical work moving." /></section>}
    {record && <details className="ex-guide-history"><summary>My project history</summary><ol>{record.history.map((item, index) => <li key={index}><strong>{item.status}</strong><p>{item.note}</p></li>)}</ol></details>}
    <GuideSources project={project} />
    <div className="ex-tools"><Link className="ex-text-button" href={href('home', project.cause === 'Water' ? 'tests' : 'food')}>{project.cause === 'Water' ? 'Continue into tests and home records' : 'Open Food and Garden in Homeguard'}</Link><button onClick={() => go('outreach')}>Prepare a question for a qualified resource</button><button onClick={() => go('observations', 'new')}>Keep a project observation</button>{project.cause === 'Community' && <button onClick={() => go('opportunities')}>Find an organizer</button>}</div>
    {confirmBundle && <Confirm title="Add these steps to My Week?" confirmLabel="Add selected steps" cancelLabel="Keep planning" onCancel={() => setConfirmBundle(false)} onConfirm={() => { if (disabled || paused || ['save-error', 'conflict'].includes(workspace.scenario) || !state?.addActions(seeds, schedule)) { setError('The sample plan update failed. Your choices remain here; nothing was added.'); setConfirmBundle(false); return; } setConfirmBundle(false); setError('Selected steps are in My Week. Existing actions were kept unchanged.'); }}><p>{validSelected.length} deliberately selected step{validSelected.length === 1 ? '' : 's'}. {schedule ? `Initial date: ${schedule}.` : 'No date: saved for later.'}</p><ul>{seeds.map(seed => <li key={seed.key}>{seed.title}</li>)}</ul><p>No step is marked completed and no external action is performed.</p></Confirm>}
  </section>;
}

function GuideSources({ project }: { project: ProjectGuide }) {
  return <details className="ex-guide-sources"><summary>Sources and guide limits</summary><p>{project.scope}</p><p>Guide {project.version}. Sources checked October 11, 2026. These are draft adaptations for review, not a specialist-approved protocol or a live source update.</p><ul>{project.sources.map(item => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.publisher}: {item.title}<ExternalLink size={13} aria-hidden="true" /></a><small>{item.published ? `Source date: ${item.published}. ` : 'Source publication date not supplied. '}Checked: {item.checked}.</small></li>)}</ul><p>Workspace saves are private, sample-session actions. They do not register participants, buy materials, measure environmental benefits or send information to Luna.</p></details>;
}
