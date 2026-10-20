/**
 * GET /api/cron/daily-maxima against the real migration 0025 on PGlite (B08 Task 3 acceptance).
 *
 * The route runs in the route harness; its reads of home_contexts and daily_maxima go to this
 * database (db/pgliteSelect.mjs) and its three RPCs call the real 0025 functions by argument
 * name, committed, as PostgREST does. The providers are test/helpers/dailyMaximaProviders.mjs,
 * which throws on any host but AirNow and the two Open-Meteo hosts. The clock is mocked, so each
 * run's "today" is the test's.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, rpcError } from './helpers/routeHarness.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';
import { providers } from './helpers/dailyMaximaProviders.mjs';

const { runRecorder } = await import('../lib/dailyMaximaRecorder.js');

const SECRET = 'cron-secret-for-tests';
const AIRNOW_KEY = 'airnow-key-not-real';
const AUTH = { authorization: `Bearer ${SECRET}` };
const id = (n, tag = 'a') => `00000000-0000-4000-8${tag}00-${n.toString(16).padStart(12, '0')}`;

// Concord (a station 3 km away), the same point again, and Raleigh (no station within 25 miles).
const CONCORD = { lat: 35.409, lng: -80.58 };
const RALEIGH = { lat: 35.78, lng: -78.64 };
const NEAR_STATION = { code: '370250004', lat: 35.43, lng: -80.6 };

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`delete from public.daily_maxima; delete from public.daily_maxima_recorder;
    delete from public.daily_scores; delete from public.home_contexts; delete from auth.users;`);
});

async function household(n, { point = CONCORD, state = 'NC', from = '2026-10-01T12:00:00Z', to = null, sequence = 1, context = id(n, 'c'), withUser = true } = {}) {
  const profile = id(n);
  if (withUser) await db.query(`insert into auth.users (id, is_anonymous) values ($1, true) on conflict do nothing`, [profile]);
  await db.query(
    `insert into public.home_contexts (id, profile_id, sequence, origin, lat, lng, state, effective_from, effective_to, closed_reason)
     values ($1, $2, $3, 'onboard', $4, $5, $6, $7, $8, $9)`,
    [context, profile, sequence, point?.lat ?? null, point?.lng ?? null, state, from, to, to ? 'moved' : null],
  );
  return { profile, context };
}

const READ_TABLES = new Set(['home_contexts', 'daily_maxima', 'daily_scores']);
async function callDb(sql, params) {
  try {
    return await db.asService(async (tx) => (await tx.query(sql, params)).rows[0].result, { commit: true });
  } catch (error) {
    throw rpcError(error.code, error.message, error.detail ?? null);
  }
}

/** A Supabase-shaped client over this database, recording every statement and RPC. */
function client() {
  const log = [];
  const rpcs = [];
  return {
    log,
    rpcs,
    from(name) {
      if (!READ_TABLES.has(name)) throw new Error(`the recorder read ${name}`);
      return pgliteSelect(db, name, log);
    },
    async rpc(name, args) {
      rpcs.push(name);
      const sql = {
        begin_daily_maxima_run: ['select public.begin_daily_maxima_run(p_first_day => $1)::text as result', ['p_first_day']],
        record_daily_maxima: ['select public.record_daily_maxima(p_rows => $1::jsonb) as result', ['p_rows']],
        finish_daily_maxima_run: ['select public.finish_daily_maxima_run(p_counts => $1::jsonb)::text as result', ['p_counts']],
      }[name];
      if (!sql) return { data: null, error: { code: 'PGRST202', message: `no function ${name}` } };
      assert.deepEqual(Object.keys(args).sort(), sql[1]);
      try {
        const value = args[sql[1][0]];
        return { data: await callDb(sql[0], [typeof value === 'object' ? JSON.stringify(value) : value]), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

/** A route harness whose client is this database. */
function harness(p, env = {}) {
  const h = createRouteHarness({ fetch: p.fetch, env: { CRON_SECRET: SECRET, AIRNOW_API_KEY: AIRNOW_KEY, ...env } });
  const c = client();
  h.db.from = (name) => c.from(name);
  h.db.rpc = (name, args) => c.rpc(name, args);
  return { h, c };
}

async function run(t, p, at, env) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at) });
  try {
    const { h, c } = harness(p, env);
    const res = await h.call('/api/cron/daily-maxima', 'GET', { headers: AUTH });
    const body = await res.json();
    return { res, body, c };
  } finally {
    t.mock.timers.reset();
  }
}

const rowsOf = async (context) => (await db.query(
  `select local_date::text as date, factor, value, source_code, station_id, missing_code, hours_expected, hours_observed, updated_at
     from public.daily_maxima where home_context_id = $1 order by local_date, factor`, [context])).rows;
const recordingFrom = async () => (await db.query('select recording_from::text as d from public.daily_maxima_recorder')).rows[0]?.d;

test('one run over three households, two at one point: one AirNow call, at most two Open-Meteo calls per point, no other host, never daily_scores', async (t) => {
  const a = await household(1);
  const b = await household(2);
  const c3 = await household(3, { point: RALEIGH });
  const p = providers({ stations: [NEAR_STATION] });
  const { res, body, c } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(res.status, 200);
  assert.equal(p.count('airnow'), 1);
  assert.equal(p.calls.length, p.count('airnow') + p.count('forecast') + p.count('air_quality'));
  // Concord: UV only (measured Air). Raleigh: UV and modeled Air.
  assert.equal(p.count('forecast'), 2);
  assert.equal(p.count('air_quality'), 1);
  const airnowUrl = new URL(p.calls.find((call) => call.host === 'www.airnowapi.org').url);
  assert.equal(airnowUrl.searchParams.get('parameters'), 'OZONE,PM25,PM10');
  assert.equal(airnowUrl.searchParams.get('startDate'), '2026-10-17T04');
  assert.equal(airnowUrl.searchParams.get('endDate'), '2026-10-20T03');
  for (const call of p.calls.filter((x) => x.host !== 'www.airnowapi.org')) {
    const u = new URL(call.url);
    assert.equal(u.searchParams.get('timeformat'), 'unixtime');
    assert.equal(u.searchParams.get('past_days'), '3');
    assert.equal(u.searchParams.get('timezone'), null);
  }
  assert.ok(c.log.every((entry) => entry.table !== 'daily_scores'), 'daily_scores was read');
  assert.deepEqual([...new Set(c.rpcs)].sort(), ['begin_daily_maxima_run', 'finish_daily_maxima_run', 'record_daily_maxima']);
  assert.equal(body.inserted, 18);
  for (const ctx of [a, b]) {
    const rows = await rowsOf(ctx.context);
    assert.deepEqual(rows.map((r) => `${r.date} ${r.factor} ${r.source_code} ${r.missing_code}`), [
      '2026-10-17 air airnow_station null', '2026-10-17 uv open_meteo_forecast null',
      '2026-10-18 air airnow_station null', '2026-10-18 uv open_meteo_forecast null',
      '2026-10-19 air airnow_station null', '2026-10-19 uv open_meteo_forecast null',
    ]);
    assert.ok(rows.filter((r) => r.factor === 'air').every((r) => r.station_id === NEAR_STATION.code && r.hours_observed === 24));
  }
  assert.ok((await rowsOf(c3.context)).filter((r) => r.factor === 'air').every((r) => r.source_code === 'open_meteo_cams' && r.station_id === null));
  // Counts only in the body: no id, no point.
  const text = JSON.stringify(body);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text) && !text.includes('35.4') && !text.includes(AIRNOW_KEY));
});

