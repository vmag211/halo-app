/**
 * POST /api/privacy/clear (`privacy.clear`, B07 plan, Task 6) with the
 * database below it REAL: migration 0024's clear_household_records,
 * privacy_fingerprint and privacy_schema_version, and the 0017 ledger with
 * 0024's settled-privacy guard, all on PGlite (test/db/pgliteHarness.mjs).
 * The B06 pattern (test/routesActionsCommitDb.test.mjs,
 * test/helpers/actionsWorld.mjs): the real route handlers on the isolated
 * route harness, the ledger through test/db/pgliteLedger.mjs, and every 0024
 * function called by argument name as PostgREST calls it. Before each clear
 * the operation's ledger row is mirrored into PGlite (insert if absent), the
 * actionsWorld step, which is a no-op here because the ledger already is
 * PGlite's.
 *
 * The other routes this file calls afterwards (profile, settings, alerts, My
 * Week, Luna) read the household tables through the fake client. So the fake
 * holds a copy of PGlite's rows for both households, taken after the seed and
 * again after every clear call, whatever it answered: what those routes read
 * is what the real function left.
 *
 * THE CLIENT'S OWN CONSUMPTION LOGIC IS RUN: every answer goes through the
 * runtime's status mapping and into the panel's `accept`, transcribed
 * verbatim from ProductionPrivacy.tsx:23 (test/helpers/privacyClearClient.mjs),
 * and each scenario ends in an assertion on what the panel then shows and
 * whether it is locked.
 *
 * Everything is local: synthetic identities, PGlite, and a fetch that throws
 * on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { HALO_TABLES, OWNED_TABLES } from './helpers/tables.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteLedger } from './db/pgliteLedger.mjs';
import { OWNED_ROW } from './db/ownedRows.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { installSettingsDb } from './helpers/fakeSettingsDb.mjs';
import { validAlertSnapshot, validSettingsSnapshot } from './helpers/frontendB04.mjs';
import { validActionSnapshot } from './helpers/frontendB06.mjs';
import { MESSAGES, privacyPanel } from './helpers/privacyClearClient.mjs';
import { OWN_OPERATION, clearActionFor, fingerprintTables } from '../lib/privacyInventory.js';
import { mintReviewToken } from '../lib/privacyToken.js';

const { requestHash } = await import('../lib/operations.js');

const KEY = 'privacy-review-key-for-tests-only-0123456789';
const ENV = Object.freeze({ HALO_PRIVACY_REVIEW_KEY: KEY, HALO_FEATURE_TASKS: 'on', HALO_FEATURE_LUNA: 'on' });
const ROUTE = '/api/privacy/clear';
const NOTE = 'PRIVATE-NOTE-MARKER the inhaler is in the blue bag';
const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Every owned table but the ledger, which the routes reach on PGlite itself. */
const MIRRORED = Object.keys(OWNED_TABLES).filter((table) => table !== 'operations');
/** Parents before children (foreign keys), then the rest. */
const ORDER = ['profiles', 'home_contexts', 'luna_conversations', 'luna_turns', ...MIRRORED].filter((table, at, all) => all.indexOf(table) === at);

const ident = (name) => {
  assert.match(name, IDENT);
  return `"${name}"`;
};

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

// ---------------------------------------------------------------------------
// Seed: rows in every owned table, several where a table allows it
// ---------------------------------------------------------------------------

const PROFILE = { address: '1 Test Street', lat: 35.409, lng: -80.581, zip: '28025', county: 'Cabarrus County', pwsid: 'NC9990001', water_source: 'municipal', home_year: 1981, renter_mode: true, locale: 'es', state: 'NC', tenure: 'renter' };
const VARIANTS = { daily_scores: [0, 1, 2], symptom_logs: [0, 1, 2], alerts: [0, 1], push_subscriptions: [0, 1], home_contexts: [0, 1], recovery_challenges: [0, 1], luna_turns: [0, 1], luna_runs: [0, 1], household_actions: [0, 1, 2], household_action_preferences: [0, 1] };
const contextId = (owner, n) => `${owner.slice(0, 24)}00000000c${n}0${n}`.slice(0, 36);

