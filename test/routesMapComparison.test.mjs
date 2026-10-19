/**
 * B05 Task 5: GET /api/map/comparison, honestly degraded (ruling D3).
 *
 * THE HONESTY TEST is the core of this file: every record the real handler
 * returns is handed to the client's own parser and compatibility rule, and for
 * every fixture pair and every compound the client must decide "Not
 * comparable", with the method, source and qualifier reasons and the
 * incomplete-coverage warning present. No row can render "Aligned evidence" or
 * "Limited comparison".
 *
 * THE CLIENT CODE BELOW IS TRANSCRIBED, not summarised, from
 * `origin/codex/october15-review-refinement` (read with `git show`; the files
 * are not checked out here), TypeScript to JavaScript with the types stripped
 * and nothing else changed:
 * - `lib/frontend/stage-values.ts:2-3,6-8,10,14-27` (helpers);
 * - `lib/frontend/map-service.ts:15-16,18-19,58-65` (`parseMapComparisons`);
 * - `lib/frontend/map-comparison-preview.ts:25-29,65-96` (`validObservationDate`,
 *   `comparisonRows`, `compareEvidence`);
 * - `lib/frontend/map-preview.ts:5` (`compounds`);
 * - `lib/frontend/copy/map-comparison.ts:39,45,48-49,55-56,64-71` (the strings
 *   those functions use, as a subset of `mapComparisonCopy`);
 * - `components/map-preview/MapComparison.tsx:64` (the row label, as a function).
 * A transcription that rejected every pair would make the honesty test pass
 * vacuously, so `the transcription says Aligned when the evidence aligns, and
 * rejects what the client rejects` proves it does not.
 *
 * The request is built as the client builds it (F: runtime.ts:125-129,
 * LiveMapComparison.tsx:15): `layer`, `quarter` (`latest` or `YYYYQn`, never
 * omitted, F: MapPreview.tsx:104,316) and `ids` as one JSON array.
 *
 * No network: the harness's default fetch rejects and records every attempt,
 * and every test asserts there were none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { airPayload } from '../lib/mapBuild.js';
import { assembleWaterFeatures } from '../lib/mapData.js';
import { comparisonRecords, COMPARISON_COPY } from '../lib/mapComparison.js';

// ------------------------------------------------- transcribed: stage-values.ts

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.replace(/\s*\u2014\s*/g, ', ').trim() : fallback;
}
const rows = (value) => Array.isArray(value) ? value.filter(item => item !== null && typeof item === 'object' && !Array.isArray(item)).map(record) : [];
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

// -------------------------------------------------- transcribed: map-service.ts

const nullable = (value) => safeText(value)||null;
const dayOrTime = (value) => isoDate(value)??timestamp(value);
const key = (value) => typeof value==='string' && value.trim() && value.length<=200 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
const required = ()=>{throw new Error('invalid_map_response');};

function parseMapComparisons(value,ids){
  if(!Array.isArray(value))return required();
  const seen=new Set(ids);
  return rows(value).flatMap(item=>{
    const id=key(item.id);if(!id||!seen.has(id))return [];
    return [{id,name:safeText(item.name,id),kind:safeText(item.kind),scope:safeText(item.scope),denominator:nullable(item.denominator),sourceVersion:nullable(item.sourceVersion),sourceName:safeText(item.sourceName,'Source not reported'),sourceUrl:safeUrl(item.sourceUrl),backgroundUrl:safeUrl(item.backgroundUrl)??'',status:['available','withdrawn'].includes(String(item.status))?item.status:'unavailable',coverage:['complete','partial'].includes(String(item.coverage))?item.coverage:'unknown',coverageLabel:safeText(item.coverageLabel,'Coverage not reported'),values:rows(item.values).map(v=>({analyte:safeText(v.analyte),value:finite(v.value),unit:safeText(v.unit),observedAt:dayOrTime(v.observedAt),period:nullable(v.period),periodLabel:safeText(v.periodLabel,'Not reported'),method:nullable(v.method),qualifier:['reported','estimated','non-detect'].includes(String(v.qualifier))?v.qualifier:'unknown'}))}];
  });
}

// ------------------------------------- transcribed: map-preview.ts, copy subset

