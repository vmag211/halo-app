/**
 * The alerts inbox in the contract's shape, for GET /api/alerts (`alerts.read`)
 * and the receipts of POST /api/alerts/state (`alerts.update`). B04 plan,
 * Task 2b.
 *
 * The shape is fixed by the frontend, not by us: `useProductionAlerts` runs
 * `validAlertSnapshot` on every read and every receipt and throws the WHOLE
 * inbox away when one row fails it ("Alerts could not be verified. Please
 * retry."). So each value below is one that validator accepts
 * (lib/frontend/production/alerts-service.ts on
 * origin/codex/october15-review-refinement, transcribed verbatim in
 * test/routesAlertsState.test.mjs; contract digest section 2.3).
 *
 * WHERE EACH FIELD COMES FROM (digest section 8.3, migration 0021):
 *
 *   id         alerts.id
 *   revision   alerts.revision (0021, not null default 1)
 *   title      alerts.title
 *   body       alerts.message, a different name for the same text
 *   category   alerts.category when the producer named one, otherwise
 *              ALERT_PRESENTATION below
 *   date       the America/New_York calendar day of alerts.fired_at
 *   read       alerts.read
 *   dismissed  alerts.dismissed (0010)
 *   target     alerts.target_* when the producer named a tab, otherwise
 *              ALERT_PRESENTATION below
 *   kind       alerts.type when it is one of the five notification kinds,
 *              otherwise 'app'
 *   source     never sent: no column holds one and nothing produces one
 *              (0021's header), and the key is optional
 *
 * Pure apart from the reads and the write at the bottom, which take the client
 * as an argument, so the mapping can be tested on its own.
 */
import { NOTIFICATION_TYPES } from './alertInputs.js';
import { ALERTS_ROW_LIMIT } from './boundedRead.js';
import { HOUSEHOLD_TZ, localDate } from './localDate.js';
import { parseUuid } from './validate.js';

/**
 * What each alert kind the backend writes is presented as: its inbox category
 * and where "Open related page" goes. Task 1 left the columns nullable with no
 * default because the contract gives no mapping, so this constant is the
 * mapping, and a producer that writes its own category or target overrides it
 * row by row.
 *
 * The five kinds are exactly what lib/alertRules.js writes (`type` at :64,
 * :77, :89, :100, :113), which are exactly the client's `notificationKinds`.
 * Each entry is derived from something the code already says, never invented:
 *
 *   air_quality_change  Conditions, today. lib/push.js sends this kind to
 *                       '/today'.
 *   weather_advisory    Conditions, today. lib/push.js: '/today'. The
 *                       advisories (flood, boil water, heat) name no single
 *                       factor in the client's learn list, so there is none.
 *   new_water_results   Home, home tab, no destination. lib/push.js:
 *                       '/home?risk=water'. These are the UTILITY's published
 *                       results, not a test this household recorded, so the
 *                       home destination 'tests' ("Tests and records", the
 *                       household's own) would be a claim this alert cannot
 *                       support; the home tab itself is where it lands.
 *   radon_season        Home, home tests. The client's own seed notice for
 *                       this kind (settings-preview.ts:66) uses Home and
 *                       {tab:'home', destination:'tests'}, and the alert asks
 *                       the household to test ("Time to test for radon"),
 *                       which is what that destination is for.
 *   season_summary      Your week, plan recap. The client's own seed notice
 *                       for this kind (settings-preview.ts:65) uses
 *                       'Your week' and {tab:'plan', destination:'recap'}
 *                       ("Season review").
 *
 * Every target satisfies the client's routing table: `today` admits no
 * destination at all. None names a learn topic: the client's navigation routes
 * on the tab and destination only (FoundationPreview.tsx:333), and its seed
 * notices name none, so a topic here would be a guess nothing reads. A stored
 * `target_learn` is still passed through (storedTarget below).
 */
export const ALERT_PRESENTATION = Object.freeze({
  air_quality_change: Object.freeze({ category: 'Conditions', target: Object.freeze({ tab: 'today' }) }),
  weather_advisory: Object.freeze({ category: 'Conditions', target: Object.freeze({ tab: 'today' }) }),
  new_water_results: Object.freeze({ category: 'Home', target: Object.freeze({ tab: 'home' }) }),
  radon_season: Object.freeze({ category: 'Home', target: Object.freeze({ tab: 'home', destination: 'tests' }) }),
  season_summary: Object.freeze({ category: 'Your week', target: Object.freeze({ tab: 'plan', destination: 'recap' }) }),
});

