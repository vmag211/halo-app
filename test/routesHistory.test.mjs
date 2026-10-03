import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { localDate, addDays } from './helpers/isolationSeed.mjs';

const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const reading = (profileId, date, extra = {}) => ({
  profile_id: profileId, date, score: 70, aqi: 42, uv_index: 3, mold_risk: 'low',
  pollen_level: JSON.stringify({ tree: 1, grass: 2, weed: 0 }), created_at: `${date}T12:00:00Z`, ...extra,
});

/** `count` refreshes of one date, each a minute apart, the last one newest. */
const refreshes = (profileId, date, count, extra = () => ({})) =>
  Array.from({ length: count }, (_, n) => reading(profileId, date, {
    created_at: new Date(Date.parse(`${date}T00:00:00Z`) + n * 60_000).toISOString(), ...extra(n),
  }));

function harness(rowsFor = () => []) {
  return createRouteHarness({
    tables: haloTables('daily_scores'),
    seed: (ids) => ({ daily_scores: rowsFor(ids) }),
  });
}

const get = (h, url, as = 'alice') => h.call('/api/history', 'GET', { as, url });

test('legacy request: the old fields are all still there, with truncated and a request id header added', async () => {
  const h = harness(({ alice, bob }) => [
    reading(alice.id, day(1), { score: 81, aqi: 41 }),
    reading(alice.id, day(2), { score: 79, aqi: 55 }),
    reading(bob.id, day(1), { score: 22, aqi: 170 }),
  ]);
  const res = await get(h, '/api/history?days=90');
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.deepEqual(Object.keys(body).sort(), ['count', 'from', 'history', 'to', 'truncated']);
  assert.deepEqual([body.from, body.to, body.count, body.truncated], [day(89), TODAY, 2, false]);
  assert.deepEqual(body.history.map((row) => row.date), [day(2), day(1)], 'oldest first, one record per date');
  assert.deepEqual(Object.keys(body.history[1]).sort(), ['air', 'date', 'mold', 'pollen', 'score', 'uv', 'values']);
  assert.deepEqual(body.history[1].values, { aqi: 41, uv_index: 3, pollen: { tree: 1, grass: 2, weed: 0 }, mold_risk: 'low' });
  assert.equal(body.history[1].score, 81);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('no query means the last 90 days ending today; days sizes the window and to anchors it', async () => {
  const h = harness();
  const plain = await (await get(h, '/api/history')).json();
  assert.deepEqual([plain.from, plain.to], [day(89), TODAY]);

  const seven = await (await get(h, '/api/history?days=7')).json();
  assert.deepEqual([seven.from, seven.to], [day(6), TODAY]);
  const one = await (await get(h, '/api/history?days=1')).json();
  assert.deepEqual([one.from, one.to], [TODAY, TODAY]);
  const year = await get(h, '/api/history?days=365');
  assert.equal(year.status, 200);
  assert.equal((await year.json()).from, day(364));
  const empty = await (await get(h, '/api/history?days=')).json();
  assert.equal(empty.from, day(89), 'an empty days is "not given"');

  const anchored = await (await get(h, `/api/history?to=${day(10)}&days=5`)).json();
  assert.deepEqual([anchored.from, anchored.to], [day(14), day(10)]);
});

test('an explicit range may span 366 days and may end tomorrow, no more', async () => {
  const h = harness();
  const full = await get(h, `/api/history?from=${day(365)}&to=${TODAY}`);
  assert.equal(full.status, 200);
  assert.equal((await full.json()).from, day(365));
  assert.equal((await get(h, `/api/history?from=${TODAY}&to=${addDays(TODAY, 1)}`)).status, 200);
});

test('from and to win over days when from is given (days only sizes the window when from is absent)', async () => {
  const h = harness();
  const body = await (await get(h, `/api/history?days=7&from=${day(40)}&to=${day(30)}`)).json();
  assert.deepEqual([body.from, body.to], [day(40), day(30)]);
  const bad = await get(h, `/api/history?days=abc&from=${day(40)}&to=${day(30)}`);
  assert.equal(bad.status, 400, 'a malformed days is still a client mistake, even when it is not used');
  assert.deepEqual((await bad.json()).field_errors.map((e) => e.field), ['days']);
});

const REJECTED = [
  ['days=0', 'days=0', [['days', 'integer_out_of_range']]],
  ['days=366', 'days=366', [['days', 'integer_out_of_range']]],
  ['days=-3', 'days=-3', [['days', 'integer_out_of_range']]],
  ['days=abc', 'days=abc', [['days', 'invalid_integer']]],
  ['days=7.5', 'days=7.5', [['days', 'invalid_integer']]],
  ['days=1e2', 'days=1e2', [['days', 'invalid_integer']]],
  ['from=2026-02-31 (not a calendar date)', 'from=2026-02-31', [['from', 'invalid_date']]],
  ['from=09/01/2026 (wrong format)', 'from=09/01/2026', [['from', 'invalid_date']]],
  ['from= (empty)', 'from=', [['from', 'invalid_date']]],
  ['to=tomorrow', 'to=tomorrow', [['to', 'invalid_date']]],
  ['from before 2000', 'from=1999-12-31', [['from', 'date_out_of_range']]],
  ['to two days ahead', `to=${addDays(TODAY, 2)}`, [['to', 'date_out_of_range']]],
  ['from after to', `from=${day(5)}&to=${day(10)}`, [['from', 'range_inverted']]],
  ['a 367 day span', `from=${day(366)}&to=${TODAY}`, [['from', 'range_too_large']]],
  ['two bad dates', 'from=nope&to=never', [['from', 'invalid_date'], ['to', 'invalid_date']]],
  ['bad days and bad from together', 'days=0&from=2026-02-31', [['days', 'integer_out_of_range'], ['from', 'invalid_date']]],
];

for (const [label, query, expected] of REJECTED) {
  test(`GET /api/history with ${label} is a 400 with field errors, never a silent default, and reads nothing`, async () => {
    const h = harness(({ alice }) => [reading(alice.id, day(1))]);
    const res = await get(h, `/api/history?${query}`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'validation_failed');
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.ok(body.field_errors.every((e) => e.message.length > 0));
    assert.equal(body.error, body.field_errors[0].message, 'the legacy error string is the first message');
    assert.equal(h.db.queryLog.length, 0, 'a request that fails validation never reaches the database');
  });
}

test('error envelope: code, field_errors, retryable and request_id, and the header is the same id', async () => {
  const h = harness();
  const res = await get(h, '/api/history?days=0');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'field_errors', 'message', 'request_id', 'retryable']);
  assert.equal(body.retryable, false);
  assert.equal(body.error, body.message);
  assert.match(body.request_id, UUID);
  assert.equal(res.headers.get('x-request-id'), body.request_id);

  const echoed = await h.call('/api/history', 'GET', { as: 'alice', url: '/api/history?days=0', headers: { 'x-request-id': 'client-trace-0001' } });
  assert.equal(echoed.headers.get('x-request-id'), 'client-trace-0001');
  assert.equal((await echoed.json()).request_id, 'client-trace-0001');
  const junk = await h.call('/api/history', 'GET', { as: 'alice', headers: { 'x-request-id': 'bad id with spaces' } });
  assert.match(junk.headers.get('x-request-id'), UUID, 'a malformed client id is replaced, not echoed');
});

