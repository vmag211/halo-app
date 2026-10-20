/**
 * Migration 0024 on PGlite (B07 plan, Task 1): the privacy clear, the review
 * fingerprint, the inspect counts, the receipt purge, the status probe and the
 * settled-privacy guard, run on the reconstructed baseline plus every
 * migration (test/db/pgliteHarness.mjs).
 *
 * Coverage is closed over the owned tables. Every scenario seeds two
 * households, alice and bob, with rows in every table of OWNED_TABLES
 * (test/helpers/tables.mjs) from the one row factory rlsIsolation uses
 * (test/db/ownedRows.mjs), several per table where a table allows it. The
 * clear-all test then walks OWNED_TABLES itself and looks up what the clear
 * must have done to each in CLEAR_ALL and CLEAR_JOURNAL below, so a new owned
 * table that is not placed there fails it. Those two maps are this test's copy
 * of the plan's inventory (Ruling P2); lib/privacyInventory.js (Task 2) is
 * the one the routes read, and its own test pins it against the same
 * catalog.
 *
 * PGlite has one connection, so the lock order is reasoned on paper in the
 * migration's header; what is proved here is everything one transaction can
 * show. Each scenario runs as the service role inside one transaction that is
 * rolled back afterwards, and each call that is expected to refuse runs inside
 * a savepoint, which is exactly the statement-level atomicity a PostgREST RPC
 * has: a function call that raises leaves nothing behind.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { OWNED_TABLES } from './helpers/tables.mjs';
import { OWNED_ROW } from './db/ownedRows.mjs';
import { writeBackfillState } from '../lib/homeContextRpc.js';
import { OWN_OPERATION, clearActionFor } from '../lib/privacyInventory.js';

const MIGRATION = listMigrations().find((migration) => migration.number === 24);

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const CAROL = 'ca201000-0000-4000-8000-000000000003'; // a profile and nothing else: what a pristine profile reads as
const CLEAR_OP = '00000000-0000-4000-8000-0000000c1ea4';

/** Every table privacy_fingerprint may cover, in its fixed order (Ruling P6). */
const FINGERPRINT_TABLES = [
  'profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs',
  'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions',
  'household_action_preferences', 'luna_conversations', 'luna_turns',
];
const SCOPE_TABLES = { journal: ['symptom_logs'], all: FINGERPRINT_TABLES };

/**
 * What a clear does to each owned table (Ruling P2, D-P1, D-P4). Every key of
 * OWNED_TABLES must be here; there is no default.
 *   delete            every row of the household goes
 *   delete-seasonal   only alerts of type 'season_summary' go
 *   reset             the row stays with id and created_at; every other column returns to its default
 *   own-receipt       only this clear's own ledger row stays, settled
 *   keep              unchanged
 */
const CLEAR_ALL = {
  profiles: 'reset',
  daily_scores: 'delete',
  home_risks: 'delete',
  household_bands: 'delete',
  symptom_logs: 'delete',
  alerts: 'delete',
  notification_prefs: 'delete',
  push_subscriptions: 'delete',
  home_contexts: 'delete',
  operations: 'own-receipt',
  recovery_challenges: 'keep', // login material (P4, Open question 2)
  luna_conversations: 'delete',
  luna_turns: 'delete',
  luna_runs: 'delete',
  profile_preferences: 'delete',
  explore_areas: 'delete',
  household_actions: 'delete',
  household_action_preferences: 'delete',
  household_action_state: 'delete',
  daily_maxima: 'delete', // 0025: deleted before home_contexts when present, and counted (B08 E23)
  household_workspace_records: 'delete', // 0026: deleted by its trigger on the clear's own settle, counted by workspace_privacy_counts (B11 W8)
};
const CLEAR_JOURNAL = {
  ...Object.fromEntries(Object.keys(CLEAR_ALL).map((table) => [table, 'keep'])),
  symptom_logs: 'delete',
  alerts: 'delete-seasonal',
  operations: 'own-receipt',
};

/**
 * A value for every profiles column the reset must return to its default:
 * each is something other than the default. The structural test below fails
 * when profiles gains a column this map does not name, and the clear-all test
 * fails when the reset leaves any of these unchanged.
 */
const PROFILE_SEED = {
  address: '1 Test Street',
  lat: 35.409123,
  lng: -80.581234,
  zip: '28025',
  county: 'Cabarrus County',
  pwsid: 'NC9990001',
  build_year: 1978,
  water_source: 'municipal',
  home_year: 1981,
  renter_mode: true,
  locale: 'es',
  state: 'NC',
  onboard_request_id: '0000000a-0000-4000-8000-000000000001',
  tenure: 'renter',
};

/** Rows per table in the seed: several where a table allows it. */
const VARIANTS = {
  daily_scores: [0, 1, 2],
  home_risks: [0, 1],
  symptom_logs: [0, 1, 2],
  alerts: [0, 1],
  push_subscriptions: [0, 1],
  home_contexts: [0, 1],
  recovery_challenges: [0, 1],
  luna_turns: [0, 1],
  luna_runs: [0, 1],
  household_actions: [0, 1, 2],
  household_action_preferences: [0, 1],
  daily_maxima: [0, 1],
  household_workspace_records: [0, 1, 2],
};

const contextId = (owner, n) => `${owner.slice(0, 24)}00000000c${n}0${n}`.slice(0, 36);

/** The seed row for one table, adjusted where the plain factory row would make the clear refuse or skip a case. */
function seedRows(table, owner) {
  if (table === 'profiles') return [];
  if (table === 'operations') {
    // Settled rows in three domains; a pending one would make clear all refuse.
    return [
      { ...OWNED_ROW.operations(owner), status: 'succeeded', result: { status: 'succeeded', affected: [] } },
      { ...OWNED_ROW.operations(owner), domain: 'settings', kind: 'settings.update', status: 'failed' },
      { ...OWNED_ROW.operations(owner), domain: 'privacy', kind: 'privacy.export', status: 'succeeded', result: { status: 'succeeded', scope: 'export' } },
    ];
  }
  const rows = (VARIANTS[table] ?? [0]).map((n) => {
    const row = OWNED_ROW[table](owner, n);
    if (table === 'home_contexts') return { ...row, id: contextId(owner, n) };
    // Settled runs: a queued or generating run updated just now is live work.
    if (table === 'luna_runs') return { ...row, status: 'completed', settled_at: '2026-09-10T00:00:00Z' };
    // One reading belongs to the current home: its composite key is ON DELETE NO ACTION.
    if (table === 'daily_scores' && n === 2) return { ...row, home_context_id: contextId(owner, 0) };
    return row;
  });
  if (table === 'alerts') {
    rows.push({ profile_id: owner, type: 'season_summary', title: 'Your fall summary', message: 'This fall you logged 3 days.', dedupe_key: 'season_summary:fall:2026' });
    rows.push({ profile_id: owner, type: 'season_summary', title: 'Your summer summary', message: 'This summer you logged 1 day.', dedupe_key: 'season_summary:summer:2026' });
  }
  return rows;
}

/** Tables a parent must precede (foreign keys), then the rest in OWNED_TABLES order. */
const SEED_ORDER = ['home_contexts', 'luna_conversations', 'luna_turns', ...Object.keys(OWNED_TABLES)]
  .filter((table, at, all) => all.indexOf(table) === at);

const ident = (name) => {
  assert.match(name, /^[a-z_][a-z0-9_]*$/, `not a plain identifier: ${name}`);
  return `"${name}"`;
};

async function insertRow(tx, table, row) {
  const columns = Object.keys(row);
  const values = Object.values(row).map((value) => (value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value));
  await tx.query(
    `insert into public.${ident(table)} (${columns.map(ident).join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`,
    values,
  );
}

