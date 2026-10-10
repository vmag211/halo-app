/**
 * lib/backfill.js for one home context (migration 0016): only that home's readings count as
 * existing, every row it adds is linked to the home, and backfillHomeContext records the run
 * on the context (running, then complete, partial or failed, with the dates it covers). A
 * failure anywhere is logged and never thrown, and a schema without the 0016 columns still
 * gets its readings.
 */
import './helpers/routeLoader.mjs'; // first: lib files then load as ES modules without the typeless-package warning
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { fullContextRow } from './helpers/fakeHomeContext.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';

const { backfillHomeContext, backfillHousehold, backfillRange, BACKFILL_DAYS } = await import('../lib/backfill.js');
const { addDays } = await import('../lib/localDate.js');

const TODAY = '2026-09-27';
const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const OLD_HOME = 'a11ce000-2222-4000-8000-000000000001';
const HOME = 'a11ce000-2222-4000-8000-000000000002';
const BOB_HOME = 'b0b00000-2222-4000-8000-000000000001';
const AT = new Date('2026-09-27T16:00:00Z');
const RANGE = { from: addDays(TODAY, -BACKFILL_DAYS), to: addDays(TODAY, -1) };

/** Open-Meteo's history for the 28 past days and today; `empty` dates have no value at all. */
function history({ empty = [], status = 200 } = {}) {
  const dates = Array.from({ length: BACKFILL_DAYS + 1 }, (_, n) => addDays(TODAY, n - BACKFILL_DAYS));
  const value = (date, v) => (empty.includes(date) ? null : v);
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (status !== 200) return new Response('{}', { status });
    if (String(url).startsWith('https://air-quality-api.open-meteo.com/')) {
      return Response.json({ hourly: { time: dates.map((d) => `${d}T12:00`), us_aqi: dates.map((d) => value(d, 40)) } });
    }
    return Response.json({
      daily: {
        time: dates,
        uv_index_max: dates.map((d) => value(d, 5)),
        relative_humidity_2m_mean: dates.map((d) => value(d, 50)),
        precipitation_probability_max: dates.map((d) => value(d, 10)),
      },
    });
  };
  return Object.assign(fetchImpl, { requests });
}

