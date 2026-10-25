// Release scenario findings (2026-10-25): what the factor and Homeguard screens say for a utility
// whose PFAS results are documented non-detects, a home outside North Carolina, a private well with
// no home year, and a UV reading that sits on a rounding boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
import { composeWhyYours } from '../lib/learnWhyYours.js';

const { buildStageData } = await loadFrontend('stage-data');
const { segmentAbsentLabel } = await loadFrontend('factor-preview');
const { copy } = await loadFrontend('copy');

const daily = {
  air: { aqi: 36, source: 'airnow', is_measured: true, severity: 'good' },
  uv: { index: 0.35, source: 'open-meteo', severity: 'good' },
  pollen: { weed: 2, severity: 'moderate', categories: { weed: { value: 2, severity: 'moderate' } } },
  mold: { risk: 'low', severity: 'good', is_proxy: true },
  score: { display_score: 76, severity: 'moderate', included_inputs: ['air', 'uv', 'pollen', 'mold'], missing_inputs: [], inputs: { air: 14, uv: 3, pollen: 40, mold: 5 } },
  retrieved_at: '2026-10-25T22:13:00Z',
};
const nc = (extra = {}) => ({ onboarded: true, profile: { county: 'Wake County', state: 'NC', home_year: 1975, water_source: 'utility', ...extra } });

test('a no-detections utility lists its documented non-detects with reporting limits and dates', () => {
  const home = {
    water: { is_measured: true, coverage: 'no_detections', status: 'measured', pws_name: 'Example Water', latest_sample_iso: '2024-03-19', scored_contaminants: [],
      non_detects: [
        { contaminant: 'PFOA', reporting_limit_ppt: 4, limit_ppt: 4, below_limit: true, date_iso: '2024-03-19' },
        { contaminant: 'PFHxS', reporting_limit_ppt: 20, limit_ppt: 10, below_limit: false, date_iso: '2024-03-19' },
      ] },
    radon: { zone: 2, county: 'Wake County', severity: 'elevated' },
    breakdown: [{ key: 'water', score: 100, severity: 'good' }, { key: 'radon', score: 50, severity: 'elevated' }],
    score: { display_score: 50, severity: 'elevated', included_inputs: ['water', 'radon'], missing_inputs: [] },
  };
  const pfas = buildStageData(daily, home, nc()).readings.pfas;
  assert.equal(pfas.reading, 'No detections');
  assert.deepEqual(pfas.details.water.non_detects, [
    { name: 'PFOA', reporting_limit_ppt: 4, limit_ppt: 4, below_limit: true, date_iso: '2024-03-19' },
    { name: 'PFHxS', reporting_limit_ppt: 20, limit_ppt: 10, below_limit: false, date_iso: '2024-03-19' },
  ]);
  assert.match(pfas.sentence, /No PFAS was detected/);
  assert.doesNotMatch(pfas.sentence, /appear when utility testing is available/);
});

test('outside North Carolina, water and radon say "outside coverage", never invalid or unavailable', () => {
  const home = {
    water: { status: 'no_data_yet', message: 'UCMR5 testing data is not yet available for this utility.' },
    radon: { error: 'Radon zone data here covers North Carolina addresses only.', out_of_state: true, state: 'WA' },
    breakdown: [{ key: 'water', score: null, severity: 'no_data' }, { key: 'radon', score: null, severity: 'no_data' }],
    score: { display_score: null, severity: null, included_inputs: [], missing_inputs: ['water', 'radon'], reason: 'Neither water nor radon data was available for this address.' },
  };
  const data = buildStageData(daily, home, { onboarded: true, profile: { county: 'King County', state: 'WA', home_year: 1960, water_source: 'utility' } });
  for (const key of ['pfas', 'radon']) {
    assert.equal(data.readings[key].severity, 'no_data');
    assert.equal(data.readings[key].gap.label, 'Outside coverage');
    assert.match(data.readings[key].gap.sentence, /outside HALO's .*coverage, which is North Carolina/);
  }
  assert.match(data.home.notice, /outside HALO's current water and radon coverage/);
  assert.doesNotMatch(JSON.stringify(data), /invalid/i);
  // The onboarding reveal says the same thing: outside coverage, not "less detail".
  assert.match(copy.reveal.outside, /North Carolina only, so this home is outside that coverage/);
  // A North Carolina home with no published result is not "outside coverage".
  const inside = buildStageData(daily, { ...home, radon: { zone: 2, county: 'Graham County', severity: 'elevated' } }, nc({ county: 'Graham County' }));
  assert.equal(inside.readings.pfas.gap, undefined);
  assert.equal(inside.readings.radon.gap, undefined);
});

test('a private well with no home year: PFAS is "Not tested" with no utility wording, and lead does not claim a provided age', () => {
  const home = {
    water: { status: 'private_well', is_measured: false, test_plan: { tests: [{ id: 'lead_copper' }] } },
    radon: { zone: 3, county: 'Cabarrus County', severity: 'good' },
    breakdown: [{ key: 'radon', score: 80, severity: 'good' }],
    score: { display_score: null, included_inputs: [], missing_inputs: ['water'] },
  };
  const data = buildStageData(daily, home, { onboarded: true, profile: { county: 'Cabarrus County', state: 'NC', home_year: null, water_source: 'well' } });
  assert.equal(data.readings.pfas.gap.label, 'Not tested');
  assert.equal(data.readings.pfas.details.water.private_source, true);
  assert.equal(data.readings.pfas.source, 'Private water supply, not tested by a utility');
  assert.doesNotMatch(data.readings.pfas.detail, /utility sampling/);
  assert.equal(data.readings.lead.reading, 'No data');
  assert.equal(data.readings.lead.source, 'Home age not provided');
  assert.equal(data.readings.radon.gap, undefined, 'radon still has its county zone');
  // The score legend: radon has a reading but no combined score to share in, so it is not "No data".
  assert.equal(data.home.score, null);
  assert.deepEqual(segmentAbsentLabel(data.readings.radon, true), { absentLabel: 'Not combined' });
  assert.deepEqual(segmentAbsentLabel(data.readings.pfas, true), { absentLabel: 'Not tested' });
  assert.deepEqual(segmentAbsentLabel(data.readings.radon, false), {});
});

test('the UV reading and its "why yours" line round the same value the same way', () => {
  const data = buildStageData(daily, null, nc());
  const why = composeWhyYours('uv', (key) => (key === 'value' ? '0.35' : null));
  assert.equal(data.readings.uv.reading, '0.4');
  assert.match(why, /UV index is 0\.4\b/);
});
