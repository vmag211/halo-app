/**
 * B10 forecast.read: the executable contract, and conformance of the REAL
 * handler to it and to the frontend's own consumption logic (B10 Task 9).
 *
 * Every answer here travels the client's whole path. The real
 * `createProductionRuntime` (lib/frontend/production/runtime.ts, loaded as the
 * frontend tests load it) builds the query (runtime.ts:125-128, `place=` kept),
 * maps the status (:144) and unwraps the envelope (:147-153); its `fetcher` is
 * the real route handler (app/api/forecast/route.js) on the isolated harness of
 * test/helpers/forecastRoute.mjs. The read then goes through the hook's own
 * handling (ProductionContext.tsx:9,14), the validator (WeekSources.tsx:15-17)
 * and the screen's decisions and text (WeekOutdoors.tsx:31-38,44-46), all
 * transcribed in test/helpers/frontendB10.mjs, and each scenario asserts what
 * the screen then SHOWS, not only the body's shape. A validator-only check
 * missed the Luna empty-state bug; this one fails if the runtime, the
 * validator or a screen decision would.
 *
 * The document is docs/backend/contracts/b10.openapi.json. Every fixture under
 * docs/backend/contracts/fixtures/b10/ is the body the real handler produced
 * in this file (fixed clock, the synthetic request id, recorded provider
 * bodies), and the fixtures test fails if one drifts. Run
 * `node test/contractsB10.test.mjs --write-b10-fixtures` to rewrite them after
 * a deliberate contract change.
 *
 * AirNow (Task 5) is not built: most scenarios stand `airNowStandIn` in through
 * lib/forecast/airNowSlot.js, as the route suite does, and one runs with the
 * slot empty, as production is today. No real network, no real Supabase project
 * or Upstash: any other host is recorded and refused.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadFrontend } from './frontend-test-loader.mjs';
import * as fe from './helpers/frontendB10.mjs';
import {
  AIRNOW_ROWS, FORECAST_DATE, FORECAST_NOW, FORECAST_RUN, HOUR, airNowStandIn, captureLogs, forecastHarness, forecastWorld, gridsDisagree,
} from './helpers/forecastRoute.mjs';
import { _resetForecastCache } from '../lib/forecast/cache.js';
import { _setAirNowAdapter } from '../lib/forecast/airNowSlot.js';
import { buildForecastSnapshot } from '../lib/forecast/snapshot.js';

const { validActionSnapshot } = await import('../lib/actionRules.js');
const { createProductionRuntime, serviceMessage, productionOperations } = await loadFrontend('production/runtime');
const weekPreview = await loadFrontend('week-preview');
const expandedPreview = await loadFrontend('expanded-preview');
const evidence = await loadFrontend('week-evidence-preview');
const copy = evidence.weekEvidenceCopy;

after(() => _setAirNowAdapter(null));

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b10.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b10', components: contract.components });
const OP = { ...contract.paths['/api/forecast'].get, path: '/api/forecast', method: 'GET' };
const compiled = new Map();
function schemaFor(ref) {
  if (!compiled.has(ref)) compiled.set(ref, ajv.compile({ $ref: `urn:halo:b10${ref}` }));
  return compiled.get(ref);
}
const schema = (name) => schemaFor(`#/components/schemas/${name}`);
function validate(status, body) {
  const response = OP.responses[String(status)];
  assert.ok(response, `undocumented status ${status}`);
  const check = schemaFor(response.content['application/json'].schema.$ref);
  assert.equal(check(body), true, `forecastRead ${status}: ${ajv.errorsText(check.errors)}`);
}

const FIXTURE_DIR = new URL('../docs/backend/contracts/fixtures/b10/', import.meta.url);
const WRITE_FIXTURES = process.argv.includes('--write-b10-fixtures');
const fixtures = existsSync(FIXTURE_DIR)
  ? await Promise.all((await readdir(FIXTURE_DIR)).filter((n) => n.endsWith('.json')).sort()
    .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8')) })))
  : [];

const EM_DASH = String.fromCharCode(0x2014);
const REQUEST_ID = 'b10-contract-0001';
const TODAY = '2026-10-19'; // New York's date at FORECAST_NOW
const REVIEW_IDLE = Object.freeze({ forecast: 'unavailable' });
const UNVERIFIED = 'Forecast information could not be verified.';
const UNAVAILABLE = 'This service is unavailable. Try again later.';

function assertBare(body, label) {
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), `${label}: an object body`);
  assert.equal(Object.hasOwn(body, 'data'), false, `${label}: no top-level data key (runtime.ts:149-153)`);
  const text = JSON.stringify(body);
  assert.equal(text.includes(EM_DASH), false, `${label}: no U+2014`);
  assert.equal(text.toLowerCase().includes('\\u2014'), false, `${label}: no escaped U+2014`);
}

for (const fixture of fixtures) {
  test(`B10 fixture: ${fixture.name}`, () => {
    assert.equal(fixture.operationId, 'forecastRead');
    validate(fixture.status, fixture.body);
    assertBare(fixture.body, fixture.name);
  });
}

// ---------------------------------------------------------------------------
// Recording: statuses, headers both ways, fixtures
// ---------------------------------------------------------------------------

const seenStatuses = new Set();
const CHECKED_HEADERS = ['x-request-id', 'retry-after', 'cache-control'];
const seenHeaders = new Map();
const documentedHeaders = (status) => new Set(Object.keys(OP.responses[String(status)].headers ?? {}).map((n) => n.toLowerCase()));
const TRANSPORT = new Set(['authorization', 'accept', 'x-request-id']);
const documentedParams = new Set(OP.parameters.filter((p) => p.in === 'header').map((p) => p.name.toLowerCase()));
const sentHeaders = new Set();
const produced = new Map();

/** Keeps one real answer as a named fixture; the same name must always be the same answer. */
function keep(name, status, body) {
  const value = { operationId: 'forecastRead', status, body };
  if (produced.has(name)) assert.deepEqual(value, produced.get(name), `${name} was produced twice, differently`);
  produced.set(name, value);
}