async function seedHouseholds(tx) {
  for (const owner of [ALICE, BOB]) {
    const sets = Object.entries(PROFILE_SEED).map(([column], at) => `${ident(column)} = $${at + 2}`);
    await tx.query(`update public.profiles set ${sets.join(', ')} where id = $1`, [owner, ...Object.values(PROFILE_SEED)]);
    for (const table of SEED_ORDER) for (const row of seedRows(table, owner)) await insertRow(tx, table, row);
  }
}

/** Every row of `owner` in `table`, as JSON text, sorted: a byte-for-byte picture. */
async function rowsOf(tx, table, owner) {
  const { rows } = await tx.query(
    `select row_to_json(t)::text as row from public.${ident(table)} t where t.${ident(OWNED_TABLES[table])} = $1 order by 1`,
    [owner],
  );
  return rows.map((row) => row.row);
}

async function snapshot(tx, owner) {
  const picture = {};
  for (const table of Object.keys(OWNED_TABLES)) picture[table] = await rowsOf(tx, table, owner);
  // auth.users belongs to Supabase Auth, which the service role does not read here: look as the owner.
  await tx.exec('reset role');
  picture['auth.users'] = (await tx.query(`select row_to_json(u)::text as row from auth.users u where u.id = $1`, [owner])).rows.map((row) => row.row);
  await tx.exec('set local role service_role');
  return picture;
}

async function counts(tx, owner) {
  const out = {};
  for (const table of Object.keys(OWNED_TABLES)) out[table] = (await rowsOf(tx, table, owner)).length;
  return out;
}

let db;
/** Every DETAIL a refusal carried, checked at the end for row content (0021 review finding B). */
const details = [];

/**
 * Runs fn(tx) as the service role in one transaction over a fresh seed, then
 * rolls it back. `prepare` runs first, as the migration owner.
 */
function scenario(fn, { prepare, seed = true } = {}) {
  return db.pg.transaction(async (tx) => {
    if (prepare) await prepare(tx);
    await tx.exec('set local role service_role');
    if (seed) await seedHouseholds(tx);
    const result = await fn(tx);
    await tx.rollback();
    return result;
  });
}

/** One statement in a savepoint: { ok, rows } or { ok: false, error }, the error's effects undone. */
async function attempt(tx, sql, params = []) {
  await tx.exec('savepoint attempt');
  try {
    const { rows } = await tx.query(sql, params);
    await tx.exec('release savepoint attempt');
    return { ok: true, rows };
  } catch (error) {
    await tx.exec('rollback to savepoint attempt');
    // Only this migration's own refusals: a test-only CHECK below is Postgres's.
    if (error.code === 'P0001') details.push(error.detail ?? '');
    return { ok: false, error };
  }
}

async function refusal(tx, sql, params) {
  const outcome = await attempt(tx, sql, params);
  assert.equal(outcome.ok, false, `expected a refusal from: ${sql}`);
  return outcome.error;
}

const fingerprint = async (tx, owner, tables) =>
  (await tx.query(`select public.privacy_fingerprint($1, $2::text[]) as f`, [owner, tables])).rows[0].f;

async function claim(tx, { owner = ALICE, scope = 'all', operationId = CLEAR_OP, domain = 'privacy', kind, status = 'pending', result = null } = {}) {
  await tx.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, result) values ($1, $2, $3, $4, $5, $6)`,
    [operationId, owner, domain, kind ?? `privacy.clear.${scope}`, status, result === null ? null : JSON.stringify(result)],
  );
}

const CLEAR_SQL = `select public.clear_household_records($1, $2, $3, $4) as out`;

async function clear(tx, { owner = ALICE, operationId = CLEAR_OP, scope = 'all', print } = {}) {
  const value = print ?? (await fingerprint(tx, owner, SCOPE_TABLES[scope]));
  return (await tx.query(CLEAR_SQL, [owner, operationId, scope, value])).rows[0].out;
}

before(async () => {
  db = await createDb();
  // Supabase Auth creates users; here the owner does. The 0001 trigger creates each profile.
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true), ('${CAROL}', true)`);
});

after(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Applying 0024
// ---------------------------------------------------------------------------

test('0024 applies over 0001 to 0023, re-applies, and leaves the schema as one pass did', async () => {
  const fresh = await createDb();
  try {
    const once = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), once);
    assert.deepEqual((await fresh.query(`select public.privacy_schema_version() as v`)).rows, [{ v: 1 }]);
  } finally {
    await fresh.close();
  }
});

test('0024 refuses to apply over 0022, naming the 0023 tables, and creates nothing', async () => {
  const lagging = await createDb({ upTo: 22 });
  try {
    await assert.rejects(lagging.applyMigration(MIGRATION), (error) => {
      assert.match(error.message, /HALO 0024 cannot be applied: missing public\.household_actions \(0023\)/);
      assert.match(error.message, /household_action_preferences/);
      assert.match(error.message, /household_action_state/);
      return true;
    });
    const { rows } = await lagging.query(`select to_regprocedure('public.privacy_schema_version()') is null as absent,
      not exists (select 1 from pg_trigger where tgname = 'operations_privacy_settled_guard') as no_trigger`);
    assert.deepEqual(rows, [{ absent: true, no_trigger: true }]);
  } finally {
    await lagging.close();
  }
});

test('0024 refuses to apply over 0020, naming the first missing table, profiles.tenure included', async () => {
  const lagging = await createDb({ upTo: 20 });
  try {
    await assert.rejects(lagging.applyMigration(MIGRATION), /missing public\.profile_preferences \(0021\).*public\.profiles\.tenure \(0021\)/);
  } finally {
    await lagging.close();
  }
});

test('every 0024 function is security invoker with search_path pinned, and only the service role may run it', async () => {
  const { rows } = await db.query(
    `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any ($1::text[]) order by p.proname`,
    [['privacy_schema_version', 'privacy_fingerprint', 'privacy_counts', 'clear_household_records', 'purge_privacy_receipts', 'guard_settled_privacy_operation']],
  );
  assert.equal(rows.length, 6);
  for (const fn of rows) {
    assert.equal(fn.definer, false, `${fn.name} is security definer`);
    assert.ok(fn.config?.includes('search_path=public'), `${fn.name} does not pin search_path`);
    assert.equal(fn.anon, false, `${fn.name}: anon may execute`);
    assert.equal(fn.authenticated, false, `${fn.name}: authenticated may execute`);
    if (fn.name !== 'guard_settled_privacy_operation') assert.equal(fn.service_role, true, `${fn.name}: service_role may not execute`);
  }
});

test('anon and authenticated are refused every 0024 function, as a call', async () => {
  const calls = [
    `select public.privacy_schema_version()`,
    `select public.privacy_fingerprint('${ALICE}', array['symptom_logs'])`,
    `select public.privacy_counts('${ALICE}', 'all')`,
    `select public.clear_household_records('${ALICE}', '${CLEAR_OP}', 'all', '${'0'.repeat(64)}')`,
    `select public.purge_privacy_receipts()`,
  ];
  for (const [role, user] of [['anon', null], ['authenticated', ALICE]]) {
    for (const call of calls) {
      await assert.rejects(db.asRole(role, user, (tx) => tx.query(call)), /permission denied for function/, `${role}: ${call}`);
    }
  }
});

