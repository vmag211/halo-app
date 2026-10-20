/**
 * lib/privacyExport.js: the export document and the clear preview (B07 plan,
 * Task 4; Rulings P5, P8, P11 and P13; Vibhav's D-P2, D-P4 and D-P5).
 *
 *   1. The allowlist trap (trap P-12, AC-281), by KEY and by VALUE, over the
 *      isolation seed with every group: no credential, hash, ledger internal,
 *      legacy exact location, provider payload, idempotency key or owner id
 *      reaches the document, and nothing of the other household does.
 *   2. Private text off removes every private value and excludes the
 *      conversation, as the client does.
 *   3. D-P5: the confirmed email with `preferences`; rounded coordinates with
 *      `home`, a legacy six-decimal row and a numeric string included.
 *   4. The manifest, the tolerant reads (P11), paging past PostgREST's
 *      max_rows, the 4,000,000-byte cap, and stored text kept verbatim (C8).
 *   5. The paging order pinned to the migrated schema's unique keys, and the
 *      whole builder run against real Postgres (PGlite), so a column or order
 *      name the fake would answer with a silent null fails here.
 *   6. The clear preview.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { HALO_TABLES, OWNED_TABLES } from './helpers/tables.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { pgError } from './helpers/fakeTable.mjs';
import {
  ENDPOINT,
  actionId,
  contextId,
  entryId,
  lunaRunId,
  markersOf,
  seedHouseholds,
} from './helpers/isolationSeed.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { OWNED_ROW, homeContextId, lunaId } from './db/ownedRows.mjs';
import {
  CLEAR_PREVIEW_BUCKETS,
  EXPORT_COPY,
  EXPORT_FORMAT,
  EXPORT_MAX_RESPONSE_BYTES,
  EXPORT_MIME,
  EXPORT_ORDER,
  EXPORT_PAGE_KEYS,
  EXPORT_PAGE_SIZE,
  buildClearPreview,
  buildExportDocument,
  clearTotal,
  exportFileName,
  exportPreview,
  exportResponseBytes,
  keyAfter,
  pageKeyFor,
  privacyLimitKey,
} from '../lib/privacyExport.js';
import {
  EXPORT_GROUPS,
  INVENTORY_COPY,
  PRIVACY_INVENTORY,
  columnsFor,
  exportParts,
} from '../lib/privacyInventory.js';

const EM_DASH = String.fromCharCode(0x2014);
const ALL_GROUPS = [...EXPORT_GROUPS];
const NOW = new Date('2026-10-19T15:00:00Z');
const CONFIRMED = '2026-10-01T12:00:00Z';

/** The client's file-name rule (ProductionPrivacy.tsx:23). */
const CLIENT_FILE_NAME = /^halo[-\w]*\.(json|csv)$/;

/** Keys that must never appear anywhere in an export document (trap P-12, P2, UI-146). */
const DENIED_KEYS = new Set([
  'endpoint', 'p256dh', 'auth', 'request_hash', 'result', 'email_hash', 'nonce_hash', 'address', 'zip',
  'onboard_request_id', 'details', 'dedupe_key', 'client_message_id', 'profile_id', 'match_method',
  'backfill_state', 'backfill_from', 'backfill_to', 'home_context_id', 'new_email', 'email_change',
  'conversation_id', 'turn_id', 'target_tab', 'target_destination', 'target_learn',
]);

const SEASON = {
  alice: { title: 'ALICE-SEASON-TITLE', message: 'ALICE-SEASON-MESSAGE-MARKER you logged 3 days' },
  bob: { title: 'BOB-SEASON-TITLE', message: 'BOB-SEASON-MESSAGE-MARKER you logged 9 days' },
};
/** A stored note carrying U+2014, which the export must keep exactly (C8). */
const DASHED_NOTE = `ALICE-DASH-NOTE before${EM_DASH}after`;
const ADDRESS = { alice: 'ALICE-ADDRESS-MARKER 12 Elm Street', bob: 'BOB-ADDRESS-MARKER 9 Oak Road' };

const identitySpec = (overrides = {}) => ({
  alice: { id: '00000000-0000-4000-8000-000000000001', name: 'alice', email: 'alice@example.test', emailConfirmedAt: CONFIRMED, ...overrides.alice },
  bob: { id: '00000000-0000-4000-8000-000000000002', name: 'bob', email: 'bob@example.test', emailConfirmedAt: CONFIRMED, ...overrides.bob },
});

/**
 * A fake service-role client over the isolation seed, with each household's
 * season summaries, a legacy exact address, a six-decimal legacy coordinate
 * and a note holding U+2014 added.
 */
function world({ adjust, identities: identityOverrides, tables = HALO_TABLES } = {}) {
  const identities = identitySpec(identityOverrides);
  const rows = seedHouseholds(identities, {
    now: NOW,
    adjust: (seeded, ids) => {
      for (const who of ['alice', 'bob']) {
        const id = ids[who].id;
        seeded.alerts.push({
          id: `${who === 'alice' ? 'a11ce000' : 'b0b00000'}-1111-4000-8000-0000000000aa`, profile_id: id, type: 'season_summary',
          title: SEASON[who].title, message: SEASON[who].message, dedupe_key: `season_summary:fall:${who}`,
          fired_at: '2026-10-01T10:00:00Z',
        });
        seeded.profiles.find((row) => row.id === id).address = ADDRESS[who];
      }
      const alice = seeded.profiles.find((row) => row.id === ids.alice.id);
      alice.lat = 35.408812;
      alice.lng = -80.579524;
      seeded.symptom_logs.push({
        id: entryId('alice', 50), profile_id: ids.alice.id, entry_date: '2026-10-10', band: 'household',
        symptoms: ['ALICE-DASH-SYMPTOM'], severity: 'mild', note: DASHED_NOTE,
      });
      adjust?.(seeded, ids);
    },
  });
  const declared = Object.fromEntries(Object.entries(tables).filter(([name]) => name in tables));
  const seed = Object.fromEntries(Object.entries(rows).filter(([name]) => name in declared));
  const db = createFakeSupabase({ tables: declared, seed, identities: Object.values(identities) });
  return { db, alice: identities.alice, bob: identities.bob, rows };
}

/** Every key at any depth of a value. */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) for (const item of value) allKeys(item, out);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.add(key);
      allKeys(inner, out);
    }
  }
  return out;
}

/** Every number at any depth, with the key it sits under. */
function numbersUnder(value, keys, out = []) {
  if (Array.isArray(value)) for (const item of value) numbersUnder(item, keys, out);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (keys.includes(key) && inner !== null) out.push(inner);
      numbersUnder(inner, keys, out);
    }
  }
  return out;
}

const decimals = (n) => (String(n).split('.')[1] ?? '').length;

/** Records each select's column list on a fake, so a test can check every read is an allowlist. */
function recordSelects(db) {
  const realFrom = db.from;
  const selects = [];
  db.from = (name) => {
    const builder = realFrom(name);
    const realSelect = builder.select.bind(builder);
    builder.select = (columns, options) => {
      selects.push({ table: name, columns, head: options?.head === true });
      return realSelect(columns, options);
    };
    return builder;
  };
  return selects;
}

const build = (db, owner, groups = ALL_GROUPS, privateText = true, extra = {}) =>
  buildExportDocument(db, { profileId: owner.id, groups, privateText, now: NOW, ...extra });

// ---------------------------------------------------------------------------
// 1. The allowlist trap, by key and by value
// ---------------------------------------------------------------------------

test('every group with private text: no denied key anywhere in the document (trap P-12, by key)', async () => {
  const { db, alice } = world();
  const built = await build(db, alice);
  assert.equal(built.tooLarge, false);
  const keys = allKeys(built.document);
  for (const denied of DENIED_KEYS) assert.ok(!keys.has(denied), `the export carries the key ${denied}`);
  // The parsed file is the same document: nothing is added between them.
  assert.deepEqual(JSON.parse(built.file.text), built.document);
});

test('every group with private text: no credential, hash, ledger, legacy location, payload or owner VALUE (trap P-12, by value)', async () => {
  const { db, alice, rows } = world();
  const text = (await build(db, alice)).file.text;
  const challenge = rows.recovery_challenges.find((row) => row.profile_id === alice.id);
  const run = rows.luna_runs.find((row) => row.profile_id === alice.id);
  const forbidden = {
    'push endpoint': ENDPOINT.alice,
    'push p256dh': 'ALICE-P256DH-MARKER',
    'push auth': 'ALICE-AUTH-MARKER',
    'ledger request_hash': 'ALICE-REQUEST-HASH-MARKER',
    'ledger result': 'ALICE-RECEIPT-MARKER',
    'recovery email hash': challenge.email_hash,
    'recovery nonce hash': challenge.nonce_hash,
    'legacy address': ADDRESS.alice,
    'legacy zip': '28025',
    'onboard_request_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'daily_scores.details': 'ALICE-POLLUTANT-MARKER',
    'alert dedupe_key': 'alice-one',
    'season dedupe_key': 'season_summary:fall:alice',
    'luna client_message_id': run.client_message_id,
    'profile_id': alice.id,
    'home_risks (unaudited)': 'ALICE-HOME-RISK-MARKER',
    'home_contexts.match_method': 'mapbox_geocode_arcgis_point',
  };
  assert.equal(run.client_message_id, lunaRunId('alice', 9));
  for (const [what, value] of Object.entries(forbidden)) {
    assert.ok(!text.includes(value), `the export carries ${what}`);
  }
  // The positive control: the search above would see a value that is there.
  assert.ok(text.includes('ALICE-NOTE-MARKER'));
  assert.ok(text.includes(actionId('alice', 1)), 'a task id is exported, so a person can recognise the record');
});

