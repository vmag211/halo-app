// Water evidence categories (audit F01, F02). Missing, invalid, documented non-detect,
// partial panel and over-limit results each keep their own meaning from the scoring engine
// through the map feature, the parsed map record and the HomeGuard composite. None may
// inherit another's: in particular an empty or unusable record is never Good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWaterRisk, getHomeGuardScore, getRadonRisk, classifyWaterReading } from '../lib/scoring.js';
import { waterDetailSeverity, compositeSeverity } from '../lib/severity.js';
import { waterConfidence } from '../lib/waterPresentation.js';
import { assembleWaterFeatures, waterCounts } from '../lib/mapData.js';
import { computeDistrict } from '../lib/district.js';
import { buildDistrictView } from '../lib/districtView.js';
import { loadFrontend } from './frontend-test-loader.mjs';

const { waterSeverity, waterMapReading, compoundReadingText } = await loadFrontend('map-preview');
const { parseMapLayer, parseMapDistrict } = await loadFrontend('map-service');
const { findMapRecords } = await loadFrontend('map-tools');

const radonZone3 = getRadonRisk(3);

/** Everything a household or map viewer would see for one record. */
function evaluate(contaminants) {
  const detail = getWaterRisk(contaminants);
  const [feature] = assembleWaterFeatures([{ pwsid: 'NC0000001', pws_name: 'Test Water', status: 'measured', contaminants }]);
  const parsed = parseMapLayer({ layer: 'water', features: [feature] }, 'water').water[0];
  const home = getHomeGuardScore({ waterRisk: detail.risk, radonRisk: radonZone3, waterCoverage: detail.coverage });
  return {
    detail,
    feature,
    parsed,
    home,
    severity: waterDetailSeverity(detail),
    mapSeverity: waterSeverity(parsed, 'overall'),
    mapReading: waterMapReading(parsed, 'overall'),
    homeSeverity: compositeSeverity(home, { water: waterDetailSeverity(detail), radon: 'good' }),
  };
}

// The composite with no water at all: what missing water must look like.
const radonOnly = getHomeGuardScore({ waterRisk: null, radonRisk: radonZone3, waterCoverage: null });

test('an empty contaminant object is unknown everywhere, never Good, and leaves the home score as if water were absent', () => {
  const e = evaluate({});
  assert.equal(e.detail.risk, null);
  assert.equal(e.detail.coverage, 'no_data');
  assert.equal(e.detail.no_data_reason, 'no_results');
  assert.equal(e.detail.has_data, false);
  assert.equal(e.severity, 'no_data');
  assert.equal(waterConfidence(e.detail.coverage, 10), 'none');
  assert.equal(e.feature.overall_severity, 'no_data');
  assert.equal(e.mapSeverity, 'no_data');
  assert.equal(e.mapReading, 'No comparable result');
  for (const reading of Object.values(e.parsed.contaminants)) {
    assert.equal(reading.result, 'no_result');
    assert.equal(reading.severity, 'no_data');
    assert.equal(compoundReadingText(reading), 'No result in this source', 'missing is never worded as not detected');
  }
  assert.deepEqual(e.detail.regulated_panel.no_result, ['PFOA', 'PFOS', 'PFHxS', 'PFNA', 'HFPO-DA']);
  // Neither better nor worse than having no water record: water is left out, not scored as clean.
  assert.equal(e.home.display_score, radonOnly.display_score);
  assert.ok(e.home.missing_inputs.includes('water'));
  assert.equal(e.home.is_partial, true);
  assert.deepEqual(getWaterRisk(null).risk, null);
  assert.equal(getWaterRisk(null).no_data_reason, 'not_supplied');
});

test('an empty compound list is no result, not a non-detect', () => {
  const e = evaluate({ PFOA: [] });
  assert.equal(e.detail.coverage, 'no_data');
  assert.equal(e.detail.risk, null);
  assert.equal(e.parsed.contaminants.PFOA.result, 'no_result');
  assert.equal(e.mapSeverity, 'no_data');
});