function seedRows(table, owner) {
  if (table === 'profiles') return [];
  if (table === 'operations') {
    // Settled only: a pending row of the household refuses clear all (busy).
    return [
      { ...OWNED_ROW.operations(owner), status: 'succeeded', result: { status: 'succeeded', affected: [] } },
      { ...OWNED_ROW.operations(owner), domain: 'settings', kind: 'settings.save', status: 'failed' },
    ];
  }
  const rows = (VARIANTS[table] ?? [0]).map((n) => {
    const row = OWNED_ROW[table](owner, n);
    if (table === 'home_contexts') return { ...row, id: contextId(owner, n) };
    if (table === 'luna_runs') return { ...row, status: 'completed', settled_at: '2026-09-10T00:00:00Z' };
    if (table === 'daily_scores' && n === 2) return { ...row, home_context_id: contextId(owner, 0) };
    if (table === 'symptom_logs' && n === 0) return { ...row, note: NOTE };
    return row;
  });
  if (table === 'alerts') {
    rows.push({ profile_id: owner, type: 'season_summary', title: 'Your fall summary', message: 'This fall you logged 3 days.', dedupe_key: 'season_summary:fall:2026' });
  }
  return rows;
}

async function insertRow(tx, table, row) {
  const columns = Object.keys(row);
  const values = Object.values(row).map((value) => (value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value));
  await tx.query(`insert into public.${ident(table)} (${columns.map(ident).join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`, values);
}

async function seedHousehold(owner) {
  await db.asService(async (tx) => {
    const sets = Object.keys(PROFILE).map((column, at) => `${ident(column)} = $${at + 2}`);
    await tx.query(`update public.profiles set ${sets.join(', ')} where id = $1`, [owner, ...Object.values(PROFILE)]);
    for (const table of ['home_contexts', 'luna_conversations', 'luna_turns', ...Object.keys(OWNED_TABLES)].filter((t, at, all) => all.indexOf(t) === at)) {
      for (const row of seedRows(table, owner)) await insertRow(tx, table, row);
    }
  }, { commit: true });
}

/** Every row of `owner` in `table` as PostgREST would send it, sorted by its JSON text. */
async function pgRows(table, owner) {
  const { rows } = await db.query(`select row_to_json(t) as row from public.${ident(table)} t where t.${ident(OWNED_TABLES[table])} = $1 order by row_to_json(t)::text`, [owner]);
  return rows.map((row) => row.row);
}

/** A byte-for-byte picture of a household: every owned table, and its auth.users row. */
async function picture(owner) {
  const out = {};
  for (const table of Object.keys(OWNED_TABLES)) out[table] = (await pgRows(table, owner)).map((row) => JSON.stringify(row));
  out['auth.users'] = (await db.query('select row_to_json(u)::text as row from auth.users u where u.id = $1', [owner])).rows.map((row) => row.row);
  return out;
}

const ledgerRow = async (operationId) =>
  (await db.query('select operation_id::text, profile_id::text, domain, kind, status, result from public.operations where operation_id = $1', [operationId])).rows[0] ?? null;

// ---------------------------------------------------------------------------
// The world: two fresh households, the route harness, the 0024 functions
// ---------------------------------------------------------------------------

/** Calls public.<name> with every argument by name, as the service role, committed; a refusal comes back as PostgREST passes it. */
async function callByName(name, args) {
  assert.match(name, IDENT);
  const entries = Object.entries(args);
  for (const [arg] of entries) assert.match(arg, IDENT);
  try {
    return await db.asService(async (tx) => (await tx.query(
      `select public.${name}(${entries.map(([arg], at) => `${arg} => $${at + 1}`).join(', ')}) as data`,
      entries.map(([, value]) => value),
    )).rows[0].data, { commit: true });
  } catch (error) {
    throw rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);
  }
}

let worlds = 0;

/**
 * @param {{ onClear?: (args, call) => Promise<unknown> }} [options] wraps the
 *   real clear: a test can change the database first, or call through and
 *   then lose the answer.
 */
