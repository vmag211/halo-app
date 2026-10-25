/**
 * GET /api/evidence (`evidence.read`, B08 Task 4; docs/backend/plans/b08-evidence.md, Rulings
 * E11 to E19) on the isolated harness (synthetic identities, the in-memory database and a fetch
 * that rejects any host), plus one case over the real migration 0025 on PGlite.
 *
 * The authority is the client in this tree, run or transcribed, never paraphrased:
 *
 *   the validator          components/production/WeekSources.tsx:7-9, transcribed verbatim in
 *                          test/helpers/frontendB08.mjs (productionHistory) and compared with the
 *                          file at test time below, including the hook's evidence.read call;
 *   the request            lib/frontend/production/runtime.ts (createProductionRuntime), run for
 *                          real: its query encoding, headers, status mapping and envelope unwrap;
 *   the profile read       lib/frontend/stage-api.ts getProfile, run for real, and the context id
 *                          derivation of components/production/ProductionApp.tsx:41-42,
 *                          transcribed verbatim and drift-checked;
 *   the analysis           lib/frontend/week-evidence-preview.ts analyzeHistory, run for real.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { fullContextRow, registerHomeContextRpcs } from './helpers/fakeHomeContext.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { TRANSCRIPTIONS, productionHistory } from './helpers/frontendB08.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';

const { localDate, addDays } = await import('../lib/localDate.js');
const { MISSING, SOURCE_LABELS, NOT_RECORDED_SOURCE } = await import('../lib/dailyMaxima.js');
const { createLiveStageApi } = await loadFrontend('stage-api');
const { isProfileComplete } = await loadFrontend('onboarding');
const { createProductionRuntime } = await loadFrontend('production/runtime');
const preview = await loadFrontend('week-evidence-preview');

const EM_DASH = String.fromCharCode(0x2014);
const FACTORS = ['Air', 'UV', 'Pollen', 'Outdoor mold'];
// The route harness gives alice, bob, carol and dave these ids, in order.
const ID = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ALICE_HOME = 'a11ce000-3333-4000-8000-000000000001';
const ALICE_EARLIER_HOME = 'a11ce000-3333-4000-8000-000000000009';
const BOB_HOME = 'b0b00000-3333-4000-8000-000000000001';
const CAROL_HOME = 'ca201000-3333-4000-8000-000000000001';

const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const PATTERNS = { from: day(83), to: TODAY };
const RECORDING_FROM = day(60);
// Alice's current home began 100 days ago at 12:00Z (07:00 or 08:00 in New York), so its first
// full day is day(99), before RECORDING_FROM: the recorder's start decides alice's dates.
const ALICE_SINCE = `${day(100)}T12:00:00Z`;
const AIR = (n) => 20 + (n % 50);
const UVV = (n) => Math.round((1 + (n % 9) * 0.7) * 10) / 10;
const FOREIGN_VALUE = 777; // only ever stored for a home alice must not see

const base = (profileId, contextId, date) => ({
  profile_id: profileId, home_context_id: contextId, local_date: date, method_version: 'daily-max-v1', time_zone: 'America/New_York',
  hours_expected: 24, hours_observed: 24, missing_code: null, station_id: null, retrieved_at: `${TODAY}T12:00:00Z`,
});
const airRow = (profileId, contextId, date, value, extra = {}) => ({ ...base(profileId, contextId, date), factor: 'air', unit: 'AQI', source_code: 'open_meteo_cams', value, ...extra });
const uvRow = (profileId, contextId, date, value, extra = {}) => ({ ...base(profileId, contextId, date), factor: 'uv', unit: 'UV index', source_code: 'open_meteo_forecast', value, ...extra });

/** Alice's recorded days: values from day(60) to day(2), a source gap on day(10), pending on day(1). */
function aliceMaxima(alice) {
  const rows = [];
  for (let n = 60; n >= 2; n -= 1) {
    if (n === 10) {
      rows.push(airRow(alice, ALICE_HOME, day(n), null, { missing_code: 'source_gap', hours_observed: 12 }));
      rows.push(uvRow(alice, ALICE_HOME, day(n), null, { missing_code: 'source_gap', hours_observed: 12 }));
      continue;
    }
    rows.push(airRow(alice, ALICE_HOME, day(n), AIR(n)), uvRow(alice, ALICE_HOME, day(n), UVV(n)));
  }
  rows.push(airRow(alice, ALICE_HOME, day(1), null, { missing_code: 'pending', hours_observed: 20 }));
  return rows;
}