/** Alice moved: her earlier home is closed, HOME is current. Bob has his own home. */
function database({ readings = [] } = {}) {
  return createFakeSupabase({
    tables: haloTables('profiles', 'daily_scores', 'home_contexts'),
    seed: {
      profiles: [{ id: ALICE, lat: 35.41, lng: -80.61 }, { id: BOB, lat: 35.227, lng: -80.843 }],
      home_contexts: [
        fullContextRow({ id: OLD_HOME, profile_id: ALICE, sequence: 1, revision: 1, origin: 'onboard', lat: 35.5, lng: -80.5, backfill_state: 'complete', effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-09-27T15:00:00Z', closed_reason: 'moved' }),
        fullContextRow({ id: HOME, profile_id: ALICE, sequence: 2, revision: 1, origin: 'move', lat: 35.41, lng: -80.61, backfill_state: 'not_started', effective_from: '2026-09-27T15:00:00Z' }),
        fullContextRow({ id: BOB_HOME, profile_id: BOB, sequence: 1, revision: 1, origin: 'onboard', lat: 35.227, lng: -80.843, backfill_state: 'complete', effective_from: '2026-01-01T00:00:00Z' }),
      ],
      daily_scores: readings,
    },
  });
}

const run = (db, opts = {}) => backfillHomeContext(db, ALICE, { lat: 35.41, lng: -80.61 }, { homeContextId: HOME, today: TODAY, clock: () => AT, ...opts });
const stateWrites = (db) => db.queryLog.filter((q) => q.table === 'home_contexts' && q.operation === 'update');
const home = (db, id) => db.rows('home_contexts').find((row) => row.id === id);
const added = (db) => db.rows('daily_scores').filter((row) => row.details?.backfilled === true);

test('the range is the 28 days before today, ending yesterday', () => {
  assert.deepEqual(backfillRange(TODAY), RANGE);
  assert.deepEqual(RANGE, { from: '2026-08-30', to: '2026-09-26' });
});

test('a full history: running, then complete with the dates covered; every row added is linked to the home', async () => {
  const db = database();
  const result = await run(db, { fetchImpl: history() });
  assert.equal(result.state, 'complete');
  assert.deepEqual([result.inserted, result.missing, result.from, result.to], [28, [], RANGE.from, RANGE.to]);

  const writes = stateWrites(db);
  assert.deepEqual(writes.map((q) => q.values), [
    { backfill_state: 'running', backfill_from: RANGE.from, backfill_to: RANGE.to, backfill_updated_at: AT.toISOString() },
    { backfill_state: 'complete', backfill_from: RANGE.from, backfill_to: RANGE.to, backfill_updated_at: AT.toISOString() },
  ]);
  for (const write of writes) {
    // Owner-safe: the household and the home, both in the filter.
    assert.deepEqual(write.filters, [
      { type: 'cmp', column: 'profile_id', op: 'eq', value: ALICE },
      { type: 'cmp', column: 'id', op: 'eq', value: HOME },
    ]);
  }
  assert.deepEqual(
    [home(db, HOME).backfill_state, home(db, HOME).backfill_from, home(db, HOME).backfill_to, home(db, HOME).revision],
    ['complete', RANGE.from, RANGE.to, 1],
    'the backfill does not change the revision, which guards the household\'s answers',
  );
  assert.equal(home(db, OLD_HOME).backfill_state, 'complete');
  assert.equal(home(db, BOB_HOME).backfill_state, 'complete');

  const rows = added(db);
  assert.equal(rows.length, 28);
  assert.ok(rows.every((row) => row.home_context_id === HOME && row.profile_id === ALICE));
  assert.ok(rows.every((row) => row.date >= RANGE.from && row.date <= RANGE.to), 'never today');
});

test('dates the history has nothing for make the run partial, and are listed; nothing is recorded for them', async () => {
  const empty = [addDays(TODAY, -3), addDays(TODAY, -10)];
  const db = database();
  const result = await run(db, { fetchImpl: history({ empty }) });
  assert.equal(result.state, 'partial');
  assert.deepEqual(result.missing, [...empty].sort());
  assert.deepEqual(stateWrites(db).map((q) => q.values.backfill_state), ['running', 'partial']);
  assert.deepEqual([home(db, HOME).backfill_state, home(db, HOME).backfill_from, home(db, HOME).backfill_to], ['partial', RANGE.from, RANGE.to]);
  assert.equal(added(db).length, 26);
  assert.ok(!added(db).some((row) => empty.includes(row.date)), 'unknown is not zero');
});

test('a failed history request: running, then failed with the range; nothing is added and nothing is thrown', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const db = database();
  const result = await run(db, { fetchImpl: history({ status: 500 }) });
  assert.equal(result.state, 'failed');
  assert.equal(result.inserted, 0);
  assert.deepEqual(stateWrites(db).map((q) => q.values), [
    { backfill_state: 'running', backfill_from: RANGE.from, backfill_to: RANGE.to, backfill_updated_at: AT.toISOString() },
    { backfill_state: 'failed', backfill_from: RANGE.from, backfill_to: RANGE.to, backfill_updated_at: AT.toISOString() },
  ]);
  assert.equal(home(db, HOME).backfill_state, 'failed');
  assert.equal(added(db).length, 0);
  assert.ok(logged.mock.calls.some((call) => String(call.arguments[0]).startsWith('Backfill failed')));
});

test('a failed insert is a failed run: one statement, so none of it was saved', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = database();
  const from = db.from;
  db.from = (name) => {
    const builder = from(name);
    if (name !== 'daily_scores') return builder;
    builder.insert = () => Promise.resolve({ data: null, error: { code: '23503', message: 'insert or update violates foreign key constraint' } });
    return builder;
  };
  const result = await run(db, { fetchImpl: history() });
  assert.equal(result.state, 'failed');
  db.from = from;
  assert.equal(home(db, HOME).backfill_state, 'failed');
  assert.equal(added(db).length, 0);
});

