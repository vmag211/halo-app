/**
 * Migration 0025 on PGlite (B08 plan, Task 1): the daily_maxima table and its
 * checks, the recorder's one-row state, record_daily_maxima and its finality
 * rule, the final guard trigger, the probe, the cascades of Ruling E23 and
 * Vibhav's 2026-10-19 decisions (modeled maxima allowed and marked, a home
 * never mixes measured and modeled in one series, kept until deleted).
 *
 * Each scenario runs as the service role inside one transaction that is
 * rolled back afterwards, and each call that is expected to refuse runs inside
 * a savepoint, which is the statement-level atomicity a PostgREST RPC has: a
 * function call that raises leaves nothing behind.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';

const MIGRATION = listMigrations().find((migration) => migration.number === 25);
const PRIVACY = listMigrations().find((migration) => migration.number === 24);

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const ALICE_HOME = 'a11ce000-0000-4000-8000-00000000c001';
const ALICE_OLD_HOME = 'a11ce000-0000-4000-8000-00000000c002';
const BOB_HOME = 'b0b00000-0000-4000-8000-00000000c001';
const CLEAR_OP = '00000000-0000-4000-8000-0000000b0801';
const RECORDING_FROM = '2026-10-20';

const ALL_TABLES = [
  'profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs', 'push_subscriptions',
  'profile_preferences', 'explore_areas', 'household_actions', 'household_action_preferences', 'luna_conversations', 'luna_turns',
];

/** A valid row: a modeled Air maximum from a full day at alice's current home. */
const row = (overrides = {}) => ({
  profile_id: ALICE,
  home_context_id: ALICE_HOME,
  local_date: '2026-10-21',
  factor: 'air',
  value: 42,
  unit: 'AQI',
  source_code: 'open_meteo_cams',
  method_version: 'daily-max-v1',
  time_zone: 'America/New_York',
  hours_expected: 24,
  hours_observed: 24,
  retrieved_at: '2026-10-22T12:00:00Z',
  ...overrides,
});
const uv = (overrides = {}) => row({ factor: 'uv', unit: 'UV index', source_code: 'open_meteo_forecast', value: 6.3, ...overrides });
const measured = (overrides = {}) => row({ source_code: 'airnow_station', station_id: '370250004', ...overrides });
const pending = (overrides = {}) => row({ value: null, missing_code: 'pending', hours_observed: 20, ...overrides });

let db;
/** Every DETAIL a refusal carried, checked at the end for row content. */
const details = [];