test('another household\'s markers never appear in the document (HO-066, BE-380)', async () => {
  const { db, alice, bob } = world();
  const text = (await build(db, alice)).file.text;
  for (const marker of [...markersOf('bob', bob), SEASON.bob.title, SEASON.bob.message, ADDRESS.bob, 'bob@example.test', 'BOB-WEEK-FOCUS-MARKER']) {
    assert.ok(!text.includes(marker), `alice's export carries bob's ${marker}`);
  }
  auditOwnerScope(db.queryLog, alice.id, 'export');
});

test('every read names its columns from the inventory allowlist, never `*`', async () => {
  const { db, alice } = world();
  const selects = recordSelects(db);
  await build(db, alice);
  assert.ok(selects.length >= Object.keys(EXPORT_ORDER).length);
  for (const { table, columns, head } of selects) {
    assert.notEqual(String(columns).trim(), '*', `${table} was read with *`);
    const names = String(columns).split(',').map((name) => name.trim());
    // The allowlist, plus the paging and sort columns, which are read but never emitted (below).
    const allowed = head ? [PRIVACY_INVENTORY[table].owner] : [...columnsFor(table, true), ...EXPORT_ORDER[table]];
    for (const name of names) assert.ok(allowed.includes(name), `${table}.${name} is read but not allowlisted`);
  }
});

test('nothing but the allowlisted columns of each row is emitted, whatever extra columns a stored row holds', async () => {
  const { db, alice } = world({
    adjust: (seeded, ids) => {
      // A column a future migration adds, which no allowlist names.
      seeded.symptom_logs.find((row) => row.profile_id === ids.alice.id).secret_future_column = 'ALICE-FUTURE-COLUMN-MARKER';
    },
  });
  const built = await build(db, alice);
  assert.ok(!built.file.text.includes('ALICE-FUTURE-COLUMN-MARKER'));
  // Every row of every table: only its allowlist, so the page key read to page with (an
  // internal `id` for most tables) never leaves.
  let checked = 0;
  for (const group of ALL_GROUPS) {
    for (const [table, rows] of Object.entries(built.document[group])) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        checked += 1;
        for (const key of Object.keys(row)) assert.ok(columnsFor(table, true, group).includes(key), `${group}.${table}.${key}`);
      }
    }
  }
  assert.ok(checked > 20);
  assert.ok(!('id' in built.document.home.daily_scores[0]) && !('id' in built.document.journal.symptom_logs[0]));
});

test('rows are in the file\'s order (EXPORT_ORDER), not the page key\'s', async () => {
  const { db, alice } = world();
  const built = await build(db, alice, ['home', 'journal'], true);
  const dates = built.document.home.daily_scores.map((row) => row.date);
  assert.ok(dates.length >= 5);
  assert.deepEqual(dates, [...dates].sort());
  const entries = built.document.journal.symptom_logs.map((row) => row.entry_date);
  assert.deepEqual(entries, [...entries].sort());
  // The seeded ids are random, so id order is not date order and the sort is doing the work.
  const ids = db.rows('daily_scores').filter((row) => row.profile_id === alice.id).sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => row.date);
  assert.notDeepEqual(ids, [...ids].sort());
});

// ---------------------------------------------------------------------------
// 2. Private text off
// ---------------------------------------------------------------------------

test('private text off: no symptom, note, band, Luna text, task note, focus sentence or season statement', async () => {
  const { db, alice } = world();
  const built = await build(db, alice, ALL_GROUPS, false);
  const text = built.file.text;
  for (const marker of [
    'ALICE-COUGH-MARKER', 'ALICE-WHEEZE-MARKER', 'ALICE-NOTE-MARKER', 'ALICE-DASH-NOTE', 'ALICE-DASH-SYMPTOM',
    'ALICE-LUNA-QUESTION-MARKER', 'ALICE-LUNA-ANSWER-MARKER', 'ALICE-LUNA-SOURCE-MARKER',
    'ALICE-TASK-NOTE-MARKER', 'Moved to Monday', 'ALICE-WEEK-FOCUS-MARKER', SEASON.alice.message,
  ]) {
    assert.ok(!text.includes(marker), `private text leaked: ${marker}`);
  }
  const keys = allKeys(built.document);
  for (const band of ['has_pregnant', 'has_senior', 'has_toddler', 'has_child', 'has_teen', 'has_adult', 'has_respiratory', 'possibly_illness', 'symptoms', 'note', 'history', 'body']) {
    assert.ok(!keys.has(band), `private field ${band} present without private text`);
  }
  for (const row of built.document.journal.symptom_logs) assert.ok(!('severity' in row) && !('band' in row));
  assert.deepEqual(built.document.conversation, { excluded: 'Private text was not selected.' });
  assert.equal(built.document.conversation.excluded, INVENTORY_COPY.conversationExcluded);
  // Base fields stay: the season summary's title and date, the task's planning details.
  assert.ok(text.includes(SEASON.alice.title));
  const task = built.document.tasks.household_actions[0];
  assert.equal(task.title, 'ALICE-TASK-TITLE-MARKER');
  assert.deepEqual(Object.keys(task.meta).sort(), ['archived', 'completedOn', 'duration', 'paused', 'recurrence', 'reminder', 'time', 'zone']);
  // What was left out whole, and why.
  const omitted = built.document.manifest.omitted.map((item) => item.table);
  for (const table of ['household_bands', 'luna_conversations', 'luna_turns', 'luna_runs']) assert.ok(omitted.includes(table), table);
});

test('private text on: the private values are there, exactly as stored', async () => {
  const { db, alice } = world();
  const built = await build(db, alice, ALL_GROUPS, true);
  const bands = built.document.home.household_bands[0];
  assert.equal(bands.has_pregnant, true);
  assert.ok(built.document.conversation.luna_turns.some((turn) => turn.body === 'ALICE-LUNA-QUESTION-MARKER'));
  assert.ok(built.document.journal.alerts.some((alert) => alert.message === SEASON.alice.message));
  assert.equal(built.document.tasks.household_actions[0].meta.note, 'ALICE-TASK-NOTE-MARKER');
  assert.ok(built.document.tasks.household_action_preferences.some((pref) => pref.value === 'ALICE-WEEK-FOCUS-MARKER'));
});

// ---------------------------------------------------------------------------
// 3. D-P5: the email and the rounded location
// ---------------------------------------------------------------------------

test('D-P5: with preferences, the household\'s own confirmed email is exported; without it, no email is read', async () => {
  const { db, alice } = world();
  const withPrefs = await build(db, alice, ['preferences'], false);
  assert.deepEqual(withPrefs.document.preferences['auth.users'], [{ email: 'alice@example.test' }]);
  assert.equal(withPrefs.document.manifest.counts.preferences['auth.users'], 1);
  const without = await build(db, alice, ['home', 'tasks'], true);
  assert.ok(!without.file.text.includes('alice@example.test'));
});

test('D-P5: an anonymous login, an unconfirmed address and a pending change export no address', async () => {
  const anonymous = world({ identities: { alice: { email: null, emailConfirmedAt: null, isAnonymous: true } } });
  assert.deepEqual((await build(anonymous.db, anonymous.alice, ['preferences'], true)).document.preferences['auth.users'], []);
  const unconfirmed = world({ identities: { alice: { emailConfirmedAt: null } } });
  assert.deepEqual((await build(unconfirmed.db, unconfirmed.alice, ['preferences'], true)).document.preferences['auth.users'], []);
  const pending = world({ identities: { alice: { newEmail: 'alice-new@example.test', emailChangeSentAt: CONFIRMED } } });
  const text = (await build(pending.db, pending.alice, ['preferences'], true)).file.text;
  assert.ok(text.includes('alice@example.test'));
  assert.ok(!text.includes('alice-new@example.test'), 'a pending address change is not exported (Open question 11)');
});