test('the verification query in the migration returns one row, every column true', async () => {
  const lines = MIGRATION.sql.split('\n');
  const start = lines.findIndex((line) => /^--\s*Verification \(read only\)/.test(line));
  const body = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('--') && !/^-- -{10,}/.test(lines[i]); i += 1) body.push(lines[i].replace(/^--\s?/, ''));
  const { rows } = await db.query(body.join('\n'));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), ['functions_service_role_only', 'functions_invoker_pinned', 'settled_guard_on', 'probe_answers', 'profiles_reset_complete']);
  for (const [column, value] of Object.entries(rows[0])) assert.equal(value, true, column);
  // The column that guards the reset list discriminates: a new profiles column turns it false.
  const widened = await db.pg.transaction(async (tx) => {
    await tx.exec(`alter table public.profiles add column nickname text`);
    const { rows: [row] } = await tx.query(body.join('\n'));
    await tx.rollback();
    return row;
  });
  assert.equal(widened.profiles_reset_complete, false);
});

// ---------------------------------------------------------------------------
// The profile reset list (Ruling P4)
// ---------------------------------------------------------------------------

test('structural: every profiles column but id and created_at has a seed value, so the reset is proved for it', async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by column_name`,
  );
  assert.deepEqual(
    rows.map((row) => row.column_name).filter((name) => !['id', 'created_at'].includes(name)).sort(),
    Object.keys(PROFILE_SEED).sort(),
    'profiles gained or lost a column: add it to the reset in clear_household_records (0024 step 6), ' +
      'to privacy_fingerprint\'s profile columns and privacy_counts\' test, and give it a seed value here',
  );
  // Every seed value differs from what a pristine profile holds, so the reset is observable.
  const { rows: [pristine] } = await db.query(`select * from public.profiles where id = $1`, [CAROL]);
  for (const [column, value] of Object.entries(PROFILE_SEED)) assert.notDeepEqual(pristine[column], value, column);
});

// ---------------------------------------------------------------------------
// Clear all (Rulings P3 and P4, D-P1, P12)
// ---------------------------------------------------------------------------

test('clear all: every owned table is placed, alice ends in the inventory\'s state, and bob is untouched', async () => {
  const placed = Object.keys(CLEAR_ALL).sort();
  assert.deepEqual(Object.keys(OWNED_TABLES).sort(), placed, 'an owned table has no clear placement: add it to CLEAR_ALL and CLEAR_JOURNAL');
  assert.deepEqual(Object.keys(CLEAR_JOURNAL).sort(), placed);

  await scenario(async (tx) => {
    const before = await snapshot(tx, ALICE);
    const bobBefore = await snapshot(tx, BOB);
    for (const table of Object.keys(OWNED_TABLES)) {
      assert.ok(before[table].length >= 1, `the seed has no alice row in ${table}`);
      assert.ok(bobBefore[table].length >= 1, `the seed has no bob row in ${table}`);
    }
    // The foreign-key case is in the seed: one reading belongs to the current home.
    assert.deepEqual((await tx.query(`select count(*)::int as n from public.daily_scores where profile_id = $1 and home_context_id is not null`, [ALICE])).rows, [{ n: 1 }]);
    const { rows: [profileBefore] } = await tx.query(`select id, created_at from public.profiles where id = $1`, [ALICE]);

    await claim(tx);
    const out = await clear(tx);
    assert.deepEqual(out.receipt, { operationId: CLEAR_OP, status: 'succeeded', scope: 'all' });

    const after = await snapshot(tx, ALICE);
    for (const table of Object.keys(OWNED_TABLES)) {
      const action = CLEAR_ALL[table];
      if (action === 'delete') assert.deepEqual(after[table], [], `${table}: alice still has rows`);
      else if (action === 'keep') assert.deepEqual(after[table], before[table], `${table}: alice's rows changed`);
      else if (action === 'own-receipt') {
        const { rows } = await tx.query(`select operation_id, domain, kind, status, result from public.operations where profile_id = $1`, [ALICE]);
        assert.deepEqual(rows, [{
          operation_id: CLEAR_OP, domain: 'privacy', kind: 'privacy.clear.all', status: 'succeeded',
          result: { operationId: CLEAR_OP, status: 'succeeded', scope: 'all' },
        }]);
      } else if (action === 'reset') {
        const { rows: [mine] } = await tx.query(`select * from public.profiles where id = $1`, [ALICE]);
        const { rows: [pristine] } = await tx.query(`select * from public.profiles where id = $1`, [CAROL]);
        assert.equal(mine.id, profileBefore.id);
        assert.deepEqual(mine.created_at, profileBefore.created_at);
        const rest = (row) => Object.fromEntries(Object.entries(row).filter(([column]) => !['id', 'created_at'].includes(column)));
        assert.deepEqual(rest(mine), rest(pristine), 'the reset profile differs from a never-touched one');
        assert.equal(mine.lat, null);
        assert.equal(mine.lng, null); // so GET /api/profile answers onboarded: false
        assert.equal(mine.renter_mode, false);
        assert.equal(mine.locale, 'en');
      } else assert.fail(`${table}: unknown action ${action}`);
    }
    assert.deepEqual(after['auth.users'], before['auth.users'], 'the login survives (D-P1)');
    assert.deepEqual(await snapshot(tx, BOB), bobBefore, 'bob\'s rows changed');
  });
});

test('clear all: privacy_counts read before the claim is exactly what the clear removes, and removed is their sum', async () => {
  await scenario(async (tx) => {
    // What the inspect route counts (lib/privacyStore.js privacyCounts): 0024's
    // counts plus 0026's workspace count (B11 Ruling W8).
    const predicted = {
      ...(await tx.query(`select public.privacy_counts($1, 'all') as c`, [ALICE])).rows[0].c,
      ...(await tx.query(`select public.workspace_privacy_counts($1) as c`, [ALICE])).rows[0].c,
    };
    const before = await counts(tx, ALICE);
    await claim(tx);
    const out = await clear(tx);
    const after = await counts(tx, ALICE);
    const observed = {};
    for (const table of Object.keys(OWNED_TABLES)) {
      if (CLEAR_ALL[table] === 'keep') continue;
      if (CLEAR_ALL[table] === 'reset') observed[table] = 1; // the seeded profile had values to reset
      else if (CLEAR_ALL[table] === 'own-receipt') observed[table] = before[table] - (after[table] - 1);
      else observed[table] = before[table] - after[table];
    }
    assert.deepEqual(Object.keys(predicted).sort(), Object.keys(observed).sort());
    for (const [table, n] of Object.entries(observed)) assert.equal(Number(predicted[table]), n, table);
    // 0024's `removed` counts its own deletes; the workspace rows go in 0026's
    // trigger on the settle, inside the same transaction, so they are not in it.
    const workspaceRows = observed.household_workspace_records;
    assert.ok(workspaceRows >= 3, 'the seed has workspace rows to remove');
    assert.equal(Number(out.removed), Object.values(observed).reduce((sum, n) => sum + n, 0) - workspaceRows);
  });
});

test('privacy_counts for a household with nothing reads every key as 0, the profile included', async () => {
  await scenario(async (tx) => {
    const all = (await tx.query(`select public.privacy_counts($1, 'all') as c`, [CAROL])).rows[0].c;
    assert.equal(Object.keys(all).length, 19);
    assert.ok(Object.values(all).every((n) => Number(n) === 0), JSON.stringify(all));
    assert.deepEqual((await tx.query(`select public.privacy_counts($1, 'journal') as c`, [CAROL])).rows[0].c, { symptom_logs: 0, alerts: 0 });
  }, { seed: false });
});