function harness({ tables = ['profiles', 'household_bands', 'home_contexts', 'daily_scores', 'daily_maxima', 'daily_maxima_recorder'], probe = true, recordingFrom = RECORDING_FROM } = {}) {
  const h = createRouteHarness({
    identities: { alice: {}, bob: {}, carol: {}, dave: {} },
    tables: haloTables(...tables),
    seed: ({ alice, bob, carol, dave }) => {
      const profile = (who, lat, lng) => ({ id: who.id, county: 'Cabarrus County', state: 'NC', zip: '28025', pwsid: 'NC0113010', lat, lng, water_source: 'utility', home_year: 1975, renter_mode: false, locale: 'en' });
      const context = (id, who, extra) => fullContextRow({ id, profile_id: who.id, sequence: 1, revision: 1, origin: 'onboard', lat: 35.408, lng: -80.579, county: 'Cabarrus County', state: 'NC', water_source: 'utility', backfill_state: 'complete', effective_from: ALICE_SINCE, ...extra });
      // Carol: a 28-day onboarding backfill and several app-time readings a day, and no maxima.
      const carolScores = [];
      for (let n = 28; n >= 1; n -= 1) {
        carolScores.push({ profile_id: carol.id, home_context_id: CAROL_HOME, date: day(n), score: 61, aqi: 333, uv: 9.9, aqi_basis: 'daily_peak_modeled', source: 'backfill' });
        for (let k = 0; k < 3; k += 1) carolScores.push({ profile_id: carol.id, home_context_id: CAROL_HOME, date: day(n), score: 70 + k, aqi: 334 + k, uv: 8.8, source: 'app' });
      }
      const rows = {
        profiles: [profile(alice, 35.408, -80.579), profile(bob, 35.1, -80.6), profile(carol, 35.2, -80.7), profile(dave, 35.3, -80.8)],
        household_bands: [],
        home_contexts: [
          context(ALICE_EARLIER_HOME, alice, { sequence: 1, revision: 7, effective_from: `${day(300)}T12:00:00Z`, effective_to: ALICE_SINCE, closed_reason: 'moved' }),
          context(ALICE_HOME, alice, { sequence: 2, revision: 3, origin: 'move' }),
          context(BOB_HOME, bob, { lat: 35.1, lng: -80.6 }),
          context(CAROL_HOME, carol, { effective_from: `${day(40)}T12:00:00Z` }),
          // dave is located but has no home context.
        ],
        daily_scores: carolScores,
        daily_maxima: [
          ...aliceMaxima(alice.id),
          // An earlier home's maxima and another household's, on alice's own dates.
          ...[30, 20, 5].flatMap((n) => [airRow(alice.id, ALICE_EARLIER_HOME, day(n), FOREIGN_VALUE), uvRow(alice.id, ALICE_EARLIER_HOME, day(n), FOREIGN_VALUE)]),
          ...[30, 20, 5].flatMap((n) => [airRow(bob.id, BOB_HOME, day(n), FOREIGN_VALUE), uvRow(bob.id, BOB_HOME, day(n), FOREIGN_VALUE)]),
        ],
        daily_maxima_recorder: recordingFrom ? [{ singleton: true, recording_from: recordingFrom, last_run_at: null, last_run: null }] : [],
      };
      return Object.fromEntries(Object.entries(rows).filter(([name]) => tables.includes(name)));
    },
  });
  registerHomeContextRpcs(h.db);
  if (probe) h.db.registerRpc('daily_maxima_schema_version', () => 1, { args: [] });
  return h;
}

const query = ({ kind = 'history', from, to } = {}) => `/api/evidence?${new URLSearchParams({ kind, from, to })}`;
const get = (h, as, url = query(PATTERNS), headers = {}) => h.call('/api/evidence', 'GET', { as, url, headers });
async function read(h, as, range = PATTERNS, headers = {}) {
  const res = await get(h, as, query(range), headers);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.ok(res.headers.get('x-request-id'));
  return res.json();
}
const runtimeFor = (homeContextId) => ({ homeContextId });
const valueOf = (body, date, factor) => body.rows.find((r) => r.date === date && r.factor === factor);
const noDash = (value) => assert.equal(JSON.stringify(value).includes(EM_DASH), false, 'no U+2014 in a body');

