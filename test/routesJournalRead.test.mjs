import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { localDate, addDays } from './helpers/isolationSeed.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const { BAND_KEYS } = await import('../lib/household.js');
const BANDS = [...BAND_KEYS, 'household'];
const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const id = (prefix, n) => `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ALICE_ID = (n) => id('a11ce000', n);
const BOB_ID = (n) => id('b0b00000', n);

const entry = (profileId, entryId, date, extra = {}) => ({
  id: entryId, profile_id: profileId, entry_date: date, band: 'household', symptoms: ['cough'], severity: 'mild', note: 'a note', ...extra,
});

/** One entry per day and household group for `days` days ending today: 8 per day. */
const crowded = (profileId, prefix, days) =>
  Array.from({ length: days }, (_, d) => BANDS.map((band, b) => entry(profileId, id(prefix, d * 8 + b + 1), day(d), { band }))).flat();

function harness(rowsFor = () => []) {
  return createRouteHarness({ tables: haloTables('symptom_logs'), seed: (ids) => ({ symptom_logs: rowsFor(ids) }) });
}

const get = (h, url = '/api/journal', as = 'alice') => h.call('/api/journal', 'GET', { as, url });
const del = (h, query, as = 'alice') => h.call('/api/journal', 'DELETE', { as, url: `/api/journal${query}` });

// ------------------------------------------------------------------ GET

test('GET legacy request: every old field is still there, newest first, plus truncated and a request id header', async () => {
  const h = harness(({ alice, bob }) => [
    entry(alice.id, ALICE_ID(1), day(3), { note: 'older' }),
    entry(alice.id, ALICE_ID(2), day(1), { note: 'newer', severity: 'bad' }),
    entry(bob.id, BOB_ID(1), day(1)),
  ]);
  const res = await get(h);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['count', 'entries', 'from', 'to', 'truncated']);
  assert.deepEqual([body.from, body.to, body.count, body.truncated], [day(89), TODAY, 2, false]);
  assert.deepEqual(body.entries.map((e) => e.note), ['newer', 'older']);
  for (const column of ['id', 'profile_id', 'entry_date', 'band', 'symptoms', 'severity', 'note']) {
    assert.ok(column in body.entries[0], `${column} is still returned`);
  }
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false);
});

test('GET: from and to are honoured, and to anchors the default 90 day window', async () => {
  const h = harness(({ alice }) => [entry(alice.id, ALICE_ID(1), day(20)), entry(alice.id, ALICE_ID(2), day(5))]);
  const ranged = await (await get(h, `/api/journal?from=${day(30)}&to=${day(10)}`)).json();
  assert.deepEqual([ranged.from, ranged.to, ranged.count], [day(30), day(10), 1]);
  const anchored = await (await get(h, `/api/journal?to=${day(10)}`)).json();
  assert.deepEqual([anchored.from, anchored.to], [day(99), day(10)]);
  assert.equal((await get(h, `/api/journal?from=${day(365)}&to=${TODAY}`)).status, 200, '366 days is the most');
});

const REJECTED = [
  ['from=2026-02-31 (not a calendar date)', 'from=2026-02-31', [['from', 'invalid_date']]],
  ['to=yesterday', 'to=yesterday', [['to', 'invalid_date']]],
  ['from= (empty)', 'from=', [['from', 'invalid_date']]],
  ['from before 2000', 'from=1999-12-31', [['from', 'date_out_of_range']]],
  ['to two days ahead', `to=${addDays(TODAY, 2)}`, [['to', 'date_out_of_range']]],
  ['from after to', `from=${day(1)}&to=${day(9)}`, [['from', 'range_inverted']]],
  ['a 367 day span', `from=${day(366)}&to=${TODAY}`, [['from', 'range_too_large']]],
  ['two bad dates', 'from=x&to=y', [['from', 'invalid_date'], ['to', 'invalid_date']]],
];

for (const [label, query, expected] of REJECTED) {
  test(`GET with ${label} is a 400 with field errors and reads nothing`, async () => {
    const h = harness(({ alice }) => [entry(alice.id, ALICE_ID(1), day(1))]);
    const body = await expectEnvelope(await get(h, `/api/journal?${query}`), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(h.db.queryLog.length, 0);
  });
}

test('GET: auth failures and database failures use the envelope; the database text stays in the log', async (t) => {
  const logged = muteConsoleError(t);
  const none = await expectEnvelope(await createRouteHarness({ tables: {} }).call('/api/journal', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  const echoed = await createRouteHarness({ tables: {} }).call('/api/journal', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });

  const broken = createRouteHarness({ tables: {} }); // symptom_logs missing: PGRST205
  const res = await get(broken);
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|symptom_logs|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

test('GET reads at most 2000 rows, newest first: truncated is true and the oldest days are the ones cut', async () => {
  const h = harness(({ alice }) => crowded(alice.id, 'a11ce000', 366)); // 2928 rows in a full 366 day range
  const body = await (await get(h, `/api/journal?from=${day(365)}&to=${TODAY}`)).json();
  assert.equal(body.truncated, true);
  assert.equal(body.count, 2000);
  assert.equal(body.entries[0].entry_date, TODAY);
  assert.ok(!body.entries.some((e) => e.entry_date === day(365)), 'the oldest day fell off, not today');
});

test('GET: exactly 2000 rows is not truncated, a server row cap is, and only the caller\'s rows count', async () => {
  const exact = harness(({ alice, bob }) => [...crowded(alice.id, 'a11ce000', 250), ...crowded(bob.id, 'b0b00000', 40)]);
  const body = await (await get(exact, `/api/journal?from=${day(300)}&to=${TODAY}`)).json();
  assert.deepEqual([body.count, body.truncated], [2000, false]);

  const capped = harness(({ alice }) => crowded(alice.id, 'a11ce000', 190)); // 1520 rows
  capped.db.setMaxRows(1000);
  const cut = await (await get(capped, `/api/journal?from=${day(200)}`)).json();
  assert.deepEqual([cut.count, cut.truncated], [1000, true]);
});

test('GET keeps its owner filter', async () => {
  const h = harness(({ alice, bob }) => [entry(alice.id, ALICE_ID(1), day(1)), entry(bob.id, BOB_ID(1), day(1))]);
  assert.equal((await (await get(h)).json()).count, 1);
  const read = h.db.queryLog.find((q) => q.table === 'symptom_logs');
  assert.ok(read.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
});

// --------------------------------------------------------------- DELETE

test('DELETE ?id= removes the caller\'s entry only, answers {deleted} and carries the request id header', async () => {
  const h = harness(({ alice, bob }) => [entry(alice.id, ALICE_ID(1), day(1)), entry(alice.id, ALICE_ID(2), day(2)), entry(bob.id, BOB_ID(1), day(1))]);
  const res = await del(h, `?id=${ALICE_ID(1)}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: 1 });
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(h.db.rows('symptom_logs').map((r) => r.id).sort(), [ALICE_ID(2), BOB_ID(1)].sort());

  const foreign = await del(h, `?id=${BOB_ID(1)}`);
  assert.deepEqual(await foreign.json(), { deleted: 0 }, 'another household\'s id deletes nothing, like a missing one');
  assert.equal(h.db.rows('symptom_logs').length, 2);
});

