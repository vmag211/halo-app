import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const id = (prefix, n) => `${prefix}-1111-4000-8000-${n.toString(16).padStart(12, '0')}`;
const alert = (profileId, prefix, n, extra = {}) => ({
  id: id(prefix, n), profile_id: profileId, type: 'air_quality_change', severity: 'elevated',
  title: `Alert ${n}`, message: `Message ${n}`, dedupe_key: `${prefix}-${n}`, fired_at: `2026-09-${String(10 + n).padStart(2, '0')}T10:00:00Z`, ...extra,
});
const ALERT_KEYS = ['alerts', 'count', 'unread'];
const PREF_KEYS = ['air_quality_change', 'new_water_results', 'radon_season', 'season_summary', 'weather_advisory'];

// A table that is not in `tables` is not seeded either, so it answers like an unapplied migration (PGRST205).
const harness = ({ tables = haloTables('alerts', 'notification_prefs'), seed = () => ({}) } = {}) =>
  createRouteHarness({ tables, seed: (ids) => Object.fromEntries(Object.entries(seed(ids)).filter(([table]) => table in tables)) });
const get = (h, route, as = 'alice', headers) => h.call(`/api/${route}`, 'GET', { as, headers });
const breakReads = (h, table) => { // every read of `table` throws, like a database that fell over mid request
  const from = h.db.from.bind(h.db);
  h.db.from = (name) => { if (name === table) throw new Error('secret database detail'); return from(name); };
};
/** Before migration 0010 the `dismissed` column does not exist: a filter on it fails the way PostgREST says so. */
function withoutDismissedColumn(h) {
  const from = h.db.from.bind(h.db);
  h.db.from = (name) => {
    const real = from(name);
    if (name !== 'alerts') return real;
    const wrapper = {
      select: (...args) => { real.select(...args); return wrapper; },
      order: (...args) => { real.order(...args); return wrapper; },
      limit: (...args) => { real.limit(...args); return wrapper; },
      eq: (column, value) => {
        if (column === 'dismissed') return Promise.resolve({ data: null, error: { code: '42703', message: 'column alerts.dismissed does not exist' } });
        real.eq(column, value);
        return wrapper;
      },
      then: (resolve, reject) => real.then(resolve, reject),
    };
    return wrapper;
  };
}

// ------------------------------------------------------------ alerts GET

const twoInboxes = ({ alice, bob }) => ({
  alerts: [
    alert(alice.id, 'a11ce000', 1),
    alert(alice.id, 'a11ce000', 2, { read: true }),
    alert(alice.id, 'a11ce000', 3, { dismissed: true }),
    alert(bob.id, 'b0b00000', 1, { title: 'Bob only' }),
  ],
});

test('alerts legacy request: count, unread and the alerts, newest first, dismissed ones left out, plus a request id header', async () => {
  const res = await get(harness({ seed: twoInboxes }), 'alerts');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ALERT_KEYS);
  assert.deepEqual([body.count, body.unread], [2, 1]);
  assert.deepEqual(body.alerts.map((a) => a.title), ['Alert 2', 'Alert 1']);
  assert.deepEqual(Object.keys(body.alerts[0]).sort(), ['created_at', 'dedupe_key', 'dismissed', 'fired_at', 'id', 'message', 'profile_id', 'read', 'severity', 'title', 'type']);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('alerts: an empty inbox is a plain empty list', async () => {
  const body = await (await get(harness(), 'alerts')).json();
  assert.deepEqual(body, { count: 0, unread: 0, alerts: [] });
});

test('alerts: at most the newest 100 are listed (unchanged)', async () => {
  const h = harness({ seed: ({ alice }) => ({ alerts: Array.from({ length: 105 }, (_, i) => alert(alice.id, 'a11ce000', i + 1, { fired_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() })) }) });
  const body = await (await get(h, 'alerts')).json();
  assert.deepEqual([body.count, body.alerts[0].title, body.alerts.at(-1).title], [100, 'Alert 105', 'Alert 6']);
});

test('alerts: before migration 0010 (no dismissed column) the inbox is still served, dismissed alerts simply are not filtered', async () => {
  const h = harness({ seed: twoInboxes });
  withoutDismissedColumn(h);
  const res = await get(h, 'alerts');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual([body.count, body.alerts.map((a) => a.title)], [3, ['Alert 3', 'Alert 2', 'Alert 1']]);
});

test('alerts: only the caller\'s alerts are read, whatever ids the request names', async () => {
  const h = harness({ seed: twoInboxes });
  const res = await h.call('/api/alerts', 'GET', { as: 'alice', url: `/api/alerts?profile_id=${h.identities.bob.id}&id=${h.identities.bob.id}` });
  assert.deepEqual((await res.json()).alerts.map((a) => a.title), ['Alert 2', 'Alert 1']);
  assert.ok(h.db.queryLog.filter((q) => q.table === 'alerts').every((q) => q.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id)));
  assert.deepEqual((await (await get(h, 'alerts', 'bob')).json()).alerts.map((a) => a.title), ['Bob only']);
});

