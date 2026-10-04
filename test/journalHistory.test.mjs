import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness } from './helpers/routeHarness.mjs'; // registers the module hooks first
import { haloTables } from './helpers/tables.mjs';
import { localDate, addDays } from './helpers/isolationSeed.mjs';

const { fetchHistory, fetchHistoryWindow } = await import('../lib/journalHistory.js');
const { aqiSeverity } = await import('../lib/severity.js');
const { HISTORY_ROW_LIMIT } = await import('../lib/boundedRead.js');

const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const AQI_STALE = 20;
const AQI_LATEST = 160;

const reading = (profileId, date, minute, aqi) => ({
  profile_id: profileId,
  date,
  aqi,
  uv_index: 3,
  mold_risk: 'low',
  pollen_level: JSON.stringify({ tree: 1, grass: 1, weed: 1 }),
  created_at: new Date(Date.parse(`${date}T00:00:00Z`) + minute * 60_000).toISOString(),
});

/** `refreshes` readings of every date from day(days - 1) to today; the last refresh of a date is the newest. */
const crowded = (profileId, days, refreshes) =>
  Array.from({ length: days }, (_, d) =>
    Array.from({ length: refreshes }, (_, n) => reading(profileId, day(days - 1 - d), n, n === refreshes - 1 ? AQI_LATEST : AQI_STALE)),
  ).flat();

const harness = (rowsFor) =>
  createRouteHarness({ tables: haloTables('daily_scores'), seed: (ids) => ({ daily_scores: rowsFor(ids) }) });

test('fetchHistory still answers a plain array: oldest date first, the newest refresh of a date wins, owner and window respected', async () => {
  const h = harness(({ alice, bob }) => [
    reading(alice.id, day(3), 5, AQI_LATEST), reading(alice.id, day(3), 1, AQI_STALE),
    reading(alice.id, day(1), 2, AQI_STALE),
    reading(alice.id, day(20), 2, AQI_STALE), // outside the window
    reading(bob.id, day(2), 2, AQI_LATEST), // another household
  ]);
  const history = await fetchHistory(h.db, h.identities.alice.id, day(10), TODAY);
  assert.ok(Array.isArray(history));
  assert.deepEqual(history.map((record) => record.date), [day(3), day(1)]);
  assert.equal(history[0].air, aqiSeverity(AQI_LATEST), 'the later created_at won, not the first stored');
  assert.equal(history[1].air, aqiSeverity(AQI_STALE));
});

test('fetchHistoryWindow adds truncated: false when everything was read', async () => {
  const h = harness(({ alice }) => crowded(alice.id, 30, 2));
  const window = await fetchHistoryWindow(h.db, h.identities.alice.id, day(29), TODAY);
  assert.deepEqual(Object.keys(window).sort(), ['history', 'truncated']);
  assert.equal(window.truncated, false);
  assert.equal(window.history.length, 30);
});

test('a server row cap cuts the oldest days, never today, and the result is still oldest first', async () => {
  const h = harness(({ alice }) => crowded(alice.id, 30, 1));
  h.db.setMaxRows(10); // PostgREST db-max-rows
  const { history, truncated } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(29), TODAY);
  assert.equal(truncated, true);
  assert.deepEqual(history.map((record) => record.date), Array.from({ length: 10 }, (_, i) => day(9 - i)), 'the 10 newest days, in chronological order');
  assert.equal(history.at(-1).date, TODAY);
});

test('a cut that lands inside a day keeps that day\'s newest refresh', async () => {
  const h = harness(({ alice }) => crowded(alice.id, 4, 4)); // 16 rows
  h.db.setMaxRows(10); // today, day 1 and the two newest refreshes of day 2
  const { history, truncated } = await fetchHistoryWindow(h.db, h.identities.alice.id, day(3), TODAY);
  assert.equal(truncated, true);
  assert.deepEqual(history.map((record) => record.date), [day(2), day(1), TODAY]);
  assert.equal(history[0].air, aqiSeverity(AQI_LATEST), 'the oldest kept day still shows its newest refresh');
});

test(`the row limit is ${HISTORY_ROW_LIMIT}: one more row than that is truncated, exactly that many is not, and other households do not count`, async () => {
  const over = harness(({ alice }) => crowded(alice.id, 90, 56)); // 5040 rows
  const cut = await fetchHistoryWindow(over.db, over.identities.alice.id, day(89), TODAY);
  assert.equal(cut.truncated, true);
  assert.equal(cut.history.at(-1).date, TODAY);
  assert.equal(cut.history.at(-1).air, aqiSeverity(AQI_LATEST));

  const exact = harness(({ alice, bob }) => [...crowded(alice.id, 100, 50), ...crowded(bob.id, 20, 50)]); // 5000 rows for alice
  const whole = await fetchHistoryWindow(exact.db, exact.identities.alice.id, day(99), TODAY);
  assert.equal(whole.truncated, false);
  assert.equal(whole.history.length, 100);
});

test('fetchHistory (the array form the cron and the assistant use) survives a cut', async () => {
  const h = harness(({ alice }) => crowded(alice.id, 30, 1));
  h.db.setMaxRows(10);
  const history = await fetchHistory(h.db, h.identities.alice.id, day(29), TODAY);
  assert.equal(history.length, 10);
  assert.equal(history.at(-1).date, TODAY);
});

test('fetchHistoryWindow throws the database error so callers answer 500', async () => {
  const h = createRouteHarness({ tables: {} }); // daily_scores missing: PGRST205
  await assert.rejects(() => fetchHistoryWindow(h.db, h.identities.alice.id, day(1), TODAY), /Could not find the table/);
});