test('privacy_counts: a pending ledger row is not counted, and a profile holding only a language counts as one to reset', async () => {
  await scenario(async (tx) => {
    await claim(tx, { owner: CAROL, operationId: crypto.randomUUID(), domain: 'settings', kind: 'settings.update' });
    await tx.query(`update public.profiles set locale = 'es' where id = $1`, [CAROL]);
    const all = (await tx.query(`select public.privacy_counts($1, 'all') as c`, [CAROL])).rows[0].c;
    assert.equal(Number(all.operations), 0, 'a pending row is in flight, never something the clear removes');
    assert.equal(Number(all.profiles), 1);
    await tx.query(`update public.operations set status = 'failed' where profile_id = $1`, [CAROL]);
    await claim(tx, { owner: CAROL });
    const out = await clear(tx, { owner: CAROL });
    assert.equal(Number(out.removed), 2, 'the settled row and the reset profile');
    assert.deepEqual((await tx.query(`select locale from public.profiles where id = $1`, [CAROL])).rows, [{ locale: 'en' }]);
  }, { seed: false });
});

test('the clear\'s steps run in the ruled order: profile lock, ledger lock, fingerprint, busy, then the first delete', async () => {
  // PGlite has one connection, so a lock-order change cannot be provoked into
  // a deadlock here. This pins the order in the function as stored instead.
  const { rows: [{ src }] } = await db.query(
    `select prosrc as src from pg_proc where oid = 'public.clear_household_records(uuid, uuid, text, text)'::regprocedure`,
  );
  const at = (needle) => {
    const index = src.indexOf(needle);
    assert.ok(index >= 0, `the function no longer contains: ${needle}`);
    return index;
  };
  const steps = [
    at('from public.profiles p where p.id = p_profile_id for update'),
    at("and o.status = 'pending'\n     for update"),
    at('public.privacy_fingerprint(p_profile_id'),
    at("raise exception 'HALO_BUSY'"),
    at('delete from public.'),
    at("set status = 'succeeded', result = receipt"),
  ];
  assert.deepEqual([...steps].sort((a, b) => a - b), steps, 'the steps are out of order');
  // Notifications before bands before preferences, the 0021 order, and readings before homes.
  const order = ['notification_prefs x', 'household_bands x', 'profile_preferences x'].map((table) => at(`delete from public.${table}`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(at('delete from public.daily_scores x') < at('delete from public.home_contexts x'));
  assert.ok(at('delete from public.daily_maxima x') < at('delete from public.home_contexts x'));
});

test('clear all on a household with only a profile settles and resets nothing it does not need to', async () => {
  await scenario(async (tx) => {
    await claim(tx, { owner: CAROL });
    const out = await clear(tx, { owner: CAROL });
    assert.deepEqual(out, { receipt: { operationId: CLEAR_OP, status: 'succeeded', scope: 'all' }, removed: 0 });
  }, { seed: false });
});

// ---------------------------------------------------------------------------
// Clear journal (D-P4, AC-282)
// ---------------------------------------------------------------------------

test('clear journal: symptom logs and season summaries go; every other table, alerts included, is unchanged', async () => {
  await scenario(async (tx) => {
    const before = await snapshot(tx, ALICE);
    const bobBefore = await snapshot(tx, BOB);
    const predicted = (await tx.query(`select public.privacy_counts($1, 'journal') as c`, [ALICE])).rows[0].c;
    await claim(tx, { scope: 'journal' });
    const out = await clear(tx, { scope: 'journal' });
    assert.deepEqual(out.receipt, { operationId: CLEAR_OP, status: 'succeeded', scope: 'journal' });
    assert.deepEqual(predicted, { symptom_logs: 3, alerts: 2 });
    assert.equal(Number(out.removed), 5);

    const after = await snapshot(tx, ALICE);
    for (const table of Object.keys(OWNED_TABLES)) {
      const action = CLEAR_JOURNAL[table];
      if (action === 'delete') assert.deepEqual(after[table], [], table);
      else if (action === 'keep') assert.deepEqual(after[table], before[table], `${table}: changed by a journal clear`);
      else if (action === 'delete-seasonal') {
        assert.deepEqual(after[table], before[table].filter((row) => JSON.parse(row).type !== 'season_summary'));
        assert.equal(after[table].length, before[table].length - 2);
      } else if (action === 'own-receipt') {
        const others = before[table];
        const mine = after[table].filter((row) => JSON.parse(row).operation_id === CLEAR_OP);
        assert.deepEqual(after[table].filter((row) => JSON.parse(row).operation_id !== CLEAR_OP), others, 'other ledger rows stay');
        assert.equal(mine.length, 1);
        assert.deepEqual(JSON.parse(mine[0]).result, { operationId: CLEAR_OP, status: 'succeeded', scope: 'journal' });
      } else assert.fail(`${table}: unknown action ${action}`);
    }
    assert.deepEqual(await snapshot(tx, BOB), bobBefore);
  });
});

// ---------------------------------------------------------------------------
// Atomicity (trap P-13) and the ledger row (the B06 H8 analogue)
// ---------------------------------------------------------------------------

test('atomicity: a failure at the last step leaves every row in place and the ledger row pending, then a reap is honest', async () => {
  await scenario(async (tx) => {
    const before = await snapshot(tx, ALICE);
    await claim(tx);
    const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'all', await fingerprint(tx, ALICE, FINGERPRINT_TABLES)]);
    assert.equal(error.code, '23514');
    assert.match(error.message, /test_no_privacy_success/);
    const after = await snapshot(tx, ALICE);
    after.operations = after.operations.filter((row) => JSON.parse(row).operation_id !== CLEAR_OP);
    assert.deepEqual(after, before, 'a failed clear deleted something');
    assert.deepEqual((await tx.query(`select status from public.operations where operation_id = $1`, [CLEAR_OP])).rows, [{ status: 'pending' }]);
    // The reaper's update (lib/operations.js) then settles it failed, and "unchanged" is true.
    const { affectedRows } = await tx.query(
      `update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}'::jsonb, updated_at = now()
        where operation_id = $1 and profile_id = $2 and domain = 'privacy' and status = 'pending'`,
      [CLEAR_OP, ALICE],
    );
    assert.equal(affectedRows, 1);
    const reaped = await snapshot(tx, ALICE);
    reaped.operations = reaped.operations.filter((row) => JSON.parse(row).operation_id !== CLEAR_OP);
    assert.deepEqual(reaped, before);
  }, {
    // Test only, rolled back with the scenario: the settle (step 7) is refused.
    prepare: (tx) => tx.exec(`alter table public.operations add constraint test_no_privacy_success
      check (kind <> 'privacy.clear.all' or status <> 'succeeded') not valid`),
  });
});

test('the ledger row must be this household\'s pending privacy row of this kind, or HALO_OPERATION_NOT_PENDING and nothing deleted', async () => {
  const cases = [
    ['absent', null],
    ['failed with no receipt', { status: 'failed' }],
    ['reaped', { status: 'failed', result: { status: 'failed', reason: 'abandoned' } }],
    ['succeeded', { status: 'succeeded', result: { operationId: CLEAR_OP, status: 'succeeded', scope: 'all' } }],
    ['another household\'s', { owner: BOB }],
    ['another domain\'s', { domain: 'settings', kind: 'privacy.clear.all' }],
    ['a journal clear\'s, for an all call', { kind: 'privacy.clear.journal' }],
  ];
  for (const [label, row] of cases) {
    await scenario(async (tx) => {
      if (row) await claim(tx, row);
      const before = await snapshot(tx, ALICE);
      const bobBefore = await snapshot(tx, BOB);
      const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'all', await fingerprint(tx, ALICE, FINGERPRINT_TABLES)]);
      assert.equal(error.code, 'P0001', label);
      assert.equal(error.message, 'HALO_OPERATION_NOT_PENDING', label);
      assert.deepEqual(await snapshot(tx, ALICE), before, `${label}: alice changed`);
      assert.deepEqual(await snapshot(tx, BOB), bobBefore, `${label}: bob changed`);
    });
  }
});