// ------------------------------------------------------------------ drift

/** The frontend text for one transcription, with its recorded annotations removed (as dailyMaxima.test.mjs). */
function stripped(t, sourceText) {
  const lines = sourceText.split(/\r?\n/);
  let text = lines.slice(t.line - 1, t.line - 1 + t.lines).join('\n');
  for (const [from, to] of t.strip) text = text.replace(from, to);
  if (t.before !== undefined) assert.equal(lines[t.line - 2], t.before, `${t.file}:${t.line - 1} is the hook's evidence.read call`);
  return text;
}

test('drift: the transcribed validator is WeekSources.tsx:7-9 as it reads now, after the hook\'s evidence.read call', () => {
  const t = TRANSCRIPTIONS.find((entry) => entry.fn === productionHistory);
  assert.equal(t.file, 'components/production/WeekSources.tsx');
  const source = readFileSync(path.join(REPO_ROOT, t.file), 'utf8');
  assert.equal(stripped(t, source), productionHistory.toString().split('\n').slice(1, -1).join('\n'), 'WeekSources.tsx changed; re-transcribe it');
  const broken = source.replace("data.comparison?.basis==='daily maximum'", "data.comparison?.basis=='daily maximum'");
  assert.notEqual(stripped(t, broken), productionHistory.toString().split('\n').slice(1, -1).join('\n'), 'the drift check sees a one-character change');
});

// F: components/production/ProductionApp.tsx:41-42, verbatim (leading space trimmed).
const HOME_ID_LINE = 'const homeId=session.profile?.home_context?.id??session.profile?.profile?.home_context_id??null;';
const REVISION_LINE = 'const currentContextRevision=session.profile?.home_context?.revision??session.profile?.profile?.context_revision;';
const derive = new Function('session', `${HOME_ID_LINE}\n${REVISION_LINE}\nreturn { homeId, currentContextRevision };`);

test('drift: the transcribed context id lines are still the ones ProductionApp.tsx runs', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'components/production/ProductionApp.tsx'), 'utf8').split('\n').map((line) => line.trim());
  assert.equal(source[40], HOME_ID_LINE);
  assert.equal(source[41], REVISION_LINE);
});

// ------------------------------------------------------------------ the answer

test('a Patterns request returns 336 rows, oldest first in the frontend\'s factor order, that the client\'s validator accepts', async () => {
  const h = harness();
  const body = await read(h, 'alice');
  assert.deepEqual(Object.keys(body).sort(), ['comparison', 'complete', 'rows']);
  assert.deepEqual(body.comparison, { context: ALICE_HOME, basis: 'daily maximum', version: 'daily-max-v1' });
  assert.equal(body.complete, true);
  assert.equal(body.rows.length, 336);
  for (let i = 0; i < 84; i += 1) {
    assert.deepEqual(body.rows.slice(i * 4, i * 4 + 4).map((r) => [r.date, r.factor]), FACTORS.map((f) => [day(83 - i), f]));
  }
  const checked = productionHistory({ data: body, error: null }, runtimeFor(ALICE_HOME));
  assert.equal(checked.error, null);
  assert.equal(checked.data, body, 'the validator keeps the answer');

  // Recorded values, with their sources; nothing is 0 unless the source said 0.
  assert.deepEqual([valueOf(body, day(30), 'Air').value, valueOf(body, day(30), 'UV').value], [AIR(30), UVV(30)]);
  assert.equal(valueOf(body, day(30), 'Air').source, SOURCE_LABELS.open_meteo_cams);
  assert.equal(valueOf(body, day(30), 'UV').source, SOURCE_LABELS.open_meteo_forecast);
  assert.equal(body.rows.filter((r) => r.value !== null).length, 2 * 58, 'day(60) to day(2), less the gap day, Air and UV');
  assert.ok(body.rows.every((r) => r.value !== 0));
  for (const r of body.rows) {
    assert.equal(r.context, ALICE_HOME);
    assert.equal(r.basis, 'daily maximum');
    assert.equal(r.issued, 'Unknown');
    assert.equal(r.version, 'daily-max-v1');
    if (r.value === null) assert.equal(typeof r.missing, 'string');
  }
  // Each null has its reason (E13).
  assert.equal(valueOf(body, TODAY, 'Air').missing, MISSING.currentDay);
  assert.equal(valueOf(body, day(1), 'Air').missing, MISSING.notRecordedYet, 'pending inside the settle window');
  assert.equal(valueOf(body, day(10), 'Air').missing, MISSING.sourceGap);
  assert.equal(valueOf(body, day(61), 'Air').missing, MISSING.recordedFrom(RECORDING_FROM));
  assert.equal(valueOf(body, day(83), 'UV').source, NOT_RECORDED_SOURCE);
  assert.ok(body.rows.filter((r) => r.factor === 'Pollen').every((r) => r.value === null && r.missing === MISSING.pollen));
  assert.ok(body.rows.filter((r) => r.factor === 'Outdoor mold').every((r) => r.value === null && r.missing === MISSING.mold));
  assert.equal(JSON.stringify(body).includes(String(FOREIGN_VALUE)), false);
  noDash(body);
  assert.deepEqual(h.blockedFetches, [], 'no outbound call');
});

