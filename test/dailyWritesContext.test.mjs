/**
 * Daily readings carry the household's current home (migration 0016's daily_scores.home_context_id):
 * the daily job (one bulk read of the current homes, then each household's reading tagged with its
 * own) and GET /api/daily-score (only the reading it caches for the household's own home). A
 * reading is tagged only when the current home's point is the point it was taken for, so a home
 * that does not match the profile (a move in between, or an address changed by the old route)
 * leaves it untagged rather than wrongly tagged. Writes only ever insert: an existing reading
 * keeps its link. Before 0016, or without the column, readings are recorded as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { HALO_TABLES, haloTables } from './helpers/tables.mjs';
import { fullContextRow } from './helpers/fakeHomeContext.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { quiet, setup } from './helpers/isolationKit.mjs';
import { contextId, localDate, addDays, PROFILE } from './helpers/isolationSeed.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';

const { readCurrentHomeContexts, contextIdForPoint } = await import('../lib/homeContextRpc.js');

const TODAY = localDate();
const SECRET = 'cron-secret-for-tests';
const POINT = {
  alice: { lat: 35.409, lng: -80.58 },
  bob: { lat: 35.227, lng: -80.843 },
  carol: { lat: 35.78, lng: -78.64 },
};
const OLD = (who) => contextId(who, 1);
const CURRENT = (who) => contextId(who, 2);

/**
 * Three located households for the daily job. alice and bob each moved once (home 1 closed, home 2
 * current at the profile's point); carol was located by the old route and has no home yet. The
 * current homes are seeded bob first, so a tag taken by position instead of by household is wrong.
 */
function cronHarness({ tables = HALO_TABLES, adjust } = {}) {
  const h = createRouteHarness({
    tables,
    identities: { alice: {}, bob: {}, carol: {} },
    env: { CRON_SECRET: SECRET },
    seed: ({ alice, bob, carol }) => {
      const ids = { alice: alice.id, bob: bob.id, carol: carol.id };
      const rows = {
        profiles: ['alice', 'bob', 'carol'].map((who) => ({ id: ids[who], ...POINT[who], county: `${who} County`, state: 'NC' })),
        daily_scores: [],
      };
      if (tables.home_contexts) {
        const home = (who, n, current) => fullContextRow({
          id: contextId(who, n), profile_id: ids[who], sequence: n, revision: 1, origin: n === 1 ? 'onboard' : 'move',
          lat: current ? POINT[who].lat : 36.1, lng: current ? POINT[who].lng : -79.9,
          effective_from: `${addDays(TODAY, -40 + n)}T12:00:00Z`, effective_to: current ? null : `${addDays(TODAY, -39 + n)}T12:00:00Z`,
          closed_reason: current ? null : 'moved',
        });
        rows.home_contexts = [home('bob', 2, true), home('alice', 1, false), home('bob', 1, false), home('alice', 2, true)];
      }
      adjust?.(rows, ids);
      return rows;
    },
    // Open-Meteo answers; every other provider is down (the job logs those and goes on).
    fetch: async (url) => {
      const target = String(url);
      if (target.startsWith('https://air-quality-api.open-meteo.com/')) return Response.json({ current: { us_aqi: 42, us_aqi_pm2_5: 42 } });
      if (target.startsWith('https://api.open-meteo.com/')) return Response.json({ current: { uv_index: 3 }, hourly: { time: [], uv_index: [] } });
      return new Response('{}', { status: 503 });
    },
  });
  return h;
}