test('a clear for a profile that does not exist refuses as not pending', async () => {
  await scenario(async (tx) => {
    const error = await refusal(tx, CLEAR_SQL, ['de1e7ed0-0000-4000-8000-000000000009', CLEAR_OP, 'all', '0'.repeat(64)]);
    assert.equal(error.message, 'HALO_OPERATION_NOT_PENDING');
  }, { seed: false });
});

// ---------------------------------------------------------------------------
// The review fingerprint (Ruling P6)
// ---------------------------------------------------------------------------

test('a wrong fingerprint is HALO_REVIEW_CHANGED with nothing deleted and the ledger row still pending', async () => {
  for (const scope of ['journal', 'all']) {
    await scenario(async (tx) => {
      await claim(tx, { scope });
      const before = await snapshot(tx, ALICE);
      const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, scope, 'f'.repeat(64)]);
      assert.equal(error.message, 'HALO_REVIEW_CHANGED');
      assert.deepEqual(await snapshot(tx, ALICE), before);
    });
  }
});

test('a fingerprint taken before a journal entry was added no longer clears', async () => {
  await scenario(async (tx) => {
    await claim(tx);
    const reviewed = await fingerprint(tx, ALICE, FINGERPRINT_TABLES);
    await insertRow(tx, 'symptom_logs', OWNED_ROW.symptom_logs(ALICE, 7));
    const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'all', reviewed]);
    assert.equal(error.message, 'HALO_REVIEW_CHANGED');
  });
});

test('fingerprint: a journal entry moves both scopes; a reading or an alert moves neither', async () => {
  await scenario(async (tx) => {
    const journal = await fingerprint(tx, ALICE, SCOPE_TABLES.journal);
    const all = await fingerprint(tx, ALICE, SCOPE_TABLES.all);
    assert.match(journal, /^[0-9a-f]{64}$/);
    await insertRow(tx, 'daily_scores', OWNED_ROW.daily_scores(ALICE, 8));
    await insertRow(tx, 'alerts', OWNED_ROW.alerts(ALICE, 8));
    await insertRow(tx, 'home_risks', OWNED_ROW.home_risks(ALICE, 8));
    await tx.query(`update public.luna_runs set message = 'Server note' where profile_id = $1`, [ALICE]);
    await tx.query(`update public.household_action_state set version = version + 1 where profile_id = $1`, [ALICE]);
    assert.equal(await fingerprint(tx, ALICE, SCOPE_TABLES.journal), journal, 'a server-written row moved the journal fingerprint');
    assert.equal(await fingerprint(tx, ALICE, SCOPE_TABLES.all), all, 'a server-written row moved the all fingerprint');
    await insertRow(tx, 'symptom_logs', OWNED_ROW.symptom_logs(ALICE, 8));
    assert.notEqual(await fingerprint(tx, ALICE, SCOPE_TABLES.journal), journal);
    assert.notEqual(await fingerprint(tx, ALICE, SCOPE_TABLES.all), all);
  });
});

test('fingerprint: every covered table, the profile included, moves the all fingerprint, and bob\'s rows never do', async () => {
  const edits = {
    profiles: `update public.profiles set county = 'Rowan County' where id = $1`,
    home_contexts: `update public.home_contexts set water_source = 'well' where profile_id = $1`,
    household_bands: `update public.household_bands set has_teen = true where profile_id = $1`,
    symptom_logs: `update public.symptom_logs set note = 'edited' where profile_id = $1`,
    notification_prefs: `update public.notification_prefs set radon_season = false where profile_id = $1`,
    push_subscriptions: `update public.push_subscriptions set p256dh = 'rotated' where profile_id = $1`,
    profile_preferences: `update public.profile_preferences set display_contrast = true where profile_id = $1`,
    explore_areas: `update public.explore_areas set label = 'Elsewhere' where profile_id = $1`,
    household_actions: `update public.household_actions set title = 'Edited task' where profile_id = $1`,
    household_action_preferences: `update public.household_action_preferences set value = '"Other focus"'::jsonb where profile_id = $1 and pref_key = 'week:focus'`,
    luna_conversations: `update public.luna_conversations set revision = revision + 1 where profile_id = $1`,
    luna_turns: `update public.luna_turns set body = 'Edited question' where profile_id = $1`,
  };
  assert.deepEqual(Object.keys(edits), FINGERPRINT_TABLES);
  for (const [table, edit] of Object.entries(edits)) {
    await scenario(async (tx) => {
      const all = await fingerprint(tx, ALICE, FINGERPRINT_TABLES);
      const one = await fingerprint(tx, ALICE, [table]);
      await tx.query(edit, [BOB]);
      assert.equal(await fingerprint(tx, ALICE, FINGERPRINT_TABLES), all, `${table}: bob's edit moved alice's fingerprint`);
      await tx.query(edit, [ALICE]);
      assert.notEqual(await fingerprint(tx, ALICE, FINGERPRINT_TABLES), all, `${table}: an edit did not move the fingerprint`);
      assert.notEqual(await fingerprint(tx, ALICE, [table]), one, table);
    });
  }
});