test('D-P5: with home, every coordinate has at most 3 decimals, a legacy six-decimal row and a numeric string included', async () => {
  const { db, alice } = world({
    adjust: (seeded, ids) => {
      const context = seeded.home_contexts.find((row) => row.profile_id === ids.alice.id);
      context.lat = '35.408812';
      context.lng = -80.5795249;
    },
  });
  const built = await build(db, alice, ['home'], false);
  const coordinates = numbersUnder(built.document, ['lat', 'lng']);
  assert.ok(coordinates.length >= 4);
  for (const value of coordinates) {
    assert.equal(typeof value, 'number');
    assert.ok(decimals(value) <= 3, `${value} has more than 3 decimals`);
  }
  assert.equal(built.document.home.profiles[0].lat, 35.409);
  assert.equal(built.document.home.profiles[0].lng, -80.58);
  assert.equal(built.document.home.home_contexts[0].lat, 35.409);
  assert.ok(!built.file.text.includes('35.408812') && !built.file.text.includes('80.579524'));
  assert.equal(built.document.exactLocation, 'excluded');
});

// ---------------------------------------------------------------------------
// 4. The document, the manifest and the tolerant reads
// ---------------------------------------------------------------------------

test('the header, the file and the manifest: every selected table counted, home_risks warned, exclusions named', async () => {
  const { db, alice, rows } = world();
  const built = await build(db, alice);
  const { document, file } = built;
  assert.equal(document.format, EXPORT_FORMAT);
  assert.equal(document.generatedAt, NOW.toISOString());
  assert.equal(document.scope, 'export');
  assert.deepEqual(document.groups, ALL_GROUPS);
  assert.equal(document.privateText, true);
  assert.equal(document.manifest.schemaVersion, 1);
  assert.ok(!('origin' in document) && !('authoritative' in document), 'never the wireframe header');
  assert.equal(file.mime, EXPORT_MIME);
  assert.equal(file.mime, 'application/json');
  assert.match(file.name, CLIENT_FILE_NAME);
  assert.equal(file.name, 'halo-export-2026-10-19.json');
  assert.equal(file.text, JSON.stringify(document, null, 2));

  const own = (table) => rows[table].filter((row) => row[PRIVACY_INVENTORY[table].owner] === alice.id);
  const { counts } = document.manifest;
  assert.deepEqual(counts.journal, {
    alerts: own('alerts').filter((row) => row.type === 'season_summary').length,
    symptom_logs: own('symptom_logs').length,
  });
  assert.equal(counts.home.daily_scores, own('daily_scores').length);
  assert.equal(counts.home.alerts, own('alerts').filter((row) => row.type !== 'season_summary').length);
  assert.equal(counts.home.home_risks, 1);
  assert.equal(counts.preferences.push_subscriptions, 1);
  assert.equal(document.preferences.deviceDelivery, 1);
  assert.deepEqual(document.home.home_risks, { count: 1 });
  assert.equal(counts.conversation.luna_turns, 2);
  // Every table of every selected group is named.
  for (const part of exportParts(ALL_GROUPS, true)) {
    assert.ok(Number.isSafeInteger(counts[part.group][part.table]), `${part.group}.${part.table} is not counted`);
  }
  assert.ok(document.manifest.warnings.includes(INVENTORY_COPY.homeRisksWarning));
  assert.ok(document.manifest.warnings.includes(EXPORT_COPY.weekJournalNotExported));
  const omitted = Object.fromEntries(document.manifest.omitted.map((item) => [item.table, item.reason]));
  for (const table of ['operations', 'recovery_challenges', 'household_action_state']) {
    assert.equal(omitted[table], PRIVACY_INVENTORY[table].export.excluded);
  }
  const sum = Object.values(counts).flatMap((tables) => Object.values(tables)).reduce((a, b) => a + b, 0);
  // The profile row is in home and preferences: one record, counted once (N5).
  assert.equal(built.total, sum - 1);
  assert.equal(document.manifest.records, built.total);
  assert.equal(built.bytes, exportResponseBytes(file));
  assert.deepEqual(exportPreview(built), { manifest: document.manifest, fields: built.fields });
  assert.deepEqual(built.fields.journal.symptom_logs, columnsFor('symptom_logs', true));
  assert.deepEqual(built.fields.preferences.deviceDelivery, ['count']);
});

test('only the selected groups are read and written, in the client\'s group order', async () => {
  const { db, alice } = world();
  const built = await build(db, alice, ['preferences', 'tasks'], false);
  assert.deepEqual(built.document.groups, ['tasks', 'preferences']);
  for (const group of ['home', 'explore', 'journal', 'conversation']) assert.ok(!(group in built.document), group);
  const read = new Set(db.queryLog.map((query) => query.table));
  for (const table of ['symptom_logs', 'daily_scores', 'luna_turns', 'home_contexts']) assert.ok(!read.has(table), `${table} was read`);
});

test('a stored note holding U+2014 survives into the file unchanged; no server sentence has one (C8, AC-012)', async () => {
  const { db, alice } = world();
  const built = await build(db, alice, ['journal'], true);
  assert.ok(built.document.journal.symptom_logs.some((row) => row.note === DASHED_NOTE));
  assert.ok(built.file.text.includes(DASHED_NOTE));
  const server = JSON.stringify([built.document.manifest, EXPORT_COPY.missingTable('x'), EXPORT_COPY.missingColumn('x', 'y'),
    ...Object.values(EXPORT_COPY).filter((value) => typeof value === 'string'),
    buildClearPreview({ scope: 'all', counts: { profiles: 1 } }), buildClearPreview({ scope: 'journal', counts: {} })]);
  assert.ok(!server.includes(EM_DASH));
});

test('a table this deployment lacks is zero rows with a not-stored warning, not a failure (P11, PGRST205)', async () => {
  const tables = Object.fromEntries(Object.entries(HALO_TABLES).filter(([name]) => name !== 'explore_areas'));
  const { db, alice } = world({ tables });
  const built = await build(db, alice);
  assert.equal(built.tooLarge, false);
  assert.deepEqual(built.document.explore.explore_areas, []);
  assert.equal(built.document.manifest.counts.explore.explore_areas, 0);
  assert.ok(built.document.manifest.warnings.includes('explore_areas is not stored on this deployment yet, so it is counted as zero.'));
});

test('a missing table answered the Postgres way (42P01), and a missing counted table, are zero with a warning', async () => {
  const { db, alice } = world();
  const realFrom = db.from;
  db.from = (name) => {
    if (name !== 'luna_runs' && name !== 'push_subscriptions') return realFrom(name);
    const answer = { data: null, count: null, error: pgError('42P01', `relation "public.${name}" does not exist`) };
    const failing = { then: (resolve, reject) => Promise.resolve(answer).then(resolve, reject) };
    for (const method of ['select', 'eq', 'neq', 'in', 'gt', 'order', 'limit']) failing[method] = () => failing;
    return failing;
  };
  const built = await build(db, alice);
  assert.deepEqual(built.document.conversation.luna_runs, []);
  assert.equal(built.document.preferences.deviceDelivery, 0);
  assert.ok(built.document.manifest.warnings.includes(EXPORT_COPY.missingTable('luna_runs')));
  assert.ok(built.document.manifest.warnings.includes(EXPORT_COPY.missingTable('push_subscriptions')));
});

for (const code of ['42703', 'PGRST204']) {
  test(`a missing optional column (profiles.tenure, ${code}) is left out with a warning; the rest of the row stays`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { db, alice } = world();
    const failed = withoutColumn(db, 'profiles', 'tenure', code);
    const built = await build(db, alice, ['home', 'preferences'], false);
    assert.ok(failed.length >= 1);
    const profile = built.document.home.profiles[0];
    assert.ok(!('tenure' in profile));
    assert.equal(profile.county, 'Cabarrus County');
    assert.equal(profile.lat, 35.409);
    assert.ok(built.document.manifest.warnings.includes('profiles.tenure is not stored on this deployment yet, so it is left out.'));
    assert.ok(!built.fields.home.profiles.includes('tenure'));
    // Only the column the error names is dropped: the other optional columns stay (N3).
    assert.equal(profile.renter_mode, false);
    assert.equal(profile.state, 'NC');
    assert.ok(built.fields.home.profiles.includes('renter_mode') && built.fields.home.profiles.includes('state'));
    const columnWarnings = built.document.manifest.warnings.filter((line) => line.endsWith('so it is left out.'));
    assert.deepEqual(columnWarnings, ['profiles.tenure is not stored on this deployment yet, so it is left out.']);
    // The warn names the schema, never a value.
    for (const call of console.warn.mock.calls) assert.ok(!JSON.stringify(call.arguments).includes(alice.id));
  });
}

test('a missing column that is not optional is a failure, not a quietly smaller export (P11)', async () => {
  const { db, alice } = world();
  withoutColumn(db, 'profiles', 'county', '42703');
  await assert.rejects(build(db, alice, ['home'], false), (error) => error.code === '42703');
});

test('any other read error fails the build: a count has no "unknown" value (P11)', async () => {
  const { db, alice } = world();
  const realFrom = db.from;
  db.from = (name) => {
    const builder = realFrom(name);
    if (name !== 'symptom_logs') return builder;
    builder.limit = () => ({ then: (resolve) => resolve({ data: null, count: null, error: pgError('57014', 'canceling statement due to statement timeout') }) });
    return builder;
  };
  await assert.rejects(build(db, alice, ['journal'], true), (error) => error.code === '57014');
});