test('a day counts as covered only by a reading at this home; the earlier home\'s readings stay its own', async () => {
  const day = (n) => addDays(TODAY, -n);
  const readings = [
    { profile_id: ALICE, date: day(2), aqi: 61, home_context_id: HOME },       // this home: kept, not backfilled
    { profile_id: ALICE, date: day(4), aqi: 62, home_context_id: null },       // no home recorded: counts as this one's
    { profile_id: ALICE, date: day(5), aqi: 70, home_context_id: OLD_HOME },   // the earlier home: this home gets its own row
    { profile_id: ALICE, date: day(6), aqi: 71, home_context_id: OLD_HOME },
    { profile_id: BOB, date: day(7), aqi: 150, home_context_id: BOB_HOME },     // another household: irrelevant
  ];
  const db = database({ readings });
  const before = db.rows('daily_scores');
  const result = await run(db, { fetchImpl: history() });
  assert.equal(result.state, 'complete');
  assert.equal(result.inserted, 26);
  const addedDates = added(db).map((row) => row.date);
  assert.ok(!addedDates.includes(day(2)) && !addedDates.includes(day(4)));
  assert.ok(addedDates.includes(day(5)) && addedDates.includes(day(6)) && addedDates.includes(day(7)));
  assert.ok(added(db).every((row) => row.home_context_id === HOME));
  // Every reading that was there is unchanged: nothing is updated, overwritten or re-linked.
  for (const row of before) assert.deepEqual(db.rows('daily_scores').find((r) => r.id === row.id), row);
  assert.ok(db.queryLog.every((q) => !(q.table === 'daily_scores' && ['update', 'upsert', 'delete'].includes(q.operation))));
  // The existing-date read is the household's, and this home's (or none).
  const read = db.queryLog.find((q) => q.table === 'daily_scores' && q.operation === 'select');
  assert.deepEqual(read.filters[0], { type: 'cmp', column: 'profile_id', op: 'eq', value: ALICE });
  assert.ok(JSON.stringify(read.filters).includes(HOME));
});

test('a state that cannot be saved is logged, and the readings are still recorded', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const db = database();
  const from = db.from;
  db.from = (name) => {
    if (name === 'home_contexts') throw new Error('connection reset');
    return from(name);
  };
  const result = await run(db, { fetchImpl: history() });
  db.from = from;
  assert.equal(result.state, 'complete');
  assert.equal(added(db).length, 28);
  assert.equal(home(db, HOME).backfill_state, 'not_started');
  const text = logged.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
  assert.match(text, /Backfill state "running" not saved for home/);
  assert.match(text, /Backfill state "complete" not saved for home/);

  const refused = database();
  const realFrom = refused.from;
  refused.from = (name) => {
    const builder = realFrom(name);
    if (name === 'home_contexts') builder.update = () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) }) });
    return builder;
  };
  const second = await run(refused, { fetchImpl: history() });
  assert.equal(second.state, 'complete');
  assert.equal(added(refused).length, 28);
});

test('the home context table missing: the schema callback is told, nothing is thrown, the readings are recorded', async () => {
  const db = createFakeSupabase({ tables: haloTables('profiles', 'daily_scores') });
  const told = [];
  const result = await run(db, { fetchImpl: history(), onSchemaMissing: (error) => told.push(error.code) });
  assert.equal(result.state, 'complete');
  assert.deepEqual(told, ['PGRST205', 'PGRST205']);
  assert.equal(added(db).length, 28);
});