test('fingerprint: the same rows inserted in another order, and the tables listed in another order, give the same value', async () => {
  const rows = [
    { id: '5e000000-0000-4000-8000-000000000001', profile_id: CAROL, entry_date: '2026-09-01', symptoms: ['cough'], created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
    { id: '5e000000-0000-4000-8000-000000000002', profile_id: CAROL, entry_date: '2026-09-02', symptoms: ['wheeze'], note: 'Ran outside', created_at: '2026-09-02T10:00:00Z', updated_at: '2026-09-02T10:00:00Z' },
    { id: '5e000000-0000-4000-8000-000000000003', profile_id: CAROL, entry_date: '2026-09-03', symptoms: [], created_at: '2026-09-03T10:00:00Z', updated_at: '2026-09-03T10:00:00Z' },
  ];
  const run = (order) => scenario(async (tx) => {
    for (const at of order) await insertRow(tx, 'symptom_logs', rows[at]);
    return fingerprint(tx, CAROL, ['symptom_logs', 'profiles']);
  }, { seed: false });
  const forward = await run([0, 1, 2]);
  assert.equal(await run([2, 0, 1]), forward);
  assert.equal(await run([1, 2, 0]), forward);
  const listed = await scenario(async (tx) => {
    for (const at of [0, 1, 2]) await insertRow(tx, 'symptom_logs', rows[at]);
    return fingerprint(tx, CAROL, ['profiles', 'symptom_logs']);
  }, { seed: false });
  assert.equal(listed, forward);
});

test('fingerprint: the session time zone and float format do not change it (both are pinned on the function)', async () => {
  await scenario(async (tx) => {
    // A coordinate whose shortest exact text needs 17 digits, so a session
    // with extra_float_digits 0 (15 significant digits) would write it differently.
    await tx.query(`update public.profiles set lat = 0.1::float8 + 0.2::float8 where id = $1`, [ALICE]);
    const pinned = await fingerprint(tx, ALICE, FINGERPRINT_TABLES);
    await tx.exec(`set local timezone to 'America/Los_Angeles'`);
    assert.equal(await fingerprint(tx, ALICE, FINGERPRINT_TABLES), pinned, 'the time zone moved it');
    await tx.exec(`set local extra_float_digits to 0`);
    assert.equal(await fingerprint(tx, ALICE, FINGERPRINT_TABLES), pinned, 'the float format moved it');
  });
});

test('fingerprint: the construction is exactly the documented one (a profile with no answers, computed here)', async () => {
  // Pins the profile's column list and order, the md5-per-row, the tag and
  // the separators, so a change to any of them is a deliberate change here too.
  const profileJson = JSON.stringify({
    address: null, lat: null, lng: null, zip: null, county: null, pwsid: null, build_year: null,
    water_source: null, home_year: null, renter_mode: false, locale: 'en', state: null,
    onboard_request_id: null, tenure: null,
  });
  const md5 = (text) => createHash('md5').update(text).digest('hex');
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  await scenario(async (tx) => {
    const { rows: [{ json }] } = await tx.query(
      `select row_to_json(r)::text as json from (select p.address, p.lat, p.lng, p.zip, p.county, p.pwsid, p.build_year,
         p.water_source, p.home_year, p.renter_mode, p.locale, p.state, p.onboard_request_id, p.tenure
         from public.profiles p where p.id = $1) r`, [CAROL]);
    assert.equal(json, profileJson, 'row_to_json text as Postgres writes it');
    assert.equal(await fingerprint(tx, CAROL, ['profiles']), sha(`halo:privacy-fingerprint:v1\nprofiles:${md5(json)}`));
    assert.equal(
      await fingerprint(tx, CAROL, ['symptom_logs', 'profiles']),
      sha(`halo:privacy-fingerprint:v1\nprofiles:${md5(json)}\nsymptom_logs:`),
    );
  }, { seed: false });
});

test('fingerprint: an empty list is one fixed constant for every household', async () => {
  await scenario(async (tx) => {
    const constant = createHash('sha256').update('halo:privacy-fingerprint:v1').digest('hex');
    assert.equal(await fingerprint(tx, ALICE, []), constant);
    assert.equal(await fingerprint(tx, BOB, []), constant);
    assert.notEqual(await fingerprint(tx, ALICE, ['symptom_logs']), await fingerprint(tx, BOB, ['symptom_logs']), 'two households with alike rows still differ (ids)');
  });
});

test('fingerprint: an unknown, server-written, repeated or null table name, or a null argument, is HALO_INVALID_INPUT', async () => {
  await scenario(async (tx) => {
    for (const tables of [['symptom_logz'], ['daily_scores'], ['operations'], ['recovery_challenges'], ['symptom_logs', 'symptom_logs'], ['symptom_logs', null], null]) {
      const error = await refusal(tx, `select public.privacy_fingerprint($1, $2::text[])`, [ALICE, tables]);
      assert.equal(error.message, 'HALO_INVALID_INPUT', JSON.stringify(tables));
    }
    const error = await refusal(tx, `select public.privacy_fingerprint(null, array['symptom_logs'])`);
    assert.equal(error.message, 'HALO_INVALID_INPUT');
  }, { seed: false });
});

// ---------------------------------------------------------------------------
// Other work in flight (P3 step 4, C13)
// ---------------------------------------------------------------------------

test('busy: another pending operation in any domain refuses clear all, with nothing deleted', async () => {
  for (const domain of ['settings', 'actions', 'privacy', 'luna']) {
    await scenario(async (tx) => {
      await claim(tx);
      await claim(tx, { operationId: crypto.randomUUID(), domain, kind: `${domain}.test` });
      const before = await snapshot(tx, ALICE);
      const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'all', await fingerprint(tx, ALICE, FINGERPRINT_TABLES)]);
      assert.equal(error.message, 'HALO_BUSY', domain);
      assert.deepEqual(await snapshot(tx, ALICE), before);
    });
  }
});

test('busy: bob\'s pending operation does not refuse alice\'s clear', async () => {
  await scenario(async (tx) => {
    await claim(tx);
    await claim(tx, { owner: BOB, operationId: crypto.randomUUID(), domain: 'settings', kind: 'settings.update' });
    assert.equal((await clear(tx)).receipt.status, 'succeeded');
  });
});

test('busy: a Luna run queued or generating within 120 seconds refuses clear all; an older one is dead and is cleared', async () => {
  const liveRun = (status, age) => async (tx) => {
    await tx.query(
      `update public.luna_runs set status = $2, settled_at = null, updated_at = now() - $3::interval
        where profile_id = $1 and turn_id = $4`,
      [ALICE, status, age, OWNED_ROW.luna_turns(ALICE, 1).id],
    );
  };
  for (const status of ['queued', 'generating']) {
    await scenario(async (tx) => {
      await liveRun(status, '0 seconds')(tx);
      await claim(tx);
      const before = await snapshot(tx, ALICE);
      const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'all', await fingerprint(tx, ALICE, FINGERPRINT_TABLES)]);
      assert.equal(error.message, 'HALO_BUSY', status);
      assert.deepEqual(await snapshot(tx, ALICE), before);
    });
  }
  await scenario(async (tx) => {
    await liveRun('generating', '3 minutes')(tx);
    await claim(tx);
    assert.equal((await clear(tx)).receipt.status, 'succeeded');
    assert.deepEqual(await rowsOf(tx, 'luna_runs', ALICE), []);
  });
});

test('busy: clear journal refuses only for another pending privacy request', async () => {
  await scenario(async (tx) => {
    await claim(tx, { scope: 'journal' });
    await claim(tx, { operationId: crypto.randomUUID(), domain: 'privacy', kind: 'privacy.export' });
    const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'journal', await fingerprint(tx, ALICE, SCOPE_TABLES.journal)]);
    assert.equal(error.message, 'HALO_BUSY');
  });
  await scenario(async (tx) => {
    await claim(tx, { scope: 'journal' });
    await claim(tx, { operationId: crypto.randomUUID(), domain: 'settings', kind: 'settings.update' });
    await tx.query(`update public.luna_runs set status = 'generating', settled_at = null, updated_at = now() where profile_id = $1`, [ALICE]);
    assert.equal((await clear(tx, { scope: 'journal' })).receipt.status, 'succeeded');
  });
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

test('clear and counts validate every argument before reading anything', async () => {
  await scenario(async (tx) => {
    await claim(tx);
    const good = await fingerprint(tx, ALICE, FINGERPRINT_TABLES);
    const before = await snapshot(tx, ALICE);
    for (const args of [
      [null, CLEAR_OP, 'all', good],
      [ALICE, null, 'all', good],
      [ALICE, CLEAR_OP, null, good],
      [ALICE, CLEAR_OP, 'everything', good],
      [ALICE, CLEAR_OP, 'export', good],
      [ALICE, CLEAR_OP, 'all', null],
      [ALICE, CLEAR_OP, 'all', good.slice(1)],
      [ALICE, CLEAR_OP, 'all', good.toUpperCase()],
      [ALICE, CLEAR_OP, 'all', `${good} `],
    ]) {
      const error = await refusal(tx, CLEAR_SQL, args);
      assert.equal(error.message, 'HALO_INVALID_INPUT', JSON.stringify(args));
    }
    for (const args of [[null, 'all'], [ALICE, null], [ALICE, 'export']]) {
      const error = await refusal(tx, `select public.privacy_counts($1, $2)`, args);
      assert.equal(error.message, 'HALO_INVALID_INPUT', JSON.stringify(args));
    }
    assert.deepEqual(await snapshot(tx, ALICE), before);
  });
});

// ---------------------------------------------------------------------------
// The settled-privacy guard (Ruling P16)
// ---------------------------------------------------------------------------

