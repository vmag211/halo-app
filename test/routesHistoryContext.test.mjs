/**
 * GET /api/history bound to the household's home (migration 0016). By default the current home's
 * readings and those with no home recorded; `?context=all` every home's, each point saying which
 * home it is from, so a client can show the break at a move; `?context=<id>` one of the
 * household's own homes. Each point gains `home_context_id` and `comparability`, the body gains
 * `context: { current_id, includes_earlier_homes }`. The route before 0016 is routesHistory.test.mjs;
 * on the real database, homeContextRoutesDb.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { fullContextRow } from './helpers/fakeHomeContext.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { localDate, addDays, contextId, MISSING_ID } from './helpers/isolationSeed.mjs';

const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const OLD = contextId('alice', 1); // closed by the move three days ago
const NEW = contextId('alice', 2); // current
const BOB_HOME = contextId('bob', 1);
const at = (date, hour) => `${date}T${String(hour).padStart(2, '0')}:00:00Z`;

/** Scores say which row a point came from: old home 10s, new home 50s, unlinked 70s, bob 90s. */
const reading = (profileId, date, score, created, link) => ({
  profile_id: profileId, date, score, aqi: score, uv_index: 3, mold_risk: 'low', pollen_level: JSON.stringify({ tree: 1, grass: 2, weed: 0 }),
  created_at: created, ...(link === undefined ? {} : { home_context_id: link }),
});

const home = (id, profileId, sequence, origin, closedOn) => fullContextRow({
  id, profile_id: profileId, sequence, revision: 1, origin, lat: 35 + sequence / 1000, lng: -80,
  effective_from: at(day(40 - sequence), 12), effective_to: closedOn ? at(closedOn, 12) : null, closed_reason: closedOn ? 'moved' : null,
});

/**
 * alice moved three days ago: the old home's real readings for days 6 to 3 (day 3's written late,
 * after the move), the new home's backfill for days 5 to 3 and its own days 2, 1 (two refreshes) and
 * today, and one unlinked reading on day 7. bob has his own home and readings on the same dates.
 */
function harness({ tables = haloTables('profiles', 'daily_scores', 'home_contexts'), contexts, readings } = {}) {
  return createRouteHarness({
    tables,
    seed: ({ alice, bob }) => {
      const seed = {
        profiles: [{ id: alice.id, lat: 35.002, lng: -80 }, { id: bob.id, lat: 35.001, lng: -80 }],
        daily_scores: readings?.({ alice, bob }) ?? [
          reading(alice.id, day(7), 70, at(day(7), 12), null),
          reading(alice.id, day(6), 16, at(day(6), 12), OLD),
          reading(alice.id, day(5), 15, at(day(5), 12), OLD),
          reading(alice.id, day(4), 14, at(day(4), 12), OLD),
          reading(alice.id, day(3), 13, at(day(3), 14), OLD),
          reading(alice.id, day(5), 55, at(day(3), 13), NEW),
          reading(alice.id, day(4), 54, at(day(3), 13), NEW),
          reading(alice.id, day(3), 53, at(day(3), 13), NEW),
          reading(alice.id, day(2), 52, at(day(2), 12), NEW),
          reading(alice.id, day(1), 41, at(day(1), 8), NEW),
          reading(alice.id, day(1), 51, at(day(1), 20), NEW),
          reading(alice.id, TODAY, 50, at(TODAY, 9), NEW),
          ...[7, 5, 3, 1, 0].map((n) => reading(bob.id, day(n), 90 + n, at(day(n), 23), BOB_HOME)),
        ],
      };
      if (tables.home_contexts) {
        seed.home_contexts = contexts?.({ alice, bob }) ?? [
          home(OLD, alice.id, 1, 'onboard', day(3)), home(NEW, alice.id, 2, 'move', null), home(BOB_HOME, bob.id, 1, 'onboard', null),
        ];
      }
      return seed;
    },
  });
}

