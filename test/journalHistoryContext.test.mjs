/**
 * lib/journalHistory.js bound to the household's home (migration 0016). The pooled readers (journal
 * findings, summary and retrospective, the assistant, the daily job's alert inputs) read the
 * household's CURRENT home plus readings with no home recorded, and only then take the latest
 * refresh of each date. An earlier home's reading never stands in for the current home's, even
 * when it is newer. GET /api/history uses the same pieces with its explicit all-homes and one-home
 * scopes (routesHistoryContext.test.mjs). Before 0016 everything reads exactly as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { fullContextRow } from './helpers/fakeHomeContext.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { localDate, addDays, contextId } from './helpers/isolationSeed.mjs';

const {
  fetchHistory, fetchHistoryWindow, historyHome, readHistoryRows, readingComparability, inScope, latestPerDay, UNLINKED_HOME,
} = await import('../lib/journalHistory.js');
const { comparability } = await import('../lib/homeContext.js');

const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const OLD = contextId('alice', 1); // closed by the move three days ago
const NEW = contextId('alice', 2); // current
const BOB_HOME = contextId('bob', 1);
const at = (date, hour) => `${date}T${String(hour).padStart(2, '0')}:00:00Z`;

/** A reading whose AQI says which row it is: old home 180 (high), new home 30 (good), unlinked 75 (moderate). */
const reading = (profileId, date, aqi, created, link) => ({
  profile_id: profileId, date, aqi, uv_index: 3, mold_risk: 'low', pollen_level: JSON.stringify({ tree: 1 }), created_at: created,
  ...(link === undefined ? {} : { home_context_id: link }),
});

const home = (id, profileId, sequence, origin, closedOn) => fullContextRow({
  id, profile_id: profileId, sequence, revision: 1, origin, lat: 35 + sequence / 1000, lng: -80,
  effective_from: at(day(40 - sequence), 12),
  effective_to: closedOn ? at(closedOn, 12) : null,
  closed_reason: closedOn ? 'moved' : null,
});

/**
 * alice moved three days ago (OLD closed, NEW current); bob has one home. alice's readings: the old
 * home's real ones for days 6 (two refreshes) to 3 (day 3's written late, after the move's backfill), the new home's
 * backfill for days 5 to 3, its own days 2, 1 (two refreshes) and today, and an unlinked day 7.
 */
function movedHarness({ tables = haloTables('profiles', 'daily_scores', 'home_contexts'), contexts, readings } = {}) {
  return createRouteHarness({
    tables,
    seed: ({ alice, bob }) => {
      const seed = {
        profiles: [{ id: alice.id, lat: 35.002, lng: -80 }, { id: bob.id, lat: 35.001, lng: -80 }],
        daily_scores: readings ? [...readings({ alice, bob }), reading(bob.id, day(1), 250, at(day(1), 23), BOB_HOME)] : [
          reading(alice.id, day(7), 75, at(day(7), 12), null),
          reading(alice.id, day(6), 160, at(day(6), 8), OLD), // an earlier refresh of the old home's day 6
          ...[6, 5, 4].map((n) => reading(alice.id, day(n), 180, at(day(n), 12), OLD)),
          reading(alice.id, day(3), 180, at(day(3), 14), OLD), // newer than the backfill's row for day 3
          ...[5, 4, 3].map((n) => reading(alice.id, day(n), 30, at(day(3), 13), NEW)),
          reading(alice.id, day(2), 30, at(day(2), 12), NEW),
          reading(alice.id, day(1), 75, at(day(1), 8), NEW),
          reading(alice.id, day(1), 30, at(day(1), 20), NEW), // the latest refresh of day 1
          reading(alice.id, TODAY, 30, at(TODAY, 9), NEW),
          reading(bob.id, day(1), 250, at(day(1), 23), BOB_HOME),
          reading(bob.id, day(6), 250, at(day(6), 23), BOB_HOME),
        ],
      };
      if (tables.home_contexts) {
        seed.home_contexts = contexts?.({ alice, bob }) ?? [
          home(OLD, alice.id, 1, 'onboard', day(3)),
          home(NEW, alice.id, 2, 'move', null),
          home(BOB_HOME, bob.id, 1, 'onboard', null),
        ];
      }
      return seed;
    },
  });
}

const airByDate = (history) => history.map((record) => [record.date, record.air]);

// ------------------------------------------------------------ bound by default