test('recording_from is the first run\'s earliest day and never moves; nothing before it or before a home\'s first full day', async (t) => {
  const a = await household(1);
  const p = providers({ stations: [NEAR_STATION] });
  await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(await recordingFrom(), '2026-10-17');
  // Onboarded on 21 October at 11:00 local: its first full day is the 22nd.
  const k = await household(2, { from: '2026-10-21T15:00:00Z' });
  await run(t, p, '2026-10-22T12:00:00Z');
  assert.equal(await recordingFrom(), '2026-10-17');
  assert.deepEqual(await rowsOf(k.context), []);
  await run(t, p, '2026-10-23T12:00:00Z');
  assert.deepEqual([...new Set((await rowsOf(k.context)).map((r) => r.date))], ['2026-10-22']);
  assert.equal((await rowsOf(a.context))[0].date, '2026-10-17');
  assert.equal(await recordingFrom(), '2026-10-17');
});

test('a household that moved yesterday has no row for the move day at either home', async (t) => {
  const old = await household(1, { to: '2026-10-19T15:00:00Z', context: id(1, 'd') });
  const fresh = await household(1, { from: '2026-10-19T15:00:00Z', sequence: 2, withUser: false });
  const p = providers({ stations: [NEAR_STATION] });
  const { body } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(body.notYet, 1);
  assert.deepEqual(await rowsOf(old.context), []);
  assert.deepEqual(await rowsOf(fresh.context), []);
  await run(t, p, '2026-10-21T12:00:00Z');
  assert.deepEqual([...new Set((await rowsOf(fresh.context)).map((r) => r.date))], ['2026-10-20']);
  assert.deepEqual(await rowsOf(old.context), []);
});

