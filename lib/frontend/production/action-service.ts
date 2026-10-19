import { actionDraftError, revisedActionBatch, validActionDate, type ActionRevision, type ActionSeed, type PreviewAction } from '../expanded-preview';
import { emptyWeekMeta, eventInstant, type WeekMeta } from '../week-preview';
import { validReminderStates, type ReminderState } from '../week-reminders';

/** One command owns a task and its schedule, preparation and completion metadata. */
export type ActionCommitOptions = {
  metadata?: Record<string, WeekMeta | null>;
  expectedMetadata?: Record<string, string>;
  preferences?: Record<string, unknown>;
  initialStates?: Record<string, PreviewAction['state']>;
};
export type ActionSnapshot = { actions: PreviewAction[]; metas: Record<string, WeekMeta>; preferences?: Record<string, unknown>;unresolvedOperations?:string[]; reminderStates?: Record<string, ReminderState> };
export type ActionCommand = ActionCommitOptions & (
  | { kind: 'add'; seeds: ActionSeed[]; date: string }
  | { kind: 'revise'; changes: ActionRevision[] }
  | { kind: 'delete'; id: string; revision: number }
  | { kind: 'clear'; fingerprint: string }
);
export type ActionReceipt = { operationId: string; status: 'succeeded' | 'failed' | 'pending' | 'unknown' | 'cancelled'; snapshot?: ActionSnapshot; message?: string };
export interface ExpandedActionAdapter {
  /** Identity/context scoped. Never supplies wireframe records on failure. */
  load(signal: AbortSignal): Promise<ActionSnapshot>;
  commit(command: ActionCommand, options: { operationId: string; signal: AbortSignal }): Promise<ActionReceipt>;
  reconcile(operationId: string, signal: AbortSignal): Promise<ActionReceipt>;
}

export function actionMetadataError(meta: WeekMeta, action: PreviewAction): string | null {
  if (!meta || typeof meta !== 'object' || typeof meta.time !== 'string' || typeof meta.completedOn !== 'string' || typeof meta.zone !== 'string' || [meta.paused,meta.archived,meta.reminder].some(value=>typeof value!=='boolean') || meta.estimateSet!==undefined&&typeof meta.estimateSet!=='boolean') return 'The task schedule is invalid.';
  if (typeof meta.note !== 'string' || meta.note.length > 3000 || !Array.isArray(meta.history) || meta.history.some(line => typeof line !== 'string')) return 'The task details are invalid.';
  if (!Number.isInteger(meta.duration) || meta.duration < 15 || meta.duration > 1440) return 'Choose a duration between 15 and 1440 minutes.';
  try { new Intl.DateTimeFormat('en', { timeZone: meta.zone }); } catch { return 'Choose a valid timezone.'; }
  if (meta.time && !eventInstant(action.date, meta.time, meta.zone)) return 'Choose a valid dated time outside clock-change gaps or ambiguous times.';
  if (!['none', 'weekly', 'after-completion'].includes(meta.recurrence) || meta.recurrence !== 'none' && (!action.date || meta.time)) return 'Repeating tasks need an all-day date.';
  if (meta.completedOn && actionDraftError('Completion', meta.completedOn)) return 'The completion date is invalid.';
  return null;
}

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max=500):value is string=>typeof value==='string'&&value.length<=max;
function validZone(value:unknown){if(!text(value,100)||!value)return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}
/** Server preferences may update only the known durable draft namespaces. */
export function validActionPreferences(value:unknown):value is Record<string,unknown>{
 if(!object(value))return false;
 return Object.entries(value).every(([key,item])=>{
  if(key==='week:focus')return text(item,300);
  if(key==='food-interests')return Array.isArray(item)&&item.length<=5&&new Set(item).size===item.length&&item.every(entry=>['fish','gardens','evidence','growers','water'].includes(entry));
  if(key==='week:availability')return object(item)&&Object.keys(item).length<=1000&&Object.entries(item).every(([day,minutes])=>!!day&&validActionDate(day)&&Number.isInteger(minutes)&&Number(minutes)>=0&&Number(minutes)<=10080);
  if(key==='week:season-dismissals')return Array.isArray(item)&&item.length<=1000&&new Set(item).size===item.length&&item.every(entry=>text(entry,200)&&entry.length>0);
  if(key==='week:review-preferences')return object(item)&&Object.keys(item).every(name=>['enabled','weekday','time','zone'].includes(name))&&typeof item.enabled==='boolean'&&Number.isInteger(item.weekday)&&Number(item.weekday)>=0&&Number(item.weekday)<=6&&typeof item.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)&&validZone(item.zone);
  if(key==='outdoorPlan')return object(item)&&Object.keys(item).every(name=>['key','place','period','watchRequested','forecastVersion','forecastIssuedAt','forecastExpiresAt'].includes(name))&&text(item.key,300)&&text(item.place,500)&&text(item.period,100)&&typeof item.watchRequested==='boolean'&&(item.forecastVersion===null||text(item.forecastVersion,300))&&[item.forecastIssuedAt,item.forecastExpiresAt].every(date=>date===null||typeof date==='string'&&Number.isFinite(Date.parse(date)));
  return false;
 });
}