test('never backfilled: 28 backfill rows and app-time readings in daily_scores give only null rows, and daily_scores is never read', async () => {
  const h = harness();
  const body = await read(h, 'carol', { from: day(30), to: TODAY });
  assert.equal(body.comparison.context, CAROL_HOME);
  assert.equal(body.rows.length, 31 * 4);
  assert.ok(body.rows.every((r) => r.value === null), 'no value from a daily_scores row');
  assert.ok(body.rows.every((r) => r.source === NOT_RECORDED_SOURCE || r.factor === 'Pollen' || r.factor === 'Outdoor mold'));
  for (const text of ['"value":333', '"value":334', '"value":9.9', '"value":8.8', 'daily_peak_modeled', 'backfill']) assert.equal(JSON.stringify(body).includes(text), false, text);
  // Carol's home began day(40), so its first full day is day(39); the recorder began day(60).
  assert.equal(valueOf(body, day(30), 'Air').missing, MISSING.noReading);
  assert.equal(valueOf(body, day(2), 'Air').missing, MISSING.notRecordedYet);
  assert.equal(productionHistory({ data: body, error: null }, runtimeFor(CAROL_HOME)).error, null);
  assert.equal(h.db.queryLog.some((q) => q.table === 'daily_scores'), false, 'daily_scores is never queried');
  assert.equal((await read(h, 'alice')).rows.length, 336);
  assert.equal(h.db.queryLog.some((q) => q.table === 'daily_scores'), false);
});

test('a home that began after the recorder: dates before its first full day carry "Recorded from" its first full day', async () => {
  const h = harness();
  const body = await read(h, 'carol', { from: day(50), to: day(30) });
  assert.equal(valueOf(body, day(40), 'Air').missing, MISSING.recordedFrom(day(39)), 'the move day belongs to no home');
  assert.equal(valueOf(body, day(39), 'Air').missing, MISSING.noReading);
});

test('before the recorder\'s first run nothing claims a start date', async () => {
  const h = harness({ recordingFrom: null });
  const body = await read(h, 'carol', { from: day(50), to: day(30) });
  for (const n of [45, 35]) assert.equal(valueOf(body, day(n), 'Air').missing, MISSING.noReading, 'nothing was recorded, and no start is claimed');
  assert.ok(body.rows.every((r) => !String(r.missing ?? '').startsWith('Recorded from')));
});

test('a household without a current home, and a database before 0016, get exactly the E12 body', async () => {
  const E12 = { rows: [], comparison: { context: null, basis: 'daily maximum', version: 'daily-max-v1' }, complete: true };
  const h = harness();
  const body = await read(h, 'dave');
  assert.deepEqual(body, E12);
  const checked = productionHistory({ data: body, error: null }, runtimeFor(null));
  assert.equal(checked.error, null, 'valid for a client whose context id is null');
  assert.equal(productionHistory({ data: body, error: null }, runtimeFor(ALICE_HOME)).error, 'History could not be verified.');
  assert.equal(h.db.queryLog.some((q) => q.table === 'daily_maxima'), false, 'no rows are read without a home');

  const before0016 = harness({ tables: ['profiles', 'household_bands', 'daily_scores', 'daily_maxima', 'daily_maxima_recorder'] });
  assert.deepEqual(await read(before0016, 'alice'), E12);
});