test('re-running the same day changes nothing and calls no provider', async (t) => {
  const a = await household(1);
  const p = providers({ stations: [NEAR_STATION] });
  await run(t, p, '2026-10-20T12:00:00Z');
  const first = await rowsOf(a.context);
  p.reset();
  const { body } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(body.upToDate, 1);
  assert.equal(body.inserted + body.updated, 0);
  assert.equal(p.calls.length, 0);
  assert.deepEqual(await rowsOf(a.context), first);
});

test('a day short on the first run is pending, completed on the second; a day still short is final on the third', async (t) => {
  const a = await household(1);
  const p = providers({ stations: [NEAR_STATION] });
  // 19 October: one AirNow hour missing (23 of 24). 18 October: ten hours missing (14 of 24).
  const d19 = Date.parse('2026-10-19T10:00:00Z');
  const d18 = (ms) => ms >= Date.parse('2026-10-18T06:00:00Z') && ms < Date.parse('2026-10-18T16:00:00Z');
  p.set({ drop: (ms, kind) => kind === 'airnow' && (ms === d19 || d18(ms)) });
  await run(t, p, '2026-10-19T12:00:00Z'); // the 18th is attempt 1
  await run(t, p, '2026-10-20T12:00:00Z'); // the 19th attempt 1, the 18th attempt 2
  let air = (await rowsOf(a.context)).filter((r) => r.factor === 'air');
  assert.deepEqual(air.map((r) => [r.date, r.missing_code]), [['2026-10-16', null], ['2026-10-17', null], ['2026-10-18', 'pending'], ['2026-10-19', 'pending']]);
  await run(t, p, '2026-10-21T12:00:00Z'); // the 19th attempt 2 (23 of 24 is enough), the 18th attempt 2... 3
  air = (await rowsOf(a.context)).filter((r) => r.factor === 'air');
  const byDate = Object.fromEntries(air.map((r) => [r.date, r]));
  assert.equal(byDate['2026-10-19'].missing_code, null);
  assert.equal(byDate['2026-10-19'].hours_observed, 23);
  assert.equal(byDate['2026-10-18'].missing_code, 'source_gap');
  assert.equal(byDate['2026-10-18'].value, null);
  // Final means final: a later run with every hour leaves it.
  p.set({ drop: () => false });
  await run(t, p, '2026-10-21T12:00:00Z');
  assert.equal((await rowsOf(a.context)).find((r) => r.date === '2026-10-18' && r.factor === 'air').missing_code, 'source_gap');
});