test('auth failures keep their status and message and carry the request id in header and body', async () => {
  const h = harness();
  const none = await h.call('/api/history', 'GET', { url: '/api/history' });
  assert.equal(none.status, 401);
  const body = await none.json();
  assert.deepEqual([body.error, body.code], ['Sign-in required.', 'auth_required']);
  assert.equal(none.headers.get('x-request-id'), body.request_id);
  assert.equal(h.db.queryLog.length, 0);
});

test('a client x-request-id is echoed in header and body on the 401 as well', async () => {
  const h = harness();
  const none = await h.call('/api/history', 'GET', { url: '/api/history', headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(none, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const h = createRouteHarness({ tables: {} }); // daily_scores missing: PostgREST answers PGRST205 with its own wording
  const res = await get(h, '/api/history');
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.code, 'internal_error');
  assert.equal(body.retryable, true);
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /schema cache|daily_scores|PGRST/);
  assert.equal(res.headers.get('x-request-id'), body.request_id);

  const line = logged.mock.calls.map((call) => call.arguments.map(String).join(' ')).join('\n');
  assert.ok(line.includes(body.request_id), 'the log line carries the request id');
  assert.ok(line.includes('Could not find the table'), 'the real error is logged');
});

test('rows are limited to 5000: the response says truncated, and the newest dates survive the cut', async () => {
  const h = harness(({ alice }) => [
    ...refreshes(alice.id, day(20), 2),
    ...refreshes(alice.id, day(10), 4999),
    ...refreshes(alice.id, day(0), 2), // 5003 rows in all
  ]);
  const body = await (await get(h, '/api/history?days=90')).json();
  assert.equal(body.truncated, true);
  assert.deepEqual(body.history.map((row) => row.date), [day(10), day(0)], 'the oldest day is the one dropped, never today');
});

test('exactly 5000 rows is not truncated, and the count is the caller\'s alone', async () => {
  const h = harness(({ alice, bob }) => [
    ...refreshes(alice.id, day(3), 5000),
    ...refreshes(bob.id, day(3), 20), // bob's rows must not push alice past her limit
  ]);
  const body = await (await get(h, '/api/history')).json();
  assert.equal(body.truncated, false);
  assert.equal(body.count, 1);

  const bobBody = await (await get(harness(({ alice, bob }) => [...refreshes(alice.id, day(3), 5100), ...refreshes(bob.id, day(3), 3)]), '/api/history', 'bob')).json();
  assert.equal(bobBody.truncated, false, 'alice\'s 5100 rows say nothing about bob');
});

test('a server-side row cap below our limit is still reported as truncated', async () => {
  const h = harness(({ alice }) => refreshes(alice.id, day(3), 1500));
  h.db.setMaxRows(1000); // PostgREST db-max-rows: it would return 1000 rows without any signal
  const body = await (await get(h, '/api/history')).json();
  assert.equal(body.truncated, true);
  h.db.setMaxRows(Infinity);
  assert.equal((await (await get(h, '/api/history')).json()).truncated, false);
});

test('the owner filter is kept: only the caller\'s rows are read', async () => {
  const h = harness(({ alice, bob }) => [reading(alice.id, day(1), { score: 81 }), reading(bob.id, day(1), { score: 22 })]);
  const body = await (await get(h, '/api/history')).json();
  assert.deepEqual(body.history.map((row) => row.score), [81]);
  const read = h.db.queryLog.find((query) => query.table === 'daily_scores');
  assert.ok(read.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
});

// ----------------------------------------------- the latest refresh of a date wins

const at = (date, minute) => `${date}T12:${String(minute).padStart(2, '0')}:00Z`;

test('the latest refresh of a date wins, whatever order the rows are stored in', async () => {
  // Stored out of order on purpose: for each date neither the first nor the last row stored is the newest.
  const h = harness(({ alice }) => [
    reading(alice.id, day(2), { score: 60, created_at: at(day(2), 20) }),
    reading(alice.id, day(2), { score: 80, created_at: at(day(2), 50) }), // newest of day(2)
    reading(alice.id, day(2), { score: 40, created_at: at(day(2), 5) }),
    reading(alice.id, day(1), { score: 90, created_at: at(day(1), 1) }),
    reading(alice.id, day(1), { score: 70, created_at: at(day(1), 30) }),
    reading(alice.id, day(1), { score: 30, created_at: at(day(1), 59) }), // newest of day(1)
  ]);
  const body = await (await get(h, '/api/history')).json();
  assert.deepEqual(body.history.map((row) => [row.date, row.score]), [[day(2), 80], [day(1), 30]]);
  assert.equal(body.count, 2);
  assert.equal(body.truncated, false);
});

test('a refresh that has a later created_at beats one that has a later score, and another household\'s newer row is ignored', async () => {
  const h = harness(({ alice, bob }) => [
    reading(alice.id, day(1), { score: 95, created_at: at(day(1), 10) }),
    reading(alice.id, day(1), { score: 20, created_at: at(day(1), 11) }),
    reading(bob.id, day(1), { score: 55, created_at: at(day(1), 58) }),
  ]);
  const body = await (await get(h, '/api/history')).json();
  assert.deepEqual(body.history.map((row) => row.score), [20]);
});

test('when the row cut lands inside the oldest kept day, every date that appears still has its newest row', async () => {
  // Three dates with four refreshes each, scores rising with created_at (newest = 13, 23, 33).
  const h = harness(({ alice }) => [
    ...refreshes(alice.id, day(3), 4, (n) => ({ score: 10 + n })),
    ...refreshes(alice.id, day(2), 4, (n) => ({ score: 20 + n })),
    ...refreshes(alice.id, day(1), 4, (n) => ({ score: 30 + n })),
  ]);
  h.db.setMaxRows(10); // rows come back date descending, newest first: day(1) x4, day(2) x4, then only the two newest of day(3)
  const body = await (await get(h, '/api/history')).json();
  assert.equal(body.truncated, true);
  assert.deepEqual(body.history.map((row) => [row.date, row.score]), [[day(3), 13], [day(2), 23], [day(1), 33]]);
});

test('at the 5000 row limit the cut can fall inside a kept day, and that day still reports its newest row', async () => {
  const h = harness(({ alice }) => [
    ...refreshes(alice.id, day(20), 2, () => ({ score: 11 })),
    ...refreshes(alice.id, day(10), 4999, (n) => ({ score: n === 4998 ? 99 : 50 })),
    ...refreshes(alice.id, day(0), 2, (n) => ({ score: n === 1 ? 98 : 50 })),
  ]);
  const body = await (await get(h, '/api/history?days=90')).json();
  assert.equal(body.truncated, true);
  assert.deepEqual(body.history.map((row) => [row.date, row.score]), [[day(10), 99], [day(0), 98]]);
});