test('an invalid result is unusable: it neither scores as zero nor counts as tested', () => {
  for (const bad of [{ value_ppt: 'abc', date: '7/1/2025' }, { value_ppt: Number.NaN }, { value_ppt: -2 }, { non_detect: true, value_ppt: 3 }, null]) {
    assert.equal(classifyWaterReading(bad), 'invalid', JSON.stringify(bad));
  }
  const contaminants = { PFOA: [{ value_ppt: 'abc', date: '7/1/2025' }], PFOS: [{ value_ppt: -2, date: '7/1/2025' }], PFNA: 'garbage' };
  const e = evaluate(contaminants);
  assert.equal(e.detail.risk, null);
  assert.equal(e.detail.coverage, 'no_data');
  assert.equal(e.detail.no_data_reason, 'invalid_results');
  assert.deepEqual(e.detail.invalid_results.sort(), ['PFNA', 'PFOA', 'PFOS']);
  assert.equal(e.detail.reading_count, 0, 'an invalid reading is not a sample');
  assert.equal(e.severity, 'no_data');
  assert.equal(e.mapSeverity, 'no_data');
  assert.equal(e.parsed.contaminants.PFOA.result, 'invalid');
  assert.equal(compoundReadingText(e.parsed.contaminants.PFOA), 'Result could not be read');
  assert.equal(e.home.display_score, radonOnly.display_score);
  // The district never counts it as a system with a numeric result.
  assert.equal(computeDistrict([{ pwsid: 'x', contaminants }]).systems_with_numeric_result, 0);
});

test('a documented non-detect keeps its sample date and reporting limit, and is Good only when that limit is at or below the comparison limit', () => {
  const below = { PFOA: [{ non_detect: true, reporting_limit_ppt: 4, date: '3/4/2024' }] };
  const e = evaluate(below);
  assert.equal(e.detail.coverage, 'no_detections');
  assert.equal(e.detail.risk, 0);
  assert.deepEqual(e.detail.scored, [], 'a non-detect is not a numeric result');
  assert.equal(e.detail.non_detects[0].reporting_limit_ppt, 4);
  assert.equal(e.detail.non_detects[0].below_limit, true);
  assert.equal(e.detail.latest_sample_date, '3/4/2024');
  assert.equal(e.severity, 'good');
  const pfoa = e.parsed.contaminants.PFOA;
  assert.equal(pfoa.result, 'non_detect');
  assert.equal(pfoa.reporting_limit_ppt, 4);
  assert.equal(pfoa.date_iso, '2024-03-04');
  assert.equal(pfoa.value_ppt, undefined);
  assert.equal(compoundReadingText(pfoa), 'Not detected (reporting limit 4 ppt)');
  assert.equal(waterSeverity(e.parsed, 'pfoa'), 'good');
  assert.equal(e.detail.regulated_panel.complete, false, 'one non-detect is not a full panel');
  assert.deepEqual(e.detail.regulated_panel.non_detect, ['PFOA']);

  // A reporting limit above the comparison limit cannot show the result is below it.
  const high = evaluate({ PFOA: [{ non_detect: true, reporting_limit_ppt: 20, date: '3/4/2024' }] });
  assert.equal(high.detail.non_detects[0].below_limit, false);
  assert.equal(high.detail.coverage, 'no_data');
  assert.equal(high.detail.risk, null);
  assert.equal(high.parsed.contaminants.PFOA.severity, 'no_data');
  assert.equal(high.mapSeverity, 'no_data');

  // An unknown reporting limit is a non-detect, but not a comparison.
  const unknown = evaluate({ PFOA: [{ non_detect: true, date: '3/4/2024' }] });
  assert.equal(unknown.detail.non_detects[0].reporting_limit_ppt, null);
  assert.equal(unknown.detail.risk, null);
  assert.equal(compoundReadingText(unknown.parsed.contaminants.PFOA), 'Not detected (reporting limit not supplied)');

  // A non-detect is not a numeric result for the district share either.
  assert.equal(computeDistrict([{ pwsid: 'x', contaminants: below }]).systems_with_numeric_result, 0);
});

test('a partial panel scores only what was measured and says the rest is missing', () => {
  const contaminants = { PFOA: [{ value_ppt: 1, date: '7/1/2025' }], PFOS: [{ non_detect: true, reporting_limit_ppt: 4, date: '7/1/2025' }] };
  const e = evaluate(contaminants);
  const onlyPfoa = getWaterRisk({ PFOA: [{ value_ppt: 1, date: '7/1/2025' }] });
  assert.equal(e.detail.risk, onlyPfoa.risk, 'missing compounds add no risk and remove none');
  assert.equal(e.severity, waterDetailSeverity(onlyPfoa));
  assert.deepEqual(e.detail.regulated_panel, { numeric: ['PFOA'], non_detect: ['PFOS'], no_result: ['PFHxS', 'PFNA', 'HFPO-DA'], complete: false });
  assert.equal(e.parsed.contaminants.PFHxS.result, 'no_result');
  assert.equal(waterSeverity(e.parsed, 'pfhxs'), 'no_data', 'a missing compound is not coloured by its neighbours');
  assert.equal(e.mapReading, 'No over-limit result, 2 of 5 compounds have a comparable result');
  assert.equal(waterCounts([e.feature]).by_contaminant.PFHxS.tested, 0);
});

