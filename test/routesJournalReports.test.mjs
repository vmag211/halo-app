import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { setup } from './helpers/isolationKit.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { localDate, addDays } from './helpers/isolationSeed.mjs';

const { lastEndedSeason, seasonRange } = await import('../lib/journalRetro.js');

const findings = (ctx, who = 'bob', url = '/api/journal/findings') => ctx.h.call('/api/journal/findings', 'GET', { as: who, url });
const summary = (ctx, query = '', who = 'alice') => ctx.h.call('/api/journal/summary', 'GET', { as: who, url: `/api/journal/summary${query}` });

// -------------------------------------------------------------- findings

test('findings legacy request: a household with enough data gets the old ready body, with the request id header', async () => {
  const ctx = setup();
  const res = await findings(ctx, 'bob');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.deepEqual(Object.keys(body).sort(), ['disclaimer', 'findings', 'flaggedDays', 'ready', 'totalDays', 'truncated']);
  assert.equal(body.truncated, false);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false);
});

test('findings legacy request: a household without enough data still gets the not-ready counts', async () => {
  const ctx = setup();
  const res = await findings(ctx, 'alice');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['flaggedDays', 'needed', 'ready', 'totalDays', 'truncated']);
  assert.equal(body.truncated, false);
  assert.equal(body.ready, false);
  assert.match(res.headers.get('x-request-id'), UUID);
});

test('findings reads no input: query values, even malformed ones, change nothing', async () => {
  const ctx = setup();
  const plain = await (await findings(ctx, 'bob')).json();
  const noisy = await findings(ctx, 'bob', '/api/journal/findings?from=garbage&days=-1&id=nope');
  assert.equal(noisy.status, 200);
  assert.deepEqual(await noisy.json(), plain);
});