const compounds = [ ['overall', 'Overall water'], ['pfoa', 'PFOA'], ['pfos', 'PFOS'], ['pfhxs', 'PFHxS'], ['pfna', 'PFNA'], ['genx', 'GenX'], ['hazard', 'Hazard index'] ];
const c = {
  matched: 'Aligned evidence', limited: 'Limited comparison', unavailable: 'Not comparable',
  unknown: 'Not supplied',
  dateDifference: 'Observation dates differ. Read the dates before interpreting the values.',
  incomplete: 'Coverage is incomplete. These records do not describe all testing or all time periods.',
  scopeWater: 'Public water system', scopeAir: 'Monitoring station',
  waterEvidence: 'Reported water result', airEvidence: 'Hourly monitor observation',
  reasons: {
    same: 'Choose two different public records.', missing: 'A comparable value is missing.', status: 'A record is unavailable or withdrawn.',
    analyte: 'The analytes or pollutants differ.', units: 'The original units differ. No conversion is assumed.',
    period: 'The observation periods do not align.', date: 'An observation date is missing or invalid.', method: 'The methods are different or not supplied.',
    kind: 'The evidence kinds differ.', scope: 'The geographic scopes differ.',
    denominator: 'The comparison bases differ or are unknown.', source: 'Source versions differ or are unknown.',
    qualifier: 'An estimated, censored or unqualified value cannot be treated as an exact measurement.',
  },
};

// --------------------------------------- transcribed: map-comparison-preview.ts

function validObservationDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0,10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day;
}

function comparisonRows(first, second, compound) {
  const names = first.kind === c.airEvidence ? [first.values[0]?.analyte ?? c.unknown]
    : compound === 'overall' ? first.values.filter(value => value.unit !== 'index').map(value => value.analyte)
      : [compound === 'hazard' ? 'Hazard index' : compounds.find(item => item[0] === compound)?.[1] ?? c.unknown];
  return names.map(analyte => {
    const a = first.values.find(value => value.analyte === analyte);
    // Retain the actual second pollutant for explanation rather than substituting a missing same-pollutant value.
    const b = second.kind === c.airEvidence ? second.values[0] : second.values.find(value => value.analyte === analyte);
    return { analyte, first: a, second: b, ...compareEvidence(first, second, a, b) };
  });
}

function compareEvidence(first, second, a, b) {
  const reasons = [];
  const warnings = [];
  if (first.id === second.id) reasons.push(c.reasons.same);
  if (first.status !== 'available' || second.status !== 'available') reasons.push(c.reasons.status);
  if (!a || !b || a.value === null || b.value === null || !Number.isFinite(a.value) || !Number.isFinite(b.value)) reasons.push(c.reasons.missing);
  if (!a?.analyte || a.analyte !== b?.analyte) reasons.push(c.reasons.analyte);
  if (!a?.unit || a.unit !== b?.unit) reasons.push(c.reasons.units);
  if (!a?.period || a.period !== b?.period) reasons.push(c.reasons.period);
  if (!validObservationDate(a?.observedAt) || !validObservationDate(b?.observedAt)) reasons.push(c.reasons.date);
  if (!a?.method || a.method !== b?.method) reasons.push(c.reasons.method);
  if (!first.kind || first.kind !== second.kind) reasons.push(c.reasons.kind);
  if (!first.scope || first.scope !== second.scope) reasons.push(c.reasons.scope);
  if (!first.denominator || first.denominator !== second.denominator) reasons.push(c.reasons.denominator);
  if (!first.sourceVersion || first.sourceVersion !== second.sourceVersion) reasons.push(c.reasons.source);
  if (a?.qualifier !== 'reported' || b?.qualifier !== 'reported') reasons.push(c.reasons.qualifier);
  if (a?.observedAt !== b?.observedAt) warnings.push(c.dateDifference);
  if (first.coverage !== 'complete' || second.coverage !== 'complete') warnings.push(c.incomplete);
  return { compatible: reasons.length === 0, reasons, warnings };
}

// ------------------------------------------ transcribed: MapComparison.tsx:64

const rowLabel = (row) => row.compatible ? (row.warnings.length ? c.limited : c.matched) : c.unavailable;

// ------------------------------------------------------------------- fixtures