test('an over-limit sample stays over the limit and is never softened by missing compounds', () => {
  const contaminants = { PFOS: [{ value_ppt: 8, date: '7/1/2025' }] };
  const e = evaluate(contaminants);
  assert.equal(e.detail.coverage, 'complete');
  assert.equal(e.detail.risk, 75);
  assert.equal(e.severity, 'high');
  assert.equal(e.mapSeverity, 'high');
  assert.equal(e.mapReading, '1 over limit');
  assert.equal(e.parsed.contaminants.PFOS.result, 'numeric');
  assert.equal(compoundReadingText(e.parsed.contaminants.PFOS), '8 ppt');
  assert.equal(e.home.display_score, Math.round(25 * (1 - radonZone3 / 100)));
  assert.equal(e.homeSeverity, 'high');
  assert.deepEqual(waterCounts([e.feature]).over_limit, 1);
  // A same-day non-detect does not hide the numeric over-limit result.
  const mixed = getWaterRisk({ PFOS: [{ non_detect: true, reporting_limit_ppt: 4, date: '7/1/2025' }, { value_ppt: 8, date: '7/1/2025' }] });
  assert.equal(mixed.risk, 75);
});

test('a later non-detect at another entry point does not erase an earlier detection (Raleigh after the UCMR5 reload)', () => {
  // NC0392010's PFOS: detected at 5.3 and 5.6 ppt in 2023, then a 3/19/2024 non-detect.
  const contaminants = {
    PFOS: [
      { value_ppt: 5.3, date: '7/26/2023' },
      { value_ppt: 5.6, date: '8/8/2023' },
      { non_detect: true, reporting_limit_ppt: 4, date: '8/8/2023' },
      { non_detect: true, reporting_limit_ppt: 4, date: '3/19/2024' },
    ],
    PFOA: [{ non_detect: true, reporting_limit_ppt: 4, date: '3/19/2024' }],
  };
  const e = evaluate(contaminants);
  assert.notEqual(e.detail.coverage, 'no_detections', 'a detected compound is never "No detections"');
  assert.equal(e.detail.detected_count, 1);
  assert.deepEqual(e.detail.scored.map((row) => [row.contaminant, row.value_ppt, row.date]), [['PFOS', 5.6, '8/8/2023']]);
  assert.equal(e.detail.risk, getWaterRisk({ PFOS: [{ value_ppt: 5.6, date: '8/8/2023' }] }).risk);
  assert.notEqual(e.severity, 'good');
  // The never-detected compound keeps its dated non-detect, and the sample record still ends in 2024.
  assert.deepEqual(e.detail.non_detects.map((row) => [row.contaminant, row.date]), [['PFOA', '3/19/2024']]);
  assert.equal(e.detail.latest_sample_date, '3/19/2024');
  assert.deepEqual(e.detail.regulated_panel.numeric, ['PFOS']);
  // The district share already counted the detection; the score now agrees with it.
  assert.equal(computeDistrict([{ pwsid: 'x', contaminants }]).systems_with_numeric_result, 1);
});

test('a lithium-only record has nothing regulated to score, so it is unknown rather than Good', () => {
  const e = evaluate({ lithium: [{ value_ppt: 12000, date: '7/1/2025' }] });
  assert.equal(e.detail.coverage, 'excluded_only');
  assert.equal(e.detail.risk, null);
  assert.equal(e.severity, 'no_data');
  assert.equal(e.mapSeverity, 'no_data');
  assert.equal(e.detail.excluded_from_score.length, 1, 'lithium is still reported');
  assert.equal(e.home.display_score, radonOnly.display_score);
});

test('compound names that collide with built-in object properties are ordinary unscored detections', () => {
  const d = getWaterRisk(JSON.parse('{"constructor":[{"value_ppt":5}],"toString":[{"value_ppt":5}],"__proto__":[{"value_ppt":5}]}'));
  assert.deepEqual(d.excluded_from_score, []);
  assert.equal(d.coverage, 'unscoreable');
  assert.equal(waterDetailSeverity(d), 'no_data');
});

