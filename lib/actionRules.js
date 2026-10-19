/**
 * My Week's action rules on the server, and the command planner (B06 H15).
 *
 * Two halves.
 *
 * 1. THE CLIENT'S OWN RULES, TRANSCRIBED. Every function in the first half is a
 *    JavaScript transcription, types stripped and nothing else changed, of the
 *    frontend on `origin/codex/october15-review-refinement` (F:, read with
 *    `git show`; the files are not checked out here). Each carries its source
 *    line range. The server runs them because the client rejects a whole
 *    snapshot for one bad row (trap T5), so anything the server stores must pass
 *    exactly the check the client will run on it. Do not "fix" them: a stricter
 *    or looser rule here is a disagreement with the screen. Node's ICU and a
 *    browser's can still disagree on a time zone (digest 9.5); that residual is
 *    recorded, not solved. Two edits only, neither changing a result:
 *    `emptyWeekMeta` is frozen, so no server caller can change the defaults the
 *    validator merges in; and the type-only imports are gone.
 *
 * 2. THE PLANNER. `parseActionCommand(body)` decides everything that needs no
 *    stored state (a 400, before the ledger claim, H11). `planActionCommand(
 *    snapshot, command)` applies a parsed command to the household's current
 *    snapshot in the reference order (signatures, kind, metadata, preferences;
 *    F: action-service.ts:58-82), then validates the WHOLE resulting snapshot
 *    with the client's `validActionSnapshot` before anything is written (trap
 *    T5, H10). Where it differs from the reference adapter
 *    (`applyReviewActionCommand`, F: action-service.ts:56-83) it does so by a
 *    named ruling, and test/actionRules.test.mjs asserts each by name:
 *
 *      H12  `expectedMetadata` is parsed and compared by value with `sameValue`,
 *           not by bytes, because jsonb reorders keys.
 *      H13  Exact echo: a new action is exactly {id, key, title, reason, origin,
 *           date, state, revision}; seed extras and `seed.date` are ignored.
 *           Values storage cannot hold are 400s: U+0000 or a lone surrogate in
 *           any stored string, a non-finite number, a year-0000 `date` or
 *           `completedOn`.
 *      H14  `clear` is a 400; duplicate seed keys are a 400; an add of a key
 *           already stored is a no-op for that seed and every metadata entry for
 *           that key (null included) is ignored; a delete of an id the household
 *           has no row for succeeds with nothing written; `initialStates` is
 *           accepted on every kind and applied only on add.
 *      T5   the resulting snapshot must pass `validActionSnapshot`, merged with
 *           `emptyWeekMeta`, or the command is refused as `invalid_result` with
 *           the client's own message for the failing pair,
 *      H25  amended: but only for a failure the command ADDS. A row or a
 *           preference that already failed in the stored snapshot (H24, a time
 *           zone Node's ICU rejects and the browser accepts) and that the command
 *           leaves exactly as it was does not block an unrelated save. A command
 *           that touches such a row and leaves it failing is refused; one that
 *           fixes or deletes it succeeds. The message is the new failure's.
 *      H26  any stored value, or signature, nested deeper than 32 is a 400, so a
 *           crafted body is refused rather than overflowing the stack.
 *      H27  the body `operationId` is a UUID, lowercased and not trimmed (the
 *           house rule, app/api/account/commands/route.js:685-687).
 *
 * Pure module: no database, no network, no clock. The only non-deterministic
 * input is the id for a new action, taken from `options.newId` (by default
 * `crypto.randomUUID`), so tests inject their own.
 *
 * Every server-authored string here is plain app copy with no U+2014 (AGENTS.md,
 * H22). Text a person typed is echoed exactly and never rewritten.
 */

// ---------------------------------------------------------------------------
// Part 1. The client's rules, transcribed.
// ---------------------------------------------------------------------------

// F: lib/frontend/expanded-preview.ts:30-35
export function validActionDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
// F: lib/frontend/expanded-preview.ts:36-40
export function actionDraftError(title, date) {
  if (!title.trim() || title.trim().length > 160) return 'Enter a title between 1 and 160 characters.';
  if (!validActionDate(date)) return 'Choose a valid calendar date.';
  return null;
}