test('alerts: a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const res = await get(harness({ tables: {} }), 'alerts'); // alerts missing: PGRST205
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /schema cache|alerts|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

test('alerts: a missing session is a 401 envelope that echoes a client request id; an unexpected failure is a 500 envelope', async (t) => {
  const h = harness({ seed: twoInboxes });
  const none = await expectEnvelope(await h.call('/api/alerts', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  await expectEnvelope(await h.call('/api/alerts', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal((await get(h, 'alerts', 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
  const logged = muteConsoleError(t);
  breakReads(h, 'alerts');
  const body = await expectEnvelope(await get(h, 'alerts'), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
});

// ------------------------------------------------------ notifications GET

test('notifications legacy request: the five preferences, every one on unless the household turned it off, plus a request id header', async () => {
  const h = harness({ seed: ({ alice, bob }) => ({ notification_prefs: [{ profile_id: alice.id, weather_advisory: false }, { profile_id: bob.id, radon_season: false }] }) });
  const res = await get(h, 'notifications');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['preferences']);
  assert.deepEqual(Object.keys(body.preferences).sort(), PREF_KEYS);
  assert.deepEqual(body.preferences, { air_quality_change: true, weather_advisory: false, new_water_results: true, radon_season: true, season_summary: true });
  assert.equal((await (await get(h, 'notifications', 'bob')).json()).preferences.radon_season, false);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('notifications: a household that never saved preferences gets every type on', async () => {
  const body = await (await get(harness(), 'notifications')).json();
  assert.ok(PREF_KEYS.every((key) => body.preferences[key] === true));
});

test('notifications: the preferences read is the caller\'s own, whatever ids the request names', async () => {
  const h = harness({ seed: ({ alice, bob }) => ({ notification_prefs: [{ profile_id: alice.id, season_summary: false }, { profile_id: bob.id }] }) });
  const res = await h.call('/api/notifications', 'GET', { as: 'bob', url: `/api/notifications?profile_id=${h.identities.alice.id}` });
  assert.equal((await res.json()).preferences.season_summary, true);
  const read = h.db.queryLog.find((q) => q.table === 'notification_prefs');
  assert.ok(read.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.bob.id));
});

test('notifications: before migration 0010 the read is a 500 envelope (unchanged status) with no database text', async (t) => {
  const logged = muteConsoleError(t);
  const res = await get(harness({ tables: {} }), 'notifications'); // notification_prefs missing: PGRST205
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|notification_prefs|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

test('notifications: a missing session is a 401 envelope that echoes a client request id; an unexpected failure is a 500 envelope', async (t) => {
  const h = harness();
  await expectEnvelope(await h.call('/api/notifications', 'GET', {}), { status: 401, code: 'auth_required' });
  await expectEnvelope(await h.call('/api/notifications', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal((await get(h, 'notifications', 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
  const logged = muteConsoleError(t);
  breakReads(h, 'notification_prefs');
  const body = await expectEnvelope(await get(h, 'notifications'), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
});