test('a failed read of the login fails the build (the provider is down)', async () => {
  const { db, alice } = world();
  db.auth.admin.getUserById = async () => ({ data: { user: null }, error: { status: 503, message: 'fetch failed' } });
  await assert.rejects(build(db, alice, ['preferences'], false));
});

// ---------------------------------------------------------------------------
// Paging and the size cap
// ---------------------------------------------------------------------------

function manyReadings(n) {
  return (seeded, ids) => {
    seeded.daily_scores = seeded.daily_scores.filter((row) => row.profile_id !== ids.alice.id);
    const start = Date.UTC(2019, 0, 1);
    for (let i = 0; i < n; i += 1) {
      seeded.daily_scores.push({
        id: `a11ce000-9999-4000-8000-${i.toString(16).padStart(12, '0')}`,
        profile_id: ids.alice.id,
        date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
        score: i % 100, aqi: 40, created_at: '2026-01-01T00:00:00Z',
      });
    }
  };
}

for (const maxRows of [Infinity, 1000, 400]) {
  test(`a 2,500-reading household exports all 2,500, in date order (PostgREST max_rows ${maxRows})`, async () => {
    const { db, alice } = world({ adjust: manyReadings(2500) });
    db.setMaxRows(maxRows);
    const built = await build(db, alice, ['home'], false);
    const readings = built.document.home.daily_scores;
    assert.equal(readings.length, 2500);
    assert.equal(built.document.manifest.counts.home.daily_scores, 2500);
    assert.equal(new Set(readings.map((row) => row.date)).size, 2500);
    assert.deepEqual(readings.map((row) => row.date), [...readings.map((row) => row.date)].sort());
    const pages = db.queryLog.filter((query) => query.table === 'daily_scores').length;
    assert.equal(pages, Math.ceil(2500 / Math.min(maxRows, EXPORT_PAGE_SIZE)));
  });
}

/**
 * Runs `between(realFrom)` once, after the first page of `table` has been
 * answered and before the next is asked for: a write from another device or
 * the backfill landing mid-export.
 */
function betweenPages(db, table, between) {
  const realFrom = db.from;
  let pages = 0;
  db.from = (name) => {
    const builder = realFrom(name);
    if (name !== table) return builder;
    const realThen = builder.then.bind(builder);
    builder.then = (resolve, reject) => realThen(async (answer) => {
      pages += 1;
      if (pages === 1) await between(realFrom);
      return resolve(answer);
    }, reject);
    return builder;
  };
  return () => pages;
}

test('a row written or deleted between pages never repeats or loses a row that was there before (N1, keyset paging)', async () => {
  const { db, alice } = world({ adjust: manyReadings(2500) });
  const before = db.rows('daily_scores').filter((row) => row.profile_id === alice.id).map((row) => row.date);
  assert.equal(before.length, 2500);
  const pages = betweenPages(db, 'daily_scores', async (realFrom) => {
    // An older reading lands (a backfill), one with a key before the cursor and one after;
    // and a reading already read is deleted. Offset paging would shift every later row.
    db.seed('daily_scores', [
      { id: 'a11ce000-0000-4000-8000-000000000001', profile_id: alice.id, date: '2010-01-01', score: 1, aqi: 1 },
      { id: 'a11ce000-ffff-4000-8000-000000000001', profile_id: alice.id, date: '2010-01-02', score: 1, aqi: 1 },
    ]);
    const { error } = await realFrom('daily_scores').delete().eq('id', `a11ce000-9999-4000-8000-${(5).toString(16).padStart(12, '0')}`);
    assert.equal(error, null);
  });
  const built = await build(db, alice, ['home'], false);
  assert.ok(pages() >= 3);
  const dates = built.document.home.daily_scores.map((row) => row.date);
  const seen = new Map();
  for (const date of dates) seen.set(date, (seen.get(date) ?? 0) + 1);
  for (const date of before) assert.equal(seen.get(date), 1, `${date} appears ${seen.get(date) ?? 0} times`);
  assert.equal(built.document.manifest.counts.home.daily_scores, dates.length);
  assert.deepEqual(dates, [...dates].sort());
});

// daily_maxima (0025) has no id: it pages on its composite primary key.

const HOME_A = contextId('alice', 1); // alice's current home in the isolation seed
const HOME_B = contextId('alice', 2);
const HOME_C = contextId('alice', 3);
/** A value per home and factor, so an exported row (which carries no home) still says which row it is. */
const MAXIMUM_VALUE = { air: { [HOME_A]: 10, [HOME_B]: 20, [HOME_C]: 30 }, uv: { [HOME_A]: 1.5, [HOME_B]: 2.5, [HOME_C]: 3.5 } };

const maximum = (owner, home, localDate, factor) => ({
  profile_id: owner, home_context_id: home, local_date: localDate, factor, value: MAXIMUM_VALUE[factor][home],
  unit: factor === 'air' ? 'AQI' : 'UV index', source_code: factor === 'air' ? 'open_meteo_cams' : 'open_meteo_forecast',
  station_id: null, method_version: 'daily-max-v1', time_zone: 'America/New_York', hours_expected: 24, hours_observed: 24,
  missing_code: null, retrieved_at: '2026-01-02T12:00:00Z',
});

const maximumDay = (i) => new Date(Date.UTC(2023, 0, 2) + i * 86_400_000).toISOString().slice(0, 10);

/**
 * `days` days of Air and UV maxima at each of alice's two homes, plus one
 * lone earlier Air row, so no page boundary (400 or 1,000 rows) falls between
 * two dates. Seeded newest first and, within a day, home B before A and UV
 * before Air, so only the composite ORDER BY puts them in key order.
 */
function manyMaxima(days) {
  return (seeded, ids) => {
    seeded.daily_maxima = seeded.daily_maxima.filter((row) => row.profile_id !== ids.alice.id);
    for (let i = days - 1; i >= 0; i -= 1) {
      for (const home of [HOME_B, HOME_A]) {
        for (const factor of ['uv', 'air']) seeded.daily_maxima.push(maximum(ids.alice.id, home, maximumDay(i), factor));
      }
    }
    seeded.daily_maxima.push(maximum(ids.alice.id, HOME_A, '2023-01-01', 'air'));
  };
}

/** An exported (or stored) maximum's identity: day, factor and the value that names its home. */
const maximumIdentity = (row) => `${row.local_date}|${row.factor}|${row.value}`;

/** Alice's stored maxima in file order (local_date, factor, home_context_id), sorted here independently of the builder. */
function storedMaxima(db, alice) {
  const key = (row) => [row.local_date, row.factor, row.home_context_id];
  return db.rows('daily_maxima').filter((row) => row.profile_id === alice.id).sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let at = 0; at < x.length; at += 1) if (x[at] !== y[at]) return x[at] < y[at] ? -1 : 1;
    return 0;
  });
}

for (const maxRows of [Infinity, 1000, 400]) {
  test(`daily_maxima: 1,205 maxima over two homes export every row once, in file order (PostgREST max_rows ${maxRows})`, async () => {
    const { db, alice } = world({ adjust: manyMaxima(301) });
    db.setMaxRows(maxRows);
    const stored = storedMaxima(db, alice);
    assert.equal(stored.length, 1205);
    assert.equal(new Set(stored.map(maximumIdentity)).size, 1205);
    assert.deepEqual(new Set(stored.map((row) => row.home_context_id)), new Set([HOME_A, HOME_B]));
    const built = await build(db, alice, ['home'], false);
    const rows = built.document.home.daily_maxima;
    assert.deepEqual(rows.map(maximumIdentity), stored.map(maximumIdentity));
    assert.equal(built.document.manifest.counts.home.daily_maxima, 1205);
    const pages = db.queryLog.filter((query) => query.table === 'daily_maxima');
    assert.equal(pages.length, Math.ceil(1205 / Math.min(maxRows, EXPORT_PAGE_SIZE)));
    // Every page after the first is the row comparison (a keyset page), never an offset.
    for (const page of pages.slice(1)) assert.ok(page.filters.some((filter) => filter.type === 'or'), JSON.stringify(page.filters));
  });
}