test('ownership: another household\'s maxima and an earlier home\'s are invisible, and a foreign home context header changes nothing', async () => {
  const h = harness();
  const plain = await read(h, 'alice');
  const start = h.db.queryLog.length;
  const foreign = await read(h, 'alice', PATTERNS, { 'X-Halo-Home-Context': BOB_HOME });
  assert.deepEqual(foreign, plain);
  const earlier = await read(h, 'alice', PATTERNS, { 'X-Halo-Home-Context': ALICE_EARLIER_HOME });
  assert.deepEqual(earlier, plain);
  for (const body of [plain, foreign, earlier]) {
    for (const id of [BOB_HOME, ALICE_EARLIER_HOME]) assert.equal(JSON.stringify(body).includes(id), false);
    assert.equal(JSON.stringify(body).includes(String(FOREIGN_VALUE)), false);
  }
  const reads = h.db.queryLog.slice(start).filter((q) => q.table === 'daily_maxima');
  assert.equal(reads.length, 2);
  for (const q of reads) {
    assert.ok(q.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id), 'owner-scoped on the query');
    assert.ok(q.filters.some((f) => f.op === 'eq' && f.column === 'home_context_id' && f.value === ALICE_HOME), 'the current home only');
  }
  for (const q of h.db.queryLog.slice(start).filter((entry) => entry.table === 'home_contexts')) {
    assert.ok(q.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
    assert.equal(q.filters.some((f) => f.column === 'id'), false, 'no id from the request is a filter');
  }
  const bob = await read(h, 'bob', { from: day(31), to: day(4) });
  assert.equal(bob.comparison.context, BOB_HOME);
  assert.equal(valueOf(bob, day(30), 'Air').value, FOREIGN_VALUE, 'bob sees his own');
  assert.equal(JSON.stringify(bob).includes(ALICE_HOME), false);
});

// ------------------------------------------------------------------ the request

test('400 with field errors for each bad query, before anything is read; 92 days is accepted', async () => {
  const h = harness();
  const cases = {
    'a missing key': `/api/evidence?kind=history&from=${day(10)}`,
    'no query at all': '/api/evidence',
    'an unknown key': `${query({ from: day(10), to: TODAY })}&context=${BOB_HOME}`,
    'a repeated key': `${query({ from: day(10), to: TODAY })}&to=${TODAY}`,
    'kind=forecast': query({ kind: 'forecast', from: day(10), to: TODAY }),
    'an empty kind': query({ kind: '', from: day(10), to: TODAY }),
    '2026-02-30': query({ from: '2026-02-30', to: '2026-03-02' }),
    'a non-padded date': query({ from: '2026-3-01', to: '2026-03-02' }),
    'from after to': query({ from: TODAY, to: day(1) }),
    'a 93-day span': query({ from: day(92), to: TODAY }),
  };
  for (const [name, url] of Object.entries(cases)) {
    const before = h.db.queryLog.length;
    const rpcs = h.db.rpcCalls.length;
    const res = await get(h, 'alice', url);
    const body = await expectEnvelope(res, { status: 400, code: 'validation_failed', retryable: false });
    assert.ok(body.field_errors.length >= 1, name);
    for (const fe of body.field_errors) assert.deepEqual(Object.keys(fe).sort(), ['code', 'field', 'message'], name);
    noDash(body);
    assert.equal(h.db.queryLog.length, before, `${name}: nothing is read`);
    assert.equal(h.db.rpcCalls.length, rpcs, `${name}: not even the probe`);
  }
  const fields = async (url) => (await (await get(h, 'alice', url)).json()).field_errors.map((fe) => [fe.field, fe.code]);
  assert.deepEqual(await fields(cases['a missing key']), [['to', 'required']]);
  assert.deepEqual(await fields(cases['an unknown key']), [['context', 'unknown_field']]);
  assert.deepEqual(await fields(cases['a repeated key']), [['to', 'duplicate_field']]);
  assert.deepEqual(await fields(cases['kind=forecast']), [['kind', 'unsupported_kind']]);
  assert.deepEqual(await fields(cases['2026-02-30']), [['from', 'invalid_date']]);
  assert.deepEqual(await fields(cases['from after to']), [['from', 'range_inverted']]);
  assert.deepEqual(await fields(cases['a 93-day span']), [['from', 'range_too_large']]);

  const ninetyTwo = await read(h, 'alice', { from: day(91), to: TODAY });
  assert.equal(ninetyTwo.rows.length, 92 * 4);
  assert.equal(valueOf(ninetyTwo, day(91), 'Air').missing, MISSING.outsideWindow, 'older than the latest 84 days');
  assert.equal(valueOf(ninetyTwo, day(83), 'Air').missing, MISSING.recordedFrom(RECORDING_FROM));
  // A `to` after today is accepted; its dates are null rows.
  const ahead = await read(h, 'alice', { from: day(1), to: addDays(TODAY, 2) });
  assert.equal(valueOf(ahead, addDays(TODAY, 2), 'Air').missing, MISSING.notRecordedYet);
  assert.equal(valueOf(ahead, addDays(TODAY, 2), 'UV').value, null);
});

