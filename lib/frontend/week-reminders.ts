import type { PreviewAction } from './expanded-preview';
import type { WeekMeta } from './week-preview';
import {parseCalendarDate} from './date-input';

/** Read-only scheduler evidence. Never accepted in an action mutation. */
export type ReminderState = {
  actionRevision: number;
  scheduleSignature: string;
  status: 'pending' | 'registered' | 'scheduled' | 'delivered' | 'failed' | 'cancelled' | 'paused' | 'unknown';
  updatedAt: string;
  scheduledFor?: string;
  deliveredAt?: string;
  channel?: 'push' | 'email' | 'in-app';
};

/** The backend uses this same ordered tuple, independent of private preparation. */
export function reminderScheduleSignature(action: PreviewAction, meta: WeekMeta): string {
  return JSON.stringify([action.date, meta.time, meta.zone, meta.reminder, meta.paused, meta.archived, action.state]);
}

const instant = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(value) && !!parseCalendarDate(value.slice(0,10)) && Number.isFinite(Date.parse(value));
export function validReminderStates(value: unknown, actions: PreviewAction[]): value is Record<string, ReminderState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actionIds = new Set(actions.map(action => action.id));
  return Object.entries(value).every(([id, candidate]) => {
    if (!actionIds.has(id) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const state = candidate as ReminderState;
    return Number.isInteger(state.actionRevision) && state.actionRevision > 0
      && typeof state.scheduleSignature === 'string' && state.scheduleSignature.length > 0 && state.scheduleSignature.length <= 1000
      && ['pending', 'registered', 'scheduled', 'delivered', 'failed', 'cancelled', 'paused', 'unknown'].includes(state.status)
      && instant(state.updatedAt)
      && (state.scheduledFor === undefined || instant(state.scheduledFor))
      && (state.deliveredAt === undefined || instant(state.deliveredAt))
      && (state.status !== 'scheduled' || instant(state.scheduledFor))
      && (state.status !== 'delivered' || instant(state.deliveredAt))
      && (state.channel === undefined || ['push', 'email', 'in-app'].includes(state.channel));
  });
}

export function reminderPresentation(action: PreviewAction, meta: WeekMeta, evidence?: ReminderState) {
  if (evidence && (evidence.actionRevision !== (action.revision ?? 1) || evidence.scheduleSignature !== reminderScheduleSignature(action, meta))) {
    return { label: 'Needs sync', tone: 'warning', detail: 'The task changed after this status was received. Refresh to check its current reminder.' };
  }
  if (!meta.reminder) return { label: 'Off', tone: 'quiet', detail: evidence?.status === 'cancelled' ? 'Cancellation confirmed.' : evidence && !['cancelled', 'paused'].includes(evidence.status) ? 'Reminder turned off. Cancellation is not yet confirmed.' : 'No reminder requested.' };
  if (meta.paused || meta.archived || action.state === 'completed') return { label: evidence?.status === 'cancelled' ? 'Cancelled' : evidence?.status === 'paused' ? 'Paused' : 'Stop pending', tone: 'quiet', detail: evidence && ['cancelled', 'paused'].includes(evidence.status) ? 'The service confirmed this reminder is not active.' : 'This task is no longer active. Reminder cancellation is not yet confirmed.' };
  if (!action.date) return { label: 'Date needed', tone: 'warning', detail: 'Choose a date before a reminder can be scheduled.' };
  if (!evidence) return { label: 'Requested', tone: 'quiet', detail: 'Your task requests a reminder. Scheduling and delivery are not confirmed.' };
  const descriptions = {
    pending: ['Pending', 'quiet', 'The service received the request. Scheduling is not confirmed.'],
    registered: ['Registered', 'quiet', 'The service registered this reminder. A delivery time is not confirmed yet.'],
    scheduled: ['Scheduled', 'good', 'The service confirmed a delivery time. This does not guarantee delivery.'],
    delivered: ['Delivered', 'good', 'The service reported delivery. This does not mean it was read.'],
    failed: ['Delivery failed', 'warning', 'The service reported a failure. Review notification settings, then refresh status.'],
    cancelled: ['Cancelled', 'quiet', 'The service cancelled this reminder. It is not scheduled.'],
    paused: ['Paused', 'quiet', 'The service paused this reminder. It is not scheduled.'],
    unknown: ['Status unknown', 'warning', 'The service could not confirm the current reminder state. Refresh before changing it again.'],
  } as const;
  const [label, tone, detail] = descriptions[evidence.status];
  return { label, tone, detail };
}