const get = (h, query = '', as = 'alice') => h.call('/api/history', 'GET', { as, url: `/api/history${query}` });
const ok = async (res) => { assert.equal(res.status, 200, JSON.stringify(await res.clone().json())); return res.json(); };
const points = (body) => body.history.map((point) => [point.date, point.score, point.home_context_id, point.comparability]);
const POINT_KEYS = ['air', 'comparability', 'date', 'home_context_id', 'mold', 'pollen', 'score', 'uv', 'values'];

// ---------------------------------------------------------------------- default

test('default: the current home and unlinked readings only, each point with its home and comparability; the earlier home is left out', async () => {
  const h = harness();
  const body = await ok(await get(h, '?days=10'));
  assert.deepEqual(Object.keys(body), ['from', 'to', 'count', 'history', 'truncated', 'context']);
  assert.deepEqual(points(body), [
    [day(7), 70, null, 'legacy_assumed'],
    [day(5), 55, NEW, 'current_context'],
    [day(4), 54, NEW, 'current_context'],
    [day(3), 53, NEW, 'current_context'], // the new home's, although the old home's row of that date is newer
    [day(2), 52, NEW, 'current_context'],
    [day(1), 51, NEW, 'current_context'], // the latest refresh
    [TODAY, 50, NEW, 'current_context'],
  ]);
  assert.equal(body.count, 7);
  assert.deepEqual(body.context, { current_id: NEW, includes_earlier_homes: false });
  assert.deepEqual(Object.keys(body.history[0]).sort(), POINT_KEYS);
  assert.deepEqual(body.history[1].values, { aqi: 55, uv_index: 3, pollen: { tree: 1, grass: 2, weed: 0 }, mold_risk: 'low' });
  assert.equal(body.truncated, false);
});

test('?context=all: every home, the earlier one flagged earlier_home; a date of the move has a point per home, so the break shows', async () => {
  const h = harness();
  const body = await ok(await get(h, '?days=10&context=all'));
  assert.deepEqual(points(body), [
    [day(7), 70, null, 'legacy_assumed'],
    [day(6), 16, OLD, 'earlier_home'],
    [day(5), 15, OLD, 'earlier_home'], // within a date, the point whose reading was written first comes first
    [day(5), 55, NEW, 'current_context'],
    [day(4), 14, OLD, 'earlier_home'],
    [day(4), 54, NEW, 'current_context'],
    [day(3), 53, NEW, 'current_context'],
    [day(3), 13, OLD, 'earlier_home'],
    [day(2), 52, NEW, 'current_context'],
    [day(1), 51, NEW, 'current_context'],
    [TODAY, 50, NEW, 'current_context'],
  ]);
  assert.equal(body.count, 11);
  assert.deepEqual(body.context, { current_id: NEW, includes_earlier_homes: true });
  assert.deepEqual(Object.keys(body.history[1]).sort(), POINT_KEYS);
  assert.equal((await ok(await get(h, '?days=10&context=ALL'))).count, 11, 'all in any case');
});

test('?context=<id>: one of the household\'s own homes, its readings only (the unlinked ones are not any home\'s)', async () => {
  const h = harness();
  const old = await ok(await get(h, `?days=10&context=${OLD}`));
  assert.deepEqual(points(old), [
    [day(6), 16, OLD, 'earlier_home'], [day(5), 15, OLD, 'earlier_home'], [day(4), 14, OLD, 'earlier_home'], [day(3), 13, OLD, 'earlier_home'],
  ]);
  assert.deepEqual(old.context, { current_id: NEW, includes_earlier_homes: true });

  const current = await ok(await get(h, `?days=10&context=${NEW.toUpperCase()}`));
  assert.deepEqual(points(current).map(([date, score]) => [date, score]), [[day(5), 55], [day(4), 54], [day(3), 53], [day(2), 52], [day(1), 51], [TODAY, 50]]);
  assert.ok(current.history.every((point) => point.comparability === 'current_context'));
  assert.deepEqual(current.context, { current_id: NEW, includes_earlier_homes: false });
});

