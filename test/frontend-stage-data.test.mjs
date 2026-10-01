import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { buildStageData } = await loadFrontend('stage-data');
const { safeUrl, isoDate, safeText } = await loadFrontend('stage-values');
test('valid readings without optional prose never claim that the reading is missing', () => {
  const data = buildStageData({ air: { aqi: 1 }, uv: { index: 0 }, pollen: { tree: 1 }, mold: { risk: 'low' } }, null, null);
  for (const key of ['air', 'uv', 'pollen', 'mold']) assert.doesNotMatch(data.readings[key].sentence, /not available/i);
});
const profile = { onboarded: true, onboarding_complete: true, profile: { county: 'Union County', state: 'NC', home_year: 1975, water_source: 'utility' } };
const daily = {
  air: { aqi: 37, source: 'airnow', is_measured: true, dominant_pollutant: 'PM2.5', severity: 'good', sentence: 'Measured nearby\u2014outdoor air.' },
  uv: { index: 5.2, severity: 'moderate', peak_window: { start: '11:00', end: '15:00', max: 7.4 } },
  pollen: { tree: 1, grass: 3, weed: 2, dominant: 'grass', severity: 'elevated', categories: { tree: { value: 1, severity: 'moderate' }, grass: { value: 3, severity: 'elevated' }, weed: { value: 2, severity: 'moderate' } } },
  mold: { risk: 'high', severity: 'elevated', is_proxy: true, basis: { humidity_pct: 76, precip_pct: 55 } },
  score: { display_score: 77, severity: 'elevated', is_partial: false, included_inputs: ['air', 'uv', 'pollen', 'mold'], missing_inputs: [], inputs: { air: 12, uv: 28, pollen: 14, mold: 8 } },
  retrieved_at: '2026-09-30T14:00:00Z',
};
const home = {
  water: { is_measured: true, coverage: 'complete', pws_name: 'Example Water', latest_sample_iso: '2025-03-01',
    scored_contaminants: [{ contaminant: 'PFOS', value_ppt: 8.3, limit_ppt: 4, risk: 95, is_enforceable: true, exceeds_limit: true, date_iso: '2025-03-01', basis: 'federal_mcl' }],
    contaminants: { PFOS: [{ value_ppt: 9.2, date_iso: '2024-06-01' }, { value_ppt: 8.3, date_iso: '2025-03-01' }] },
    excluded_from_score: [{ contaminant: 'lithium', value_ppt: 25000 }] },
  radon: { zone: 2, county: 'Union County', severity: 'elevated' },
  lead: { level: 'elevated', is_estimate: true, sentence: 'Building-era estimate.' },
  breakdown: [{ key: 'water', score: 42, severity: 'severe' }, { key: 'radon', score: 50, severity: 'elevated' }],
  score: { display_score: 30, severity: 'severe', included_inputs: ['water', 'radon'], missing_inputs: [], is_partial: false }, assembled_at: '2026-09-30T14:00:00Z',
};

test('uses backend scores and severities; ring geometry contains only returned risk inputs', () => {
  const data = buildStageData(daily, home, profile);
  assert.equal(data.today.score, 77); assert.equal(data.home.score, 30);
  assert.deepEqual(data.today.contributions, { air: 12, uv: 28, pollen: 14, mold: 8 }); assert.deepEqual(data.home.contributions, {});
  for (const key of ['air', 'uv', 'pollen', 'mold', 'lead']) assert.equal(data.readings[key].score, null);
  assert.equal(data.readings.pfas.score, 42); assert.equal(data.readings.radon.score, 50);
  assert.equal(data.readings.radon.severity, 'elevated');
  assert.equal(data.readings.pollen.details.pollen.categories[0].severity, 'moderate');
  assert.equal(data.readings.pfas.details.water.rows[0].severity, 'no_data', 'do not recreate per-compound severity thresholds');
  assert.equal(data.readings.pfas.details.water.rows[0].exceeds_limit, true);
  assert.equal(data.readings.pfas.details.water.lithium_ug_l, 25);
  assert.equal(data.readings.air.provenance, 'measured');
  assert.equal(data.readings.mold.source, 'National Weather Service');
  assert.equal(data.readings.uv.source, 'UV forecast');
  assert.equal(JSON.stringify(data).includes('\u2014'), false);
});

test('risk geometry excludes missing, unused and malformed inputs without inventing factor scores', () => {
  const data = buildStageData({ ...daily, air: null, score: { ...daily.score, included_inputs: ['air', 'uv', 'mold'], inputs: { air: 12, uv: null, pollen: 15, mold: 0 } } }, home, profile);
  assert.deepEqual(data.today.contributions, { mold: 0 });
  assert.equal(data.readings.mold.score, null);
});

