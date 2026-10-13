import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { comparisonRecords, comparisonRows, compareEvidence, comparisonDisplay, comparisonObserved, reviewComparisonRecord } = await loadFrontend('map-comparison-preview');
const { waterFeatures, airStations } = await loadFrontend('map-preview');
const { mapComparisonCopy: c } = await loadFrontend('copy/map-comparison');
const { publicDistrictExport, publicDistrictBrief } = await loadFrontend('map-public-brief');
const { districtPreviewData } = await loadFrontend('map-district-preview');
const water = comparisonRecords('water', waterFeatures());

test('water comparisons reuse the exact original values and retain partial coverage', () => {
  for (const record of water) {
    const original = waterFeatures().find(value => value.pwsid === record.id);
    assert.equal(record.values[0].value, original.contaminants.PFOA.value_ppt ?? null);
    assert.equal(record.values[0].observedAt, original.contaminants.PFOA.date_iso ?? null);
    assert.equal(record.coverage, 'partial');
    assert.equal(record.sourceUrl, null);
  }
  const [row] = comparisonRows(water[0], water[1], 'pfoa');
  assert.equal(row.compatible, true);
  assert.deepEqual(row.warnings, [c.incomplete]);
  assert.equal('difference' in row, false);
  assert.equal('rank' in row, false);
});
test('zero is a value, missing results are never a favorable zero', () => {
  const [zero] = comparisonRows(water[0], water[3], 'pfoa');
  assert.equal(zero.compatible, true);
  assert.equal(comparisonDisplay(zero.second), '0 ppt');
  const [missing] = comparisonRows(water[0], water[2], 'pfoa');
  assert.equal(missing.compatible, false);
  assert.ok(missing.reasons.includes(c.reasons.missing));
  assert.equal(comparisonDisplay(missing.second), c.missing);
});
test('overall lists aligned analytes without comparing categorical totals', () => {
  const rows = comparisonRows(water[0], water[4], 'overall');
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.analyte), ['PFOA', 'PFOS', 'PFHxS', 'PFNA', 'GenX']);
});
test('hazard index is separate from concentration and binds component-method identity', () => {
  const [row] = comparisonRows(water[0], water[4], 'hazard');
  assert.equal(row.compatible, true);
  assert.equal(row.first.unit, 'index');
  const altered = structuredClone(water[4]);
  altered.values.at(-1).method = 'other-components';
  assert.equal(comparisonRows(water[0], altered, 'hazard')[0].compatible, false);
});
for (const [scenario, reason] of [['units','units'],['period','period'],['method','method'],['denominator','denominator'],['scope','scope'],['version','source'],['withdrawn','status']]) {
  test(`comparison refuses ${scenario} mismatch without mutating source values`, () => {
    const original = structuredClone(water[1]);
    const changed = reviewComparisonRecord(water[1], scenario);
    const [row] = comparisonRows(water[0], changed, 'pfoa');
    assert.equal(row.compatible, false);
    assert.ok(row.reasons.includes(c.reasons[reason]));
    assert.deepEqual(water[1], original);
    assert.equal(changed.values[0].value, original.values[0].value);
  });
}
test('different dates in a supported quarter stay visible rather than synchronized', () => {
  const changed = structuredClone(water[1]);
  changed.values[0].observedAt = '2025-12-01';
  const [row] = comparisonRows(water[0], changed, 'pfoa');
  assert.equal(row.compatible, true);
  assert.ok(row.warnings.includes(c.dateDifference));
  const historical = comparisonRecords('water', waterFeatures('2023Q1'))[0];
  assert.ok(compareEvidence(water[0], historical, water[0].values[0], historical.values[0]).reasons.includes(c.reasons.period));
});
test('AQI comparisons bind pollutant and hour, not only unit', () => {
  const air = comparisonRecords('air', []);
  assert.equal(air[0].values[0].value, airStations[0].aqi);
  const [pollutant] = comparisonRows(air[0], air[1], 'overall');
  assert.equal(pollutant.compatible, false);
  assert.ok(pollutant.reasons.includes(c.reasons.analyte));
  assert.equal(pollutant.second.analyte, 'Ozone');
  assert.ok(comparisonRows(air[0], air[2], 'overall')[0].reasons.includes(c.reasons.period));
});
test('same record, nonfinite, unavailable, qualifier and absent metadata cannot compare', () => {
  assert.ok(compareEvidence(water[0], water[0], water[0].values[0], water[0].values[0]).reasons.includes(c.reasons.same));
  for (const patch of [{ value: NaN }, { value: Infinity }, { method: null }, { period: null }, { qualifier: 'estimated' }, { qualifier: 'non-detect' }]) {
    assert.equal(compareEvidence(water[0], water[1], water[0].values[0], { ...water[1].values[0], ...patch }).compatible, false);
  }
  assert.equal(compareEvidence(water[0], {...water[1],status:'unavailable'}, water[0].values[0], water[1].values[0]).compatible, false);
  assert.equal(comparisonDisplay({...water[0].values[0],value:null,qualifier:'non-detect'}),c.nonDetect);
  assert.equal(comparisonObserved({...water[0].values[0],observedAt:'invalid'}),c.unknown);
  assert.equal(comparisonDisplay({...water[0].values[0],value:0.0000002}),'0.0000002 ppt');
  assert.equal(compareEvidence({...water[0],scope:''},{...water[1],scope:''},water[0].values[0],water[1].values[0]).compatible,false);
  assert.equal(compareEvidence({...water[0],kind:''},{...water[1],kind:''},water[0].values[0],water[1].values[0]).compatible,false);
  for (const date of [null,'2025-02-30','2025-13-01','garbage']) {
    assert.ok(compareEvidence(water[0],water[1],water[0].values[0],{...water[1].values[0],observedAt:date}).reasons.includes(c.reasons.date));
    assert.equal(comparisonObserved({...water[0].values[0],observedAt:date}),c.unknown);
  }
});
test('no public layer produces household, facility or county numeric comparisons', () => {
  assert.deepEqual(comparisonRecords('radon', waterFeatures()), []);
  assert.deepEqual(comparisonRecords('facilities', waterFeatures()), []);
  assert.equal(water.some(record => record.id === 'home'), false);
  assert.ok(water.every(record => !('latitude' in record) && !('home' in record)));
});
test('public district export uses an allowlist and does not leak injected private fields',()=>{
  const fixture={...districtPreviewData('full'),home:{lat:35.04,lng:-80.52},address:'private-address',notes:['private-note'],transcript:'private-chat'};
  const output=publicDistrictExport(fixture),text=JSON.stringify(output);
  assert.equal(output.review_only,true);
  for(const privateValue of ['private-address','private-note','private-chat','35.04','-80.52'])assert.equal(text.includes(privateValue),false);
  assert.equal(output.totals.systems_with_numeric_regulated_results,fixture.systems_tested_any);
  assert.equal(output.counties.find(c=>c.county==='Cabarrus County').membership,'partial');
  assert.match(publicDistrictBrief(fixture),/not verified community findings/);
  assert.match(publicDistrictBrief(districtPreviewData('population-missing')),/Population served is unavailable/);
  assert.match(publicDistrictBrief(districtPreviewData('population-partial')),/At least/);
  assert.match(publicDistrictBrief(districtPreviewData('zero')),/0 of/);
});