test('?context=<id> of another household\'s home is the identical 404 to a missing id, and to GET /api/home-contexts/[id]\'s', async () => {
  const h = harness();
  const foreign = await get(h, `?context=${BOB_HOME}`);
  const missing = await get(h, `?context=${MISSING_ID}`);
  const strip = (body) => { const copy = { ...body }; delete copy.request_id; return copy; };
  const foreignBody = await expectEnvelope(foreign, { status: 404, code: 'not_found', retryable: false });
  const missingBody = await expectEnvelope(missing, { status: 404, code: 'not_found', retryable: false });
  assert.deepEqual(strip(foreignBody), strip(missingBody));
  assert.deepEqual([...foreign.headers.keys()].sort(), [...missing.headers.keys()].sort());
  assert.equal(foreignBody.error, 'We could not find that home.');

  // The same statements for both, and none of them reads a reading.
  const statements = (query) => h.db.queryLog.filter((q) => JSON.stringify(q.filters).includes(query)).length;
  assert.equal(statements(BOB_HOME), 1);
  assert.equal(statements(MISSING_ID), 1);
  assert.deepEqual(h.db.queryLog.map((q) => q.table), ['home_contexts', 'home_contexts', 'home_contexts', 'home_contexts']);
  auditOwnerScope(h.db.queryLog, h.identities.alice.id, 'foreign context');

  const detail = await h.call('/api/home-contexts/[id]', 'GET', { as: 'alice', url: `/api/home-contexts/${BOB_HOME}`, params: { id: BOB_HOME } });
  assert.deepEqual(strip(await detail.json()), strip(foreignBody), 'the same answer as the home detail route');
  assert.ok(!JSON.stringify(foreignBody).includes(BOB_HOME) && !JSON.stringify(missingBody).includes(MISSING_ID), 'nothing echoes the id');
});

const MALFORMED = ['abc', 'current', `${OLD}x`, `${OLD} `, OLD.slice(0, 35), '00000000000000000000000000000000'];

for (const value of MALFORMED) {
  test(`?context=${JSON.stringify(value)} is a 400 with a field error on context, and reads nothing`, async () => {
    const h = harness();
    const body = await expectEnvelope(await get(h, `?context=${encodeURIComponent(value)}`), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['context', 'invalid_uuid']]);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(h.db.queryLog.length, 0);
  });
}

test('a bad context and a bad days are reported together; an empty context is "not given"', async () => {
  const h = harness();
  const body = await expectEnvelope(await get(h, '?days=0&context=nope'), { status: 400, code: 'validation_failed' });
  assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['days', 'integer_out_of_range'], ['context', 'invalid_uuid']]);
  const empty = await ok(await get(h, '?days=10&context='));
  assert.deepEqual(empty, await ok(await get(h, '?days=10')));
});

// --------------------------------------------------------------- legacy homes

test('the current home made by 0016\'s legacy migration: its readings are legacy_assumed; a closed legacy home is an earlier home', async () => {
  const LEGACY = contextId('alice', 7);
  const current = harness({
    contexts: ({ alice, bob }) => [home(LEGACY, alice.id, 1, 'legacy_migration', null), home(BOB_HOME, bob.id, 1, 'onboard', null)],
    readings: ({ alice }) => [reading(alice.id, day(2), 60, at(day(2), 12), LEGACY), reading(alice.id, day(1), 70, at(day(1), 12), null)],
  });
  const kept = await ok(await get(current, '?days=10'));
  assert.deepEqual(points(kept), [[day(2), 60, LEGACY, 'legacy_assumed'], [day(1), 70, null, 'legacy_assumed']]);
  assert.deepEqual(kept.context, { current_id: LEGACY, includes_earlier_homes: false });

  const closed = harness({
    contexts: ({ alice, bob }) => [home(LEGACY, alice.id, 1, 'legacy_migration', day(2)), home(NEW, alice.id, 2, 'move', null), home(BOB_HOME, bob.id, 1, 'onboard', null)],
    readings: ({ alice }) => [reading(alice.id, day(3), 60, at(day(3), 12), LEGACY), reading(alice.id, day(1), 50, at(day(1), 12), NEW)],
  });
  assert.deepEqual(points(await ok(await get(closed, '?days=10'))), [[day(1), 50, NEW, 'current_context']]);
  const all = await ok(await get(closed, '?days=10&context=all'));
  assert.deepEqual(points(all), [[day(3), 60, LEGACY, 'earlier_home'], [day(1), 50, NEW, 'current_context']]);
  assert.equal(all.context.includes_earlier_homes, true);
});

