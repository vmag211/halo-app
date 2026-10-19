// B10 Task 6: the NWS active-alerts adapter (plan ruling F7, C8). "No active
// alerts" and "could not check" must stay distinct. Every call goes through a
// stubbed getJson; global fetch is blocked and must never be reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockedFetch } from './helpers/sandbox.mjs';
import { parseNwsAdvisories } from '../lib/alertInputs.js';
import {
  NWS_MAX_BYTES,
  alertsUrl,
  fetchActiveAlerts,
  nwsContact,
  nwsUserAgent,
  parseActiveAlerts,
} from '../lib/forecast/nwsAlerts.js';

const attempted = [];
globalThis.fetch = blockedFetch(attempted);

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), 'utf8'));
const response = (name) => fixture(name).response;

const MIXED = response('nws-alerts-mixed.json');
const NONE = response('nws-alerts-none-charlotte.json');
const PROBLEM = response('nws-alerts-error-400.json');
const NOW = Date.parse(fixture('nws-alerts-mixed.json')._fixture.testClock);
const CHARLOTTE = { lat: 35.2271, lng: -80.8431 };
// A made-up contact on a reserved test domain; the real one lives only in the deployment's NWS_CONTACT.
const ENV = { NWS_CONTACT: 'ops@halo-forecast.test' };

function stubGetJson(answers) {
  const calls = [];
  const queue = [...answers];
  const getJson = async (url, options) => {
    calls.push({ url, options });
    const next = queue.shift();
    if (!next) return { ok: false, reason: 'unexpected_call' };
    return typeof next === 'function' ? next() : next;
  };
  return { getJson, calls };
}
const ok = (json) => ({ ok: true, status: 200, json });
const INVALID = { ok: false, reason: 'invalid' };

test('the URL has the 2-decimal point and nothing else', () => {
  assert.equal(alertsUrl(CHARLOTTE), 'https://api.weather.gov/alerts/active?point=35.23,-80.84');
  assert.equal(alertsUrl({ lat: 36, lng: -79.5 }), 'https://api.weather.gov/alerts/active?point=36.00,-79.50');
  assert.equal(alertsUrl({ lat: '35.987654', lng: '-78.123456' }), 'https://api.weather.gov/alerts/active?point=35.99,-78.12');
  for (const bad of [null, {}, { lat: 'north', lng: 1 }, { lat: 95, lng: 0 }, { lat: Number.POSITIVE_INFINITY, lng: 0 }]) {
    assert.throws(() => alertsUrl(bad), TypeError);
  }
});

test('every active Actual alert survives, whatever its event, with its NWS name as received', () => {
  const parsed = parseActiveAlerts(MIXED, { now: NOW });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.alerts.map((a) => a.event), ['Flood Warning', 'Wind Advisory', 'Tornado Watch', 'Heat Advisory']);
  for (const alert of parsed.alerts) {
    assert.deepEqual(Object.keys(alert), ['id', 'event', 'ends']);
    assert.match(alert.id, /^urn:oid:/);
  }
  // The cron's helper keeps only flood and heat, so it would lose the Tornado Watch and the Wind Advisory.
  const cron = parseNwsAdvisories(MIXED).map((a) => a.event);
  assert.ok(!cron.includes('Tornado Watch') && !cron.includes('Wind Advisory'));
});

test('ends wins over expires; without ends, expires decides; times come out in UTC', () => {
  const byEvent = Object.fromEntries(parseActiveAlerts(MIXED, { now: NOW }).alerts.map((a) => [a.event, a.ends]));
  assert.equal(byEvent['Flood Warning'], '2026-10-20T13:00:00.000Z');
  assert.equal(byEvent['Wind Advisory'], '2026-10-20T00:00:00.000Z', 'no ends, so its expires');
  assert.equal(byEvent['Tornado Watch'], '2026-10-19T23:00:00.000Z');
  assert.equal(byEvent['Heat Advisory'], '2026-10-20T00:00:00.000Z', 'kept on its future ends although its expires is past');
});