test('missing, zero, and malformed readings are different states', () => {
  const empty = buildStageData(null, null, null);
  assert.equal(empty.today.score, null); assert.equal(empty.home.score, null);
  assert.equal(empty.today.partial, false); assert.equal(empty.home.partial, false);
  assert.deepEqual(empty.today.missingInputs, ['air', 'uv', 'pollen', 'mold']);
  assert.ok(Object.values(empty.readings).every(reading => reading.score === null && reading.severity === 'no_data'));
  const zero = buildStageData({ ...daily, air: { aqi: 0, severity: 'good' }, uv: { index: 0, severity: 'good' } }, home, profile);
  assert.equal(zero.readings.air.reading, '0'); assert.equal(zero.readings.uv.reading, '0.0');
  const malformed = buildStageData({ ...daily, air: { aqi: '37', severity: 'good' }, uv: { index: -1 }, pollen: { tree: 88 }, mold: { risk: null, severity: 'good' }, score: { display_score: 999 } }, null, profile);
  assert.equal(malformed.today.score, null);
  assert.ok(['air', 'uv', 'pollen', 'mold'].every(key => malformed.readings[key].severity === 'no_data'));
  assert.equal(malformed.readings.mold.details.mold.humidity_pct, null);
});

test('modelled and unknown air provenance stay distinct; source times are not invented', () => {
  const modelled = buildStageData({ ...daily, air: { aqi: 40, severity: 'good', source: 'open-meteo', is_measured: false }, retrieved_at: 'invalid' }, home, profile);
  assert.equal(modelled.readings.air.provenance, 'modeled');
  assert.equal(modelled.today.asOf, 'Update time unavailable');
  const unknown = buildStageData({ ...daily, air: { aqi: 40, severity: 'good' } }, home, profile);
  assert.equal(unknown.readings.air.provenance, null); assert.equal(unknown.readings.air.source, 'Source unavailable');
});

test('well and spring never inherit utility measurements or a combined home score', () => {
  for (const water_source of ['well', 'spring']) {
    const data = buildStageData(daily, { ...home, water: { ...home.water, status: 'private_well', is_measured: false }, score: { ...home.score, unused_inputs: ['radon'] } }, { ...profile, profile: { ...profile.profile, water_source } });
    assert.equal(data.home.score, null); assert.deepEqual(data.home.includedInputs, []);
    assert.equal(data.readings.pfas.score, null); assert.equal(data.readings.pfas.provenance, null);
    assert.deepEqual(data.readings.pfas.details.water.rows, []); assert.deepEqual(data.readings.pfas.trend, []);
    assert.equal(data.readings.lead.score, null); assert.equal(data.readings.lead.severity, 'no_data');
    assert.equal(data.readings.radon.score, 50, 'a supplied county factor score may still be shown separately');
  }
});

test('unscoreable coverage cannot become 100 and guidance is never a federal limit context', () => {
  for (const coverage of ['unscoreable', 'no_data', 'unknown']) {
    const data = buildStageData(daily, { ...home, water: { ...home.water, coverage }, breakdown: [{ key: 'water', score: 100, severity: 'good' }] }, profile);
    assert.equal(data.readings.pfas.score, null); assert.equal(data.readings.pfas.severity, 'no_data');
    assert.deepEqual(data.home.includedInputs, ['water', 'radon'], 'preserve server composite inclusion independently from water coverage');
  }
  const benchmark = buildStageData(daily, { ...home, water: { ...home.water, includes_guidance: true, scored_contaminants: [{ contaminant: 'PFExample', value_ppt: 4, limit_ppt: 8, is_enforceable: false, exceeds_limit: false, basis: 'published_health_benchmark' }] } }, profile);
  assert.deepEqual(benchmark.readings.pfas.context, {});
  assert.equal(benchmark.readings.pfas.details.water.rows[0].is_enforceable, false);
  assert.equal(benchmark.readings.pfas.details.water.coverage, 'complete');
  assert.equal(benchmark.readings.pfas.details.water.includes_guidance, true);
  assert.match(benchmark.readings.pfas.disclosures.join(' '), /nonbinding health benchmarks/);
});

test('out-of-state radon and unknown build year do not borrow preview defaults', () => {
  const data = buildStageData(daily, { ...home, radon: { error: 'Outside NC.', out_of_state: true, zone: 2 } }, { ...profile, profile: { ...profile.profile, home_year: null } });
  assert.equal(data.readings.radon.score, null); assert.equal(data.readings.radon.severity, 'no_data');
  assert.equal(data.readings.lead.reading, 'No data'); assert.equal(data.readings.lead.details.lead.home_year, null);
  assert.equal(data.readings.lead.context.home_year, undefined);
});