/**
 * An alert of a kind this file does not know: a type an older writer used
 * (0006's comment still names `air_quality`) or one added later without a
 * mapping. It cannot be dropped, because a missing row is invisible, and it
 * cannot be given a destination, because any destination would be made up.
 * The validator requires a tab, so it gets the one place that is no
 * destination at all: `today`, whose destination list is empty. 'Conditions'
 * is the category that goes with that tab.
 */
export const UNKNOWN_PRESENTATION = Object.freeze({ category: 'Conditions', target: Object.freeze({ tab: 'today' }) });

/** The client's routing table (alerts-service.ts:5), so a stored target is checked before it is sent. */
const DESTINATIONS = Object.freeze({
  home: ['tests', 'maintenance', 'food', 'summary'],
  plan: ['journal', 'patterns', 'recap', 'outdoors', 'reminders'],
  today: [],
});
const LEARN_TOPICS = Object.freeze(['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead']);
const CATEGORIES = Object.freeze(['Home', 'Your week', 'Conditions']);

/**
 * The columns a contract row is built from. Every one of 0021's five is named,
 * so a read before 0021 fails with "column does not exist" rather than quietly
 * building rows without a revision.
 */
export const ALERT_ITEM_COLUMNS =
  'id, type, title, message, fired_at, read, dismissed, revision, category, target_tab, target_destination, target_learn';

/** The stored target when it is one the client can route, else null. */
function storedTarget(row) {
  if (!row.target_tab || !Object.hasOwn(DESTINATIONS, row.target_tab)) return null;
  const target = { tab: row.target_tab };
  if (row.target_destination) {
    if (!DESTINATIONS[row.target_tab].includes(row.target_destination)) return null;
    target.destination = row.target_destination;
  }
  if (row.target_learn) {
    if (!LEARN_TOPICS.includes(row.target_learn)) return null;
    target.learn = row.target_learn;
  }
  return target;
}

/**
 * Stored copy without the em dash (U+2014), which app-facing text must not
 * carry, including copy a producer wrote (AGENTS.md). Rows written before the
 * flood advisory's sentence was reworded in lib/alertRules.js still hold one,
 * and stored rows are not rewritten, so the dash becomes a comma here, which
 * keeps the sentence's meaning. The legacy `alerts` list is left exactly as
 * stored: it is the old response, unchanged.
 */
const withoutEmDash = (text) => text.replace(/\s*\u2014\s*/g, ', ');

/**
 * One `public.alerts` row as an `AlertItem`.
 *
 * The date is the household's calendar day, the same America/New_York day the
 * daily job uses for "today" and for each alert's dedupe key
 * (app/api/cron/daily/route.js, lib/localDate.js), so an alert fired at 9pm
 * Eastern is not filed under tomorrow.
 */
export function alertItem(row) {
  const presentation = ALERT_PRESENTATION[row.type] ?? UNKNOWN_PRESENTATION;
  const category = CATEGORIES.includes(row.category) ? row.category : presentation.category;
  return {
    id: row.id,
    revision: row.revision,
    title: withoutEmDash(row.title),
    body: withoutEmDash(row.message ?? ''),
    category,
    date: localDate(new Date(row.fired_at), HOUSEHOLD_TZ),
    read: row.read === true,
    dismissed: row.dismissed === true,
    target: storedTarget(row) ?? { ...presentation.target },
    kind: NOTIFICATION_TYPES.includes(row.type) ? row.type : 'app',
  };
}

/**
 * Whether a stored row can be shown as an `AlertItem` at all. The client
 * throws the WHOLE inbox away when one row fails its validator, and an empty
 * title fails it (`!!item.title`). `title` is not null and every producer
 * writes one, so this is latent, but one bad row must not cost the household
 * every other alert: such a row is left out of the contract inbox. It is still
 * in the legacy `alerts` list, exactly as stored. The client never sees it, so
 * it never selects it. A `fired_at` that is not a time is left out for the same
 * reason (the column is a not-null timestamptz, so this cannot happen either);
 * it also keeps alertItem from throwing, which matters after a write:
 * POST /api/alerts/state builds its receipt after the change has committed.
 */
export function isPresentableAlert(row) {
  return typeof row?.title === 'string' && row.title !== '' && Number.isFinite(Date.parse(row.fired_at));
}

