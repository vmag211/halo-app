/**
 * The pooled history readers are bound to the household's current home (migration 0016): journal
 * findings (which also reports `excluded_earlier_home`), the season summary, the first-visit
 * retrospective, the assistant's journal section and the daily job's alert inputs. Each test gives
 * a household an earlier home whose readings are newer than the current home's on the same dates
 * and say something else entirely, so a reader that pooled the homes would answer differently.
 * Bound, each answers exactly what it answers without those readings. Before 0016 every reader
 * pools the household's readings as it always has.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { HALO_TABLES } from './helpers/tables.mjs';
import { quiet } from './helpers/isolationKit.mjs';
import { seedHouseholds, contextId, localDate, addDays } from './helpers/isolationSeed.mjs';

const { gatherHouseholdContext } = await import('../lib/assistantContextData.js');

const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const SECRET = 'cron-secret-for-tests';
const WITHOUT_HOMES = Object.fromEntries(Object.entries(HALO_TABLES).filter(([name]) => name !== 'home_contexts'));

/** A reading of `who`'s earlier home, newer than any other reading of its date, and as unlike them as can be. */
const earlierReading = (profileId, date, who) => ({
  profile_id: profileId, date, score: 99, aqi: 5, uv_index: 0, pollen_level: JSON.stringify({ tree: 0, grass: 0, weed: 0 }),
  mold_risk: 'low', aqi_source: 'airnow', created_at: `${date}T23:59:00Z`, home_context_id: contextId(who, 1),
});

/**
 * The isolation households (lib readers' usual fixtures). With `moved`, `who`'s first home is closed
 * and a second one is current; their seeded readings keep no home recorded (assumed current).
 * `earlier(ids)` adds readings of the closed home. `tables` without home_contexts is before 0016.
 */
function households({ moved = null, earlier = () => [], tables = HALO_TABLES, env, fetch, adjust } = {}) {
  return createRouteHarness({
    tables,
    env,
    fetch,
    seed: (identities) => seedHouseholds(identities, {
      adjust: (rows) => {
        if (moved) {
          const first = rows.home_contexts.find((row) => row.id === contextId(moved, 1));
          const closedAt = `${day(25)}T12:00:00Z`;
          Object.assign(first, { effective_to: closedAt, closed_reason: 'moved' });
          rows.home_contexts.push({ ...first, id: contextId(moved, 2), sequence: 2, origin: 'move', effective_from: closedAt, effective_to: null, closed_reason: null, onboard_request_id: null });
        }
        rows.daily_scores.push(...earlier(identities));
        adjust?.(rows, identities);
        if (!tables.home_contexts) delete rows.home_contexts;
      },
    }),
  });
}

/**
 * bob's own readings are unhealthy on the days he logged symptoms (1 to 8) and clean on the others
 * (9 to 20), so his findings say something. His earlier home's readings for days 1 to 8 are clean:
 * pooled, they would erase that.
 */
const contrast = (rows, { bob }) => {
  for (const row of rows.daily_scores) {
    if (row.profile_id !== bob.id || row.date < day(20) || row.date > day(9)) continue;
    Object.assign(row, { aqi: 20, uv_index: 1, pollen_level: JSON.stringify({ tree: 0, grass: 0, weed: 0 }), mold_risk: 'low' });
  }
};
const bobsEarlierDays = ({ bob }) => Array.from({ length: 8 }, (_, n) => earlierReading(bob.id, day(n + 1), 'bob'));
const json = async (res) => { assert.equal(res.status, 200, JSON.stringify(await res.clone().json())); return res.json(); };

// ------------------------------------------------------------------- findings

test('findings: only the current home\'s readings are analysed; excluded_earlier_home counts the earlier home\'s days left out', async () => {
  const findings = (h) => h.call('/api/journal/findings', 'GET', { as: 'bob' }).then(json);
  const plain = await findings(households({ moved: 'bob', adjust: contrast }));
  const moved = await findings(households({ moved: 'bob', earlier: bobsEarlierDays, adjust: contrast }));
  assert.equal(plain.ready, true);
  assert.ok(plain.findings.length > 0, 'the fixture has something to find');
  assert.equal(plain.excluded_earlier_home, 0);
  assert.equal(moved.excluded_earlier_home, 8);
  assert.deepEqual(moved, { ...plain, excluded_earlier_home: 8 }, 'the same analysis, number for number');

  // The same readings pooled (before 0016) do change the analysis: the exclusion is what kept it.
  const pooled = await findings(households({ earlier: bobsEarlierDays, tables: WITHOUT_HOMES, adjust: contrast }));
  assert.equal(pooled.excluded_earlier_home, 0, 'before 0016 nothing is from an earlier home');
  assert.notDeepEqual({ ...pooled, excluded_earlier_home: 8 }, moved);
});

test('findings on a household with no earlier home: the same body as before 0016, number for number, with excluded_earlier_home 0', async () => {
  for (const who of ['alice', 'bob']) {
    const bound = await households().call('/api/journal/findings', 'GET', { as: who }).then(json);
    const before = await households({ tables: WITHOUT_HOMES }).call('/api/journal/findings', 'GET', { as: who }).then(json);
    assert.deepEqual(bound, before);
    assert.equal(bound.excluded_earlier_home, 0);
    assert.deepEqual(Object.keys(bound).slice(-2), ['truncated', 'excluded_earlier_home'], 'added after the fields it always had');
  }
});