async function createWorld({ onClear } = {}) {
  worlds += 1;
  // Distinct leading characters: the seed derives home and Luna ids from an owner's first 24.
  const alice = `${(0xa1100000 + worlds).toString(16)}-0000-4000-8000-00000000000a`;
  const bob = `${(0xb0b00000 + worlds).toString(16)}-0000-4000-8000-00000000000b`;
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${alice}', true), ('${bob}', true);`);
  await seedHousehold(alice);
  await seedHousehold(bob);

  const tables = Object.fromEntries(Object.entries(HALO_TABLES).filter(([name]) => name !== 'operations'));
  const h = createRouteHarness({ tables, env: ENV, identities: { alice: { id: alice }, bob: { id: bob } } });
  const fakeFrom = h.db.from;
  h.db.from = (name) => (name === 'operations' ? pgliteLedger(db, name, h.db.queryLog) : fakeFrom(name));
  installSettingsDb(h.db);

  /** The fake's household tables become exactly what PGlite holds. Not logged: no route ran it. */
  const mirrorTables = async () => {
    const mark = h.db.queryLog.length;
    for (const owner of [alice, bob]) {
      for (const table of [...ORDER].reverse()) await fakeFrom(table).delete().eq(OWNED_TABLES[table], owner);
      for (const table of ORDER) {
        const rows = await pgRows(table, owner);
        if (rows.length) h.db.seed(table, rows);
      }
    }
    h.db.queryLog.splice(mark);
  };
  await mirrorTables();

  /**
   * actionsWorld's mirror: the fake ledger's row for this operation into
   * PGlite if absent, so the real function finds it. The ledger here is
   * PGlite's (operations is not declared on the fake), so there is none.
   */
  const mirrorLedgerRow = async (operationId) => {
    let fakeRows;
    try { fakeRows = h.db.rows('operations'); } catch { return; }
    const row = fakeRows.find((item) => item.operation_id === operationId);
    if (!row) return;
    await db.query(
      `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, result, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) on conflict (operation_id) do nothing`,
      [row.operation_id, row.profile_id, row.domain, row.kind, row.status, row.request_hash, row.result == null ? null : JSON.stringify(row.result), row.created_at],
    );
  };

  const clearCalls = [];
  const clear = async (args) => {
    clearCalls.push(args);
    await mirrorLedgerRow(args.p_operation_id);
    try {
      return await callByName('clear_household_records', args);
    } finally {
      await mirrorTables();
    }
  };

  h.db.registerRpc('privacy_schema_version', () => callByName('privacy_schema_version', {}), { args: [] });
  h.db.registerRpc('privacy_fingerprint', (args) => callByName('privacy_fingerprint', args), { args: ['p_profile_id', 'p_tables'] });
  h.db.registerRpc('clear_household_records', (args) => (onClear ? onClear(args, () => clear(args)) : clear(args)), {
    args: ['p_profile_id', 'p_operation_id', 'p_scope', 'p_fingerprint'],
  });
  h.db.registerRpc('read_household_actions', (args) => callByName('read_household_actions', args), { args: ['p_profile_id'] });
  // privacy.status purges the household's own settled receipts first (P10).
  h.db.registerRpc('purge_privacy_receipts', (args) => callByName('purge_privacy_receipts', args), { args: ['p_profile_id'] });

  const ids = { alice, bob };
  const world = {
    h, ids, alice, bob, clearCalls,
    /** A review token as inspect would mint it now, over the household's current records. */
    async review(who = 'alice', { scope = 'all', groups = ['tasks'], privateText = false } = {}) {
      const owner = ids[who];
      const fingerprint = await callByName('privacy_fingerprint', { p_profile_id: owner, p_tables: fingerprintTables(scope, groups) });
      return mintReviewToken(KEY, { profileId: owner, scope, groups, privateText, fingerprint }).reviewToken;
    },
    /** POST the body as `as`, with Idempotency-Key equal to its operationId unless `key` says otherwise. */
    clear(body, { as = 'alice', key = body?.operationId, headers = {} } = {}) {
      return h.call(ROUTE, 'POST', {
        as,
        rawBody: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(key == null ? {} : { 'idempotency-key': key }), ...headers },
      });
    },
    reconcileRead: (as = 'alice') => (operationId) => h.call('/api/operations', 'GET', { as, url: `/api/operations?operationId=${operationId}&domain=privacy` }),
    picture: (who = 'alice') => picture(ids[who] ?? who),
    get: (route, as = 'alice') => h.call(route, 'GET', { as }),
  };
  return world;
}

/** The panel's confirm for a review of `scope`: send, then accept or catch, as ProductionPrivacy.tsx:24 does. */
async function confirm(w, scope, reviewToken, { as = 'alice', operationId = crypto.randomUUID(), panel = privacyPanel() } = {}) {
  panel.review = { scope };
  const response = await w.clear({ reviewToken, scope, operationId }, { as });
  const unread = response.clone();
  const body = await response.clone().json();
  await panel.answer(response, scope, operationId);
  return { response: unread, body, panel, operationId };
}