// ----------------------------------------------------- order, limit, isolation

test('the latest refresh of a date still wins, and the row limit is the household\'s readings in the range, newest first', async () => {
  const h = harness();
  h.db.setMaxRows(5); // newest first: today, day 1 (two refreshes), day 2, then the old home's late day 3
  const body = await ok(await get(h, '?days=10'));
  assert.equal(body.truncated, true);
  assert.deepEqual(points(body).map(([date, score]) => [date, score]), [[day(2), 52], [day(1), 51], [TODAY, 50]], 'the oldest days are cut, never today');
  h.db.setMaxRows(Infinity);
  assert.equal((await ok(await get(h, '?days=10'))).truncated, false);
});

test('two households: no response carries the other\'s readings or homes, in any scope, and every query is owner-scoped', async () => {
  const h = harness();
  for (const query of ['?days=10', '?days=10&context=all', `?days=10&context=${OLD}`, `?days=10&context=${NEW}`]) {
    const from = h.db.queryLog.length;
    const body = await ok(await get(h, query));
    assert.ok(body.history.every((point) => point.score < 90), `${query}: none of bob's readings`);
    assert.ok(!JSON.stringify(body).includes(BOB_HOME), `${query}: not bob's home`);
    auditOwnerScope(h.db.queryLog.slice(from), h.identities.alice.id, query);
  }
  const bob = await ok(await get(h, '?days=10&context=all', 'bob'));
  assert.deepEqual(points(bob).map(([date, score]) => [date, score]), [[day(7), 97], [day(5), 95], [day(3), 93], [day(1), 91], [TODAY, 90]]);
  assert.deepEqual(bob.context, { current_id: BOB_HOME, includes_earlier_homes: false });
});

test('one owner-scoped read of the current home per request (two with ?context=<id>), and one read of the readings', async () => {
  const h = harness();
  await ok(await get(h, '?days=10'));
  assert.deepEqual(h.db.queryLog.map((q) => q.table), ['home_contexts', 'daily_scores']);
  const from = h.db.queryLog.length;
  await ok(await get(h, `?days=10&context=${OLD}`));
  assert.deepEqual(h.db.queryLog.slice(from).map((q) => q.table), ['home_contexts', 'home_contexts', 'daily_scores']);
});

// ---------------------------------------------------- before 0016, failures

test('the home_contexts table but no home_context_id column (0016 half applied): the history as before 0016', async () => {
  for (const code of ['PGRST204', '42703']) {
    const h = harness();
    withoutColumn(h.db, 'daily_scores', 'home_context_id', code);
    const body = await ok(await get(h, '?days=10'));
    assert.deepEqual(body.context, { current_id: null, includes_earlier_homes: false });
    assert.ok(body.history.every((point) => point.comparability === 'legacy_assumed' && point.home_context_id === null));
    assert.equal(body.count, 8, 'every date, pooled as before');
    await expectEnvelope(await get(h, `?context=${OLD}`), { status: 503, code: 'feature_unavailable', retryable: false });
  }
});

test('before 0016 ?context=all is the default history, and ?context=<id> is a 503 feature_unavailable (no home can be chosen yet)', async () => {
  const h = harness({ tables: haloTables('profiles', 'daily_scores') });
  const plain = await ok(await get(h, '?days=10'));
  assert.deepEqual(await ok(await get(h, '?days=10&context=all')), plain);
  assert.deepEqual(plain.context, { current_id: null, includes_earlier_homes: false });
  const body = await expectEnvelope(await get(h, `?context=${OLD}`), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(body.error, 'Home history is not available yet.');
});

test('a database error reading the current home is a 500 envelope with no database text; the error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name === 'home_contexts') builder.maybeSingle = () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    return builder;
  };
  const body = await expectEnvelope(await get(h, '?days=10'), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /statement|home_contexts|57014/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('statement timeout'));
});