test('a caller\'s own text never reaches the answer: an unknown key is named by its plain name or "query"', async () => {
  const h = harness();
  const base = `kind=history&from=${day(3)}&to=${TODAY}`;
  for (const [key, field] of [['context', 'context'], [`a${EM_DASH}b`, 'query'], ['k'.repeat(5000), 'query'], [encodeURIComponent('\u{1F600}'), 'query']]) {
    const res = await get(h, 'alice', `/api/evidence?${base}&${key.startsWith('%') ? key : encodeURIComponent(key)}=1`);
    const body = await expectEnvelope(res, { status: 400, code: 'validation_failed' });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [[field, 'unknown_field']]);
    noDash(body);
  }
});

test('the last days of the calendar (9999-12-31) are a valid, whole answer for the client, not a 500', async () => {
  const h = harness();
  const body = await read(h, 'alice', { from: '9999-12-25', to: '9999-12-31' });
  assert.equal(body.rows.length, 28);
  assert.deepEqual([body.rows[0].date, body.rows[27].date], ['9999-12-25', '9999-12-31']);
  assert.ok(body.rows.every((r) => r.value === null && typeof r.missing === 'string'));
  assert.equal(productionHistory({ data: body, error: null }, runtimeFor(ALICE_HOME)).error, null);
  // A range wholly after today, and a leap day, are answered too.
  const future = await read(h, 'alice', { from: '2030-01-01', to: '2030-01-05' });
  assert.ok(future.rows.every((r) => r.value === null && typeof r.missing === 'string'));
  assert.equal((await read(h, 'alice', { from: '2028-02-29', to: '2028-02-29' })).rows.length, 4);
});

test('401 without a session, with nothing read', async () => {
  const h = harness();
  const res = await get(h, null);
  await expectEnvelope(res, { status: 401, code: 'auth_required' });
  assert.equal(h.db.queryLog.length, 0);
  assert.equal(h.db.rpcCalls.length, 0);
});

test('503 feature_unavailable, not retryable, while 0025 is missing: the probe, or a table it made', async () => {
  const noProbe = harness({ probe: false });
  const body = await expectEnvelope(await get(noProbe, 'alice'), { status: 503, code: 'feature_unavailable', retryable: false });
  noDash(body);
  assert.equal(noProbe.db.queryLog.some((q) => q.table === 'daily_maxima'), false);
  assert.equal(noProbe.db.queryLog.some((q) => q.table === 'home_contexts'), false, 'the probe comes first');

  for (const missing of ['daily_maxima', 'daily_maxima_recorder']) {
    const tables = ['profiles', 'household_bands', 'home_contexts', 'daily_scores', 'daily_maxima', 'daily_maxima_recorder'].filter((t) => t !== missing);
    await expectEnvelope(await get(harness({ tables }), 'alice'), { status: 503, code: 'feature_unavailable', retryable: false });
  }
  const wrongVersion = harness({ probe: false });
  wrongVersion.db.registerRpc('daily_maxima_schema_version', () => 2, { args: [] });
  await expectEnvelope(await get(wrongVersion, 'alice'), { status: 503, code: 'feature_unavailable', retryable: false });
});