/**
 * The stored rows of the inbox the contract reads: the newest ALERTS_ROW_LIMIT
 * alerts, newest first, dismissed ones INCLUDED. The legacy `alerts` list
 * leaves dismissed alerts out, and this one must not: the client filters them
 * itself (AlertCenter.tsx:40) and Undo re-selects a dismissed row from the
 * inbox it holds, so a server that dropped them would break Undo (digest
 * section 5.9).
 *
 * Scoped to the owner on the query itself. Throws the database error, so the
 * caller decides what a missing 0021 means for it.
 */
export async function readAlertRows(supabase, profileId) {
  if (!profileId) throw new Error('alerts: reading an inbox requires an owner');
  const { data, error } = await supabase
    .from('alerts')
    .select(ALERT_ITEM_COLUMNS)
    .eq('profile_id', profileId)
    .order('fired_at', { ascending: false })
    .limit(ALERTS_ROW_LIMIT);
  if (error) throw error;
  return data || [];
}

/**
 * The contract inbox from stored rows: `page` (readAlertRows) with every row
 * of `changed` in it, the changed version winning. A changed row the page
 * does not hold is added whatever its age, because a receipt has to carry
 * every row it changed (`alertReceiptCovers`), and a row pushed out of the
 * newest page by alerts that arrived since it was read would otherwise vanish
 * from the client's list and leave the change unconfirmed. Newest first. Rows
 * that cannot be shown are left out (isPresentableAlert). Pure, and it cannot
 * fail for any row the database returns.
 */
export function inboxItems(page, changed = []) {
  const byId = new Map(changed.map((row) => [row.id, row]));
  const rows = page.map((row) => byId.get(row.id) ?? row);
  const listed = new Set(page.map((row) => row.id));
  const extra = changed.filter((row) => !listed.has(row.id));
  if (extra.length > 0) {
    rows.push(...extra);
    rows.sort((a, b) => Date.parse(b.fired_at) - Date.parse(a.fired_at));
  }
  return rows.filter(isPresentableAlert).map(alertItem);
}

/** The contract inbox as it is now (GET /api/alerts). */
export async function readAlertItems(supabase, profileId) {
  return inboxItems(await readAlertRows(supabase, profileId));
}

/**
 * The most rows one `alerts.update` may select. The client selects only from
 * the inbox it holds, which is at most ALERTS_ROW_LIMIT rows from a read, so a
 * longer selection did not come from it. ("Mark all as read" is the long case:
 * every row that is neither read nor dismissed.) It also keeps the id list a
 * PostgREST filter carries in its URL to a few kilobytes.
 */
export const MAX_SELECTION = ALERTS_ROW_LIMIT;