/** Every row of a picture as an object. */
const parsed = (rows) => rows.map((row) => JSON.parse(row));

/** Whether a row matches every condition of an inventory filter (OWN_OPERATION is this clear's id). */
function matches(row, where, operationId) {
  return [].concat(where).every(({ column, equals, notEquals }) => {
    const value = (v) => (v === OWN_OPERATION ? operationId : v);
    if (equals !== undefined) return row[column] === value(equals);
    return row[column] !== value(notEquals);
  });
}

/**
 * The inventory's end state for alice's household after a clear of `scope`,
 * table by table over OWNED_TABLES (so an unplaced table fails here), and
 * bob's household byte-identical.
 */
async function assertCleared(w, scope, operationId, beforeAlice, beforeBob) {
  const now = await w.picture('alice');
  for (const table of Object.keys(OWNED_TABLES)) {
    const action = clearActionFor(table, scope);
    assert.ok(action, `${table} has no ${scope} placement in lib/privacyInventory.js`);
    let rows = parsed(now[table]);
    const was = parsed(beforeAlice[table]);
    if (table === 'operations') {
      const own = rows.filter((row) => row.operation_id === operationId);
      assert.equal(own.length, 1, 'the clear\'s own receipt survives (P4)');
      assert.equal(own[0].status, 'succeeded');
      assert.deepEqual(own[0].result, { operationId, status: 'succeeded', scope }, 'the minimal receipt, nothing else (P10)');
      rows = rows.filter((row) => row.operation_id !== operationId);
    }
    if (action.action === 'keep') assert.deepEqual(rows, was, `${table}: kept unchanged`);
    else if (action.action === 'delete') assert.deepEqual(rows, [], `${table}: every row deleted`);
    else if (action.action === 'delete-filtered') {
      assert.deepEqual(rows, was.filter((row) => !matches(row, action.where, operationId)), `${table}: only the filtered rows deleted`);
      assert.ok(was.some((row) => matches(row, action.where, operationId)), `${table}: the seed had a row to delete`);
    } else if (action.action === 'reset') {
      assert.equal(rows.length, 1, `${table}: the row survives`);
      const [row] = rows;
      const [old] = was;
      assert.deepEqual([row.id, row.created_at], [old.id, old.created_at], 'id and created_at unchanged');
      for (const [column, value] of Object.entries(action.columns)) assert.deepEqual(row[column], value, `profiles.${column} reset`);
      assert.deepEqual(Object.keys(row).sort(), [...Object.keys(action.columns), 'id', 'created_at'].sort(), 'every profiles column is accounted for');
    } else assert.fail(`${table}: unknown action ${action.action}`);
  }
  assert.deepEqual(now['auth.users'], beforeAlice['auth.users'], 'the login survives (D-P1)');
  assert.deepEqual(await w.picture('bob'), beforeBob, 'bob is untouched, byte for byte');
}

/**
 * GET /api/privacy/status (Task 3) answers exactly {"unresolvedOperations":[]}
 * with 200, which the panel's `verified` (ProductionPrivacy.tsx:18) accepts
 * with no lock, and the clear's own receipt is still there to reconcile.
 */
async function assertStatusEmpty(w, who = 'alice') {
  const response = await w.get('/api/privacy/status', who);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"unresolvedOperations":[]}');
}

/** Alice's picture equals `before`, the clear's own failed ledger row aside: nothing was deleted. */
async function assertUnchanged(w, before, operationId) {
  const now = await w.picture('alice');
  now.operations = now.operations.filter((row) => JSON.parse(row).operation_id !== operationId);
  assert.deepEqual(now, before, 'nothing of alice\'s changed');
}

// ---------------------------------------------------------------------------
// Clear all and Clear Journal, end to end
// ---------------------------------------------------------------------------