test('daily_maxima: a row written or deleted between pages never repeats or loses a row that was there before (N1, composite keyset)', async () => {
  const { db, alice } = world({ adjust: manyMaxima(301) });
  const before = storedMaxima(db, alice).map(maximumIdentity);
  // The first page (1,000 rows) is the lone row, 249 whole days, then 3 rows of maximumDay(249):
  // it ends inside that day, on (maximumDay(249), uv, home A).
  const cursorDay = maximumDay(249);
  const pages = betweenPages(db, 'daily_maxima', async (realFrom) => {
    // A third home's maxima land on the cursor's day, one key before the cursor and one after;
    // and two maxima already read are deleted, one on the cursor's own day. Offset paging would
    // shift every later row back and skip (maximumDay(249), uv, home B).
    db.seed('daily_maxima', [maximum(alice.id, HOME_C, cursorDay, 'air'), maximum(alice.id, HOME_C, cursorDay, 'uv')]);
    for (const [day, home] of [[cursorDay, HOME_A], [maximumDay(10), HOME_B]]) {
      const { error } = await realFrom('daily_maxima').delete().eq('home_context_id', home).eq('local_date', day).eq('factor', 'air');
      assert.equal(error, null);
    }
  });
  const built = await build(db, alice, ['home'], false);
  assert.equal(pages(), 2);
  const rows = built.document.home.daily_maxima.map(maximumIdentity);
  const seen = new Map();
  for (const identity of rows) seen.set(identity, (seen.get(identity) ?? 0) + 1);
  for (const identity of before) assert.equal(seen.get(identity), 1, `${identity} appears ${seen.get(identity) ?? 0} times`);
  assert.equal(seen.get(`${cursorDay}|uv|${MAXIMUM_VALUE.uv[HOME_C]}`), 1, 'the row written after the cursor is read once');
  assert.equal(built.document.manifest.counts.home.daily_maxima, rows.length);
  assert.ok(rows.every((identity) => seen.get(identity) === 1));
  const days = built.document.home.daily_maxima.map((row) => row.local_date);
  assert.deepEqual(days, [...days].sort());
});

test('keyAfter spells (k1, k2, k3) > (v1, v2, v3) as a PostgREST logic tree, every value quoted and escaped', async () => {
  assert.equal(keyAfter(['day'], ['2026-01-02']), 'day.gt."2026-01-02"');
  assert.equal(
    keyAfter(['a', 'b', 'c'], ['1', 'x,y.z', 'q"\\']),
    'a.gt."1",and(a.eq."1",b.gt."x,y.z"),and(a.eq."1",b.eq."x,y.z",c.gt."q\\"\\\\")',
  );
  // Against the fake's PostgREST parsing: values holding reserved characters still compare as one value.
  const rows = [['1', 'x,y.z', 'p'], ['1', 'x,y.z', 'q"\\'], ['1', 'x,y.z', 'r'], ['1', 'x,z', 'a'], ['0', 'zz', 'z'], ['2', 'a', 'a']]
    .map(([a, b, c], id) => ({ id, a, b, c }));
  const db = createFakeSupabase({ tables: { keyed: { primaryKey: ['a', 'b', 'c'] } }, seed: { keyed: rows } });
  const { data } = await db.from('keyed').select('id').or(keyAfter(['a', 'b', 'c'], ['1', 'x,y.z', 'q"\\'])).order('id');
  assert.deepEqual(data.map((row) => row.id), [2, 3, 5]);
});

/** Wraps `table`'s query builders so `change(builder)` can alter one before it runs. */
function alterBuilders(db, table, change) {
  const realFrom = db.from;
  db.from = (name) => {
    const builder = realFrom(name);
    if (name === table) change(builder);
    return builder;
  };
}

test('a composite page that does not advance fails the build rather than looping or repeating rows', async () => {
  const { db, alice } = world({ adjust: manyMaxima(301) });
  db.setMaxRows(400);
  // A server that ignored the row comparison would answer the first page again and again.
  alterBuilders(db, 'daily_maxima', (builder) => { builder.or = () => builder; });
  await assert.rejects(build(db, alice, ['home'], false), /daily_maxima paging did not advance/);
});

test('a composite page key column answered empty fails the build: the next page could not start after it', async () => {
  const { db, alice } = world({ adjust: manyMaxima(301) });
  db.setMaxRows(400);
  alterBuilders(db, 'daily_maxima', (builder) => {
    const realThen = builder.then.bind(builder);
    builder.then = (resolve, reject) => realThen((answer) => resolve({
      ...answer, data: answer.data?.map((stored) => Object.fromEntries(Object.entries(stored).filter(([column]) => column !== 'home_context_id'))) ?? null,
    }), reject);
  });
  await assert.rejects(build(db, alice, ['home'], false), /daily_maxima paging did not advance/);
});

test('a single-column page that does not advance fails the build too', async () => {
  const { db, alice } = world({ adjust: manyReadings(2500) });
  db.setMaxRows(400);
  alterBuilders(db, 'daily_scores', (builder) => { builder.gt = () => builder; });
  await assert.rejects(build(db, alice, ['home'], false), /daily_scores paging did not advance/);
});

test('a single-column page key pages exactly as before (one gt, one order); a composite one with the row comparison and one order per column', async () => {
  const { db, alice } = world({ adjust: (seeded, ids) => { manyReadings(1500)(seeded, ids); manyMaxima(301)(seeded, ids); } });
  const calls = { daily_scores: [], daily_maxima: [] };
  for (const table of Object.keys(calls)) {
    alterBuilders(db, table, (builder) => {
      const query = [];
      calls[table].push(query);
      for (const method of ['select', 'eq', 'gt', 'or', 'order', 'limit']) {
        const real = builder[method].bind(builder);
        builder[method] = (...args) => { query.push([method, ...args]); return real(...args); };
      }
    });
  }
  await build(db, alice, ['home'], false);
  for (const table of Object.keys(calls)) assert.equal(calls[table].length, 2, table);
  const partColumns = (table) => exportParts(['home'], false).find((part) => part.table === table).columns;
  const read = (table) => [...new Set([...partColumns(table), ...EXPORT_ORDER[table]])].join(', ');
  const scores = storedScoresById(db, alice);
  assert.deepEqual(calls.daily_scores[1], [
    ['select', read('daily_scores'), { count: 'exact' }],
    ['eq', 'profile_id', alice.id],
    ['gt', 'id', scores[EXPORT_PAGE_SIZE - 1].id],
    ['order', 'id', { ascending: true }],
    ['limit', EXPORT_PAGE_SIZE],
  ]);
  const cursor = storedMaxima(db, alice)[EXPORT_PAGE_SIZE - 1];
  assert.deepEqual(calls.daily_maxima[1], [
    ['select', read('daily_maxima'), { count: 'exact' }],
    ['eq', 'profile_id', alice.id],
    ['or', keyAfter(['local_date', 'factor', 'home_context_id'], [cursor.local_date, cursor.factor, cursor.home_context_id])],
    ['order', 'local_date', { ascending: true }],
    ['order', 'factor', { ascending: true }],
    ['order', 'home_context_id', { ascending: true }],
    ['limit', EXPORT_PAGE_SIZE],
  ]);
});

/** Alice's stored readings in page-key (id) order. */
const storedScoresById = (db, alice) => db.rows('daily_scores').filter((row) => row.profile_id === alice.id).sort((a, b) => (a.id < b.id ? -1 : 1));

test('an answer without an exact count fails the build rather than guessing from a short page (N2)', async () => {
  const { db, alice } = world({ adjust: manyReadings(2500) });
  db.setMaxRows(400);
  const realFrom = db.from;
  db.from = (name) => {
    const builder = realFrom(name);
    if (name !== 'daily_scores') return builder;
    const realThen = builder.then.bind(builder);
    builder.then = (resolve, reject) => realThen((answer) => resolve({ ...answer, count: null }), reject);
    return builder;
  };
  await assert.rejects(build(db, alice, ['home'], false), /without an exact count/);
});

test('a column retry starts the part\'s byte tally again, so an export that fits is not refused (N4)', async (t) => {
  t.mock.method(console, 'warn', () => {});
  // About 2.2 MB of alerts, just over one page: counting the first attempt's page twice would pass the cap.
  const message = 'm'.repeat(2100);
  const adjust = (seeded, ids) => {
    for (let n = 0; n < 1001; n += 1) {
      seeded.alerts.push({
        id: `a11ce000-1111-4000-8000-${(0x1000 + n).toString(16).padStart(12, '0')}`, profile_id: ids.alice.id,
        type: 'weather_advisory', title: 'Heat', message, dedupe_key: `bulk-${n}`, fired_at: '2026-09-01T10:00:00Z',
      });
    }
  };
  const plain = world({ adjust });
  const fits = await build(plain.db, plain.alice, ['home'], false);
  assert.equal(fits.tooLarge, false);
  const firstPage = 1000 * Buffer.byteLength(JSON.stringify(fits.document.home.alerts.find((row) => row.message === message)), 'utf8');
  assert.ok(fits.bytes + firstPage > EXPORT_MAX_RESPONSE_BYTES, 'the household is near enough the cap for the test to mean something');

  // The same household, on a deployment whose alerts lack `category`, discovered on the SECOND page.
  const { db, alice } = world({ adjust });
  const realFrom = db.from;
  let selects = 0;
  db.from = (name) => {
    const builder = realFrom(name);
    if (name !== 'alerts') return builder;
    const realSelect = builder.select.bind(builder);
    builder.select = (columns, options) => {
      if (String(columns).includes('category') && (selects += 1) === 2) {
        builder.then = (resolve, reject) => Promise.resolve({ data: null, count: null, error: pgError('42703', 'column alerts.category does not exist') }).then(resolve, reject);
      }
      return realSelect(columns, options);
    };
    return builder;
  };
  const retried = await build(db, alice, ['home'], false);
  assert.equal(selects, 2, 'the missing column was met on the second page');
  assert.equal(retried.tooLarge, false);
  assert.equal(retried.document.home.alerts.length, fits.document.home.alerts.length);
  assert.ok(retried.document.manifest.warnings.includes(EXPORT_COPY.missingColumn('alerts', 'category')));
});