test('bound by default: the current home and unlinked readings, the latest refresh of a date within them; an earlier home\'s newer reading never wins', async () => {
  const h = movedHarness();
  const { history, truncated, excludedEarlierHome } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(10), TODAY);
  assert.deepEqual(airByDate(history), [
    [day(7), 'moderate'], // unlinked: assumed to be the current home's
    [day(5), 'good'], [day(4), 'good'],
    [day(3), 'good'], // the new home's row, although the old home's row of that date is newer
    [day(2), 'good'],
    [day(1), 'good'], // the latest refresh of the new home's two
    [TODAY, 'good'],
  ]);
  assert.equal(truncated, false);
  assert.equal(excludedEarlierHome, 4, 'the old home\'s days 6 to 3, one record per date (day 6 has two refreshes)');
  assert.deepEqual(airByDate(await fetchHistory(h.db, h.identities.alice.id, day(10), TODAY)), airByDate(history), 'fetchHistory is the same records');
});

test('a date only an earlier home has a reading for has no record at all: the earlier home\'s reading is not shown in its place', async () => {
  const h = movedHarness();
  const history = await fetchHistory(h.db, h.identities.alice.id, day(6), day(6));
  assert.deepEqual(history, []);
  const { excludedEarlierHome } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(6), day(6));
  assert.equal(excludedEarlierHome, 1, 'one day of the earlier home, however many refreshes it had');
});

test('the latest refresh of a date wins within the allowed set, whatever order the rows are stored in', () => {
  const current = { linked: true, current: { id: NEW, origin: 'move' } };
  const rows = [ // newest first within a date, as the read returns them
    { date: day(1), aqi: 1, home_context_id: OLD, created_at: at(day(1), 23) },
    { date: day(1), aqi: 2, home_context_id: NEW, created_at: at(day(1), 20) },
    { date: day(1), aqi: 3, home_context_id: null, created_at: at(day(1), 10) },
    { date: day(1), aqi: 4, home_context_id: NEW, created_at: at(day(1), 8) },
  ];
  assert.deepEqual(latestPerDay(inScope(rows, current, 'current'), current).map((row) => row.aqi), [2]);
  // Unlinked and current rows are one home: an unlinked refresh newer than the current home's wins.
  const unlinkedNewest = [rows[0], { ...rows[2], created_at: at(day(1), 21) }, rows[1], rows[3]];
  assert.deepEqual(latestPerDay(inScope(unlinkedNewest, current, 'current'), current).map((row) => row.aqi), [3]);
});

test('the current home\'s legacy context (0016\'s migration) is kept as assumed; a closed legacy context is an earlier home', async () => {
  const LEGACY = contextId('alice', 7);
  const current = movedHarness({
    contexts: ({ alice, bob }) => [home(LEGACY, alice.id, 1, 'legacy_migration', null), home(BOB_HOME, bob.id, 1, 'onboard', null)],
    readings: ({ alice }) => [
      reading(alice.id, day(4), 75, at(day(4), 12), null),
      reading(alice.id, day(3), 180, at(day(3), 12), LEGACY),
      reading(alice.id, day(2), 180, at(day(2), 12), LEGACY),
    ],
  });
  const kept = await fetchHistoryWindow(current.db, current.identities.alice.id, day(10), TODAY);
  assert.deepEqual(airByDate(kept.history), [[day(4), 'moderate'], [day(3), 'high'], [day(2), 'high']]);
  assert.equal(kept.excludedEarlierHome, 0);

  const closed = movedHarness({
    contexts: ({ alice, bob }) => [home(LEGACY, alice.id, 1, 'legacy_migration', day(3)), home(NEW, alice.id, 2, 'move', null), home(BOB_HOME, bob.id, 1, 'onboard', null)],
    readings: ({ alice }) => [
      reading(alice.id, day(6), 75, at(day(6), 12), null),
      reading(alice.id, day(5), 180, at(day(5), 12), LEGACY),
      reading(alice.id, day(4), 180, at(day(4), 12), LEGACY),
      reading(alice.id, day(2), 30, at(day(2), 12), NEW),
      reading(alice.id, day(1), 30, at(day(1), 12), NEW),
    ],
  });
  const bound = await fetchHistoryWindow(closed.db, closed.identities.alice.id, day(10), TODAY);
  assert.deepEqual(airByDate(bound.history), [[day(6), 'moderate'], [day(2), 'good'], [day(1), 'good']], 'no reading of the closed legacy home');
  assert.equal(bound.excludedEarlierHome, 2);
});

