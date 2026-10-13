'use client';
import DateInput from '@/components/ui/DateInput';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, RotateCcw } from 'lucide-react';
import { BottomSheet } from '@/components/ui/Foundation';
import LunaMark from '@/components/foundation/LunaMark';
import { useHomeCollection, useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { blankFieldNote, fieldNoteError, initialFieldNotes, type FieldNote } from '@/lib/frontend/explore-preview';
import { createProjectGeneration, defaultProjectConstraints, getPreviewProjectContext, type ProjectConstraints, type ProjectGenerationState, type ProjectSuggestion } from '@/lib/frontend/explore-personalization';
import { explicitLunaDate, lunaCalendarAnchor, lunaIntent, lunaTaskReviewError, lunaTaskRevisionMatches, matchingLunaNotes, matchingLunaProjects, resolveLunaCalendarDate } from '@/lib/frontend/luna-tools-preview';
import { projectGuides, projectActionKey, type ProjectGuide } from '@/lib/frontend/explore-project-guides';
import { noProjects, type ProjectRecord } from '@/lib/frontend/explore-workspace';
import { filterLocalResources, localResourceScope, type LocalParticipationResource } from '@/lib/frontend/explore-local-resources';
import { isDiagnosticRequest, DIAGNOSTIC_REFUSAL } from '@/lib/assistant';
import { useExpandedPreview } from './ExpandedPreviewState';
import LunaLoading from './LunaLoading';
import {isLunaWeekRequest,prepareLunaWeekPlan,lunaWeekChanges,weekMetaSignature,type LunaWeekPlan} from '@/lib/frontend/luna-week-plan';
import { emptyWeekMeta, type WeekMeta } from '@/lib/frontend/week-preview';
import { lunaTaskChangeError, lunaTaskNextMetadata, lunaTaskPatch, matchingLunaTasks, snapshotLunaTask, type LunaTaskChange, type LunaTaskOperation, type LunaTaskSnapshot } from '@/lib/frontend/luna-task-actions';
import { lunaCompletionCopy as lunaCopy } from '@/lib/frontend/copy/luna-completion';
import { revisedActionBatch } from '@/lib/frontend/expanded-preview';
import {homepageAttention,weeklyHomepageRecap} from '@/lib/frontend/homepage-preview';
import {initialSettings,type SettingsValues} from '@/lib/frontend/settings-preview';
import {polishCopy} from '@/lib/frontend/copy/app-polish';
import './luna-conversation.css';

type Guide = { id: string; title: string; stepTitle: string; instructions: string[]; source: string };
type Go = (tab: string, destination?: string, view?: string, id?: string) => void;
type Link = { label: string; tab: string; destination?: string; view?: string; record?: string };
type BaseProposal = { id: string; status: 'review' | 'applied' | 'cancelled'; error?: string; dateExplanation?: string; outcomeUnknown?: boolean; writeApplied?: boolean };
type Proposal = BaseProposal & (
  | { kind: 'create-task'; title: string; date: string; requiresDate: boolean; key: string }
  | { kind: 'move-task'; title: string; date: string; requiresDate: true; record: string; revision: number; previousDate: string }
  | { kind: 'save-note'; record: FieldNote; editing?: boolean }
  | { kind: 'delete-note'; records: { id: string; revision: number; title: string }[] }
  | { kind: 'start-project'; record: ProjectRecord; guide: ProjectGuide; date: string; requiresDate: boolean; savePreparation: boolean; projectSaved?: boolean }
  | { kind:'week-plan'; plan:LunaWeekPlan }
  | { kind: 'task-change'; change: LunaTaskChange }
);
type TaskChoices = { records: LunaTaskSnapshot[]; operation: LunaTaskOperation; request: string; title?: string };
type Message = { id: string; role: 'user' | 'assistant'; text: string; links?: Link[]; projects?: ProjectSuggestion[]; proposal?: Proposal; guide?: Guide; sources?: { title: string; url: string }[]; local?: LocalParticipationResource[]; retry?: string; taskChoices?: TaskChoices };
type Conversation = { draft: string; messages: Message[]; lastTaskKey?: string; projectRequest?: string };
const initialConversation: Conversation = { draft: '', messages: [] };

function constraintsForRequest(request: string, current: ProjectConstraints): ProjectConstraints {
  const next = { ...current };
  if (/\b(indoors?|no garden|without a garden)\b/i.test(request)) next.space = 'indoors';
  else if (/\bbalcony\b/i.test(request)) next.space = 'balcony';
  else if (/\b(yard|backyard|garden space)\b/i.test(request)) next.space = 'yard';
  else if (/\bcommunity\b/i.test(request)) next.space = 'community';
  if (/\b(alone|myself|solo)\b/i.test(request)) next.mode = 'solo';
  else if (/\b(group|together|friends)\b/i.test(request)) next.mode = 'group';
  if (/\b(quick|under an hour|one hour|an hour)\b/i.test(request)) next.time = 'quick';
  else if (/\bhalf.day\b/i.test(request)) next.time = 'half-day';
  else if (/\b(ongoing|long.term)\b/i.test(request)) next.time = 'ongoing';
  if (/\b(reuse|no spending|free|no money)\b/i.test(request)) next.budget = 'reuse';
  else if (/\b(cheap|cheaper|low.cost|low budget)\b/i.test(request)) next.budget = 'low';
  const count = request.match(/\b(3|5|10|11|12|13|14|15)\s+(?:projects?|ideas?)\b/i);
  if (count) next.count = Number(count[1]) as ProjectConstraints['count'];
  return next;
}

/** A visit-local conversation/tool study. No provider calls, account writes or external effects. */
export default function LunaConversation({ context, onClose, go: navigate, currentGuide, offline: offlineProp = false, environmentAvailable = true }: { context: string; onClose: () => void; go: Go; currentGuide?: Guide; offline?: boolean; environmentAvailable?: boolean }) {
  const workspace = useHomeWorkspace(); const preview = useExpandedPreview();
  const notes = useHomeCollection<FieldNote>('exploreNotes', initialFieldNotes);
  const projects = useHomeCollection<ProjectRecord>('exploreProjects', noProjects);
  const [conversation, setConversation] = useHomeDraft<Conversation>('luna:conversation', initialConversation);
  const [generation, setGeneration] = useHomeDraft<ProjectGenerationState | null>('explore:generated-projects', null);
  const [, setGenerationIntent] = useHomeDraft('explore:project-generation-intent', '');
  const [area] = useHomeDraft('explore:area', { place: '', state: '' });
  const [serviceState] = useHomeDraft('luna:review-state', 'ready');
  const [failPreparation] = useHomeDraft('luna:preparation-failure', false);
  const [actionOutcome] = useHomeDraft('luna:action-outcome', 'saved');
  const [actionCheck] = useHomeDraft('luna:action-check', 'unknown');
  const [weekMetas,setWeekMetas]=useHomeDraft<Record<string,WeekMeta>>('week:metas',{});
  const [weekZone]=useHomeDraft('week:zone','America/New_York');
  const [weekDay]=useHomeDraft('week:date',lunaCalendarAnchor(new Date(),weekZone));
  const [pendingRequest, setPendingRequest] = useState(''); const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRequestRef = useRef('');
  const retainConversation = useRef(setConversation);
  useLayoutEffect(() => { pendingRequestRef.current = pendingRequest; retainConversation.current = setConversation; }, [pendingRequest, setConversation]);
  const [busy, setBusy] = useState(false); const [info, setInfo] = useState(false);
  const executing = useRef(false); const applied = useRef(new Set<string>());
  const [clearConversation, setClearConversation] = useState(false);
  const [deviceOffline, setDeviceOffline] = useState(false);
  const [notice, setNotice] = useState(''); const log = useRef<HTMLDivElement>(null); const uid = useId();
  const offline = offlineProp || deviceOffline || workspace.scenario === 'offline';
  const timezone = weekZone;
  const blocked = busy || workspace.pending || offline || Boolean(pendingRequest) || clearConversation || ['loading', 'error'].includes(workspace.scenario);
  const contextPermissions = (workspace.drafts['settings:values'] as SettingsValues | undefined)?.luna ?? initialSettings.luna;
  const hasUnknownAction = conversation.messages.some(message => message.proposal?.outcomeUnknown);
  const go: Go = (tab, destination, view, id) => {
    if (busy || workspace.pending) return;
    if (pendingRequest) { if (replyTimer.current) clearTimeout(replyTimer.current); replyTimer.current = null; setConversation(previous => ({ ...previous, draft: previous.draft || pendingRequest })); setPendingRequest(''); }
    if (destination === 'opportunities' && id) workspace.setDraft('explore:local-selected', () => id);
    if (tab === 'plan' && id) workspace.setDraft('week:open-task', () => id);
    navigate(tab, destination, view, tab === 'plan' ? undefined : id);
  };
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'instant' }); }, [conversation.messages.length]);
  useEffect(() => () => { if (replyTimer.current) clearTimeout(replyTimer.current); const unfinished = pendingRequestRef.current; if (unfinished) retainConversation.current(previous => ({ ...previous, draft: previous.draft || unfinished })); }, []);
  useEffect(() => { const update = () => setDeviceOffline(!navigator.onLine); update(); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  useEffect(() => {
    if (!offline || !pendingRequest) return;
    if (replyTimer.current) clearTimeout(replyTimer.current);
    replyTimer.current = null;
    queueMicrotask(() => { if (pendingRequestRef.current !== pendingRequest) return; setConversation(previous => ({ ...previous, draft: previous.draft || pendingRequest })); setPendingRequest(''); setNotice('Connection lost. Your question is kept; reconnect before trying again.'); });
  }, [offline, pendingRequest, setConversation]);
  useEffect(() => {
    const viewport = window.visualViewport; const panel = document.getElementById(`luna-conversation-${uid}`);
    if (!viewport || !panel) return;
    const resize = () => { panel.style.setProperty('--lc-viewport', `${viewport.height}px`); panel.style.bottom = `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`; };
    resize(); viewport.addEventListener('resize', resize); viewport.addEventListener('scroll', resize);
    return () => { viewport.removeEventListener('resize', resize); viewport.removeEventListener('scroll', resize); };
  }, [uid]);
  const append = (text: string, extras: Partial<Omit<Message, 'id' | 'role' | 'text'>> = {}) => setConversation(previous => ({ ...previous, messages: [...previous.messages, { id: crypto.randomUUID(), role: 'assistant', text, ...extras }] }));
  const changeProposal = (messageId: string, change: (proposal: Proposal) => Proposal) => setConversation(previous => ({ ...previous, messages: previous.messages.map(message => message.id === messageId && message.proposal ? { ...message, proposal: change(message.proposal) } : message) }));

  function prepareTaskChange(task: LunaTaskSnapshot, operation: LunaTaskOperation, request: string, title?: string) {
    if (blocked) return;
    if (!contextPermissions.tasks) { append(polishCopy.contextOff, { links: [{ label: polishCopy.settings, tab: 'settings' }] }); return; }
    const current = preview?.actions.find(action => action.id === task.id);
    const details = current ? weekMetas[current.key] : undefined;
    const calendar = operation === 'move' ? resolveLunaCalendarDate(request, { anchor: lunaCalendarAnchor(new Date(), timezone), timezone, referenceDate: task.date || undefined }) : undefined;
    const change: LunaTaskChange = { operation, task, title: title ?? task.title, date: calendar?.date ?? task.date };
    const error = lunaTaskChangeError(change, current, details);
    if (error === 'changed' || error === 'paused') { append(error === 'changed' ? lunaCopy.taskChanged : lunaCopy.taskPaused, { links: [{ label: 'Open My Week', tab: 'plan' }] }); return; }
    if (error && !['rename', 'move'].includes(operation)) { append(error); return; }
    append(calendar?.ambiguous ?? 'Review the exact task and change below. Nothing changes until you confirm.', { proposal: { id: crypto.randomUUID(), kind: 'task-change', change, status: 'review', dateExplanation: calendar?.explanation } });
  }

  function send(value = conversation.draft, retry = false) {
    const request = value.trim().replace(/\u2014/g, ',').slice(0, 1000); if (!request || blocked) return;
    setNotice('');
    setConversation(previous => ({ ...previous, draft: '', messages: retry ? previous.messages : [...previous.messages, { id: crypto.randomUUID(), role: 'user', text: request }] }));
    if (isDiagnosticRequest(request)) { append(DIAGNOSTIC_REFUSAL.replace(/\u2014/g, ',')); return; }
    if (serviceState !== 'ready') {
      if (serviceState === 'slow') { setPendingRequest(request); replyTimer.current = setTimeout(() => { replyTimer.current = null; setPendingRequest(''); append('Luna did not return a reply. Try again.', { retry: request }); }, 6500); return; }
      const responses: Record<string, string> = { 'no-source': 'I do not have a reliable source for that. No changes were made.', unavailable: 'Luna is unavailable. No changes were made. Try again.', unconfigured: 'Luna is unavailable. You can still use the app directly.', 'rate-limit': 'Too many requests. Try again shortly. No changes were made.' };
      append(responses[serviceState] ?? responses.unavailable, ['unavailable', 'rate-limit', 'no-source'].includes(serviceState) ? { retry: request } : {}); return;
    }
    if(isLunaWeekRequest(request)||lunaIntent(request).kind==='projects'){
      setPendingRequest(request);replyTimer.current=setTimeout(()=>{replyTimer.current=null;setPendingRequest('');respond(request);},1900);return;
    }
    respond(request);
  }
  function respond(request:string){
    const permissions=(workspace.drafts['settings:values'] as SettingsValues|undefined)?.luna??initialSettings.luna;
    const requestedIntent=lunaIntent(request);
    if(!permissions.tasks&&(isLunaWeekRequest(request)||['move-task','change-task','find-task'].includes(requestedIntent.kind)||/\b(?:attention|weekly recap|how did (?:my|this) week go)\b/i.test(request))){append(polishCopy.contextOff,{links:[{label:polishCopy.settings,tab:'settings'}]});return;}
    if(!permissions.projects&&['projects','start-project','guide'].includes(requestedIntent.kind)){append(polishCopy.contextOff,{links:[{label:polishCopy.settings,tab:'settings'}]});return;}
    if(/\bwhat (?:needs|requires) (?:my )?attention\b/i.test(request)){
      const anchor=lunaCalendarAnchor(new Date(),weekZone);
      const items=homepageAttention(preview?.actions??[],weekMetas,[],{},anchor,weekZone);
      append(items.length?`Among your saved tasks, ${items.length} need review: ${items.slice(0,3).map(item=>item.title).join('; ')}. Open Needs attention for record updates and to decide what happens next.`:'None of your saved tasks are earlier or waiting. Needs attention also includes relevant record changes.',{links:[{label:'Open your homepage',tab:'plan'}]});return;
    }
    if(/\b(?:how did (?:my|this) week go|(?:show|summarize|review) (?:my )?weekly recap)\b/i.test(request)){
      const recap=weeklyHomepageRecap(preview?.actions??[],weekMetas,{},lunaCalendarAnchor(new Date(),weekZone));
      append(`From recorded completion dates: ${recap.completed.length} actions completed this week, including ${recap.steps} project steps and ${recap.home} home tasks. These are recorded actions, not measured environmental improvements. Open your weekly recap for participation records.`,{links:[{label:'Open your homepage',tab:'plan'}]});return;
    }
    if(isLunaWeekRequest(request)){
      const plan=prepareLunaWeekPlan(request,preview?.actions??[],weekMetas,weekDay);
      append(plan.items.length?`I found ${plan.items.length} saved task${plan.items.length===1?'':'s'} that fit${plan.items.length===1?'s':''}${plan.budget!==null?` within ${plan.budget} minutes`:''}. Review the dates before applying. Existing commitments stay as they are.`:plan.explanation,{proposal:plan.items.length?{id:crypto.randomUUID(),kind:'week-plan',plan,status:'review'}:undefined,links:[{label:'Open My Week',tab:'plan'}]});return;
    }
    const waiting = [...conversation.messages].reverse().find(message => message.proposal?.status === 'review' && (['create-task', 'move-task'].includes(message.proposal.kind) || message.proposal.kind === 'task-change' && message.proposal.change.operation === 'move'));
    const date = explicitLunaDate(request);
    if (/^\d{4}-\d{2}-\d{2}$/.test(request) && waiting?.proposal && !date.invalid) {
      const proposal = waiting.proposal;
      if (proposal.kind === 'create-task' || proposal.kind === 'move-task') {
        changeProposal(waiting.id, current => ({ ...current, status: 'cancelled' }));
        append('Here is the updated all-day schedule. Review it before I save.', { proposal: { ...proposal, id: crypto.randomUUID(), date: request, status: 'review', error: undefined } }); return;
      }
      if (proposal.kind === 'task-change' && proposal.change.operation === 'move') {
        changeProposal(waiting.id, current => ({ ...current, status: 'cancelled' }));
        append('Review the revised date before saving.', { proposal: { ...proposal, id: crypto.randomUUID(), change: { ...proposal.change, date: request }, status: 'review', error: undefined } }); return;
      }
    }
    const intent = lunaIntent(request);
    if (intent.kind === 'clarify') { append(intent.message); return; }
    if (intent.kind === 'navigate') {
      append('Opening the requested workspace. Your conversation stays here.'); go(intent.tab, intent.destination); return;
    }
    if (intent.kind === 'open-project') {
      const matches = matchingLunaProjects(projectGuides, intent.name);
      if (matches.length === 1) { append(`Opening ${matches[0].title}. Your conversation stays here.`); go('act', 'projects', 'detail', matches[0].id); }
      else if (/^(?:all\s+)?projects?$/i.test(intent.name)) { append('Opening your project ideas.'); go('act', 'projects'); }
      else append('Which project do you mean? Tell me its title or choose one in your project ideas.', { links: [{ label: 'Open project ideas', tab: 'act', destination: 'projects' }] });
      return;
    }
    if (intent.kind === 'projects') {
      const combined = conversation.projectRequest ? `${conversation.projectRequest}\n${request}` : request;
      let next: ProjectGenerationState;
      try {
        next = createProjectGeneration(getPreviewProjectContext(permissions.home?workspace.collections:{}, undefined, environmentAvailable), constraintsForRequest(request, generation?.constraints ?? defaultProjectConstraints), combined);
        if (!Array.isArray(next.items) || !next.items.length || next.items.some(item => !projectGuides.some(guide => guide.id === item.id) || typeof item.reason !== 'string')) throw new Error('Invalid project result');
      } catch {
        append('I could not prepare that shortlist. Your previous project ideas are unchanged. Try another request or open the project browser.'); return;
      }
      setGeneration(next); setGenerationIntent(''); setConversation(previous => ({ ...previous, projectRequest: combined }));
      append(`I prepared ${next.items.length} project ideas ${environmentAvailable ? 'using your environmental context and preferences' : 'from your preferences, available owned records and general source-backed guidance, without unavailable environmental readings'}. These are the first three. Tell me about your space, budget or time to refine them.`, { projects: next.items.slice(0, 3), links: [{ label: `View all ${next.items.length} project ideas`, tab: 'act', destination: 'projects' }] }); return;
    }
    if (intent.kind === 'local') {
      const scope = localResourceScope(area); const interest = /\b(tree|trees|habitat)\b/i.test(request) ? 'Trees & habitat' : /\bgarden/i.test(request) ? 'Gardening' : /\b(clean|water|river)\b/i.test(request) ? 'Cleanup' : 'All interests';
      const matches = filterLocalResources(scope, interest).slice(0, 3);
      append(scope === 'examples' ? 'These are reviewed North Carolina programme examples, not matches to your location. Choose an area in the finder to check coverage. Registration and event details remain with the organizer.' : matches.length ? `These programme routes cover ${area.place}, ${area.state}. Check the organizer's current opportunities and meeting place before going.` : 'The reviewed directory has no supported local matches for that area. The finder has official national and local lookup alternatives; I will not invent an organization near you.', { local: matches, links: [{ label: 'Find local ways to help', tab: 'act', destination: 'opportunities' }] }); return;
    }
    if (intent.kind === 'guide') {
      if (currentGuide) append(`For ${currentGuide.title}, work through this step before moving on:`, { guide: currentGuide });
      else append('Which project would you like to work through? Open a project and I can use its current instructions and source.', { links: [{ label: 'Choose a project', tab: 'act', destination: 'projects' }] }); return;
    }
    if (intent.kind === 'answer') {
      if (intent.theme === 'reason') {
        const suggestion = generation?.items.find(item => item.id === currentGuide?.id) ?? generation?.items[0];
        if (!suggestion) { append('Which project do you mean? Ask for project ideas or open one, then I can show the reason and source behind it.'); return; }
        const guide = projectGuides.find(guide => guide.id === suggestion.id);
        append(`${suggestion.title}: ${suggestion.reason} ${suggestion.needsCheck.join(' ')} This is a fit suggestion, not evidence that the project fixes a household hazard.`, { sources: guide?.sources.filter(source => suggestion.sourceIds.includes(source.id)).map(source => ({ title: source.title, url: source.url })) }); return;
      }
      if (intent.theme === 'water') {
        append(environmentAvailable ? 'The utility record shows PFOS at 8.3 ppt in a public-system sample collected in March 2025. That is not a current test of your tap, garden water or personal exposure. Keep the sample date, compound, units and reported comparison basis together. A practical next step is to obtain the current utility report and ask what it covers; a private well uses its own qualified testing route.' : 'The current water reading is unavailable, so I cannot explain a local concentration or assume it is zero. Public-system reports and a qualified test of your own water answer different questions. Ask your utility for its current report, or use the private-well testing guidance for a well.', { sources: [{ title: 'EPA: Find a consumer confidence report', url: 'https://www.epa.gov/ccr' }, { title: 'EPA: Protect your private-well water', url: 'https://www.epa.gov/privatewells/protect-your-homes-water' }], links: [{ label: 'Open tests and records', tab: 'home', destination: 'tests' }] }); return;
      }
      if (intent.theme === 'home') {
        append(environmentAvailable ? 'Start with an evidence check you can complete: review the date and scope of your water information, keep home test results separate from county estimates, and follow up on an actual moisture observation if one was recorded. Outdoor weather-based mold estimates do not establish indoor mold. I can help start a relevant project or prepare a My Week task.' : 'Homeguard evidence is unavailable here. I can help organize your own records or find general guidance, but I cannot rank an unreported household hazard. Begin by checking which records and source dates you actually have.', { sources: [{ title: 'EPA: Mold and moisture in your home', url: 'https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home' }, { title: 'EPA: Public water reports', url: 'https://www.epa.gov/ccr' }], links: [{ label: 'Review Homeguard', tab: 'home' }, { label: 'Find a practical project', tab: 'act', destination: 'projects' }] }); return;
      }
      append(environmentAvailable ? 'The outdoor AQI of 37 is dated September 30, 2026, not a live reading for today. Recheck current conditions before choosing outdoor work. A useful action now is to prepare materials, review an organizer, or plan a small project, without treating an old forecast as a guaranteed safe time.' : 'There is no current environmental reading to plan around. Choose preparation or a general project now, and check current official conditions before outdoor work. Missing readings are not an all-clear.', { sources: [{ title: 'AirNow: Understanding the AQI', url: 'https://www.airnow.gov/aqi/aqi-basics/' }], links: [{ label: 'Find something useful to do', tab: 'act', destination: 'projects' }] }); return;
    }
    const id = crypto.randomUUID();
    if (intent.kind === 'start-project') {
      const name = intent.name.toLowerCase();
      const matches = name && !/^(?:it|this|that|project)$/.test(name) ? matchingLunaProjects(projectGuides, name) : projectGuides.filter(guide => guide.id === currentGuide?.id);
      if (matches.length !== 1) { append('Which project should I start? Tell me its full title or open the guide first so I can review its materials and safety checks.', { links: [{ label: 'Choose a project', tab: 'act', destination: 'projects' }] }); return; }
      const guide = matches[0]; const existing = projects.records.find(record => record.id === guide.id);
      if (existing?.status === 'Completed') { append('That project is recorded as completed. Open its workspace to review the outcome or choose another project; I will not silently reset it.', { links: [{ label: 'Open the project', tab: 'act', destination: 'projects', view: 'detail', record: guide.id }] }); return; }
      const record: ProjectRecord = { id: guide.id, title: guide.title, revision: existing?.revision ?? 0, status: 'Active', goal: guide.purpose, stepNotes: {}, outcome: '', reviewDate: '', history: [] };
      const calendar = resolveLunaCalendarDate(request, { anchor: lunaCalendarAnchor(new Date(), timezone), timezone });
      append(calendar.ambiguous ?? 'Review this project and its preparation. Starting a workspace does not mean the work is done, purchase materials or register anyone.', { proposal: { id, kind: 'start-project', record, guide, date: calendar.date, requiresDate: calendar.requiresDate, savePreparation: true, status: 'review', dateExplanation: calendar.explanation } }); return;
    }
    if (intent.kind === 'create-task') {
      const calendar = resolveLunaCalendarDate(request, { anchor: lunaCalendarAnchor(new Date(), timezone), timezone });
      append(calendar.ambiguous ?? 'Review this My Week task. I will save only the concrete title and date shown.', { proposal: { id, kind: 'create-task', title: intent.title, date: calendar.date, requiresDate: calendar.requiresDate, key: `luna:task:${id}`, status: 'review', dateExplanation: calendar.explanation } }); return;
    }
    if (intent.kind === 'move-task' || intent.kind === 'change-task' || intent.kind === 'find-task') {
      const matches = matchingLunaTasks(preview?.actions ?? [], intent.name, conversation.lastTaskKey);
      if (!matches.length) { append(lunaCopy.noTask, { links: [{ label: 'Open My Week', tab: 'plan' }] }); return; }
      if (intent.kind === 'find-task') { append(matches.map(task => `${task.title}: ${task.state}, ${task.date || 'saved for later'}, ${task.origin}.`).join('\n'), { links: matches.map(task => ({ label: `Open ${task.title}`, tab: 'plan', record: task.id })) }); return; }
      const operation = intent.kind === 'move-task' ? 'move' : intent.operation;
      const title = intent.kind === 'change-task' ? intent.title : undefined;
      const records = matches.map(task => snapshotLunaTask(task, weekMetas[task.key]));
      if (records.length !== 1) { append(lunaCopy.chooseTask, { taskChoices: { records, operation, request, title } }); return; }
      prepareTaskChange(records[0], operation, request, title); return;
    }
    if (intent.kind === 'save-note') {
      const record = { ...blankFieldNote(), id: crypto.randomUUID(), noteType: 'Idea' as const, title: intent.title, description: intent.description };
      append('Review this private note. It goes into your existing notebook, not a separate Luna notebook.', { proposal: { id, kind: 'save-note', record, status: 'review' } }); return;
    }
    if (intent.kind === 'edit-note') {
      const matches = matchingLunaNotes(notes.records, intent.name);
      if (matches.length !== 1) { append(matches.length ? 'More than one note matches. Use its full title so I review only the note you mean.' : 'I could not find that note. Check its full title in your notebook.', { links: [{ label: 'Open my notebook', tab: 'act', destination: 'observations' }] }); return; }
      const selected = matches[0];
      // Do not copy location, attachments, evidence or case history into conversation data.
      const record = { ...blankFieldNote(), id: selected.id, revision: selected.revision, title: selected.title, noteType: 'Idea' as const, description: intent.description };
      append('Review the replacement text for this exact note. Its date, location, attachments, evidence references and case history stay unchanged.', { proposal: { id, kind: 'save-note', record, editing: true, status: 'review' } }); return;
    }
    const matches = matchingLunaNotes(notes.records, intent.name);
    if (matches.length !== 1) { append(matches.length ? 'More than one note matches. Tell me the full title so I do not remove the wrong one.' : 'Which note should I remove? Give me its exact title, or open your notebook to check. Nothing has been deleted.', { links: [{ label: 'Open my notebook', tab: 'act', destination: 'observations' }] }); return; }
    append('Review the exact note below. Only this note and its own case history are removed. Independent My Week tasks, other records and copied messages remain.', { proposal: { id, kind: 'delete-note', records: matches.map(({ id, revision, title }) => ({ id, revision, title })), status: 'review' } });
  }

  async function execute(messageId: string, proposal: Proposal) {
    if (blocked || executing.current || applied.current.has(proposal.id) || proposal.status !== 'review') return;
    const fail = (message: string) => changeProposal(messageId, current => ({ ...current, error: message }));
    if (proposal.outcomeUnknown || hasUnknownAction) { fail(lunaCopy.pendingCheck); return; }
    const permissions=(workspace.drafts['settings:values'] as SettingsValues|undefined)?.luna??initialSettings.luna;
    if(!permissions.tasks&&['move-task','task-change','week-plan'].includes(proposal.kind)||!permissions.projects&&proposal.kind==='start-project'){fail(polishCopy.contextOff);return;}
    if (!navigator.onLine||['save-error', 'conflict'].includes(workspace.scenario) || preview?.fail) { const scope = proposal.kind === 'start-project' && proposal.projectSaved ? 'The project was already started. No additional change was made; its preparation is still unsaved.' : 'Nothing changed.'; fail(workspace.scenario === 'conflict' ? `Revision conflict. ${scope} Keep this review and resolve the record before retrying.` : `Could not save. Your choices are kept. ${scope}`); return; }
    if (actionOutcome === 'unknown-not-applied') {
      // An uncertain transport result is possible only after a valid, owned review.
      let error: string | null = null;
      if (proposal.kind === 'task-change') error = lunaTaskChangeError(proposal.change, preview?.actions.find(action => action.id === proposal.change.task.id), weekMetas[proposal.change.task.key]);
      else if (proposal.kind === 'create-task' || proposal.kind === 'move-task') {
        error = lunaTaskReviewError(proposal.title, proposal.date, proposal.requiresDate);
        if (!preview || proposal.kind === 'move-task' && !lunaTaskRevisionMatches(preview.actions.find(action => action.id === proposal.record), proposal.revision)) error = 'changed';
      } else if (proposal.kind === 'save-note') {
        error = fieldNoteError(proposal.record);
        if (proposal.editing && !notes.records.some(record => record.id === proposal.record.id && record.revision === proposal.record.revision)) error = 'This note changed or was deleted. Review its current record.';
      } else if (proposal.kind === 'delete-note') {
        if (!proposal.records.length || !proposal.records.every(selected => notes.records.some(record => record.id === selected.id && record.revision === selected.revision))) error = 'A selected note changed or was deleted. Review it again.';
      } else if (proposal.kind === 'week-plan') {
        const changes = lunaWeekChanges(proposal.plan);
        if (!changes || weekMetaSignature(proposal.plan.items, weekMetas) !== proposal.plan.metadataSignature || !revisedActionBatch(preview?.actions ?? [], changes)) error = 'A task or its schedule changed. Ask for a fresh plan.';
      } else {
        const current = projects.records.find(record => record.id === proposal.record.id);
        if (proposal.projectSaved ? !current || current.status !== 'Active' : current ? current.revision !== proposal.record.revision : proposal.record.revision !== 0) error = 'The project changed. Open its current workspace.';
        if (proposal.savePreparation) error ??= lunaTaskReviewError(proposal.guide.steps[0]?.title ?? '', proposal.date, proposal.requiresDate);
      }
      if (error) { fail(error === 'changed' ? lunaCopy.taskChanged : error === 'paused' ? lunaCopy.taskPaused : error); return; }
      changeProposal(messageId, current => ({ ...current, outcomeUnknown: true, writeApplied: false, error: undefined })); return;
    }
    executing.current = true; setBusy(true); setNotice('');
    try {
      if (proposal.kind === 'task-change') {
        const { change } = proposal;
        const current = preview?.actions.find(action => action.id === change.task.id);
        const error = lunaTaskChangeError(change, current, weekMetas[change.task.key]);
        if (error) { fail(error === 'changed' ? lunaCopy.taskChanged : error === 'paused' ? lunaCopy.taskPaused : error); return; }
        if (!current || !preview) { fail(lunaCopy.taskChanged); return; }
        const saved = change.operation === 'delete' ? preview.deleteAction(current.id, change.task.revision) : preview.reviseAction(current.id, change.task.revision, lunaTaskPatch(change, current));
        if (!saved) { fail(lunaCopy.taskChanged); return; }
        setWeekMetas(previous => {
          if (change.operation === 'delete') { const next = { ...previous }; delete next[current.key]; return next; }
          return { ...previous, [current.key]: lunaTaskNextMetadata(change.operation, previous[current.key], lunaCalendarAnchor(new Date(), timezone)) };
        });
        setConversation(previous => ({ ...previous, lastTaskKey: change.operation === 'delete' ? previous.lastTaskKey === current.key ? undefined : previous.lastTaskKey : current.key }));
      } else if(proposal.kind==='week-plan'){
        const changes=lunaWeekChanges(proposal.plan);
        if(!changes){fail('Choose a valid date for every selected task.');return;}
        if(weekMetaSignature(proposal.plan.items,weekMetas)!==proposal.plan.metadataSignature||!preview?.reviseActions(changes)){fail('A task or its schedule changed. Nothing was moved. Ask for a fresh plan.');return;}
      }else if (proposal.kind === 'start-project') {
        const current = projects.records.find(record => record.id === proposal.record.id);
        if (proposal.projectSaved && (!current || current.status !== 'Active')) { fail('The started project is no longer active or available. Review its workspace before saving preparation.'); return; }
        if (!proposal.projectSaved && (current ? current.revision !== proposal.record.revision : proposal.record.revision !== 0)) { fail('This project changed after the review. Open it and prepare a new review; nothing was overwritten.'); return; }
        if (proposal.savePreparation) { const error = lunaTaskReviewError(proposal.guide.steps[0]?.title ?? '', proposal.date, proposal.requiresDate); if (error) { fail(error); return; } }
        if (!proposal.projectSaved) {
          const base = current ?? proposal.record;
          const history = [...base.history, { status: 'Active', note: `I confirmed starting or continuing guide ${proposal.guide.version} with Luna.` }];
          if (!await projects.save({ ...base, status: 'Active', history })) { fail('The project was not started. Your review stays here; check the record before retrying.'); return; }
          changeProposal(messageId, current => current.kind === 'start-project' ? { ...current, projectSaved: true } : current);
        }
        if (proposal.savePreparation) {
          const key = projectActionKey(proposal.guide.id, 0);
          if (failPreparation || !key || !preview?.addActions([{ key, title: proposal.guide.steps[0].title, origin: 'Project', reason: `${proposal.guide.title}. Guide ${proposal.guide.version}; preparation only, not a completed step.` }], proposal.date)) { fail('The project workspace was started, but the preparation task was not saved. Retry this review to save the task, or open the project.'); return; }
          setConversation(previous => ({ ...previous, lastTaskKey: key }));
        }
      } else if (proposal.kind === 'create-task' || proposal.kind === 'move-task') {
        const error = lunaTaskReviewError(proposal.title, proposal.date, proposal.requiresDate); if (error) { fail(error); return; }
        if (!preview) { fail('My Week is unavailable. Nothing changed.'); return; }
        if (proposal.kind === 'move-task' && !lunaTaskRevisionMatches(preview.actions.find(action => action.id === proposal.record), proposal.revision)) { fail('This task changed after the review was prepared. Ask me to review the new task before saving.'); return; }
        const saved = proposal.kind === 'create-task'
          ? preview.addActions([{ key: proposal.key, title: proposal.title, origin: 'Luna', reason: 'A task you requested and confirmed in Luna. It does not change environmental evidence.' }], proposal.date)
          : preview.updateAction(proposal.record, proposal.revision, { title: proposal.title, date: proposal.date });
        if (!saved) { fail('The task could not be saved. It may have changed. Nothing was overwritten.'); return; }
        const key = proposal.kind === 'create-task' ? proposal.key : preview.actions.find(action => action.id === proposal.record)?.key;
        setConversation(previous => ({ ...previous, lastTaskKey: key }));
      } else if (proposal.kind === 'save-note') {
        const error = fieldNoteError(proposal.record); if (error) { fail(error); return; }
        const current = notes.records.find(record => record.id === proposal.record.id);
        if (proposal.editing && (!current || current.revision !== proposal.record.revision)) { fail('This note changed or was deleted after the review. Nothing was overwritten or restored. Open its current record before trying again.'); return; }
        const record = proposal.editing && current ? { ...current, title: proposal.record.title, description: proposal.record.description } : proposal.record;
        const fullError = fieldNoteError(record); if (fullError) { fail(fullError); return; }
        if (!await notes.save(record)) { fail('The note was not saved. Your review is retained. Check the workspace state and retry.'); return; }
      } else if (!await workspace.removeNotes(proposal.records)) { fail('The note was not removed. It may have changed, or saving failed. Review it again before retrying.'); return; }
      applied.current.add(proposal.id); changeProposal(messageId, current => ({ ...current, status: actionOutcome === 'unknown-applied' ? 'review' : 'applied', outcomeUnknown: actionOutcome === 'unknown-applied', writeApplied: true, error: undefined }));
    } finally { executing.current = false; setBusy(false); }
  }

  const review = (message: Message, proposal: Proposal) => {
    if (proposal.outcomeUnknown) {
      const title = proposal.kind === 'task-change' ? proposal.change.task.title : proposal.kind === 'week-plan' ? `${proposal.plan.items.length} selected tasks` : proposal.kind === 'delete-note' ? proposal.records.map(record => record.title).join(', ') : proposal.kind === 'create-task' || proposal.kind === 'move-task' ? proposal.title : proposal.record.title;
      return <section className="lc-proposal" aria-label="Action status review"><strong>{lunaCopy.unknownTitle}</strong><div className="lc-task-scope"><b>{title}</b><small>{lunaCopy.unknownScope}</small><small>Operation {proposal.id.slice(-8)}</small></div>{proposal.error && <p role="status">{proposal.error}</p>}<div className="lc-review-actions"><button className="lc-primary" disabled={blocked} onClick={() => { if (actionCheck !== 'resolved') changeProposal(message.id, current => ({ ...current, error: lunaCopy.unknownRetained })); else changeProposal(message.id, current => ({ ...current, outcomeUnknown: false, status: current.writeApplied ? 'applied' : 'review', error: current.writeApplied ? undefined : lunaCopy.noWrite })); }}>Check status</button></div></section>;
    }
    if (proposal.status === 'cancelled') return <p className="lc-receipt">{proposal.kind === 'start-project' && proposal.projectSaved ? 'The project workspace was already started. The unsaved preparation review was cancelled; the project remains.' : 'Review cancelled. No change was made from this review.'}</p>;
    if (proposal.kind === 'task-change') {
      const { change } = proposal; const { operation, task } = change;
      const labels: Record<LunaTaskOperation, string> = { delete: 'Delete this task?', complete: 'Mark this task complete?', reopen: 'Reopen this task?', waiting: 'Mark this task waiting?', unschedule: 'Save this task for later?', rename: 'Rename this task', move: 'Change this task' };
      const confirms: Record<LunaTaskOperation, string> = { delete: 'Yes, delete', complete: 'Mark complete', reopen: 'Reopen task', waiting: 'Mark waiting', unschedule: 'Save for later', rename: 'Save change', move: 'Save change' };
      const receipts: Record<LunaTaskOperation, string> = { delete: lunaCopy.deletedReceipt, complete: lunaCopy.completedReceipt, reopen: lunaCopy.reopenedReceipt, waiting: lunaCopy.waitingReceipt, unschedule: lunaCopy.unscheduledReceipt, rename: lunaCopy.changedReceipt, move: 'Saved in My Week.' };
      if (proposal.status === 'applied') return <div className="lc-receipt" data-record-id={task.id}><Check size={17} aria-hidden="true" /><span>{receipts[operation]}</span><button onClick={() => go('plan', undefined, undefined, operation === 'delete' ? undefined : task.id)}>{operation === 'delete' ? 'Open My Week' : 'Open task'} <ArrowRight size={16} aria-hidden="true" /></button></div>;
      const meta = weekMetas[task.key] ?? emptyWeekMeta;
      return <section className="lc-proposal" aria-label={operation === 'delete' ? 'Task deletion review' : 'Task change review'}>
        <strong>{labels[operation]}</strong>
        <fieldset disabled={busy || workspace.pending}>
          <div className="lc-task-scope"><b>{task.title}</b><small>{task.origin} · {task.state} · {task.date || 'Saved for later'}</small><small>Task revision {task.revision}</small></div>
          {operation === 'rename' && <label>Task title<input value={change.title} maxLength={160} onChange={event => changeProposal(message.id, current => current.kind === 'task-change' ? { ...current, change: { ...current.change, title: event.target.value }, error: undefined } : current)} /></label>}
          {operation === 'move' && <><label>All-day date<DateInput todayDate={lunaCalendarAnchor(new Date(), timezone)} value={change.date} onChange={event => changeProposal(message.id, current => current.kind === 'task-change' ? { ...current, change: { ...current.change, date: event.target.value }, dateExplanation: 'Date you selected.', error: undefined } : current)} /></label><small>{proposal.dateExplanation} {meta.time ? `Existing time ${meta.time} in ${meta.zone} stays attached.` : `All-day plan in ${timezone}.`} Reminder and repeat preferences are unchanged.</small></>}
          {operation === 'delete' && <small>{lunaCopy.deleteScope}</small>}
          {operation === 'complete' && <small>{lunaCopy.completionScope} Completion is recorded for {lunaCalendarAnchor(new Date(), timezone)} in {timezone}, not the scheduled day.</small>}
          {operation === 'reopen' && <small>{lunaCopy.reopenScope}</small>}
          {operation === 'waiting' && <small>{lunaCopy.waitingScope}</small>}
          {operation === 'unschedule' && <small>{lunaCopy.unscheduleScope}</small>}
          {proposal.error && <p role="alert">{proposal.error}</p>}
          <div className="lc-review-actions"><button className={operation === 'delete' ? 'lc-danger' : 'lc-primary'} disabled={blocked} onClick={() => { void execute(message.id, proposal); }}>{busy ? 'Saving...' : confirms[operation]}</button><button onClick={() => changeProposal(message.id, current => ({ ...current, status: 'cancelled' }))}>{operation === 'delete' ? 'No, keep it' : 'Cancel review'}</button></div>
        </fieldset>
      </section>;
    }
    if (proposal.status === 'applied') {
      if(proposal.kind==='week-plan')return <div className="lc-receipt"><Check size={17}/><span>{proposal.plan.items.length} existing tasks scheduled.</span><button onClick={()=>go('plan')}>Open My Week <ArrowRight size={16}/></button></div>;
      const action = proposal.kind === 'create-task' ? preview?.actions.find(action => action.key === proposal.key) : proposal.kind === 'move-task' ? preview?.actions.find(action => action.id === proposal.record) : undefined;
      const recordId = action?.id ?? (proposal.kind === 'save-note' || proposal.kind === 'start-project' ? proposal.record.id : proposal.kind === 'delete-note' ? proposal.records[0]?.id : '');
      return <div className="lc-receipt" data-record-id={recordId}><Check size={17} aria-hidden="true" /><span>{proposal.kind === 'delete-note' ? 'Selected note removed.' : proposal.kind === 'save-note' ? 'Note saved.' : proposal.kind === 'start-project' ? `Project workspace started${proposal.savePreparation ? ' with its preparation in My Week' : ''}. No step was completed.` : action ? 'Saved in My Week.' : 'This saved task is no longer available.'}</span>{proposal.kind !== 'delete-note' && recordId && <button onClick={() => proposal.kind === 'start-project' ? go('act', 'projects', 'detail', proposal.guide.id) : go(proposal.kind === 'save-note' ? 'act' : 'plan', proposal.kind === 'save-note' ? 'observations' : undefined, proposal.kind === 'save-note' ? 'detail' : undefined, recordId)}>Open <ArrowRight size={16} aria-hidden="true" /></button>}</div>;
    }
    return <section className="lc-proposal" aria-label={proposal.kind === 'delete-note' ? 'Note deletion review' : 'Luna action review'}>
      <strong>{proposal.kind==='week-plan'?'Your week, ready to review':proposal.kind === 'delete-note' ? 'Delete this note?' : proposal.kind === 'save-note' ? 'Your private note' : proposal.kind === 'start-project' ? 'Start this project' : proposal.kind === 'move-task' ? 'Change this task' : 'Add to My Week'}</strong>
      <fieldset disabled={busy || workspace.pending}>
        {proposal.kind==='week-plan'&&<><small>{proposal.plan.commitments} dated commitments kept · {proposal.plan.unknown} tasks still need an estimate</small>{proposal.plan.budget!==null&&<small>{proposal.plan.budget} min for these tasks, beyond existing commitments. Adjust dates if that time is not available.</small>}{proposal.plan.items.map(item=><label key={item.id}>{item.title}<small>{item.minutes} min estimated · Previously unscheduled</small><DateInput todayDate={lunaCalendarAnchor(new Date(),timezone)} value={item.date} aria-label={`Date for ${item.title}`} onChange={e=>changeProposal(message.id,p=>p.kind==='week-plan'?{...p,plan:{...p.plan,items:p.plan.items.map(i=>i.id===item.id?{...i,date:e.target.value}:i)},error:undefined}:p)}/></label>)}<small>All-day plans, not reserved time slots. Journal and private preparation notes are excluded.</small></>}
        {(proposal.kind === 'create-task' || proposal.kind === 'move-task') && <><label>Task title<input maxLength={160} value={proposal.title} onChange={event => changeProposal(message.id, current => current.kind === 'create-task' || current.kind === 'move-task' ? { ...current, title: event.target.value, error: undefined } : current)} /></label>{proposal.kind === 'move-task' && <small>Previously: {proposal.previousDate || 'Saved for later'}.</small>}<label>All-day date{!proposal.requiresDate && ' (optional)'}<DateInput todayDate={lunaCalendarAnchor(new Date(),timezone)} value={proposal.date} onChange={event => changeProposal(message.id, current => current.kind === 'create-task' || current.kind === 'move-task' ? { ...current, date: event.target.value, dateExplanation: 'Date you selected.', error: undefined } : current)} /></label><small>{proposal.dateExplanation} Timezone: {timezone}. No timed reminder, notification or task completion.</small></>}
        {proposal.kind === 'save-note' && <><label>Note title<input maxLength={160} value={proposal.record.title} onChange={event => changeProposal(message.id, current => current.kind === 'save-note' ? { ...current, record: { ...current.record, title: event.target.value }, error: undefined } : current)} /></label><label>Note text<textarea maxLength={3000} value={proposal.record.description} onChange={event => changeProposal(message.id, current => current.kind === 'save-note' ? { ...current, record: { ...current.record, description: event.target.value }, error: undefined } : current)} /></label></>}
        {proposal.kind === 'delete-note' && <><ul>{proposal.records.map(record => <li key={record.id}>{record.title}</li>)}</ul><small>Its own case history is included. Independent tasks and copied text stay. This cannot be undone.</small></>}
        {proposal.kind === 'start-project' && <><span>{proposal.guide.title}</span><p>{proposal.guide.suitability}</p><details><summary>Materials and safety checks</summary><ul>{proposal.guide.materials.map(material => <li key={material}>{material}</li>)}</ul><ul>{proposal.guide.constraints.map(check => <li key={check}>{check}</li>)}</ul><small>Guide {proposal.guide.version}. Confirm site suitability and follow the source instructions before physical work.</small></details><label className="lc-check"><input type="checkbox" checked={proposal.savePreparation} onChange={event => changeProposal(message.id, current => current.kind === 'start-project' ? { ...current, savePreparation: event.target.checked } : current)} />Save preparation to My Week</label>{proposal.savePreparation && <><small>{proposal.guide.steps[0]?.title}. An existing preparation action keeps its title, date and completion state.</small><label>Preparation all-day date{!proposal.requiresDate && ' (optional)'}<DateInput todayDate={lunaCalendarAnchor(new Date(),timezone)} value={proposal.date} onChange={event => changeProposal(message.id, current => current.kind === 'start-project' ? { ...current, date: event.target.value, error: undefined, dateExplanation: 'Date you selected.' } : current)} /></label><small>{proposal.dateExplanation} {timezone}. Saving does not check off the step.</small></>}</>}
        {proposal.error && <p role="alert">{proposal.error}</p>}
        <div className="lc-review-actions"><button className={proposal.kind === 'delete-note' ? 'lc-danger' : 'lc-primary'} disabled={blocked} onClick={() => { void execute(message.id, proposal); }}>{busy ? 'Saving...' : proposal.kind==='week-plan'?'Apply reviewed plan':proposal.kind === 'delete-note' ? 'Yes, delete' : proposal.kind === 'save-note' ? 'Save note' : proposal.kind === 'start-project' ? proposal.projectSaved ? 'Save preparation' : 'Start project' : proposal.kind === 'move-task' ? 'Save change' : 'Save task'}</button><button disabled={busy || workspace.pending} onClick={() => changeProposal(message.id, current => ({ ...current, status: 'cancelled' }))}>{proposal.kind === 'delete-note' ? 'No, keep it' : 'Cancel review'}</button></div>
      </fieldset>
    </section>;
  };

  function cancelPending() { if (replyTimer.current) clearTimeout(replyTimer.current); replyTimer.current = null; setConversation(previous => ({ ...previous, draft: previous.draft || pendingRequest })); setPendingRequest(''); setNotice('Request cancelled. Edit your question or retry.'); }
  return <BottomSheet id={`luna-conversation-${uid}`} title="Luna" height="tall" onClose={() => { if (!busy && !workspace.pending) { if (pendingRequest) cancelPending(); onClose(); } }}><div className="lc-shell">
    <header className="lc-context"><LunaMark size={26} /><span>{currentGuide?.title ?? context}</span><button aria-expanded={info} onClick={() => setInfo(value => !value)}>Context &amp; privacy</button></header>
    {info && <aside className="lc-info"><p>Context: this page. Tasks {contextPermissions.tasks ? 'on' : 'off'}, home records {contextPermissions.home ? 'on' : 'off'}, projects {contextPermissions.projects ? 'on' : 'off'}.</p><p>Notes are included only when you choose them. Journal text and private task preparation stay excluded. Review every proposed change.</p><details><summary>What Luna can do</summary><p>{lunaCopy.capabilities}</p><p>Project ideas and step guidance, local participation routes, source explanations, notes and navigation are also available. External registration, messages and test results never change from a chat request.</p></details><button className="lc-link" onClick={() => go('settings')}>Manage context in Settings <ArrowRight size={16} aria-hidden="true" /></button></aside>}
    <div className="lc-log" ref={log} role="log" aria-label="Conversation with Luna" aria-live="polite" aria-relevant="additions">
      {!conversation.messages.length && <section className="lc-welcome"><LunaMark size={40} /><h3>What would you like to do?</h3><p>Find a project, make a plan, or get help with what is in front of you.</p><div className="lc-starts">{['Find projects that fit my home', 'Find local ways to volunteer', currentGuide ? 'Guide me through this step' : 'Open my tests'].map(prompt => <button key={prompt} onClick={() => send(prompt)} disabled={blocked}>{prompt}<ArrowRight size={16} aria-hidden="true" /></button>)}</div></section>}
      {conversation.messages.map(message => <article className={`lc-message lc-message--${message.role}`} key={message.id}>
        <span className="lc-role">{message.role === 'user' ? 'You' : 'Luna'}</span><p>{message.text}</p>
        {message.projects && <div className="lc-projects">{message.projects.map(project => <button key={project.id} onClick={() => go('act', 'projects', 'detail', project.id)}><strong>{project.title}</strong><small>{project.reason}</small><ArrowRight size={16} aria-hidden="true" /></button>)}</div>}
        {message.local && <div className="lc-local">{message.local.map(resource => <article key={resource.id}><strong>{resource.organizer}</strong><small>{resource.area}</small><p>{resource.work}</p>{resource.address && <small>{resource.address}<br />{resource.addressRole}</small>}<a href={resource.url} target="_blank" rel="noreferrer">Official programme information</a><button className="lc-link" onClick={() => go('act', 'opportunities', 'list', resource.id)}>Plan how to take part<ArrowRight size={16} aria-hidden="true" /></button></article>)}</div>}
        {message.guide && <div className="lc-guide"><strong>{message.guide.stepTitle}</strong><ol>{message.guide.instructions.map(line => <li key={line}>{line}</li>)}</ol><a href={message.guide.source} target="_blank" rel="noreferrer">Source instructions</a><small>You decide when the step is complete.</small></div>}
        {message.sources && <details className="lc-sources"><summary>Sources and scope</summary>{message.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}<small>Official guidance supports these explanations.</small></details>}
        {message.links?.map(link => <button className="lc-link" key={link.label} onClick={() => go(link.tab, link.destination, link.view, link.record)}>{link.label}<ArrowRight size={16} aria-hidden="true" /></button>)}
        {message.taskChoices && <div className="lc-task-choices" role="group" aria-label="Choose a task">{message.taskChoices.records.map(task => <button key={task.id} disabled={blocked} onClick={() => { const choices = message.taskChoices!; prepareTaskChange(task, choices.operation, choices.request, choices.title); }}><strong>{task.title}</strong><small>{task.origin} · {task.date || 'Saved for later'} · {task.state}</small><span>Review this task <ArrowRight size={16} aria-hidden="true" /></span></button>)}</div>}
        {message.retry && <button className="lc-link" disabled={blocked} onClick={() => send(message.retry!, true)}>Retry request</button>}
        {message.proposal && review(message, message.proposal)}
      </article>)}
      {(pendingRequest||busy)&&<aside className="lc-pending"><LunaLoading label={busy?'Saving your confirmed changes':'Thinking it through'} />{pendingRequest&&<button onClick={cancelPending}>Cancel request</button>}</aside>}
    </div>
    <footer className="lc-footer">
      {offline && <p role="status">Offline. Your conversation and reviews stay here; changes are not queued.</p>}{notice && <p role="status">{notice}</p>}
      {clearConversation ? <section className="lc-clear" aria-label="Clear conversation review"><strong>{lunaCopy.clearTitle}</strong><p>{lunaCopy.clearScope}</p><div className="lc-review-actions"><button className="lc-danger" onClick={() => { setConversation(initialConversation); setClearConversation(false); setNotice(lunaCopy.newConversation); }}>{lunaCopy.clearConfirm}</button><button onClick={() => setClearConversation(false)}>{lunaCopy.clearCancel}</button></div></section> : <>
        <form className="lc-composer" onSubmit={event => { event.preventDefault(); send(); }}><label className="halo-sr-only" htmlFor={`luna-input-${uid}`}>Message Luna</label><textarea id={`luna-input-${uid}`} rows={2} maxLength={1000} placeholder="Ask Luna to help or do something..." value={conversation.draft} disabled={busy} onChange={event => setConversation(previous => ({ ...previous, draft: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><button type="submit" className="lc-send" aria-label="Send message" disabled={!conversation.draft.trim() || blocked}><ArrowUp size={20} aria-hidden="true" /></button></form>
        <div className="lc-footer-meta"><button disabled={busy || workspace.pending || Boolean(pendingRequest) || hasUnknownAction} title={hasUnknownAction ? 'Check the pending change before clearing this conversation.' : undefined} onClick={() => { if (pendingRequest || hasUnknownAction) return; if (conversation.messages.length || conversation.draft) setClearConversation(true); else setNotice(lunaCopy.newConversation); }}><RotateCcw size={13} aria-hidden="true" />New conversation</button>{hasUnknownAction && <small>A change needs checking.</small>}</div>
      </>}
    </footer>
  </div></BottomSheet>;
}
