/**
 * Luna acting in the app, through a review the person confirms (B20, Vibhav
 * 2026-10-25, superseding "Option A, Luna does not act" of 2026-10-18).
 *
 * Scope: My Week tasks only. Luna can prepare ONE change at a time: add a task
 * (title, optional date and time, optional estimate), move one to another date
 * or time, mark one complete or not done, or save one for later. Reminders are
 * out of scope and Luna never offers one.
 *
 * THE SHAPE OF IT
 *
 *   message  ->  the model is asked only what the message means, as JSON
 *                (lib/assistantRag.js composeTaskIntent, the person's own words
 *                and nothing else)
 *            ->  the server resolves dates and finds the task itself, against
 *                the household's own tasks (readActionsState)
 *            ->  a PROPOSAL, stored in luna_proposals (0035) and shown under
 *                Luna's answer. Nothing has changed.
 *   edit     ->  the person corrects a field; the proposal's revision rises
 *   cancel   ->  the proposal is cancelled; nothing changes
 *   confirm  ->  the proposal becomes an ordinary task command, committed by
 *                lib/actionsCommit.js inside an `actions` ledger claim: the same
 *                revision checks, ledger row and unknown-outcome reconciliation
 *                as a save in My Week. There is no second write path.
 *   status   ->  a confirm whose answer was lost is answered from the ledger.
 *
 * TWO DECISIONS HOLD, and this is how both are kept:
 *
 *   - Decision 2 (2026-10-19): no household data goes to the model provider.
 *     The intent call carries the person's message only: no history, no date,
 *     no task, no record. Tasks are read here and never leave HALO. Luna's own
 *     sentences for a proposal are fixed constants with no task content, so
 *     they are safe as history too. When a reference matches several tasks the
 *     choices carry titles, so a choice the person presses starts with
 *     LUNA_CHOICE_PREFIX and lib/luna.js never sends such a turn as history.
 *   - B09 C13: notes, journal entries and household members are never sent.
 *     This module does not read them at all.
 *
 * NOTHING CHANGES BEFORE CONFIRMATION, and Luna never says otherwise: every
 * sentence here says what was prepared, never that something was saved, until
 * the confirm's commit has succeeded.
 *
 * Behind HALO_FEATURE_LUNA_ACTIONS (`lunaActions`), off by default, which also
 * needs `luna` and `tasks` on and migration 0035. Off, or 0035 missing, Luna
 * behaves exactly as before and reads nothing here.
 */
import { featureDisabledReason, featureEnabled } from './features.js';
import { ACTIONS_DOMAIN, isActionsUnavailable, readActionsState } from './actionsStore.js';
import {
  ACTION_REFUSAL_MESSAGES,
  ACTION_REFUSAL_REASONS,
  actionDraftError,
  emptyWeekMeta,
  eventInstant,
  parseActionCommand,
  validActionDate,
} from './actionRules.js';
import { commitCommand, refusalBody } from './actionsCommit.js';
import { composeTaskIntent, noEmDash } from './assistantRag.js';
import { LUNA_CHOICE_PREFIX, recordAnswer, touchConversation } from './luna.js';
import { readOperation, runOperation } from './operations.js';

/** The capability name in lib/features.js. */
export const LUNA_ACTIONS_FEATURE = 'lunaActions';

/** What `luna.capabilities` reports in `tools` while the capability is on. */
export const LUNA_TOOLS = Object.freeze([
  'myWeek.task.create',
  'myWeek.task.reschedule',
  'myWeek.task.complete',
  'myWeek.task.reopen',
  'myWeek.task.saveForLater',
]);

/** A review can be confirmed for 30 minutes after Luna prepares it. */
export const PROPOSAL_TTL_MS = 30 * 60 * 1000;
/** A review's row is deleted one day after it expires. */
export const PROPOSAL_PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/** My Week's default zone (emptyWeekMeta.zone): where "today" and "Friday" are read. */
export const LUNA_ACTIONS_ZONE = emptyWeekMeta.zone;

/** The ledger kind of a confirm, in domain `actions`. */
export const CONFIRM_KIND = 'luna.confirm';
const EDIT_KIND = 'luna.proposal.edit';
const CANCEL_KIND = 'luna.proposal.cancel';
const LUNA_DOMAIN = 'luna';

/** The reason every task Luna adds carries, as the reviewed preview wrote it. */
export const LUNA_TASK_REASON = 'A task you requested and confirmed in Luna. It does not change environmental evidence.';
export const LUNA_TASK_ORIGIN = 'Luna';

/** True when Luna may prepare task changes: Luna, the capability and My Week's tasks all on. */
export function lunaActionsEnabled() {
  return featureEnabled('luna') && featureEnabled(LUNA_ACTIONS_FEATURE) && featureEnabled('tasks');
}

/** The sentence for a request refused because the capability is off. */
export const lunaActionsOffMessage = () => featureDisabledReason(LUNA_ACTIONS_FEATURE);

const MISSING = new Set(['PGRST205', '42P01', 'PGRST204', '42703']);
/** True when the error says migration 0035 is not applied. */
export const isProposalsMissing = (error) => !!error && MISSING.has(error.code);

