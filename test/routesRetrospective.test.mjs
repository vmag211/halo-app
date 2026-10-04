import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { localDate, addDays } from './helpers/isolationSeed.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const TODAY = localDate();
const TABLES = ['daily_scores', 'symptom_logs', 'profiles', 'household_bands'];
// The month before this one: every day 1 to 28 of it is a real, past date.
const PREV = addDays(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7);
const pd = (n) => `${PREV}-${String(n).padStart(2, '0')}`;
const FLAGGED = [3, 9, 15].map(pd);

/** A month of readings: grass pollen severe on the flagged days, none otherwise. */
const month = (profileId, flagged = FLAGGED) =>
  Array.from({ length: 20 }, (_, i) => {
    const date = pd(i + 1);
    return {
      profile_id: profileId, date, aqi: 30, uv_index: 4, mold_risk: 'low', created_at: `${date}T12:00:00Z`,
      pollen_level: JSON.stringify({ tree: 0, grass: flagged.includes(date) ? 5 : 0, weed: 0 }),
    };
  });

function harness({ cap } = {}) {
  const h = createRouteHarness({
    tables: haloTables(...TABLES),
    seed: ({ alice, bob }) => ({
      // bob's flagged days are different, so pooling the two households would change alice's answer
      daily_scores: [...month(alice.id), ...month(bob.id, [pd(1), pd(2), pd(4)])],
    }),
  });
  if (cap) h.db.setMaxRows(cap);
  return h;
}
const retro = (h, body, options = {}) => h.call('/api/journal/retrospective', 'POST', { as: 'alice', body, ...options });
const retroRaw = (h, rawBody, options = {}) => h.call('/api/journal/retrospective', 'POST', { as: 'alice', rawBody, ...options });
const snapshot = (h) => JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, h.db.rows(table)])));
const bad = async (h, body, expected, extra = {}) => {
  const before = snapshot(h);
  const logBefore = h.db.queryLog.length;
  const envelope = await expectEnvelope(await retro(h, body), { status: 400, code: 'validation_failed', retryable: false, ...extra });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(snapshot(h), before, 'a rejected request changes no table');
  assert.equal(h.db.queryLog.length, logBefore, 'and reads nothing');
  return envelope;
};

// ------------------------------------------------------------ legacy