test('a household with no current home (only closed ones): only readings with no home are kept', async () => {
  const h = movedHarness({
    contexts: ({ alice, bob }) => [home(OLD, alice.id, 1, 'onboard', day(3)), home(BOB_HOME, bob.id, 1, 'onboard', null)],
    readings: ({ alice }) => [
      reading(alice.id, day(7), 75, at(day(7), 12), null),
      reading(alice.id, day(4), 180, at(day(4), 12), OLD),
      reading(alice.id, day(3), 180, at(day(3), 12), OLD),
    ],
  });
  const { history, excludedEarlierHome } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(10), TODAY);
  assert.deepEqual(airByDate(history), [[day(7), 'moderate']]);
  assert.equal(excludedEarlierHome, 2);
});

// ------------------------------------------------------------- before 0016

test('before 0016 (no home_contexts table): every reading of the household, the query exactly as before, nothing excluded', async () => {
  const h = movedHarness({ tables: haloTables('profiles', 'daily_scores') });
  const { history, excludedEarlierHome } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(10), TODAY);
  // Pooled, as before: the newest refresh of a date wins whichever home it was.
  assert.deepEqual(airByDate(history), [
    [day(7), 'moderate'], [day(6), 'high'], [day(5), 'good'], [day(4), 'good'], [day(3), 'high'], [day(2), 'good'], [day(1), 'good'], [TODAY, 'good'],
  ]);
  assert.equal(excludedEarlierHome, 0);
  const read = h.db.queryLog.find((q) => q.table === 'daily_scores');
  assert.deepEqual(read.filters.map((f) => [f.column, f.op]), [['profile_id', 'eq'], ['date', 'gte'], ['date', 'lte']]);
  assert.equal(h.db.queryLog.filter((q) => q.table === 'daily_scores').length, 1, 'one read, as before');
});

for (const code of ['PGRST204', '42703']) {
  test(`home_context_id missing (${code}) with the table there: read again without it, every reading kept, as before 0016`, async () => {
    const h = movedHarness();
    const failed = withoutColumn(h.db, 'daily_scores', 'home_context_id', code);
    const { history, excludedEarlierHome } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(10), TODAY);
    assert.equal(failed.length, 1);
    assert.equal(history.length, 8);
    assert.equal(excludedEarlierHome, 0);
  });
}

test('a database error reading the home is thrown, so callers answer as for a failed history read', async () => {
  const h = movedHarness();
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name === 'home_contexts') builder.maybeSingle = () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    return builder;
  };
  await assert.rejects(() => fetchHistoryWindow(h.db, h.identities.alice.id, day(10), TODAY), /statement timeout/);
});

// ----------------------------------------------------------- reads and scope

test('one owner-scoped read of the current home, then one owner-scoped read of the readings; a home passed in is used as is', async () => {
  const h = movedHarness();
  await fetchHistoryWindow(h.db, h.identities.alice.id, day(10), TODAY);
  assert.deepEqual(h.db.queryLog.map((q) => q.table), ['home_contexts', 'daily_scores']);
  auditOwnerScope(h.db.queryLog, h.identities.alice.id, 'fetchHistoryWindow');

  const passed = movedHarness();
  const given = { linked: true, current: { id: NEW } }; // what the daily job has from its one bulk read
  const history = await fetchHistory(passed.db, passed.identities.alice.id, day(10), TODAY, { home: given });
  assert.deepEqual(passed.db.queryLog.map((q) => q.table), ['daily_scores'], 'no read of the home');
  assert.equal(history.length, 7);
  assert.equal((await fetchHistory(passed.db, passed.identities.alice.id, day(10), TODAY, { home: UNLINKED_HOME })).length, 8, 'unlinked: pooled as before');
});

test('historyHome: the current home\'s id and origin; none; or not linked before 0016', async () => {
  const h = movedHarness();
  assert.deepEqual(await historyHome(h.db, h.identities.alice.id), { linked: true, current: { id: NEW, origin: 'move' } });
  const none = movedHarness({ contexts: ({ bob }) => [home(BOB_HOME, bob.id, 1, 'onboard', null)] });
  assert.deepEqual(await historyHome(none.db, none.identities.alice.id), { linked: true, current: null });
  const before = movedHarness({ tables: haloTables('profiles', 'daily_scores') });
  assert.deepEqual(await historyHome(before.db, before.identities.alice.id), UNLINKED_HOME);
  assert.deepEqual(UNLINKED_HOME, { linked: false, current: null });
});