const NOW = new Date().toISOString();
const reading = (date, ppt) => [{ date, value_ppt: ppt }];
/**
 * Two systems with IDENTICAL readings on the same day: the most alignable pair
 * the data can hold, so only missing provenance can keep them apart. A third
 * with a different date, a fourth with a null value, and a fifth in 2024Q1.
 */
const SAME = { PFOA: reading('8/20/2024', 4.1), PFOS: reading('8/20/2024', 7.7), PFHxS: reading('8/20/2024', 2), PFNA: reading('8/20/2024', 3), 'HFPO-DA (GenX)': reading('8/20/2024', 12) };
const UTILITIES = [
  { pwsid: 'NC9500001', pws_name: 'Twin A Water', status: 'Final', contaminants: SAME },
  { pwsid: 'NC9500002', pws_name: 'Twin B Water', status: 'Final', contaminants: SAME },
  { pwsid: 'NC9500003', pws_name: 'Later Water', status: 'Final', contaminants: { PFOS: reading('9/2/2024', 7.7), PFOA: reading('9/2/2024', 4.1) } },
  { pwsid: 'NC9500004', pws_name: 'Null Water', status: 'Final', contaminants: { PFOA: [{ date: '8/20/2024', value_ppt: null }] } },
  { pwsid: 'NC9500005', pws_name: 'Spring Water', status: 'Final', contaminants: { PFNA: reading('3/15/2024', 3) } },
];
const WATER_IDS = UTILITIES.map((u) => u.pwsid);
const waterLayer = (assembledAt = NOW) => ({ layer: 'water', assembled_at: assembledAt, payload: { layer: 'water', features: assembleWaterFeatures(UTILITIES), assembled_at: assembledAt } });

/** Two stations with the same pollutant, hour and AQI, and one with a different pollutant. */
const AIRNOW = [
  { FullAQSCode: '371790003', SiteName: 'Monroe', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T14:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'North Carolina DAQ' },
  { FullAQSCode: '370250004', SiteName: 'Concord', Latitude: 35.41, Longitude: -80.58, UTC: '2026-10-18T14:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'North Carolina DAQ' },
  { FullAQSCode: '371190041', SiteName: 'Garinger', Latitude: 35.24, Longitude: -80.79, UTC: '2026-10-18T14:00', Parameter: 'OZONE', AQI: 30, AgencyName: 'Mecklenburg County' },
];
const AIR_IDS = ['371790003', '370250004', '371190041'];
async function airLayer() {
  const fetchImpl = async (url) => {
    if (!String(url).startsWith('https://www.airnowapi.org/aq/data/?')) throw new TypeError('unexpected host');
    return { ok: true, json: async () => AIRNOW };
  };
  const payload = await airPayload({ fetchImpl, apiKey: 'test-key', now: new Date('2026-10-18T15:00:00Z') });
  return { layer: 'air', assembled_at: payload.assembled_at, payload };
}

const TABLES = haloTables('profiles', 'map_layers', 'ucmr5_utilities');
function harness({ layers = [], utilities = UTILITIES, tables = TABLES } = {}) {
  return createRouteHarness({
    tables,
    seed: ({ alice, bob }) => Object.fromEntries(Object.entries({
      map_layers: layers,
      ucmr5_utilities: utilities,
      profiles: [{ id: alice.id, county: 'Union County' }, { id: bob.id, county: 'Wake County' }],
    }).filter(([table]) => table in tables)),
  });
}

/** Builds the query exactly as the client's runtime does (F: runtime.ts:125-129). */
function urlFor(params) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
  return `/api/map/comparison${query.size ? `?${query}` : ''}`;
}
const compare = (h, params, as = 'alice') => h.call('/api/map/comparison', 'GET', { as, url: urlFor(params) });
const tablesRead = (h) => [...new Set(h.db.queryLog.map((q) => q.table))].sort();
const noFetches = (h) => assert.deepEqual(h.blockedFetches, [], 'the route made no outbound call');

/** D10 and the em dash rule. */
function assertBare(body) {
  assert.deepEqual(Object.keys(body), ['records'], 'the body is bare { records }, no data key (F: runtime.ts:149-153)');
  const text = JSON.stringify(body);
  assert.equal(text.includes('\u2014'), false, 'no U+2014 in any readable string');
  assert.equal(text.includes('\\u2014'), false);
}
async function records(h, params, as) {
  const res = await compare(h, params, as);
  assert.equal(res.status, 200, `${urlFor(params)} answered ${res.status}`);
  const body = await res.json();
  assertBare(body);
  return body.records;
}