test('a coordinate in any form that is not a number becomes null, never passed through (N4)', async () => {
  const { db, alice } = world({
    adjust: (seeded, ids) => {
      const context = seeded.home_contexts.find((row) => row.profile_id === ids.alice.id);
      context.lat = { point: '35.408812' };
      context.lng = true;
      const profile = seeded.profiles.find((row) => row.id === ids.alice.id);
      profile.lat = 'north';
      profile.lng = '';
    },
  });
  const built = await build(db, alice, ['home'], false);
  const [context] = built.document.home.home_contexts;
  assert.equal(context.lat, null);
  assert.equal(context.lng, null);
  assert.equal(built.document.home.profiles[0].lat, null);
  assert.equal(built.document.home.profiles[0].lng, null);
  assert.ok(!built.file.text.includes('35.408812'));
});

test('the review count counts each record once: the profile once across home and preferences, the login only with an email (N5)', async () => {
  const { db, alice } = world();
  const both = await build(db, alice, ['home', 'preferences'], false);
  const { counts } = both.document.manifest;
  assert.equal(counts.home.profiles, 1);
  assert.equal(counts.preferences.profiles, 1);
  const perGroup = Object.values(counts).flatMap((tables) => Object.values(tables)).reduce((a, b) => a + b, 0);
  assert.equal(both.total, perGroup - 1);
  assert.equal(both.document.manifest.records, both.total);
  const homeOnly = await build(db, alice, ['home'], false);
  const prefsOnly = await build(db, alice, ['preferences'], false);
  assert.equal(both.total, homeOnly.total + prefsOnly.total - 1);
  // Two parts of one table with disjoint row filters add up: season summaries and inbox alerts.
  const alerts = await build(db, alice, ['home', 'journal'], true);
  assert.equal(alerts.total, Object.values(alerts.document.manifest.counts).flatMap((tables) => Object.values(tables)).reduce((a, b) => a + b, 0) - 0);
  // The login is a record only when it has an address to export.
  assert.equal(prefsOnly.document.manifest.counts.preferences['auth.users'], 1);
  const anonymous = world({ identities: { alice: { email: null, emailConfirmedAt: null, isAnonymous: true } } });
  const anon = await build(anonymous.db, anonymous.alice, ['preferences'], false);
  assert.equal(anon.document.manifest.counts.preferences['auth.users'], 0);
  assert.equal(anon.total, prefsOnly.total - 1);
});

test('an oversize Luna history is tooLarge, with no document, and reading stops early', async () => {
  const big = 'x'.repeat(200_000);
  const { db, alice } = world({
    adjust: (seeded, ids) => {
      for (let n = 0; n < 30; n += 1) {
        seeded.luna_turns.push({
          id: `a11ce000-6666-4000-8000-${(100 + n).toString(16).padStart(12, '0')}`, conversation_id: seeded.luna_conversations[0].id,
          profile_id: ids.alice.id, seq: 100 + n, role: 'user', body: big, created_at: '2026-10-01T00:00:00Z',
        });
      }
    },
  });
  const built = await build(db, alice);
  assert.equal(built.tooLarge, true);
  assert.equal(built.document, null);
  assert.equal(built.file, null);
  // The table read after the oversize one never was.
  assert.ok(!db.queryLog.some((query) => query.table === 'luna_runs'));
});

test('the cap is on the serialized receipt, escaping included: rows under the cap whose file is over it are tooLarge', async () => {
  // Quotes double when the row is serialized and double again inside the receipt.
  const quotes = '"'.repeat(1_200_000);
  const { db, alice } = world({
    adjust: (seeded, ids) => {
      seeded.symptom_logs.push({ id: entryId('alice', 60), profile_id: ids.alice.id, entry_date: '2026-10-11', note: quotes });
    },
  });
  const built = await build(db, alice, ['journal'], true);
  assert.equal(built.tooLarge, true);
  assert.ok(built.bytes > EXPORT_MAX_RESPONSE_BYTES);
  // And just under: the same note at a quarter of the length fits.
  const small = world({
    adjust: (seeded, ids) => {
      seeded.symptom_logs.push({ id: entryId('alice', 60), profile_id: ids.alice.id, entry_date: '2026-10-11', note: '"'.repeat(300_000) });
    },
  });
  const fits = await build(small.db, small.alice, ['journal'], true);
  assert.equal(fits.tooLarge, false);
  assert.ok(fits.bytes <= EXPORT_MAX_RESPONSE_BYTES);
  assert.ok(fits.file.text.length <= 10 * 1024 * 1024, 'and far under the client\'s own limit');
});

test('exportFileName is the household\'s local date and passes the client\'s rule', () => {
  assert.equal(exportFileName(new Date('2026-10-20T02:00:00Z')), 'halo-export-2026-10-19.json');
  assert.equal(exportFileName(new Date('2026-10-20T02:00:00Z'), 'UTC'), 'halo-export-2026-10-20.json');
  assert.match(exportFileName(NOW), CLIENT_FILE_NAME);
  assert.equal(privacyLimitKey('abc'), 'privacy:abc');
});

test('the builder refuses a selection that is not a valid export (no groups, an unknown group, a non-boolean)', async () => {
  const { db, alice } = world();
  await assert.rejects(build(db, alice, [], true));
  await assert.rejects(build(db, alice, ['home', 'home'], true));
  await assert.rejects(build(db, alice, ['everything'], true));
  await assert.rejects(build(db, alice, ['home'], 'yes'));
  await assert.rejects(buildExportDocument(db, { groups: ['home'], privateText: true }));
});

// ---------------------------------------------------------------------------
// 5. The paging order against the schema, and the builder on real Postgres
// ---------------------------------------------------------------------------

let pg;
before(async () => {
  pg = await createDb();
});
after(async () => {
  await pg?.close();
});

test('every table the export pages has a page key (its order\'s last column, or a declared composite key) that is, with the owner, a unique key of the migrated schema', async () => {
  const paged = new Set(exportParts(ALL_GROUPS, true)
    .filter((part) => !part.countAs && !part.countOnly && part.table !== 'auth.users')
    .map((part) => part.table));
  assert.deepEqual([...paged].sort(), Object.keys(EXPORT_ORDER).sort());
  const { rows } = await pg.query(`
    select c.relname as table_name, array_agg(a.attname::text order by a.attname) as columns
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
     where i.indisunique and i.indpred is null
     group by c.relname, i.indexrelid`);
  // A composite page key is declared only for a table the export pages.
  for (const table of Object.keys(EXPORT_PAGE_KEYS)) assert.ok(Object.hasOwn(EXPORT_ORDER, table), `${table} has a page key but no order`);
  assert.ok(Object.hasOwn(EXPORT_PAGE_KEYS, 'daily_maxima'), 'daily_maxima (0025) has no id, so it needs its composite key');
  for (const [table, order] of Object.entries(EXPORT_ORDER)) {
    const owner = PRIVACY_INVENTORY[table].owner;
    const { rows: columns } = await pg.query(
      `select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = $1`, [table]);
    for (const column of order) assert.ok(columns.some((row) => row.column_name === column), `${table}.${column} does not exist`);
    const indexes = rows.filter((row) => row.table_name === table);
    if (!Object.hasOwn(EXPORT_PAGE_KEYS, table)) {
      // The page key alone (the last column), with the owner, must be unique: keyset pages compare only it.
      assert.deepEqual(pageKeyFor(table), [order[order.length - 1]]);
      const scope = new Set([order[order.length - 1], owner]);
      const unique = indexes.some((row) => row.columns.every((column) => scope.has(column)));
      assert.ok(unique, `${table}: ordering by ${order.join(', ')} within one household is not a unique page key`);
      continue;
    }
    // A composite page key: the row comparison is exact only if the key, with the owner, is EXACTLY
    // the columns of one unique index (no column missing, none extra), each NOT NULL, so no row's
    // comparison is unknown. It is only declared where one column cannot do it.
    const keys = pageKeyFor(table);
    assert.deepEqual(keys, EXPORT_PAGE_KEYS[table]);
    assert.ok(keys.length > 1 && new Set(keys).size === keys.length, `${table}: a composite page key names distinct columns`);
    const scope = new Set([...keys, owner]);
    const exact = indexes.some((row) => {
      const index = new Set([...row.columns, owner]);
      return index.size === scope.size && [...scope].every((column) => index.has(column));
    });
    assert.ok(exact, `${table}: the page key ${keys.join(', ')} with ${owner} is not exactly a unique key`);
    for (const column of keys) {
      const found = columns.find((row) => row.column_name === column);
      assert.ok(found, `${table}.${column} does not exist`);
      assert.equal(found.is_nullable, 'NO', `${table}.${column} may be null, so the row comparison could be unknown`);
    }
    const lastAlone = new Set([order[order.length - 1], owner]);
    assert.ok(!indexes.some((row) => row.columns.every((column) => lastAlone.has(column))), `${table}: one column would do; declare no composite key`);
  }
});