/** Pure review adapter. Production never uses its locally assigned revisions. */
export function applyReviewActionCommand(snapshot: ActionSnapshot, command: ActionCommand, id: () => string): ActionSnapshot | null {
  const current = snapshot.actions;
  if (Object.entries(command.expectedMetadata ?? {}).some(([key, signature]) => JSON.stringify(snapshot.metas[key] ?? null) !== signature)) return null;
  let actions: PreviewAction[];
  if (command.kind === 'add') {
    if (!command.seeds.length || command.seeds.some(seed => actionDraftError(seed.title, command.date))) return null;
    if (Object.values(command.initialStates ?? {}).some(state => !['saved','waiting','completed'].includes(state))) return null;
    actions = command.seeds.reduce((rows, seed) => rows.some(row => row.key === seed.key) ? rows : [...rows, { ...seed, title: seed.title.trim(), id: id(), date: command.date, state: command.initialStates?.[seed.key] ?? 'saved', revision: 1 } as PreviewAction], current);
  } else if (command.kind === 'revise') {
    const revised = revisedActionBatch(current, command.changes);
    if (!revised) return null;
    actions = revised;
  } else if (command.kind === 'delete') {
    if (!current.some(row => row.id === command.id && (row.revision ?? 1) === command.revision)) return null;
    actions = current.filter(row => row.id !== command.id);
  } else return null; // Account clearing has a separate exact scope review.
  const metas = { ...snapshot.metas };
  if (command.kind === 'delete') { const old = current.find(row => row.id === command.id); if (old) delete metas[old.key]; }
  for (const [key, meta] of Object.entries(command.metadata ?? {})) {
    if (meta === null) { delete metas[key]; continue; }
    const action = actions.find(row => row.key === key);
    if (!action || actionMetadataError(meta, action)) return null;
    // Repeated bundle/occurrence saves never overwrite existing planning details.
    if (command.kind === 'add' && current.some(row => row.key === key)) continue;
    metas[key] = structuredClone(meta);
  }
  return { actions, metas, preferences: { ...snapshot.preferences, ...command.preferences } };
}

/** Reject malformed adapter data before it can erase or falsely complete work. */
export function validActionSnapshot(value: unknown): value is ActionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as ActionSnapshot;
  if(data.preferences!==undefined&&!validActionPreferences(data.preferences))return false;
  if(data.unresolvedOperations!==undefined&&(!Array.isArray(data.unresolvedOperations)||data.unresolvedOperations.length>100||data.unresolvedOperations.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(data.unresolvedOperations).size!==data.unresolvedOperations.length))return false;
  if (!Array.isArray(data.actions) || !data.metas || typeof data.metas !== 'object' || Array.isArray(data.metas)) return false;
  const ids = new Set<string>(), keys = new Set<string>();
  for (const action of data.actions) {
    if (!action || typeof action.id !== 'string' || !action.id || typeof action.key !== 'string' || !action.key || ids.has(action.id) || keys.has(action.key) || typeof action.title !== 'string' || typeof action.date !== 'string' || actionDraftError(action.title, action.date) || !['saved', 'waiting', 'completed'].includes(action.state) || !Number.isInteger(action.revision) || (action.revision ?? 0) < 1 || typeof action.reason !== 'string' || typeof action.origin !== 'string') return false;
    ids.add(action.id); keys.add(action.key);
    if (data.metas[action.key] && actionMetadataError({ ...emptyWeekMeta, ...data.metas[action.key] }, action)) return false;
  }
  return Object.keys(data.metas).every(key => keys.has(key)) && (data.reminderStates === undefined || validReminderStates(data.reminderStates, data.actions));
}

/** A valid unrelated snapshot is not proof that the user's command succeeded. */
function sameValue(a:unknown,b:unknown):boolean{if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const left=Object.keys(a),right=Object.keys(b);return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&sameValue((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));}
export function actionReceiptCoversCommand(command:ActionCommand,previous:ActionSnapshot,receipt:ActionReceipt):boolean {
 if(receipt.status!=='succeeded'||!validActionSnapshot(receipt.snapshot))return false;
 const next=receipt.snapshot;
 if(command.kind==='clear')return next.actions.length===0&&Object.keys(next.metas).length===0;
 if(command.kind==='delete'){const old=previous.actions.find(action=>action.id===command.id);return !!old&&!next.actions.some(action=>action.id===command.id)&&!Object.hasOwn(next.metas,old.key);}
 if(command.kind==='revise'&&!command.changes.every(change=>{const action=next.actions.find(item=>item.id===change.id);return action&&Number(action.revision)>change.revision&&action.title===change.patch.title.trim()&&action.date===change.patch.date&&action.state===change.patch.state;}))return false;
 if(command.kind==='add'&&!command.seeds.every(seed=>{const action=next.actions.find(item=>item.key===seed.key),old=previous.actions.find(item=>item.key===seed.key);return !!action&&(old?sameValue(action,old):action.title===seed.title.trim()&&action.date===command.date&&action.state===(command.initialStates?.[seed.key]??'saved'));}))return false;
 for(const [key,meta]of Object.entries(command.metadata??{})){
  if(command.kind==='add'&&previous.actions.some(action=>action.key===key))continue;
  if(meta===null?Object.hasOwn(next.metas,key):!sameValue(next.metas[key],meta))return false;
 }
 return Object.entries(command.preferences??{}).every(([key,value])=>sameValue(next.preferences?.[key],value));
}
