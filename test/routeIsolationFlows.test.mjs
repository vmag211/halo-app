/**
 * Cross-identity route isolation, part 2: the flows that write, delete or send
 * data out. Push subscriptions, account deletion, onboarding and daily readings
 * (which call providers with the household's location), the assistant (which
 * sends household context to a model) and the daily job (which serves every
 * household in one run). Part 1 is routeIsolation.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditOwnerScope, localDate, quiet, setup } from './helpers/isolationKit.mjs';
import { ENDPOINT, PROFILE, alertId, entryId, addDays } from './helpers/isolationSeed.mjs';
import { OWNED_TABLES } from './helpers/tables.mjs';
import { keysFor } from './helpers/pushKeys.mjs';

const OWNED = Object.keys(OWNED_TABLES);
const REFERENCE = ['ucmr5_utilities', 'volunteer_orgs', 'map_layers', 'learn_content', 'water_snapshots'];

const bobsRows = (ctx, tables = OWNED) => Object.fromEntries(tables.map((table) => [table, ctx.rowsOf(table, 'bob')]));
const everything = (ctx, tables) => Object.fromEntries(tables.map((table) => [table, ctx.h.db.rows(table)]));
// Keys shaped like a browser's (87 and 22 characters), with the tag spelled inside.
const subscription = (endpoint, tag = 'k') => ({ endpoint, keys: keysFor(tag) });
const ALICE_SECOND_DEVICE = 'https://fcm.googleapis.com/fcm/send/alice-second-device';

// ---- Push subscriptions ----

test('POST /api/push/subscribe: an endpoint another household owns is not taken over, and the answer does not reveal it', async () => {
  const ctx = setup();
  const [bobsDevice] = ctx.rowsOf('push_subscriptions', 'bob');
  assert.equal(bobsDevice.endpoint, ENDPOINT.bob);
  const aliceBefore = ctx.rowsOf('push_subscriptions', 'alice');

  const fresh = await ctx.call('alice', '/api/push/subscribe', 'POST', { body: subscription(ALICE_SECOND_DEVICE, 'fresh') });
  const clash = await ctx.call('alice', '/api/push/subscribe', 'POST', { body: subscription(ENDPOINT.bob, 'TAKEOVER') });

  // Indistinguishable from a normal success: same status, body and content type.
  assert.deepEqual(
    [clash.status, await clash.json(), clash.headers.get('content-type')],
    [fresh.status, await fresh.json(), fresh.headers.get('content-type')],
  );

  // Bob's device is still bob's, with bob's keys, and nothing of alice's attempt is stored anywhere.
  assert.deepEqual(ctx.rowsOf('push_subscriptions', 'bob'), [bobsDevice]);
  assert.equal(ctx.h.db.rows('push_subscriptions').filter((row) => row.endpoint === ENDPOINT.bob).length, 1);
  assert.ok(!JSON.stringify(ctx.h.db.rows('push_subscriptions')).includes('TAKEOVER'));
  assert.deepEqual(ctx.rowsOf('push_subscriptions', 'alice').map((row) => row.endpoint).sort(), [...aliceBefore.map((row) => row.endpoint), ALICE_SECOND_DEVICE].sort());
});

test('POST /api/push/subscribe: a household can still re-register its own device, and its keys refresh in place', async () => {
  const ctx = setup();
  const bobBefore = bobsRows(ctx);
  const res = await ctx.call('alice', '/api/push/subscribe', 'POST', { body: subscription(ENDPOINT.alice, 'ROTATED') });
  assert.deepEqual(await res.json(), { ok: true });

  const mine = ctx.rowsOf('push_subscriptions', 'alice');
  assert.equal(mine.length, 1); // refreshed, not duplicated
  assert.deepEqual([mine[0].endpoint, mine[0].p256dh, mine[0].auth], [ENDPOINT.alice, keysFor('ROTATED').p256dh, keysFor('ROTATED').auth]);
  assert.deepEqual(bobsRows(ctx), bobBefore);

  const brandNew = await ctx.call('alice', '/api/push/subscribe', 'POST', { body: subscription('https://fcm.googleapis.com/fcm/send/alice-phone') });
  assert.deepEqual(await brandNew.json(), { ok: true });
  assert.equal(ctx.rowsOf('push_subscriptions', 'alice').length, 2);
});

test('DELETE /api/push/subscribe: another household\'s endpoint is not removed and looks like an endpoint that does not exist', async () => {
  const ctx = setup();
  const bobBefore = bobsRows(ctx);

  const foreign = await ctx.call('alice', '/api/push/subscribe', 'DELETE', { body: { endpoint: ENDPOINT.bob } });
  const missing = await ctx.call('alice', '/api/push/subscribe', 'DELETE', { body: { endpoint: 'https://fcm.googleapis.com/fcm/send/nobody' } });
  assert.deepEqual([foreign.status, await foreign.json()], [missing.status, await missing.json()]);
  assert.deepEqual(bobsRows(ctx), bobBefore);

  const own = await ctx.call('alice', '/api/push/subscribe', 'DELETE', { body: { endpoint: ENDPOINT.alice } });
  assert.equal(own.status, 200);
  assert.deepEqual(ctx.rowsOf('push_subscriptions', 'alice'), []);
});

// ---- Account deletion ----

test('DELETE /api/account removes the caller from every owned table and leaves the other household whole', async () => {
  const ctx = setup();
  const bob = ctx.id('bob');
  for (const table of OWNED) {
    assert.ok(ctx.rowsOf(table, 'alice').length > 0 && ctx.rowsOf(table, 'bob').length > 0, `${table} needs rows for both households, or the test proves nothing`);
  }
  const bobBefore = bobsRows(ctx);
  const referenceBefore = everything(ctx, REFERENCE.filter((table) => table !== 'learn_content' && table !== 'water_snapshots'));

  for (const body of [{}, { confirm: 'delete' }, { confirm: true }, { confirm: 'DELETE ' }, { user_id: bob }]) {
    const refused = await ctx.call('alice', '/api/account', 'DELETE', { body });
    assert.equal(refused.status, 400, JSON.stringify(body));
  }
  assert.ok(OWNED.every((table) => ctx.rowsOf(table, 'alice').length > 0), 'a refused confirmation deletes nothing');

  const res = await ctx.call('alice', '/api/account', 'DELETE', {
    body: { confirm: 'DELETE', user_id: bob, id: bob, profile_id: bob },
    headers: { 'x-user-id': bob },
    url: `/api/account?id=${bob}&user_id=${bob}`,
  });
  assert.deepEqual([res.status, await res.json()], [200, { deleted: true }]);

  for (const table of OWNED) assert.deepEqual(ctx.rowsOf(table, 'alice'), [], `${table} still holds alice's rows`);
  assert.deepEqual(bobsRows(ctx), bobBefore);
  assert.deepEqual(everything(ctx, Object.keys(referenceBefore)), referenceBefore, 'shared reference data is not household data and stays');
  assert.deepEqual([...ctx.h.db.identities.keys()], [bob]);

  const gone = await ctx.h.call('/api/household', 'GET', { as: 'alice' });
  assert.equal(gone.status, 401);
  const bobStill = await ctx.call('bob', '/api/household', 'GET');
  assert.equal((await bobStill.json()).household.has_toddler, true);

  const again = await ctx.h.call('/api/account', 'DELETE', { as: 'alice', body: { confirm: 'DELETE', user_id: bob } });
  assert.equal(again.status, 401); // a deleted session cannot be replayed against the other household
  assert.deepEqual(bobsRows(ctx), bobBefore);
});

// ---- Routes that call providers with the household's location ----

const OPEN_METEO_DAYS = (today) => Array.from({ length: 10 }, (_, n) => addDays(today, -(n + 1)));

function onboardingProviders(today) {
  return ({ url }) => {
    if (url.startsWith('https://api.mapbox.com/')) {
      return Response.json({
        features: [{
          center: [-80.61, 35.41],
          context: [{ id: 'postcode.1', text: '28027' }, { id: 'district.1', text: 'Cabarrus County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }],
        }],
      });
    }
    if (url.startsWith('https://services.arcgis.com/')) return Response.json({ features: [{ attributes: { PWSID: PROFILE.alice.pwsid } }] });
    if (url.startsWith('https://air-quality-api.open-meteo.com/')) {
      const dates = OPEN_METEO_DAYS(today);
      return Response.json({ hourly: { time: dates.map((date) => `${date}T12:00`), us_aqi: dates.map(() => 55) } });
    }
    if (url.startsWith('https://api.open-meteo.com/')) {
      const dates = OPEN_METEO_DAYS(today);
      return Response.json({ daily: { time: dates, uv_index_max: dates.map(() => 5), relative_humidity_2m_mean: dates.map(() => 50), precipitation_probability_max: dates.map(() => 10) } });
    }
    return null;
  };
}

test('POST /api/onboard moves only the caller\'s home: its profile, its cached reading and its backfill, never the other household\'s', async (t) => {
  quiet(t);
  const today = localDate();
  const ctx = setup({ env: { MAPBOX_TOKEN: 'pk.test-token' }, provider: onboardingProviders(today) });
  const bob = ctx.id('bob');
  const bobBefore = bobsRows(ctx);
  const aliceDaysBefore = ctx.rowsOf('daily_scores', 'alice');
  assert.ok(aliceDaysBefore.some((row) => row.date === today), 'alice has a cached reading for today, which a move discards');

  const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const res = await ctx.call('alice', '/api/onboard', 'POST', {
    body: { address: '2 Elm Court', profile_id: ctx.id('alice'), water_source: 'utility', home_year: 1999, request_id: requestId },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile_id, ctx.id('alice'));

  const [profile] = ctx.rowsOf('profiles', 'alice');
  assert.deepEqual([profile.lat, profile.lng, profile.home_year, profile.onboard_request_id], [35.41, -80.61, 1999, requestId]);
  assert.ok(!ctx.rowsOf('daily_scores', 'alice').some((row) => row.date === today), 'alice\'s reading for the old home is gone');
  assert.deepEqual(bobsRows(ctx), bobBefore, 'bob\'s profile and today\'s reading are untouched by alice\'s move');
  assert.ok(ctx.outbound.every((request) => !request.url.includes(String(PROFILE.bob.lat)) && !request.url.includes(bob)));

  // The backfill runs after the response, for alice only, and never overwrites a day she already has.
  const queriesBefore = ctx.h.db.queryLog.length;
  await ctx.h.runAfter();
  auditOwnerScope(ctx.h.db.queryLog.slice(queriesBefore), ctx.id('alice'), 'onboard backfill');
  const aliceDays = ctx.rowsOf('daily_scores', 'alice');
  assert.ok(aliceDays.length > aliceDaysBefore.length - 1, 'the backfill added days');
  for (const kept of aliceDaysBefore.filter((row) => row.date !== today && row.date >= addDays(today, -28))) {
    assert.deepEqual(aliceDays.find((row) => row.date === kept.date), kept, `${kept.date} was a real reading and must not be overwritten`);
  }
  assert.deepEqual(bobsRows(ctx), bobBefore);
});

test('POST /api/onboard: when the utility lookup fails, the household keeps and is told its own utility, not another\'s', async (t) => {
  quiet(t);
  const today = localDate();
  const working = onboardingProviders(today);
  const ctx = setup({
    env: { MAPBOX_TOKEN: 'pk.test-token' },
    provider: (request) => (request.url.startsWith('https://services.arcgis.com/') ? new Response('down', { status: 503 }) : working(request)),
  });
  const bobBefore = bobsRows(ctx);

  const res = await ctx.call('alice', '/api/onboard', 'POST', { body: { address: '2 Elm Court' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.service_area_status, body.pwsid], ['lookup_failed', PROFILE.alice.pwsid]);
  assert.equal(ctx.rowsOf('profiles', 'alice')[0].pwsid, PROFILE.alice.pwsid);
  assert.deepEqual(bobsRows(ctx), bobBefore);
});

test('GET /api/daily-score: a household with no cached reading is never served the other household\'s, and only its own row is written', async (t) => {
  quiet(t);
  const ctx = setup({ seed: { readingToday: false } });
  ctx.h.db.seed('daily_scores', [{
    profile_id: ctx.id('bob'), date: ctx.today, score: 23, aqi: 163, uv_index: 9, pollen_level: '{"tree":4}', mold_risk: 'high',
    aqi_source: 'open-meteo', created_at: new Date(Date.now() - 60 * 1000).toISOString(), details: { dominant_pollutant: 'BOB-POLLUTANT-MARKER' },
  }]);
  const [bobRow] = ctx.rowsOf('daily_scores', 'bob').filter((row) => row.date === ctx.today);
  const bobBefore = bobsRows(ctx);

  const res = await ctx.call('alice', '/api/daily-score', 'GET');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cached, false, 'bob\'s fresh row must not be served as alice\'s cache');
  ctx.assertNoLeak('alice', body, 'GET /api/daily-score (cache miss)');

  const written = ctx.rowsOf('daily_scores', 'alice').filter((row) => row.date === ctx.today);
  assert.equal(written.length, 1, 'alice\'s own reading was stored under alice');
  assert.deepEqual(ctx.rowsOf('daily_scores', 'bob').filter((row) => row.date === ctx.today), [bobRow]);
  assert.deepEqual(bobsRows(ctx), bobBefore);
  assert.ok(ctx.outbound.length > 0 && ctx.outbound.every((request) => request.url.includes(String(PROFILE.alice.lat))), 'providers were asked about alice\'s location only');
});

test('GET /api/daily-score?lat&lng for a point that is not the caller\'s home is served live and cached for nobody', async (t) => {
  quiet(t);
  const ctx = setup({ seed: { readingToday: false } });
  const before = everything(ctx, ['daily_scores']);
  const res = await ctx.call('alice', '/api/daily-score', 'GET', { url: `/api/daily-score?lat=${PROFILE.bob.lat}&lng=${PROFILE.bob.lng}` });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cached, false);
  assert.deepEqual(everything(ctx, ['daily_scores']), before, 'a reading for some other point is not stored as either household\'s');
});

// ---- The assistant sends household context to a model ----

test('POST /api/assistant sends the caller\'s own context to the model and never the other household\'s, nor any journal note', async (t) => {
  quiet(t);
  const sent = [];
  const ctx = setup({
    env: { ASSISTANT_MODEL_KEY: 'test-model-key' },
    provider: ({ url, body }) => {
      sent.push({ url, body });
      if (url.includes('/embeddings')) return Response.json({ data: [{ embedding: new Array(1536).fill(0.01) }] });
      if (url.includes('/chat/completions')) return Response.json({ choices: [{ message: { content: 'Your reading is on the moderate side [H].' } }] });
      return null;
    },
  });
  ctx.h.db.registerRpc('match_assistant_corpus', () => []);

  for (const who of ['alice', 'bob']) {
    const from = sent.length;
    const outboundFrom = ctx.outbound.length;
    const res = await ctx.call(who, '/api/assistant', 'POST', {
      body: { question: 'How is my air today?', page: 'today', profile_id: ctx.id(who === 'alice' ? 'bob' : 'alice') },
    });
    assert.equal(res.status, 200, who);
    assert.equal((await res.json()).uses_household_data, true, `${who}: the model call carried the household's context`);

    const prompt = sent.slice(from).find((request) => request.url.includes('/chat/completions')).body;
    const upper = who.toUpperCase();
    for (const own of [`${upper}-COUGH-MARKER`, `${upper} WATER SYSTEM MARKER`, who === 'alice' ? 'Air quality index 47' : 'Air quality index 163']) {
      assert.ok(prompt.includes(own), `${who}'s prompt is missing ${own}, so the check proves nothing`);
    }
    ctx.assertNoLeak(who, prompt, `POST /api/assistant as ${who}`, outboundFrom);
    assert.ok(!prompt.includes(`${upper}-NOTE-MARKER`), 'free-text journal notes are never sent to the model');
  }
});

// ---- The daily job serves every household in one run ----

test('GET /api/cron/daily needs the cron secret: a household session, a wrong secret or none runs nothing', async () => {
  const ctx = setup({ env: { CRON_SECRET: 'cron-secret-for-tests' } });
  const attempts = [
    {},
    { authorization: `Bearer ${ctx.h.identities.alice.token}` },
    { authorization: 'Bearer wrong-secret' },
    { 'x-cron-secret': 'wrong-secret' },
  ];
  for (const headers of attempts) {
    for (const method of ['GET', 'POST']) {
      const res = await ctx.h.call('/api/cron/daily', method, { headers });
      assert.equal(res.status, 401, `${method} ${JSON.stringify(headers)}`);
    }
  }
  const unset = setup(); // CRON_SECRET not configured at all: fails closed
  assert.equal((await unset.h.call('/api/cron/daily', 'GET', { headers: { authorization: 'Bearer anything' } })).status, 401);
  assert.deepEqual(ctx.h.db.queryLog, []);
  assert.deepEqual(unset.h.db.queryLog, []);
});

test('GET /api/cron/daily keeps households apart: bands, dedupe, preferences, season summaries and provider requests', async (t) => {
  quiet(t);
  // Early September: the first week after summer ends, so the season-summary alert is due.
  const now = new Date('2026-09-03T15:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const ctx = setup({
    env: { CRON_SECRET: 'cron-secret-for-tests' },
    seed: {
      now,
      adjust: (rows, { alice, bob }) => {
        // Both households had elevated air today after a good yesterday; only alice's has a sensitive group.
        for (const row of rows.daily_scores) if (row.date === '2026-09-03') row.aqi = 120;
        for (const row of rows.daily_scores) if (row.date === '2026-09-02') row.aqi = 41;
        Object.assign(rows.household_bands.find((band) => band.profile_id === bob.id), { has_toddler: false, has_respiratory: false, has_adult: true });
        Object.assign(rows.notification_prefs.find((prefs) => prefs.profile_id === bob.id), { air_quality_change: true, new_water_results: true, radon_season: true });
        // Summer 2026 journal: alice logged two days in July, bob six (plus his late-August entries from the seed).
        for (const [who, id, days] of [['alice', alice.id, 2], ['bob', bob.id, 6]]) {
          for (let n = 1; n <= days; n += 1) {
            rows.symptom_logs.push({ id: entryId(who, 200 + n), profile_id: id, entry_date: `2026-07-${String(n * 2).padStart(2, '0')}`, band: 'household', symptoms: ['cough'] });
          }
        }
      },
    },
  });
  const [aliceId, bobId] = [ctx.id('alice'), ctx.id('bob')];
  assert.equal(ctx.today, '2026-09-03');
  const key = `new_water_results:${ctx.today}`;

  // Both utilities published new results. Bob already has today's alert for that; alice has none.
  ctx.h.db.seed('water_snapshots', [
    { pwsid: PROFILE.alice.pwsid, fingerprint: 'stale' },
    { pwsid: PROFILE.bob.pwsid, fingerprint: 'stale' },
  ]);
  ctx.h.db.seed('alerts', [{ id: alertId('bob', 9), profile_id: bobId, type: 'new_water_results', title: 'BOB-OLDER-ALERT', message: 'already sent', dedupe_key: key }]);
  const seeded = new Set(ctx.h.db.rows('alerts').map((alert) => alert.id));
  const bobAlertsBefore = ctx.rowsOf('alerts', 'bob');
  const bobOtherBefore = bobsRows(ctx, OWNED.filter((table) => table !== 'alerts'));

  const res = await ctx.h.call('/api/cron/daily', 'GET', { headers: { authorization: 'Bearer cron-secret-for-tests' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).households, 2);

  const fresh = (id) => ctx.h.db.rows('alerts').filter((alert) => alert.profile_id === id && !seeded.has(alert.id));
  const types = (id) => fresh(id).map((alert) => alert.type).sort();
  assert.deepEqual(types(aliceId), ['air_quality_change', 'new_water_results', 'season_summary']);
  // Bob: not sensitive, so no air alert at "elevated"; his existing alert already covers today's water news.
  assert.deepEqual(types(bobId), ['season_summary']);
  assert.deepEqual(ctx.rowsOf('alerts', 'bob').filter((alert) => seeded.has(alert.id)), bobAlertsBefore);

  // Each season summary counts only that household's own journal days (alice 2, bob 12; pooled would be 14).
  const summary = (id) => fresh(id).find((alert) => alert.type === 'season_summary').message;
  const loggedDays = (who) => new Set(ctx.rows.symptom_logs
    .filter((row) => row.profile_id === ctx.id(who) && row.entry_date >= '2026-06-01' && row.entry_date <= '2026-08-31')
    .map((row) => row.entry_date)).size;
  assert.notEqual(loggedDays('alice'), loggedDays('bob'));
  assert.ok(summary(aliceId).startsWith(`This summer you logged ${loggedDays('alice')} days.`), summary(aliceId));
  assert.ok(summary(bobId).startsWith(`This summer you logged ${loggedDays('bob')} days.`), summary(bobId));
  assert.ok(ctx.h.db.rows('alerts').every((alert) => [aliceId, bobId].includes(alert.profile_id)));

  // Only bob keeps weather advisories on, so only his location went to the weather service.
  const weather = ctx.outbound.filter((request) => request.url.startsWith('https://api.weather.gov/alerts'));
  assert.ok(weather.length > 0 && weather.every((request) => request.url.includes(String(PROFILE.bob.lat))));
  assert.ok(ctx.outbound.every((request) => !request.url.includes(String(PROFILE.alice.lat))), 'alice\'s coordinates left the app');
  assert.deepEqual(bobsRows(ctx, OWNED.filter((table) => table !== 'alerts')), bobOtherBefore);
});