/**
 * The few query builder calls the export makes, run on PGlite as the service
 * role, answering as PostgREST does (rows through json_build_object, a
 * Postgres error as {code, message}). Anything else throws.
 */
function pgliteClient(db, { email = 'owner@example.test', maxRows = Infinity } = {}) {
  const ident = (name) => {
    const trimmed = String(name).trim();
    assert.match(trimmed, /^[a-z_][a-z0-9_]*$/);
    return `"${trimmed}"`;
  };
  const LOGIC_OPS = { eq: '=', gt: '>' };
  /** Commas outside parentheses and double quotes (a quoted value may hold either). */
  const splitTree = (text) => {
    const parts = [];
    let depth = 0;
    let quoted = false;
    let current = '';
    for (let at = 0; at < text.length; at += 1) {
      const char = text[at];
      if (quoted && char === '\\') { current += char + text[at + 1]; at += 1; continue; }
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === '(') depth += 1;
      else if (!quoted && char === ')') depth -= 1;
      if (!quoted && depth === 0 && char === ',') { parts.push(current); current = ''; } else current += char;
    }
    parts.push(current);
    return parts;
  };
  /**
   * A PostgREST logic tree as SQL, as PostgREST reads one: `column.op.value`
   * terms and `and(...)`/`or(...)` groups, a double-quoted value unquoted with
   * its backslash escapes removed. Only eq and gt are needed; anything else throws.
   */
  const logicTree = (text, joiner, param) => `(${splitTree(text).map((term) => {
    const group = /^(and|or)\((.*)\)$/s.exec(term);
    if (group) return logicTree(group[2], group[1], param);
    const match = /^([a-z_][a-z0-9_]*)\.(eq|gt)\.(.*)$/s.exec(term);
    assert.ok(match, `pgliteClient: logic tree term "${term}" is not modelled`);
    const quoted = /^"((?:[^"\\]|\\.)*)"$/s.exec(match[3]);
    const value = quoted ? quoted[1].replace(/\\(.)/gs, '$1') : match[3];
    return `${ident(match[1])} ${LOGIC_OPS[match[2]]} ${param(value)}`;
  }).join(` ${joiner} `)})`;
  return {
    from(table) {
      const state = { columns: null, head: false, count: null, where: [], params: [], orders: [], offset: 0, limit: null };
      const param = (value) => { state.params.push(value); return `$${state.params.length}`; };
      const add = (sql, value) => { state.where.push(sql.replace('?', param(value))); return builder; };
      const builder = {
        select(columns, { count = null, head = false } = {}) {
          state.columns = String(columns).split(',').map(ident);
          state.count = count;
          state.head = head;
          return builder;
        },
        eq: (column, value) => add(`${ident(column)} = ?`, value),
        gt: (column, value) => add(`${ident(column)} > ?`, value),
        neq: (column, value) => add(`${ident(column)} <> ?`, value),
        in: (column, values) => add(`${ident(column)} = any(?)`, values),
        or(tree) { state.where.push(logicTree(tree, 'or', param)); return builder; },
        order(column, { ascending = true } = {}) { state.orders.push(`${ident(column)} ${ascending ? 'asc' : 'desc'}`); return builder; },
        limit(count) { state.limit = count; return builder; },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      async function run() {
        const where = state.where.length ? ` where ${state.where.join(' and ')}` : '';
        try {
          return await db.asService(async (tx) => {
            const count = state.count === 'exact'
              ? (await tx.query(`select count(*)::int as n from public.${ident(table)}${where}`, state.params)).rows[0].n
              : null;
            if (state.head) return { data: null, count, error: null };
            const fields = state.columns.map((column) => `'${column.slice(1, -1)}', ${column}`).join(', ');
            const order = state.orders.length ? ` order by ${state.orders.join(', ')}` : '';
            // PostgREST's max_rows caps what a select returns, whatever it asked for; the count is still exact.
            const cap = Math.min(state.limit ?? Infinity, maxRows);
            const page = cap === Infinity ? '' : ` limit ${cap} offset ${state.offset}`;
            const { rows } = await tx.query(`select json_build_object(${fields}) as row from public.${ident(table)}${where}${order}${page}`, state.params);
            return { data: rows.map((row) => row.row), count, error: null };
          });
        } catch (error) {
          return { data: null, count: null, error: { code: error.code ?? null, message: error.message } };
        }
      }
      return builder;
    },
    auth: { admin: { getUserById: async (id) => ({ data: { user: { id, email, email_confirmed_at: CONFIRMED } }, error: null }) } },
  };
}

/** What the Postgres run seeds per household, parents before children: [table, the `n` of each row]. */
const SEED_PLAN = [
  ['home_contexts', [0, 1]],
  ['luna_conversations', [0]],
  ['luna_turns', [0, 1]],
  ['luna_runs', [0]],
  ['daily_scores', [0, 1]],
  ['home_risks', [0]],
  ['household_bands', [0]],
  ['symptom_logs', [0, 1]],
  ['alerts', [0, 1]],
  ['notification_prefs', [0]],
  ['push_subscriptions', [0, 1]],
  ['profile_preferences', [0]],
  ['explore_areas', [0]],
  ['household_actions', [0, 1]],
  ['household_action_preferences', [0, 1]],
  // 0025: two days at the current home and one at the earlier home (below), after home_contexts.
  ['daily_maxima', [0, 1, 2]],
  // 0026: a tests record and an exploreNotes record, one in each export group.
  ['household_workspace_records', [0, 1]],
];

test('on real Postgres: every allowlisted column, filter and order runs, and every seeded row of the household is exported', async () => {
  const owner = 'e1000000-0000-4000-8000-0000000000e1';
  const other = 'e2000000-0000-4000-8000-0000000000e2';
  await pg.exec(`insert into auth.users (id, is_anonymous) values ('${owner}', false), ('${other}', false) on conflict do nothing`);
  const insert = async (table, row) => {
    const columns = Object.keys(row);
    const values = Object.values(row).map((value) => (value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value));
    await pg.asService((tx) => tx.query(
      `insert into public."${table}" (${columns.map((c) => `"${c}"`).join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`,
      values,
    ), { commit: true });
  };
  for (const who of [owner, other]) {
    await pg.asService((tx) => tx.query(`update public.profiles set lat = 35.408812, lng = -80.579524, county = 'Test County', tenure = 'owner' where id = $1`, [who]), { commit: true });
    // Parents first (0016, 0020 foreign keys); two rows where a table holds many, one where it holds one.
    for (const [table, ns] of SEED_PLAN) {
      for (const n of ns) {
        const row = OWNED_ROW[table](who, n);
        if (table === 'alerts' && n === 1) row.type = 'season_summary';
        if (table === 'luna_runs') Object.assign(row, { status: 'completed', settled_at: '2026-09-10T00:00:00Z' });
        if (table === 'daily_maxima' && n === 2) row.home_context_id = homeContextId(who, 1);
        await insert(table, row);
      }
    }
  }
  // Every exported owned table is seeded, so no part is checked against an empty table.
  const seeded = new Set(SEED_PLAN.map(([table]) => table));
  for (const table of Object.keys(OWNED_TABLES)) {
    if (PRIVACY_INVENTORY[table].export.excluded || table === 'profiles') continue;
    assert.ok(seeded.has(table), `${table} is not seeded`);
  }
  assert.equal(lunaId(owner, 'c0de').length, 36);

  const built = await buildExportDocument(pgliteClient(pg), { profileId: owner, groups: ALL_GROUPS, privateText: true, now: NOW });
  assert.equal(built.tooLarge, false);
  assert.deepEqual(built.document.manifest.warnings.filter((line) => line.includes('not stored on this deployment')), []);
  const counted = async (table, extra = '') => (await pg.query(`select count(*)::int as n from public."${table}" where ${PRIVACY_INVENTORY[table].owner} = $1${extra}`, [owner])).rows[0].n;
  const { counts } = built.document.manifest;
  assert.equal(counts.home.daily_scores, await counted('daily_scores'));
  assert.equal(counts.journal.symptom_logs, await counted('symptom_logs'));
  assert.equal(counts.journal.alerts, await counted('alerts', ` and type = 'season_summary'`));
  assert.equal(counts.home.alerts, await counted('alerts', ` and type <> 'season_summary'`));
  assert.equal(counts.conversation.luna_turns, await counted('luna_turns'));
  assert.equal(counts.tasks.household_actions, await counted('household_actions'));
  assert.equal(counts.tasks.household_action_preferences, await counted('household_action_preferences'));
  assert.equal(counts.preferences.push_subscriptions, await counted('push_subscriptions'));
  assert.ok(counts.home.daily_scores >= 2 && counts.tasks.household_action_preferences === 2);
  // 0025: every maximum of both homes, in file order, the allowlist only (no home, station or coverage).
  assert.equal(counts.home.daily_maxima, await counted('daily_maxima'));
  assert.equal(counts.home.daily_maxima, 3);
  assert.deepEqual(built.document.home.daily_maxima.map((row) => [row.local_date, row.value]), [['2026-09-10', 40], ['2026-09-11', 41], ['2026-09-12', 42]]);
  for (const row of built.document.home.daily_maxima) {
    assert.deepEqual(Object.keys(row).sort(), [...PRIVACY_INVENTORY.daily_maxima.export.parts[0].base].sort());
  }
  assert.equal(built.document.home.profiles[0].lat, 35.409);
  assert.equal(built.document.home.profiles[0].tenure, 'owner');
  const keys = allKeys(built.document);
  for (const denied of DENIED_KEYS) assert.ok(!keys.has(denied), denied);
  assert.ok(!built.file.text.includes(other) && !built.file.text.includes(owner));
});