// ------------------------------------------------------- summary, retrospective

test('the season summary reads the current home\'s readings only', async () => {
  const springDays = ({ bob }) => [3, 6, 9, 12, 15, 18].map((d) => earlierReading(bob.id, `2025-04-${String(d).padStart(2, '0')}`, 'bob'));
  const summary = (h) => h.call('/api/journal/summary', 'GET', { as: 'bob', url: '/api/journal/summary?season=spring&year=2025' }).then(json);
  const plain = await summary(households({ moved: 'bob' }));
  assert.deepEqual(await summary(households({ moved: 'bob', earlier: springDays })), plain);
  assert.notDeepEqual(await summary(households({ earlier: springDays, tables: WITHOUT_HOMES })), plain, 'pooled, the earlier home would change it');
});

test('the first-visit retrospective compares the current home\'s readings only', async () => {
  const retro = (h) => h.call('/api/journal/retrospective', 'POST', { as: 'bob', body: { dates: [day(2), day(5), day(7)] } }).then(json);
  const plain = await retro(households({ moved: 'bob', adjust: contrast }));
  assert.equal(plain.ready, true);
  assert.deepEqual(await retro(households({ moved: 'bob', earlier: bobsEarlierDays, adjust: contrast })), plain);
  assert.notDeepEqual(await retro(households({ earlier: bobsEarlierDays, tables: WITHOUT_HOMES, adjust: contrast })), plain, 'pooled, the earlier home would change it');
});

// ------------------------------------------------------------------ assistant

test('the assistant\'s journal findings come from the current home\'s readings only', async () => {
  const context = (h) => gatherHouseholdContext(h.db, h.identities.bob.id, 'journal');
  const plain = await context(households({ moved: 'bob', adjust: contrast }));
  assert.match(plain, /BOB-COUGH-MARKER|cough/i);
  assert.equal(await context(households({ moved: 'bob', earlier: bobsEarlierDays, adjust: contrast })), plain);
  assert.notEqual(await context(households({ earlier: bobsEarlierDays, tables: WITHOUT_HOMES, adjust: contrast })), plain, 'pooled, the earlier home would change it');
});

// ------------------------------------------------------- daily job alert inputs

/**
 * alice (a sensitive household) moved: today's reading is her new home's and unhealthy (AQI 180).
 * Yesterday's is `yesterday`: 'earlier' (her old home's, equally unhealthy) or 'current' (her new
 * home's, equally unhealthy).
 */
function cronHouseholds({ yesterday, tables = HALO_TABLES }) {
  return households({
    moved: 'alice',
    tables,
    env: { CRON_SECRET: SECRET },
    fetch: async () => new Response('{}', { status: 503 }),
    adjust: (rows, { alice }) => {
      const mine = rows.daily_scores.filter((row) => row.profile_id === alice.id);
      const today = mine.find((row) => row.date === TODAY);
      Object.assign(today, { aqi: 180, home_context_id: contextId('alice', 2) });
      const before = mine.find((row) => row.date === day(1));
      Object.assign(before, { aqi: 180, home_context_id: contextId('alice', yesterday === 'earlier' ? 1 : 2) });
      // The new home is at the profile's point, as onboarding leaves it.
      const current = rows.home_contexts.find((row) => row.id === contextId('alice', 2));
      if (current) Object.assign(current, { lat: rows.profiles[0].lat, lng: rows.profiles[0].lng });
    },
  });
}

const airAlerts = async (h) => {
  const res = await h.call('/api/cron/daily', 'GET', { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.readings.already_had_one, 2, 'both households already had today\'s reading');
  return h.db.rows('alerts').filter((row) => row.profile_id === h.identities.alice.id && row.dedupe_key === `air_quality_change:${TODAY}`);
};

test('the daily job\'s air alert compares today with yesterday at the current home, never with an earlier home\'s reading', async (t) => {
  quiet(t);
  // Yesterday's only reading is the old home's: nothing to compare at this home, so today's unhealthy air is news.
  assert.equal((await airAlerts(cronHouseholds({ yesterday: 'earlier' }))).length, 1);
  // Yesterday's reading is this home's and just as unhealthy: no change, no alert.
  assert.equal((await airAlerts(cronHouseholds({ yesterday: 'current' }))).length, 0);
  // Before 0016 the readings pool as they always have: yesterday's (whichever home) counts.
  assert.equal((await airAlerts(cronHouseholds({ yesterday: 'earlier', tables: WITHOUT_HOMES }))).length, 0);
});

test('the daily job binds the alert inputs from its one bulk read of the homes: no read of a home per household', async (t) => {
  quiet(t);
  const h = cronHouseholds({ yesterday: 'earlier' });
  await airAlerts(h);
  assert.equal(h.db.queryLog.filter((q) => q.table === 'home_contexts').length, 1);
  const historyReads = h.db.queryLog.filter((q) => q.table === 'daily_scores' && q.operation === 'select' && q.filters.some((f) => f.column === 'date' && f.op === 'gte'));
  assert.ok(historyReads.length >= 2, 'one history read per household');
});