const BODY_KEYS = Object.freeze(['operationId', 'selection', 'patch']);
const SELECTION_KEYS = Object.freeze(['id', 'revision']);
const PATCH_KEYS = Object.freeze(['read', 'dismissed']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fieldError = (field, code, message) => ({ field, code, message });

/**
 * The `alerts.update` body, `{operationId, selection:[{id, revision}], patch}`
 * (ProductionAlerts.tsx:17, digest sections 1.5 and 5), checked here because
 * the client is never authority.
 *
 *   operationId  a UUID, the same id as the Idempotency-Key header
 *   selection    1 to MAX_SELECTION rows, each exactly {id, revision}: id a
 *                UUID (alerts.id is one, so anything else names no row and
 *                would make Postgres refuse the filter), revision a safe
 *                integer of at least 1 (the client's own bound), and no id
 *                named twice, since one row cannot be expected at two
 *                revisions in one change
 *   patch        {read?, dismissed?}: at least one, each a boolean. The client
 *                only ever sends {read:true}, {dismissed:true} or
 *                {dismissed:false}; the type admits the other combinations, and
 *                each is an explicit change the person asked for, so they are
 *                accepted rather than refused
 *
 * Any other key, at any level, is a client confused about this endpoint and is
 * refused rather than ignored; that is also what stops a body field naming
 * another household. Ids come back lower case, the form the database holds.
 *
 * Returns `{ ok: true, value }` or `{ ok: false, fieldErrors }`. Pure.
 */
export function parseAlertStateBody(body) {
  const unknown = Object.keys(body).filter((key) => !BODY_KEYS.includes(key)).sort();
  if (unknown.length > 0) {
    return {
      ok: false,
      fieldErrors: unknown.map((key) => fieldError(key, 'unknown_field', `Only ${BODY_KEYS.join(', ')} can be sent.`)),
    };
  }

  const operationId = parseUuid(body.operationId);
  if (!operationId.ok) return { ok: false, fieldErrors: [fieldError('operationId', operationId.code, operationId.message)] };

  const raw = body.selection;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, fieldErrors: [fieldError('selection', 'selection_required', 'Choose at least one alert.')] };
  }
  if (raw.length > MAX_SELECTION) {
    return {
      ok: false,
      fieldErrors: [fieldError('selection', 'selection_too_long', `Choose at most ${MAX_SELECTION} alerts at a time.`)],
    };
  }
  const fieldErrors = [];
  const selection = [];
  const seen = new Set();
  raw.forEach((row, index) => {
    const at = `selection.${index}`;
    if (!isObject(row)) {
      fieldErrors.push(fieldError(at, 'invalid_selection', 'Each selected alert is an id and a revision.'));
      return;
    }
    const extra = Object.keys(row).filter((key) => !SELECTION_KEYS.includes(key)).sort();
    for (const key of extra) fieldErrors.push(fieldError(`${at}.${key}`, 'unknown_field', 'Only id and revision can be sent for a selected alert.'));
    const id = parseUuid(row.id);
    if (!id.ok) fieldErrors.push(fieldError(`${at}.id`, id.code, 'That alert id is not valid.'));
    // A number, not a numeric string: the client sends the revision it read.
    if (!Number.isSafeInteger(row.revision) || row.revision < 1) {
      fieldErrors.push(fieldError(`${at}.revision`, 'invalid_revision', 'The revision must be a whole number of at least 1.'));
    }
    if (id.ok && seen.has(id.value)) {
      fieldErrors.push(fieldError(`${at}.id`, 'duplicate_id', 'Each alert can be selected only once.'));
    }
    if (id.ok) seen.add(id.value);
    if (id.ok && extra.length === 0) selection.push({ id: id.value, revision: row.revision });
  });

  const patchErrors = [];
  const patch = {};
  if (!isObject(body.patch)) {
    patchErrors.push(fieldError('patch', 'patch_required', 'Send read or dismissed as true or false.'));
  } else {
    const keys = Object.keys(body.patch);
    for (const key of keys.filter((name) => !PATCH_KEYS.includes(name)).sort()) {
      patchErrors.push(fieldError(`patch.${key}`, 'unknown_field', 'Only read and dismissed can be changed.'));
    }
    for (const key of PATCH_KEYS) {
      if (!Object.hasOwn(body.patch, key)) continue;
      if (typeof body.patch[key] === 'boolean') patch[key] = body.patch[key];
      else patchErrors.push(fieldError(`patch.${key}`, 'invalid_boolean', `${key} must be true or false.`));
    }
    if (patchErrors.length === 0 && Object.keys(patch).length === 0) {
      patchErrors.push(fieldError('patch', 'patch_required', 'Send read or dismissed as true or false.'));
    }
  }
  fieldErrors.push(...patchErrors);
  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { operationId: operationId.value, selection, patch } };
}

/** The caller's rows among `ids`, keyed by id, with the columns a patch is checked against. */
async function readSelectedAlerts(supabase, profileId, ids) {
  const { data, error } = await supabase
    .from('alerts')
    .select('id, revision, read, dismissed')
    .eq('profile_id', profileId)
    .in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row]));
}

/** Ids grouped by a key, in first-seen order, so one statement serves each group. */
function groupIds(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, { sample: entry, ids: [] });
    groups.get(key).ids.push(entry.id);
  }
  return [...groups.values()];
}

/**
 * The compare-and-set filter for a whole selection: each row matched only at
 * the revision the caller read, `and(id.eq.X,revision.eq.N)` per row, ORed.
 * Ids are parsed UUIDs and revisions safe integers (parseAlertStateBody), so
 * nothing in the filter needs quoting.
 */
const selectionFilter = (selection) =>
  selection.map(({ id, revision }) => `and(id.eq.${id},revision.eq.${revision})`).join(',');

/**
 * Thrown when a selection was applied in part and could not be put back
 * because another revision-aware write had already built on it, or a put-back
 * statement failed. The route answers it as an internal error: the outcome is
 * genuinely mixed, the ledger records the operation as failed, and the next
 * read shows what is there.
 */
export const ALERT_PATCH_UNRESTORED = 'ALERT_PATCH_UNRESTORED';