test('an unknown coverage word, or a Good overall with no comparable compound, is not coloured on the map', () => {
  const base = { pwsid: 'NC1', name: 'X', overall_severity: 'good', contaminants: { PFOA: { result: 'no_result', severity: 'no_data', limit_ppt: 4 } } };
  for (const coverage of [undefined, 'weird', 'complete']) {
    const parsed = parseMapLayer({ layer: 'water', features: [{ ...base, coverage }] }, 'water').water[0];
    assert.equal(waterSeverity(parsed, 'overall'), 'no_data', String(coverage));
    assert.equal(waterMapReading(parsed, 'overall'), 'No comparable result');
  }
  // A non-detect whose reporting limit cannot establish "below the limit" is not a comparable result.
  const high = evaluate({ PFOA: [{ non_detect: true, reporting_limit_ppt: 20, date: '3/4/2024' }] });
  assert.equal(high.mapReading, 'No comparable result');
});

test('the parsed map record cannot be talked into a severity by a contradictory response', () => {
  const parsed = parseMapLayer({ layer: 'water', features: [{
    pwsid: 'NC1', name: 'X', overall_severity: 'good', coverage: 'no_data',
    contaminants: { PFOA: { result: 'no_result', severity: 'good', limit_ppt: 4 }, PFOS: { result: 'non_detect', value_ppt: 2, severity: 'good', limit_ppt: 4 } },
  }] }, 'water').water[0];
  assert.equal(waterSeverity(parsed, 'overall'), 'no_data');
  assert.equal(parsed.contaminants.PFOA.severity, 'no_data');
  assert.equal(parsed.contaminants.PFOS.result, 'invalid', 'a non-detect with a value is contradictory');
  assert.equal(parsed.contaminants.PFOS.severity, 'no_data');
});

test('district and statewide shares use one stated rule: systems with a numeric regulated result', () => {
  const utilities = [
    { pwsid: 'NC_MONROE', contaminants: { PFOS: [{ date: '7/1/2025', value_ppt: 8 }] } },
    { pwsid: 'NC_ALBEMARLE', contaminants: {} }, // in NC-08, no numeric result
    { pwsid: 'NC_RALEIGH', contaminants: { PFOS: [{ date: '7/1/2025', value_ppt: 1 }] } },
  ];
  const geo = new Map([
    ['NC_MONROE', { lat: 34.9854, lng: -80.5495, population: 1000 }],
    ['NC_ALBEMARLE', { lat: 35.3502, lng: -80.2001, population: 3000 }],
    ['NC_RALEIGH', { lat: 35.7796, lng: -78.6382, population: 9000 }],
  ]);
  const view = buildDistrictView({ utilities, geo });
  const c = view.state_comparison;
  assert.equal(view.total_systems, 2);
  assert.equal(view.systems_tested_any, 1, 'the empty system is outside the denominator');
  assert.equal(c.district_share_over, 1);
  assert.equal(c.state_share_over, 0.5);
  assert.deepEqual([c.district_systems_over_limit, c.district_systems_with_numeric_result, c.district_total_systems], [1, 1, 2]);
  assert.deepEqual([c.state_systems_over_limit, c.state_systems_with_numeric_result, c.state_total_systems], [1, 2, 3]);
  assert.match(c.inclusion_rule, /numeric/);
  // The empty Stanly system is unknown in its county row, not Good.
  assert.equal(view.counties.find((r) => r.county === 'Stanly County').worst_water_severity, 'no_data');
  const parsed = parseMapDistrict({ ...view, assembled_at: '2026-10-25T00:00:00Z' });
  assert.equal(parsed.state_comparison.state_systems_with_numeric_result, 2);
  assert.equal(parsed.state_comparison.state_total_systems, 3);
});

test('map search covers supplied metadata, and severity order puts unknown last', () => {
  const records = [
    { id: 'a', name: 'Garinger', severity: 'good', reading: '', sub: 'Monitoring station', lat: null, lng: null, keywords: 'Mecklenburg County Air Quality' },
    { id: 'b', name: 'Beta', severity: 'no_data', reading: '', sub: '', lat: null, lng: null },
    { id: 'c', name: 'Gamma', severity: 'high', reading: '', sub: '', lat: null, lng: null },
  ];
  assert.deepEqual(findMapRecords(records, 'mecklenburg', null, null).map((r) => r.id), ['a']);
  assert.deepEqual(findMapRecords(records, '', null, null, 'severity').map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(findMapRecords(records, '', null, null).map((r) => r.id), ['b', 'c', 'a']);
});
