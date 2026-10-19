/**
 * B05 Task 5: lib/mapComparison.js, the honestly degraded comparison records
 * (ruling D3). The client-side proof that no pair can render "Aligned
 * evidence" is the honesty test in test/routesMapComparison.test.mjs; this file
 * pins the exact values that test relies on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comparisonRecords,
  parseComparisonIds,
  comparisonKey,
  COMPARISON_COPY,
  WATER_ANALYTES,
  MAX_COMPARISON_IDS,
} from '../lib/mapComparison.js';
import { assembleWaterFeatures } from '../lib/mapData.js';
import { parseAirNowStations } from '../lib/mapLayers.js';

const reading = (date, ppt) => [{ date, value_ppt: ppt }];
const UTILITIES = [
  { pwsid: 'NC0100001', pws_name: 'Monroe Test Water', status: 'Final', contaminants: { PFOS: reading('8/20/2024', 7.7), PFOA: reading('8/20/2024', 1.2), PFHxS: reading('8/20/2024', 4), 'HFPO-DA (GenX)': reading('8/20/2024', 12) } },
  { pwsid: 'NC0100002', pws_name: 'Albemarle Test Water', status: 'Final', contaminants: { PFNA: reading('3/15/2024', 3) } },
];
const STATIONS = parseAirNowStations([
  { FullAQSCode: '371790003', SiteName: 'Monroe', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T14:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'North Carolina DAQ' },
  { FullAQSCode: '370250004', SiteName: 'Concord', Latitude: 35.41, Longitude: -80.58, UTC: '2026-10-18T14:00', Parameter: 'OZONE', AQI: 30, AgencyName: 'North Carolina DAQ' },
]);

/** The provenance D3 fixes on every record and every value. */
function assertFixedProvenance(record) {
  assert.equal(record.status, 'available');
  assert.equal(record.coverage, 'partial', 'never complete: HALO does not know the testing coverage');
  assert.equal(record.sourceVersion, null, 'no source version is composed');
  assert.equal(record.sourceUrl, null);
  for (const value of record.values) {
    assert.equal(value.method, null, 'no method is composed');
    assert.equal(value.qualifier, 'unknown', 'no value is claimed to be an exact reported measurement');
  }
}

test('water records carry exactly the D3 values, from the copy literals', () => {
  const [monroe, albemarle] = comparisonRecords('water', assembleWaterFeatures(UTILITIES));
  const { values, ...rest } = monroe;
  assert.deepEqual(rest, {
    id: 'NC0100001',
    name: 'Monroe Test Water',
    kind: 'Reported water result',
    scope: 'Public water system',
    denominator: 'One reported result per compound and system, not an annual average.',
    sourceName: 'Water monitoring release',
    backgroundUrl: 'https://www.epa.gov/dwucmr',
    coverageLabel: 'Detection-only release. Complete testing coverage is unknown.',
    sourceVersion: null,
    sourceUrl: null,
    status: 'available',
    coverage: 'partial',
  });
  const value = (analyte, v, date) => ({ analyte, value: v, unit: 'ppt', observedAt: date, period: date, periodLabel: date ?? 'Not supplied', method: null, qualifier: 'unknown' });
  assert.deepEqual(values, [
    value('PFOA', 1.2, '2024-08-20'),
    value('PFOS', 7.7, '2024-08-20'),
    value('PFHxS', 4, '2024-08-20'),
    value('PFNA', null, null),
    value('GenX', 12, '2024-08-20'),
  ]);
  assert.deepEqual(albemarle.values.map((v) => [v.analyte, v.value]), [['PFOA', null], ['PFOS', null], ['PFHxS', null], ['PFNA', 3], ['GenX', null]]);
  assertFixedProvenance(monroe);
  assertFixedProvenance(albemarle);
});

test('F2: the water scope is the literal copy string the compound selector is keyed on', () => {
  for (const record of comparisonRecords('water', assembleWaterFeatures(UTILITIES))) {
    assert.equal(record.scope, 'Public water system');
    assert.equal(record.scope, COMPARISON_COPY.scopeWater);
  }
});

test('a null value_ppt is value null, never 0, and a missing reading is not a zero either', () => {
  const features = [{ pwsid: 'NC0100009', name: 'Null Water', contaminants: { PFOA: { value_ppt: null, date_iso: '2024-01-10' }, PFOS: { severity: 'no_data' }, PFNA: { value_ppt: Number.NaN } } }];
  const [record] = comparisonRecords('water', features);
  assert.deepEqual(record.values.map((v) => v.value), [null, null, null, null, null]);
  assert.equal(record.values.some((v) => v.value === 0), false);
  assert.equal(record.values[0].observedAt, '2024-01-10', 'the reading date is kept even without a value');
  // A real zero reading is a reading, and stays 0.
  const [zero] = comparisonRecords('water', [{ pwsid: 'NC0100010', contaminants: { PFOA: { value_ppt: 0, date_iso: '2024-01-10' } } }]);
  assert.equal(zero.values[0].value, 0);
});