test('Test and Exercise statuses, Cancel messages and ended or expired alerts are dropped', () => {
  const kept = parseActiveAlerts(MIXED, { now: NOW }).alerts.map((a) => a.event);
  const byEvent = Object.fromEntries(MIXED.features.map((f) => [f.properties.event, f.properties]));
  assert.equal(byEvent['Test Message'].status, 'Test');
  assert.equal(byEvent['Flood Watch'].status, 'Exercise');
  assert.equal(byEvent['Winter Storm Warning'].messageType, 'Cancel');
  assert.ok(Date.parse(byEvent['Coastal Flood Advisory'].ends) < NOW && Date.parse(byEvent['Coastal Flood Advisory'].expires) > NOW);
  assert.ok(byEvent['Dense Fog Advisory'].ends === null && Date.parse(byEvent['Dense Fog Advisory'].expires) < NOW);
  for (const dropped of ['Test Message', 'Flood Watch', 'Winter Storm Warning', 'Coastal Flood Advisory', 'Dense Fog Advisory']) {
    assert.ok(!kept.includes(dropped), dropped);
  }
  // An alert ending exactly now is over.
  const atEnd = parseActiveAlerts(MIXED, { now: Date.parse('2026-10-19T23:00:00Z') }).alerts.map((a) => a.event);
  assert.ok(!atEnd.includes('Tornado Watch'));
});

test('no features is a real "no active alerts", distinct from every failure', () => {
  assert.deepEqual(parseActiveAlerts(NONE, { now: NOW }), { ok: true, alerts: [] });
  assert.deepEqual(parseActiveAlerts({ type: 'FeatureCollection', features: [] }), { ok: true, alerts: [] });
});

test('malformed answers are invalid, never an empty list', () => {
  const feature = MIXED.features[0];
  const withProps = (changes) => ({ features: [{ ...feature, properties: { ...feature.properties, ...changes } }] });
  for (const [what, body] of Object.entries({
    'null JSON': null,
    'the problem-detail error body': PROBLEM,
    'non-JSON text': '<html><body>Service Unavailable</body></html>',
    'an array': [feature],
    'no features': { type: 'FeatureCollection' },
    'features not an array': { features: {} },
    'a feature that is not an object': { features: [null] },
    'a feature without properties': { features: [{ id: feature.id }] },
    'a feature without a status': withProps({ status: undefined }),
    'a feature without a messageType': withProps({ messageType: 7 }),
    'a kept alert without an event name': withProps({ event: '' }),
    'a kept alert without any id': { features: [{ ...feature, id: undefined, properties: { ...feature.properties, id: undefined } }] },
  })) {
    assert.deepEqual(parseActiveAlerts(body, { now: NOW }), INVALID, what);
  }
});

test('an unreadable time falls back to expires, and an alert with no readable time is kept', () => {
  const feature = MIXED.features[0];
  const one = (changes) => parseActiveAlerts({ features: [{ ...feature, properties: { ...feature.properties, ...changes } }] }, { now: NOW });
  assert.deepEqual(one({ ends: 'soon', expires: '2026-10-19T22:00:00-04:00' }).alerts.map((a) => a.ends), ['2026-10-20T02:00:00.000Z']);
  assert.deepEqual(one({ ends: '2026-10-20', expires: undefined }).alerts.map((a) => a.ends), [null], 'a bare date is not a date-time');
  assert.deepEqual(one({ ends: null, expires: null }).alerts.map((a) => a.event), ['Flood Warning']);
  // The feature's own id stands in when properties.id is missing; a repeated id is listed once.
  assert.deepEqual(one({ id: undefined }).alerts.map((a) => a.id), [feature.id]);
  assert.equal(parseActiveAlerts({ features: [feature, feature] }, { now: NOW }).alerts.length, 1);
});

test('the contact comes from NWS_CONTACT; without a usable one there is no User-Agent', () => {
  assert.equal(nwsContact(ENV), 'ops@halo-forecast.test');
  assert.equal(nwsUserAgent(ENV), '(HALO, ops@halo-forecast.test)');
  assert.equal(nwsUserAgent({ NWS_CONTACT: '  ops@halo-forecast.test \n' }), '(HALO, ops@halo-forecast.test)');
  for (const contact of [undefined, '', '   ', 'you@example.com', 'YOU@EXAMPLE.ORG', 'ops@mail.example.net', 'a@b.c\r\nX-Injected: 1', 'two words@x.test', 'ops@x.test)', 'é@x.test', 'x'.repeat(255), 'ab']) {
    assert.equal(nwsUserAgent({ NWS_CONTACT: contact }), null, JSON.stringify(contact));
  }
  assert.equal(nwsUserAgent({}), null);
  assert.equal(nwsUserAgent(undefined), null);
});

