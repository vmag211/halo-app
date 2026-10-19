/**
 * The privacy export document and the clear preview (B07 plan, Task 4;
 * Rulings P5, P8, P11 and P13; Vibhav's D-P2, D-P4 and D-P5).
 *
 *   buildExportDocument(supabase, {profileId, groups, privateText, now, timezone})
 *     -> {document, file, counts, total, bytes, fields, tooLarge}
 *   exportFileName(now, timezone)          -> 'halo-export-YYYY-MM-DD.json'
 *   exportResponseBytes(file)              -> bytes of the export receipt that would carry it
 *   buildClearPreview({scope, counts})     -> what a clear would remove and what survives
 *   clearTotal(counts)                     -> the number of records a clear would remove
 *
 * WHAT IS READ. Exactly what lib/privacyInventory.js allows: for each selected
 * group, each inventory part's columns (the base tier, plus the private tier
 * with private text), selected by name and never with `*`, and never filtered
 * by a pattern. The client's redaction regex is not used (trap P-12). Every
 * statement is scoped to the verified owner on the query itself. The one read
 * outside the database is the household's own confirmed email, from the auth
 * provider, when `preferences` is selected (D-P5).
 *
 * The builder works from a selection `{groups, privateText}` alone, so the
 * export route (Task 5) and the reconcile rebuild (P9) build the same document
 * from a stored selection as inspect does from a request.
 *
 * TOLERANT READS (P11). A table this deployment does not have (PGRST205,
 * 42P01) is zero rows plus a manifest warning; an OPTIONAL column it does not
 * have (42703, PGRST204, naming one of the part's `optional` columns) is left
 * out with a warning. Any other read error is thrown, because a count has no
 * "unknown" value: the caller answers 500 and mints nothing.
 *
 * PAGING. Each table is read in keyset pages of up to 1,000 rows on a unique
 * page key (one column, or a composite key where a table has none), each with an exact count of what remains, until a page holds all
 * of it. So PostgREST's max_rows (which may be smaller than a page) never
 * cuts the export silently (B06 F1), an answer without a count is an error,
 * and a row written or deleted mid-export cannot repeat or drop a row that
 * was there before it began. Rows are then put in the file's order.
 *
 * COUNT. `total` counts each record once: a row split across two groups by
 * its columns (the profile) is one record, and the login is a record only
 * when it has a confirmed address to export. The manifest's `records` is the
 * same number, so the preview agrees with the count the person is shown.
 *
 * SIZE (P8). The export receipt `{operationId, status, file:{name,mime,text}}`
 * must serialize to at most 4,000,000 bytes. The builder stops reading as soon
 * as the rows alone pass that, so an oversize household is not read to the
 * end, and answers `tooLarge: true` with no document.
 *
 * COPY. Every server-authored sentence is in EXPORT_COPY, plain, with no
 * U+2014. Stored content (a note, a title, a Luna answer) is exported exactly
 * as stored (BE-053, C8).
 *
 * Nothing here logs a row, a value, an id or an email.
 */
import { HOUSEHOLD_TZ, localDate } from './localDate.js';
import {
  EXPORT_GROUPS,
  INVENTORY_COPY,
  PRIVACY_INVENTORY,
  PRIVATE_ONLY_GROUPS,
  UNSTORED_RECORDS,
  exportParts,
  groupsFor,
  projectRow,
  roundCoordinate,
} from './privacyInventory.js';

export const EXPORT_FORMAT = 'halo-export-v1';
export const EXPORT_SCHEMA_VERSION = 1;
/** Exactly this, no charset suffix: the client compares the string (ProductionPrivacy.tsx:23). */
export const EXPORT_MIME = 'application/json';
export const EXPORT_PAGE_SIZE = 1000;
/** The whole export receipt, under the 4.5 MB platform body limit (P8, Open question 9). */
export const EXPORT_MAX_RESPONSE_BYTES = 4_000_000;
/** The error code inspect answers with a 422 for an oversize selection (P8, P15). */
export const EXPORT_TOO_LARGE = 'export_too_large';

const AUTH_USERS = 'auth.users';
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);
/** Stands in for the receipt's operation id when the size of a receipt is measured. */
const SIZE_PROBE_ID = '00000000-0000-4000-8000-000000000000';