/** Whether 0035 is applied, read as a head count scoped to the caller (nothing is read). */
export async function proposalsReady(supabase, profileId) {
  const { error } = await supabase
    .from('luna_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId);
  if (!error) return true;
  if (isProposalsMissing(error)) return false;
  throw error;
}

/** The capability is on and its table exists. Off reads nothing. */
export async function lunaActionsReady(supabase, profileId) {
  if (!lunaActionsEnabled()) return false;
  return proposalsReady(supabase, profileId);
}

// ---------------------------------------------------------------------------
// Copy. Every sentence can reach a screen: no em dash, no task content, and
// never a claim that something changed before a confirm succeeded.
// ---------------------------------------------------------------------------

export const LUNA_ACTION_COPY = Object.freeze({
  prepared: 'I prepared this change to My Week for you to review. Nothing changes until you confirm it.',
  choose: 'More than one task matches. Choose the one you mean. Nothing has changed.',
  notFound: 'I could not find a task in My Week that matches. Nothing has changed. Tell me the task\'s title as it appears in My Week, or open My Week to check it.',
  noReference: 'Which task do you mean? Tell me its title as it appears in My Week. Nothing has changed.',
  choiceClosed: 'That choice is no longer open, so nothing has changed. Tell me the task\'s title as it appears in My Week, or open My Week to check it.',
  noTitle: 'What should the task say? For example: add a task to test the kitchen tap on Friday. Nothing has changed.',
  alreadyComplete: 'That task is already complete, so nothing needs to change.',
  notComplete: 'That task is not marked complete, so there is nothing to reopen. Nothing has changed.',
  alreadyLater: 'That task has no date already, so it is saved for later. Nothing has changed.',
  paused: 'That task is paused or archived, so I cannot prepare a change to it. Open My Week to review it. Nothing has changed.',
  failed: 'I could not prepare that change just now. Nothing was changed. Try again in a moment, or open My Week and choose Add task.',
  tasksUnavailable: 'Tasks in My Week are not available yet, so I cannot prepare that change. Nothing was changed.',
  summary: 'Nothing changes in My Week until you confirm. Luna does not set reminders or send notifications.',
  dateUnclear: 'I could not tell which date you meant, so choose it below.',
  needsDate: 'Choose the new date below, then review the edited change.',
  timeDropped: 'A time needs a date, so no time was kept.',
});

/** The answer sentences for a confirm, a cancel or a status check. */
export const LUNA_RECEIPT_COPY = Object.freeze({
  review_gone: 'This review is no longer available. Nothing was changed. Ask Luna to prepare it again.',
  review_cancelled: 'This review was cancelled. Nothing was changed.',
  review_changed: 'This review changed. Check the latest version before confirming.',
  review_expired: 'This review expired. Nothing was changed. Ask Luna to prepare it again.',
  review_invalid: 'This review cannot be saved as it is. Nothing was changed. Edit it, or ask Luna again.',
  review_applied: 'This change was already confirmed and saved, so nothing was cancelled.',
  confirm_pending: 'A confirmation of this review is still being checked. Check its status first.',
  not_received: 'That confirmation did not reach HALO, so nothing was changed. You can confirm again.',
  not_finished: 'That confirmation did not finish, so nothing was changed. You can confirm again.',
  needs_date: 'Choose the new date in the review first. Nothing was changed.',
  task_changed: 'This task changed since Luna prepared the review. Nothing was changed. Ask Luna to prepare it again.',
  task_gone: 'This task is no longer in My Week. Nothing was changed.',
});

const TITLES = Object.freeze({
  create: 'Add a task to My Week',
  reschedule: 'Move a task in My Week',
  complete: 'Mark a task complete',
  reopen: 'Mark a task not done',
  later: 'Save a task for later',
});

// ---------------------------------------------------------------------------
// Pure helpers: today, dates, times, labels
// ---------------------------------------------------------------------------

/** The calendar date in `zone` at `now`, YYYY-MM-DD. */
export function localToday(now = new Date(), zone = LUNA_ACTIONS_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `day` plus `amount` days. Pure date arithmetic, at noon UTC so no clock change moves it. */
export function addDays(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function monthIndex(word) {
  const lower = word.toLowerCase().replace(/\.$/, '');
  const index = MONTHS.findIndex((month) => month === lower || (lower.length >= 3 && month.startsWith(lower) && (lower !== 'mar' || month === 'march')));
  return index;
}

function calendarDate(year, month, day) {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return validActionDate(value) && !value.startsWith('0000-') ? value : '';
}

/** A month and day with no year: this year, or next year once this year's has passed. */
function nextOccurrence(today, month, day) {
  const year = Number(today.slice(0, 4));
  const thisYear = calendarDate(year, month, day);
  if (thisYear && thisYear >= today) return thisYear;
  return calendarDate(year + 1, month, day);
}

/**
 * The date the person's own date words mean, read in My Week's zone.
 *
 * Returns `{ date, given, unclear }`: `given` when there were date words at
 * all, `unclear` when there were but they are not one certain date (then
 * `date` is '' and the review asks the person to choose). Conservative on
 * purpose: "next Friday" is read differently by different people, so it is
 * unclear rather than guessed. Pure.
 */
export function resolveDateWords(words, today) {
  const text = String(words ?? '').trim().toLowerCase().replace(/[,.]+$/g, '').replace(/\s+/g, ' ')
    .replace(/^(?:on|by|for|this coming|due|due on)\s+/, '');
  if (!text) return { date: '', given: false, unclear: false };
  const unclear = { date: '', given: true, unclear: true };
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? { date, given: true, unclear: false } : unclear;
  }
  if (/^(?:today|tonight|this evening|this afternoon|this morning)$/.test(text)) return { date: today, given: true, unclear: false };
  if (/^tomorrow(?: (?:morning|afternoon|evening|night))?$/.test(text)) return { date: addDays(today, 1), given: true, unclear: false };
  if (/^(?:the )?day after tomorrow$/.test(text)) return { date: addDays(today, 2), given: true, unclear: false };
  const inDays = text.match(/^in (\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (day|days|week|weeks)$/);
  if (inDays) {
    const count = /^\d+$/.test(inDays[1]) ? Number(inDays[1]) : NUMBER_WORDS[inDays[1]];
    const days = count * (inDays[2].startsWith('week') ? 7 : 1);
    return days >= 1 && days <= 366 ? { date: addDays(today, days), given: true, unclear: false } : unclear;
  }
  const weekday = text.match(/^(?:this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekday) {
    const current = new Date(`${today}T12:00:00Z`).getUTCDay();
    const delta = (WEEKDAYS.indexOf(weekday[1]) - current + 7) % 7;
    return { date: addDays(today, delta), given: true, unclear: false };
  }
  // "November 3", "Nov 3rd", "November 3 2026"
  const monthFirst = text.match(/^([a-z]{3,9}\.?) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/);
  if (monthFirst && monthIndex(monthFirst[1]) >= 0) {
    const month = monthIndex(monthFirst[1]) + 1;
    const date = monthFirst[3] ? calendarDate(Number(monthFirst[3]), month, Number(monthFirst[2])) : nextOccurrence(today, month, Number(monthFirst[2]));
    return date ? { date, given: true, unclear: false } : unclear;
  }
  // "3 November", "3rd of November 2026"
  const dayFirst = text.match(/^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]{3,9}\.?)(?: (\d{4}))?$/);
  if (dayFirst && monthIndex(dayFirst[2]) >= 0) {
    const month = monthIndex(dayFirst[2]) + 1;
    const date = dayFirst[3] ? calendarDate(Number(dayFirst[3]), month, Number(dayFirst[1])) : nextOccurrence(today, month, Number(dayFirst[1]));
    return date ? { date, given: true, unclear: false } : unclear;
  }
  // "11/3" or "11/3/2026": month first, as in the United States.
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (slash) {
    const date = slash[3] ? calendarDate(Number(slash[3]), Number(slash[1]), Number(slash[2])) : nextOccurrence(today, Number(slash[1]), Number(slash[2]));
    return date ? { date, given: true, unclear: false } : unclear;
  }
  return unclear;
}

/** A time of day as HH:MM on a 24-hour clock, from "14:30", "2:30 pm", "2pm" or "noon"; '' for none or junk. Pure. */
export function normalizeTime(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\./g, '');
  if (!text) return '';
  if (text === 'noon' || text === 'midday') return '12:00';
  if (text === 'midnight') return '00:00';
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (minute > 59) return '';
  if (match[3]) {
    if (hour < 1 || hour > 12) return '';
    if (match[3] === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (match[2] === undefined || hour > 23) {
    // A bare number is not a time ("3" could be anything); 24-hour needs minutes.
    return '';
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const DATE_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Friday, October 30, 2026", or '' for no date. */
export function dateLabel(date) {
  return date ? DATE_LABEL.format(new Date(`${date}T12:00:00Z`)) : '';
}

/** "3:00 PM" for "15:00" (the app's 12-hour style), or ''. */
export function timeLabel(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''));
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** When a task is: its date and time, or that it has none. */
export function whenLabel(date, time) {
  if (!date) return 'No date, saved for later';
  return time ? `${dateLabel(date)} at ${timeLabel(time)}` : dateLabel(date);
}

const STATE_LABELS = Object.freeze({ saved: 'To do', waiting: 'Waiting', completed: 'Completed' });

/**
 * A title as it may be stored and shown: control characters and an em dash
 * removed (the repository's rule for app-facing text), whitespace collapsed,
 * cut to My Week's 160 characters at a word.
 */
export function cleanTitle(value) {
  const text = noEmDash(String(value ?? ''))
    // C0 and C1 controls; the line and paragraph separators are whitespace to
    // `\s` below, so they collapse to a space there.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 160);
  const space = cut.lastIndexOf(' ');
  return (space > 80 ? cut.slice(0, space) : cut).trim();
}

// ---------------------------------------------------------------------------
// The intent the model returns
// ---------------------------------------------------------------------------

const INTENT_ACTIONS = new Set(['create', 'reschedule', 'complete', 'reopen', 'later', 'none']);

/**
 * The model's reply as a checked intent, or null when it is not one. The
 * reply is untrusted text: only these keys, only these types, only these
 * bounds, and anything else is a failure rather than a guess. Pure.
 */
export function parseTaskIntent(raw) {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!INTENT_ACTIONS.has(value.action)) return null;
  const string = (name, max) => {
    const item = value[name];
    if (item === undefined || item === null) return '';
    if (typeof item !== 'string' || item.length > max) return null;
    return item;
  };
  const title = string('title', 400);
  const task = string('task', 400);
  const date = string('date', 100);
  const time = string('time', 40);
  if ([title, task, date, time].some((item) => item === null)) return null;
  let minutes = value.minutes ?? null;
  if (minutes !== null && !(Number.isInteger(minutes) && minutes > 0 && minutes <= 10_080)) minutes = null;
  return { action: value.action, title, task, date, time, minutes };
}

// ---------------------------------------------------------------------------
// Finding the task, on the server, against the household's own tasks
// ---------------------------------------------------------------------------

const PRONOUN = /^(?:it|that|this|that one|this one|the last one|that task|this task|the task|the same task|same one)$/;
const BATCH = /^(?:all|every|everything|each|some|these|those|both|my tasks|all my tasks|all of them|tasks)\b/;

/** The person's words for a task, with the filler around a title removed. Pure. */
export function taskReference(value) {
  return String(value ?? '').trim().toLowerCase()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:the|my|a|our)\s+/, '')
    .replace(/^(?:task|to-?do|item)(?:\s+(?:called|named|titled))?\s*[:,-]?\s*/, '')
    .replace(/\s+(?:task|to-?do)$/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

/**
 * The tasks a reference can mean: an exact title, else every title holding
 * the reference, else every title holding all of its words. A pronoun means
 * the task the conversation last prepared a change to. A batch word means
 * nothing: one task at a time. Pure.
 */
export function matchTasks(actions, reference, { lastTaskId = null } = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const query = taskReference(reference);
  if (!query) return [];
  if (PRONOUN.test(query)) return lastTaskId ? list.filter((action) => action.id === lastTaskId) : [];
  if (BATCH.test(query)) return [];
  const title = (action) => String(action.title ?? '').trim().toLowerCase();
  const exact = list.filter((action) => title(action) === query);
  if (exact.length) return exact;
  const contains = list.filter((action) => title(action).includes(query));
  if (contains.length) return contains;
  const words = query.split(/[^a-z0-9']+/).filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'task'].includes(word));
  if (!words.length) return [];
  return list.filter((action) => words.every((word) => title(action).includes(word)));
}

const metaOf = (snapshot, action) => (Object.hasOwn(snapshot.metas ?? {}, action.key) ? snapshot.metas[action.key] : null);

/** Why one task cannot take this operation, as a reply, or null when it can. */
function ineligible(operation, action, meta) {
  const details = { ...emptyWeekMeta, ...(meta ?? {}) };
  if (details.paused || details.archived) return LUNA_ACTION_COPY.paused;
  if (operation === 'complete' && action.state === 'completed') return LUNA_ACTION_COPY.alreadyComplete;
  if (operation === 'reopen' && action.state !== 'completed') return LUNA_ACTION_COPY.notComplete;
  if (operation === 'later' && !action.date) return LUNA_ACTION_COPY.alreadyLater;
  return null;
}

/** The label of a choice: the prefix lib/luna.js keeps out of history, the title, and when it is. */
function choiceLabel(action, meta, used) {
  const time = meta?.time || '';
  let label = `${LUNA_CHOICE_PREFIX}${action.title}, ${action.state === 'completed' ? 'completed' : action.date ? whenLabel(action.date, time) : 'no date'}`;
  for (let n = 2; used.has(label); n += 1) label = `${label} (${n})`;
  used.add(label);
  return label;
}

/** The review of one existing task, as stored: what it was prepared against and what it shows. */
function taskPayload(action, meta) {
  return {
    taskId: action.id,
    taskKey: action.key,
    taskRevision: action.revision ?? 1,
    metaSignature: JSON.stringify(meta ?? null),
    title: action.title,
    date: action.date,
    time: meta?.time || '',
    state: action.state,
  };
}

/** The proposal for one resolved task and operation. */
function proposalFor(operation, action, meta, { newDate = '', newTime = '', dateUnclear = false } = {}) {
  const payload = taskPayload(action, meta);
  if (operation === 'reschedule') {
    // A new time alone keeps the task's date ("move it to 3 PM").
    const date = newDate || (newTime && !dateUnclear ? action.date : '');
    let time = date ? (newTime || payload.time) : '';
    if (time && !eventInstant(date, time, meta?.zone || LUNA_ACTIONS_ZONE)) {
      time = '';
      payload.note = 'timeDropped';
    }
    payload.newDate = date;
    payload.newTime = time;
    if (!date) payload.note = dateUnclear ? 'dateUnclear' : 'needsDate';
  }
  return { kind: operation, payload };
}

/**
 * What Luna answers for one intent against the household's snapshot: a reply,
 * and a proposal or a set of choices to store with it. Nothing is written
 * here and nothing here is ever sent to a model. Pure.
 *
 *   { reply }                                       a sentence only
 *   { reply, proposal: { kind, payload } }          a review to confirm
 *   { reply, proposal: { kind: 'choose', payload } } choices, when several tasks match
 */
export function planFromIntent({ intent, snapshot, today, lastTaskId = null }) {
  const time = normalizeTime(intent.time);
  const when = resolveDateWords(intent.date, today);
  if (intent.action === 'create') {
    const title = cleanTitle(intent.title);
    if (!title || actionDraftError(title, '')) return { reply: LUNA_ACTION_COPY.noTitle };
    const date = when.date;
    const keptTime = date && time && eventInstant(date, time, LUNA_ACTIONS_ZONE) ? time : '';
    const minutes = Number.isInteger(intent.minutes) && intent.minutes >= 15 && intent.minutes <= 1440 ? intent.minutes : null;
    const notes = [];
    if (when.unclear) notes.push('dateUnclear');
    if (time && !keptTime) notes.push('timeDropped');
    return { reply: LUNA_ACTION_COPY.prepared, proposal: { kind: 'create', payload: { title, date, time: keptTime, minutes, notes } } };
  }
  const operation = intent.action;
  if (!intent.task) return { reply: LUNA_ACTION_COPY.noReference };
  const actions = snapshot?.actions ?? [];
  const matches = matchTasks(actions, intent.task, { lastTaskId });
  if (!matches.length) return { reply: PRONOUN.test(taskReference(intent.task)) ? LUNA_ACTION_COPY.noReference : LUNA_ACTION_COPY.notFound };
  const eligible = matches.filter((action) => !ineligible(operation, action, metaOf(snapshot, action)));
  const newDate = operation === 'reschedule' ? when.date : '';
  const options = { newDate, newTime: time, dateUnclear: when.unclear };
  if (!eligible.length) return { reply: ineligible(operation, matches[0], metaOf(snapshot, matches[0])) };
  if (eligible.length === 1) {
    return { reply: LUNA_ACTION_COPY.prepared, proposal: proposalFor(operation, eligible[0], metaOf(snapshot, eligible[0]), options) };
  }
  const used = new Set();
  const candidates = eligible.slice(0, 8).map((action) => ({ taskId: action.id, label: choiceLabel(action, metaOf(snapshot, action), used) }));
  return {
    reply: LUNA_ACTION_COPY.choose,
    proposal: { kind: 'choose', payload: { operation, candidates, newDate, newTime: time, dateUnclear: when.unclear } },
  };
}

/** The proposal for the choice the person picked, against the current snapshot. Pure. */
export function planFromPick({ row, taskId, snapshot }) {
  const action = (snapshot?.actions ?? []).find((item) => item.id === taskId);
  if (!action) return { reply: LUNA_ACTION_COPY.notFound };
  const meta = metaOf(snapshot, action);
  const { operation, newDate = '', newTime = '', dateUnclear = false } = row.payload ?? {};
  const why = ineligible(operation, action, meta);
  if (why) return { reply: why };
  return { reply: LUNA_ACTION_COPY.prepared, proposal: proposalFor(operation, action, meta, { newDate, newTime, dateUnclear }) };
}

// ---------------------------------------------------------------------------
// The proposal as the client shows it (LunaProposal, luna-service.ts)
// ---------------------------------------------------------------------------

const iso = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date(0).toISOString();
};

/** True once a review can no longer be confirmed. */
export const proposalExpired = (row, now = Date.now()) => !(Date.parse(row?.expires_at) > now);

function changesFor(row) {
  const p = row.payload ?? {};
  switch (row.kind) {
    case 'create': {
      const rows = [
        { label: 'New task', before: '', after: p.title ?? '' },
        { label: 'When', before: '', after: whenLabel(p.date, p.time) },
      ];
      if (Number.isInteger(p.minutes)) rows.push({ label: 'Estimate', before: '', after: `${p.minutes} minutes` });
      return rows;
    }
    case 'reschedule':
      return [{ label: p.title ?? '', before: whenLabel(p.date, p.time), after: p.newDate ? whenLabel(p.newDate, p.newTime) : 'Choose a new date' }];
    case 'complete':
      return [{ label: p.title ?? '', before: STATE_LABELS[p.state] ?? 'To do', after: 'Completed' }];
    case 'reopen':
      return [{ label: p.title ?? '', before: 'Completed', after: 'To do' }];
    case 'later':
      return [{ label: p.title ?? '', before: whenLabel(p.date, p.time), after: 'No date, saved for later' }];
    default:
      return [];
  }
}

function fieldsFor(row) {
  const p = row.payload ?? {};
  if (row.kind === 'create') {
    return [
      { name: 'title', label: 'Task title', kind: 'text', value: p.title ?? '' },
      { name: 'date', label: 'Date (leave empty to save it for later)', kind: 'date', value: p.date ?? '' },
      { name: 'time', label: 'Time (optional, for example 2:30 PM)', kind: 'text', value: p.time ? timeLabel(p.time) : '' },
      { name: 'minutes', label: 'Estimate in minutes (optional)', kind: 'text', value: Number.isInteger(p.minutes) ? String(p.minutes) : '' },
    ];
  }
  if (row.kind === 'reschedule') {
    return [
      { name: 'date', label: 'New date', kind: 'date', value: p.newDate ?? '' },
      { name: 'time', label: 'Time (optional, for example 2:30 PM)', kind: 'text', value: p.newTime ? timeLabel(p.newTime) : '' },
    ];
  }
  return undefined;
}

function summaryFor(row) {
  const p = row.payload ?? {};
  const notes = [];
  const listed = Array.isArray(p.notes) ? p.notes : p.note ? [p.note] : [];
  for (const note of listed) if (LUNA_ACTION_COPY[note]) notes.push(LUNA_ACTION_COPY[note]);
  return [...notes, LUNA_ACTION_COPY.summary].join(' ');
}

/** One stored review as a `LunaProposal`. `applied` lets a caller show a ledger-confirmed success. */
export function toLunaProposal(row, { applied = false } = {}) {
  const proposal = {
    id: row.id,
    revision: row.revision,
    title: TITLES[row.kind] ?? 'Review a change',
    summary: summaryFor(row),
    destructive: false,
    expiresAt: iso(row.expires_at),
    status: applied ? 'applied' : row.status,
    changes: changesFor(row),
  };
  const fields = row.status === 'review' && !applied ? fieldsFor(row) : undefined;
  if (fields) proposal.fields = fields;
  if (row.operation_id) proposal.operationId = row.operation_id;
  return proposal;
}

// ---------------------------------------------------------------------------
// Storage (0035). Every statement is scoped to the verified owner.
// ---------------------------------------------------------------------------

const COLUMNS = 'id, profile_id, conversation_id, turn_id, reply_turn_id, kind, status, revision, payload, operation_id, expires_at, created_at, updated_at';

/** One review of this household's, or null. */
export async function readProposal(supabase, { profileId, id }) {
  const { data, error } = await supabase.from('luna_proposals').select(COLUMNS).eq('profile_id', profileId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Every review in this conversation, newest first. */
async function conversationProposals(supabase, { profileId, conversationId }) {
  const { data, error } = await supabase
    .from('luna_proposals')
    .select(COLUMNS)
    .eq('profile_id', profileId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data || [];
}

/** Delete this household's reviews that expired more than a day ago. */
export async function purgeExpiredProposals(supabase, { profileId, now = Date.now() }) {
  const cutoff = new Date(now - PROPOSAL_PURGE_AFTER_MS).toISOString();
  const { error } = await supabase.from('luna_proposals').delete().eq('profile_id', profileId).lt('expires_at', cutoff);
  if (error) throw error;
}

/**
 * Delete every review in a conversation the person just cleared. 0035's
 * cascade from luna_turns already does this in Postgres; saying it here too
 * means "clear" never depends on a cascade to stop a review being confirmed.
 * Nothing to do while 0035 is missing.
 */
export async function deleteConversationProposals(supabase, { profileId, conversationId }) {
  const { error } = await supabase.from('luna_proposals').delete().eq('profile_id', profileId).eq('conversation_id', conversationId);
  if (error && !isProposalsMissing(error)) throw error;
}

/** The daily cron's purge, for every household. Returns the count, or null while 0035 is missing. */
export async function purgeAllExpiredProposals(supabase, { now = Date.now() } = {}) {
  const cutoff = new Date(now - PROPOSAL_PURGE_AFTER_MS).toISOString();
  const { data, error } = await supabase.from('luna_proposals').delete().lt('expires_at', cutoff).select('id');
  if (error) {
    if (isProposalsMissing(error)) return null;
    throw error;
  }
  return (data || []).length;
}

async function insertProposal(supabase, { profileId, conversationId, turnId, proposal, now = Date.now() }) {
  const { data, error } = await supabase
    .from('luna_proposals')
    .insert({
      profile_id: profileId,
      conversation_id: conversationId,
      turn_id: turnId,
      kind: proposal.kind,
      status: 'review',
      revision: 1,
      payload: proposal.payload,
      expires_at: new Date(now + PROPOSAL_TTL_MS).toISOString(),
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** Compare and set on (id, owner, the expected status and revision); the updated row or null. */
async function updateProposal(supabase, { profileId, id, status = 'review', revision = null, values }) {
  let query = supabase
    .from('luna_proposals')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('id', id)
    .eq('status', status);
  if (revision !== null) query = query.eq('revision', revision);
  const { data, error } = await query.select(COLUMNS);
  if (error) throw error;
  return (data && data[0]) || null;
}

/** The task the conversation last prepared a change to, for "it" and "that". */
async function lastTaskId(supabase, { profileId, conversationId, snapshot }) {
  const rows = await conversationProposals(supabase, { profileId, conversationId });
  for (const row of rows) {
    if (row.payload?.taskId) return row.payload.taskId;
    if (row.kind === 'create' && row.status === 'applied') {
      const made = (snapshot?.actions ?? []).find((action) => action.key === createdKey(row.id));
      if (made) return made.id;
    }
  }
  return null;
}

/** The key a confirmed new task is saved under: one per review, so confirming twice adds it once. */
export const createdKey = (proposalId) => `luna:task:${proposalId}`;

// ---------------------------------------------------------------------------
// Preparing: from a message (the model's intent) or from a picked choice
// ---------------------------------------------------------------------------

/**
 * A first, cheap, deterministic look: could this message be asking to change
 * a task? Only then is the intent call made (it costs a provider request). A
 * question such as "how do I add a task?" may pass; the model then answers
 * "none" and the ordinary answer follows. Pure.
 */
export function looksLikeTaskRequest(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  const imperative = /^(?:(?:please|pls|luna|hey luna|ok|okay|can you|could you|would you|will you|i want to|i'd like to|i need to)[,\s]+)*(?:add|create|make|put|schedule|reschedule|move|push|postpone|bump|delay|complete|finish|mark|check off|tick off|cross off|reopen|re-open|undo|uncomplete|save|unschedule|remind me)\b/i;
  return imperative.test(value) || /\b(?:tasks?|to-?dos?|my week)\b/i.test(value);
}

/** Record Luna's answer, with its review attached before the run settles. */
async function recordPlan(supabase, { profileId, conversationId, runId, plan, now = Date.now() }) {
  if (plan.proposal) await purgeExpiredProposals(supabase, { profileId, now });
  return recordAnswer(supabase, {
    profileId,
    conversationId,
    runId,
    text: plan.reply,
    beforeSettle: plan.proposal
      ? (turnId) => insertProposal(supabase, { profileId, conversationId, turnId, proposal: plan.proposal, now })
      : null,
  });
}

/**
 * The scheduled half for a message that may ask for a task change. Returns
 * `{ handled: false }` when the model reads it as no task change (the
 * ordinary answer follows), else answers it here and returns `{ handled: true }`.
 *
 * What reaches the provider: `question`, the person's own message, inside the
 * intent prompt. Nothing else (no history, no date, no task).
 */
export async function prepareFromMessage(supabase, { profileId, conversationId, runId, question, apiKey, fetchImpl, now = Date.now() }) {
  let raw;
  try {
    raw = await composeTaskIntent({ question, apiKey, fetchImpl });
  } catch (error) {
    console.error(`luna task intent failed: ${failureShape(error)}`);
    await recordPlan(supabase, { profileId, conversationId, runId, plan: { reply: LUNA_ACTION_COPY.failed } });
    return { handled: true };
  }
  const intent = parseTaskIntent(raw);
  if (!intent) {
    console.error('luna task intent failed: unreadable reply');
    await recordPlan(supabase, { profileId, conversationId, runId, plan: { reply: LUNA_ACTION_COPY.failed } });
    return { handled: true };
  }
  if (intent.action === 'none') return { handled: false };

  let state;
  try {
    state = await readActionsState(supabase, profileId);
  } catch (error) {
    if (!isActionsUnavailable(error)) throw error;
    await recordPlan(supabase, { profileId, conversationId, runId, plan: { reply: LUNA_ACTION_COPY.tasksUnavailable } });
    return { handled: true };
  }
  const plan = planFromIntent({
    intent,
    snapshot: state.snapshot,
    today: localToday(new Date(now)),
    lastTaskId: await lastTaskId(supabase, { profileId, conversationId, snapshot: state.snapshot }),
  });
  await recordPlan(supabase, { profileId, conversationId, runId, plan, now });
  return { handled: true };
}

/** What a failed provider call looked like, for a log line: never the provider's own words. */
function failureShape(error) {
  if (Number.isInteger(error?.status)) return error.status === 0 ? 'empty reply' : `status ${error.status}`;
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'deadline' : String(error?.name || 'Error');
}

/**
 * The open choice this message picks, or null. A pick is the exact text of a
 * choice Luna offered in this conversation, on a review still open. It needs
 * no model at all.
 */
export async function findPick(supabase, { profileId, conversationId, text, now = Date.now() }) {
  const value = String(text ?? '');
  if (!conversationId || !value.startsWith(LUNA_CHOICE_PREFIX)) return null;
  const rows = await conversationProposals(supabase, { profileId, conversationId });
  for (const row of rows) {
    if (row.kind !== 'choose' || row.status !== 'review' || proposalExpired(row, now)) continue;
    const candidate = (row.payload?.candidates ?? []).find((item) => item.label === value);
    if (candidate) return { row, taskId: candidate.taskId };
  }
  return null;
}

/**
 * Answer a picked choice: the choice is used up (its row records the person's
 * turn), and the review for that one task is prepared. Synchronous: no model.
 */
export async function answerPick(supabase, { profileId, conversationId, runId, pick, replyTurnId, now = Date.now() }) {
  await updateProposal(supabase, {
    profileId,
    id: pick.row.id,
    status: 'review',
    values: { status: 'applied', reply_turn_id: replyTurnId },
  });
  let plan;
  try {
    const state = await readActionsState(supabase, profileId);
    plan = planFromPick({ row: pick.row, taskId: pick.taskId, snapshot: state.snapshot });
  } catch (error) {
    if (!isActionsUnavailable(error)) throw error;
    plan = { reply: LUNA_ACTION_COPY.tasksUnavailable };
  }
  return recordPlan(supabase, { profileId, conversationId, runId, plan, now });
}

// ---------------------------------------------------------------------------
// The conversation as the client sees it, with its reviews
// ---------------------------------------------------------------------------

/**
 * The conversation payload with each answer's review attached: a `proposal`,
 * or `choices` while a choice is open; and `unresolvedOperations` naming each
 * review whose confirm the ledger has not settled, so a reload parks it for a
 * status check. Returns the payload unchanged while the capability is off or
 * 0035 is missing. A succeeded confirm whose review row was not yet marked is
 * shown as applied, from the ledger, without writing anything here.
 */
export async function withProposals(supabase, { profileId, payload, now = Date.now() }) {
  if (!payload || !lunaActionsEnabled()) return payload;
  let rows;
  try {
    rows = await conversationProposals(supabase, { profileId, conversationId: payload.id });
  } catch (error) {
    if (isProposalsMissing(error)) return payload;
    throw error;
  }
  if (!rows.length) return payload;
  const byTurn = new Map(rows.map((row) => [row.turn_id, row]));
  const unresolved = { ...(payload.unresolvedOperations ?? {}) };
  const applied = new Set();
  for (const row of rows) {
    if (row.status !== 'review' || !row.operation_id || row.kind === 'choose') continue;
    const outcome = await readOperation(supabase, { operationId: row.operation_id, profileId, domain: ACTIONS_DOMAIN });
    if (!outcome) continue;
    if (outcome.status === 'succeeded') applied.add(row.id);
    else if (outcome.status === 'pending' || outcome.status === 'unknown') unresolved[row.id] = row.operation_id;
  }
  const messages = payload.messages.map((message) => {
    const row = message.role === 'assistant' ? byTurn.get(message.id) : null;
    if (!row) return message;
    if (row.kind === 'choose') {
      if (row.status !== 'review' || proposalExpired(row, now)) return message;
      const choices = (row.payload?.candidates ?? []).map((item) => item.label).filter((label) => typeof label === 'string' && label);
      return choices.length ? { ...message, choices } : message;
    }
    return { ...message, proposal: toLunaProposal(row, { applied: applied.has(row.id) }) };
  });
  return { ...payload, messages, unresolvedOperations: unresolved };
}

// ---------------------------------------------------------------------------
// Edit, cancel, confirm, status
// ---------------------------------------------------------------------------

const FIELD_NAMES = Object.freeze({ create: ['title', 'date', 'time', 'minutes'], reschedule: ['date', 'time'] });

/**
 * The edited payload for these fields, or `{ fieldErrors }`. Only the fields
 * the review offers, each checked with My Week's own rules. Pure.
 */
export function editedPayload(row, fields) {
  const allowed = FIELD_NAMES[row.kind] ?? [];
  const errors = [];
  const entries = Object.entries(fields ?? {});
  for (const [name, value] of entries) {
    if (!allowed.includes(name)) errors.push({ field: `fields.${name.slice(0, 40)}`, code: 'unknown_field', message: 'This review does not have that field.' });
    else if (typeof value !== 'string' || value.length > 3000) errors.push({ field: `fields.${name}`, code: 'invalid_text', message: 'Enter some text.' });
  }
  if (errors.length) return { fieldErrors: errors };
  const next = { ...(row.payload ?? {}) };
  const sent = Object.fromEntries(entries);
  const dateKey = row.kind === 'create' ? 'date' : 'newDate';
  const timeKey = row.kind === 'create' ? 'time' : 'newTime';
  if (sent.title !== undefined) {
    const title = cleanTitle(sent.title);
    if (!title || actionDraftError(title, '')) errors.push({ field: 'fields.title', code: 'invalid_title', message: 'Enter a title between 1 and 160 characters.' });
    next.title = title;
  }
  if (sent.date !== undefined) {
    const date = sent.date.trim();
    if (date && (!validActionDate(date) || date.startsWith('0000-'))) errors.push({ field: 'fields.date', code: 'invalid_date', message: 'Choose a valid calendar date.' });
    else if (!date && row.kind === 'reschedule') errors.push({ field: 'fields.date', code: 'date_required', message: 'Choose the new date for this task.' });
    next[dateKey] = date;
  }
  if (sent.time !== undefined) {
    const raw = sent.time.trim();
    const time = normalizeTime(raw);
    if (raw && !time) errors.push({ field: 'fields.time', code: 'invalid_time', message: 'Enter a time such as 2:30 PM, or leave it empty.' });
    next[timeKey] = time;
  }
  if (sent.minutes !== undefined) {
    const raw = sent.minutes.trim();
    const minutes = raw === '' ? null : Number(raw);
    if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440)) {
      errors.push({ field: 'fields.minutes', code: 'invalid_minutes', message: 'Choose a duration between 15 and 1440 minutes.' });
    }
    next.minutes = minutes;
  }
  if (!errors.length && next[timeKey]) {
    if (!next[dateKey]) errors.push({ field: 'fields.time', code: 'time_needs_date', message: 'A time needs a date. Choose a date, or clear the time.' });
    else if (!eventInstant(next[dateKey], next[timeKey], LUNA_ACTIONS_ZONE)) {
      errors.push({ field: 'fields.time', code: 'invalid_time', message: 'Choose a valid dated time outside clock-change gaps or ambiguous times.' });
    }
  }
  if (errors.length) return { fieldErrors: errors };
  delete next.notes;
  delete next.note;
  return { payload: next };
}

/**
 * Edit a review before confirming it. `{ proposal }` on success; otherwise
 * `{ status, reason }` (404 not this household's, 409 changed or no longer
 * open) or `{ fieldErrors }`. Through the `luna` ledger, so a replay of a lost
 * edit answers with the review as it is now rather than a conflict.
 */
export async function editProposal(supabase, { profileId, operationId, proposalId, revision, fields }) {
  const outcome = await runOperation(
    supabase,
    { operationId, profileId, domain: LUNA_DOMAIN, kind: EDIT_KIND, input: { proposalId, revision, fields } },
    async () => {
      const row = await readProposal(supabase, { profileId, id: proposalId });
      if (!row || row.kind === 'choose') return { status: 'failed', reason: 'review_gone' };
      if (row.revision !== revision) return { status: 'failed', reason: 'review_changed' };
      if (row.status !== 'review' || proposalExpired(row)) return { status: 'failed', reason: 'review_closed' };
      // A confirm still being checked, or one that succeeded, closes the review to edits.
      if (row.operation_id && await priorAttempt(supabase, { profileId, row, operationId: null })) {
        return { status: 'failed', reason: 'review_closed' };
      }
      const edited = editedPayload(row, fields);
      if (edited.fieldErrors) return { status: 'failed', reason: 'invalid_fields', fieldErrors: edited.fieldErrors.map(({ field, code }) => ({ field, code })) };
      const updated = await updateProposal(supabase, { profileId, id: row.id, revision, values: { payload: edited.payload, revision: revision + 1 } });
      if (!updated) return { status: 'failed', reason: 'review_changed' };
      return { status: 'succeeded', proposalId: row.id, revision: updated.revision };
    },
  );
  const result = outcome.result;
  if (!result) return { status: 409, reason: 'not_finished' };
  if (result.status === 'succeeded') {
    const row = await readProposal(supabase, { profileId, id: proposalId });
    if (!row) return { status: 404, reason: 'review_gone' };
    return { proposal: toLunaProposal(row) };
  }
  if (result.reason === 'invalid_fields') {
    // The stored receipt holds codes only; the sentences are rebuilt from the same rules.
    const row = await readProposal(supabase, { profileId, id: proposalId });
    const again = row ? editedPayload(row, fields) : null;
    return { fieldErrors: again?.fieldErrors ?? result.fieldErrors.map((item) => ({ ...item, message: 'Check this field.' })) };
  }
  return { status: result.reason === 'review_gone' ? 404 : 409, reason: result.reason };
}

/** The reason a failed confirm was answered with, as the sentence the person reads. */
export function receiptMessage(operationId, receipt) {
  const reason = receipt?.reason;
  if (LUNA_RECEIPT_COPY[reason]) return LUNA_RECEIPT_COPY[reason];
  if (reason === ACTION_REFUSAL_REASONS.STALE_REVISION || reason === ACTION_REFUSAL_REASONS.METADATA_CHANGED) return LUNA_RECEIPT_COPY.task_changed;
  if (reason === ACTION_REFUSAL_REASONS.UNKNOWN_ACTION) return LUNA_RECEIPT_COPY.task_gone;
  if (reason === ACTION_REFUSAL_REASONS.INVALID_RESULT) return `${refusalBody(operationId, receipt).message} Nothing was changed.`;
  if (reason === ACTION_REFUSAL_REASONS.BUSY) return ACTION_REFUSAL_MESSAGES.busy;
  return LUNA_RECEIPT_COPY.not_finished;
}

/** The planning details a review was prepared against, merged as My Week loads them. */
function preparedMeta(payload) {
  let stored = null;
  try {
    stored = JSON.parse(payload.metaSignature ?? 'null');
  } catch {
    stored = null;
  }
  return { stored, merged: { ...emptyWeekMeta, ...(stored && typeof stored === 'object' ? stored : {}) } };
}

/**
 * The ordinary task command a review becomes, as an `actions.commit` body
 * (lib/actionRules.js parseActionCommand checks it like any other). The
 * existing task's revision and planning-details signature are the ones the
 * review was prepared against, so the commit refuses if either moved.
 */
export function proposalCommandBody(row, { operationId, today }) {
  const p = row.payload ?? {};
  if (row.kind === 'create') {
    const key = createdKey(row.id);
    const meta = {
      ...emptyWeekMeta,
      time: p.time || '',
      duration: Number.isInteger(p.minutes) ? p.minutes : emptyWeekMeta.duration,
      estimateSet: Number.isInteger(p.minutes),
      history: [`${today}: Added by you after a Luna review.`],
    };
    return {
      operationId,
      kind: 'add',
      seeds: [{ key, title: p.title, reason: LUNA_TASK_REASON, origin: LUNA_TASK_ORIGIN }],
      date: p.date || '',
      metadata: { [key]: meta },
    };
  }
  const { stored, merged } = preparedMeta(p);
  const patch = { title: p.title, date: p.date, state: p.state };
  const meta = { ...merged, history: [...(Array.isArray(merged.history) ? merged.history : [])] };
  if (row.kind === 'reschedule') {
    patch.date = p.newDate;
    meta.time = p.newTime || '';
    meta.history.push(`${today}: Rescheduled by you after a Luna review.`);
  } else if (row.kind === 'complete') {
    patch.state = 'completed';
    meta.completedOn = today;
    meta.history.push(`${today}: Completed by you after a Luna review.`);
  } else if (row.kind === 'reopen') {
    patch.state = 'saved';
    meta.completedOn = '';
    meta.history.push(`${today}: Reopened by you after a Luna review.`);
  } else if (row.kind === 'later') {
    patch.date = '';
    meta.time = '';
    meta.reminder = false;
    meta.recurrence = 'none';
    meta.history.push(`${today}: Saved for later by you after a Luna review.`);
  }
  return {
    operationId,
    kind: 'revise',
    changes: [{ id: p.taskId, revision: p.taskRevision, patch }],
    expectedMetadata: { [p.taskKey]: JSON.stringify(stored) },
    metadata: { [p.taskKey]: meta },
  };
}

/** The ledger receipt of a review refused before anything was committed: a code only. */
const refused = (reason) => ({ status: 'failed', reason, unresolvedOperations: [] });

/**
 * Confirm a review: one claim in the `actions` ledger under the client's
 * operation id, inside which the review becomes a task command and is
 * committed by the one task write path. Returns `{ status, reason?, replayed }`
 * where status is the ledger's: 'succeeded', 'failed', 'pending' or 'unknown'.
 * Throws what the commit throws (the route answers 500, which the client
 * reconciles through `luna.operation`).
 */
export async function confirmProposal(supabase, { profileId, operationId, proposalId, revision, now = Date.now() }) {
  const outcome = await runOperation(
    supabase,
    { operationId, profileId, domain: ACTIONS_DOMAIN, kind: CONFIRM_KIND, input: { proposalId, revision } },
    async () => {
      const row = await readProposal(supabase, { profileId, id: proposalId });
      if (!row || row.kind === 'choose') return refused('review_gone');
      // Confirmed already, under another key: nothing more to do, and the
      // change the person asked for holds. Idempotent, with nothing written.
      if (row.status === 'applied') return { status: 'succeeded', affected: [], removed: [], unresolvedOperations: [] };
      if (row.status === 'cancelled') return refused('review_cancelled');
      if (row.revision !== revision) return refused('review_changed');
      if (proposalExpired(row, now)) return refused('review_expired');
      if (row.kind === 'reschedule' && !row.payload?.newDate) return refused('needs_date');
      // An earlier attempt under another key: still unsettled, it must finish
      // first; succeeded, the change holds and nothing more is written.
      const prior = await priorAttempt(supabase, { profileId, row, operationId });
      if (prior === 'pending') return refused('confirm_pending');
      if (prior === 'succeeded') {
        await markApplied(supabase, { profileId, proposalId: row.id, operationId: row.operation_id });
        return { status: 'succeeded', affected: [], removed: [], unresolvedOperations: [] };
      }
      // The review names this attempt before the commit, so a lost answer is
      // reconciled from this operation's ledger row.
      const stamped = await updateProposal(supabase, { profileId, id: row.id, revision, values: { operation_id: operationId } });
      if (!stamped) return refused('review_changed');
      const parsed = parseActionCommand(proposalCommandBody(row, { operationId, today: localToday(new Date(now)) }));
      if (!parsed.ok) return refused('review_invalid');
      const committed = await commitCommand(supabase, { profileId, operationId, command: parsed.command });
      return committed.receipt;
    },
  );
  if (!outcome.result) {
    if (outcome.status === 'failed') return { status: 'failed', reason: 'not_finished', replayed: outcome.replayed };
    return { status: outcome.status, replayed: outcome.replayed };
  }
  if (outcome.result.status === 'succeeded') await markApplied(supabase, { profileId, proposalId, operationId });
  return { status: outcome.result.status, reason: outcome.result.reason, receipt: outcome.result, replayed: outcome.replayed };
}

/**
 * What the review's last confirm attempt under ANOTHER key came to:
 * 'pending' (pending or unknown in the ledger), 'succeeded', or null (none,
 * or it failed, so a new attempt may go ahead).
 */
async function priorAttempt(supabase, { profileId, row, operationId }) {
  if (!row.operation_id || row.operation_id === operationId) return null;
  const found = await readOperation(supabase, { operationId: row.operation_id, profileId, domain: ACTIONS_DOMAIN });
  if (!found) return null;
  if (found.status === 'succeeded') return 'succeeded';
  if (found.status === 'pending' || found.status === 'unknown') return 'pending';
  return null;
}

/**
 * Mark a review applied after its confirm's commit succeeded, and raise the
 * conversation's revision so a reload shows it. Only a review that named this
 * very operation (or is already applied) is marked: a ledger success for some
 * other operation proves nothing about this review.
 */
async function markApplied(supabase, { profileId, proposalId, operationId }) {
  const row = await readProposal(supabase, { profileId, id: proposalId });
  if (!row || row.status !== 'review' || row.operation_id !== operationId) return;
  const updated = await updateProposal(supabase, { profileId, id: row.id, values: { status: 'applied' } });
  if (updated) await touchConversation(supabase, { profileId, conversationId: row.conversation_id });
}

/**
 * The outcome of a confirm whose answer the client never saw (`luna.operation`).
 *
 * The ledger is the authority. An id this household's ledger has never seen
 * is CLAIMED here as failed (`not_received`) with the very input a confirm of
 * this review would carry, so a confirm still in flight on that id can never
 * commit afterwards: it meets the settled row and replays "nothing changed".
 * Returns `{ status, reason? }`.
 */
export async function confirmOutcome(supabase, { profileId, operationId, proposalId, revision }) {
  let found = await readOperation(supabase, { operationId, profileId, domain: ACTIONS_DOMAIN });
  if (found && found.kind !== CONFIRM_KIND) return { status: 'failed', reason: 'review_gone' };
  if (!found) {
    const row = await readProposal(supabase, { profileId, id: proposalId });
    if (!row) return { status: 'failed', reason: 'review_gone' };
  }
  // An id never seen is claimed as failed. One already in the ledger is only
  // replayed, and the ledger's input check refuses (OPERATION_INPUT_MISMATCH,
  // the route's 409) a confirm id named beside another review or revision, so
  // one review's confirm is never reported as another's.
  await runOperation(
    supabase,
    { operationId, profileId, domain: ACTIONS_DOMAIN, kind: CONFIRM_KIND, input: { proposalId, revision } },
    async () => refused('not_received'),
  );
  if (!found) {
    found = await readOperation(supabase, { operationId, profileId, domain: ACTIONS_DOMAIN });
    if (!found) return { status: 'unknown' };
  }
  if (found.kind !== CONFIRM_KIND) return { status: 'failed', reason: 'review_gone' };
  if (found.status === 'succeeded') {
    await markApplied(supabase, { profileId, proposalId, operationId });
    return { status: 'succeeded' };
  }
  if (found.status === 'failed') {
    return { status: 'failed', reason: found.result?.reason ?? 'not_finished', receipt: found.result };
  }
  return { status: found.status };
}

/**
 * Cancel a review. Through the `luna` ledger. Returns `{ status, reason? }`:
 * 'cancelled' (now or already), or 'failed' with why.
 */
export async function cancelProposal(supabase, { profileId, operationId, proposalId, revision }) {
  const outcome = await runOperation(
    supabase,
    { operationId, profileId, domain: LUNA_DOMAIN, kind: CANCEL_KIND, input: { proposalId, revision } },
    async () => {
      const row = await readProposal(supabase, { profileId, id: proposalId });
      if (!row) return { status: 'failed', reason: 'review_gone' };
      if (row.status === 'cancelled') return { status: 'cancelled' };
      if (row.status === 'applied') return { status: 'failed', reason: 'review_applied' };
      if (row.revision !== revision) return { status: 'failed', reason: 'review_changed' };
      if (row.operation_id) {
        const pending = await readOperation(supabase, { operationId: row.operation_id, profileId, domain: ACTIONS_DOMAIN });
        if (pending?.status === 'succeeded') return { status: 'failed', reason: 'review_applied' };
        if (pending && (pending.status === 'pending' || pending.status === 'unknown')) return { status: 'failed', reason: 'confirm_pending' };
      }
      const updated = await updateProposal(supabase, { profileId, id: row.id, revision, values: { status: 'cancelled' } });
      if (!updated) return { status: 'failed', reason: 'review_changed' };
      await touchConversation(supabase, { profileId, conversationId: row.conversation_id });
      return { status: 'cancelled' };
    },
  );
  if (!outcome.result) return { status: outcome.status === 'failed' ? 'failed' : outcome.status, reason: 'not_finished' };
  return { status: outcome.result.status, reason: outcome.result.reason };
}