/**
 * THE HONESTY TEST. Every ordered pair (a record with itself included) and
 * every compound, through the client's parser and compatibility rule.
 */
function assertNeverComparable(body, ids) {
  const parsed = parseMapComparisons(body, ids);
  assert.equal(parsed.length, body.length, 'the client keeps every record the route returned');
  assert.ok(parsed.length >= 2, 'fixture: at least one real pair');
  let checked = 0;
  for (const first of parsed) {
    assert.equal(first.coverage, 'partial');
    assert.equal(first.sourceVersion, null);
    assert.equal(first.sourceName, 'Source not reported', 'no source name is sent, so the client names no release');
    for (const second of parsed) {
      for (const [compound] of compounds) {
        const rowsFor = comparisonRows(first, second, compound);
        assert.ok(rowsFor.length > 0);
        for (const row of rowsFor) {
          const where = `${first.id} vs ${second.id}, ${compound}, ${row.analyte}`;
          assert.equal(row.compatible, false, `${where} must not be compatible`);
          for (const reason of ['method', 'source', 'qualifier']) assert.ok(row.reasons.includes(c.reasons[reason]), `${where}: the ${reason} reason`);
          assert.ok(row.warnings.includes(c.incomplete), `${where}: the incomplete-coverage warning`);
          assert.equal(rowLabel(row), c.unavailable, `${where} renders Not comparable`);
          assert.notEqual(rowLabel(row), c.matched);
          assert.notEqual(rowLabel(row), c.limited);
          checked += 1;
        }
      }
    }
  }
  return checked;
}

// ---------------------------------------------- the transcription is not vacuous

test('the transcription says Aligned when the evidence aligns, and rejects what the client rejects', () => {
  const value = { analyte: 'PFOS', value: 7.7, unit: 'ppt', observedAt: '2024-08-20', period: '2024Q3', periodLabel: 'Q3 2024', method: 'EPA 533', qualifier: 'reported' };
  const authored = (id) => ({ id, name: id, kind: c.waterEvidence, scope: c.scopeWater, denominator: 'basis', sourceVersion: 'release-1', sourceName: 's', sourceUrl: null, backgroundUrl: 'https://www.epa.gov/dwucmr', status: 'available', coverage: 'complete', coverageLabel: 'all', values: [value] });
  const [a, b] = parseMapComparisons([authored('A'), authored('B')], ['A', 'B']);
  const aligned = compareEvidence(a, b, a.values[0], b.values[0]);
  assert.deepEqual(aligned, { compatible: true, reasons: [], warnings: [] });
  assert.equal(rowLabel(aligned), c.matched, 'the transcribed rule can say Aligned');
  assert.equal(rowLabel(comparisonRows(a, { ...b, coverage: 'partial' }, 'pfos')[0]), c.limited, 'and Limited');
  // Each single provenance field the backend withholds is, on its own, enough to refuse.
  const without = (patch, valuePatch = {}) => { const next = { ...b, ...patch, values: [{ ...b.values[0], ...valuePatch }] }; return compareEvidence(a, next, a.values[0], next.values[0]); };
  assert.deepEqual(without({}, { method: null }).reasons, [c.reasons.method]);
  assert.deepEqual(without({ sourceVersion: null }).reasons, [c.reasons.source]);
  assert.deepEqual(without({}, { qualifier: 'unknown' }).reasons, [c.reasons.qualifier]);
  assert.deepEqual(without({ denominator: null }).reasons, [c.reasons.denominator]);
  assert.deepEqual(without({ scope: 'Different geographic scope' }).reasons, [c.reasons.scope]);
  assert.deepEqual(compareEvidence(a, a, a.values[0], a.values[0]).reasons, [c.reasons.same]);
  // The parser: only an array, only requested ids, and every unknown word coerced to its refusal.
  for (const bad of [{}, null, 'records', 1]) assert.throws(() => parseMapComparisons(bad, ['A']), /invalid_map_response/);
  assert.deepEqual(parseMapComparisons([authored('A'), authored('C'), { ...authored('A'), id: 7 }, { ...authored('A'), id: 'A\u0001' }, 'A'], ['A']).map((r) => r.id), ['A']);
  const [coerced] = parseMapComparisons([{ ...authored('A'), coverage: 'full', status: 'live', values: [{ ...value, qualifier: 'exact', value: '7.7', method: '  ' }] }], ['A']);
  assert.deepEqual([coerced.coverage, coerced.status, coerced.values[0].qualifier, coerced.values[0].value, coerced.values[0].method], ['unknown', 'unavailable', 'unknown', null, null]);
});