// F: lib/frontend/expanded-preview.ts:43-48
/** Validate the whole captured review before replacing any canonical action. */
export function revisedActionBatch(actions,changes) {
  if(new Set(changes.map(c=>c.id)).size!==changes.length)return null;
  for(const c of changes){const a=actions.find(a=>a.id===c.id);if(!a||(a.revision??1)!==c.revision||actionDraftError(c.patch.title,c.patch.date)||!['saved','waiting','completed'].includes(c.patch.state))return null;}
  return actions.map(a=>{const c=changes.find(c=>c.id===a.id);return c?{...a,...c.patch,title:c.patch.title.trim(),revision:c.revision+1}:a;});
}

// F: lib/frontend/week-preview.ts:4
export const emptyWeekMeta = { note:'', paused:false, archived:false, completedOn:'', time:'', duration:60, zone:'America/New_York', recurrence:'none', reminder:false, history:[] };
Object.freeze(emptyWeekMeta.history);
Object.freeze(emptyWeekMeta);

// F: lib/frontend/week-preview.ts:10-16
/** Resolve wall-clock time explicitly. Reject nonexistent or ambiguous DST instants. */
export function eventInstant(day,time,zone) {
  if (!day || !validActionDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  try {const target=`${day}T${time}`; const base=Date.parse(`${target}:00Z`);const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});const matches=[];
    for(let offset=-14*60;offset<=14*60;offset+=15){const instant=new Date(base+offset*60000);const p=fmt.formatToParts(instant);const get=(type)=>p.find(x=>x.type===type)?.value; if(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`===target) matches.push(instant.toISOString());}return matches.length===1?matches[0]:null;
  }catch{return null;}
}

// F: lib/frontend/date-input.ts:2-10
export function parseCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

// F: lib/frontend/week-reminders.ts:21-38
const instant = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(value) && !!parseCalendarDate(value.slice(0,10)) && Number.isFinite(Date.parse(value));
export function validReminderStates(value, actions) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actionIds = new Set(actions.map(action => action.id));
  return Object.entries(value).every(([id, candidate]) => {
    if (!actionIds.has(id) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const state = candidate;
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

// F: lib/frontend/production/action-service.ts:27-36
export function actionMetadataError(meta, action) {
  if (!meta || typeof meta !== 'object' || typeof meta.time !== 'string' || typeof meta.completedOn !== 'string' || typeof meta.zone !== 'string' || [meta.paused,meta.archived,meta.reminder].some(value=>typeof value!=='boolean') || meta.estimateSet!==undefined&&typeof meta.estimateSet!=='boolean') return 'The task schedule is invalid.';
  if (typeof meta.note !== 'string' || meta.note.length > 3000 || !Array.isArray(meta.history) || meta.history.some(line => typeof line !== 'string')) return 'The task details are invalid.';
  if (!Number.isInteger(meta.duration) || meta.duration < 15 || meta.duration > 1440) return 'Choose a duration between 15 and 1440 minutes.';
  try { new Intl.DateTimeFormat('en', { timeZone: meta.zone }); } catch { return 'Choose a valid timezone.'; }
  if (meta.time && !eventInstant(action.date, meta.time, meta.zone)) return 'Choose a valid dated time outside clock-change gaps or ambiguous times.';
  if (!['none', 'weekly', 'after-completion'].includes(meta.recurrence) || meta.recurrence !== 'none' && (!action.date || meta.time)) return 'Repeating tasks need an all-day date.';
  if (meta.completedOn && actionDraftError('Completion', meta.completedOn)) return 'The completion date is invalid.';
  return null;
}

// F: lib/frontend/production/action-service.ts:38-53
const object=(value)=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=500)=>typeof value==='string'&&value.length<=max;
function validZone(value){if(!text(value,100)||!value)return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}
/** Server preferences may update only the known durable draft namespaces. */
export function validActionPreferences(value){
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

// F: lib/frontend/production/action-service.ts:85-99
/** Reject malformed adapter data before it can erase or falsely complete work. */
export function validActionSnapshot(value) {
  if (!value || typeof value !== 'object') return false;
  const data = value;
  if(data.preferences!==undefined&&!validActionPreferences(data.preferences))return false;
  if(data.unresolvedOperations!==undefined&&(!Array.isArray(data.unresolvedOperations)||data.unresolvedOperations.length>100||data.unresolvedOperations.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(data.unresolvedOperations).size!==data.unresolvedOperations.length))return false;
  if (!Array.isArray(data.actions) || !data.metas || typeof data.metas !== 'object' || Array.isArray(data.metas)) return false;
  const ids = new Set(), keys = new Set();
  for (const action of data.actions) {
    if (!action || typeof action.id !== 'string' || !action.id || typeof action.key !== 'string' || !action.key || ids.has(action.id) || keys.has(action.key) || typeof action.title !== 'string' || typeof action.date !== 'string' || actionDraftError(action.title, action.date) || !['saved', 'waiting', 'completed'].includes(action.state) || !Number.isInteger(action.revision) || (action.revision ?? 0) < 1 || typeof action.reason !== 'string' || typeof action.origin !== 'string') return false;
    ids.add(action.id); keys.add(action.key);
    if (data.metas[action.key] && actionMetadataError({ ...emptyWeekMeta, ...data.metas[action.key] }, action)) return false;
  }
  return Object.keys(data.metas).every(key => keys.has(key)) && (data.reminderStates === undefined || validReminderStates(data.reminderStates, data.actions));
}

// F: lib/frontend/production/action-service.ts:101-102
/** A valid unrelated snapshot is not proof that the user's command succeeded. */
export function sameValue(a,b){if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const left=Object.keys(a),right=Object.keys(b);return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&sameValue(a[key],b[key]));}

// ---------------------------------------------------------------------------
// Part 2. The server's planner. Not a transcription.
// ---------------------------------------------------------------------------

/** The three task states the client accepts (C5, T15). */
export const ACTION_STATES = Object.freeze(['saved', 'waiting', 'completed']);

/** The command kinds this server accepts (H14). `clear` is refused. */
export const ACTION_COMMAND_KINDS = Object.freeze(['add', 'revise', 'delete']);

const COMMON_KEYS = Object.freeze(['operationId', 'kind', 'metadata', 'expectedMetadata', 'preferences', 'initialStates']);
const KIND_KEYS = Object.freeze({
  add: Object.freeze(['seeds', 'date']),
  revise: Object.freeze(['changes']),
  delete: Object.freeze(['id', 'revision']),
});
const CHANGE_KEYS = Object.freeze(['id', 'revision', 'patch']);
const PATCH_KEYS = Object.freeze(['title', 'date', 'state']);

/**
 * Why the planner refused a command against stored state (H11's 200 receipt).
 * `busy` is the route's own (H10, after its third lost race); it is listed so
 * the route and the planner share one message table.
 */
export const ACTION_REFUSAL_REASONS = Object.freeze({
  METADATA_CHANGED: 'metadata_changed',
  STALE_REVISION: 'stale_revision',
  UNKNOWN_ACTION: 'unknown_action',
  INVALID_RESULT: 'invalid_result',
  BUSY: 'busy',
});

/**
 * The message shown, verbatim, for each refusal (F: ExpandedPreviewState.tsx:93).
 * A refusal does not reload My Week (finding F4), so each one says to reload.
 * `invalid_result` carries the client's own sentence for the failing pair
 * instead, when one applies; this is its fallback.
 */
export const ACTION_REFUSAL_MESSAGES = Object.freeze({
  metadata_changed: 'This task\'s details changed since you opened them. Nothing was saved. Reload My Week to see the latest version.',
  stale_revision: 'This task changed since you opened it. Nothing was saved. Reload My Week to see the latest version.',
  unknown_action: 'This task is no longer in My Week. Nothing was saved. Reload My Week to see your current tasks.',
  invalid_result: 'This change would leave My Week unable to load. Nothing was saved.',
  busy: 'My Week is busy with another save. Nothing was saved. Try again in a moment.',
});

const FIELD_ERRORS_MAX = 50;
const FIELD_ECHO_MAX = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const MESSAGES = Object.freeze({
  invalid_body: 'Send the command as a JSON object.',
  invalid_operation_id: 'operationId must be the UUID sent as the Idempotency-Key.',
  unsupported_kind: 'Clearing every task is not supported by this command. Nothing was changed.',
  invalid_kind: 'kind must be add, revise or delete.',
  unknown_field: 'This field is not part of a task command.',
  seeds_required: 'Send at least one task to add.',
  invalid_seed: 'Each task to add needs a key, title, reason and origin as text.',
  invalid_key: 'Each task needs a key that is not empty.',
  invalid_date: 'Choose a valid calendar date.',
  duplicate_seed_key: 'Each task in one save needs its own key.',
  invalid_changes: 'changes must be a list, which may be empty.',
  invalid_change: 'Each change needs an id, a revision and a patch with a title, date and state.',
  invalid_id: 'Send the id of the task as text that is not empty.',
  invalid_revision: 'revision must be a whole number of 1 or more.',
  invalid_state: 'A task state must be saved, waiting or completed.',
  duplicate_change_id: 'Each task can be changed only once in one save.',
  invalid_metadata: 'Task details must be an object, or null to remove them.',
  invalid_signature: 'Each expectedMetadata value must be the JSON text of the details you last loaded.',
  invalid_preferences: 'preferences must be an object.',
  invalid_preference: 'This preference cannot be saved in that form.',
  invalid_initial_states: 'initialStates must map task keys to saved, waiting or completed.',
  unstorable_text: 'This text contains a character that cannot be saved. Remove it and try again.',
  unstorable_number: 'This number is too large to save.',
  unstorable_date: 'Choose a date in the year 1 or later.',
  unstorable_depth: 'This value is nested too deeply to save.',
});

function fieldError(field, code, message = MESSAGES[code]) {
  return { field, code, message };
}

function echo(key) {
  return Array.from(String(key)).slice(0, FIELD_ECHO_MAX).join('');
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The deepest nesting a stored value may have (H26). An object or array is one
 * level, each container inside it one more. Every value the client sends is at
 * most 3 deep (a meta's `history`, an `outdoorPlan`, `week:availability`), so
 * this cap refuses no caller (H23); it exists so a crafted body gets a 400
 * instead of a stack overflow in `sameValue`, `structuredClone` or Postgres.
 */
export const STORED_DEPTH_MAX = 32;

/**
 * The first part of `value` that storage cannot hold exactly (H13, H26), or
 * null. Walks arrays and objects, keys included, without recursion, so a
 * deeply nested value cannot overflow the stack here.
 * @returns {null | 'unstorable_text' | 'unstorable_number' | 'unstorable_depth'}
 */
export function unstorableValue(value) {
  const stack = [[value, 0]];
  while (stack.length) {
    const [item, outer] = stack.pop();
    if (typeof item === 'string') {
      if (item.includes('\u0000') || LONE_SURROGATE.test(item)) return 'unstorable_text';
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) return 'unstorable_number';
    } else if (item && typeof item === 'object') {
      const depth = outer + 1;
      if (depth > STORED_DEPTH_MAX) return 'unstorable_depth';
      if (Array.isArray(item)) for (const entry of item) stack.push([entry, depth]);
      else for (const [key, entry] of Object.entries(item)) stack.push([key, depth], [entry, depth]);
    }
  }
  return null;
}

/** A calendar date the client accepts but a Postgres `date` cannot hold (H13). */
function yearZero(value) {
  return typeof value === 'string' && value.startsWith('0000-');
}

function entriesOf(body, name, errors) {
  const value = body[name];
  if (value === undefined || value === null) return [];
  if (!plainObject(value)) {
    errors.push(fieldError(name, name === 'preferences' ? 'invalid_preferences' : name === 'initialStates' ? 'invalid_initial_states' : name === 'metadata' ? 'invalid_metadata' : 'invalid_signature'));
    return [];
  }
  return Object.entries(value);
}

function checkStorable(field, value, errors) {
  const code = unstorableValue(value);
  if (code) errors.push(fieldError(field, code));
  return !code;
}

function parseSeeds(body, errors) {
  const date = body.date;
  if (typeof date !== 'string' || !validActionDate(date)) errors.push(fieldError('date', 'invalid_date'));
  else if (yearZero(date)) errors.push(fieldError('date', 'unstorable_date'));
  const seeds = body.seeds;
  if (!Array.isArray(seeds) || seeds.length === 0) {
    errors.push(fieldError('seeds', 'seeds_required'));
    return null;
  }
  const out = [];
  const keys = new Set();
  seeds.forEach((seed, index) => {
    const at = `seeds.${index}`;
    if (!plainObject(seed) || ['key', 'title', 'reason', 'origin'].some((name) => typeof seed[name] !== 'string')) {
      errors.push(fieldError(at, 'invalid_seed'));
      return;
    }
    if (!seed.key) errors.push(fieldError(`${at}.key`, 'invalid_key'));
    else if (keys.has(seed.key)) errors.push(fieldError(`${at}.key`, 'duplicate_seed_key'));
    keys.add(seed.key);
    // The reference's own check (F: action-service.ts:61), split so each half
    // is reported on its own field: '' is always a valid date, so this call can
    // only fail on the title, and `date` was checked once above.
    const draft = actionDraftError(seed.title, '');
    if (draft) errors.push(fieldError(`${at}.title`, 'invalid_title', draft));
    // Only these four are stored; any other seed field is ignored (H13).
    const kept = { key: seed.key, title: seed.title, reason: seed.reason, origin: seed.origin };
    checkStorable(at, kept, errors);
    out.push(kept);
  });
  return { seeds: out, date };
}

function parseChanges(body, errors) {
  const changes = body.changes;
  if (!Array.isArray(changes)) {
    errors.push(fieldError('changes', 'invalid_changes'));
    return null;
  }
  const out = [];
  const ids = new Set();
  changes.forEach((change, index) => {
    const at = `changes.${index}`;
    if (!plainObject(change) || !plainObject(change.patch)) {
      errors.push(fieldError(at, 'invalid_change'));
      return;
    }
    for (const key of Object.keys(change)) if (!CHANGE_KEYS.includes(key)) errors.push(fieldError(`${at}.${echo(key)}`, 'unknown_field'));
    for (const key of Object.keys(change.patch)) if (!PATCH_KEYS.includes(key)) errors.push(fieldError(`${at}.patch.${echo(key)}`, 'unknown_field'));
    const { id, revision, patch } = change;
    if (typeof id !== 'string' || !id) errors.push(fieldError(`${at}.id`, 'invalid_id'));
    else if (ids.has(id)) errors.push(fieldError(`${at}.id`, 'duplicate_change_id'));
    ids.add(id);
    if (!Number.isInteger(revision) || revision < 1) errors.push(fieldError(`${at}.revision`, 'invalid_revision'));
    if (typeof patch.title !== 'string' || typeof patch.date !== 'string') {
      errors.push(fieldError(`${at}.patch`, 'invalid_change'));
      return;
    }
    // The reference's own check (F: expanded-preview.ts:46), split by field as
    // for seeds: `actionDraftError(title, date)` fails exactly when one of
    // these two does.
    const draft = actionDraftError(patch.title, '');
    if (draft) errors.push(fieldError(`${at}.patch.title`, 'invalid_title', draft));
    if (!validActionDate(patch.date)) errors.push(fieldError(`${at}.patch.date`, 'invalid_date'));
    else if (yearZero(patch.date)) errors.push(fieldError(`${at}.patch.date`, 'unstorable_date'));
    if (!ACTION_STATES.includes(patch.state)) errors.push(fieldError(`${at}.patch.state`, 'invalid_state'));
    checkStorable(`${at}.patch.title`, patch.title, errors);
    out.push({ id, revision, patch: { title: patch.title, date: patch.date, state: patch.state } });
  });
  return { changes: out };
}

/**
 * Everything about an `actions.commit` body that needs no stored state (H11's
 * 400s, H13, H14, H21's key rules). The command it returns holds only what the
 * planner reads: seeds cut to their four stored fields, signatures already
 * parsed, and the four option maps as Maps (so no key can reach a prototype).
 *
 * @param {unknown} body the parsed JSON body
 * @returns {{ ok: true, command: object } | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseActionCommand(body) {
  if (!plainObject(body)) return { ok: false, fieldErrors: [fieldError('body', 'invalid_body')] };
  const errors = [];

  // The house rule (H27; parseUuid, app/api/account/commands/route.js:685-687):
  // a UUID exactly as sent, lowercased, never trimmed. Only the header is trimmed.
  const operationId = typeof body.operationId === 'string' && UUID.test(body.operationId) ? body.operationId.toLowerCase() : null;
  if (!operationId) errors.push(fieldError('operationId', 'invalid_operation_id'));

  const kind = body.kind;
  const known = ACTION_COMMAND_KINDS.includes(kind);
  if (kind === 'clear') errors.push(fieldError('kind', 'unsupported_kind'));
  else if (!known) errors.push(fieldError('kind', 'invalid_kind'));

  // With a kind this server takes, only that kind's own fields; otherwise only
  // fields no kind takes, so a bad kind is not also reported as ten bad fields.
  const allowed = known
    ? [...COMMON_KEYS, ...KIND_KEYS[kind]]
    : [...COMMON_KEYS, ...Object.values(KIND_KEYS).flat(), 'fingerprint'];
  for (const key of Object.keys(body).filter((name) => !allowed.includes(name)).sort()) {
    errors.push(fieldError(echo(key), 'unknown_field'));
  }

  let shape = null;
  if (kind === 'add') shape = parseSeeds(body, errors);
  else if (kind === 'revise') shape = parseChanges(body, errors);
  else if (kind === 'delete') {
    if (typeof body.id !== 'string' || !body.id) errors.push(fieldError('id', 'invalid_id'));
    if (!Number.isInteger(body.revision) || body.revision < 1) errors.push(fieldError('revision', 'invalid_revision'));
    shape = { id: body.id, revision: body.revision };
  }

  const metadata = new Map();
  for (const [key, meta] of entriesOf(body, 'metadata', errors)) {
    const at = `metadata.${echo(key)}`;
    if (meta !== null && !plainObject(meta)) {
      errors.push(fieldError(at, 'invalid_metadata'));
      continue;
    }
    if (!checkStorable(at, key, errors) || !checkStorable(at, meta, errors)) continue;
    if (meta && yearZero(meta.completedOn)) {
      errors.push(fieldError(`${at}.completedOn`, 'unstorable_date'));
      continue;
    }
    metadata.set(key, meta);
  }

  const expectedMetadata = new Map();
  for (const [key, signature] of entriesOf(body, 'expectedMetadata', errors)) {
    let parsed;
    try {
      if (typeof signature !== 'string') throw new TypeError('not text');
      parsed = JSON.parse(signature);
      // A signature is the text of a stored meta, which is never deeper than
      // the cap (H26); a deeper one is malformed, and `sameValue` recurses.
      if (unstorableValue(parsed) === 'unstorable_depth') throw new RangeError('too deep');
    } catch {
      errors.push(fieldError(`expectedMetadata.${echo(key)}`, 'invalid_signature'));
      continue;
    }
    expectedMetadata.set(key, parsed);
  }

  const preferences = new Map();
  for (const [key, value] of entriesOf(body, 'preferences', errors)) {
    const at = `preferences.${echo(key)}`;
    if (!validActionPreferences({ [key]: value })) {
      errors.push(fieldError(at, 'invalid_preference'));
      continue;
    }
    if (checkStorable(at, value, errors)) preferences.set(key, value);
  }

  const initialStates = new Map();
  for (const [key, state] of entriesOf(body, 'initialStates', errors)) {
    if (!ACTION_STATES.includes(state)) errors.push(fieldError(`initialStates.${echo(key)}`, 'invalid_initial_states'));
    else initialStates.set(key, state);
  }

  if (errors.length > 0) return { ok: false, fieldErrors: errors.slice(0, FIELD_ERRORS_MAX) };
  return { ok: true, command: { operationId, kind, ...shape, metadata, expectedMetadata, preferences, initialStates } };
}

function refuse(reason, message = ACTION_REFUSAL_MESSAGES[reason], extra = {}) {
  return { ok: false, reason, message, ...extra };
}

const ownMeta = (metas, key) => (Object.hasOwn(metas, key) ? metas[key] : null);

/**
 * Why one action and its meta fail the client's load check, or null. The check
 * is `validActionSnapshot` itself on a one-row snapshot, so it is exactly the
 * client's; the sentence is the client's for that pair, or the fallback.
 */
function pairError(action, meta) {
  if (validActionSnapshot({ actions: [action], metas: meta ? { [action.key]: meta } : {} })) return null;
  const draft = typeof action?.title === 'string' && typeof action.date === 'string' ? actionDraftError(action.title, action.date) : null;
  if (draft) return draft;
  return (meta && action && actionMetadataError({ ...emptyWeekMeta, ...meta }, action)) || ACTION_REFUSAL_MESSAGES.invalid_result;
}

/**
 * H25 (amends T5). Given a `next` that fails `validActionSnapshot`, the
 * client's sentence for the first failure the COMMAND added, or null when every
 * failure was already in the stored snapshot and is left exactly as it was.
 *
 *   - An action/meta pair that fails is the command's unless the same id was
 *     stored with the same action and the same meta, by value. Touching a
 *     failing row in any way (a revision bump included) makes it the command's.
 *   - A duplicate id or key, or a meta with no action, is the command's unless
 *     the stored snapshot had that same orphan meta.
 *   - A preference that fails is the command's if the command wrote that key.
 *     (parseActionCommand already refuses one that fails alone, so this is a
 *     backstop.) A drifted stored preference the command leaves alone is not.
 */
function addedFailure(stored, next, command) {
  const storedById = new Map(stored.actions.map((action) => [action.id, action]));
  const ids = new Set(), keys = new Set();
  for (const action of next.actions) {
    if (ids.has(action.id) || keys.has(action.key)) return ACTION_REFUSAL_MESSAGES.invalid_result;
    ids.add(action.id); keys.add(action.key);
    const meta = ownMeta(next.metas, action.key);
    const error = pairError(action, meta);
    if (!error) continue;
    const before = storedById.get(action.id);
    if (before && sameValue(before, action) && sameValue(ownMeta(stored.metas, before.key), meta)) continue;
    return error;
  }
  for (const key of Object.keys(next.metas)) {
    if (keys.has(key)) continue;
    if (!(Object.hasOwn(stored.metas, key) && sameValue(stored.metas[key], next.metas[key]))) return ACTION_REFUSAL_MESSAGES.invalid_result;
  }
  for (const [key] of command.preferences) {
    if (!validActionPreferences({ [key]: next.preferences[key] })) return ACTION_REFUSAL_MESSAGES.invalid_result;
  }
  return null;
}

/**
 * Applies a parsed command to the household's current snapshot.
 *
 * `snapshot` is `{ actions, metas, preferences }` as the read function returns
 * it (H9): every action exactly `{id, key, title, reason, origin, date, state,
 * revision}`, `date` '' when there is none.
 *
 * On success, `next` is the snapshot that would result, already validated as a
 * whole, and `writes` is exactly what must change to get there:
 *
 *   inserts      [{id, key, title, reason, origin, date, state, revision: 1, meta}]
 *                new actions, `meta` the sent value or null
 *   updates      [{id, baseRevision, revision, title, date, state}] one per
 *                change, `revision` = `baseRevision` + 1, title trimmed
 *   metas        [{id, key, meta}] a meta set (as sent) or cleared (null) on an
 *                action that already exists; never moves its revision
 *   deletes      [id] (the row's meta goes with it)
 *   preferences  {key: value} the preferences whose value changes
 *
 * `date` is '' or YYYY-MM-DD throughout (the database stores '' as null).
 * `noop` is true when there is nothing to write.
 *
 * On refusal: `{ ok: false, reason, message, revisions? }`, `revisions` being
 * the current `[{id, revision}]` of the named actions for `stale_revision`.
 *
 * @param {{ actions: object[], metas: Record<string, object>, preferences?: Record<string, unknown> }} snapshot
 * @param {object} command from parseActionCommand
 * @param {{ newId?: () => string }} [options]
 */
export function planActionCommand(snapshot, command, { newId = () => globalThis.crypto.randomUUID() } = {}) {
  const current = snapshot.actions;
  const storedMetas = snapshot.metas ?? {};
  const storedPreferences = snapshot.preferences ?? {};
  const storedMeta = (key) => (Object.hasOwn(storedMetas, key) ? storedMetas[key] : null);

  // 1. Every signature, before anything else; one mismatch refuses it all
  //    (F: action-service.ts:58). By value, not bytes (H12).
  for (const [key, expected] of command.expectedMetadata) {
    if (!sameValue(expected, storedMeta(key))) return refuse(ACTION_REFUSAL_REASONS.METADATA_CHANGED);
  }

  // 2. The kind (F: action-service.ts:60-71).
  let actions;
  const inserts = [];
  const updates = [];
  const deletes = [];
  let removedKey = null;
  if (command.kind === 'add') {
    actions = [...current];
    for (const seed of command.seeds) {
      if (actions.some((row) => row.key === seed.key)) continue;
      const action = {
        id: newId(),
        key: seed.key,
        title: seed.title.trim(),
        reason: seed.reason,
        origin: seed.origin,
        date: command.date,
        state: command.initialStates.get(seed.key) ?? 'saved',
        revision: 1,
      };
      actions.push(action);
      inserts.push(action);
    }
  } else if (command.kind === 'revise') {
    // The answer does not depend on the order of the changes: if any change
    // names a task this household does not have, the answer is unknown_action
    // (a reload is needed whatever else is stale); otherwise, if any revision
    // is stale, stale_revision with the current revision of every named task.
    const rows = command.changes.map((change) => current.find((action) => action.id === change.id));
    if (rows.some((row) => !row)) return refuse(ACTION_REFUSAL_REASONS.UNKNOWN_ACTION);
    if (rows.some((row, index) => (row.revision ?? 1) !== command.changes[index].revision)) {
      return refuse(ACTION_REFUSAL_REASONS.STALE_REVISION, undefined, { revisions: rows.map((row) => ({ id: row.id, revision: row.revision ?? 1 })) });
    }
    actions = revisedActionBatch(current, command.changes);
    if (!actions) return refuse(ACTION_REFUSAL_REASONS.INVALID_RESULT);
    for (const change of command.changes) {
      updates.push({
        id: change.id,
        baseRevision: change.revision,
        revision: change.revision + 1,
        title: change.patch.title.trim(),
        date: change.patch.date,
        state: change.patch.state,
      });
    }
  } else if (command.kind === 'delete') {
    const old = current.find((row) => row.id === command.id);
    if (!old) {
      // No row of this household's has this id: nothing to do, and the same
      // answer whether it never existed or is someone else's (H14).
      actions = current;
    } else if ((old.revision ?? 1) !== command.revision) {
      return refuse(ACTION_REFUSAL_REASONS.STALE_REVISION, undefined, { revisions: [{ id: old.id, revision: old.revision ?? 1 }] });
    } else {
      actions = current.filter((row) => row.id !== command.id);
      deletes.push(old.id);
      removedKey = old.key;
    }
  } else {
    // parseActionCommand never lets another kind through.
    throw new TypeError(`unsupported action command kind: ${String(command.kind)}`);
  }

  // 3. Metadata (F: action-service.ts:72-81).
  const metas = new Map(Object.entries(storedMetas));
  if (removedKey !== null) metas.delete(removedKey);
  const metaWrites = new Map();
  for (const [key, meta] of command.metadata) {
    // An add never touches planning details of a key it did not create, null
    // included (H14). The reference validates first and deletes on null.
    if (command.kind === 'add' && current.some((row) => row.key === key)) continue;
    if (meta === null) {
      if (metas.has(key)) {
        metas.delete(key);
        metaWrites.set(key, null);
      }
      continue;
    }
    const action = actions.find((row) => row.key === key);
    if (!action) return refuse(ACTION_REFUSAL_REASONS.UNKNOWN_ACTION);
    const error = actionMetadataError(meta, action);
    if (error) return refuse(ACTION_REFUSAL_REASONS.INVALID_RESULT, error);
    metas.set(key, structuredClone(meta));
    metaWrites.set(key, meta);
  }

  // 4. Preferences, last write wins per key (F: action-service.ts:82; H5).
  const preferences = { ...storedPreferences };
  const preferenceWrites = {};
  for (const [key, value] of command.preferences) {
    if (!(Object.hasOwn(storedPreferences, key) && sameValue(storedPreferences[key], value))) preferenceWrites[key] = value;
    preferences[key] = value;
  }

  // 5. The whole result, as the client will load it (T5), refusing only a
  //    failure this command adds (H25).
  const next = { actions, metas: Object.fromEntries(metas), preferences };
  if (!validActionSnapshot(next)) {
    const added = addedFailure({ actions: current, metas: storedMetas }, next, command);
    if (added) return refuse(ACTION_REFUSAL_REASONS.INVALID_RESULT, added);
  }

  const inserted = new Set(inserts.map((action) => action.key));
  const writes = {
    inserts: inserts.map((action) => ({ ...action, meta: metaWrites.has(action.key) ? metaWrites.get(action.key) : null })),
    updates,
    metas: [],
    deletes,
    preferences: preferenceWrites,
  };
  for (const [key, meta] of metaWrites) {
    if (inserted.has(key)) continue;
    if (meta !== null && sameValue(storedMeta(key), meta)) continue;
    const action = actions.find((row) => row.key === key);
    writes.metas.push({ id: action.id, key, meta });
  }
  const noop = writes.inserts.length === 0 && writes.updates.length === 0 && writes.metas.length === 0
    && writes.deletes.length === 0 && Object.keys(writes.preferences).length === 0;
  return { ok: true, next, writes, noop };
}