/**
 * Apply `patch` to every selected alert, ALL OR NOTHING, each one compared
 * against the revision the caller read.
 *
 * Why all or nothing. The receipt for a change must prove it for every
 * selected row (`alertReceiptCovers`: each row present, its revision strictly
 * greater, the patched field equal to the patch), and the receipt's statuses
 * have no word for "some of them". So a selection either applies whole, or
 * nothing in it changes and the answer is a conflict: one stale row refuses the
 * whole selection. This is what makes "Mark all as read" safe to retry.
 *
 * How, without a transaction (PostgREST runs one statement per request, and a
 * database function would need another hand-applied migration):
 *
 *   1. Read every selected row, scoped to the owner. A row that is not there
 *      (never existed, or another household's) or that is at a different
 *      revision refuses the whole selection before anything is written. The
 *      two cases are one answer, so the refusal says nothing about whether an
 *      id exists.
 *   2. Write, compare-and-set, in ONE statement for the whole selection: the
 *      patch and `revision = max(expected) + 1`, WHERE the owner and, per row,
 *      `id = X and revision = expected`. One statement is atomic, so an error
 *      (a timeout, a dropped connection) leaves nothing applied, and rows at
 *      different revisions (any "Mark all as read" after a single change or an
 *      Undo) are no exception. Every selected row lands on the same new
 *      revision, strictly greater than each one's expected revision, which is
 *      all the receipt has to prove; revisions only ever rise. The statement
 *      returns the changed rows in full (ALERT_ITEM_COLUMNS), so the receipt is
 *      built from them with no read after the write.
 *   3. If the statement matched fewer rows than were selected, another writer
 *      got in between steps 1 and 2. The rows this call did change are put
 *      back with the same compare-and-set: each row's OWN previous read and
 *      dismissed values, at one further revision, WHERE the revision is still
 *      the one this call wrote, one statement per distinct set of previous
 *      values. The revision is NOT rolled back, because a client may already
 *      hold the intermediate value; it only ever rises. Then the answer is the
 *      same conflict as step 1, and nothing in the selection is applied.
 *
 * The one case this cannot settle: in step 3, a row this call changed was
 * changed again by a writer that had read this call's intermediate revision.
 * That write built on this one, so undoing it would destroy theirs; the row is
 * left as they wrote it and ALERT_PATCH_UNRESTORED is thrown. It needs two
 * revision-aware writes for one household to interleave inside the few
 * milliseconds between steps 1 and 3.
 *
 * The legacy POST /api/alerts changes read and dismissed WITHOUT advancing the
 * revision, so this compare-and-set cannot see it; see that route's header.
 *
 * Returns `{ ok: true, rows }` (every selected row as changed, with
 * ALERT_ITEM_COLUMNS) or `{ ok: false, reason: 'stale_selection' }`.
 */
export async function applyAlertPatch(supabase, { profileId, selection, patch }) {
  if (!profileId) throw new Error('alerts: a change requires an owner');
  const ids = selection.map((row) => row.id);
  const current = await readSelectedAlerts(supabase, profileId, ids);
  const stale = selection.some((row) => current.get(row.id)?.revision !== row.revision);
  if (stale) return { ok: false, reason: 'stale_selection' };

  const written = Math.max(...selection.map((row) => row.revision)) + 1;
  const { data, error } = await supabase
    .from('alerts')
    .update({ ...patch, revision: written })
    .eq('profile_id', profileId)
    .or(selectionFilter(selection))
    .select(ALERT_ITEM_COLUMNS);
  if (error) throw error;
  const rows = data || [];
  if (rows.length === selection.length) return { ok: true, rows };

  // Step 3: put back what this call changed, grouped by each row's own previous values.
  let restored = 0;
  const previousOf = (id) => Object.fromEntries(Object.keys(patch).map((key) => [key, current.get(id)[key]]));
  for (const { sample, ids: groupIdList } of groupIds(rows, (row) => JSON.stringify(previousOf(row.id)))) {
    const { data: back, error: backError } = await supabase
      .from('alerts')
      .update({ ...previousOf(sample.id), revision: written + 1 })
      .eq('profile_id', profileId)
      .eq('revision', written)
      .in('id', groupIdList)
      .select('id');
    if (backError) throw new Error(ALERT_PATCH_UNRESTORED, { cause: backError });
    restored += (back || []).length;
  }
  if (restored !== rows.length) throw new Error(ALERT_PATCH_UNRESTORED);
  return { ok: false, reason: 'stale_selection' };
}