// ------------------------------------------------------------ the honesty test

test('HONESTY: water latest from the stored layer, every pair and compound is Not comparable with its reasons', async () => {
  const h = harness({ layers: [waterLayer()] });
  const body = await records(h, { layer: 'water', quarter: 'latest', ids: WATER_IDS });
  assert.deepEqual(body.map((r) => r.id), WATER_IDS);
  // 5 x 5 ordered pairs; 'overall' gives five rows, each other compound one.
  assert.equal(assertNeverComparable(body, WATER_IDS), 25 * (5 + 6));
  assert.deepEqual(tablesRead(h), ['map_layers']);
  noFetches(h);
});

test('HONESTY: water by quarter, and water with no stored layer, from the UCMR 5 table', async () => {
  const quarter = harness();
  const q3 = await records(quarter, { layer: 'water', quarter: '2024Q3', ids: WATER_IDS });
  assert.deepEqual(q3.map((r) => r.id), ['NC9500001', 'NC9500002', 'NC9500003', 'NC9500004']);
  assertNeverComparable(q3, WATER_IDS);
  const latest = harness();
  const all = await records(latest, { layer: 'water', quarter: 'latest', ids: WATER_IDS });
  assert.equal(all.length, 5);
  assertNeverComparable(all, WATER_IDS);
  noFetches(quarter);
  noFetches(latest);
});

test('HONESTY: air from the stored layer, same pollutant, hour and AQI is still Not comparable', async () => {
  const h = harness({ layers: [await airLayer()] });
  const body = await records(h, { layer: 'air', quarter: 'latest', ids: AIR_IDS });
  assert.deepEqual(body.map((r) => [r.id, r.values[0].analyte, r.values[0].value]), [['371790003', 'PM2.5', 61], ['370250004', 'PM2.5', 61], ['371190041', 'O3', 30]]);
  assertNeverComparable(body, AIR_IDS);
  assert.deepEqual(tablesRead(h), ['map_layers']);
  noFetches(h);
});

test('HONESTY: the pure records themselves, before any route, are never comparable', () => {
  assertNeverComparable(comparisonRecords('water', assembleWaterFeatures(UTILITIES)), WATER_IDS);
});

// ---------------------------------------------------------- the D3 values reach the client

test('the water records reach the client with the D3 values and the copy literal scope (F2)', async () => {
  const h = harness({ layers: [waterLayer()] });
  const parsed = parseMapComparisons(await records(h, { layer: 'water', quarter: 'latest', ids: WATER_IDS }), WATER_IDS);
  for (const r of parsed) {
    assert.equal(r.scope, c.scopeWater, 'MapComparison.tsx:36 keys the compound selector on this string');
    assert.equal(COMPARISON_COPY.scopeWater, c.scopeWater);
    assert.equal(r.kind, c.waterEvidence);
    assert.deepEqual([r.status, r.coverage, r.sourceVersion, r.sourceUrl, r.backgroundUrl], ['available', 'partial', null, null, 'https://www.epa.gov/dwucmr']);
    assert.ok(r.values.every((v) => v.method === null && v.qualifier === 'unknown' && v.unit === 'ppt'));
    assert.equal(r.values.some((v) => v.analyte === 'Hazard index'), false, 'no hazard-index entry');
  }
  const nullWater = parsed.find((r) => r.id === 'NC9500004');
  assert.equal(nullWater.values.find((v) => v.analyte === 'PFOA').value, null, 'a null value_ppt is null, never 0');
  const twin = parsed.find((r) => r.id === 'NC9500001');
  assert.deepEqual(twin.values.map((v) => [v.analyte, v.value, v.observedAt]), [['PFOA', 4.1, '2024-08-20'], ['PFOS', 7.7, '2024-08-20'], ['PFHxS', 2, '2024-08-20'], ['PFNA', 3, '2024-08-20'], ['GenX', 12, '2024-08-20']]);
});