test('guard: a settled privacy row keeps its status; a same-status rewrite, a reap and other domains are unaffected', async () => {
  await scenario(async (tx) => {
    await claim(tx);
    await clear(tx);
    // runOperation's settle as failed after a lost answer: refused, the row keeps telling the truth.
    const error = await refusal(tx, `update public.operations set status = 'failed', result = null where operation_id = $1`, [CLEAR_OP]);
    assert.equal(error.message, 'HALO_OPERATION_SETTLED');
    assert.doesNotMatch(error.detail, /[0-9a-f]{8}-[0-9a-f]{4}/, 'the DETAIL names no id');
    // runOperation's own settle after success: the same receipt, rewritten as succeeded.
    const rewrite = await attempt(tx,
      `update public.operations set status = 'succeeded', result = $2::jsonb where operation_id = $1`,
      [CLEAR_OP, JSON.stringify({ operationId: CLEAR_OP, status: 'succeeded', scope: 'all' })]);
    assert.equal(rewrite.ok, true);

    // A failed privacy row cannot become succeeded either.
    const failed = crypto.randomUUID();
    await claim(tx, { operationId: failed, kind: 'privacy.export', status: 'failed', result: { status: 'failed', reason: 'too_large' } });
    assert.equal((await refusal(tx, `update public.operations set status = 'succeeded' where operation_id = $1`, [failed])).message, 'HALO_OPERATION_SETTLED');

    // A pending privacy row is still reaped.
    const pending = crypto.randomUUID();
    await claim(tx, { operationId: pending, kind: 'privacy.export' });
    assert.equal((await attempt(tx, `update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}'::jsonb where operation_id = $1 and status = 'pending'`, [pending])).ok, true);

    // Domains with no guard of their own are unaffected by this one.
    for (const domain of ['luna', 'summary']) {
      const other = crypto.randomUUID();
      await claim(tx, { operationId: other, domain, kind: `${domain}.test`, status: 'succeeded', result: { status: 'succeeded' } });
      assert.equal((await attempt(tx, `update public.operations set status = 'failed' where operation_id = $1`, [other])).ok, true, domain);
    }
  });
});

test('guard: a privacy row can still be deleted, which is how the purge and an account deletion remove it', async () => {
  await scenario(async (tx) => {
    await claim(tx, { status: 'succeeded', result: { status: 'succeeded' } });
    assert.equal((await attempt(tx, `delete from public.operations where operation_id = $1`, [CLEAR_OP])).ok, true);
  });
});

// ---------------------------------------------------------------------------
// The receipt purge (Ruling P10)
// ---------------------------------------------------------------------------

test('purge: settled privacy rows older than 24 hours go; younger, pending and other domains stay; an owner scopes it', async () => {
  await scenario(async (tx) => {
    const rows = {};
    const add = async (label, owner, domain, status, age) => {
      rows[label] = crypto.randomUUID();
      await tx.query(
        `insert into public.operations (operation_id, profile_id, domain, kind, status, result, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now() - $7::interval, now() - $7::interval)`,
        [rows[label], owner, domain, `${domain}.test`, status, status === 'succeeded' ? '{"status":"succeeded"}' : null, age],
      );
    };
    await add('alice old succeeded', ALICE, 'privacy', 'succeeded', '25 hours');
    await add('alice old failed', ALICE, 'privacy', 'failed', '30 hours');
    await add('alice young', ALICE, 'privacy', 'succeeded', '23 hours');
    await add('alice old pending', ALICE, 'privacy', 'pending', '30 hours');
    await add('alice old settings', ALICE, 'settings', 'succeeded', '30 hours');
    await add('bob old succeeded', BOB, 'privacy', 'succeeded', '25 hours');
    const present = async () => {
      const { rows: found } = await tx.query(`select operation_id from public.operations where operation_id = any ($1::uuid[])`, [Object.values(rows)]);
      const ids = new Set(found.map((row) => row.operation_id));
      return Object.keys(rows).filter((label) => ids.has(rows[label])).sort();
    };

    assert.deepEqual((await tx.query(`select public.purge_privacy_receipts($1) as n`, [ALICE])).rows, [{ n: 2 }]);
    assert.deepEqual(await present(), ['alice old pending', 'alice old settings', 'alice young', 'bob old succeeded']);
    assert.deepEqual((await tx.query(`select public.purge_privacy_receipts() as n`)).rows, [{ n: 1 }]);
    assert.deepEqual(await present(), ['alice old pending', 'alice old settings', 'alice young']);
    assert.deepEqual((await tx.query(`select public.purge_privacy_receipts() as n`)).rows, [{ n: 0 }]);
  }, { seed: false });
});

test('purge: rows a clear in progress holds are skipped, never waited on, and the clear removes them itself (Task 1 review, finding 1)', async () => {
  // What this shows: with a clear all parked just before its commit (a
  // prepared transaction, holding the delete locks on alice's settled
  // receipts), the purge returns at once, deletes only the rows nobody holds,
  // and leaves the held ones; the clear's commit then removes them. A second
  // holder that rolls back leaves its rows for the next purge. What it cannot
  // show: two live sessions interleaving their scans, which is the deadlock
  // itself. That is argued in the migration's lock graph: a purge that never
  // waits on a row can never be one side of a cycle. A purge without SKIP
  // LOCKED waits forever here (PGlite cannot time a lock out), so the
  // scenario runs in a child process with a deadline.
  const script = fileURLToPath(new URL('./db/privacyPurgeHeldLock.mjs', import.meta.url));
  const stdout = await new Promise((resolve, reject) => {
    execFile(process.execPath, [script], { timeout: 60_000 }, (error, out, err) => {
      if (error?.killed) reject(new Error('the purge waited on a row another transaction holds: it is not FOR UPDATE SKIP LOCKED'));
      else if (error) reject(new Error(`${error.message}\n${err}`));
      else resolve(out);
    });
  });
  const seen = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(seen.purgedWhileClearHeld, 1, 'only bob\'s receipt, which nobody held');
  assert.equal(seen.aliceWhileClearHeld, 2, 'the held receipts were left for the clear');
  assert.equal(seen.bobWhileClearHeld, 0);
  assert.deepEqual(seen.aliceAfterClear, [CLEAR_OP], 'the clear removed them itself and kept only its own receipt');
  assert.deepEqual(seen.bobAfterClear, []);
  assert.equal(seen.purgedWhileHeld, 0, 'a held row is skipped');
  assert.equal(seen.purgedAfterRelease, 2, 'and purged on the next run once released');
  assert.equal(seen.heldLeft, 0);
});

test('purge: the stored function selects its rows FOR UPDATE SKIP LOCKED in a subselect', async () => {
  const { rows: [{ src }] } = await db.query(
    `select prosrc as src from pg_proc where oid = 'public.purge_privacy_receipts(uuid)'::regprocedure`,
  );
  const code = src.replace(/--[^\n]*/g, '');
  assert.match(code, /delete from public\.operations o\s+where o\.operation_id in \(\s*select x\.operation_id from public\.operations x[\s\S]*for update skip locked\)/);
});

test('lock graph: on this schema an insert into luna_turns, luna_runs or daily_scores checks its profiles key first (Task 1 review, finding 3)', async () => {
  // The header's no-cycle argument for the Luna and cron inserts rests on
  // this: Postgres fires a table's RI check triggers in name order, so the
  // insert waits on the profile before it holds a key share on anything the
  // clear deletes.
  for (const [table, others] of [
    ['luna_turns', ['luna_conversations']],
    ['luna_runs', ['luna_conversations', 'luna_turns']],
    ['daily_scores', ['home_contexts']],
  ]) {
    const { rows } = await db.query(
      `select t.tgname::text as name, parent.relname::text as parent
         from pg_trigger t
         join pg_constraint c on c.oid = t.tgconstraint
         join pg_class parent on parent.oid = c.confrelid
        where t.tgrelid = $1::regclass and t.tgfoid = 'pg_catalog."RI_FKey_check_ins"'::regproc
        order by t.tgname::text collate "C"`,
      [`public.${table}`],
    );
    const parents = rows.map((row) => row.parent);
    assert.equal(parents[0], 'profiles', `${table}: the first RI check is on ${parents[0]}`);
    for (const other of others) assert.ok(parents.indexOf(other) > 0, `${table}: no RI check on ${other}`);
  }
});