/** Every server-authored sentence of the export and the clear preview. No U+2014 (AC-012). */
export const EXPORT_COPY = Object.freeze({
  privateNotSelected: INVENTORY_COPY.conversationExcluded,
  missingTable: (table) => `${table} is not stored on this deployment yet, so it is counted as zero.`,
  missingColumn: (table, column) => `${table}.${column} is not stored on this deployment yet, so it is left out.`,
  weekJournalNotExported: 'Week journal check-ins are not stored on the server yet, so they are not in this export.',
  keepLogin: 'Your sign-in, so this device stays signed in.',
  keepReceipt: 'A short receipt of this request, with none of your records in it, kept for 24 hours.',
  keepOutsideJournal: 'Everything outside the journal: your home, readings, alerts, tasks, settings and Luna conversation.',
  afterAll: 'You will set up your home again, as on first use.',
  weekJournalNotStored: INVENTORY_COPY.weekJournalNotStored,
  limitDownloads: 'Copies you already downloaded cannot be recalled.',
  limitBackups: 'Server backups and records held by service providers are outside this deletion.',
});

/**
 * How each exported table is read and ordered. Unless EXPORT_PAGE_KEYS
 * declares otherwise, the LAST column is the page key: with the owner it is
 * unique, and pages are keyset pages on it (`key > the last key read`), never
 * offsets, so a row written or deleted between two pages cannot make a row
 * that was there before the export started appear twice or not at all. The
 * page key is read to page with and is never emitted unless the table's
 * allowlist names it. The whole list is the order the file shows the rows in,
 * applied once every page is read (nulls last). test/privacyExport.test.mjs
 * pins each page key against the migrated schema's unique keys.
 */
export const EXPORT_ORDER = Object.freeze({
  profiles: Object.freeze(['id']),
  home_contexts: Object.freeze(['sequence', 'id']),
  household_bands: Object.freeze(['profile_id']),
  daily_scores: Object.freeze(['date', 'id']),
  alerts: Object.freeze(['fired_at', 'id']),
  symptom_logs: Object.freeze(['entry_date', 'id']),
  notification_prefs: Object.freeze(['profile_id']),
  profile_preferences: Object.freeze(['profile_id']),
  explore_areas: Object.freeze(['profile_id']),
  household_actions: Object.freeze(['created_at', 'id']),
  household_action_preferences: Object.freeze(['pref_key']),
  luna_conversations: Object.freeze(['created_at', 'id']),
  luna_turns: Object.freeze(['seq', 'id']),
  luna_runs: Object.freeze(['created_at', 'id']),
  // 0025: by day, then factor, then home, so two homes' days interleave by date.
  daily_maxima: Object.freeze(['local_date', 'factor', 'home_context_id']),
});

/**
 * The composite page key of a table with no single column that is unique
 * with the owner. daily_maxima has no id: its primary key is
 * (home_context_id, local_date, factor) (0025), so the three together are its
 * page key. Each page asks for the rows whose key tuple is strictly greater
 * than the last one read (see keyAfter). Every table not named here pages on
 * its EXPORT_ORDER's last column alone, exactly as before.
 * test/privacyExport.test.mjs pins each of these, with the owner, to exactly
 * a unique key of the migrated schema, every column NOT NULL.
 */
export const EXPORT_PAGE_KEYS = Object.freeze({
  daily_maxima: Object.freeze(['local_date', 'factor', 'home_context_id']),
});

/** The columns a table's export pages on: its declared composite key, or its order's last column. */
export const pageKeyFor = (table) => {
  const order = EXPORT_ORDER[table];
  if (!order) return null;
  return EXPORT_PAGE_KEYS[table] ?? Object.freeze([order[order.length - 1]]);
};

/**
 * Where each table a clear counts (privacy_counts, migration 0024) is shown in
 * the clear preview. Alerts are their own line, because one count holds both
 * inbox alerts and season summaries; ledger receipts are `requests`. A key
 * this map does not know is shown as `other`, so the preview always adds up
 * to the count.
 */