for (const code of ['PGRST204', '42703']) {
  test(`daily_scores without the home_context_id column (${code}): the run goes on without the link, and says so`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const db = database();
    const failed = withoutColumn(db, 'daily_scores', 'home_context_id', code);
    const told = [];
    const result = await run(db, { fetchImpl: history(), onSchemaMissing: (error) => told.push(error.code) });
    assert.equal(result.state, 'complete');
    assert.equal(added(db).length, 28);
    assert.ok(added(db).every((row) => !('home_context_id' in row)), 'written without the link');
    assert.deepEqual(failed.map((call) => call.method), ['or'], 'the scoped read failed once, then the plain read ran');
    assert.deepEqual(told, [code]);
  });

  test(`a schema that only lacks the link on insert (${code}) retries the same rows without it`, async () => {
    const db = database();
    const from = db.from;
    const tries = [];
    db.from = (name) => {
      const builder = from(name);
      if (name !== 'daily_scores') return builder;
      const insert = builder.insert.bind(builder);
      builder.insert = (rows) => {
        tries.push(rows.map((row) => Object.keys(row).sort()));
        if (rows.some((row) => 'home_context_id' in row)) {
          const message = code === '42703'
            ? 'column "home_context_id" of relation "daily_scores" does not exist'
            : "Could not find the 'home_context_id' column of 'daily_scores' in the schema cache";
          return Promise.resolve({ data: null, error: { code, message } });
        }
        return insert(rows);
      };
      return builder;
    };
    const told = [];
    const result = await run(db, { fetchImpl: history(), onSchemaMissing: (error) => told.push(error.code) });
    db.from = from;
    assert.equal(result.state, 'complete');
    assert.equal(tries.length, 2);
    assert.ok(tries[0][0].includes('home_context_id') && tries[0][0].includes('details'));
    assert.deepEqual(tries[1][0], tries[0][0].filter((key) => key !== 'home_context_id'), 'the same rows, only the link dropped');
    assert.deepEqual(told, [code]);
  });
}

test('another missing column (details, before 0009) keeps the link and drops only details, as before', async () => {
  const db = database();
  const from = db.from;
  const tries = [];
  db.from = (name) => {
    const builder = from(name);
    if (name !== 'daily_scores') return builder;
    const insert = builder.insert.bind(builder);
    builder.insert = (rows) => {
      tries.push(Object.keys(rows[0]).sort());
      if ('details' in rows[0]) return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'details' column of 'daily_scores' in the schema cache" } });
      return insert(rows);
    };
    return builder;
  };
  const result = await run(db, { fetchImpl: history() });
  db.from = from;
  assert.equal(result.state, 'complete');
  assert.equal(tries.length, 2);
  assert.ok(tries[1].includes('home_context_id') && !tries[1].includes('details'));
  assert.equal(db.rows('daily_scores').length, 28);
  assert.ok(db.rows('daily_scores').every((row) => row.home_context_id === HOME && !('details' in row)));
});

test('without a home context id: the backfill as before (every reading counts, no link, no state)', async () => {
  const day5 = addDays(TODAY, -5);
  const db = database({ readings: [{ profile_id: ALICE, date: day5, aqi: 70, home_context_id: OLD_HOME }] });
  const result = await backfillHousehold(db, ALICE, { lat: 35.41, lng: -80.61 }, { fetchImpl: history(), today: TODAY });
  assert.equal(result.inserted, 27, 'the earlier home\'s day counts when no home is given');
  assert.ok(added(db).every((row) => !('home_context_id' in row)));
  assert.equal(stateWrites(db).length, 0);
  const read = db.queryLog.find((q) => q.table === 'daily_scores' && q.operation === 'select');
  assert.ok(!JSON.stringify(read.filters).includes('home_context_id'));

  const plain = database();
  const viaWrapper = await backfillHomeContext(plain, ALICE, { lat: 35.41, lng: -80.61 }, { today: TODAY, fetchImpl: history() });
  assert.equal(viaWrapper.state, null);
  assert.equal(stateWrites(plain).length, 0);
});