test('without a contact no request is made and the row is unavailable', async () => {
  for (const env of [{}, { NWS_CONTACT: '' }, { NWS_CONTACT: 'you@example.com' }]) {
    const { getJson, calls } = stubGetJson([ok(NONE)]);
    assert.deepEqual(await fetchActiveAlerts(CHARLOTTE, { getJson, env, now: NOW }), { ok: false, reason: 'no_contact' });
    assert.equal(calls.length, 0);
  }
});

test('fetchActiveAlerts sends the 2-decimal point, the User-Agent and the GeoJSON Accept header', async () => {
  const { getJson, calls } = stubGetJson([ok(MIXED)]);
  const result = await fetchActiveAlerts(CHARLOTTE, { getJson, env: ENV, now: () => NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result), ['ok', 'fetchedAt', 'alerts']);
  assert.equal(result.fetchedAt, '2026-10-19T17:00:00.000Z');
  assert.deepEqual(result.alerts, parseActiveAlerts(MIXED, { now: NOW }).alerts);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.weather.gov/alerts/active?point=35.23,-80.84');
  assert.deepEqual(calls[0].options, {
    timeoutMs: 6000,
    maxBytes: NWS_MAX_BYTES,
    headers: { 'User-Agent': '(HALO, ops@halo-forecast.test)', Accept: 'application/geo+json' },
  });
  assert.equal(NWS_MAX_BYTES, 2 * 1024 * 1024);
});

test('a quiet point is ok with no alerts', async () => {
  const { getJson } = stubGetJson([ok(NONE)]);
  assert.deepEqual(await fetchActiveAlerts(CHARLOTTE, { getJson, env: ENV, now: NOW }), { ok: true, fetchedAt: '2026-10-19T17:00:00.000Z', alerts: [] });
});

test('a 503, a timeout, null JSON, an error body or non-JSON is a failure, never "no alerts" (the cron trap, C8)', async () => {
  for (const [answer, reason] of [
    [{ ok: false, reason: 'http_503' }, 'http_503'],
    [{ ok: false, reason: 'timeout' }, 'timeout'],
    [{ ok: false, reason: 'invalid' }, 'invalid'],
    [ok(null), 'invalid'],
    [ok(PROBLEM), 'invalid'],
    [ok('<html>Service Unavailable</html>'), 'invalid'],
    [null, 'invalid'],
    [{ ok: false, reason: 'failed for https://api.weather.gov/alerts/active?point=35.23,-80.84' }, 'invalid'],
  ]) {
    const { getJson } = stubGetJson([() => answer]);
    const result = await fetchActiveAlerts(CHARLOTTE, { getJson, env: ENV, now: NOW });
    assert.deepEqual(result, { ok: false, reason }, JSON.stringify(answer));
    assert.ok(!('alerts' in result));
  }
});

test('a throwing getJson, a missing getJson or a bad point never throws and never calls out', async () => {
  const thrower = async () => { throw new Error('boom'); };
  assert.deepEqual(await fetchActiveAlerts(CHARLOTTE, { getJson: thrower, env: ENV, now: NOW }), INVALID);
  assert.deepEqual(await fetchActiveAlerts(CHARLOTTE, { env: ENV }), INVALID);
  const { getJson, calls } = stubGetJson([ok(NONE)]);
  assert.deepEqual(await fetchActiveAlerts({ lat: null, lng: null }, { getJson, env: ENV }), INVALID);
  assert.equal(calls.length, 0);
});

test('without an env option the contact is read from process.env.NWS_CONTACT', async (t) => {
  const had = Object.hasOwn(process.env, 'NWS_CONTACT');
  const saved = process.env.NWS_CONTACT;
  t.after(() => {
    if (had) process.env.NWS_CONTACT = saved;
    else delete process.env.NWS_CONTACT;
  });
  delete process.env.NWS_CONTACT;
  const unset = stubGetJson([ok(NONE)]);
  assert.deepEqual(await fetchActiveAlerts(CHARLOTTE, { getJson: unset.getJson, now: NOW }), { ok: false, reason: 'no_contact' });
  assert.equal(unset.calls.length, 0);
  process.env.NWS_CONTACT = 'ops@halo-forecast.test';
  const set = stubGetJson([ok(NONE)]);
  assert.equal((await fetchActiveAlerts(CHARLOTTE, { getJson: set.getJson, now: NOW })).ok, true);
  assert.equal(set.calls[0].options.headers['User-Agent'], '(HALO, ops@halo-forecast.test)');
});

test('no network was attempted by any test in this file', () => {
  assert.deepEqual(attempted, []);
});