test('on real Postgres: daily_maxima pages on its composite key at max_rows 5, two homes, every row once in file order, a row written between pages included once', async () => {
  const owner = 'e3000000-0000-4000-8000-0000000000e3';
  const other = 'e4000000-0000-4000-8000-0000000000e4';
  await pg.exec(`insert into auth.users (id, is_anonymous) values ('${owner}', false), ('${other}', false) on conflict do nothing`);
  const insert = (row) => pg.asService((tx) => tx.query(
    `insert into public.daily_maxima (${Object.keys(row).map((c) => `"${c}"`).join(', ')}) values (${Object.keys(row).map((_, at) => `$${at + 1}`).join(', ')})`,
    Object.values(row),
  ), { commit: true });
  // 7 days x 2 factors x 2 homes = 28 rows a household; 4 a day, so pages of 5 end inside a day.
  // The value names the row (day, factor, home), as the export carries no home.
  const valueOf = (day, factor, home) => day * 10 + (factor === 'uv' ? 2 : 0) + home;
  const row = (who, day, factor, home) => ({
    ...OWNED_ROW.daily_maxima(who, 0), home_context_id: homeContextId(who, home), local_date: `2026-08-0${day}`, factor,
    value: valueOf(day, factor, home), unit: factor === 'air' ? 'AQI' : 'UV index',
    source_code: factor === 'air' ? 'open_meteo_cams' : 'open_meteo_forecast',
  });
  for (const who of [owner, other]) {
    for (const n of [0, 1]) {
      const home = OWNED_ROW.home_contexts(who, n);
      await pg.asService((tx) => tx.query(
        `insert into public.home_contexts (${Object.keys(home).map((c) => `"${c}"`).join(', ')}) values (${Object.keys(home).map((_, at) => `$${at + 1}`).join(', ')})`,
        Object.values(home).map((value) => (value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value)),
      ), { commit: true });
    }
    // Inserted newest day first, home 1 before home 0 and UV before Air: only ORDER BY sorts them.
    // Two of the owner's rows are held back, to be written between pages.
    for (let day = 7; day >= 1; day -= 1) {
      for (const home of [1, 0]) {
        for (const factor of ['uv', 'air']) {
          const late = who === owner && home === 1 && factor === 'uv' && (day === 1 || day === 5);
          if (!late) await insert(row(who, day, factor, home));
        }
      }
    }
  }
  assert.ok(homeContextId(owner, 0) < homeContextId(owner, 1));
  const expected = [];
  for (let day = 1; day <= 7; day += 1) for (const factor of ['air', 'uv']) for (const home of [0, 1]) expected.push(valueOf(day, factor, home));

  // Page one (5 rows) is day 1's air 0, air 1, uv 0, then day 2's air 0 and air 1; the cursor is
  // (day 2, air, home 1). Between pages one and two: (day 1, uv, home 1) is written BEFORE the
  // cursor and (day 5, uv, home 1) after it, and (day 1, air, home 0), already read, is deleted.
  const client = pgliteClient(pg, { maxRows: 5 });
  const realFrom = client.from;
  let pages = 0;
  client.from = (table) => {
    const builder = realFrom(table);
    if (table !== 'daily_maxima') return builder;
    const realThen = builder.then;
    builder.then = (resolve, reject) => realThen(async (answer) => {
      pages += 1;
      if (pages === 1) {
        await insert(row(owner, 1, 'uv', 1));
        await insert(row(owner, 5, 'uv', 1));
        await pg.asService((tx) => tx.query(
          `delete from public.daily_maxima where profile_id = $1 and local_date = '2026-08-01' and factor = 'air' and home_context_id = $2`,
          [owner, homeContextId(owner, 0)],
        ), { commit: true });
      }
      return resolve(answer);
    }, reject);
    return builder;
  };
  const built = await buildExportDocument(client, { profileId: owner, groups: ['home'], privateText: false, now: NOW });
  // 26 rows to start; after page one, 21 of them remain after the cursor, plus the one written after it.
  assert.equal(pages, 1 + Math.ceil(22 / 5));
  const values = built.document.home.daily_maxima.map((exported) => exported.value);
  // Every row there before the export is there exactly once (the deleted one was read first), the row
  // written after the cursor once, the one written before it not at all; in file order. No other household.
  assert.deepEqual(values, expected.filter((value) => value !== valueOf(1, 'uv', 1)));
  assert.equal(built.document.manifest.counts.home.daily_maxima, 27);
});

// ---------------------------------------------------------------------------
// 6. The clear preview
// ---------------------------------------------------------------------------

test('the journal preview: symptom logs and season summaries under journal, the sum equal to the count', () => {
  const preview = buildClearPreview({ scope: 'journal', counts: { symptom_logs: 4, alerts: 2 } });
  assert.deepEqual(preview.remove, { journal: 6 });
  assert.equal(clearTotal({ symptom_logs: 4, alerts: 2 }), 6);
  assert.ok(preview.keep.includes(EXPORT_COPY.keepOutsideJournal));
  assert.ok(preview.keep.includes(EXPORT_COPY.keepLogin) && preview.keep.includes(EXPORT_COPY.keepReceipt));
  assert.deepEqual(preview.notStored, [INVENTORY_COPY.weekJournalNotStored]);
  assert.deepEqual(preview.limits, [EXPORT_COPY.limitDownloads, EXPORT_COPY.limitBackups]);
  assert.ok(!('after' in preview));
  assert.deepEqual(buildClearPreview({ scope: 'journal', counts: { symptom_logs: 0, alerts: 0 } }).remove, { journal: 0 });
});

test('the all preview: every counted table in a bucket, an unknown one under other, and the buckets add up to the count', () => {
  const counts = Object.fromEntries(Object.keys(CLEAR_PREVIEW_BUCKETS).map((table, at) => [table, at + 1]));
  counts.some_future_table = 5;
  const preview = buildClearPreview({ scope: 'all', counts });
  const sum = Object.values(preview.remove).reduce((a, b) => a + b, 0);
  assert.equal(sum, clearTotal(counts));
  assert.equal(preview.remove.other, 5);
  assert.equal(preview.remove.journal, counts.symptom_logs);
  assert.equal(preview.remove.alerts, counts.alerts);
  assert.equal(preview.remove.requests, counts.operations);
  assert.deepEqual(preview.after, [EXPORT_COPY.afterAll]);
  assert.ok(!preview.keep.includes(EXPORT_COPY.keepOutsideJournal));
  // Every table the clear counts (0024 privacy_counts) has a bucket.
  const sql = readFileSync(new URL('../supabase/migrations/0024_privacy_clear.sql', import.meta.url), 'utf8');
  const countsAll = sql.slice(sql.indexOf('create or replace function public.privacy_counts'));
  const body = countsAll.slice(0, countsAll.indexOf('$$;'));
  // A count is a subquery, or (daily_maxima, 0025 optional) a variable counted above the object.
  const named = [...body.matchAll(/^\s*'([a-z_]+)', (?:\(select count|[a-z_]+\s*$)/gm)].map((match) => match[1]);
  assert.ok(named.length >= 19, `found ${named.length} counted tables in 0024`);
  assert.ok(named.includes('daily_maxima'));
  assert.equal(CLEAR_PREVIEW_BUCKETS.daily_maxima, 'home');
  for (const table of named) assert.ok(Object.hasOwn(CLEAR_PREVIEW_BUCKETS, table), `${table} has no preview bucket`);
  assert.throws(() => buildClearPreview({ scope: 'export', counts }));
});