/** One console capture per test, however many client worlds it makes. */
const logsByTest = new WeakMap();

/**
 * A client world: the forecast world and harness, the real runtime for one
 * identity, and a fetcher that hands each request to the real handler, then
 * checks the raw answer against the document before the runtime sees it.
 */
function clientWorld(t, { as = 'alice', airNow = true, token } = {}) {
  _resetForecastCache();
  _setAirNowAdapter(airNow ? airNowStandIn : null);
  if (!logsByTest.has(t)) logsByTest.set(t, captureLogs(t));
  const logs = logsByTest.get(t);
  const w = forecastWorld();
  const h = forecastHarness(w);
  const me = h.identities[as];
  const answers = [];
  const fetcher = async (path, init) => {
    assert.match(path, /^\/api\/forecast\?/, 'the registry path with a query (runtime.ts:72,128)');
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.body, undefined);
    const headers = { ...init.headers, 'x-request-id': REQUEST_ID };
    for (const name of Object.keys(headers).map((n) => n.toLowerCase())) {
      if (TRANSPORT.has(name)) continue;
      sentHeaders.add(name);
      assert.ok(documentedParams.has(name), `the client sends ${name} but the contract does not document it`);
    }
    const res = await h.call('/api/forecast', 'GET', { url: path, headers });
    const body = await res.clone().json();
    seenStatuses.add(res.status);
    const key = String(res.status);
    if (!seenHeaders.has(key)) seenHeaders.set(key, new Set());
    for (const name of CHECKED_HEADERS) {
      if (res.headers.get(name) === null) continue;
      seenHeaders.get(key).add(name);
      assert.ok(documentedHeaders(res.status).has(name), `${key}: sends ${name}, undocumented`);
    }
    assert.equal(res.headers.get('cache-control'), 'private, no-store', `${key}: Cache-Control`);
    assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${key}: the request id is echoed`);
    validate(res.status, body);
    assertBare(body, `forecastRead ${res.status}`);
    if (res.status === 200) {
      // The rules JSON Schema cannot state: the client's own validator, unique period names, an ordered horizon.
      assert.equal(fe.productionForecast({ data: body, error: null }).error, null, 'the client validator accepts every real 200');
      assert.equal(new Set(body.periods.map((p) => p.name)).size, body.periods.length, 'period names are unique (React keys)');
      assert.ok(body.horizonStart <= body.horizonEnd, 'horizonStart on or before horizonEnd');
    }
    if (res.status >= 400) {
      assert.equal(body.request_id, REQUEST_ID);
      assert.equal(/open_meteo|airnow|weather\.gov|upstash|redis|supabase|postgres|http_\d|run_unknown|incomplete|bearer/i.test(JSON.stringify(body)), false, `${key}: nothing proof-bearing in an error`);
    }
    answers.push({ status: res.status, body, headers: res.headers });
    return res;
  };
  const runtime = createProductionRuntime({
    identityId: me.id,
    homeContextId: 'home-context-of-someone-else',
    credential: async () => ({ identityId: me.id, accessToken: token ?? me.token }),
    fetcher,
  });
  const last = () => answers.at(-1);
  return { w, h, me, runtime, answers, last, logs };
}

/**
 * The screen for one draft: the hook's read, the validator, the decisions and
 * the text it renders (production branches; review state idle).
 */
async function screen(cw, { date = FORECAST_DATE, place = '', period = 'Morning', now = Date.now(), acknowledged = '' } = {}) {
  const read = await fe.resourceRead(cw.runtime, 'forecast.read', { date, place }, serviceMessage);
  return decide(read, { date, place, period, now, acknowledged });
}

function decide(read, { date, place, period, now, acknowledged }) {
  const live = fe.productionForecast(read);
  const draft = { key: 'outdoors:0b100000-0000-4000-8000-000000000001', activity: 'Walk', place, date, period, duration: 60, watch: false, preparation: [] };
  const d = fe.outdoorDecisions({
    live, draft, today: TODAY, review: REVIEW_IDLE, state: { actions: [] }, now, acknowledged, pauseForecast: false,
    validActionDate: expandedPreview.validActionDate, dayAdd: weekPreview.dayAdd, forecastFixture: evidence.forecastFixture,
  });
  const { forecastZone, periodTime } = fe.screenPeriodTime(live, fe.forecastTime);
  const text = fe.forecastScreenText(live, d.currentPeriod);
  const cards = d.periods.map((p) => ({ name: p.name, from: periodTime(p.start), to: periodTime(p.end), ...fe.forecastScreenText(live, p).cells }));
  const notices = fe.forecastNotices(live, { forecastZone, expired: d.expired, changed: d.changed, needsReview: d.needsReview, copy });
  const emptyMessage = d.periods.length ? null : fe.emptyStateMessage(d.far, REVIEW_IDLE, copy);
  const checkAgain = d.periods.length ? null : fe.checkAgainDate(d.far, draft, weekPreview.dayAdd);
  const validation = fe.outdoorValidate({
    placeReview: false, blocked: false, navigator: { onLine: true }, draft, validActionDate: expandedPreview.validActionDate, today: TODAY,
    expired: d.expired, live, copy, needsReview: d.needsReview,
  });
  return { read, live, draft, ...d, forecastZone, periodTime, text, cards, notices, emptyMessage, checkAgain, validation };
}

/** Everything the screen renders from the body: React children must be strings, and none carries U+2014. */
function rendered(s) {
  const out = [];
  for (const card of s.cards) out.push(card.from, card.to, card.air, card.uv, card.pollen, card.weather, card.tradeoff);
  out.push(s.text.sourceName, s.text.horizon, s.text.expiry, s.text.notices, ...Object.values(s.text.coverage));
  if (s.cards.length) out.push(s.notices.issuedLine);
  return out;
}
function assertRenderable(s, label) {
  for (const value of rendered(s)) {
    assert.equal(typeof value, 'string', `${label}: a React child the screen can render, not ${JSON.stringify(value)}`);
    assert.equal(value.includes(EM_DASH), false, `${label}: no U+2014 in ${value}`);
  }
}

/** The save the screen sends for the selected period (WeekOutdoors.tsx:36-38), and the B06 snapshot it becomes. */
async function save(s) {
  let sent = null;
  const state = { addActions: async (items, date, options) => { sent = { items, date, options }; return true; } };
  const out = await fe.outdoorCommitTail({
    emptyWeekMeta: weekPreview.emptyWeekMeta, metas: {}, draft: s.draft, currentPeriod: s.currentPeriod, periodTime: s.periodTime,
    forecastZone: s.forecastZone, today: TODAY, existing: s.existing, change: null, live: s.live, state, sourceName: s.text.sourceName,
  });
  assert.equal(out.saved, true);
  const [item] = sent.items;
  const snapshot = {
    actions: [{ id: '0b100000-0000-4000-8000-000000000002', key: item.key, title: item.title, date: sent.date, state: 'saved', revision: 1, reason: item.reason, origin: item.origin }],
    metas: { [item.key]: out.nextMeta },
    preferences: sent.options.preferences,
    unresolvedOperations: [],
  };
  return { ...out, item, sent, snapshot };
}

const freezeClock = (t, now = FORECAST_NOW) => t.mock.timers.enable({ apis: ['Date'], now });

// ---------------------------------------------------------------------------
// 1. The contract's own coverage
// ---------------------------------------------------------------------------

test('the contract documents exactly forecast.read at the registry path, with the handler\'s statuses', () => {
  assert.deepEqual(Object.keys(contract.paths), ['/api/forecast']);
  assert.deepEqual(Object.keys(contract.paths['/api/forecast']), ['get']);
  assert.equal(OP.operationId, 'forecastRead');
  assert.equal(OP['x-halo-operation'], 'forecast.read');
  assert.deepEqual(productionOperations['forecast.read'], { path: '/api/forecast' }, 'a private GET in the registry (runtime.ts:72)');
  assert.deepEqual(Object.keys(OP.responses).sort(), ['200', '400', '401', '429', '500', '503']);
  assert.deepEqual(OP.parameters.map((p) => `${p.in}:${p.name}`), ['query:date', 'query:place', 'header:X-Halo-Home-Context']);
  assert.equal(JSON.stringify(contract).includes(EM_DASH), false, 'no U+2014 in the document');
});

test('the rulings the plan asks the document to carry: F12, F17, coverage, F21, and open_meteo_incomplete on the 503', async () => {
  const rulings = contract.info['x-halo-rulings'];
  assert.match(rulings.F12, /date-only.*inclusive.*local to `zone`/);
  assert.match(rulings.F17, /two meanings/);
  assert.match(rulings.F17, /initialisation time/);
  assert.match(rulings.F17, /time HALO answered/);
  assert.match(rulings.coverage, /Air, UV, Pollen and Weather/);
  for (const status of ['200', '400', '401', '429', '503']) assert.match(rulings.F21, new RegExp(status));
  assert.match(OP.responses['503'].description, /open_meteo_incomplete/);
  // The name is the builder's own token, and the builder really answers it.
  const source = await readFile(new URL('../lib/forecast/snapshot.js', import.meta.url), 'utf8');
  assert.match(source, /unavailable\('open_meteo_incomplete'\)/);
  const built = buildForecastSnapshot({
    place: { kind: 'home' }, date: FORECAST_DATE, now: FORECAST_NOW,
    openMeteo: { ok: true, timezone: 'America/New_York', model: 'ncep_gfs_global', runInitialisedAt: FORECAST_RUN, runAvailableAt: FORECAST_RUN, fetchedAt: new Date(FORECAST_NOW).toISOString(), hours: [] },
  });
  assert.equal(built.status, 503);
  assert.equal(built.reason, 'open_meteo_incomplete');
});

test('the snapshot schema has the frontend type\'s fields, without changedMessage, and the screen\'s four coverage rows', async () => {
  const sources = (await readFile(new URL('../components/production/WeekSources.tsx', import.meta.url), 'utf8')).split(/\r?\n/);
  const type = sources[10];
  assert.match(type, /^export type ForecastSnapshot=\{/, 'WeekSources.tsx:11 is the type');
  const fields = [...type.slice(type.indexOf('{') + 1).matchAll(/([A-Za-z]+)(\??):/g)].map(([, name, optional]) => `${name}${optional}`);
  assert.deepEqual(fields, ['periods', 'issuedAt', 'expiresAt', 'zone', 'source', 'version', 'horizonStart', 'horizonEnd', 'warningStatus', 'changedMessage?', 'coverage']);
  const snapshot = contract.components.schemas.ForecastSnapshot;
  assert.deepEqual(Object.keys(snapshot.properties), fields.filter((f) => !f.endsWith('?')));
  assert.deepEqual(snapshot.required, Object.keys(snapshot.properties));
  assert.equal(snapshot.additionalProperties, false, 'so a changedMessage would be refused (F19)');
  const coverage = contract.components.schemas.Coverage;
  assert.deepEqual(Object.keys(coverage.properties), ['Air', 'UV', 'Pollen', 'Weather']);
  assert.ok(fe.FRAGMENTS.some((f) => f.text === "['Air','UV','Pollen','Weather']"), 'the same list the screen renders, pinned by Task 7\'s drift test');
  const period = contract.components.schemas.ForecastPeriod;
  const evidenceSource = await readFile(new URL('../lib/frontend/week-evidence-preview.ts', import.meta.url), 'utf8');
  const periodType = evidenceSource.split(/\r?\n/).find((l) => l.startsWith('export type ForecastPeriod='));
  assert.deepEqual(Object.keys(period.properties), [...periodType.matchAll(/([A-Za-z]+):/g)].map(([, n]) => n));
});

test('the schemas refuse what the client or the screen cannot use', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  await screen(cw);
  const good = cw.last().body;
  const ok = schema('ForecastSnapshot');
  assert.equal(ok(good), true, ajv.errorsText(ok.errors));
  const broken = [
    ['a changedMessage', { ...good, changedMessage: 'x' }],
    ['a data key', { ...good, data: {} }],
    ['an object coverage value', { ...good, coverage: { ...good.coverage, Air: { text: 'x' } } }],
    ['a coverage row missing', { ...good, coverage: { Air: 'For your home area: x', UV: 'For your home area: x', Pollen: 'For your home area: x' } }],
    ['a coverage row not naming the place', { ...good, coverage: { ...good.coverage, UV: 'UV from the model.' } }],
    ['an offset-less period start', { ...good, periods: [{ ...good.periods[0], start: '2026-10-20T08:00' }] }],
    ['a numeric air', { ...good, periods: [{ ...good.periods[0], air: 41 }] }],
    ['U+2014 in the weather', { ...good, periods: [{ ...good.periods[0], weather: `clear ${EM_DASH} calm` }] }],
    ['an empty tradeoff', { ...good, periods: [{ ...good.periods[0], tradeoff: '' }] }],
    ['a datetime horizon', { ...good, horizonEnd: '2026-10-25T00:00:00Z' }],
    ['four periods', { ...good, periods: [...good.periods, good.periods[0]] }],
  ];
  for (const [label, body] of broken) assert.equal(ok(body), false, label);
  const envelope = schema('ErrorEnvelope');
  assert.equal(envelope({ error: 'x', code: 'upstream_unavailable', message: 'x', field_errors: [], retryable: true, request_id: REQUEST_ID, reason: 'open_meteo_http_500' }), false, 'no reason field');
});

// ---------------------------------------------------------------------------
// 2. The transcriptions: drift, and saying no
// ---------------------------------------------------------------------------

function stripped(t, sourceText) {
  let text = sourceText.split(/\r?\n/).slice(t.line - 1, t.line - 1 + t.lines).join('\n');
  for (const [from, to] of t.strip) {
    const at = text.indexOf(from);
    assert.ok(at >= 0 && text.indexOf(from, at + 1) < 0, `${t.file}:${t.line}: "${from}" occurs exactly once`);
    text = text.slice(0, at) + to + text.slice(at + from.length);
  }
  return text;
}
const transcribed = (t) => t.fn.toString().split('\n').slice(1, 1 + t.lines).join('\n');

test('drift: Task 9\'s transcribed lines equal the frontend source with only the recorded annotations removed', async () => {
  assert.equal(fe.TRANSCRIPTIONS_T9.length, 2);
  for (const t of fe.TRANSCRIPTIONS_T9) {
    const sourceText = await readFile(new URL(`../${t.file}`, import.meta.url), 'utf8');
    assert.equal(stripped(t, sourceText), transcribed(t), `${t.file}:${t.line} changed; re-transcribe it`);
    // A one-character change in the source is noticed.
    const lines = sourceText.split(/\r?\n/);
    const at = lines[t.line - 1].lastIndexOf(')');
    lines[t.line - 1] = `${lines[t.line - 1].slice(0, at)}) ${lines[t.line - 1].slice(at + 1)}`;
    assert.notEqual(stripped(t, lines.join('\n')), transcribed(t), `${t.file}:${t.line}: the comparison is exact`);
  }
});

test('drift: every Task 9 screen fragment occurs in its frontend line and in the transcription', async () => {
  for (const f of fe.FRAGMENTS_T9) {
    const lines = (await readFile(new URL(`../${f.file}`, import.meta.url), 'utf8')).split(/\r?\n/);
    const needle = f.source ?? f.text;
    assert.ok(needle.includes(f.text), 'a delimited source form contains its text');
    assert.ok(lines[f.line - 1].includes(needle), `${f.file}:${f.line} no longer contains ${needle}`);
    assert.ok(f.fn.toString().includes(f.text), `the transcription lacks ${f.text}`);
  }
});

/** The real home body, altered, handed to the client exactly as the network would. */
async function tampered(t, alter) {
  freezeClock(t);
  const cw = clientWorld(t);
  await screen(cw);
  const body = alter(structuredClone(cw.last().body));
  const runtime = createProductionRuntime({ identityId: cw.me.id, homeContextId: 'h', credential: async () => ({ identityId: cw.me.id, accessToken: cw.me.token }), fetcher: async () => Response.json(body) });
  const read = await fe.resourceRead(runtime, 'forecast.read', { date: FORECAST_DATE, place: '' }, serviceMessage);
  return decide(read, { date: FORECAST_DATE, place: '', period: 'Morning', now: Date.now(), acknowledged: '' });
}

test('the transcription says no: an offset-less start, an unparseable issuedAt and an invalid zone each show "could not be verified" and no periods', async (t) => {
  const cases = [
    ['an offset-less period start', (b) => ((b.periods[0].start = '2026-10-20T08:00:00'), b)],
    ['an unparseable issuedAt', (b) => ((b.issuedAt = 'Monday morning'), b)],
    ['an invalid zone', (b) => ((b.zone = 'Mars/Olympus_Mons'), b)],
  ];
  for (const [label, alter] of cases) {
    const s = await tampered(t, alter);
    assert.equal(s.live.data, null, label);
    assert.equal(s.live.error, UNVERIFIED, label);
    assert.deepEqual(s.notices.status, { loading: null, message: UNVERIFIED, retry: 'Retry forecast' }, `${label}: the error row with Retry forecast`);
    assert.deepEqual(s.periods, [], label);
    assert.equal(s.emptyMessage, copy.forecastUnavailable, label);
    assert.equal(s.text.sourceName, 'Unavailable', label);
    t.mock.timers.reset();
  }
});

test('an object coverage value passes the validator and breaks the render: the contract, not the validator, refuses it', async (t) => {
  const s = await tampered(t, (b) => ((b.coverage.Air = { text: 'For your home area: x' }), b));
  assert.equal(s.live.error, null, 'the validator checks only that coverage exists (WeekSources.tsx:15)');
  assert.notEqual(s.live.data, null);
  assert.equal(typeof s.text.coverage.Air, 'object', 'the screen would hand React an object');
  assert.throws(() => assertRenderable(s, 'object coverage'), /a React child the screen can render/);
  assert.equal(schema('ForecastSnapshot')(s.live.data), false, 'the schema refuses it');
});

// ---------------------------------------------------------------------------
// 3. The real handler, through the real runtime, to the screen
// ---------------------------------------------------------------------------

test('home, tomorrow: three periods in America/New_York, Issued with the model run, four home-area coverage cells, Source and NWS notices', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const s = await screen(cw);
  keep('forecastRead-home', 200, cw.last().body);
  assert.equal(s.live.error, null);
  assert.deepEqual(s.cards.map((c) => [c.name, c.from, c.to]), [['Morning', '08:00', '12:00'], ['Afternoon', '12:00', '17:00'], ['Evening', '17:00', '21:00']]);
  assert.equal(s.forecastZone, 'America/New_York');
  assert.equal(s.notices.issuedLine, 'Times in America/New_York. Issued Oct 19, 08:00.');
  for (const [row, cell] of Object.entries(s.text.coverage)) {
    assert.equal(typeof cell, 'string', row);
    assert.ok(cell.startsWith('For your home area:'), `${row}: ${cell}`);
  }
  assert.equal(s.text.sourceName, 'Open-Meteo, EPA AirNow and the National Weather Service, for your home area');
  assert.match(s.text.notices, /^No National Weather Service alerts are active for this area as of 16:07 EDT\./);
  assert.equal(s.text.horizon, '2026-10-19 through 2026-10-25');
  assert.equal(s.text.expiry, fe.forecastIssued(cw.last().body.expiresAt, 'America/New_York'));
  assert.equal(s.far, false);
  assert.equal(s.expired, false);
  assert.equal(s.changed, false);
  assert.equal(s.needsReview, false, 'no changedMessage, no review');
  assert.equal(s.notices.changedNotice, null);
  assert.equal(s.validation, '', 'the save check passes');
  for (const card of s.cards) {
    assert.equal(card.air, 'Unavailable', 'air is daily, never per period (C1)');
    assert.equal(card.pollen, 'Unavailable');
    assert.match(card.uv, /^\d+(\.\d)? UV index$/);
    assert.match(card.weather, /°F \(.*°C\)/);
    assert.equal(/%|chance/i.test(card.weather), false, 'rain is a modelled amount, never a chance');
  }
  assertRenderable(s, 'home');
  // The household's own profile, owner-scoped; the foreign X-Halo-Home-Context changed nothing.
  const reads = cw.h.db.queryLog.filter((q) => q.table === 'profiles');
  assert.equal(reads.length, 1);
  assert.deepEqual(cw.w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 }, 'four metadata reads per forecast');
  assert.deepEqual(cw.w.unexpected, []);
});

test('choosing Afternoon and saving: a B06 meta whose time and zone pass validActionSnapshot, and a reason with the period version and the source', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const s = await screen(cw, { period: 'Afternoon' });
  assert.equal(s.currentPeriod.name, 'Afternoon');
  const out = await save(s);
  assert.equal(out.nextMeta.time, '12:00');
  assert.equal(out.nextMeta.zone, 'America/New_York');
  assert.equal(out.nextMeta.duration, 60);
  assert.equal(validActionSnapshot(out.snapshot), true, 'B06 accepts the task this save produces (lib/actionRules.js)');
  assert.equal(out.item.reason, `Outdoor plan. Forecast ${s.currentPeriod.version}, ${s.text.sourceName}. Review conditions before going.`);
  assert.ok(out.item.reason.includes('Open-Meteo GFS run 2026-10-19T12Z'));
  assert.ok(out.nextMeta.history.at(-1).endsWith(`Outdoor plan saved. ${s.currentPeriod.version}.`));
  assert.deepEqual(out.sent.options.preferences.outdoorPlan, {
    key: s.draft.key, place: '', period: 'Afternoon', watchRequested: false,
    forecastVersion: s.live.data.version, forecastIssuedAt: FORECAST_RUN, forecastExpiresAt: s.live.data.expiresAt,
  });
  assert.equal(out.item.reason.includes(EM_DASH) || out.nextMeta.note.includes(EM_DASH), false);
});

test('trap 18: twelve keystrokes through the client settle on Charlotte with one provider round and one household token', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const keystrokes = ['C', 'Ch', 'Cha', 'Char', 'Charl', 'Charlo', 'Charlot', 'Charlott', 'Charlotte', 'Charlotte,', 'Charlotte, N', 'Charlotte, NC'];
  const shown = [];
  for (const place of keystrokes) {
    const s = await screen(cw, { place });
    assert.equal(s.live.error, null, place);
    assertRenderable(s, place);
    shown.push(s);
  }
  assert.deepEqual(cw.w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 });
  assert.deepEqual(cw.w.limits.filter((k) => k === `forecast:${cw.me.id}`), [`forecast:${cw.me.id}`], 'the household budget once');
  assert.equal(cw.w.limits.some((k) => k.startsWith('daily-score')), false);
  assert.equal(cw.w.unexpected.length, 0, 'never Mapbox or any other host');
  for (const s of shown.slice(0, 8)) assert.deepEqual(s.periods, [], `${s.draft.place}: nothing to plan on yet`);
  const settled = shown.at(-1);
  assert.equal(settled.cards.length, 3);
  assert.ok(settled.text.coverage.Weather.startsWith('For Charlotte, NC (Census internal point):'));
  assert.equal(settled.text.sourceName, 'Open-Meteo, EPA AirNow and the National Weather Service, for Charlotte, NC');
  for (const s of shown.slice(8)) assert.equal(s.selectionSignature.split(':')[0], settled.live.data.version, 'one forecast for every settled spelling');
});

test('"Freedom Park, Charlotte" plans on Charlotte, and coverage says so', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const s = await screen(cw, { place: 'Freedom Park, Charlotte' });
  keep('forecastRead-place', 200, cw.last().body);
  assert.equal(s.cards.length, 3);
  for (const cell of Object.values(s.text.coverage)) assert.ok(cell.startsWith('For Charlotte, NC'), cell);
  assert.equal(cw.h.db.queryLog.length, 0, 'a typed place reads no profile');
  assertRenderable(s, 'Freedom Park');
});

test('"Fairview" is ambiguous: the forecastUnavailable message, and coverage naming both candidates, with no provider call', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const s = await screen(cw, { place: 'Fairview' });
  keep('forecastRead-ambiguous', 200, cw.last().body);
  assert.deepEqual(s.periods, []);
  assert.equal(s.emptyMessage, 'Forecasts are unavailable for this place and date. Keep your plan and check official conditions before going.');
  for (const cell of Object.values(s.text.coverage)) {
    assert.ok(cell.includes('Fairview (Buncombe County), NC') && cell.includes('Fairview (Union County), NC'), cell);
  }
  assert.equal(s.text.notices, 'Warnings unavailable. Check the official site.');
  assert.equal(s.checkAgain, null);
  assert.deepEqual(cw.w.calls, []);
  assert.deepEqual(cw.w.limits, []);
  assertRenderable(s, 'Fairview');
});

test('no saved home and no place: the empty snapshot, not expired 23 hours later', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t, { as: 'carol' });
  const s = await screen(cw);
  keep('forecastRead-no-home', 200, cw.last().body);
  assert.deepEqual(s.periods, []);
  assert.equal(s.emptyMessage, copy.forecastUnavailable);
  assert.match(s.text.coverage.Weather, /^For your home area: No forecast was made\. No home location is saved\./);
  assert.deepEqual(cw.w.calls, []);
  const later = decide(s.read, { date: FORECAST_DATE, place: '', period: 'Morning', now: FORECAST_NOW + 23 * HOUR, acknowledged: '' });
  assert.equal(later.expired, false, 'F18: an empty answer lasts 24 hours');
  assert.equal(later.validation, '', 'so it never blocks a save in a day (frontend N2)');
  assertRenderable(s, 'no home');
});

test('a date past horizonEnd shows the future message and a check-again date; a past date shows forecastUnavailable', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const far = await screen(cw, { date: '2026-11-30' });
  keep('forecastRead-beyond-horizon', 200, cw.last().body);
  assert.equal(far.far, true);
  assert.deepEqual(far.periods, []);
  assert.equal(far.emptyMessage, copy.future);
  assert.equal(far.checkAgain, '2026-11-28');
  assert.equal(far.text.horizon, '2026-10-19 through 2026-10-25');
  const past = await screen(cw, { date: '2026-10-18' });
  keep('forecastRead-past-date', 200, cw.last().body);
  assert.equal(past.far, false);
  assert.deepEqual(past.periods, []);
  assert.equal(past.emptyMessage, copy.forecastUnavailable);
  assert.equal(past.checkAgain, null);
  assert.deepEqual(cw.w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 }, 'the horizon does not depend on the date');
  assertRenderable(far, 'far');
  assertRenderable(past, 'past');

  // F18 (controller ruling, Task 9): an answer with provider data but no periods expires 24 hours
  // out, like an empty one. Refresh forecast renders only with periods (WeekOutdoors.tsx:44), so a
  // 90-minute expiry would refuse the save with no way to refresh. Still saveable 23 hours later.
  for (const s of [far, past]) {
    const at = Date.parse(s.live.data.expiresAt);
    assert.equal(at, FORECAST_NOW + 24 * HOUR, `${s.draft.date}: 24 hours, not the 90 minutes of an answer with periods`);
    const later = decide(s.read, { date: s.draft.date, place: '', period: 'Morning', now: FORECAST_NOW + 23 * HOUR, acknowledged: '' });
    assert.equal(later.expired, false, s.draft.date);
    assert.notEqual(later.validation, copy.forecastExpired, `${s.draft.date}: never refused as an expired forecast`);
  }
  // The past date is refused for its own reason, as before; the far date saves.
  assert.equal(decide(far.read, { date: '2026-11-30', place: '', period: 'Morning', now: FORECAST_NOW + 23 * HOUR, acknowledged: '' }).validation, '');
  const withPeriods = await screen(cw);
  assert.equal(Date.parse(withPeriods.live.data.expiresAt), FORECAST_NOW + 90 * 60_000, 'an answer with periods keeps the 90 minutes');
});

test('F18: today after 21:00 local has no periods and also expires 24 hours out', async (t) => {
  const late = Date.parse('2026-10-20T01:30:00Z'); // 21:30 EDT on 2026-10-19
  freezeClock(t, late);
  const cw = clientWorld(t);
  const s = await screen(cw, { date: TODAY, now: late });
  assert.deepEqual(s.periods, []);
  assert.equal(s.live.data.expiresAt, new Date(late + 24 * HOUR).toISOString());
  assert.equal(s.emptyMessage, copy.forecastUnavailable);
});

test('AirNow category only: the Air card says Unavailable, the category is in coverage and in the tradeoff', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  cw.w.airnow = AIRNOW_ROWS.filter((row) => row.AQI === -1);
  const s = await screen(cw, { period: 'Afternoon' });
  keep('forecastRead-air-category-only', 200, cw.last().body);
  assert.equal(s.cards.length, 3);
  for (const card of s.cards) {
    assert.equal(card.air, 'Unavailable');
    assert.match(card.tradeoff, /PM2\.5 Moderate \(category only, no AQI number issued\)/);
  }
  assert.match(s.text.coverage.Air, /PM2\.5 Moderate \(category only, no AQI number issued\)/);
  assert.equal(/AQI \d/.test(s.text.coverage.Air), false, 'no number invented');
  assertRenderable(s, 'category only');
});

test('AirNow not connected (as in production today): no AirNow call, and Air coverage says air was not checked', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t, { airNow: false });
  const s = await screen(cw);
  keep('forecastRead-air-not-connected', 200, cw.last().body);
  assert.equal(cw.w.count('airnow'), 0);
  assert.match(s.text.coverage.Air, /Air was not checked/);
  assert.equal(s.text.sourceName, 'Open-Meteo and the National Weather Service, for your home area');
  assert.equal(s.cards.length, 3);
  assertRenderable(s, 'not connected');
});

test('Open-Meteo down: "This service is unavailable. Try again later." with Retry forecast, and Retry-After kept', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  cw.w.status.forecast = 500;
  let thrown;
  await cw.runtime.request('forecast.read', { date: FORECAST_DATE, place: '' }).catch((e) => { thrown = e; });
  assert.equal(thrown.code, 'unavailable');
  assert.equal(thrown.retryAfter, 60, 'runtime.ts:145 keeps Retry-After');
  keep('forecastRead-unavailable', 503, cw.last().body);
  const s = await screen(cw);
  assert.equal(s.live.error, UNAVAILABLE);
  assert.deepEqual(s.notices.status, { loading: null, message: UNAVAILABLE, retry: 'Retry forecast' });
  assert.deepEqual(s.periods, []);
  assert.equal(s.emptyMessage, copy.forecastUnavailable);
  assert.ok(cw.logs.includes('Forecast unavailable: open_meteo_http_500'), cw.logs.join('\n'));
});

test('while the run is unknown the last confirmed forecast is served stale: same version, saveable, expiring in 30 minutes', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const fresh = await screen(cw, { period: 'Afternoon' });
  const later = FORECAST_NOW + 2 * HOUR;
  t.mock.timers.setTime(later);
  _resetForecastCache(); // another instance: memory empty, the store (fake Upstash) kept
  gridsDisagree(cw.w);
  cw.w.reset();
  const s = await screen(cw, { period: 'Afternoon', now: later });
  keep('forecastRead-stale', 200, cw.last().body);
  assert.equal(cw.w.count('forecast'), 0, 'the unknown run is never fetched');
  assert.equal(s.notices.issuedLine, 'Times in America/New_York. Issued Oct 19, 08:00.', 'the served run keeps its own issue time (F17)');
  assert.equal(s.live.data.expiresAt, new Date(later + 30 * 60_000).toISOString());
  assert.match(s.text.coverage.Weather, /A newer model run is not yet confirmed, so this is the last confirmed run\./);
  assert.equal(s.selectionSignature, fresh.selectionSignature, 'no false "forecast changed"');
  assert.equal(s.expired, false);
  assert.equal(s.validation, '');
  assertRenderable(s, 'stale');
});

test('re-fetching unchanged data keeps selectionSignature, so no false "This plan or its forecast changed"', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const first = await screen(cw, { period: 'Afternoon' });
  for (const step of [20 * 60_000, HOUR]) {
    t.mock.timers.setTime(FORECAST_NOW + step);
    _resetForecastCache();
    cw.w.upstash.data.clear();
    cw.w.reset();
    const again = await screen(cw, { period: 'Afternoon', now: FORECAST_NOW + step });
    assert.equal(cw.w.count('forecast'), 1, `${step}: really fetched again`);
    assert.equal(again.selectionSignature, first.selectionSignature, `${step}: the same content keeps its version`);
    assert.equal(again.changed, false);
    assert.equal(again.needsReview, false);
  }
});

test('advancing the clock to expiresAt: expired, the Refresh forecast control, and the save check refuses', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  const s = await screen(cw, { period: 'Afternoon' });
  assert.equal(s.expired, false);
  assert.equal(s.notices.expiredNotice, null);
  const at = Date.parse(s.live.data.expiresAt);
  t.mock.timers.setTime(at);
  const expired = decide(s.read, { date: FORECAST_DATE, place: '', period: 'Afternoon', now: at, acknowledged: '' });
  assert.equal(expired.expired, true);
  assert.deepEqual(expired.notices.expiredNotice, { message: copy.forecastExpired, control: 'Refresh forecast' });
  assert.equal(expired.validation, copy.forecastExpired, 'validate refuses an expired forecast (WeekOutdoors.tsx:33)');
  const before = decide(s.read, { date: FORECAST_DATE, place: '', period: 'Afternoon', now: at - 1, acknowledged: '' });
  assert.equal(before.expired, false, 'one millisecond earlier it is still current');
});

test('the household budget spent: "Please wait before trying again." and a 429 with Retry-After', async (t) => {
  freezeClock(t);
  const cw = clientWorld(t);
  cw.w.decide = (key) => key !== `forecast:${cw.me.id}`;
  const s = await screen(cw);
  keep('forecastRead-rate-limited', 429, cw.last().body);
  assert.equal(cw.last().headers.get('retry-after'), '120');
  assert.equal(s.live.error, 'Please wait before trying again.');
  assert.deepEqual(s.notices.status, { loading: null, message: 'Please wait before trying again.', retry: 'Retry forecast' });
  assert.deepEqual(cw.w.calls, []);
});

test('the refusals the client maps: a bad date (400), no session (401), the session service down and an internal error', async (t) => {
  freezeClock(t);
  const bad = clientWorld(t);
  const invalid = await screen(bad, { date: '2026-02-30' });
  keep('forecastRead-validation', 400, bad.last().body);
  assert.equal(bad.last().body.field_errors[0].field, 'date');
  assert.equal(invalid.live.error, 'Check the highlighted information and try again.');
  assert.deepEqual(bad.w.calls, []);

  const longPlace = await screen(bad, { place: 'C'.repeat(101) });
  assert.equal(bad.last().status, 400);
  assert.equal(bad.last().body.field_errors[0].field, 'place');
  assert.equal(JSON.stringify(bad.last().body).includes('CCCC'), false, 'the place is not echoed');
  assert.equal(longPlace.live.error, 'Check the highlighted information and try again.');

  const anon = clientWorld(t, { token: 'not-a-session' });
  const unauth = await screen(anon);
  keep('forecastRead-unauthenticated', 401, anon.last().body);
  assert.equal(unauth.live.error, 'Please reconnect your session to continue.');

  const outage = clientWorld(t);
  outage.h.forceAuthOutage();
  const down = await screen(outage);
  keep('forecastRead-auth-unavailable', 503, outage.last().body);
  assert.equal(outage.last().body.code, 'auth_unavailable');
  assert.equal(down.live.error, UNAVAILABLE);

  const broken = clientWorld(t);
  const from = broken.h.db.from;
  broken.h.db.from = (name) => {
    if (name === 'profiles') throw Object.assign(new Error('contractsB10: boom'), { code: 'XX000' });
    return from(name);
  };
  const failed = await screen(broken);
  keep('forecastRead-internal-error', 500, broken.last().body);
  assert.equal(failed.live.error, UNAVAILABLE, 'a 500 on a read is unavailable (runtime.ts:144)');
  assert.equal(broken.logs.some((l) => l.includes('boom')), true, 'logged with its message');
});

// ---------------------------------------------------------------------------
// 4. The fixtures are what the handler produces
// ---------------------------------------------------------------------------

test('every fixture is the answer of the real handler in this file, and every answer kept as one has a fixture', async () => {
  if (WRITE_FIXTURES) {
    await mkdir(FIXTURE_DIR, { recursive: true });
    for (const [name, value] of produced) await writeFile(new URL(`${name}.json`, FIXTURE_DIR), `${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const names = fixtures.map((f) => f.name.replace(/\.json$/, '')).sort();
  assert.deepEqual(names, [...produced.keys()].sort(), 'the fixture set is the produced set');
  for (const fixture of fixtures) {
    const { name, ...stored } = fixture;
    assert.deepEqual(stored, produced.get(name.replace(/\.json$/, '')), `${name} is what the handler answers today`);
  }
});

