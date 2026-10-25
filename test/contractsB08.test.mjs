/**
 * B08 evidence.read: the executable contract, and conformance of the REAL handlers to it and to
 * the frontend's own consumption logic (B08 Task 6; docs/backend/plans/b08-evidence.md).
 *
 * HELD (ruling E25): GET /api/evidence and the profile's home_context are built and proved here,
 * but are not merged into the backend branch until the frontend's remount fix (YOUR_TODO.md
 * Part 4 items 24 and 25). The recorder cron is merged.
 *
 * The database is the real migration chain on PGlite. The recorder cron runs once, for real, over
 * seeded home contexts and recorded days, with the stand-in providers of
 * test/helpers/dailyMaximaProviders.mjs (any other host throws). Then every read travels the
 * client's whole path:
 *
 *   the profile          lib/frontend/stage-api.ts getProfile (run for real), and the context id
 *                        lines of components/production/ProductionApp.tsx:41-42 (transcribed,
 *                        drift-checked);
 *   the request          the real createProductionRuntime (lib/frontend/production/runtime.ts),
 *                        whose fetcher is the real route handler: query encoding, status mapping
 *                        and envelope unwrap are the client's own;
 *   the hook             useProductionResource (ProductionContext.tsx:9,14, transcribed as
 *                        resourceRead in test/helpers/frontendB10.mjs, drift-checked by
 *                        contractsB10) and the validator of WeekSources.tsx:7-9 (frontendB08.mjs,
 *                        drift-checked below);
 *   the analysis         the real analyzeHistory, readingLabel, seasonBounds and dayAdd;
 *   the screen           Trend, Patterns and Season decisions of WeekEvidence.tsx, transcribed in
 *                        frontendB08.mjs with a fragment drift test below.
 *
 * Each scenario ends in what the screen shows. Every answer a handler gives in this file is
 * checked against docs/backend/contracts/b08.openapi.json, for the X-Request-Id echo, a bare body
 * and no U+2014. Fixtures under docs/backend/contracts/fixtures/b08/ are the handlers' own answers
 * here (fixed clock, synthetic ids, request id b08-contract-0001); rewrite them after a deliberate
 * contract change with `node test/contractsB08.test.mjs --write-b08-fixtures`.
 */
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';
import { providers } from './helpers/dailyMaximaProviders.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import * as fe from './helpers/frontendB08.mjs';
import { resourceRead } from './helpers/frontendB10.mjs';