test('history fills missing dates with null and preserves zero across independent factors', () => {
  const history = { from: '2026-09-28', to: '2026-09-30', history: [
    { date: '2026-09-28', values: { aqi: 0, uv_index: 4, pollen: { tree: 1, grass: null, weed: 2 } } },
    { date: '2026-09-30', values: { aqi: 37, uv_index: null, pollen: { tree: null, grass: null, weed: null } } },
  ] };
  const data = buildStageData(daily, home, profile, history);
  assert.deepEqual(data.readings.air.trend.map(point => point.value), [0, null, 37]);
  assert.deepEqual(data.readings.uv.trend.map(point => point.value), [4, null, null]);
  assert.deepEqual(data.readings.pollen.trend.map(point => point.value), [2, null, null]);
  assert.deepEqual(data.readings.mold.trend, []);
  assert.deepEqual(data.readings.pfas.trend.map(point => point.date), ['2024-06-01', '2025-03-01']);
});

test('display boundary rejects unsafe links and invalid calendar dates', () => {
  for (const link of ['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'https://secret:credential@example.com']) assert.equal(safeUrl(link), null);
  assert.equal(safeUrl('https://www.epa.gov/radon'), 'https://www.epa.gov/radon');
  assert.equal(isoDate('2026-02-31'), null); assert.equal(isoDate('2024-02-29'), '2024-02-29');
  assert.equal(safeText('Source\u2014description'), 'Source, description');
});

test('home contributions contain only supplied, included, scoreable water and radon risks', () => {
  const risks = { ...home, score: { ...home.score, water_risk: 70, radon_risk: 25 } };
  assert.deepEqual(buildStageData(daily, risks, profile).home.contributions, { pfas: 70, radon: 25 });
  assert.deepEqual(buildStageData(daily, { ...risks, water: { ...home.water, coverage: 'unscoreable' } }, profile).home.contributions, { radon: 25 });
  assert.deepEqual(buildStageData(daily, risks, { ...profile, profile: { ...profile.profile, water_source: 'well' } }).home.contributions, {});
});

test('contribution copy distinguishes positive shares, real zero, and missing inputs', () => {
  assert.match(buildStageData(daily, home, profile).today.contributionNote, /not portions of your final score/);
  const zeroDaily = { ...daily, score: { ...daily.score, inputs: { air: 0, uv: 0, pollen: 0, mold: 0 } } };
  const zeroHome = { ...home, score: { ...home.score, water_risk: 0, radon_risk: 0 } };
  const zero = buildStageData(zeroDaily, zeroHome, profile);
  assert.match(zero.today.contributionNote, /inputs are zero/);
  assert.match(zero.home.contributionNote, /inputs are zero/);
  assert.match(buildStageData(null, null, null).today.contributionNote, /not provided/);
});

test('backend diagnostic text stays hidden, mold uses canonical label, and numeric formats stay clear', () => {
  for (const status of ['lookup_failed', 'no_data_yet', 'no_pwsid_available']) {
    const data = buildStageData({ ...daily, air: { ...daily.air, aqi: 42.6 }, uv: { ...daily.uv, index: 5 } }, { ...home, water: { status, message: 'DATABASE_SECRET_MARKER' }, radon: { error: 'PRIVATE_ERROR_MARKER' } }, profile);
    assert.equal(JSON.stringify(data).includes('DATABASE_SECRET_MARKER'), false);
    assert.equal(JSON.stringify(data).includes('PRIVATE_ERROR_MARKER'), false);
    assert.equal(data.readings.air.reading, '43'); assert.equal(data.readings.uv.reading, '5.0');
    assert.equal(data.readings.mold.reading, 'Estimate'); assert.equal(data.readings.mold.severity, 'elevated');
  }
});

test('utility sample history uses the highest same-day value and requires two dated samples', () => {
  const withSamples = samples => buildStageData(daily, { ...home, water: { ...home.water, contaminants: { PFOS: samples } } }, profile).readings.pfas.trend;
  assert.deepEqual(withSamples([{ date_iso: '2025-01-01', value_ppt: 7 }, { date_iso: '2025-01-01', value_ppt: 4 }]), []);
  const trend = withSamples([{ date_iso: '2025-01-01', value_ppt: 7 }, { date_iso: '2025-01-01', value_ppt: 4 }, { date_iso: '2025-04-01', value_ppt: 3 }, { date_iso: '2025-02-31', value_ppt: 10 }]);
  assert.deepEqual(trend.map(point => point.value), [7, 3]);
});

test('cap claims depend on actual cap flag and private lead testing depends on the supplied plan', () => {
  const uncapped = buildStageData(daily, { ...home, score: { ...home.score, reason: 'This score is capped for that reason.', capped: false } }, profile);
  assert.doesNotMatch(uncapped.home.notice, /capped/i);
  const privateProfile = { ...profile, profile: { ...profile.profile, water_source: 'well' } };
  assert.doesNotMatch(buildStageData(daily, home, privateProfile).readings.lead.sentence, /included/);
  const privateHome = { ...home, water: { status: 'private_well', test_plan: { tests: [{ id: 'lead_copper' }] } } };
  assert.match(buildStageData(daily, privateHome, privateProfile).readings.lead.sentence, /included/);
});
