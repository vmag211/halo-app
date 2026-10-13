import type { PreviewAction } from './expanded-preview';
import { actionDraftError } from './expanded-preview';
import { emptyWeekMeta, eventInstant, type WeekMeta } from './week-preview';

export type LunaTaskOperation = 'move' | 'rename' | 'delete' | 'complete' | 'reopen' | 'waiting' | 'unschedule';
export type LunaTaskSnapshot = Pick<PreviewAction, 'id' | 'key' | 'title' | 'origin' | 'date' | 'state'> & { revision: number; metadataSignature: string };
export type LunaTaskChange = { operation: LunaTaskOperation; task: LunaTaskSnapshot; title: string; date: string };

export function hasUnresolvedLunaAction(conversation: unknown): boolean {
  if (!conversation || typeof conversation !== 'object') return false;
  const messages = (conversation as { messages?: unknown }).messages;
  return Array.isArray(messages) && messages.some(message => message && typeof message === 'object' && (message as { proposal?: { outcomeUnknown?: boolean } }).proposal?.outcomeUnknown === true);
}

/** Only scheduling/status metadata enters a review. Private preparation text and history do not. */
export function lunaTaskMetadataSignature(meta?: WeekMeta): string {
  const value = meta ?? emptyWeekMeta;
  return JSON.stringify([value.time, value.duration, value.zone, value.estimateSet ?? false, value.recurrence, value.reminder, value.paused, value.archived, value.completedOn]);
}
export function snapshotLunaTask(task: PreviewAction, meta?: WeekMeta): LunaTaskSnapshot {
  const { id, key, title, origin, date, state } = task;
  return { id, key, title, origin, date, state, revision: task.revision ?? 1, metadataSignature: lunaTaskMetadataSignature(meta) };
}
export function matchingLunaTasks(tasks: PreviewAction[], name: string, lastKey?: string): PreviewAction[] {
  const query = name.trim().replace(/^["“']|["”']$/g, '').toLocaleLowerCase();
  if (/^(?:it|that|this|last)(?: task| reminder| action)?$/.test(query)) return tasks.filter(task => task.key === lastKey);
  if (!query || /^(?:all|every|some|my|these|those)(?: tasks?| reminders?| actions?)?$/.test(query)) return [];
  const exact = tasks.filter(task => task.title.trim().toLocaleLowerCase() === query);
  return exact.length ? exact : tasks.filter(task => task.title.toLocaleLowerCase().includes(query));
}
export function lunaTaskChangeError(change: LunaTaskChange, current: PreviewAction | undefined, meta?: WeekMeta): string | null {
  if (!current || current.id !== change.task.id || (current.revision ?? 1) !== change.task.revision || lunaTaskMetadataSignature(meta) !== change.task.metadataSignature) return 'changed';
  const details = meta ?? emptyWeekMeta;
  if (change.operation !== 'delete' && (details.paused || details.archived)) return 'paused';
  if (change.operation === 'rename') return actionDraftError(change.title, current.date);
  if (change.operation === 'move') {
    if (!change.date) return 'Choose an exact date before saving this schedule.';
    const error = actionDraftError(current.title, change.date);
    if (error) return error;
    if (details.time && !eventInstant(change.date, details.time, details.zone)) return 'That date conflicts with the existing local time at a clock change. Choose another date or edit the time in My Week.';
  }
  if (change.operation === 'complete' && current.state === 'completed') return 'This task is already complete. Nothing needs to change.';
  if (change.operation === 'reopen' && current.state !== 'completed') return 'This task is not completed. Open My Week to review its current status.';
  if (change.operation === 'waiting' && current.state === 'completed') return 'Reopen this completed task before marking it waiting.';
  return null;
}
export function lunaTaskPatch(change: LunaTaskChange, current: PreviewAction): Pick<PreviewAction, 'title' | 'date' | 'state'> {
  return {
    title: change.operation === 'rename' ? change.title.trim() : current.title,
    date: change.operation === 'unschedule' ? '' : change.operation === 'move' ? change.date : current.date,
    state: change.operation === 'complete' ? 'completed' : change.operation === 'reopen' ? 'saved' : change.operation === 'waiting' ? 'waiting' : current.state,
  };
}
/** The caller applies this only after the canonical action revision succeeds. */
export function lunaTaskNextMetadata(operation: LunaTaskOperation, current: WeekMeta | undefined, today: string): WeekMeta {
  const value = current ?? emptyWeekMeta;
  return {
    ...value,
    ...(operation === 'complete' ? { completedOn: today } : operation === 'reopen' ? { completedOn: '' } : {}),
    ...(operation === 'unschedule' ? { time: '', reminder: false, recurrence: 'none' as const } : {}),
    history: [...value.history, `${today}: ${operation === 'complete' ? 'Completed' : operation === 'reopen' ? 'Reopened' : operation === 'waiting' ? 'Marked waiting' : operation === 'unschedule' ? 'Saved for later' : operation === 'rename' ? 'Renamed' : 'Rescheduled'} by you after a Luna review.`],
  };
}