test('legacy request: the old comparison fields are all there, plus rejected and truncated and a request id header', async () => {
  const h = harness();
  const res = await retro(h, { dates: FLAGGED });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['factor', 'flagged_avg', 'flagged_days_with_readings', 'month_avg', 'ready', 'rejected', 'statement', 'truncated', 'unflagged_avg']);
  assert.deepEqual([body.ready, body.factor, body.flagged_days_with_readings, body.rejected, body.truncated], [true, 'grass', 3, [], false]);
  assert.match(body.statement, /^On the 3 days you flagged, grass pollen averaged /);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('legacy request: an empty list is still a 200 "not ready", with nothing read', async () => {
  const h = harness();
  const res = await retro(h, { dates: [] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.ready, body.factor, body.flagged_days_with_readings, body.rejected, body.truncated], [false, null, 0, [], false]);
  assert.equal(h.db.queryLog.length, 0);
});

test('the route is read only and scoped to the caller: only alice\'s readings are read, and bob\'s flagged days do not change her answer', async () => {
  const h = harness();
  const before = snapshot(h);
  const body = await (await retro(h, { dates: FLAGGED, profile_id: h.identities.bob.id, user_id: h.identities.bob.id })).json();
  assert.equal(body.flagged_days_with_readings, 3);
  assert.equal(snapshot(h), before, 'nothing was written');
  const reads = h.db.queryLog.filter((q) => q.table === 'daily_scores');
  assert.equal(reads.length, 1);
  assert.ok(reads[0].filters.some((f) => f.type === 'cmp' && f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
  const bobsView = await (await h.call('/api/journal/retrospective', 'POST', { as: 'bob', body: { dates: FLAGGED } })).json();
  assert.notEqual(bobsView.statement, body.statement, 'each household is compared against its own readings');
});

test('the readings read run from the first of the earliest month to the end of the latest month, never past today', async () => {
  const dateFilters = (h) => h.db.queryLog.filter((q) => q.table === 'daily_scores').flatMap((q) => q.filters).filter((f) => f.column === 'date').map((f) => [f.op, f.value]);
  const past = harness();
  await retro(past, { dates: [pd(15), pd(3)] });
  assert.deepEqual(dateFilters(past), [['gte', `${PREV}-01`], ['lte', addDays(`${TODAY.slice(0, 7)}-01`, -1)]]);

  const current = harness();
  await retro(current, { dates: [pd(3), TODAY] });
  assert.deepEqual(dateFilters(current), [['gte', `${PREV}-01`], ['lte', TODAY]], 'the current month stops at today');
});

// ----------------------------------------------------- rejected dates

test('invalid, out of range and repeated dates are listed in rejected while the valid ones are still compared', async () => {
  const h = harness();
  const clean = await (await retro(h, { dates: FLAGGED })).json();
  const tomorrow = addDays(TODAY, 1);
  const body = await (await retro(h, {
    dates: [FLAGGED[0], 'junk', FLAGGED[1], FLAGGED[0], tomorrow, 12345, null, '1999-12-31', `${PREV}-31x`, '', FLAGGED[2], [FLAGGED[0]], { d: 1 }, '2025-02-30'],
  })).json();
  assert.deepEqual(body.rejected, [
    { index: 1, date: 'junk', code: 'invalid_date' },
    { index: 3, date: FLAGGED[0], code: 'duplicate_date' },
    { index: 4, date: tomorrow, code: 'date_out_of_range' },
    { index: 5, date: null, code: 'invalid_date' },
    { index: 6, date: null, code: 'invalid_date' },
    { index: 7, date: '1999-12-31', code: 'date_out_of_range' },
    { index: 8, date: `${PREV}-31x`, code: 'invalid_date' },
    { index: 9, date: '', code: 'invalid_date' },
    { index: 11, date: null, code: 'invalid_date' },
    { index: 12, date: null, code: 'invalid_date' },
    { index: 13, date: '2025-02-30', code: 'invalid_date' },
  ]);
  assert.deepEqual({ ...body, rejected: [] }, clean, 'the answer is the one the valid dates alone give');
});

test('today is accepted, tomorrow is not; a long bad value is echoed only in part', async () => {
  const h = harness();
  assert.deepEqual((await (await retro(h, { dates: [TODAY] })).json()).rejected, []);
  const long = 'x'.repeat(5000);
  const { rejected } = await (await retro(h, { dates: [long] })).json();
  assert.deepEqual(rejected, [{ index: 0, date: 'x'.repeat(32), code: 'invalid_date' }]);
});

test('when every date is rejected the answer is the old empty comparison and nothing is read', async () => {
  const h = harness();
  const body = await (await retro(h, { dates: ['junk', addDays(TODAY, 3)] })).json();
  assert.deepEqual([body.ready, body.flagged_days_with_readings, body.rejected.map((r) => r.code)], [false, 0, ['invalid_date', 'date_out_of_range']]);
  assert.equal(h.db.queryLog.length, 0);
});

// ------------------------------------------------------------ bounds

test('at most 100 raw dates: 100 are processed (and rejections reported), 101 are a 400 before any filtering or read', async () => {
  const h = harness();
  const hundred = [...FLAGGED, ...Array.from({ length: 97 }, (_, i) => `bad-${i}`)].slice(0, 100);
  const body = await (await retro(h, { dates: hundred })).json();
  assert.deepEqual([body.flagged_days_with_readings, body.rejected.length], [3, 97]);
  const envelope = await bad(h, { dates: [...hundred, 'one-more'] }, [['dates', 'too_many_dates']]);
  assert.equal(envelope.error, 'Send at most 100 dates.');
  await bad(h, { dates: Array.from({ length: 101 }, () => null) }, [['dates', 'too_many_dates']]);
});

test('at most 62 distinct valid days, as before: 62 are compared, 63 are a 400', async () => {
  const h = harness();
  const days = (month) => Array.from({ length: month === '2025-07' || month === '2025-08' ? 31 : 30 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const sixtyTwo = [...days('2025-07'), ...days('2025-08')];
  assert.equal(sixtyTwo.length, 62);
  assert.equal((await retro(h, { dates: sixtyTwo })).status, 200);
  const envelope = await bad(h, { dates: [...sixtyTwo, '2025-09-01'] }, [['dates', 'too_many_dates']]);
  assert.equal(envelope.error, 'Pick at most 62 days.');
});

test('the month window may not span more than 366 days: 366 passes, a wider one is a 400 and reads nothing', async () => {
  const h = harness();
  // Mar 2023 to Feb 2024 is 366 days because it holds 29 February 2024.
  assert.equal((await retro(h, { dates: ['2023-03-15', '2024-02-10'] })).status, 200);
  assert.equal((await retro(h, { dates: ['2023-03-15', '2024-02-29'] })).status, 200);
  const envelope = await bad(h, { dates: ['2023-02-15', '2024-02-10'] }, [['dates', 'range_too_large']]);
  assert.equal(envelope.error, 'Pick days from within one year.');
  await bad(h, { dates: ['2001-01-01', TODAY] }, [['dates', 'range_too_large']]);
});

test('a window cut by the server row cap says so with truncated, and keeps the newest days', async () => {
  const h = harness({ cap: 10 });
  const body = await (await retro(h, { dates: FLAGGED })).json();
  assert.equal(body.truncated, true);
  assert.ok(body.flagged_days_with_readings < 3, 'the oldest flagged days fell off, not the newest');
});

// -------------------------------------------------------------- body

for (const [label, body] of [
  ['no dates', {}],
  ['dates null', { dates: null }],
  ['dates a string', { dates: '2026-04-03' }],
  ['dates an object', { dates: { 0: '2026-04-03' } }],
  ['dates a number', { dates: 3 }],
]) {
  test(`${label} is a 400 with the old sentence and changes nothing`, async () => {
    const envelope = await bad(harness(), body, [['dates', 'dates_required']]);
    assert.equal(envelope.error, 'Send { dates: ["YYYY-MM-DD", ...] }.');
  });
}

test('invalid JSON and a non-object body are 400 bad_request; an empty body is {} and so a missing dates', async () => {
  const h = harness();
  const before = snapshot(h);
  for (const rawBody of ['{not json', '[]', '["2026-04-03"]', '"dates"', 'null', '  ']) {
    await expectEnvelope(await retroRaw(h, rawBody), { status: 400, code: 'bad_request', retryable: false });
  }
  const empty = await expectEnvelope(await retroRaw(h, ''), { status: 400, code: 'validation_failed' });
  assert.deepEqual(empty.field_errors.map((e) => e.code), ['dates_required']);
  assert.equal(snapshot(h), before);
  assert.equal(h.db.queryLog.length, 0);
});

test('the body limit is 65536 bytes: exactly that is read, one more byte is a 413 and reads nothing', async () => {
  const h = harness();
  const shell = JSON.stringify({ dates: [FLAGGED[0]], pad: '' });
  const padded = (size) => JSON.stringify({ dates: [FLAGGED[0]], pad: 'p'.repeat(size - shell.length) });
  assert.equal(Buffer.byteLength(padded(65536)), 65536);
  assert.equal((await retroRaw(h, padded(65536))).status, 200);
  const logBefore = h.db.queryLog.length;
  const envelope = await expectEnvelope(await retroRaw(h, padded(65537)), { status: 413, code: 'payload_too_large', retryable: false });
  assert.equal(envelope.error, 'That request is too large.');
  await expectEnvelope(await retroRaw(h, '{}', { headers: { 'content-length': '70000' } }), { status: 413, code: 'payload_too_large' });
  assert.equal(h.db.queryLog.length, logBefore);
});

// --------------------------------------------------- envelope, errors

test('auth failures use the envelope and echo a client request id; nothing is read', async () => {
  const h = harness();
  const none = await expectEnvelope(await h.call('/api/journal/retrospective', 'POST', { body: { dates: FLAGGED } }), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  const echoed = await h.call('/api/journal/retrospective', 'POST', { body: { dates: FLAGGED }, headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal(h.db.queryLog.length, 0);
});

test('validation errors, bad bodies and successes echo a well formed client request id', async () => {
  const h = harness();
  const headers = { 'x-request-id': 'client-trace-0002' };
  await expectEnvelope(await retro(h, {}, { headers }), { status: 400, code: 'validation_failed', requestId: 'client-trace-0002' });
  await expectEnvelope(await retroRaw(h, '{', { headers }), { status: 400, code: 'bad_request', requestId: 'client-trace-0002' });
  assert.equal((await retro(h, { dates: FLAGGED }, { headers })).headers.get('x-request-id'), 'client-trace-0002');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const broken = createRouteHarness({ tables: {} }); // daily_scores missing: PGRST205
  const body = await expectEnvelope(await retro(broken, { dates: FLAGGED }), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|daily_scores|PGRST|Could not find/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});