const runJob = async (h) => {
  const res = await h.call('/api/cron/daily', 'GET', { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 200);
  return res.json();
};
const todayRow = (h, who) => {
  const rows = h.db.rows('daily_scores').filter((row) => row.profile_id === h.identities[who].id && row.date === TODAY);
  assert.equal(rows.length, 1, `${who} has one reading for today`);
  return rows[0];
};

// ---------------------------------------------------------------- daily job

test('the daily job tags each household\'s reading with its own current home; a household with no home gets none', async (t) => {
  const logs = quiet(t);
  const h = cronHarness();
  const body = await runJob(h);
  assert.deepEqual(body.readings, { recorded: 3, already_had_one: 0, failed: 0 });
  assert.equal(todayRow(h, 'alice').home_context_id, CURRENT('alice'));
  assert.equal(todayRow(h, 'bob').home_context_id, CURRENT('bob'));
  assert.equal('home_context_id' in todayRow(h, 'carol'), false, 'no home yet: no link (null)');
  for (const who of ['alice', 'bob']) assert.equal(todayRow(h, who).aqi, 42, 'what the job records is unchanged');
  assert.equal(logs.warn.mock.callCount(), 0);
});

test('the daily job reads the current homes once for the whole run, in bounded chunks, never once per household', async (t) => {
  quiet(t);
  const h = cronHarness();
  await runJob(h);
  const reads = h.db.queryLog.filter((q) => q.table === 'home_contexts');
  assert.equal(reads.length, 1);
  const [read] = reads;
  assert.equal(read.operation, 'select');
  const ids = ['alice', 'bob', 'carol'].map((who) => h.identities[who].id);
  assert.deepEqual(read.filters, [
    { type: 'cmp', column: 'profile_id', op: 'in', value: ids },
    { type: 'cmp', column: 'effective_to', op: 'is', value: null },
  ]);
});

test('readCurrentHomeContexts: one select per 100 households, each bounded, a household\'s home found by its own id only', async () => {
  const ids = Array.from({ length: 250 }, (_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`);
  const db = createFakeSupabase({
    tables: haloTables('home_contexts'),
    seed: {
      home_contexts: [
        fullContextRow({ id: 'c0000000-0000-4000-8000-000000000001', profile_id: ids[0], sequence: 1, revision: 1, origin: 'onboard', lat: 1, lng: 2, effective_from: '2026-01-01T00:00:00Z' }),
        fullContextRow({ id: 'c0000000-0000-4000-8000-000000000002', profile_id: ids[249], sequence: 2, revision: 1, origin: 'move', lat: 3, lng: 4, effective_from: '2026-01-01T00:00:00Z' }),
        fullContextRow({ id: 'c0000000-0000-4000-8000-000000000003', profile_id: ids[249], sequence: 1, revision: 1, origin: 'onboard', lat: 5, lng: 6, effective_from: '2025-01-01T00:00:00Z', effective_to: '2026-01-01T00:00:00Z', closed_reason: 'moved' }),
        fullContextRow({ id: 'c0000000-0000-4000-8000-000000000004', profile_id: 'ffffffff-0000-4000-8000-000000000001', sequence: 1, revision: 1, origin: 'onboard', lat: 7, lng: 8, effective_from: '2026-01-01T00:00:00Z' }),
      ],
    },
  });
  const read = await readCurrentHomeContexts(db, [...ids, ids[0]]);
  assert.equal(read.unavailable, false);
  assert.deepEqual([...read.byProfile.keys()].sort(), [ids[0], ids[249]].sort());
  assert.deepEqual(read.byProfile.get(ids[249]), { id: 'c0000000-0000-4000-8000-000000000002', profile_id: ids[249], lat: 3, lng: 4 });
  const selects = db.queryLog.filter((q) => q.table === 'home_contexts');
  assert.deepEqual(selects.map((q) => q.filters[0].value.length), [100, 100, 50], 'chunks of 100 ids, duplicates dropped');

  assert.deepEqual(await readCurrentHomeContexts(db, []), { unavailable: false, byProfile: new Map() });
  assert.deepEqual(await readCurrentHomeContexts(createFakeSupabase(), ids.slice(0, 3)), { unavailable: true, code: 'PGRST205' });
});

test('contextIdForPoint: the home\'s id only when its stored point is the reading\'s point', () => {
  const home = { id: 'h1', lat: 35.409, lng: -80.58 };
  assert.equal(contextIdForPoint(home, { lat: 35.409, lng: -80.58 }), 'h1');
  assert.equal(contextIdForPoint(home, { lat: 35.41, lng: -80.58 }), null);
  assert.equal(contextIdForPoint(home, { lat: 35.409, lng: -80.581 }), null);
  assert.equal(contextIdForPoint(null, { lat: 35.409, lng: -80.58 }), null);
  assert.equal(contextIdForPoint({ id: null, lat: 35.409, lng: -80.58 }, { lat: 35.409, lng: -80.58 }), null);
  assert.equal(contextIdForPoint(home, null), null);
});

test('a household whose current home is not at its profile\'s point (moved by the old route) gets no link, not the stale home\'s', async (t) => {
  quiet(t);
  const h = cronHarness({ adjust: (rows) => { rows.profiles[0].lat = 35.5; } });
  await runJob(h);
  assert.equal('home_context_id' in todayRow(h, 'alice'), false);
  assert.equal(todayRow(h, 'bob').home_context_id, CURRENT('bob'));
});

test('a reading already there for today keeps its link: the job records nothing for that household and updates nothing', async (t) => {
  quiet(t);
  const h = cronHarness({
    adjust: (rows, ids) => {
      rows.daily_scores.push({ profile_id: ids.alice, date: TODAY, aqi: 77, home_context_id: OLD('alice') });
    },
  });
  const before = h.db.rows('daily_scores');
  const body = await runJob(h);
  assert.deepEqual(body.readings, { recorded: 2, already_had_one: 1, failed: 0 });
  assert.deepEqual(todayRow(h, 'alice'), before[0], 'not re-linked to the new home, not nulled');
  assert.ok(h.db.queryLog.every((q) => !(q.table === 'daily_scores' && ['update', 'upsert', 'delete'].includes(q.operation))));
});

test('before 0016 (no home_contexts table): the job records every reading as before, without a link and without a warning', async (t) => {
  const logs = quiet(t);
  const tables = { ...HALO_TABLES };
  delete tables.home_contexts;
  const h = cronHarness({ tables });
  const body = await runJob(h);
  assert.deepEqual(body.readings, { recorded: 3, already_had_one: 0, failed: 0 });
  for (const who of ['alice', 'bob', 'carol']) assert.equal('home_context_id' in todayRow(h, who), false);
  assert.equal(logs.warn.mock.callCount(), 0);
});

for (const code of ['PGRST204', '42703']) {
  test(`daily_scores without home_context_id (${code}): the job records the readings without the link and warns once per process`, async (t) => {
    const logs = quiet(t);
    const h = cronHarness();
    const failed = withoutColumn(h.db, 'daily_scores', 'home_context_id', code);
    const body = await runJob(h);
    assert.deepEqual(body.readings, { recorded: 3, already_had_one: 0, failed: 0 });
    for (const who of ['alice', 'bob', 'carol']) assert.equal('home_context_id' in todayRow(h, who), false);
    assert.equal(failed.length, 2, 'the two tagged inserts failed once each, then went in without the link');
    assert.equal(logs.warn.mock.callCount(), 1, 'one warning for both, not one per household');
    assert.match(String(logs.warn.mock.calls[0].arguments[0]), new RegExp(`home_context_id.*${code}|${code}.*home_context_id`));
  });
}

test('the current homes cannot be read (another error): the job records the readings without a link and logs it, never fails', async (t) => {
  const logs = quiet(t);
  const h = cronHarness();
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name === 'home_contexts') builder.is = () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    return builder;
  };
  const body = await runJob(h);
  assert.deepEqual(body.readings, { recorded: 3, already_had_one: 0, failed: 0 });
  for (const who of ['alice', 'bob', 'carol']) assert.equal('home_context_id' in todayRow(h, who), false);
  assert.ok(logs.error.mock.calls.some((call) => /current homes/.test(call.arguments.join(' '))));
});

// -------------------------------------------------------- GET /api/daily-score

const score = (ctx, query = '?fresh=1', options = {}) => ctx.call('alice', '/api/daily-score', 'GET', { url: `/api/daily-score${query}`, ...options });
const fresh = (ctx) => ctx.rowsOf('daily_scores', 'alice').filter((row) => row.date === ctx.today && row.created_at > new Date(Date.now() - 60_000).toISOString() && row.aqi !== 47);

test('GET /api/daily-score stores the reading for the household\'s own home with its current home', async (t) => {
  const logs = quiet(t);
  const ctx = setup();
  const res = await score(ctx);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cached, false);
  const [row] = fresh(ctx);
  assert.equal(row.home_context_id, contextId('alice', 1));
  const reads = ctx.h.db.queryLog.filter((q) => q.table === 'home_contexts');
  assert.equal(reads.length, 1, 'one read of the current home, only to store the reading');
  assert.equal(logs.warn.mock.callCount(), 0);

  // lat and lng within the home's ~1 km are the own home too.
  const near = setup();
  await score(near, `?fresh=1&lat=${PROFILE.alice.lat + 0.004}&lng=${PROFILE.alice.lng}`);
  assert.equal(fresh(near)[0].home_context_id, contextId('alice', 1));
});

test('GET /api/daily-score tags only the own-home row: a reading for another point is stored for nobody, and no home is read', async (t) => {
  quiet(t);
  const ctx = setup();
  const before = ctx.h.db.rows('daily_scores');
  await score(ctx, `?lat=${PROFILE.bob.lat}&lng=${PROFILE.bob.lng}`);
  assert.deepEqual(ctx.h.db.rows('daily_scores'), before);
  assert.equal(ctx.h.db.queryLog.filter((q) => q.table === 'home_contexts').length, 0);

  // A cached answer writes nothing and reads no home either.
  const cached = setup();
  assert.equal((await (await score(cached, '')).json()).cached, true);
  assert.equal(cached.h.db.queryLog.filter((q) => q.table === 'home_contexts').length, 0);
});

test('GET /api/daily-score with no home to tag (none yet, before 0016, or not at the profile\'s point) stores the reading without a link', async (t) => {
  const logs = quiet(t);
  const none = setup({ seed: { adjust: (rows, { alice }) => { rows.home_contexts = rows.home_contexts.filter((home) => home.profile_id !== alice.id); } } });
  await score(none);
  assert.equal('home_context_id' in fresh(none)[0], false);

  const moved = setup({ seed: { adjust: (rows, { alice }) => { rows.home_contexts.find((home) => home.profile_id === alice.id).lat = 35.5; } } });
  await score(moved);
  assert.equal('home_context_id' in fresh(moved)[0], false);

  const tables = { ...HALO_TABLES };
  delete tables.home_contexts;
  const h = createRouteHarness({ tables, seed: ({ alice }) => ({ profiles: [{ id: alice.id, lat: 35.409, lng: -80.58 }] }) });
  const res = await h.call('/api/daily-score', 'GET', { as: 'alice' });
  assert.equal(res.status, 200);
  const [row] = h.db.rows('daily_scores');
  assert.equal('home_context_id' in row, false);
  assert.equal(logs.warn.mock.callCount(), 0);
});

for (const code of ['PGRST204', '42703']) {
  test(`GET /api/daily-score without the home_context_id column (${code}): stored without the link, one warning per process`, async (t) => {
    const logs = quiet(t);
    const ctx = setup();
    const failed = withoutColumn(ctx.h.db, 'daily_scores', 'home_context_id', code);
    assert.equal((await score(ctx)).status, 200);
    const [row] = fresh(ctx);
    assert.equal('home_context_id' in row, false);
    assert.ok(row.details && row.score !== undefined, 'only the link was dropped, the other columns kept');
    assert.deepEqual(failed.map((call) => call.method), ['insert']);
    assert.equal((await score(ctx)).status, 200);
    assert.equal(logs.warn.mock.callCount(), 1);
    assert.match(String(logs.warn.mock.calls[0].arguments[0]), /home_context_id/);
  });
}

test('GET /api/daily-score when the home cannot be read: the reading is stored without a link, logged, and the answer is unchanged', async (t) => {
  const logs = quiet(t);
  const ctx = setup();
  const from = ctx.h.db.from;
  ctx.h.db.from = (name) => {
    if (name === 'home_contexts') throw new Error('connection reset');
    return from(name);
  };
  const res = await score(ctx);
  assert.equal(res.status, 200);
  assert.equal('home_context_id' in fresh(ctx)[0], false);
  assert.ok(logs.error.mock.calls.some((call) => /current home/.test(call.arguments.join(' '))));
});

test('GET /api/daily-score only inserts: an earlier reading today with another home keeps its link', async (t) => {
  quiet(t);
  const ctx = setup({ seed: { adjust: (rows, { alice }) => { rows.daily_scores.find((row) => row.profile_id === alice.id && row.date === localDate()).home_context_id = contextId('alice', 9); } } });
  const before = ctx.rowsOf('daily_scores', 'alice');
  await score(ctx);
  for (const row of before) assert.deepEqual(ctx.rowsOf('daily_scores', 'alice').find((r) => r.id === row.id), row);
  assert.ok(ctx.h.db.queryLog.every((q) => !(q.table === 'daily_scores' && ['update', 'upsert', 'delete'].includes(q.operation))));
  assert.equal(fresh(ctx)[0].home_context_id, contextId('alice', 1));
});