test('no B10 fixture carries a secret, a token, the NWS contact, a provider URL or a real address', () => {
  assert.ok(fixtures.length >= 15, 'the fixtures were written');
  const forbidden = [
    /sk-[A-Za-z0-9]/, /Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/, /api[_-]?key/i, /secret/i, /password/i, /authorization/i,
    /FAKE-AIRNOW-KEY/, /forecast-ops@/, /@/, /supabase|upstash|redis|openrouter|mapbox|postgres|PGRST/i,
    /https?:\/\//, /latitude|longitude|35\.2\d|-80\.8\d/,
    /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/,
  ];
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture.body);
    for (const pattern of forbidden) assert.equal(pattern.test(serialized), false, `${fixture.name} matches ${pattern}`);
    assert.ok([REQUEST_ID, undefined].includes(fixture.body.request_id), `${fixture.name}: the synthetic request id`);
  }
});

// ---------------------------------------------------------------------------
// 5. Coverage of the document by what ran. Last: tests in a file run in order.
// ---------------------------------------------------------------------------

test('every documented status was produced by the real handler in this file', () => {
  assert.deepEqual([...seenStatuses].sort(), Object.keys(OP.responses).map(Number).sort());
});

test('every documented response header was really sent, and every documented request header was sent by the client', () => {
  for (const [status, seen] of seenHeaders) {
    for (const name of documentedHeaders(status)) {
      if (CHECKED_HEADERS.includes(name)) assert.ok(seen.has(name), `${status}: the contract documents ${name} but no response sent it`);
    }
  }
  assert.deepEqual([...sentHeaders].sort(), [...documentedParams].sort(), 'X-Halo-Home-Context, sent by runtime.ts:132');
});