/** A client that records each write writeBackfillState sends, and answers success. */
function recordingClient() {
  const writes = [];
  return {
    writes,
    from(table) {
      const write = { table, payload: null, filters: {} };
      writes.push(write);
      const chain = {
        update(payload) { write.payload = payload; return chain; },
        eq(column, value) { write.filters[column] = value; return chain; },
        then(resolve) { resolve({ error: null }); },
      };
      return chain;
    },
  };
}

test('fingerprint: home_contexts is hashed on every column but the four backfill_* columns', async () => {
  const { rows: [{ src }] } = await db.query(
    `select prosrc as src from pg_proc where oid = 'public.privacy_fingerprint(uuid, text[])'::regprocedure`,
  );
  const projection = src.match(/select (c\.id[\s\S]*?)\s+from public\.home_contexts c/)?.[1];
  assert.ok(projection, 'privacy_fingerprint has no explicit home_contexts projection');
  const hashed = projection.split(',').map((item) => item.trim().replace(/^c\./, ''));
  const { rows } = await db.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'home_contexts' order by ordinal_position`,
  );
  const backfill = ['backfill_state', 'backfill_from', 'backfill_to', 'backfill_updated_at'];
  assert.deepEqual(hashed, rows.map((row) => row.column_name).filter((column) => !backfill.includes(column)),
    'home_contexts gained or lost a column: add it to privacy_fingerprint\'s home_contexts projection (0024 section 3)');
  assert.ok(hashed.includes('revision') && hashed.includes('updated_at'));
});

test('fingerprint: the history backfill between review and confirm does not void a clear all; a real home edit still does (Task 1 review, finding 2)', async () => {
  await scenario(async (tx) => {
    await claim(tx);
    const reviewed = await fingerprint(tx, ALICE, FINGERPRINT_TABLES);
    // What onboarding's after() does: running, then a terminal state, through the real writer.
    const client = recordingClient();
    for (const state of ['running', 'complete']) {
      const saved = await writeBackfillState(client, {
        profileId: ALICE, contextId: contextId(ALICE, 0), state, from: '2026-01-01', to: '2026-10-18', at: new Date('2026-10-19T12:00:00Z'),
      });
      assert.deepEqual(saved, { saved: true });
    }
    for (const { table, payload, filters } of client.writes) {
      assert.equal(table, 'home_contexts');
      const columns = Object.keys(payload);
      await tx.query(
        `update public.home_contexts set ${columns.map((column, at) => `${ident(column)} = $${at + 3}`).join(', ')}
          where profile_id = $1 and id = $2`,
        [filters.profile_id, filters.id, ...Object.values(payload)],
      );
    }
    const { rows: [row] } = await tx.query(`select backfill_state, backfill_to::text as backfill_to from public.home_contexts where id = $1`, [contextId(ALICE, 0)]);
    assert.deepEqual(row, { backfill_state: 'complete', backfill_to: '2026-10-18' }, 'the backfill write did not land');
    assert.equal(await fingerprint(tx, ALICE, FINGERPRINT_TABLES), reviewed, 'the backfill moved the fingerprint');
    assert.equal((await clear(tx, { print: reviewed })).receipt.status, 'succeeded');
  });
  await scenario(async (tx) => {
    await claim(tx);
    const reviewed = await fingerprint(tx, ALICE, FINGERPRINT_TABLES);
    await tx.query(`update public.home_contexts set water_source = 'well' where id = $1`, [contextId(ALICE, 0)]);
    const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'all', reviewed]);
    assert.equal(error.message, 'HALO_REVIEW_CHANGED');
  });
});

/** Whether a stored row matches an inventory filter (one or several that must all hold). */
function rowMatches(where, row, ownOperationId) {
  const value = (raw) => (raw === OWN_OPERATION ? ownOperationId : raw);
  return [where].flat().every((filter) => {
    if (Object.hasOwn(filter, 'equals')) return row[filter.column] === value(filter.equals);
    if (Object.hasOwn(filter, 'notEquals')) return row[filter.column] !== value(filter.notEquals);
    return filter.in.map(value).includes(row[filter.column]);
  });
}

test('the inventory\'s ledger placement is what 0024 does: settled only, refuse on pending (Task 1 review, finding 5)', async () => {
  const placement = clearActionFor('operations', 'all');
  assert.equal(placement.action, 'delete-filtered');
  assert.equal(CLEAR_ALL.operations, 'own-receipt');
  // privacy_counts reads before any claim, so its count is the inventory filter over every ledger row.
  await scenario(async (tx) => {
    await claim(tx, { operationId: crypto.randomUUID(), domain: 'settings', kind: 'settings.update' }); // pending, another domain
    const { rows: ledger } = await tx.query(`select operation_id, status from public.operations where profile_id = $1`, [ALICE]);
    assert.ok(ledger.some((row) => row.status === 'pending') && ledger.some((row) => row.status !== 'pending'));
    const counted = Number((await tx.query(`select public.privacy_counts($1, 'all') as c`, [ALICE])).rows[0].c.operations);
    assert.equal(counted, ledger.filter((row) => rowMatches(placement.where, row, CLEAR_OP)).length);
    // The pending row matches refuseWhen, and the clear refuses with exactly that code.
    await claim(tx);
    const { rows: withOwn } = await tx.query(`select operation_id, status from public.operations where profile_id = $1`, [ALICE]);
    assert.equal(withOwn.filter((row) => rowMatches(placement.refuseWhen.where, row, CLEAR_OP)).length, 1);
    const error = await refusal(tx, CLEAR_SQL, [ALICE, CLEAR_OP, 'all', await fingerprint(tx, ALICE, FINGERPRINT_TABLES)]);
    assert.equal(error.message, placement.refuseWhen.refusal);
  });
  // With nothing pending, the rows the clear deletes are exactly those the inventory's filter selects.
  await scenario(async (tx) => {
    await claim(tx);
    const { rows: before } = await tx.query(`select operation_id, status from public.operations where profile_id = $1`, [ALICE]);
    const selected = before.filter((row) => rowMatches(placement.where, row, CLEAR_OP)).map((row) => row.operation_id).sort();
    await clear(tx);
    const { rows: after } = await tx.query(`select operation_id from public.operations where profile_id = $1`, [ALICE]);
    const gone = before.map((row) => row.operation_id).filter((id) => !after.some((row) => row.operation_id === id)).sort();
    assert.deepEqual(gone, selected);
    assert.ok(selected.length >= 3);
  });
});

// ---------------------------------------------------------------------------
// No row content in an error (0021 review finding B)
// ---------------------------------------------------------------------------

test('no refusal in this file carried an id, a fingerprint or a seeded value in its DETAIL', () => {
  assert.ok(details.length >= 30, `only ${details.length} refusals were collected; the suite did not run in order`);
  const seeded = Object.values(PROFILE_SEED).map(String).filter((value) => value.length >= 5);
  const forbidden = [ALICE, BOB, CAROL, CLEAR_OP, ...seeded, 'Test', 'cough', 'season'];
  for (const detail of details) {
    for (const marker of forbidden) assert.ok(!detail.includes(marker), `a DETAIL carried "${marker}": ${detail}`);
    assert.doesNotMatch(detail, /[0-9a-f]{64}/, `a DETAIL carried a fingerprint: ${detail}`);
  }
});