// ------------------------------------------------------------------- data sources

test('water by quarter keeps only that quarter\'s readings, and reads only the UCMR 5 table', async () => {
  const h = harness({ layers: [waterLayer()] });
  const spring = await records(h, { layer: 'water', quarter: '2024Q1', ids: WATER_IDS });
  assert.deepEqual(spring.map((r) => [r.id, r.values.filter((v) => v.value !== null).map((v) => v.analyte)]), [['NC9500005', ['PFNA']]]);
  assert.deepEqual(tablesRead(h), ['ucmr5_utilities'], 'a quarter is never answered from the latest stored layer');
  assert.deepEqual(await records(h, { layer: 'water', quarter: '2023Q1', ids: WATER_IDS }), [], 'a quarter with no readings is a true empty answer');
  noFetches(h);
});

test('water latest with no stored layer, or a stale one, answers from the UCMR 5 table with no geography lookup', async () => {
  for (const layers of [[], [waterLayer('2020-01-01T00:00:00.000Z')]]) {
    const h = harness({ layers });
    const body = await records(h, { layer: 'water', quarter: 'latest', ids: WATER_IDS });
    assert.equal(body.length, 5);
    assert.deepEqual(tablesRead(h), ['map_layers', 'ucmr5_utilities']);
    noFetches(h);
  }
});

test('water with neither a stored layer nor a readable UCMR 5 table is a 503, with no outbound call', async (t) => {
  muteConsoleError(t);
  const h = harness({ tables: haloTables('profiles', 'map_layers') });
  await expectEnvelope(await compare(h, { layer: 'water', quarter: 'latest', ids: WATER_IDS }), { status: 503, code: 'upstream_unavailable', retryable: true });
  noFetches(h);
});

test('air with no stored layer, or a stale one, is a 503: never a live AirNow build, and never an old hour served as the latest', async () => {
  const staleAirLayer = { ...(await airLayer()), assembled_at: '2020-01-01T00:00:00.000Z' };
  for (const layers of [[], [staleAirLayer]]) {
    const h = harness({ layers });
    await expectEnvelope(await compare(h, { layer: 'air', quarter: 'latest', ids: AIR_IDS }), { status: 503, code: 'upstream_unavailable', retryable: true });
    assert.deepEqual(tablesRead(h), ['map_layers']);
    noFetches(h);
  }
});

for (const layer of ['facilities', 'radon']) {
  test(`${layer} supplies no comparable observation: { records: [] }, nothing read`, async () => {
    const h = harness({ layers: [waterLayer()] });
    assert.deepEqual(await records(h, { layer, quarter: 'latest', ids: ['110000000001', 'Union County'] }), []);
    assert.deepEqual(h.db.queryLog, []);
    noFetches(h);
  });
}

test('only the requested ids that exist are returned; unknown ids are omitted', async () => {
  const h = harness({ layers: [waterLayer()] });
  const body = await records(h, { layer: 'water', quarter: 'latest', ids: ['NC9500002', 'NC0000000', ' NC9500004 ', 'NC9500002'] });
  assert.deepEqual(body.map((r) => r.id), ['NC9500002', 'NC9500004']);
  assert.deepEqual(await records(h, { layer: 'water', quarter: 'latest', ids: ['NC0000000'] }), []);
});

test('2,000 ids is accepted, and quarter=latest is answered exactly like a missing quarter', async () => {
  const h = harness({ layers: [waterLayer()] });
  const ids = [...WATER_IDS, ...Array.from({ length: 2000 - WATER_IDS.length }, (_, i) => `NC8${String(i).padStart(6, '0')}`)];
  assert.equal(ids.length, 2000);
  const many = await records(h, { layer: 'water', quarter: 'latest', ids });
  assert.equal(many.length, 5);
  assert.deepEqual(await records(h, { layer: 'water', ids: WATER_IDS }), many);
  const air = harness({ layers: [await airLayer()] });
  assert.deepEqual(await records(air, { layer: 'air', ids: AIR_IDS }), await records(air, { layer: 'air', quarter: 'latest', ids: AIR_IDS }));
});