test('there is no hazard-index entry, even for a system the map gives a hazard index', () => {
  const [feature] = assembleWaterFeatures(UTILITIES);
  assert.ok(feature.hazard_index, 'fixture: the map computes a hazard index for this system');
  const [record] = comparisonRecords('water', [feature]);
  assert.deepEqual(record.values.map((v) => v.analyte), WATER_ANALYTES.map(([, label]) => label));
  assert.equal(record.values.some((v) => /hazard/i.test(v.analyte) || v.unit === 'index'), false);
});

test('air records: dominant pollutant, AQI, station reading time, the air copy and the same fixed provenance', () => {
  const [monroe, concord] = comparisonRecords('air', STATIONS);
  const { values, ...rest } = monroe;
  assert.deepEqual(rest, {
    id: '371790003',
    name: 'Monroe',
    kind: 'Hourly monitor observation',
    scope: 'Monitoring station',
    denominator: 'One station\u2019s reported AQI for its dominant pollutant and hour.',
    sourceName: 'Air monitoring release',
    backgroundUrl: 'https://www.airnow.gov/',
    coverageLabel: 'One hourly observation. Continuous coverage is not supplied.',
    sourceVersion: null,
    sourceUrl: null,
    status: 'available',
    coverage: 'partial',
  });
  assert.deepEqual(values, [{ analyte: 'PM2.5', value: 61, unit: 'AQI', observedAt: '2026-10-18T14:00:00Z', period: '2026-10-18T14:00:00Z', periodLabel: '2026-10-18T14:00:00Z', method: null, qualifier: 'unknown' }]);
  assert.equal(concord.values[0].analyte, 'O3');
  assertFixedProvenance(monroe);
  assertFixedProvenance(concord);
  const [blank] = comparisonRecords('air', [{ id: 'S1', aqi: null, dominant_pollutant: null, last_reading_at: null }]);
  assert.deepEqual([blank.values[0].analyte, blank.values[0].value, blank.values[0].observedAt], [null, null, null]);
});

test('facilities, radon and anything else give no records; malformed features are skipped, duplicates kept once', () => {
  assert.deepEqual(comparisonRecords('facilities', [{ id: 'F1', name: 'Plant' }]), []);
  assert.deepEqual(comparisonRecords('radon', [{ county: 'Union County', zone: 1 }]), []);
  assert.deepEqual(comparisonRecords('district', [{ pwsid: 'NC1' }]), []);
  assert.deepEqual(comparisonRecords('water', null), []);
  const records = comparisonRecords('water', [null, 'NC1', { pwsid: 12 }, { pwsid: ' NC1 ' }, { pwsid: 'NC1', name: 'Second' }, { pwsid: 'NC\u00012' }]);
  assert.deepEqual(records.map((r) => [r.id, r.name]), [['NC1', 'NC1']]);
});

test('no record or copy string carries U+2014', () => {
  const text = JSON.stringify([comparisonRecords('water', assembleWaterFeatures(UTILITIES)), comparisonRecords('air', STATIONS), COMPARISON_COPY]);
  assert.equal(text.includes('\u2014'), false);
});

test('parseComparisonIds: one JSON array of 1 to 2,000 ids, each passing the client key() rule', () => {
  assert.deepEqual([...parseComparisonIds('["NC1"," NC2 ","NC1"]').ids], ['NC1', 'NC2']);
  assert.equal(parseComparisonIds(JSON.stringify(Array.from({ length: MAX_COMPARISON_IDS }, (_, i) => `NC${i}`))).ok, true);
  assert.equal(parseComparisonIds(JSON.stringify(['x'.repeat(200)])).ok, true);
  const code = (raw) => parseComparisonIds(raw).code;
  assert.equal(code(null), 'ids_required');
  assert.equal(code(''), 'ids_required');
  assert.equal(code('[NC1]'), 'invalid_json');
  assert.equal(code('{"0":"NC1"}'), 'invalid_ids');
  assert.equal(code('"NC1"'), 'invalid_ids');
  assert.equal(code('[]'), 'invalid_ids');
  assert.equal(code(JSON.stringify(Array.from({ length: MAX_COMPARISON_IDS + 1 }, (_, i) => `NC${i}`))), 'too_many_ids');
  assert.equal(code('[1]'), 'invalid_id');
  assert.equal(code('[null]'), 'invalid_id');
  assert.equal(code('["  "]'), 'invalid_id');
  assert.equal(code(JSON.stringify(['NC\u00011'])), 'invalid_id');
  assert.equal(code(JSON.stringify(['x'.repeat(201)])), 'invalid_id');
  assert.equal(comparisonKey('NC\u001f'), null);
});