test('clear all: succeeded, "Your records were cleared.", the inventory\'s end state, and every surface then reads empty', async () => {
  const w = await createWorld();
  const profileBefore = await (await w.get('/api/profile')).json();
  assert.equal(profileBefore.onboarded, true, 'the precondition: an onboarded household');
  const beforeAlice = await w.picture('alice');
  const beforeBob = await w.picture('bob');
  assert.ok(Object.keys(OWNED_TABLES).every((table) => beforeAlice[table].length > 0), 'the precondition: alice has rows in every owned table');

  // The client's default selection is ['tasks']; a clear's tables do not depend on it.
  const { response, body, panel, operationId } = await confirm(w, 'all', await w.review('alice'));
  assert.equal(response.status, 200);
  assert.deepEqual(body, { operationId, status: 'succeeded', scope: 'all' }, 'no data key, no unresolvedOperations');
  assert.deepEqual([panel.message, panel.unknown, panel.review], [MESSAGES.cleared, null, null]);
  assert.deepEqual(panel.drafts, {}, 'the client clears every local draft on clear all');
  assert.deepEqual([panel.workspaceRetries, panel.taskReloads, panel.statusRetries], [1, 1, 1]);

  await assertCleared(w, 'all', operationId, beforeAlice, beforeBob);
  assert.equal(w.clearCalls.length, 1);
  assert.deepEqual(w.clearCalls[0].p_profile_id, w.alice);

  // The person goes back through onboarding (D-P1).
  const profile = await (await w.get('/api/profile')).json();
  assert.equal(profile.onboarded, false);
  // The settings gate still passes, so the panel is not blocked (SettingsWorkspace.tsx:52).
  const settings = await w.get('/api/settings');
  assert.equal(settings.status, 200);
  assert.equal(validSettingsSnapshot(await settings.json()), true, 'validSettingsSnapshot accepts the reset household');
  // privacy.status: nothing unresolved, the clear's receipt is settled, and the panel is verified.
  await assertStatusEmpty(w);
  // Alerts, My Week and Luna each answer their empty state.
  const alerts = await (await w.get('/api/alerts')).json();
  assert.equal(validAlertSnapshot(alerts), true);
  assert.deepEqual([alerts.count, alerts.unread, alerts.alerts, alerts.items, alerts.unresolvedOperations], [0, 0, [], [], []]);
  const week = await w.get('/api/frontend/actions');
  assert.equal(week.status, 200);
  const snapshot = await week.json();
  assert.equal(validActionSnapshot(snapshot), true);
  assert.deepEqual([snapshot.actions, snapshot.unresolvedOperations], [[], []]);
  const luna = await w.get('/api/luna/conversations');
  assert.equal(luna.status, 200);
  assert.deepEqual(await luna.json(), { data: null }, 'no conversation');
  // The receipt survived (P4): reconcile answers succeeded, which the client turns into the same sentence.
  const read = await (await w.reconcileRead()(operationId)).json();
  assert.equal(read.status, 'succeeded');
  assert.equal(Object.hasOwn(read, 'data'), false);
  const later = privacyPanel();
  later.unknown = { id: operationId, scope: 'all' };
  await later.reconcile(w.reconcileRead());
  assert.deepEqual([later.message, later.unknown], [MESSAGES.cleared, null]);
  // Bob still reads as he did.
  assert.equal((await (await w.get('/api/profile', 'bob')).json()).onboarded, true);
  assert.deepEqual(w.h.blockedFetches, [], 'zero fetch calls');
});

test('clear journal: "Journal cleared.", symptom logs and season summaries gone, tasks, readings and the rest unchanged (AC-282)', async () => {
  const w = await createWorld();
  const beforeAlice = await w.picture('alice');
  const beforeBob = await w.picture('bob');
  const { body, panel, operationId } = await confirm(w, 'journal', await w.review('alice', { scope: 'journal' }));
  assert.deepEqual(body, { operationId, status: 'succeeded', scope: 'journal' });
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.journal, null]);
  assert.equal(Object.keys(panel.drafts).length, 2, 'Clear Journal keeps the local drafts');

  await assertCleared(w, 'journal', operationId, beforeAlice, beforeBob);
  const now = await w.picture('alice');
  assert.deepEqual(now.symptom_logs, []);
  assert.deepEqual(parsed(now.alerts).map((row) => row.type), ['air_quality', 'air_quality'], 'only the season summary went');
  for (const table of ['household_actions', 'daily_scores', 'household_bands', 'profiles', 'home_contexts']) {
    assert.deepEqual(now[table], beforeAlice[table], `${table} unchanged`);
  }
  assert.equal((await (await w.get('/api/profile')).json()).onboarded, true, 'still onboarded');
  await assertStatusEmpty(w);
});

test('trap P-3: a review opened with groups [] clears all, and the token\'s groups play no part', async () => {
  const w = await createWorld();
  const beforeAlice = await w.picture('alice');
  const beforeBob = await w.picture('bob');
  const { body, panel, operationId } = await confirm(w, 'all', await w.review('alice', { groups: [] }));
  assert.equal(body.status, 'succeeded');
  assert.equal(panel.message, MESSAGES.cleared);
  await assertCleared(w, 'all', operationId, beforeAlice, beforeBob);
});