export const CLEAR_PREVIEW_BUCKETS = Object.freeze({
  profiles: 'home',
  home_contexts: 'home',
  daily_scores: 'home',
  home_risks: 'home',
  household_bands: 'home',
  daily_maxima: 'home', // 0025, counted by privacy_counts where applied
  symptom_logs: 'journal',
  alerts: 'alerts',
  notification_prefs: 'preferences',
  push_subscriptions: 'preferences',
  profile_preferences: 'preferences',
  explore_areas: 'explore',
  household_actions: 'tasks',
  household_action_preferences: 'tasks',
  household_action_state: 'tasks',
  luna_conversations: 'conversation',
  luna_turns: 'conversation',
  luna_runs: 'conversation',
  operations: 'requests',
});
const BUCKET_ORDER = Object.freeze([...EXPORT_GROUPS, 'alerts', 'requests', 'other']);

/** The rate-limit key inspect and export share (P17), so one budget covers both. */
export const privacyLimitKey = (profileId) => `privacy:${profileId}`;

/** Thrown inside the builder when the rows alone pass the size cap; never leaves this module. */
class TooLarge extends Error {}

const isMissingTable = (error) => !!error && MISSING_TABLE_CODES.has(error.code);

/**
 * The optional column a "no such column" error names, or null. Reads the
 * error's MESSAGE for one of the part's allowlisted optional column names; it
 * never decides which columns are read.
 */
function missingOptionalColumn(error, candidates) {
  if (!error || !MISSING_COLUMN_CODES.has(error.code) || typeof error.message !== 'string') return null;
  const words = new Set(error.message.split(/[^A-Za-z0-9_]+/));
  return candidates.find((column) => words.has(column)) ?? null;
}

/**
 * A coordinate as the export may carry it: rounded to 3 decimals (P5), a
 * numeric string included, and anything else that is not null emptied, so an
 * unexpected stored form can never leave the server unrounded.
 */
function exportCoordinate(value) {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? roundCoordinate(number) : null;
}

function exportRow(part, row) {
  const out = projectRow(part, row);
  for (const column of part.rounded) if (Object.hasOwn(out, column)) out[column] = exportCoordinate(out[column]);
  return out;
}

function applyWhere(query, where) {
  if (!where) return query;
  if (Object.hasOwn(where, 'equals')) return query.eq(where.column, where.equals);
  if (Object.hasOwn(where, 'notEquals')) return query.neq(where.column, where.notEquals);
  if (Object.hasOwn(where, 'in')) return query.in(where.column, [...where.in]);
  throw new Error('privacyExport: an inventory row filter has no condition');
}

/** The household's confirmed email, or null (an anonymous or unconfirmed login). D-P5, Open question 11. */
async function readEmail(supabase, profileId) {
  const { data, error } = await supabase.auth.admin.getUserById(profileId);
  if (error) throw error;
  const user = data?.user;
  if (!user) throw new Error('privacyExport: the signed-in login could not be read');
  const confirmed = user.email_confirmed_at;
  const isConfirmed = typeof confirmed === 'string' && Number.isFinite(Date.parse(confirmed));
  return typeof user.email === 'string' && user.email && isConfirmed ? user.email : null;
}