test('a failed AirNow call leaves a measured home pending, never modeled; a failed Open-Meteo call leaves UV pending', async (t) => {
  const a = await household(1);
  const p = providers({ stations: [NEAR_STATION] });
  await run(t, p, '2026-10-20T12:00:00Z');
  p.reset();
  p.set({ airnow: 'http_500', forecast: 'http_500' });
  const errors = t.mock.method(console, 'error', () => {});
  const { body } = await run(t, p, '2026-10-21T12:00:00Z');
  assert.equal(body.airnowFailed, 1);
  assert.equal(body.forecastFailed, 1);
  assert.equal(p.count('air_quality'), 0, 'a measured home fell back to the model');
  const d20 = (await rowsOf(a.context)).filter((r) => r.date === '2026-10-20');
  assert.deepEqual(d20.map((r) => [r.factor, r.value, r.source_code, r.missing_code, r.hours_expected]), [
    ['air', null, null, 'pending', 24], ['uv', null, 'open_meteo_forecast', 'pending', 24],
  ]);
  const logged = errors.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
  assert.ok(!logged.includes(AIRNOW_KEY) && !logged.includes('35.409') && !logged.includes('airnowapi') && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(logged), logged);
  // AirNow back: the home is still measured.
  p.set({ airnow: 'ok', forecast: 'ok', stations: [] });
  await run(t, p, '2026-10-22T12:00:00Z');
  assert.ok((await rowsOf(a.context)).filter((r) => r.factor === 'air').every((r) => r.source_code !== 'open_meteo_cams'));
});

test('an Open-Meteo or AirNow answer with no hour on any requested day is a provider failure, never a final Source gap', async (t) => {
  const a = await household(1, { point: RALEIGH });
  const p = providers({ stations: [NEAR_STATION], forecast: 'foreign' });
  t.mock.method(console, 'error', () => {});
  for (const at of ['2026-10-20T12:00:00Z', '2026-10-21T12:00:00Z', '2026-10-22T12:00:00Z']) await run(t, p, at);
  const uv19 = (await rowsOf(a.context)).find((r) => r.date === '2026-10-19' && r.factor === 'uv');
  assert.equal(uv19.missing_code, 'unavailable');
  // An empty AirNow answer: an undecided home stays undecided, and is not modeled for good.
  const b = await household(2);
  p.set({ airnow: 'empty', forecast: 'ok' });
  p.reset();
  await run(t, p, '2026-10-22T12:00:00Z');
  assert.equal(p.count('air_quality'), 0);
  // The 19th was its third look, so it is final with no answer; the rest wait.
  assert.deepEqual((await rowsOf(b.context)).filter((r) => r.factor === 'air').map((r) => [r.date, r.source_code, r.missing_code]), [
    ['2026-10-19', null, 'unavailable'], ['2026-10-20', null, 'pending'], ['2026-10-21', null, 'pending'],
  ]);
  p.set({ airnow: 'ok' });
  await run(t, p, '2026-10-23T12:00:00Z');
  assert.ok((await rowsOf(b.context)).some((r) => r.factor === 'air' && r.source_code === 'airnow_station'));
});

test('a station code 0025 would refuse is not chosen; the next valid station is', async (t) => {
  const a = await household(1);
  const bad = { code: '37 025 SITE NAME', lat: 35.41, lng: -80.581 };
  const p = providers({ stations: [bad, NEAR_STATION] });
  const { body } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(body.refused, 0);
  assert.ok((await rowsOf(a.context)).filter((r) => r.factor === 'air').every((r) => r.station_id === NEAR_STATION.code));
});