// ---------------------------------------------------------------------------
// P3 and P16: a deletion exists if and only if its operation is succeeded
// ---------------------------------------------------------------------------

test('lost answer: the function committed and its answer was lost; the row stays succeeded (P16), the route answers 500, and reconcile says "Your records were cleared."', async (t) => {
  const logged = muteConsoleError(t);
  let lose = true;
  const w = await createWorld({
    onClear: async (_args, call) => {
      const result = await call();
      if (lose) { lose = false; throw rpcError('', 'TypeError: fetch failed'); }
      return result;
    },
  });
  const beforeAlice = await w.picture('alice');
  const beforeBob = await w.picture('bob');
  const token = await w.review('alice');
  const { response, panel, operationId } = await confirm(w, 'all', token);
  assert.equal(response.status, 500);
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unconfirmed, { id: operationId, scope: 'all' }], 'a 5xx on a mutation is unknown_outcome, and the panel locks on it');

  assert.equal((await ledgerRow(operationId)).status, 'succeeded', 'runOperation\'s failed settle was refused by the guard');
  assert.match(loggedText(logged), /HALO_OPERATION_SETTLED/);
  assert.ok(!loggedText(logged).includes(token), 'no token in any log line');
  await assertCleared(w, 'all', operationId, beforeAlice, beforeBob);

  await panel.reconcile(w.reconcileRead());
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.cleared, null]);
});

test('reaped before the call: HALO_OPERATION_NOT_PENDING, 500, reconcile says unchanged, and nothing was deleted', async (t) => {
  const logged = muteConsoleError(t);
  const w = await createWorld({
    onClear: async (args, call) => {
      // The reaper settles the claim before the function runs (P15).
      await db.query(`update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}'::jsonb where operation_id = $1`, [args.p_operation_id]);
      return call();
    },
  });
  const before = await w.picture('alice');
  const { response, panel, operationId } = await confirm(w, 'all', await w.review('alice'));
  assert.equal(response.status, 500);
  assert.match(loggedText(logged), /HALO_OPERATION_NOT_PENDING/);
  assert.equal(panel.unknown.id, operationId);
  assert.equal((await ledgerRow(operationId)).status, 'failed');
  await assertUnchanged(w, before, operationId);

  await panel.reconcile(w.reconcileRead());
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unchanged, null]);
});

test('race: a symptom log added between the route\'s check and the function\'s answers 200 failed review_changed, and nothing is deleted', async () => {
  const w = await createWorld({
    onClear: async (args, call) => {
      await db.query(`insert into public.symptom_logs (profile_id, entry_date, symptoms) values ($1, '2026-10-01', '{wheeze}')`, [args.p_profile_id]);
      return call();
    },
  });
  const token = await w.review('alice');
  const before = await w.picture('alice');
  const { response, body, panel, operationId } = await confirm(w, 'all', token);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { operationId, status: 'failed', reason: 'review_changed' });
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unchanged, null]);
  const row = await ledgerRow(operationId);
  assert.deepEqual([row.status, row.result], ['failed', { operationId, status: 'failed', reason: 'review_changed' }]);
  const now = await w.picture('alice');
  assert.equal(now.symptom_logs.length, before.symptom_logs.length + 1, 'every log, the new one included, is still there');
  now.symptom_logs = before.symptom_logs;
  now.operations = now.operations.filter((text) => JSON.parse(text).operation_id !== operationId);
  assert.deepEqual(now, before);
});