/** Ascending, nulls last: how Postgres orders `asc`, for the file's row order. */
function compareStored(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

/** One value of a logic tree, double-quoted with `\` and `"` escaped (PostgREST's rule for reserved characters). */
const treeValue = (value) => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;

/**
 * The PostgREST logic tree (the body of `.or(...)`) for the row comparison
 * `(k1, k2, ..., kn) > (v1, v2, ..., vn)`, spelled out as
 *   k1 > v1, or (k1 = v1 and k2 > v2), or ... (k1 = v1 and ... and kn > vn)
 * because PostgREST has no tuple operator.
 *
 * WHY THIS, AND NOT A `>=` PAGE ON THE LEADING COLUMN WITH THE KEYS ALREADY
 * READ SKIPPED. This is a true keyset page, the composite form of the single
 * key's `key > last`: each page starts strictly after the last key read, so it
 * keeps every guarantee that path has. A `>=` page re-reads every row that
 * shares the last leading value, and when more rows share it than one page
 * returns (PostgREST's max_rows is set by the deployment and may be small)
 * the page can never get past them; it would also have to hold every key
 * read so far to skip them. Here a row written or deleted between pages
 * changes nothing about where the next page starts.
 *
 * It is exact because the page is ordered by the same columns, in the same
 * order, ascending, and each comparison uses the column's own type and
 * collation (a date, a text in its collation, a uuid), the same comparison the
 * ORDER BY uses; and because every page-key column is NOT NULL (it is the
 * primary key, pinned by test/privacyExport.test.mjs), so no row's comparison
 * is unknown. Every value is quoted, so a value holding `,`, `.`, `:` or a
 * parenthesis is still one value (dates, 'air' or 'uv', and uuids hold none).
 */
export function keyAfter(keys, values) {
  return keys.map((key, at) => {
    const terms = [...keys.slice(0, at).map((prior, k) => `${prior}.eq.${treeValue(values[k])}`), `${key}.gt.${treeValue(values[at])}`];
    return terms.length === 1 ? terms[0] : `and(${terms.join(',')})`;
  }).join(',');
}

/**
 * Every row of one part. Keyset pages on the table's page key (pageKeyFor:
 * the last EXPORT_ORDER column, or a declared composite key): each page asks
 * for `key > the last key read` (a composite key as the row comparison, see
 * keyAfter), with an exact count of what remains, and the read ends when a
 * page holds all that remains. So PostgREST's max_rows (which may be smaller
 * than a page) never cuts the export, and a row written or deleted between
 * pages never makes a row that was there before the export started repeat or
 * go missing (a row written meanwhile may or may not be included). An answer
 * without an exact count is an error, never a guess from a short page (B06
 * F1). The rows are then put in EXPORT_ORDER.
 */
async function readRows(supabase, part, columns, { owner, profileId, budget }) {
  const order = EXPORT_ORDER[part.table];
  if (!order) throw new Error(`privacyExport: no paging order for ${part.table}`);
  const keys = pageKeyFor(part.table);
  // The page key and the sort columns are read to page and sort with; only `columns` is emitted.
  const read = [...new Set([...columns, ...order, ...keys])];
  const kept = [];
  let after;
  for (;;) {
    let query = supabase.from(part.table).select(read.join(', '), { count: 'exact' }).eq(owner, profileId);
    query = applyWhere(query, part.where);
    if (after !== undefined) query = keys.length === 1 ? query.gt(keys[0], after[0]) : query.or(keyAfter(keys, after));
    for (const key of keys) query = query.order(key, { ascending: true });
    const { data, error, count } = await query.limit(EXPORT_PAGE_SIZE);
    if (error) throw error;
    if (!Number.isSafeInteger(count)) throw new Error(`privacyExport: ${part.table} answered without an exact count`);
    const page = data ?? [];
    for (const stored of page) {
      const row = exportRow({ ...part, columns }, stored);
      budget.used += Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (budget.used > EXPORT_MAX_RESPONSE_BYTES) throw new TooLarge();
      kept.push({ sort: order.map((column) => stored[column]), row });
    }
    if (page.length === 0 || page.length >= count) break;
    const last = page[page.length - 1];
    const next = keys.map((key) => last[key]);
    const stalled = after !== undefined && next.every((value, at) => value === after[at]);
    if (next.some((value) => value === null || value === undefined) || stalled) throw new Error(`privacyExport: ${part.table} paging did not advance`);
    after = next;
  }
  kept.sort((a, b) => {
    for (let at = 0; at < a.sort.length; at += 1) {
      const step = compareStored(a.sort[at], b.sort[at]);
      if (step !== 0) return step;
    }
    return 0;
  });
  return kept.map((entry) => entry.row);
}

/** The number of rows of a counted part (device registrations, unaudited legacy rows). */
async function countRows(supabase, part, { owner, profileId }) {
  let query = supabase.from(part.table).select(owner, { count: 'exact', head: true }).eq(owner, profileId);
  query = applyWhere(query, part.where);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * One part's contribution: `{rows, count, columns}` (rows null for a counted
 * part), with the warnings for a missing table or optional column added.
 */
async function readPart(supabase, part, { profileId, budget, warnings }) {
  if (part.table === AUTH_USERS) {
    // A login with no confirmed address has no email record to export (N5).
    const email = await readEmail(supabase, profileId);
    if (email === null) return { rows: [], count: 0, columns: ['email'] };
    const row = { email };
    budget.used += Buffer.byteLength(JSON.stringify(row), 'utf8');
    return { rows: [row], count: 1, columns: ['email'] };
  }
  const { owner } = PRIVACY_INVENTORY[part.table];
  const counted = Boolean(part.countAs || part.countOnly);
  let columns = [...part.columns];
  const droppable = [...part.optional];
  const spent = budget.used;
  for (;;) {
    // A retry without a missing column starts this part's tally again.
    budget.used = spent;
    try {
      if (counted) return { rows: null, count: await countRows(supabase, part, { owner, profileId }), columns: ['count'] };
      const rows = await readRows(supabase, part, columns, { owner, profileId, budget });
      return { rows, count: rows.length, columns };
    } catch (error) {
      if (error instanceof TooLarge) throw error;
      if (isMissingTable(error)) {
        warnings.add(EXPORT_COPY.missingTable(part.table));
        return { rows: counted ? null : [], count: 0, columns: counted ? ['count'] : [] };
      }
      const column = missingOptionalColumn(error, droppable);
      if (!column) throw error;
      // Schema only, never a value: which optional column this deployment lacks.
      console.warn(`privacy export: optional column ${part.table}.${column} is missing; left out.`);
      warnings.add(EXPORT_COPY.missingColumn(part.table, column));
      droppable.splice(droppable.indexOf(column), 1);
      columns = columns.filter((name) => name !== column);
      if (columns.length === 0) return { rows: [], count: 0, columns };
    }
  }
}

/** 'halo-export-YYYY-MM-DD.json' for the household's local date (UI-146: names no household). */
export function exportFileName(now = new Date(), timezone = HOUSEHOLD_TZ) {
  return `halo-export-${localDate(now instanceof Date ? now : new Date(now), timezone)}.json`;
}

/** The bytes of the export receipt `{operationId, status: 'succeeded', file}` (P8). */
export function exportResponseBytes(file) {
  return Buffer.byteLength(JSON.stringify({ operationId: SIZE_PROBE_ID, status: 'succeeded', file }), 'utf8');
}

/**
 * Tables of the selected groups that the export leaves out whole, and every
 * table the inventory never exports, each with the reason (BE-331).
 */
function omittedTables(groups, privateText, includedKeys) {
  const omitted = [];
  const selected = new Set(groups);
  for (const [table, entry] of Object.entries(PRIVACY_INVENTORY)) {
    if (entry.export.excluded) {
      omitted.push({ table, reason: entry.export.excluded });
      continue;
    }
    if (privateText) continue;
    const inSelection = (entry.export.parts ?? []).some((part) => selected.has(part.group));
    if (inSelection && !includedKeys.has(table)) omitted.push({ table, reason: EXPORT_COPY.privateNotSelected });
  }
  return omitted;
}

/**
 * The number of records in an export, each counted once (N5). The manifest
 * counts a table once per group it appears in, so one row split across two
 * groups by its columns (the profile: home details and language) appears in
 * both; here it is one record. Parts with a row filter hold disjoint rows
 * (the inventory's structural test holds that), so they add up; parts without
 * one are the same rows, so the largest of them is the table's number.
 */
function recordTotal(read) {
  const tables = new Map();
  for (const { part, count } of read) {
    const entry = tables.get(part.table) ?? { filtered: 0, whole: 0 };
    if (part.where) entry.filtered += count;
    else entry.whole = Math.max(entry.whole, count);
    tables.set(part.table, entry);
  }
  let total = 0;
  for (const { filtered, whole } of tables.values()) total += whole + filtered;
  return total;
}

/**
 * Builds the export document of one selection (P5, P8). `groups` must be a
 * valid, non-empty selection of export groups; `privateText` a boolean.
 *
 * Returns, when the export fits:
 *   document  the file's content (an object)
 *   file      {name, mime, text}, text the document as two-space JSON
 *   counts    {<group>: {<table>: n}}, as in the manifest
 *   total     the number of records, each once (the inspect count; manifest.records)
 *   bytes     the size of the export receipt that would carry the file
 *   fields    {<group>: {<key>: [field names]}} or the exclusion, for a preview
 *   tooLarge  false
 * and `{tooLarge: true, bytes, document: null, file: null}` when it does not.
 * Throws on any read error other than a missing table or optional column.
 */
export async function buildExportDocument(supabase, { profileId, groups, privateText, now = new Date(), timezone = HOUSEHOLD_TZ } = {}) {
  if (typeof profileId !== 'string' || profileId.length === 0) throw new Error('privacyExport: an export requires an owner');
  const covered = groupsFor('export', groups);
  const parts = exportParts(covered, privateText);
  const at = now instanceof Date ? now : new Date(now);

  const counts = Object.fromEntries(covered.map((group) => [group, {}]));
  const content = Object.fromEntries(covered.map((group) => [group, {}]));
  const fields = Object.fromEntries(covered.map((group) => [group, {}]));
  const warnings = new Set();
  const includedKeys = new Set();
  const budget = { used: 0 };
  const read = [];

  try {
    for (const part of parts) {
      const result = await readPart(supabase, part, { profileId, budget, warnings });
      const { group, table } = part;
      includedKeys.add(table);
      read.push({ part, count: result.count });
      counts[group][table] = (counts[group][table] ?? 0) + result.count;
      if (part.countAs) {
        content[group][part.countAs] = result.count;
        fields[group][part.countAs] = ['count'];
      } else if (part.countOnly) {
        content[group][table] = { count: result.count };
        fields[group][table] = ['count'];
        if (part.warning) warnings.add(part.warning);
      } else {
        content[group][table] = [...(content[group][table] ?? []), ...result.rows];
        fields[group][table] = [...new Set([...(fields[group][table] ?? []), ...result.columns])];
      }
    }
  } catch (error) {
    if (error instanceof TooLarge) return { tooLarge: true, bytes: budget.used, document: null, file: null };
    throw error;
  }

  for (const group of covered) {
    if (!privateText && PRIVATE_ONLY_GROUPS.includes(group)) {
      content[group] = { excluded: INVENTORY_COPY.conversationExcluded };
      fields[group] = { excluded: INVENTORY_COPY.conversationExcluded };
    }
  }
  for (const record of Object.values(UNSTORED_RECORDS)) {
    if (covered.includes(record.group)) warnings.add(EXPORT_COPY.weekJournalNotExported);
  }

  const total = recordTotal(read);
  const document = {
    format: EXPORT_FORMAT,
    generatedAt: at.toISOString(),
    scope: 'export',
    groups: covered,
    privateText,
    exactLocation: 'excluded',
    manifest: {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      records: total,
      counts,
      omitted: omittedTables(covered, privateText, includedKeys),
      warnings: [...warnings],
    },
    ...content,
  };
  const file = { name: exportFileName(at, timezone), mime: EXPORT_MIME, text: JSON.stringify(document, null, 2) };
  const bytes = exportResponseBytes(file);
  if (bytes > EXPORT_MAX_RESPONSE_BYTES) return { tooLarge: true, bytes, document: null, file: null };
  return { document, file, counts, total, bytes, fields, tooLarge: false };
}

/**
 * The inspect preview of an export (MP-388): the manifest and the field names
 * each included table contributes, never the records, so the review stays
 * small and shows what the file will hold.
 */
export function exportPreview(built) {
  return { manifest: built.document.manifest, fields: built.fields };
}

/** The number of records a clear would remove: the sum of privacy_counts. */
export function clearTotal(counts) {
  return Object.values(counts ?? {}).reduce((sum, n) => sum + (Number.isSafeInteger(n) && n > 0 ? n : 0), 0);
}

/**
 * The inspect preview of a clear: how many records would be removed, by
 * group; what survives; what is not stored on the server to remove; and the
 * limits of any deletion (UI-192, BE-312). `counts` is privacy_counts' answer.
 */
export function buildClearPreview({ scope, counts }) {
  if (scope !== 'journal' && scope !== 'all') throw new TypeError('privacyExport: a clear preview is for journal or all');
  const buckets = new Map();
  for (const [table, n] of Object.entries(counts ?? {})) {
    if (!Number.isSafeInteger(n) || n < 0) continue;
    const bucket = scope === 'journal' ? 'journal' : CLEAR_PREVIEW_BUCKETS[table] ?? 'other';
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + n);
  }
  if (scope === 'journal' && !buckets.has('journal')) buckets.set('journal', 0);
  const remove = Object.fromEntries(BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => [bucket, buckets.get(bucket)]));
  return {
    scope,
    remove,
    keep: scope === 'journal'
      ? [EXPORT_COPY.keepOutsideJournal, EXPORT_COPY.keepLogin, EXPORT_COPY.keepReceipt]
      : [EXPORT_COPY.keepLogin, EXPORT_COPY.keepReceipt],
    ...(scope === 'all' ? { after: [EXPORT_COPY.afterAll] } : {}),
    notStored: [EXPORT_COPY.weekJournalNotStored],
    limits: [EXPORT_COPY.limitDownloads, EXPORT_COPY.limitBackups],
  };
}