before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`);
  await db.exec(`
    insert into public.home_contexts (id, profile_id, sequence, origin, lat, lng, effective_from) values
      ('${ALICE_HOME}', '${ALICE}', 1, 'onboard', 35.409, -80.58, '2026-10-01T12:00:00Z'),
      ('${BOB_HOME}', '${BOB}', 1, 'onboard', 35.227, -80.843, '2026-10-01T12:00:00Z');`);
});

after(async () => {
  await db?.close();
});

/** Runs fn(tx) as the service role in one transaction, then rolls it back. */
function scenario(fn, { begin = true } = {}) {
  return db.pg.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    if (begin) await tx.query(`select public.begin_daily_maxima_run($1)`, [RECORDING_FROM]);
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
    if (error.code === 'P0001') details.push(error.detail ?? '');
    return { ok: false, error };
  }
}

async function refusal(tx, sql, params) {
  const outcome = await attempt(tx, sql, params);
  assert.equal(outcome.ok, false, `expected a refusal from: ${sql}`);
  return outcome.error;
}

const RECORD = `select public.record_daily_maxima($1::jsonb) as out`;
const record = async (tx, rows) => (await tx.query(RECORD, [JSON.stringify(rows)])).rows[0].out;
/** `rows` as a value, or as raw JSON text when it is a string (for numbers JavaScript cannot hold). */
const recordRefusal = (tx, rows) => refusal(tx, RECORD, [rows === null || typeof rows === 'string' ? rows : JSON.stringify(rows)]);

const INSERT = `insert into public.daily_maxima (profile_id, home_context_id, local_date, factor, value, unit, source_code,
  station_id, method_version, time_zone, hours_expected, hours_observed, missing_code, retrieved_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`;
const insertParams = (r) => [
  r.profile_id, r.home_context_id, r.local_date, r.factor, r.value, r.unit, r.source_code ?? null, r.station_id ?? null,
  r.method_version, r.time_zone, r.hours_expected, r.hours_observed, r.missing_code ?? null, r.retrieved_at,
];
/** A direct insert in a savepoint, bypassing the function, so each CHECK is met alone. */
const insertDirect = (tx, r) => attempt(tx, INSERT, insertParams(r));

const stored = async (tx) => (await tx.query(
  `select home_context_id, local_date::text as local_date, factor, value, source_code, missing_code, hours_observed
     from public.daily_maxima order by home_context_id, local_date, factor`,
)).rows;
const countOf = async (tx, table = 'daily_maxima') => (await tx.query(`select count(*)::int as n from public.${table}`)).rows[0].n;

// ---------------------------------------------------------------------------
// Applying 0025
// ---------------------------------------------------------------------------

for (const upTo of [23, 24]) {
  test(`0025 applies over 0001 to 00${upTo}, re-applies, and leaves the schema as one pass did`, async () => {
    const fresh = await createDb({ upTo });
    try {
      await fresh.applyMigration(MIGRATION);
      const once = await runAudit(fresh);
      await fresh.applyMigration(MIGRATION);
      assert.deepEqual(await runAudit(fresh), once);
      assert.deepEqual((await fresh.query(`select public.daily_maxima_schema_version() as v`)).rows, [{ v: 1 }]);
    } finally {
      await fresh.close();
    }
  });
}

test('0025 applied over 0023 and then 0024 gives exactly the schema of applying them in order', async () => {
  const reversed = await createDb({ upTo: 23 });
  try {
    await reversed.applyMigration(MIGRATION);
    await reversed.applyMigration(PRIVACY);
    assert.deepEqual(await runAudit(reversed), await runAudit(db));
  } finally {
    await reversed.close();
  }
});

test('0025 refuses to apply without 0016, naming it, and creates nothing', async () => {
  const lagging = await createDb({ upTo: 15 });
  try {
    await assert.rejects(lagging.applyMigration(MIGRATION), /HALO 0025 cannot be applied: missing public\.home_contexts \(0016\)\. Apply 0016 first\./);
    const { rows } = await lagging.query(`select to_regclass('public.daily_maxima') is null as no_table,
      to_regclass('public.daily_maxima_recorder') is null as no_recorder,
      to_regprocedure('public.daily_maxima_schema_version()') is null as no_probe`);
    assert.deepEqual(rows, [{ no_table: true, no_recorder: true, no_probe: true }]);
  } finally {
    await lagging.close();
  }
});

test('every 0025 function is security invoker with search_path pinned, and only the service role may run it', async () => {
  const { rows } = await db.query(
    `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any ($1::text[]) order by p.proname`,
    [['daily_maxima_schema_version', 'begin_daily_maxima_run', 'record_daily_maxima', 'finish_daily_maxima_run', 'guard_final_daily_maximum']],
  );
  assert.equal(rows.length, 5);
  for (const fn of rows) {
    assert.equal(fn.definer, false, `${fn.name} is security definer`);
    assert.ok(fn.config?.includes('search_path=public'), `${fn.name} does not pin search_path`);
    assert.equal(fn.anon, false, `${fn.name}: anon may execute`);
    assert.equal(fn.authenticated, false, `${fn.name}: authenticated may execute`);
    if (fn.name !== 'guard_final_daily_maximum') assert.equal(fn.service_role, true, `${fn.name}: service_role may not execute`);
  }
});

test('anon and authenticated are refused every 0025 function as a call, and both tables', async () => {
  const calls = [
    `select public.daily_maxima_schema_version()`,
    `select public.begin_daily_maxima_run('2026-10-20')`,
    `select public.record_daily_maxima('[]'::jsonb)`,
    `select public.finish_daily_maxima_run('{}'::jsonb)`,
    `select count(*) from public.daily_maxima`,
    `select count(*) from public.daily_maxima_recorder`,
  ];
  for (const [role, user] of [['anon', null], ['authenticated', ALICE]]) {
    for (const call of calls) {
      await assert.rejects(db.asRole(role, user, (tx) => tx.query(call)), /permission denied/, `${role}: ${call}`);
    }
  }
});

test('the service role executes all four called functions', async () => {
  await scenario(async (tx) => {
    assert.deepEqual((await tx.query(`select public.daily_maxima_schema_version() as v`)).rows, [{ v: 1 }]);
    assert.equal(typeof (await record(tx, [row()])).inserted, 'number');
    assert.ok((await tx.query(`select public.finish_daily_maxima_run('{"rows": 1}'::jsonb) as t`)).rows[0].t);
  });
});

test('the verification query in the migration returns one row, every column true, and each column discriminates', async () => {
  const lines = MIGRATION.sql.split('\n');
  const start = lines.findIndex((line) => /^--\s*Verification \(read only\)/.test(line));
  const body = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('--') && !/^-- -{10,}/.test(lines[i]); i += 1) body.push(lines[i].replace(/^--\s?/, ''));
  const query = body.join('\n');
  const { rows } = await db.query(query);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), [
    'rls_on', 'no_policies', 'no_client_access', 'functions_service_role_only', 'functions_invoker_pinned',
    'final_guard_on', 'both_links_cascade', 'fourteen_checks',
  ]);
  for (const [column, value] of Object.entries(rows[0])) assert.equal(value, true, column);

  const breaks = {
    rls_on: 'alter table public.daily_maxima_recorder disable row level security',
    no_policies: 'create policy test_open on public.daily_maxima for select using (true)',
    no_client_access: 'grant select on public.daily_maxima_recorder to authenticated',
    functions_service_role_only: 'grant execute on function public.record_daily_maxima(jsonb) to anon',
    functions_invoker_pinned: 'alter function public.begin_daily_maxima_run(date) security definer',
    final_guard_on: 'drop trigger daily_maxima_final_guard on public.daily_maxima',
    both_links_cascade: `alter table public.daily_maxima drop constraint daily_maxima_home_context_fkey`,
    fourteen_checks: 'alter table public.daily_maxima drop constraint daily_maxima_time_zone_check',
  };
  for (const [column, statement] of Object.entries(breaks)) {
    const broken = await db.pg.transaction(async (tx) => {
      await tx.exec(statement);
      const { rows: [result] } = await tx.query(query);
      await tx.rollback();
      return result;
    });
    assert.equal(broken[column], false, `${column} did not notice: ${statement}`);
  }
});

test('no U+2014 anywhere in the migration', () => {
  assert.ok(!MIGRATION.sql.includes(String.fromCharCode(0x2014)));
});

// ---------------------------------------------------------------------------
// The CHECKs, each met alone by a direct insert
// ---------------------------------------------------------------------------

const REFUSED = [
  ['a pollen factor', row({ factor: 'pollen', unit: 'category' }), 'daily_maxima_factor_check'],
  ['an Air row in UV units', row({ unit: 'UV index' }), 'daily_maxima_unit_check'],
  ['a UV row in AQI', uv({ unit: 'AQI' }), 'daily_maxima_unit_check'],
  ['a value with a missing code', row({ missing_code: 'source_gap' }), 'daily_maxima_value_missing_check'],
  ['neither a value nor a missing code', row({ value: null }), 'daily_maxima_value_missing_check'],
  ['a negative value', uv({ value: -0.1 }), 'daily_maxima_value_range_check'],
  ['Infinity', uv({ value: 'Infinity' }), 'daily_maxima_value_range_check'],
  ['NaN', uv({ value: 'NaN' }), 'daily_maxima_value_range_check'],
  ['a fractional AQI', row({ value: 42.5 }), 'daily_maxima_air_integer_check'],
  ['an unknown missing code', pending({ missing_code: 'later' }), 'daily_maxima_missing_code_check'],
  ['an unknown source', row({ source_code: 'purpleair' }), 'daily_maxima_source_check'],
  ['a UV row from an AirNow station', uv({ source_code: 'airnow_station', station_id: '370250004' }), 'daily_maxima_source_check'],
  ['an Air row from the forecast model', row({ source_code: 'open_meteo_forecast' }), 'daily_maxima_source_check'],
  ['a value with no source', row({ source_code: null }), 'daily_maxima_value_source_check'],
  ['an AirNow row without a station', measured({ station_id: null }), 'daily_maxima_station_check'],
  ['a modeled row with a station', row({ station_id: '370250004' }), 'daily_maxima_station_check'],
  ['a station site name instead of a code', measured({ station_id: 'Rockwell Station' }), 'daily_maxima_station_check'],
  ['a 33-character station code', measured({ station_id: '1'.repeat(33) }), 'daily_maxima_station_check'],
  ['22 expected hours', pending({ hours_expected: 22 }), 'daily_maxima_hours_expected_check'],
  ['26 expected hours', pending({ hours_expected: 26 }), 'daily_maxima_hours_expected_check'],
  ['more hours observed than expected', pending({ hours_observed: 25 }), 'daily_maxima_hours_observed_check'],
  ['negative hours observed', pending({ hours_observed: -1 }), 'daily_maxima_hours_observed_check'],
  ['a value from 17 of 24 hours', row({ hours_observed: 17 }), 'daily_maxima_coverage_check'],
  ['a value from 17 of 23 hours', row({ hours_expected: 23, hours_observed: 17 }), 'daily_maxima_coverage_check'],
  ['a value from 18 of 25 hours', row({ hours_expected: 25, hours_observed: 18 }), 'daily_maxima_coverage_check'],
  ['an empty method version', row({ method_version: '' }), 'daily_maxima_method_version_check'],
  ['a blank method version', row({ method_version: '   ' }), 'daily_maxima_method_version_check'],
  ['a 65-character method version', row({ method_version: 'v'.repeat(65) }), 'daily_maxima_method_version_check'],
  ['another time zone', row({ time_zone: 'America/Chicago' }), 'daily_maxima_time_zone_check'],
];

test('each CHECK refuses the row it exists for, by name (23514)', async () => {
  await scenario(async (tx) => {
    for (const [label, candidate, constraint] of REFUSED) {
      const outcome = await insertDirect(tx, candidate);
      assert.equal(outcome.ok, false, `${label} was stored`);
      assert.equal(outcome.error.code, '23514', label);
      assert.match(outcome.error.message, new RegExp(constraint), label);
    }
    assert.equal(await countOf(tx), 0);
  });
});

test('every CHECK on the table is exercised above, so none can be dropped unnoticed', async () => {
  const { rows } = await db.query(`select conname from pg_constraint where conrelid = 'public.daily_maxima'::regclass and contype = 'c' order by 1`);
  assert.deepEqual(rows.map((r) => r.conname), [...new Set(REFUSED.map(([, , name]) => name))].sort());
});

test('the edges the CHECKs must accept are accepted', async () => {
  const accepted = [
    ['18 of 24 hours', row({ local_date: '2026-10-21', hours_observed: 18 })],
    ['18 of 23 hours (spring forward)', row({ local_date: '2027-03-14', hours_expected: 23, hours_observed: 18 })],
    ['19 of 25 hours (fall back)', row({ local_date: '2026-11-01', hours_expected: 25, hours_observed: 19 })],
    ['a value of 0, which the source said', uv({ local_date: '2026-10-21', value: 0 })],
    ['a UV index to one decimal', uv({ local_date: '2026-10-22', value: 7.3 })],
    ['a measured row with its station', measured({ home_context_id: BOB_HOME, profile_id: BOB })],
    ['a pending row with no source yet', pending({ local_date: '2026-10-23', source_code: null, hours_observed: 0 })],
    ['a source gap at a measured home', measured({ home_context_id: BOB_HOME, profile_id: BOB, local_date: '2026-10-22', value: null, missing_code: 'source_gap', hours_observed: 10 })],
    ['unavailable with no source', uv({ local_date: '2026-10-23', value: null, source_code: null, missing_code: 'unavailable', hours_observed: 0 })],
  ];
  await scenario(async (tx) => {
    for (const [label, candidate] of accepted) {
      const outcome = await insertDirect(tx, candidate);
      assert.equal(outcome.ok, true, `${label}: ${outcome.error?.message}`);
    }
  });
});

test('the recorder table holds one row, and its counts are an object', async () => {
  await scenario(async (tx) => {
    const second = await attempt(tx, `insert into public.daily_maxima_recorder (singleton, recording_from) values (false, '2026-10-01')`);
    assert.equal(second.error?.code, '23514');
    assert.match(second.error.message, /daily_maxima_recorder_singleton_check/);
    const duplicate = await attempt(tx, `insert into public.daily_maxima_recorder (recording_from) values ('2026-10-01')`);
    assert.equal(duplicate.error?.code, '23505');
    const array = await attempt(tx, `update public.daily_maxima_recorder set last_run = '[1]'::jsonb`);
    assert.equal(array.error?.code, '23514');
    assert.match(array.error.message, /daily_maxima_recorder_last_run_check/);
  });
});

// ---------------------------------------------------------------------------
// The links and the cascades (Ruling E23)
// ---------------------------------------------------------------------------

test('the home link refuses another household\'s home and a home that does not exist (23503)', async () => {
  await scenario(async (tx) => {
    const foreign = await insertDirect(tx, row({ home_context_id: BOB_HOME }));
    assert.equal(foreign.error?.code, '23503');
    assert.match(foreign.error.message, /daily_maxima_home_context_fkey/);
    const missing = await insertDirect(tx, row({ home_context_id: 'a11ce000-0000-4000-8000-00000000dead' }));
    assert.equal(missing.error?.code, '23503');
  });
});

test('deleting a home deletes its maxima, and deleting the profile deletes them all', async () => {
  await scenario(async (tx) => {
    await record(tx, [row(), uv(), measured({ profile_id: BOB, home_context_id: BOB_HOME })]);
    await tx.query(`delete from public.home_contexts where id = $1`, [ALICE_HOME]);
    assert.deepEqual((await stored(tx)).map((r) => r.home_context_id), [BOB_HOME]);
  });
  await scenario(async (tx) => {
    await record(tx, [row(), uv(), measured({ profile_id: BOB, home_context_id: BOB_HOME })]);
    await tx.query(`delete from public.profiles where id = $1`, [ALICE]);
    assert.deepEqual((await stored(tx)).map((r) => r.home_context_id), [BOB_HOME]);
  });
});

test('a home with daily_scores still refuses to be deleted, as 0016 made it (0016 unchanged)', async () => {
  await scenario(async (tx) => {
    await record(tx, [row()]);
    await tx.query(`insert into public.daily_scores (profile_id, date, aqi, home_context_id) values ($1, '2026-10-21', 40, $2)`, [ALICE, ALICE_HOME]);
    const outcome = await attempt(tx, `delete from public.home_contexts where id = $1`, [ALICE_HOME]);
    assert.equal(outcome.error?.code, '23503');
    assert.match(outcome.error.message, /daily_scores/);
    assert.equal(await countOf(tx), 1, 'the maxima stay with the home that could not be deleted');
  });
});

test('a deleted daily maximum is gone: deletes are never guarded', async () => {
  await scenario(async (tx) => {
    await record(tx, [row(), pending({ factor: 'uv', unit: 'UV index', source_code: 'open_meteo_forecast', value: null, missing_code: 'source_gap' })]);
    const outcome = await attempt(tx, `delete from public.daily_maxima where profile_id = $1`, [ALICE]);
    assert.equal(outcome.ok, true);
    assert.equal(await countOf(tx), 0);
  });
});

// ---------------------------------------------------------------------------
// begin_daily_maxima_run (Ruling E9)
// ---------------------------------------------------------------------------

test('begin_daily_maxima_run sets recording_from once: a second call keeps the first date', async () => {
  await scenario(async (tx) => {
    const first = (await tx.query(`select public.begin_daily_maxima_run('2026-10-20')::text as d`)).rows[0].d;
    const later = (await tx.query(`select public.begin_daily_maxima_run('2026-10-25')::text as d`)).rows[0].d;
    const earlier = (await tx.query(`select public.begin_daily_maxima_run('2026-10-01')::text as d`)).rows[0].d;
    assert.deepEqual([first, later, earlier], ['2026-10-20', '2026-10-20', '2026-10-20']);
    assert.equal(await countOf(tx, 'daily_maxima_recorder'), 1);
    const error = await refusal(tx, `select public.begin_daily_maxima_run(null)`);
    assert.equal(error.message, 'HALO_INVALID_INPUT');
  }, { begin: false });
});

// ---------------------------------------------------------------------------
// record_daily_maxima and the final guard (Rulings E3, E4, E9)
// ---------------------------------------------------------------------------

test('record: inserts, updates a pending row, and keeps a valued or final row exactly as it was', async () => {
  await scenario(async (tx) => {
    assert.deepEqual(await record(tx, [pending(), uv({ value: null, missing_code: 'pending', hours_observed: 12 })]), { inserted: 2, updated: 0, kept: 0, skipped: 0 });
    // The second run: Air completes, UV is still short.
    assert.deepEqual(await record(tx, [row({ hours_observed: 23 }), uv({ value: null, missing_code: 'pending', hours_observed: 16 })]), { inserted: 0, updated: 2, kept: 0, skipped: 0 });
    // The third run: UV is final as a gap.
    assert.deepEqual(await record(tx, [uv({ value: null, missing_code: 'source_gap', hours_observed: 17 })]), { inserted: 0, updated: 1, kept: 0, skipped: 0 });
    const settled = await stored(tx);
    // A later run with other numbers changes nothing: both rows are final.
    assert.deepEqual(await record(tx, [row({ value: 99 }), uv({ value: 9.9 })]), { inserted: 0, updated: 0, kept: 2, skipped: 0 });
    assert.deepEqual(await record(tx, [pending()]), { inserted: 0, updated: 0, kept: 1, skipped: 0 });
    assert.deepEqual(await stored(tx), settled);
    assert.deepEqual(settled.map(({ factor, value, missing_code, hours_observed }) => ({ factor, value, missing_code, hours_observed })), [
      { factor: 'air', value: 42, missing_code: null, hours_observed: 23 },
      { factor: 'uv', value: null, missing_code: 'source_gap', hours_observed: 17 },
    ]);
  });
});

test('the final guard: a direct update of a valued or final row raises HALO_DAILY_MAXIMUM_FINAL; a pending row may change', async () => {
  await scenario(async (tx) => {
    await record(tx, [row(), uv({ value: null, missing_code: 'unavailable', hours_observed: 0, source_code: null }), pending({ local_date: '2026-10-22' })]);
    for (const [label, sql] of [
      ['a valued row', `update public.daily_maxima set value = 1 where factor = 'air' and local_date = '2026-10-21'`],
      ['a valued row, a no-op', `update public.daily_maxima set value = value where factor = 'air' and local_date = '2026-10-21'`],
      ['a valued row back to pending', `update public.daily_maxima set value = null, missing_code = 'pending' where factor = 'air' and local_date = '2026-10-21'`],
      ['a final unavailable row', `update public.daily_maxima set missing_code = 'source_gap' where factor = 'uv'`],
    ]) {
      const error = await refusal(tx, sql);
      assert.equal(error.message, 'HALO_DAILY_MAXIMUM_FINAL', label);
    }
    const open = await attempt(tx, `update public.daily_maxima set hours_observed = 21 where local_date = '2026-10-22'`);
    assert.equal(open.ok, true);
    assert.equal((await tx.query(`select hours_observed from public.daily_maxima where local_date = '2026-10-22'`)).rows[0].hours_observed, 21);
  });
});

test('a row before recording_from raises HALO_BEFORE_RECORDING, and nothing of the batch lands', async () => {
  await scenario(async (tx) => {
    const error = await recordRefusal(tx, [row({ local_date: '2026-10-21' }), uv({ local_date: '2026-10-19' })]);
    assert.equal(error.message, 'HALO_BEFORE_RECORDING');
    assert.equal(await countOf(tx), 0);
    // recording_from itself is recorded.
    assert.equal((await record(tx, [row({ local_date: RECORDING_FROM })])).inserted, 1);
  });
});

test('before any run has begun, every row raises HALO_BEFORE_RECORDING and finishing raises HALO_RECORDING_NOT_BEGUN', async () => {
  await scenario(async (tx) => {
    assert.equal((await recordRefusal(tx, [row()])).message, 'HALO_BEFORE_RECORDING');
    assert.equal((await refusal(tx, `select public.finish_daily_maxima_run('{"rows": 0}'::jsonb)`)).message, 'HALO_RECORDING_NOT_BEGUN');
    assert.equal(await countOf(tx), 0);
  }, { begin: false });
});

test('a malformed batch is HALO_INVALID_INPUT with nothing written', async () => {
  const { home_context_id: _home, ...withoutHome } = row();
  void _home;
  const cases = [
    ['null', null],
    ['an object, not an array', row()],
    ['an empty array', []],
    ['1001 rows, all distinct', Array.from({ length: 1001 }, (_, at) => uv({ local_date: new Date(Date.UTC(2027, 0, 1 + at)).toISOString().slice(0, 10) }))],
    ['a row that is not an object', [row(), 'air']],
    ['an unknown key', [row({ site_name: 'Rockwell' })]],
    ['a missing key', [withoutHome]],
    ['a required key that is null', [row({ unit: null })]],
    ['a value that is a string', [row({ value: '42' })]],
    ['hours that are a string', [row({ hours_observed: '24' })]],
    ['fractional hours', [row({ hours_observed: 23.5 })]],
    ['hours out of range for a smallint', [row({ hours_observed: 70000 })]],
    ['a value out of range for a double', `[${JSON.stringify(row()).replace('"value":42', '"value":1e400')}]`],
    ['a date that is a number', [row({ local_date: 20261021 })]],
    ['a factor that is a number', [row({ factor: 1 })]],
    ['a station code that is a number', [measured({ station_id: 370250004 })]],
    ['a date that is not a calendar date', [row({ local_date: '2026-02-30' })]],
    ['a date not written YYYY-MM-DD', [row({ local_date: '2026-10-1' })]],
    ['a date with a time', [row({ local_date: '2026-10-21T00:00:00Z' })]],
    ['an id that is not a uuid', [row({ profile_id: 'alice' })]],
    ['a retrieval time that is not a time', [row({ retrieved_at: 'yesterday at noon' })]],
    ['the same home, date and factor twice', [row(), row({ value: 43 })]],
    ['a home of another household', [row(), row({ home_context_id: BOB_HOME, local_date: '2026-10-22' })]],
  ];
  await scenario(async (tx) => {
    for (const [label, rows] of cases) {
      const error = await recordRefusal(tx, rows);
      assert.equal(error.code, 'P0001', label);
      assert.equal(error.message, 'HALO_INVALID_INPUT', label);
    }
    assert.equal(await countOf(tx), 0);
  });
});

test('a CHECK violation inside a batch is Postgres\'s 23514, and nothing of the batch lands', async () => {
  await scenario(async (tx) => {
    const error = await recordRefusal(tx, [row(), uv(), row({ local_date: '2026-10-22', hours_observed: 17 })]);
    assert.equal(error.code, '23514');
    assert.match(error.message, /daily_maxima_coverage_check/);
    assert.equal(await countOf(tx), 0);
  });
});

test('record takes the profile before the home, the order every household writer uses (reasoned on paper: PGlite has one connection)', async () => {
  const { rows: [{ src }] } = await db.query(`select prosrc as src from pg_proc where oid = 'public.record_daily_maxima(jsonb)'::regprocedure`);
  const profile = src.indexOf('from public.profiles p where p.id = r.profile_id for key share');
  const home = src.indexOf('from public.home_contexts h where h.id = r.home_context_id for key share');
  const write = src.indexOf('insert into public.daily_maxima');
  assert.ok(profile >= 0, 'the profile is no longer locked first');
  assert.ok(home > profile, 'the home is locked before the profile');
  assert.ok(write > home, 'a row is written before its household is locked');
});

test('a home or household deleted while the run worked is skipped, and the rest of the batch is written', async () => {
  await scenario(async (tx) => {
    await tx.query(`insert into public.home_contexts (id, profile_id, sequence, origin, lat, lng, effective_to, closed_reason)
      values ($1, $2, 2, 'move', 35.5, -80.6, '2026-10-15T00:00:00Z', 'moved')`, [ALICE_OLD_HOME, ALICE]);
    await tx.query(`delete from public.home_contexts where id = $1`, [ALICE_OLD_HOME]);
    const gone = 'de1e7ed0-0000-4000-8000-000000000009';
    const out = await record(tx, [
      row({ home_context_id: ALICE_OLD_HOME }),
      row({ profile_id: gone, home_context_id: 'de1e7ed0-0000-4000-8000-00000000c001' }),
      row(),
      measured({ profile_id: BOB, home_context_id: BOB_HOME }),
    ]);
    assert.deepEqual(out, { inserted: 2, updated: 0, kept: 0, skipped: 2 });
    assert.deepEqual((await stored(tx)).map((r) => r.home_context_id), [ALICE_HOME, BOB_HOME]);
  });
});

// ---------------------------------------------------------------------------
// One source per home (Ruling E8; Vibhav 2026-10-19)
// ---------------------------------------------------------------------------

test('a home never mixes measured and modeled Air: a second source is HALO_SOURCE_KIND_FIXED, in a later batch or the same one', async () => {
  await scenario(async (tx) => {
    await record(tx, [row({ local_date: '2026-10-21' })]);
    const later = await recordRefusal(tx, [measured({ local_date: '2026-10-22' })]);
    assert.equal(later.message, 'HALO_SOURCE_KIND_FIXED');
    // A measured home's gap is a gap, never a modeled fallback (E8).
    await record(tx, [measured({ profile_id: BOB, home_context_id: BOB_HOME, local_date: '2026-10-21' })]);
    const fallback = await recordRefusal(tx, [row({ profile_id: BOB, home_context_id: BOB_HOME, local_date: '2026-10-22' })]);
    assert.equal(fallback.message, 'HALO_SOURCE_KIND_FIXED');
    assert.equal(await countOf(tx), 2);
  });
  await scenario(async (tx) => {
    const same = await recordRefusal(tx, [row({ local_date: '2026-10-21' }), measured({ local_date: '2026-10-22' })]);
    assert.equal(same.message, 'HALO_SOURCE_KIND_FIXED');
    assert.equal(await countOf(tx), 0, 'nothing of the batch lands');
  });
});

test('the source rule is per home, factor and method version: another home, UV, a new version and a sourceless pending row are unaffected', async () => {
  await scenario(async (tx) => {
    const out = await record(tx, [
      row({ local_date: '2026-10-21' }),
      uv({ local_date: '2026-10-21' }),
      measured({ profile_id: BOB, home_context_id: BOB_HOME, local_date: '2026-10-21' }),
      measured({ local_date: '2026-10-22', method_version: 'daily-max-v2' }),
      pending({ local_date: '2026-10-23', source_code: null }),
    ]);
    assert.deepEqual(out, { inserted: 5, updated: 0, kept: 0, skipped: 0 });
    // A pending row is completed from the home's own source.
    assert.equal((await record(tx, [row({ local_date: '2026-10-23' })])).updated, 1);
  });
});

// ---------------------------------------------------------------------------
// finish_daily_maxima_run
// ---------------------------------------------------------------------------

test('finish_daily_maxima_run records counts only, and refuses anything else', async () => {
  await scenario(async (tx) => {
    const counts = { contexts: 3, rows: 6, airnowCalls: 1, kept: 0 };
    await tx.query(`select public.finish_daily_maxima_run($1::jsonb)`, [JSON.stringify(counts)]);
    const { rows: [state] } = await tx.query(`select recording_from::text as recording_from, last_run, last_run_at is not null as stamped from public.daily_maxima_recorder`);
    assert.deepEqual(state, { recording_from: RECORDING_FROM, last_run: counts, stamped: true });
    for (const [label, value] of [
      ['null', null],
      ['an array', [1]],
      ['a negative count', { rows: -1 }],
      ['a fractional count', { rows: 1.5 }],
      ['a string count', { rows: '6' }],
      ['a coordinate under a count name', { lat: 35.409 }],
      ['text', { station: 'Rockwell' }],
      ['a key that is not a short name', { 'rows written': 1 }],
      ['33 counts', Object.fromEntries(Array.from({ length: 33 }, (_, at) => [`c${at}`, 1]))],
    ]) {
      const error = await refusal(tx, `select public.finish_daily_maxima_run($1::jsonb)`, [value === null ? null : JSON.stringify(value)]);
      assert.equal(error.message, 'HALO_INVALID_INPUT', label);
    }
    assert.deepEqual((await tx.query(`select last_run from public.daily_maxima_recorder`)).rows[0].last_run, counts, 'a refusal left the counts alone');
  });
});

// ---------------------------------------------------------------------------
// With 0024: clear all removes and counts the maxima (E23), Clear Journal keeps them
// ---------------------------------------------------------------------------

async function claimAndClear(tx, scope) {
  const fingerprintTables = scope === 'journal' ? ['symptom_logs'] : ALL_TABLES;
  await tx.query(`insert into public.operations (operation_id, profile_id, domain, kind) values ($1, $2, 'privacy', $3)`, [CLEAR_OP, ALICE, `privacy.clear.${scope}`]);
  const { rows: [{ out }] } = await tx.query(
    `select public.clear_household_records($1, $2, $3, public.privacy_fingerprint($1, $4::text[])) as out`,
    [ALICE, CLEAR_OP, scope, fingerprintTables],
  );
  return out;
}

test('clear all over a household with maxima succeeds with no 23503, counts them, and leaves bob\'s', async () => {
  await scenario(async (tx) => {
    await record(tx, [row(), uv(), pending({ local_date: '2026-10-22' }), measured({ profile_id: BOB, home_context_id: BOB_HOME })]);
    const { rows: [{ counts }] } = await tx.query(`select public.privacy_counts($1, 'all') as counts`, [ALICE]);
    assert.equal(Number(counts.daily_maxima), 3);
    const out = await claimAndClear(tx, 'all');
    assert.equal(out.receipt.status, 'succeeded');
    assert.equal(Number(out.removed), Object.values(counts).reduce((sum, n) => sum + Number(n), 0));
    assert.deepEqual((await stored(tx)).map((r) => r.home_context_id), [BOB_HOME]);
  });
});

test('clear journal keeps every daily maximum', async () => {
  await scenario(async (tx) => {
    await record(tx, [row(), uv()]);
    assert.equal((await claimAndClear(tx, 'journal')).receipt.status, 'succeeded');
    assert.equal(await countOf(tx), 2);
  });
});

test('0024 without 0025: clear all and the counts still work, and count no maxima', async () => {
  const without = await createDb({ upTo: 24 });
  try {
    await without.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true);
      insert into public.home_contexts (id, profile_id, sequence, origin, lat, lng) values ('${ALICE_HOME}', '${ALICE}', 1, 'onboard', 35.409, -80.58);`);
    await without.asService(async (tx) => {
      const { rows: [{ counts }] } = await tx.query(`select public.privacy_counts($1, 'all') as counts`, [ALICE]);
      assert.equal(Number(counts.daily_maxima), 0);
      assert.equal(Object.keys(counts).length, 19);
      const out = await claimAndClear(tx, 'all');
      assert.equal(out.receipt.status, 'succeeded');
      assert.equal(Number(out.removed), 1, 'the home; the profile had nothing to reset');
    });
  } finally {
    await without.close();
  }
});

// ---------------------------------------------------------------------------
// No row content in an error (0021 review finding B)
// ---------------------------------------------------------------------------

test('no refusal in this file carried an id or a row value in its DETAIL', () => {
  assert.ok(details.length >= 30, `only ${details.length} refusals were collected; the suite did not run in order`);
  for (const detail of details) {
    for (const marker of [ALICE, BOB, ALICE_HOME, BOB_HOME, ALICE_OLD_HOME, '370250004', 'Rockwell', '2026-', 'open_meteo', 'airnow']) {
      assert.ok(!detail.includes(marker), `a DETAIL carried "${marker}": ${detail}`);
    }
  }
});