test('busy: a pending settings operation answers 200 failed busy, and nothing is deleted', async () => {
  const w = await createWorld();
  const token = await w.review('alice');
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'settings', 'settings.save', 'pending')`, [crypto.randomUUID(), w.alice]);
  const before = await w.picture('alice');
  const { body, panel, operationId } = await confirm(w, 'all', token);
  assert.deepEqual(body, { operationId, status: 'failed', reason: 'busy' });
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unchanged, null]);
  await assertUnchanged(w, before, operationId);
});

// ---------------------------------------------------------------------------
// Refused before the claim: nothing recorded
// ---------------------------------------------------------------------------

test('a token minted for journal sent with scope all is 400, with no ledger row and nothing deleted', async () => {
  const w = await createWorld();
  const before = await w.picture('alice');
  const { response, panel, operationId } = await confirm(w, 'all', await w.review('alice', { scope: 'journal' }));
  await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.validation, null]);
  assert.equal(await ledgerRow(operationId), null);
  assert.deepEqual(await w.picture('alice'), before);
  assert.equal(w.clearCalls.length, 0);
});

test('another household\'s token is 409 review_changed and touches neither household', async () => {
  const w = await createWorld();
  const beforeAlice = await w.picture('alice');
  const beforeBob = await w.picture('bob');
  const { response, panel, operationId } = await confirm(w, 'all', await w.review('bob'));
  const body = await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(body.reason, 'review_changed');
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.conflict, null], 'the client keeps the review open with its conflict message');
  assert.equal(await ledgerRow(operationId), null);
  assert.deepEqual(await w.picture('alice'), beforeAlice);
  assert.deepEqual(await w.picture('bob'), beforeBob);
  assert.equal(w.clearCalls.length, 0);
});

test('trap P-5: no confirmation word travels; a body with confirm: "DELETE" is a 400 with nothing recorded', async () => {
  const w = await createWorld();
  const operationId = crypto.randomUUID();
  const response = await w.clear({ reviewToken: await w.review('alice'), scope: 'all', operationId, confirm: 'DELETE' });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false, extraKeys: [] });
  assert.deepEqual(body.field_errors.map((error) => [error.field, error.code]), [['confirm', 'unknown_field']]);
  assert.equal(await ledgerRow(operationId), null);
  assert.equal(w.clearCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Replays (P15)
// ---------------------------------------------------------------------------

test('replay: the same request after a clear answers its stored success without clearing again, though the token no longer verifies', async () => {
  const w = await createWorld();
  const token = await w.review('alice');
  const first = await confirm(w, 'all', token);
  assert.equal(first.body.status, 'succeeded');
  const again = await confirm(w, 'all', token, { operationId: first.operationId });
  assert.deepEqual(again.body, first.body);
  assert.equal(again.panel.message, MESSAGES.cleared);
  assert.equal(w.clearCalls.length, 1, 'the function ran once');

  // The same id with another token is a different request: 409 operation_mismatch.
  const other = await w.clear({ reviewToken: await w.review('alice'), scope: 'all', operationId: first.operationId });
  const body = await expectEnvelope(other, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(body.reason, 'operation_mismatch');
  assert.equal(w.clearCalls.length, 1);
});

test('replay: a pending row answers the retryable 503 in flight, and the panel keeps its lock', async () => {
  const w = await createWorld();
  const token = await w.review('alice');
  const operationId = crypto.randomUUID();
  await db.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'privacy', 'privacy.clear.all', 'pending', $3)`,
    [operationId, w.alice, requestHash({ reviewToken: token, scope: 'all' })],
  );
  const before = await w.picture('alice');
  const { response, panel } = await confirm(w, 'all', token, { operationId });
  await expectEnvelope(response, { status: 503, code: 'upstream_unavailable', retryable: true });
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unconfirmed, { id: operationId, scope: 'all' }]);
  assert.deepEqual(await w.picture('alice'), before, 'nothing deleted, the pending row still pending');
  assert.equal(w.clearCalls.length, 0);
});

for (const [label, result] of [['an in-process throw (null result)', null], ['a reap ({status: failed, reason: abandoned})', { status: 'failed', reason: 'abandoned' }]]) {
  test(`replay: a row settled failed by ${label} answers 200 failed, which the client calls unchanged, and nothing is deleted`, async () => {
    const w = await createWorld();
    const token = await w.review('alice');
    const operationId = crypto.randomUUID();
    await db.query(
      `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, result) values ($1, $2, 'privacy', 'privacy.clear.all', 'failed', $3, $4::jsonb)`,
      [operationId, w.alice, requestHash({ reviewToken: token, scope: 'all' }), result === null ? null : JSON.stringify(result)],
    );
    const before = await w.picture('alice');
    const { response, body, panel } = await confirm(w, 'all', token, { operationId });
    assert.equal(response.status, 200);
    assert.deepEqual(body, { operationId, status: 'failed', ...(result ? { reason: 'abandoned' } : {}) });
    assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unchanged, null]);
    assert.deepEqual(await w.picture('alice'), before);
    assert.equal(w.clearCalls.length, 0);
  });
}