// ------------------------------------------------------------------- validation

const ONE = JSON.stringify(['NC9500001']);
const INVALID = [
  ['a layer the map does not have', { layer: 'district', quarter: 'latest', ids: ONE }, 'layer', 'invalid_option'],
  ['a missing layer', { quarter: 'latest', ids: ONE }, 'layer', 'invalid_option'],
  ['a layer in the wrong case', { layer: 'Water', quarter: 'latest', ids: ONE }, 'layer', 'invalid_option'],
  ['a malformed quarter', { layer: 'water', quarter: '2024Q5', ids: ONE }, 'quarter', 'invalid_quarter'],
  ['Latest, not latest', { layer: 'water', quarter: 'Latest', ids: ONE }, 'quarter', 'invalid_quarter'],
  ['a quarter on air', { layer: 'air', quarter: '2024Q3', ids: ONE }, 'quarter', 'quarter_not_applicable'],
  ['a malformed quarter on air (applicability first, D2)', { layer: 'air', quarter: 'soon', ids: ONE }, 'quarter', 'quarter_not_applicable'],
  ['no ids', { layer: 'water', quarter: 'latest' }, 'ids', 'ids_required'],
  ['malformed JSON', { layer: 'water', quarter: 'latest', ids: '[NC9500001' }, 'ids', 'invalid_json'],
  ['a JSON object', { layer: 'water', quarter: 'latest', ids: '{"id":"NC9500001"}' }, 'ids', 'invalid_ids'],
  ['a bare string', { layer: 'water', quarter: 'latest', ids: '"NC9500001"' }, 'ids', 'invalid_ids'],
  ['an empty array', { layer: 'water', quarter: 'latest', ids: '[]' }, 'ids', 'invalid_ids'],
  ['2,001 ids', { layer: 'water', quarter: 'latest', ids: JSON.stringify(Array.from({ length: 2001 }, (_, i) => `NC${i}`)) }, 'ids', 'too_many_ids'],
  ['a numeric id', { layer: 'water', quarter: 'latest', ids: '["NC9500001",9500002]' }, 'ids', 'invalid_id'],
  ['a control character', { layer: 'water', quarter: 'latest', ids: JSON.stringify(['NC95\u000100001']) }, 'ids', 'invalid_id'],
  ['a 201-character id', { layer: 'water', quarter: 'latest', ids: JSON.stringify(['N'.repeat(201)]) }, 'ids', 'invalid_id'],
];
for (const [name, params, field, code] of INVALID) {
  test(`400 for ${name}, before anything is read`, async () => {
    const h = harness({ layers: [waterLayer()] });
    const res = await h.call('/api/map/comparison', 'GET', { as: 'alice', url: urlFor(params) });
    const body = await expectEnvelope(res, { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [[field, code]]);
    assert.equal(JSON.stringify(body).includes('\u2014'), false);
    assert.deepEqual(h.db.queryLog, []);
    noFetches(h);
  });
}

// ------------------------------------------------------- auth and isolation

test('a missing session is a 401 (the same rule as /api/map until a public-read decision, D1)', async () => {
  const h = harness({ layers: [waterLayer()] });
  await expectEnvelope(await compare(h, { layer: 'water', quarter: 'latest', ids: WATER_IDS }, null), { status: 401, code: 'auth_required' });
  assert.deepEqual(h.db.queryLog, []);
});

test('reads no household table: two households get the identical answer, from public tables only', async () => {
  const h = harness();
  const params = { layer: 'water', quarter: 'latest', ids: WATER_IDS };
  assert.deepEqual(await records(h, params, 'alice'), await records(h, params, 'bob'));
  const air = harness({ layers: [await airLayer()] });
  assert.deepEqual(await records(air, { layer: 'air', quarter: 'latest', ids: AIR_IDS }, 'alice'), await records(air, { layer: 'air', quarter: 'latest', ids: AIR_IDS }, 'bob'));
  for (const table of [...tablesRead(h), ...tablesRead(air)]) assert.ok(['map_layers', 'ucmr5_utilities'].includes(table), `${table} is a public table`);
  noFetches(h);
  noFetches(air);
});