test('readHistoryRows reads the link only when the household\'s readings can have one, and reports the home it used', async () => {
  const h = movedHarness();
  const linked = await readHistoryRows(h.db, h.identities.alice.id, day(10), TODAY, { home: await historyHome(h.db, h.identities.alice.id) });
  assert.equal(linked.home.linked, true);
  assert.equal(linked.rows.length, 13, 'every reading of hers in the range, from every home: the scope is chosen afterwards');
  assert.ok(linked.rows.every((row) => 'home_context_id' in row));
  const plain = await readHistoryRows(h.db, h.identities.alice.id, day(10), TODAY, { home: UNLINKED_HOME });
  assert.ok(plain.rows.every((row) => !('home_context_id' in row)));
  assert.deepEqual(plain.home, UNLINKED_HOME);
});

test('scopes: the current home (default), every home, or one home; per date and home, so every home shows its own day', () => {
  const linkedHome = { linked: true, current: { id: NEW, origin: 'move' } };
  const rows = [
    { date: day(3), home_context_id: OLD, created_at: at(day(3), 14) },
    { date: day(3), home_context_id: NEW, created_at: at(day(3), 13) },
    { date: day(3), home_context_id: null, created_at: at(day(3), 1) },
    { date: day(6), home_context_id: OLD, created_at: at(day(6), 12) },
  ];
  assert.deepEqual(inScope(rows, linkedHome), rows.slice(1, 3));
  assert.deepEqual(inScope(rows, linkedHome, 'current'), rows.slice(1, 3));
  assert.deepEqual(inScope(rows, linkedHome, 'all'), rows);
  assert.deepEqual(inScope(rows, linkedHome, { contextId: OLD }), [rows[0], rows[3]]);
  assert.deepEqual(inScope(rows, linkedHome, { contextId: NEW }), [rows[1]], 'one home: its own readings only, not the unlinked');
  assert.deepEqual(latestPerDay(rows, linkedHome), [rows[0], rows[1], rows[3]], 'day 3 once for the old home, once for the current one');
  assert.deepEqual(latestPerDay(rows), [rows[0], rows[3]], 'not linked: one record per date, as before');
  // Not linked (before 0016): every reading is the current home's, and no one home can be chosen.
  assert.deepEqual(inScope(rows, UNLINKED_HOME), rows);
  assert.deepEqual(inScope(rows, UNLINKED_HOME, { contextId: OLD }), []);
});

test('readingComparability is lib/homeContext.js comparability with the current home\'s origin, and legacy_assumed before 0016', () => {
  const cases = [
    [{ home_context_id: null }, { linked: true, current: { id: NEW, origin: 'move' } }, 'legacy_assumed'],
    [{ home_context_id: NEW }, { linked: true, current: { id: NEW, origin: 'move' } }, 'current_context'],
    [{ home_context_id: NEW }, { linked: true, current: { id: NEW, origin: 'onboard' } }, 'current_context'],
    [{ home_context_id: NEW }, { linked: true, current: { id: NEW, origin: 'legacy_migration' } }, 'legacy_assumed'],
    [{ home_context_id: OLD }, { linked: true, current: { id: NEW, origin: 'legacy_migration' } }, 'earlier_home'],
    [{ home_context_id: OLD }, { linked: true, current: null }, 'earlier_home'],
    [{ home_context_id: null }, { linked: true, current: null }, 'legacy_assumed'],
    [{}, UNLINKED_HOME, 'legacy_assumed'],
    [{ home_context_id: OLD }, UNLINKED_HOME, 'legacy_assumed'],
  ];
  for (const [row, homeOf, expected] of cases) {
    assert.equal(readingComparability(row, homeOf), expected, JSON.stringify([row, homeOf]));
    if (homeOf.linked) {
      const origin = row.home_context_id && row.home_context_id === homeOf.current?.id ? homeOf.current.origin : null;
      assert.equal(comparability({ ...row, home_context_origin: origin }, homeOf.current?.id ?? null), expected);
    }
  }
});

test('the row limit and truncation are as before: the household\'s readings in the range, newest first', async () => {
  const h = movedHarness();
  h.db.setMaxRows(5); // newest first by date, then created_at: today, day 1 (two), day 2, then the old home's day 3
  const { history, truncated } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(10), TODAY);
  assert.equal(truncated, true);
  assert.deepEqual(history.map((record) => record.date), [day(2), day(1), TODAY], 'the oldest days are the ones cut, never today');
});