test('any other database error is the house 500, logged with the request id and no ids, points or values', async (t) => {
  const failures = {
    probe: (h) => h.db.registerRpc('daily_maxima_schema_version', () => { throw rpcError('57014', 'canceling statement due to statement timeout'); }, { args: [] }),
    rows: (h) => {
      const from = h.db.from.bind(h.db);
      h.db.from = (table) => {
        if (table !== 'daily_maxima') return from(table);
        const chain = { select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain, order: () => chain, limit: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout', details: `Failing row contains (${ALICE_HOME}, 35.408)` } }) };
        return chain;
      };
    },
    overflow: (h) => {
      const from = h.db.from.bind(h.db);
      h.db.from = (table) => {
        if (table !== 'daily_maxima') return from(table);
        const chain = { select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain, order: () => chain, limit: async () => ({ data: Array.from({ length: 185 }, () => ({})), error: null }) };
        return chain;
      };
    },
  };
  for (const [name, breakIt] of Object.entries(failures)) {
    const logged = muteConsoleError(t);
    const h = harness();
    breakIt(h);
    const res = await get(h, 'alice');
    const body = await expectEnvelope(res, { status: 500, code: 'internal_error' });
    const text = loggedText(logged);
    assert.ok(text.includes(body.request_id), `${name}: logged with the request id`);
    for (const secret of [ALICE_HOME, h.identities.alice.id, '35.408', 'Failing row']) assert.equal(text.includes(secret), false, `${name}: ${secret} not logged`);
    logged.mock.restore();
  }
});

// ------------------------------------------------------------------ end to end, through the client

/** The client as it runs: the live profile read, the context id derivation and the real runtime over the harness. */
async function clientFor(h, as) {
  const identity = h.identities[as];
  const auth = {
    async ensureAnonSession() {},
    async getUserId() { return identity.id; },
    async authedFetch(url, init = {}) { return h.call(url.split('?')[0], init.method ?? 'GET', { as, url, headers: init.headers }); },
  };
  const profile = await createLiveStageApi({ loadAuth: async () => auth }).getProfile();
  assert.equal(isProfileComplete(profile), true);
  const { homeId, currentContextRevision } = derive({ profile });
  const sent = [];
  const runtime = createProductionRuntime({
    identityId: identity.id, homeContextId: homeId, contextRevision: currentContextRevision, active: () => true, writeAllowed: () => true,
    credential: async () => ({ identityId: identity.id, accessToken: identity.token }),
    fetcher: async (url, init) => {
      sent.push({ url, init });
      return h.call('/api/evidence', init.method, { url, headers: init.headers });
    },
  });
  return { profile, runtime, sent };
}

test('end to end: the profile\'s home_context.id and the evidence answer satisfy the client\'s context check', async () => {
  const h = harness();
  const { profile, runtime, sent } = await clientFor(h, 'alice');
  assert.equal(profile.home_context.id, ALICE_HOME);
  assert.equal(runtime.homeContextId, ALICE_HOME);
  const data = await runtime.request('evidence.read', { kind: 'history', from: PATTERNS.from, to: PATTERNS.to });
  assert.equal(new URL(sent[0].url, 'http://halo.test').pathname, '/api/evidence');
  assert.equal(sent[0].init.headers['X-Halo-Home-Context'], ALICE_HOME, 'the runtime sends the header; the route ignores it');
  const shown = productionHistory({ data, error: null }, runtime);
  assert.equal(shown.error, null);
  assert.ok(shown.data);
  assert.equal(shown.data.comparison.context, profile.home_context.id);
  assert.ok(shown.data.rows.every((r) => r.context === profile.home_context.id));

  // The real analysis compares alice's check-ins on recorded dates with the recorded Air maxima.
  const entries = [2, 3, 4, 5, 6, 7].map((n, i) => ({ date: day(n), band: 'adult', homeContextId: runtime.homeContextId, fine: i >= 3, symptoms: i >= 3 ? [] : ['cough'], recalled: false, illness: false }));
  const report = preview.analyzeHistory(entries, shown.data.rows, PATTERNS.from, PATTERNS.to, 'adult', 'Air', shown.data.comparison);
  assert.equal(report.comparable, 6);
  assert.equal(report.enough, true);
  assert.equal(report.symptomMean, (AIR(2) + AIR(3) + AIR(4)) / 3);
  const pollen = preview.analyzeHistory(entries, shown.data.rows, PATTERNS.from, PATTERNS.to, 'adult', 'Pollen', shown.data.comparison);
  assert.equal(pollen.comparable, 0, 'Pollen never joins a mean');

  // A stale context id (a move on another device) fails the check, truthfully.
  assert.equal(productionHistory({ data, error: null }, runtimeFor(ALICE_EARLIER_HOME)).error, 'History could not be verified.');
  // No context: the profile's null and the E12 answer agree.
  const dave = await clientFor(h, 'dave');
  assert.equal(dave.runtime.homeContextId, null);
  const none = await dave.runtime.request('evidence.read', { kind: 'history', from: PATTERNS.from, to: PATTERNS.to });
  assert.equal(productionHistory({ data: none, error: null }, dave.runtime).error, null);
  assert.deepEqual(h.blockedFetches, []);
});

test('end to end: the client maps a 503 and a 400 to its own messages', async () => {
  const { runtime } = await clientFor(harness({ probe: false }), 'alice');
  await assert.rejects(runtime.request('evidence.read', { kind: 'history', from: PATTERNS.from, to: PATTERNS.to }), (e) => e.code === 'unavailable');
  const ok = await clientFor(harness(), 'alice');
  await assert.rejects(ok.runtime.request('evidence.read', { kind: 'history', from: day(92), to: TODAY }), (e) => e.code === 'validation');
});

// ------------------------------------------------------------------ the real 0025, on PGlite

let pdb;
before(async () => {
  pdb = await createDb();
  await pdb.exec(`insert into auth.users (id, is_anonymous) values ('${ID(1)}', true), ('${ID(2)}', true);`);
  await pdb.exec(`
    insert into public.home_contexts (id, profile_id, sequence, origin, lat, lng, state, effective_from) values
      ('${ALICE_HOME}', '${ID(1)}', 1, 'onboard', 35.408, -80.579, 'NC', '${ALICE_SINCE}'),
      ('${BOB_HOME}', '${ID(2)}', 1, 'onboard', 35.1, -80.6, 'NC', '${ALICE_SINCE}');`);
  await pdb.asService(async (tx) => {
    await tx.query('select public.begin_daily_maxima_run($1)', [RECORDING_FROM]);
    const rows = [
      airRow(ID(1), ALICE_HOME, day(20), 41), uvRow(ID(1), ALICE_HOME, day(20), 5.6),
      airRow(ID(1), ALICE_HOME, day(19), null, { missing_code: 'source_gap', hours_observed: 10 }),
      airRow(ID(2), BOB_HOME, day(20), FOREIGN_VALUE),
    ];
    await tx.query('select public.record_daily_maxima($1::jsonb)', [JSON.stringify(rows)]);
  }, { commit: true });
});
after(async () => { await pdb?.close(); });

test('over the real 0025 on PGlite: the stored rows, recording_from and the probe give the client a valid answer', async () => {
  const h = createRouteHarness({ identities: { alice: {}, bob: {} }, tables: haloTables('home_contexts', 'daily_maxima', 'daily_maxima_recorder') });
  const fakeFrom = h.db.from;
  h.db.from = (name) => (['home_contexts', 'daily_maxima', 'daily_maxima_recorder'].includes(name) ? pgliteSelect(pdb, name, h.db.queryLog) : fakeFrom(name));
  h.db.registerRpc('daily_maxima_schema_version', () => pdb.asService(async (tx) => (await tx.query('select public.daily_maxima_schema_version() as v')).rows[0].v), { args: [] });
  const body = await read(h, 'alice', { from: day(25), to: day(15) });
  assert.equal(body.rows.length, 11 * 4);
  assert.equal(body.comparison.context, ALICE_HOME);
  assert.equal(valueOf(body, day(20), 'Air').value, 41);
  assert.equal(valueOf(body, day(20), 'UV').value, 5.6);
  assert.equal(valueOf(body, day(19), 'Air').missing, MISSING.sourceGap);
  assert.equal(valueOf(body, day(18), 'Air').missing, MISSING.noReading);
  assert.equal(JSON.stringify(body).includes(String(FOREIGN_VALUE)), false);
  assert.equal(productionHistory({ data: body, error: null }, runtimeFor(ALICE_HOME)).error, null);
  const early = await read(h, 'alice', { from: day(65), to: day(59) });
  assert.equal(valueOf(early, day(61), 'Air').missing, MISSING.recordedFrom(RECORDING_FROM), 'recording_from read from the real recorder row');
  const bob = await read(h, 'bob', { from: day(25), to: day(15) });
  assert.equal(valueOf(bob, day(20), 'Air').value, FOREIGN_VALUE);
});