test('the point budget and the deadline stop the run with counts, and the next run finishes the rest', async (t) => {
  const a = await household(1);
  const b = await household(2, { point: RALEIGH });
  const p = providers({ stations: [NEAR_STATION] });
  const first = await run(t, p, '2026-10-20T12:00:00Z', { DAILY_MAXIMA_MAX_POINTS: '1' });
  assert.equal(first.body.stopped, 'budget');
  assert.equal(first.body.pointsCalled, 1);
  assert.equal(first.body.deferred, 1);
  const done = async (ctx) => (await rowsOf(ctx.context)).length;
  assert.equal((await done(a)) + (await done(b)), 6);
  const second = await run(t, p, '2026-10-20T12:00:00Z', { DAILY_MAXIMA_MAX_POINTS: '1' });
  assert.equal(second.body.stopped, null);
  assert.equal(await done(a), 6);
  assert.equal(await done(b), 6);

  // The deadline: the clock passes it during the first point's calls, so no other point starts.
  await db.exec('delete from public.daily_maxima');
  let ms = 0;
  const q = providers({ stations: [NEAR_STATION], onCall: async (call) => { if (call.host !== 'www.airnowapi.org') ms += 5000; } });
  const supabase = client();
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00Z') });
  let out;
  try {
    out = await runRecorder({ supabase, fetchImpl: q.fetch, now: new Date(), env: { AIRNOW_API_KEY: AIRNOW_KEY }, deadlineMs: 1000, clock: () => ms });
  } finally {
    t.mock.timers.reset();
  }
  assert.equal(out.stopped, 'deadline');
  assert.equal(out.counts.pointsCalled, 1);
  assert.equal(out.counts.deferred, 1);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00Z') });
  try {
    out = await runRecorder({ supabase, fetchImpl: q.fetch, now: new Date(), env: { AIRNOW_API_KEY: AIRNOW_KEY }, deadlineMs: 1e9, clock: () => ms });
  } finally {
    t.mock.timers.reset();
  }
  assert.equal(out.stopped, null);
  assert.equal((await done(a)) + (await done(b)), 12);
});

test('pending rows that left the window unsettled are finalized as unavailable by the next run', async (t) => {
  const a = await household(1);
  const p = providers({ stations: [NEAR_STATION], forecast: 'http_500' });
  t.mock.method(console, 'error', () => {});
  await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal((await rowsOf(a.context)).find((r) => r.date === '2026-10-19' && r.factor === 'uv').missing_code, 'pending');
  // Five days of missed runs: the 19th left the window still pending.
  p.set({ forecast: 'ok' });
  const { body } = await run(t, p, '2026-10-25T12:00:00Z');
  assert.ok(body.finalized >= 2);
  const uv = (await rowsOf(a.context)).filter((r) => r.factor === 'uv' && r.date < '2026-10-22');
  assert.ok(uv.every((r) => r.missing_code === 'unavailable' || r.missing_code === null), JSON.stringify(uv));
  assert.equal(uv.find((r) => r.date === '2026-10-19').missing_code, 'unavailable');
});

test('a context deleted mid-run costs only its own rows', async (t) => {
  const a = await household(1);
  const b = await household(2);
  const p = providers({ stations: [NEAR_STATION] });
  p.set({ onCall: async (call) => { if (call.host === 'www.airnowapi.org') await db.query('delete from public.home_contexts where id = $1', [b.context]); } });
  const { body } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(body.skipped, 6);
  assert.equal(body.inserted, 6);
  assert.equal((await rowsOf(a.context)).length, 6);
  assert.deepEqual(await rowsOf(b.context), []);
});

test('contexts outside NC, outside the padded box or without a point are skipped and counted', async (t) => {
  await household(1, { state: 'SC', point: { lat: 34.9, lng: -81.0 } });
  await household(2, { point: { lat: 40.7, lng: -74.0 } });
  await household(3, { point: null });
  const p = providers({ stations: [NEAR_STATION] });
  const { body } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(body.outside, 2);
  assert.equal(body.noPoint, 1);
  assert.equal(p.calls.length, 0);
  assert.equal(body.rows, 0);
});