test('DELETE accepts an upper case UUID (the form is normalised, the row is still the caller\'s)', async () => {
  const h = harness(({ alice }) => [entry(alice.id, ALICE_ID(1), day(1))]);
  assert.deepEqual(await (await del(h, `?id=${ALICE_ID(1).toUpperCase()}`)).json(), { deleted: 1 });
});

for (const [label, value] of [
  ['text', 'abc'],
  ['a number', '123'],
  ['a UUID with a character too many', `${ALICE_ID(1)}0`],
  ['a UUID with trailing space', `${ALICE_ID(1)}%20`],
  ['a quote and SQL-looking text', "x'%20or%20'1'='1"],
]) {
  test(`DELETE ?id= ${label} is a 400 invalid_uuid and nothing is deleted`, async () => {
    const h = harness(({ alice }) => [entry(alice.id, ALICE_ID(1), day(1))]);
    const body = await expectEnvelope(await del(h, `?id=${value}`), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['id', 'invalid_uuid']]);
    assert.equal(h.db.rows('symptom_logs').length, 1);
    assert.equal(h.db.queryLog.some((q) => q.operation === 'delete'), false, 'no delete statement was even attempted');
  });
}

test('DELETE ?all=true clears only the caller\'s journal; an id next to it, even a bad one, changes nothing', async () => {
  const h = harness(({ alice, bob }) => [entry(alice.id, ALICE_ID(1), day(1)), entry(alice.id, ALICE_ID(2), day(2)), entry(bob.id, BOB_ID(1), day(1))]);
  const res = await del(h, '?all=true&id=not-a-uuid');
  assert.deepEqual(await res.json(), { deleted: 2 });
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(h.db.rows('symptom_logs').map((r) => r.id), [BOB_ID(1)]);
});

for (const [label, query] of [['nothing', ''], ['an empty id', '?id='], ['all=false', '?all=false'], ['all=1 (only the word true counts)', '?all=1'], ['all=TRUE', '?all=TRUE']]) {
  test(`DELETE with ${label} is a 400 that says what to pass, and deletes nothing`, async () => {
    const h = harness(({ alice }) => [entry(alice.id, ALICE_ID(1), day(1))]);
    const body = await expectEnvelope(await del(h, query), { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.error, 'Pass id=<entry id> or all=true.', 'the legacy sentence is unchanged');
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['id', 'id_required']]);
    assert.equal(h.db.rows('symptom_logs').length, 1);
  });
}

test('DELETE: auth failures and database failures use the envelope; the database text stays in the log', async (t) => {
  const logged = muteConsoleError(t);
  await expectEnvelope(await createRouteHarness({ tables: {} }).call('/api/journal', 'DELETE', { url: '/api/journal?all=true' }), { status: 401, code: 'auth_required' });
  const echoed = await createRouteHarness({ tables: {} }).call('/api/journal', 'DELETE', { url: '/api/journal?all=true', headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });

  const broken = createRouteHarness({ tables: {} });
  const body = await expectEnvelope(await del(broken, '?all=true'), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|symptom_logs|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
});

test('DELETE keeps its owner filter on both forms', async () => {
  const h = harness(({ alice }) => [entry(alice.id, ALICE_ID(1), day(1))]);
  await del(h, `?id=${ALICE_ID(1)}`);
  await del(h, '?all=true');
  const deletes = h.db.queryLog.filter((q) => q.operation === 'delete');
  assert.equal(deletes.length, 2);
  for (const d of deletes) {
    assert.ok(d.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
  }
});