const { MISSING, SOURCE_LABELS, NOT_RECORDED_SOURCE, localDaySlots } = await import('../lib/dailyMaxima.js');
const { createLiveStageApi } = await loadFrontend('stage-api');
const { isProfileComplete } = await loadFrontend('onboarding');
const { createProductionRuntime, serviceMessage, productionOperations } = await loadFrontend('production/runtime');
const evidence = await loadFrontend('week-evidence-preview');
const { dayAdd } = await loadFrontend('week-preview');
const { lunaCalendarAnchor } = await loadFrontend('luna-tools-preview');
const copy = evidence.weekEvidenceCopy;

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const BASE = 'https://halo.test/contracts/';
const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b08.openapi.json', import.meta.url), 'utf8'));
const b01 = JSON.parse(await readFile(new URL('../docs/backend/contracts/b01.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: `${BASE}b01.openapi.json`, components: b01.components });
ajv.addSchema({ $id: `${BASE}b08.openapi.json`, components: contract.components });
const compiled = new Map();
function schemaFor(ref) {
  if (!compiled.has(ref)) compiled.set(ref, ajv.compile({ $ref: `${BASE}b08.openapi.json${ref}` }));
  return compiled.get(ref);
}
const OPERATIONS = {
  evidenceRead: contract.paths['/api/evidence'].get,
  profileRead: contract.paths['/api/profile'].get,
  dailyMaximaRecord: contract.paths['/api/cron/daily-maxima'].get,
};
const responseOf = (operationId, status) => {
  const response = OPERATIONS[operationId].responses[String(status)];
  assert.ok(response, `${operationId}: undocumented status ${status}`);
  return response.$ref ? contract.components.responses[response.$ref.split('/').at(-1)] : response;
};
function validate(operationId, status, body) {
  const check = schemaFor(responseOf(operationId, status).content['application/json'].schema.$ref);
  assert.equal(check(body), true, `${operationId} ${status}: ${ajv.errorsText(check.errors)}`);
}

const FIXTURE_DIR = new URL('../docs/backend/contracts/fixtures/b08/', import.meta.url);
const WRITE_FIXTURES = process.argv.includes('--write-b08-fixtures');
const fixtures = existsSync(FIXTURE_DIR)
  ? await Promise.all((await readdir(FIXTURE_DIR)).filter((n) => n.endsWith('.json')).sort()
    .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8')) })))
  : [];

const EM_DASH = String.fromCharCode(0x2014);
const REQUEST_ID = 'b08-contract-0001';
const NOW = new Date('2026-11-10T17:00:00Z'); // 12:00 in New York, EST
const TODAY = '2026-11-10';
const RECORDING_FROM = '2026-09-01';
const DST_DAY = '2026-11-01'; // 25 hours in New York
const GAP_DAY = '2026-10-15';
const RECORDED_BY_CRON = ['2026-11-07', '2026-11-08', '2026-11-09'];
const UNVERIFIED = 'History could not be verified.';
const UNAVAILABLE = 'This service is unavailable. Try again later.';
const REVIEW_IDLE = Object.freeze({ history: 'unavailable' });
const CRON_SECRET = 'cron-secret-for-tests';

// The harness gives alice, bob and dave these ids, in order.
const ID = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ALICE_HOME = 'a11ce000-0808-4000-8000-000000000001';
const ALICE_EARLIER_HOME = 'a11ce000-0808-4000-8000-000000000009';
const BOB_HOME = 'b0b00000-0808-4000-8000-000000000001';
const CONCORD = { lat: 35.409, lng: -80.58 };
const RALEIGH = { lat: 35.78, lng: -78.64 };
const FOREIGN_VALUE = 777; // stored only for homes alice must never see

const ordinal = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const AIR = (date) => 20 + (ordinal(date) % 40);
const UV = (date) => Math.round((1 + (ordinal(date) % 9) * 0.7) * 10) / 10;
const datesFrom = (from, to) => { const out = []; for (let d = from; d <= to; d = dayAdd(d, 1)) out.push(d); return out; };

function assertBare(body, label) {
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), `${label}: an object body`);
  assert.equal(Object.hasOwn(body, 'data'), false, `${label}: no top-level data key (runtime.ts:149-153)`);
  const text = JSON.stringify(body);
  assert.equal(text.includes(EM_DASH), false, `${label}: no U+2014`);
  assert.equal(text.toLowerCase().includes('\\u2014'), false, `${label}: no escaped U+2014`);
}

for (const fixture of fixtures) {
  test(`B08 fixture: ${fixture.name}`, () => {
    assert.ok(Object.hasOwn(OPERATIONS, fixture.operationId), fixture.operationId);
    validate(fixture.operationId, fixture.status, fixture.body);
    assertBare(fixture.body, fixture.name);
  });
}

// ---------------------------------------------------------------------------
// Recording what ran: statuses, fixtures
// ---------------------------------------------------------------------------

const seen = { evidenceRead: new Set(), profileRead: new Set(), dailyMaximaRecord: new Set() };
const produced = new Map();
function keep(name, operationId, status, body) {
  const value = { operationId, status, body };
  if (produced.has(name)) assert.deepEqual(value, produced.get(name), `${name} was produced twice, differently`);
  produced.set(name, value);
}

/** Checks one raw answer against the document, before any client code sees it. */
async function check(operationId, res) {
  const body = await res.clone().json();
  seen[operationId].add(res.status);
  validate(operationId, res.status, body);
  assertBare(body, `${operationId} ${res.status}`);
  const documented = Object.keys(responseOf(operationId, res.status).headers ?? {}).map((n) => n.toLowerCase());
  if (documented.includes('x-request-id')) assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${operationId} ${res.status}: the request id is echoed`);
  if (res.status >= 400 && body.request_id !== undefined) assert.equal(body.request_id, REQUEST_ID);
  if (operationId === 'evidenceRead' && res.status === 200) assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('retry-after') !== null, body.code === 'auth_unavailable', `${operationId} ${res.status}: Retry-After only on the auth outage`);
  if (res.status >= 400) {
    assert.equal(/supabase|postgres|PGRST|57014|statement|35\.4|-80\.5|a11ce|b0b00/i.test(JSON.stringify(body)), false, `${operationId} ${res.status}: nothing proof-bearing in an error`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// The database: the real migrations, seeded maxima, and one real recorder run
// ---------------------------------------------------------------------------

let pdb;
let cronRun;
const PG_TABLES = new Set(['home_contexts', 'daily_maxima', 'daily_maxima_recorder']);

const stored = (profile, context, date, factor, value, extra = {}) => ({
  profile_id: profile, home_context_id: context, local_date: date, factor, value,
  unit: factor === 'air' ? 'AQI' : 'UV index',
  source_code: factor === 'air' ? 'open_meteo_cams' : 'open_meteo_forecast', station_id: null,
  method_version: 'daily-max-v1', time_zone: 'America/New_York',
  hours_expected: localDaySlots(date).length, hours_observed: localDaySlots(date).length,
  missing_code: null, retrieved_at: '2026-11-01T12:00:00Z', ...extra,
});

async function callDb(sql, params) {
  try {
    return await pdb.asService(async (tx) => (await tx.query(sql, params)).rows[0].result, { commit: true });
  } catch (error) {
    throw rpcError(error.code, error.message, error.detail ?? null);
  }
}

/** The recorder's service-role client over this database (as dailyMaximaRecorderDb.test.mjs). */
function recorderClient({ functions = true, failContexts = false } = {}) {
  return {
    from(name) {
      if (!['home_contexts', 'daily_maxima'].includes(name)) throw new Error(`the recorder read ${name}`);
      if (failContexts && name === 'home_contexts') {
        const chain = { select: () => chain, is: () => chain, gt: () => chain, order: () => chain, limit: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) };
        return chain;
      }
      return pgliteSelect(pdb, name);
    },
    async rpc(name, args) {
      const sql = {
        begin_daily_maxima_run: ['select public.begin_daily_maxima_run(p_first_day => $1)::text as result', 'p_first_day'],
        record_daily_maxima: ['select public.record_daily_maxima(p_rows => $1::jsonb) as result', 'p_rows'],
        finish_daily_maxima_run: ['select public.finish_daily_maxima_run(p_counts => $1::jsonb)::text as result', 'p_counts'],
      }[name];
      if (!sql || !functions) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
      try {
        const value = args[sql[1]];
        return { data: await callDb(sql[0], [typeof value === 'object' ? JSON.stringify(value) : value]), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

/** One call of the real cron route, its client the recorder client above. */
async function cron({ headers = { authorization: `Bearer ${CRON_SECRET}`, 'x-request-id': REQUEST_ID }, method = 'GET', ...client } = {}) {
  const p = providers({ stations: [] });
  const h = createRouteHarness({ fetch: p.fetch, env: { CRON_SECRET, AIRNOW_API_KEY: 'airnow-key-not-real' } });
  const c = recorderClient(client);
  h.db.from = (name) => c.from(name);
  h.db.rpc = (name, args) => c.rpc(name, args);
  const res = await h.call('/api/cron/daily-maxima', method, { headers });
  const body = await check('dailyMaximaRecord', res);
  return { res, body, p };
}

before(async () => {
  pdb = await createDb();
  // PostgREST answers timestamps in the database's zone (UTC on Supabase); pin it, so a fixture
  // does not depend on the machine's zone.
  await pdb.exec(`set time zone 'UTC';`);
  await pdb.exec(`insert into auth.users (id, is_anonymous) values ('${ID(1)}', true), ('${ID(2)}', true), ('${ID(3)}', true);`);
  await pdb.query(
    `insert into public.home_contexts (id, profile_id, sequence, revision, origin, lat, lng, county, state, water_source, effective_from, effective_to, closed_reason) values
      ($1, $4, 1, 7, 'onboard', 35.227, -80.843, 'Mecklenburg County', 'NC', 'well', '2026-01-01T12:00:00Z', '2026-06-01T12:00:00Z', 'moved'),
      ($2, $4, 2, 3, 'move', ${CONCORD.lat}, ${CONCORD.lng}, 'Cabarrus County', 'NC', 'utility', '2026-06-01T12:00:00Z', null, null),
      ($3, $5, 1, 1, 'onboard', ${RALEIGH.lat}, ${RALEIGH.lng}, 'Wake County', 'NC', 'utility', '2026-06-01T12:00:00Z', null, null)`,
    [ALICE_EARLIER_HOME, ALICE_HOME, BOB_HOME, ID(1), ID(2)],
  );
  const rows = [];
  for (const date of datesFrom(RECORDING_FROM, '2026-11-06')) {
    if (date === GAP_DAY) {
      rows.push(stored(ID(1), ALICE_HOME, date, 'air', null, { missing_code: 'source_gap', hours_observed: 12 }));
      rows.push(stored(ID(1), ALICE_HOME, date, 'uv', null, { missing_code: 'source_gap', hours_observed: 12 }));
      continue;
    }
    rows.push(stored(ID(1), ALICE_HOME, date, 'air', AIR(date)), stored(ID(1), ALICE_HOME, date, 'uv', UV(date)));
  }
  // Bob's own maxima on alice's dates, and the earlier home's maxima kept as history.
  for (const date of ['2026-10-20', '2026-10-21', '2026-11-05']) {
    rows.push(stored(ID(2), BOB_HOME, date, 'air', FOREIGN_VALUE), stored(ID(2), BOB_HOME, date, 'uv', FOREIGN_VALUE / 100));
  }
  await pdb.asService(async (tx) => {
    await tx.query('select public.begin_daily_maxima_run($1)', [RECORDING_FROM]);
    const out = await tx.query('select public.record_daily_maxima($1::jsonb) as r', [JSON.stringify(rows)]);
    assert.equal(out.rows[0].r.inserted, rows.length, JSON.stringify(out.rows[0].r));
  }, { commit: true });

  // The recorder, for real, at NOW: it records 2026-11-07 to 2026-11-09 for both homes.
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    cronRun = await cron();
  } finally {
    mock.timers.reset();
  }
});
after(async () => { await pdb?.close(); });

// ---------------------------------------------------------------------------
// The client world
// ---------------------------------------------------------------------------

const freeze = (t) => t.mock.timers.enable({ apis: ['Date'], now: NOW });

/**
 * The route harness for the profile and evidence routes: the profile tables are the fake's,
 * home_contexts and the daily maxima tables are PGlite's (`before0016` leaves them out, so the
 * home context read is PGRST205), and the probe calls the real daily_maxima_schema_version.
 */
function world({ before0016 = false, probe = 'real' } = {}) {
  const tables = before0016 ? ['profiles', 'household_bands', 'daily_maxima', 'daily_maxima_recorder'] : ['profiles', 'household_bands', 'home_contexts', 'daily_maxima', 'daily_maxima_recorder'];
  const h = createRouteHarness({
    identities: { alice: {}, bob: {}, dave: {} },
    tables: haloTables(...tables),
    seed: ({ alice, bob, dave }) => ({
      profiles: [
        { id: alice.id, county: 'Cabarrus County', state: 'NC', zip: '28025', pwsid: 'NC0113010', ...CONCORD, water_source: 'utility', home_year: 1975, renter_mode: false, locale: 'en' },
        { id: bob.id, county: 'Wake County', state: 'NC', zip: '27601', pwsid: 'NC0392010', ...RALEIGH, water_source: 'utility', home_year: 2001, renter_mode: false, locale: 'en' },
        // dave is located and onboarded but has no home context.
        { id: dave.id, county: 'Union County', state: 'NC', zip: '28110', pwsid: 'NC0129010', lat: 35.1, lng: -80.6, water_source: 'well', home_year: 1990, renter_mode: false, locale: 'en' },
      ],
      household_bands: [],
    }),
  });
  assert.deepEqual([h.identities.alice.id, h.identities.bob.id, h.identities.dave.id], [ID(1), ID(2), ID(3)]);
  const fakeFrom = h.db.from;
  h.db.from = (name) => {
    if (name === 'daily_scores') throw new Error('daily_scores is never read (E1)');
    return PG_TABLES.has(name) && !before0016 ? pgliteSelect(pdb, name, h.db.queryLog) : fakeFrom(name);
  };
  if (probe === 'real') {
    h.db.registerRpc('daily_maxima_schema_version', () => pdb.asService(async (tx) => (await tx.query('select public.daily_maxima_schema_version() as v')).rows[0].v), { args: [] });
  } else if (probe === 'fake') {
    h.db.registerRpc('daily_maxima_schema_version', () => 1, { args: [] });
  } else if (probe === 'timeout') {
    h.db.registerRpc('daily_maxima_schema_version', () => { throw rpcError('57014', 'canceling statement due to statement timeout'); }, { args: [] });
  }
  return h;
}

// F: components/production/ProductionApp.tsx:41-42, verbatim (leading space trimmed).
const HOME_ID_LINE = 'const homeId=session.profile?.home_context?.id??session.profile?.profile?.home_context_id??null;';
const REVISION_LINE = 'const currentContextRevision=session.profile?.home_context?.revision??session.profile?.profile?.context_revision;';
const derive = new Function('session', `${HOME_ID_LINE}\n${REVISION_LINE}\nreturn { homeId, currentContextRevision };`);

/** The client as it runs for one identity: the live profile read, the context id, the real runtime. */
async function client(h, as, { token, homeContextId } = {}) {
  const identity = h.identities[as];
  const bearer = token ?? identity.token;
  const answers = [];
  const auth = {
    async ensureAnonSession() {},
    async getUserId() { return identity.id; },
    async authedFetch(url, init = {}) {
      const res = await h.call(url.split('?')[0], init.method ?? 'GET', { url, headers: { ...init.headers, authorization: `Bearer ${bearer}`, 'x-request-id': REQUEST_ID } });
      answers.push({ operationId: 'profileRead', status: res.status, body: await check('profileRead', res) });
      return res;
    },
  };
  let profile = null;
  let profileError = null;
  try {
    profile = await createLiveStageApi({ loadAuth: async () => auth }).getProfile();
  } catch (error) {
    profileError = error;
  }
  const derived = profile ? derive({ profile }) : { homeId: null, currentContextRevision: undefined };
  const sent = [];
  const runtime = createProductionRuntime({
    identityId: identity.id,
    homeContextId: homeContextId === undefined ? derived.homeId : homeContextId,
    contextRevision: derived.currentContextRevision,
    credential: async () => ({ identityId: identity.id, accessToken: bearer }),
    fetcher: async (url, init) => {
      assert.match(url, /^\/api\/evidence\?kind=history&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/, 'the registry path with the hook\'s three keys (runtime.ts:73,125-128)');
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      sent.push({ url, headers: init.headers });
      const res = await h.call('/api/evidence', 'GET', { url, headers: { ...init.headers, 'x-request-id': REQUEST_ID } });
      answers.push({ operationId: 'evidenceRead', status: res.status, body: await check('evidenceRead', res) });
      return res;
    },
  });
  const last = (operationId) => answers.filter((a) => a.operationId === operationId).at(-1);
  return { identity, profile, profileError, runtime, sent, answers, last };
}

/** The hook: useProductionResource's read, then useProductionHistory's validator, plus `production`. */
async function history(c, range) {
  const read = await resourceRead(c.runtime, 'evidence.read', { kind: 'history', ...range }, serviceMessage);
  return { ...fe.productionHistory(read, c.runtime), production: true };
}

/** Patterns as it renders for one factor and selected day. */
function patterns(live, entries, { factor = 'Air', selected = TODAY, range = 84, group = 'household' } = {}) {
  const today = lunaCalendarAnchor();
  const view = fe.patternsView({ live, entries, today, range, group, factor, selected, review: REVIEW_IDLE, analyzeHistory: evidence.analyzeHistory, dayAdd, historyFixture: evidence.historyFixture, copy });
  return { ...view, trend: fe.trendView(view.report.rows, live.data?.comparison), sources: fe.sourceDetails(view.report.rows) };
}

async function season(c, entries, { season: name, year, factor = 'Air' }) {
  const today = lunaCalendarAnchor();
  const range = fe.seasonRange({ season: name, year, today, seasonBounds: evidence.seasonBounds });
  const live = await history(c, range.request);
  const view = fe.seasonView({ live, entries, today, range, group: 'household', factor, review: REVIEW_IDLE, analyzeHistory: evidence.analyzeHistory, historyFixture: evidence.historyFixture });
  return { range, live, ...view, trend: fe.trendView(view.report.rows, live.data?.comparison) };
}

const checkin = (date, fine, homeContextId = ALICE_HOME) => ({ id: `journal:${date}:household`, date, band: 'household', fine, symptoms: fine ? [] : ['Cough'], severity: fine ? '' : 'mild', illness: false, recalled: false, homeContextId });
const SYMPTOM_DAYS = ['2026-10-20', '2026-10-21', '2026-10-22'];
const FINE_DAYS = ['2026-10-23', '2026-10-24', '2026-10-25'];
const ENTRIES = [
  ...SYMPTOM_DAYS.map((d) => checkin(d, false)),
  ...FINE_DAYS.map((d) => checkin(d, true)),
  checkin('2026-08-25', false), // before recording_from: logged, never comparable
  checkin('2026-10-26', false, ALICE_EARLIER_HOME), // saved at the earlier home: not this home's
];
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

// ---------------------------------------------------------------------------
// 1. The document, the registry and the transcriptions
// ---------------------------------------------------------------------------

test('the contract is b08-1, documents evidence.read at the registry path, and states the E25 hold', () => {
  assert.equal(contract.info.version, 'b08-1');
  assert.deepEqual(productionOperations['evidence.read'], { path: '/api/evidence' }, 'a private GET in the registry (runtime.ts:73)');
  assert.equal(OPERATIONS.evidenceRead['x-halo-operation'], 'evidence.read');
  assert.equal(OPERATIONS.evidenceRead['x-halo-held'], 'E25');
  assert.equal(OPERATIONS.profileRead['x-halo-held'], 'E25');
  assert.match(contract.info.description, /HELD \(ruling E25\)/);
  assert.match(contract.info['x-halo-rulings'].E20, /MISSING home_context key means migration 0016 is not applied or the context read failed/);
  assert.deepEqual(contract.paths['/api/evidence'].get.parameters.filter((p) => p.in === 'query').map((p) => p.name), ['kind', 'from', 'to']);
  for (const [registryOp, endpoint] of Object.entries(productionOperations)) {
    if (registryOp !== 'evidence.read') continue;
    const file = path.join(REPO_ROOT, 'app', ...endpoint.path.split('/').filter(Boolean), 'route.js');
    assert.ok(existsSync(file), `${endpoint.path} resolves to a route file`);
    assert.match(readFileSync(file, 'utf8'), new RegExp(`export async function ${endpoint.method ?? 'GET'}\\(`), 'with the declared method');
  }
  const cronSource = readFileSync(path.join(REPO_ROOT, 'app/api/cron/daily-maxima/route.js'), 'utf8');
  for (const method of ['GET', 'POST']) assert.match(cronSource, new RegExp(`export async function ${method}\\(`));
  assert.match(cronSource, /export const maxDuration = 60;/);
  assert.match(readFileSync(path.join(REPO_ROOT, 'app/api/profile/route.js'), 'utf8'), /export async function GET\(/);
  assert.equal(JSON.stringify(contract).includes(EM_DASH), false, 'no U+2014 in the document');
});

/** The frontend text for one TRANSCRIPTIONS entry, with its recorded annotations removed. */
function stripped(t, sourceText) {
  const lines = sourceText.split(/\r?\n/);
  let text = lines.slice(t.line - 1, t.line - 1 + t.lines).join('\n');
  for (const [from, to] of t.strip) text = text.replace(from, to);
  if (t.before !== undefined) assert.equal(lines[t.line - 2], t.before, `${t.file}:${t.line - 1} is the hook's evidence.read call`);
  return text;
}

test('drift: the validator is WeekSources.tsx:7-9 as it reads now, and the context id lines are ProductionApp.tsx:41-42', () => {
  const t = fe.TRANSCRIPTIONS.find((entry) => entry.fn === fe.productionHistory);
  const source = readFileSync(path.join(REPO_ROOT, t.file), 'utf8');
  assert.equal(stripped(t, source), fe.productionHistory.toString().split('\n').slice(1, -1).join('\n'), 'WeekSources.tsx changed; re-transcribe it');
  const app = readFileSync(path.join(REPO_ROOT, 'components/production/ProductionApp.tsx'), 'utf8').split('\n').map((line) => line.trim());
  assert.equal(app[40], HOME_ID_LINE);
  assert.equal(app[41], REVISION_LINE);
});

test('drift: every WeekEvidence.tsx fragment occurs in its frontend line and in the transcription', () => {
  const lines = readFileSync(path.join(REPO_ROOT, 'components/expanded/WeekEvidence.tsx'), 'utf8').split(/\r?\n/);
  assert.ok(fe.FRAGMENTS_T6.length >= 30);
  for (const f of fe.FRAGMENTS_T6) {
    assert.ok(f.fn.toString().includes(f.text), `${f.fn.name}: the transcription holds ${f.text.slice(0, 60)}`);
    assert.ok(lines[f.line - 1].includes(f.source ?? f.text), `${f.file}:${f.line} still reads ${(f.source ?? f.text).slice(0, 60)}`);
  }
  // A one-character change to the screen is seen.
  const changed = lines[25].replace('r.version===comparison.version', 'r.version==comparison.version');
  assert.equal(changed.includes(fe.FRAGMENTS_T6.find((f) => f.line === 26).text), false);
});

test('the transcribed validator says no to what the client says no to', () => {
  const runtime = { homeContextId: ALICE_HOME };
  const row = { date: '2026-10-20', factor: 'Air', value: 32, unit: 'AQI', source: SOURCE_LABELS.open_meteo_cams, issued: 'Unknown', basis: 'daily maximum', context: ALICE_HOME, version: 'daily-max-v1' };
  const body = (patch = {}, rowPatch = {}) => ({ rows: [{ ...row, ...rowPatch }], comparison: { context: ALICE_HOME, basis: 'daily maximum', version: 'daily-max-v1' }, complete: true, ...patch });
  assert.equal(fe.productionHistory({ data: body(), error: null }, runtime).error, null);
  for (const bad of [
    body({ comparison: { context: ALICE_HOME, basis: 'app-time observation', version: 'daily-max-v1' } }),
    body({ comparison: { context: ALICE_EARLIER_HOME, basis: 'daily maximum', version: 'daily-max-v1' } }),
    body({}, { value: '32' }),
  ]) {
    const shown = fe.productionHistory({ data: bad, error: null }, runtime);
    assert.equal(shown.data, null);
    assert.equal(shown.error, UNVERIFIED);
  }
});

// ---------------------------------------------------------------------------
// 2. The recorder's answer, and what it wrote
// ---------------------------------------------------------------------------

test('the recorder cron answers counts only, and the days it recorded are served', async (t) => {
  assert.equal(cronRun.res.status, 200);
  keep('dailyMaximaRecord-run', 'dailyMaximaRecord', 200, cronRun.body);
  const counts = cronRun.body;
  assert.equal(counts.ok, true);
  assert.equal(counts.stopped, null);
  assert.equal(counts.contexts, 2, 'the two current homes');
  assert.equal(counts.inserted, 2 * 3 * 2, 'two homes, three days, Air and UV');
  assert.equal(counts.refused, 0);
  assert.equal(cronRun.p.calls.every((c) => ['www.airnowapi.org', 'api.open-meteo.com', 'air-quality-api.open-meteo.com'].includes(c.host)), true);
  for (const value of Object.values(counts)) assert.ok(value === true || value === null || Number.isInteger(value), 'counts, never an id, a point or a value');
  assert.equal(/a11ce|b0b00|35\.\d|-80\.\d|-78\.\d/.test(JSON.stringify(counts)), false);

  freeze(t);
  const c = await client(world(), 'alice');
  const live = await history(c, { from: '2026-11-06', to: TODAY });
  for (const date of RECORDED_BY_CRON) {
    const air = live.data.rows.find((r) => r.date === date && r.factor === 'Air');
    const uv = live.data.rows.find((r) => r.date === date && r.factor === 'UV');
    assert.equal(typeof air.value, 'number', `${date}: Air recorded by the cron`);
    assert.equal(air.source, SOURCE_LABELS.open_meteo_cams, 'the home stays modeled (E8)');
    assert.equal(typeof uv.value, 'number');
    assert.equal(uv.source, SOURCE_LABELS.open_meteo_forecast);
  }
});

test('the recorder: 401 without the secret, 503 before 0025, 500 on a database failure', async (t) => {
  freeze(t);
  const unauthorized = await cron({ headers: {} });
  assert.equal(unauthorized.res.status, 401);
  assert.equal(unauthorized.p.calls.length, 0);
  keep('dailyMaximaRecord-unauthorized', 'dailyMaximaRecord', 401, unauthorized.body);

  const missing = await cron({ functions: false, method: 'POST' });
  assert.equal(missing.res.status, 503);
  assert.equal(missing.body.code, 'feature_unavailable');
  assert.equal(missing.body.retryable, false);
  assert.equal(missing.p.calls.length, 0, 'no provider is called');
  keep('dailyMaximaRecord-feature-unavailable', 'dailyMaximaRecord', 503, missing.body);

  const logged = muteConsoleError(t);
  const failed = await cron({ failContexts: true });
  assert.equal(failed.res.status, 500);
  assert.equal(failed.body.code, 'internal_error');
  assert.equal(failed.p.calls.length, 0);
  keep('dailyMaximaRecord-internal-error', 'dailyMaximaRecord', 500, failed.body);
  logged.mock.restore();
});

// ---------------------------------------------------------------------------
// 3. Through the client: the profile, the read, the screen
// ---------------------------------------------------------------------------

test('the profile gives the runtime its context id, and the evidence read through that runtime validates', async (t) => {
  freeze(t);
  const h = world();
  const c = await client(h, 'alice');
  assert.equal(isProfileComplete(c.profile), true);
  assert.equal(c.profile.home_context.id, ALICE_HOME);
  assert.equal(c.profile.home_context.revision, 3);
  assert.equal(c.runtime.homeContextId, ALICE_HOME);
  keep('profileRead-home-context', 'profileRead', 200, c.last('profileRead').body);

  const live = await history(c, fe.patternsRequest(lunaCalendarAnchor(), dayAdd));
  assert.equal(live.error, null);
  assert.ok(live.data);
  assert.equal(c.sent[0].headers['X-Halo-Home-Context'], ALICE_HOME, 'sent by the runtime; ignored by the route');
  // Cross-route: the profile's id, comparison.context and every row's context are one id.
  assert.equal(live.data.comparison.context, c.profile.home_context.id);
  assert.ok(live.data.rows.every((r) => r.context === c.profile.home_context.id));
  assert.equal(live.data.rows.length, 84 * 4);
  assert.deepEqual([live.data.rows[0].date, live.data.rows.at(-1).date], [dayAdd(TODAY, -83), TODAY]);
  assert.equal(JSON.stringify(live.data).includes(String(FOREIGN_VALUE)), false, 'bob\'s maxima are not alice\'s');
  for (const id of [BOB_HOME, ALICE_EARLIER_HOME]) assert.equal(JSON.stringify(live.data).includes(id), false);
  assert.deepEqual(h.blockedFetches, [], 'no outbound call from the read');

  // A foreign home context header (bob's home, or alice's earlier one) changes nothing (E11).
  for (const header of [BOB_HOME, ALICE_EARLIER_HOME]) {
    const url = c.sent[0].url;
    const res = await h.call('/api/evidence', 'GET', { as: 'alice', url, headers: { 'X-Halo-Home-Context': header, 'x-request-id': REQUEST_ID } });
    assert.deepEqual(await check('evidenceRead', res), live.data);
  }
});

test('Patterns: three symptom and three fine days give a descriptive comparison of Air and of UV', async (t) => {
  freeze(t);
  const c = await client(world(), 'alice');
  const live = await history(c, fe.patternsRequest(lunaCalendarAnchor(), dayAdd));

  const air = patterns(live, ENTRIES, { factor: 'Air', selected: '2026-10-20' });
  assert.equal(air.busy, false);
  assert.equal(air.unavailable, null, 'no "Environmental history is unavailable."');
  assert.equal(air.report.enough, true);
  assert.equal(air.report.comparable, 6);
  assert.equal(air.report.logged, 7, 'the earlier home\'s check-in is not this home\'s');
  assert.equal(air.report.missing, 1, 'the check-in before recording_from has no compatible reading');
  assert.equal(air.report.symptomMean, mean(SYMPTOM_DAYS.map(AIR)));
  assert.equal(air.report.fineMean, mean(FINE_DAYS.map(AIR)));
  assert.equal(air.heading, Math.abs(air.report.symptomMean - air.report.fineMean) < 1 ? copy.noPattern : 'A descriptive comparison');
  assert.deepEqual(air.findings, [`${mean(SYMPTOM_DAYS.map(AIR)).toFixed(1)} AQI`, `${mean(FINE_DAYS.map(AIR)).toFixed(1)} AQI`]);
  assert.equal(air.selectedReading, `Air: ${AIR('2026-10-20')} AQI`);
  assert.equal(air.selectedDetail, 'daily maximum, daily-max-v1. Issued Unknown.');
  assert.equal(air.visibleEntries.length, 7, 'Patterns shows only this home\'s check-ins');
  // The chart: every recorded Air day, gaps not zero, a caption over the whole range.
  const recordedAir = datesFrom(RECORDING_FROM, '2026-11-09').filter((d) => d !== GAP_DAY).length;
  assert.equal(air.trend.values.length, recordedAir);
  assert.equal(air.trend.bars.length, recordedAir);
  assert.equal(new Set(air.trend.table.map((r) => r.key)).size, 84, 'the table keys one row per date');
  assert.match(air.trend.caption, /^2026-08-19 to 2026-11-10\. Gaps are missing or incompatible readings, not zero\. AQI\. Vertical range 0 to \d+\.$/);
  assert.ok(air.trend.table.every((r) => r.separate === null), 'no row is a separate source version');
  assert.deepEqual(air.pulse, ['7 logged', `${recordedAir} history days`, '6 comparable readings']);
  assert.deepEqual(air.sources, { dataset: `${NOT_RECORDED_SOURCE}, ${SOURCE_LABELS.open_meteo_cams}`, versions: 'daily-max-v1', latestIssue: 'Unknown' });

  const uv = patterns(live, ENTRIES, { factor: 'UV' });
  assert.equal(uv.report.enough, true);
  assert.ok(Math.abs(uv.report.symptomMean - mean(SYMPTOM_DAYS.map(UV))) < 1e-9);
  assert.ok(Math.abs(uv.report.fineMean - mean(FINE_DAYS.map(UV))) < 1e-9);
  assert.deepEqual(uv.findings, [`${mean(SYMPTOM_DAYS.map(UV)).toFixed(1)} UV index`, `${mean(FINE_DAYS.map(UV)).toFixed(1)} UV index`]);
  assert.equal(uv.selectedReading, 'UV: Unavailable');
  assert.equal(uv.selectedDetail, MISSING.currentDay, 'today is not complete');
});

test('Patterns: Pollen and Outdoor mold read Unavailable on every date and never join a mean', async (t) => {
  freeze(t);
  const c = await client(world(), 'alice');
  const live = await history(c, fe.patternsRequest(lunaCalendarAnchor(), dayAdd));
  for (const factor of ['Pollen', 'Outdoor mold']) {
    const view = patterns(live, ENTRIES, { factor, selected: '2026-10-20' });
    assert.equal(view.report.rows.length, 84);
    assert.ok(view.days.every((date) => evidence.readingLabel(view.matchingReading(date)) === 'Unavailable'), `${factor}: every grid day`);
    assert.equal(view.report.comparable, 0);
    assert.equal(view.report.history, 0);
    assert.equal(view.comparable, false);
    assert.equal(view.findings, null);
    assert.equal(view.heading, copy.insufficient);
    assert.equal(view.trend.empty, 'No compatible values in this range.');
    assert.equal(view.selectedReading, `${factor}: Unavailable`);
    assert.equal(view.selectedDetail, factor === 'Pollen' ? MISSING.pollen : MISSING.mold);
  }
});

test('Patterns: a day before recording_from, a source gap and a DST day each read as the server says', async (t) => {
  freeze(t);
  const c = await client(world(), 'alice');
  const live = await history(c, fe.patternsRequest(lunaCalendarAnchor(), dayAdd));
  const before = patterns(live, ENTRIES, { selected: '2026-08-25' });
  assert.equal(before.selectedReading, 'Air: Unavailable');
  assert.equal(before.selectedDetail, MISSING.recordedFrom(RECORDING_FROM));
  assert.ok(before.report.missing >= 1, 'counted in report.missing, never as a value');
  assert.equal(patterns(live, ENTRIES, { selected: GAP_DAY }).selectedDetail, MISSING.sourceGap);
  // 2026-11-01 has 25 hours in New York: one row per factor, and a value.
  const dst = live.data.rows.filter((r) => r.date === DST_DAY);
  assert.deepEqual(dst.map((r) => r.factor), ['Air', 'UV', 'Pollen', 'Outdoor mold']);
  assert.equal(patterns(live, ENTRIES, { selected: DST_DAY }).selectedReading, `Air: ${AIR(DST_DAY)} AQI`);
  // Fixtures: the recorded fortnight (with the DST day and the recorder's days), the days around recording_from.
  await history(c, { from: '2026-10-28', to: TODAY });
  keep('evidenceRead-recorded', 'evidenceRead', 200, c.last('evidenceRead').body);
  await history(c, { from: '2026-08-28', to: '2026-09-03' });
  keep('evidenceRead-before-recording', 'evidenceRead', 200, c.last('evidenceRead').body);
  assert.equal(c.last('evidenceRead').body.rows.find((r) => r.date === '2026-08-31' && r.factor === 'Air').missing, MISSING.recordedFrom(RECORDING_FROM));
});

test('a stale context id (a move on another device) shows "History could not be verified."', async (t) => {
  freeze(t);
  const c = await client(world(), 'alice', { homeContextId: ALICE_EARLIER_HOME });
  const live = await history(c, fe.patternsRequest(lunaCalendarAnchor(), dayAdd));
  assert.equal(c.last('evidenceRead').status, 200, 'the answer is the current home\'s, truthfully');
  assert.equal(live.data, null);
  assert.equal(live.error, UNVERIFIED);
  const view = patterns(live, ENTRIES);
  assert.equal(view.busy, true);
  assert.equal(view.status, UNVERIFIED);
  assert.equal(view.report.rows.length, 0);
});

test('a household without a home: the profile says null, and the E12 answer validates only for a null-context client', async (t) => {
  freeze(t);
  const h = world();
  const c = await client(h, 'dave');
  assert.equal(c.profile.home_context, null);
  assert.equal(c.runtime.homeContextId, null);
  keep('profileRead-no-home', 'profileRead', 200, c.last('profileRead').body);
  const live = await history(c, fe.patternsRequest(lunaCalendarAnchor(), dayAdd));
  assert.deepEqual(live.data, { rows: [], comparison: { context: null, basis: 'daily maximum', version: 'daily-max-v1' }, complete: true });
  keep('evidenceRead-no-home', 'evidenceRead', 200, c.last('evidenceRead').body);
  const view = patterns(live, []);
  assert.equal(view.unavailable, null);
  assert.equal(view.trend.empty, 'No compatible values in this range.');
  assert.equal(fe.productionHistory({ data: live.data, error: null }, { homeContextId: ALICE_HOME }).error, UNVERIFIED);
  assert.equal(h.db.queryLog.some((q) => q.table === 'daily_maxima'), false, 'no rows are read without a home');
});

test('before 0016 the profile omits home_context, the context id is null, and the read is the E12 body', async (t) => {
  freeze(t);
  const c = await client(world({ before0016: true, probe: 'fake' }), 'alice');
  assert.equal(Object.hasOwn(c.profile, 'home_context'), false, 'a missing key: 0016 not applied (or a failed read)');
  assert.equal(c.runtime.homeContextId, null);
  keep('profileRead-before-0016', 'profileRead', 200, c.last('profileRead').body);
  const live = await history(c, { from: '2026-11-01', to: TODAY });
  assert.equal(live.error, null);
  assert.deepEqual(live.data.rows, []);
  assert.equal(live.data.comparison.context, null);
});

test('Season: the current season is clamped at today; a past season reads Unavailable with the window reason', async (t) => {
  freeze(t);
  const c = await client(world(), 'alice');
  const fall = await season(c, ENTRIES, { season: 'Fall', year: '2026' });
  assert.deepEqual(fall.range.request, { from: '2026-09-01', to: TODAY }, 'the clamp at today (WeekEvidence.tsx:43)');
  assert.equal(fall.range.periodDays, 71);
  assert.equal(fall.live.error, null);
  const recorded = datesFrom(RECORDING_FROM, '2026-11-09').filter((d) => d !== GAP_DAY).length;
  assert.equal(fall.report.history, recorded);
  assert.equal(fall.report.enough, true);
  assert.deepEqual(fall.pulse, ['6/71 logged days', `${recorded}/71 history days`, '6 comparable readings']);
  assert.equal(fall.status, null);
  assert.equal(fall.coverage, '0 recalled entries, 0 illness flags, 0 logged days without compatible readings and 0 history days with a different basis.');

  const spring = await season(c, ENTRIES, { season: 'Spring', year: '2026' });
  assert.deepEqual(spring.range.request, { from: '2026-03-01', to: '2026-05-31' });
  assert.equal(spring.live.error, null);
  assert.equal(spring.live.data.rows.length, 92 * 4);
  assert.ok(spring.live.data.rows.every((r) => r.value === null && (r.factor === 'Pollen' || r.factor === 'Outdoor mold' || r.missing === MISSING.outsideWindow)));
  assert.ok(spring.report.rows.every((r) => evidence.readingLabel(r) === 'Unavailable'));
  assert.equal(spring.trend.empty, 'No compatible values in this range.');
  assert.deepEqual(spring.pulse, ['0/92 logged days', '0/92 history days', '0 comparable readings']);
  await history(c, { from: '2026-05-29', to: '2026-05-31' });
  keep('evidenceRead-outside-window', 'evidenceRead', 200, c.last('evidenceRead').body);
});

test('failures reach the screen as the client\'s own sentences', async (t) => {
  freeze(t);
  // 400: a range the screen never asks for (93 days).
  const c = await client(world(), 'alice');
  const tooLong = await history(c, { from: dayAdd(TODAY, -92), to: TODAY });
  assert.equal(c.last('evidenceRead').status, 400);
  assert.equal(tooLong.error, 'Check the highlighted information and try again.');
  assert.deepEqual(c.last('evidenceRead').body.field_errors.map((e) => [e.field, e.code]), [['from', 'range_too_large']]);
  keep('evidenceRead-validation', 'evidenceRead', 400, c.last('evidenceRead').body);

  // 503: 0025 not applied (the probe is missing).
  const missing = await client(world({ probe: 'none' }), 'alice');
  const off = await history(missing, { from: '2026-11-01', to: TODAY });
  assert.equal(missing.last('evidenceRead').body.code, 'feature_unavailable');
  assert.equal(missing.last('evidenceRead').body.retryable, false);
  assert.equal(off.error, UNAVAILABLE);
  assert.equal(patterns(off, ENTRIES).status, UNAVAILABLE);
  keep('evidenceRead-feature-unavailable', 'evidenceRead', 503, missing.last('evidenceRead').body);

  // 500: another database error, logged without ids.
  const logged = muteConsoleError(t);
  const broken = await client(world({ probe: 'timeout' }), 'alice');
  const failed = await history(broken, { from: '2026-11-01', to: TODAY });
  assert.equal(broken.last('evidenceRead').status, 500);
  assert.equal(failed.error, UNAVAILABLE);
  keep('evidenceRead-internal-error', 'evidenceRead', 500, broken.last('evidenceRead').body);
  for (const secret of [ALICE_HOME, ID(1), String(CONCORD.lat)]) assert.equal(logged.mock.calls.flatMap((call) => call.arguments).join(' ').includes(secret), false);

  // The profile's own failure: the profile read errors, and the context read alone never does.
  const h = world();
  const fakeFrom = h.db.from;
  h.db.from = (name) => {
    if (name !== 'profiles') return fakeFrom(name);
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) };
    return chain;
  };
  const noProfile = await client(h, 'alice');
  assert.equal(noProfile.last('profileRead').status, 500);
  assert.ok(noProfile.profileError, 'the session read fails');
  keep('profileRead-internal-error', 'profileRead', 500, noProfile.last('profileRead').body);
  logged.mock.restore();

  // 401 and the auth outage, on both routes.
  const anon = await client(world(), 'alice', { token: 'not-a-session' });
  assert.equal(anon.last('profileRead').status, 401);
  keep('profileRead-unauthenticated', 'profileRead', 401, anon.last('profileRead').body);
  const anonRead = await history(anon, { from: '2026-11-01', to: TODAY });
  assert.equal(anon.last('evidenceRead').status, 401);
  assert.equal(anonRead.error, 'Please reconnect your session to continue.');
  keep('evidenceRead-unauthenticated', 'evidenceRead', 401, anon.last('evidenceRead').body);

  const outageWorld = world();
  outageWorld.forceAuthOutage();
  const outage = await client(outageWorld, 'alice');
  assert.equal(outage.last('profileRead').body.code, 'auth_unavailable');
  keep('profileRead-auth-unavailable', 'profileRead', 503, outage.last('profileRead').body);
  const down = await history(outage, { from: '2026-11-01', to: TODAY });
  assert.equal(outage.last('evidenceRead').body.code, 'auth_unavailable');
  assert.equal(down.error, UNAVAILABLE);
  keep('evidenceRead-auth-unavailable', 'evidenceRead', 503, outage.last('evidenceRead').body);
});

test('Season: a season that has not begun asks for its first day alone and reads 0/0, never a zero value', async (t) => {
  freeze(t);
  const c = await client(world(), 'alice');
  const winter = await season(c, ENTRIES, { season: 'Winter', year: '2026' });
  assert.deepEqual(winter.range.request, { from: '2026-12-01', to: '2026-12-01' }, 'WeekEvidence.tsx:43: through < start asks for the start');
  assert.equal(winter.range.periodDays, 0);
  assert.equal(winter.live.error, null);
  assert.deepEqual(winter.live.data.rows.map((r) => r.missing ?? null), [MISSING.notRecordedYet, MISSING.notRecordedYet, MISSING.pollen, MISSING.mold]);
  assert.deepEqual(winter.pulse, ['0/0 logged days', '0/0 history days', '0 comparable readings']);
  assert.equal(winter.trend.empty, 'No compatible values in this range.');
});

test('every query the route refuses is a 400 the document describes, with the code the document lists', async (t) => {
  freeze(t);
  const h = world();
  const ask = async (query) => {
    const res = await h.call('/api/evidence', 'GET', { as: 'alice', url: `/api/evidence${query}`, headers: { 'x-request-id': REQUEST_ID } });
    assert.equal(res.status, 400, query);
    const body = await check('evidenceRead', res);
    assert.equal(body.code, 'validation_failed');
    return body.field_errors.map((e) => [e.field, e.code]);
  };
  const ok = 'kind=history&from=2026-11-01&to=2026-11-02';
  assert.deepEqual(await ask(`?${ok}&kind=history`), [['kind', 'duplicate_field']], 'a key sent twice, even with the same value');
  assert.deepEqual(await ask(`?${ok}&from=2026-11-01&from=2026-11-01`), [['from', 'duplicate_field']], 'one error per duplicated key');
  assert.deepEqual(await ask(`?${ok}&x=1`), [['x', 'unknown_field']]);
  assert.deepEqual(await ask(`?${ok}&%E2%80%94=1`), [['query', 'unknown_field']], 'a key with a U+2014 is not echoed');
  assert.deepEqual(await ask(`?${ok}&${'k'.repeat(41)}=1`), [['query', 'unknown_field']], 'a long key is not echoed');
  assert.deepEqual(await ask('?from=2026-11-01&to=2026-11-02'), [['kind', 'required']]);
  assert.deepEqual(await ask(''), [['kind', 'required'], ['from', 'required'], ['to', 'required']]);
  assert.deepEqual(await ask('?kind=pollen&from=2026-11-01&to=2026-11-02'), [['kind', 'unsupported_kind']]);
  assert.deepEqual(await ask('?kind=history&from=2026-02-30&to=2026-11-02'), [['from', 'invalid_date']]);
  assert.deepEqual(await ask('?kind=history&from=2026-11-01&to=2026-11-2'), [['to', 'invalid_date']]);
  assert.deepEqual(await ask('?kind=history&from=2026-11-03&to=2026-11-02'), [['from', 'range_inverted']]);
  assert.deepEqual(await ask('?kind=history&from=2026-01-01&to=2026-04-03'), [['from', 'range_too_large']], '93 days');
  assert.deepEqual(h.db.queryLog.filter((q) => q.table === 'daily_maxima'), [], 'nothing is read for a refused query');
});

test('the last days of the calendar (9999-12-31) are a whole, valid answer the client accepts', async (t) => {
  freeze(t);
  const h = world();
  const res = await h.call('/api/evidence', 'GET', { as: 'alice', url: '/api/evidence?kind=history&from=9999-12-01&to=9999-12-31', headers: { 'x-request-id': REQUEST_ID } });
  assert.equal(res.status, 200);
  const body = await check('evidenceRead', res);
  assert.equal(body.rows.length, 31 * 4);
  assert.ok(body.rows.every((r) => r.value === null && r.context === ALICE_HOME && typeof r.missing === 'string'));
  assert.equal(body.rows.at(-1).date, '9999-12-31');
  assert.equal(fe.productionHistory({ data: body, error: null }, { homeContextId: ALICE_HOME }).error, null);
});

test('a row stored for the household\'s earlier home is never served for the current one', async (t) => {
  freeze(t);
  await pdb.asService(async (tx) => {
    await tx.query(`insert into public.daily_maxima (profile_id, home_context_id, local_date, factor, value, unit, source_code, station_id, method_version, time_zone, hours_expected, hours_observed, missing_code, retrieved_at)
      values ($1, $2, '2026-10-22', 'air', ${FOREIGN_VALUE}, 'AQI', 'open_meteo_cams', null, 'daily-max-v1', 'America/New_York', 24, 24, null, '2026-11-01T12:00:00Z')`, [ID(1), ALICE_EARLIER_HOME]);
  }, { commit: true });
  try {
    const c = await client(world(), 'alice');
    const live = await history(c, { from: '2026-10-20', to: '2026-10-24' });
    assert.equal(live.error, null);
    assert.equal(live.data.rows.find((r) => r.date === '2026-10-22' && r.factor === 'Air').value, AIR('2026-10-22'));
    assert.equal(JSON.stringify(live.data).includes(String(FOREIGN_VALUE)), false);
    assert.equal(JSON.stringify(live.data).includes(ALICE_EARLIER_HOME), false);
  } finally {
    await pdb.asService(async (tx) => { await tx.query('delete from public.daily_maxima where home_context_id = $1', [ALICE_EARLIER_HOME]); }, { commit: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Fixtures and coverage. Last: tests in a file run in order.
// ---------------------------------------------------------------------------

test('the fixtures are the handlers\' answers today', async () => {
  if (WRITE_FIXTURES) {
    await mkdir(FIXTURE_DIR, { recursive: true });
    for (const [name, value] of produced) await writeFile(new URL(`${name}.json`, FIXTURE_DIR), `${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const names = fixtures.map((f) => f.name.replace(/\.json$/, '')).sort();
  assert.deepEqual(names, [...produced.keys()].sort(), 'the fixture set is the produced set');
  for (const fixture of fixtures) {
    const { name, ...storedFixture } = fixture;
    assert.deepEqual(storedFixture, produced.get(name.replace(/\.json$/, '')), `${name} is what the handler answers today`);
  }
});

test('no B08 fixture carries a secret, a token, a provider URL or a real address', () => {
  assert.ok(fixtures.length >= 18 || WRITE_FIXTURES, 'the fixtures were written');
  const forbidden = [/Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/, /api[_-]?key/i, /secret/i, /password/i, /supabase|upstash|postgres|PGRST/i, /https?:\/\//, /@/];
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture.body);
    for (const pattern of forbidden) assert.equal(pattern.test(serialized), false, `${fixture.name} matches ${pattern}`);
    assert.ok([REQUEST_ID, undefined].includes(fixture.body.request_id), `${fixture.name}: the synthetic request id`);
  }
});

test('every documented status was produced by the real handler in this file', () => {
  for (const [operationId, op] of Object.entries(OPERATIONS)) {
    assert.deepEqual([...seen[operationId]].sort(), Object.keys(op.responses).map(Number).sort(), operationId);
  }
});