test('1,200 current contexts are all reached across keyset pages', async (t) => {
  await db.query(`insert into auth.users (id, is_anonymous)
    select ('00000000-0000-4000-8e00-' || lpad(to_hex(n), 12, '0'))::uuid, true from generate_series(1, 1200) n`);
  await db.query(`insert into public.home_contexts (id, profile_id, sequence, origin, lat, lng, state, effective_from)
    select ('00000000-0000-4000-8f00-' || lpad(to_hex(n), 12, '0'))::uuid, ('00000000-0000-4000-8e00-' || lpad(to_hex(n), 12, '0'))::uuid,
           1, 'onboard', 35.409, -80.58, 'NC', '2026-10-18T12:00:00Z' from generate_series(1, 1200) n`);
  const p = providers({ stations: [NEAR_STATION] });
  const { body, c } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(body.contexts, 1200);
  assert.ok(c.log.filter((entry) => entry.table === 'home_contexts').length >= 3, 'paged');
  assert.equal(body.inserted, 2400);
  assert.equal(p.count('airnow'), 1);
  assert.equal(p.count('forecast'), 1);
  const { rows } = await db.query('select count(distinct home_context_id)::int as n from public.daily_maxima');
  assert.equal(rows[0].n, 1200);
});

// ---- Found by the Task 3 test pass ----

test('a measured home stays measured when its only sourced rows were pending and then finalized with no answer (E8)', async (t) => {
  const a = await household(1, { from: '2026-10-17T12:00:00Z' });
  const FAR = { code: '371830014', lat: RALEIGH.lat, lng: RALEIGH.lng };
  const p = providers({ stations: [NEAR_STATION, FAR] });
  // First run: the near station covers 12 of 24 hours, so both days are pending measured rows.
  p.set({ drop: (ms, kind, s) => kind === 'airnow' && s.code === NEAR_STATION.code && Math.floor(ms / 3600000) % 2 === 0 });
  await run(t, p, '2026-10-20T12:00:00Z');
  assert.ok((await rowsOf(a.context)).filter((r) => r.factor === 'air').every((r) => r.source_code === 'airnow_station' && r.missing_code === 'pending'));
  // Runs missed; then the near station is silent while AirNow answers for another station.
  p.set({ drop: (ms, kind, s) => kind === 'airnow' && s.code === NEAR_STATION.code });
  await run(t, p, '2026-10-26T12:00:00Z');
  p.reset();
  await run(t, p, '2026-10-27T12:00:00Z');
  const air = (await rowsOf(a.context)).filter((r) => r.factor === 'air');
  assert.ok(air.every((r) => r.source_code !== 'open_meteo_cams'), JSON.stringify(air.map((r) => [r.date, r.source_code])));
  assert.equal(p.count('air_quality'), 0);
  const d18 = air.find((r) => r.date === '2026-10-18');
  assert.deepEqual([d18.source_code, d18.station_id, d18.missing_code], ['airnow_station', NEAR_STATION.code, 'unavailable']);
});

test('an Open-Meteo answer whose window hours are all null is a provider failure: three runs end unavailable, not Source gap', async (t) => {
  const a = await household(1, { point: RALEIGH });
  const p = providers({ stations: [NEAR_STATION], forecast: 'nulls', airQuality: 'nulls' });
  t.mock.method(console, 'error', () => {});
  for (const at of ['2026-10-20T12:00:00Z', '2026-10-21T12:00:00Z', '2026-10-22T12:00:00Z']) await run(t, p, at);
  const d19 = (await rowsOf(a.context)).filter((r) => r.date === '2026-10-19');
  assert.deepEqual(d19.map((r) => [r.factor, r.missing_code]), [['air', 'unavailable'], ['uv', 'unavailable']]);
});

test('an AirNow answer in a changed shape is a provider failure, so an undecided home is not fixed as modeled', async (t) => {
  const a = await household(1);
  const p = providers({ stations: [NEAR_STATION], reshape: (row) => ({ ...row, Latitude: String(row.Latitude), Longitude: String(row.Longitude) }) });
  t.mock.method(console, 'error', () => {});
  const { body } = await run(t, p, '2026-10-20T12:00:00Z');
  assert.equal(body.airnowFailed, 1);
  assert.equal(p.count('air_quality'), 0);
  assert.ok((await rowsOf(a.context)).filter((r) => r.factor === 'air').every((r) => r.source_code === null));
  p.set({ reshape: (row) => ({ ...row, Parameter: undefined }) });
  assert.equal((await run(t, p, '2026-10-20T12:00:00Z')).body.airnowFailed, 1);
});