test('findings: auth and database failures use the envelope; the database text stays in the log', async (t) => {
  const logged = muteConsoleError(t);
  const none = createRouteHarness({ tables: {} });
  const unauth = await expectEnvelope(await none.call('/api/journal/findings', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(unauth.error, 'Sign-in required.');
  const echoed = await none.call('/api/journal/findings', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });

  const res = await none.call('/api/journal/findings', 'GET', { as: 'alice' }); // no tables: PGRST205
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|symptom_logs|daily_scores|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

// --------------------------------------------------------------- summary

test('summary legacy request: season and year give the old recap body, with the request id header', async () => {
  const ctx = setup();
  const res = await summary(ctx, '?season=spring&year=2025');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['factor', 'from', 'logged_days', 'season', 'statement', 'to', 'truncated', 'year']);
  assert.equal(body.truncated, false);
  assert.deepEqual([body.season, body.year, body.logged_days], ['spring', 2025, 2]);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false);
});

test('summary with no query is the most recently ended season; an empty season or year counts as not given', async () => {
  const ctx = setup();
  const fallback = lastEndedSeason(localDate());
  for (const query of ['', '?season=&year=', '?season=', '?year=']) {
    const body = await (await summary(ctx, query)).json();
    assert.deepEqual([body.season, body.year], [fallback.season, fallback.year], query);
  }
  assert.equal((await (await summary(ctx, `?year=${fallback.year}`)).json()).from, seasonRange(fallback.season, fallback.year).from);
});

test('summary accepts the season in any case and the year with surrounding spaces', async () => {
  const ctx = setup();
  const body = await (await summary(ctx, '?season=SPRING&year=%202025%20')).json();
  assert.deepEqual([body.season, body.year], ['spring', 2025]);
});

const REJECTED = [
  ['an unknown season', '?season=monsoon&year=2025', [['season', 'invalid_option']]],
  ['text for the year', '?season=spring&year=abc', [['year', 'invalid_integer']]],
  ['a fractional year', '?season=spring&year=2025.5', [['year', 'invalid_integer']]],
  ['a year before 2000', '?season=spring&year=1999', [['year', 'integer_out_of_range']]],
  ['a year after 2100', '?season=spring&year=2101', [['year', 'integer_out_of_range']]],
  ['a hex year', '?season=spring&year=0x7e9', [['year', 'invalid_integer']]],
  ['a bad season and a bad year', '?season=x&year=y', [['season', 'invalid_option'], ['year', 'invalid_integer']]],
];

for (const [label, query, expected] of REJECTED) {
  test(`summary with ${label} is a 400 with field errors and reads nothing`, async () => {
    const ctx = setup();
    const before = ctx.h.db.queryLog.length;
    const body = await expectEnvelope(await summary(ctx, query), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(ctx.h.db.queryLog.length, before, 'nothing was read');
  });
}

test('summary: auth and database failures use the envelope; the database text stays in the log', async (t) => {
  const logged = muteConsoleError(t);
  const none = createRouteHarness({ tables: {} });
  await expectEnvelope(await none.call('/api/journal/summary', 'GET', {}), { status: 401, code: 'auth_required' });
  const echoed = await none.call('/api/journal/summary', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });

  const res = await none.call('/api/journal/summary', 'GET', { as: 'alice', url: '/api/journal/summary?season=spring&year=2025' });
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|symptom_logs|daily_scores|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
});

// ------------------------------------------------- bounded reads: truncated

const TODAY = localDate();
const reading = (profileId, date) => ({
  profile_id: profileId, date, aqi: 40, uv_index: 3, mold_risk: 'low',
  pollen_level: JSON.stringify({ tree: 1, grass: 1, weed: 1 }), created_at: `${date}T12:00:00Z`,
});
const logged = (profileId, date, n) => ({ profile_id: profileId, entry_date: date, band: n === 0 ? 'household' : `has_${n}`, symptoms: ['cough'], possibly_illness: false });

/** A harness with the two tables the reports read, and a server row cap of `cap` rows. */
function capped({ readings = [], entries = [], cap }) {
  const h = createRouteHarness({
    tables: haloTables('daily_scores', 'symptom_logs'),
    seed: ({ alice }) => ({ daily_scores: readings.map((date) => reading(alice.id, date)), symptom_logs: entries.map(([date, n]) => logged(alice.id, date, n)) }),
  });
  h.db.setMaxRows(cap);
  return h;
}
const thirtyDays = Array.from({ length: 30 }, (_, d) => addDays(TODAY, -d));
const aprilDays = Array.from({ length: 30 }, (_, d) => addDays('2025-04-30', -d));

test('findings: truncated is true when the readings were cut, and the days that count are the newest', async () => {
  const h = capped({ readings: thirtyDays, cap: 10 });
  const res = await h.call('/api/journal/findings', 'GET', { as: 'alice' });
  const body = await res.json();
  assert.deepEqual([res.status, body.ready, body.totalDays, body.truncated], [200, false, 10, true]);
});

test('findings: truncated is true when the symptom entries were cut, and false when neither read was', async () => {
  const entries = Array.from({ length: 15 }, (_, n) => [addDays(TODAY, -(n % 5)), n]);
  const cutEntries = await (await capped({ readings: [TODAY], entries, cap: 10 }).call('/api/journal/findings', 'GET', { as: 'alice' })).json();
  assert.equal(cutEntries.truncated, true);
  const whole = await (await capped({ readings: [TODAY], entries: entries.slice(0, 5), cap: 10 }).call('/api/journal/findings', 'GET', { as: 'alice' })).json();
  assert.equal(whole.truncated, false);
});

test('summary: truncated is true when the readings or the symptom entries were cut, false when neither was', async () => {
  const url = '/api/journal/summary?season=spring&year=2025';
  const readingsCut = await (await capped({ readings: aprilDays, cap: 10 }).call('/api/journal/summary', 'GET', { as: 'alice', url })).json();
  assert.equal(readingsCut.truncated, true);

  const entries = Array.from({ length: 15 }, (_, n) => [addDays('2025-04-30', -(n % 5)), n]);
  const entriesCut = await (await capped({ readings: aprilDays.slice(0, 3), entries, cap: 10 }).call('/api/journal/summary', 'GET', { as: 'alice', url })).json();
  assert.equal(entriesCut.truncated, true);

  const whole = await (await capped({ readings: aprilDays.slice(0, 3), entries: entries.slice(0, 4), cap: 10 }).call('/api/journal/summary', 'GET', { as: 'alice', url })).json();
  assert.deepEqual([whole.truncated, whole.logged_days], [false, 4]);
});

test('the symptom entries are read newest first, so a cut drops the oldest entries', async () => {
  // Ten rows on one old day (stored first) and ten on ten recent days: a cap of 10 keeps the ten recent rows.
  const entries = [
    ...Array.from({ length: 10 }, (_, n) => ['2025-03-01', n]),
    ...Array.from({ length: 10 }, (_, n) => [addDays('2025-04-30', -n), 0]),
  ];
  const body = await (await capped({ entries, cap: 10 }).call('/api/journal/summary', 'GET', { as: 'alice', url: '/api/journal/summary?season=spring&year=2025' })).json();
  assert.deepEqual([body.truncated, body.logged_days], [true, 10]);
});

test('findings reads the symptom entries newest first too: with a cut, the recent flagged days still count', async () => {
  // Twelve rows on one old day (stored first) and one row on each of ten recent days; a cap of 12 keeps the ten recent rows.
  const recent = Array.from({ length: 10 }, (_, d) => addDays(TODAY, -d));
  const old = addDays(TODAY, -20);
  const entries = [...Array.from({ length: 12 }, (_, n) => [old, n]), ...recent.map((date) => [date, 0])];
  const body = await (await capped({ readings: [...recent, old], entries, cap: 12 }).call('/api/journal/findings', 'GET', { as: 'alice' })).json();
  assert.deepEqual([body.truncated, body.totalDays, body.flaggedDays], [true, 11, 11]);
});
