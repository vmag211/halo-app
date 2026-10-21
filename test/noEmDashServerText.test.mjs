// App-facing text must never carry U+2014 (AGENTS.md). These tests walk every
// string in the daily-score and home-guard answers, the sentence tables behind
// them, and every non-comment source line under lib/ and app/api/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDailyPayload } from '../lib/dailyPayload.js';
import { explain } from '../lib/explain.js';
import { BAND_KEYS, normalizeBands } from '../lib/household.js';
import { LEARN_TOPICS, learnTopic } from '../lib/learnContent.js';
import { composeWhyYours } from '../lib/learnWhyYours.js';
import { leadRisk } from '../lib/leadRisk.js';
import { buildWellTestPlan, WELL_TEST_CATALOG } from '../lib/wellTestData.js';
import { actionPlan } from '../lib/actionPlan.js';
import { setup, quiet } from './helpers/isolationKit.mjs';
import { PROFILE } from './helpers/isolationSeed.mjs';

const EM_DASH = '—';

/** Every string anywhere in a value, with its path. */
function strings(value, at = '$', out = []) {
  if (typeof value === 'string') out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${at}.${k}`, out);
  return out;
}
const assertNoDash = (value, label) => {
  const hits = strings(value).filter(([, text]) => text.includes(EM_DASH));
  assert.deepEqual(hits, [], `${label} carries U+2014`);
};

const bandSets = [{}, Object.fromEntries(BAND_KEYS.map((k) => [k, true])), ...BAND_KEYS.map((k) => ({ [k]: true }))].map((b) => normalizeBands(b));
const SEVERITIES = ['good', 'low', 'moderate', 'elevated', 'high', 'severe', 'no_data', null, 'unknown'];

test('every explain() sentence, for every factor, severity and household', () => {
  for (const metric of ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead']) {
    for (const severity of SEVERITIES) for (const bands of bandSets) assertNoDash(explain(metric, severity, bands), `${metric}/${severity}`);
  }
});

test('the daily-score payload, across AQI, UV, pollen and mold values and every household', () => {
  const aqis = [null, 0, 25, 51, 101, 151, 201, 301, 500];
  const uvs = [null, 0, 2, 4, 6.5, 9, 12];
  const pollens = [{ tree: null, grass: null, weed: null }, { tree: 0, grass: 1, weed: 2 }, { tree: 3, grass: 4, weed: 5 }];
  const molds = [{ risk: null, basis: null }, { risk: 'low', basis: { humidity_pct: 40, precip_pct: 0 } }, { risk: 'moderate', basis: null }, { risk: 'high', basis: { humidity_pct: 90, precip_pct: 80 } }];
  for (const bands of bandSets) {
    for (let i = 0; i < aqis.length; i++) {
      const payload = formatDailyPayload({
        aqi: aqis[i], aqiSource: i % 2 ? 'airnow' : 'open-meteo', aqiIsMeasured: i % 2 === 1, dominantPollutant: 'PM2.5',
        uvIndex: uvs[i % uvs.length], uvPeakWindow: null, pollen: pollens[i % pollens.length], mold: molds[i % molds.length],
        cached: false, retrievedAt: '2026-10-20T14:00:00.000Z', bands,
      });
      assertNoDash(payload, `daily payload ${i}`);
    }
  }
});

test('the daily-score route answer (cached, both households) has no U+2014', async () => {
  const ctx = setup();
  for (const who of ['alice', 'bob']) {
    const res = await ctx.call(who, '/api/daily-score', 'GET', { url: '/api/daily-score' });
    assert.equal(res.status, 200);
    assertNoDash(await res.json(), `daily-score for ${who}`);
  }
});

test('the home-guard route answer has no U+2014: both households, utility, well, spring, old and new homes', async (t) => {
  quiet(t);
  const ctx = setup();
  const queries = ['', '?home_year=1962', '?home_year=1995', '?home_year=', '?water_source=Well', '?water_source=Spring', '?water_source=Well&home_year=1950',
    `?county=${encodeURIComponent(PROFILE.bob.county)}&pwsid=${PROFILE.bob.pwsid}&water_source=${encodeURIComponent('City utility')}&home_year=1962`, '?pwsid='];
  for (const who of ['alice', 'bob']) {
    for (const query of queries) {
      const res = await ctx.call(who, '/api/home-guard', 'GET', { url: `/api/home-guard${query}` });
      assert.equal(res.status, 200, `${who} ${query}`);
      assertNoDash(await res.json(), `home-guard ${who} ${query}`);
    }
  }
});

test('the text tables behind those answers: learn content, why-yours, lead, well tests and the action plan', () => {
  for (const topic of LEARN_TOPICS) assertNoDash(learnTopic(topic), `learn ${topic}`);
  assertNoDash(WELL_TEST_CATALOG, 'well test catalog');
  for (const waterSource of ['well', 'spring']) for (const homeYear of [null, 1950, 2005]) for (const radonZone of [1, 2, 3, null]) assertNoDash(buildWellTestPlan({ radonZone, homeYear, waterSource }), `well plan ${waterSource} ${homeYear} ${radonZone}`);
  for (const homeYear of [null, 1920, 1975, 1987, 1990, 2020]) for (const leadServiceLine of [false, true]) assertNoDash(leadRisk({ homeYear, leadServiceLine }), `lead ${homeYear}`);
  const q = (fields) => (name) => fields[name] ?? null;
  const why = [
    ['pfas', { contaminant: 'PFOS', value: 7.3, limit: 4 }], ['radon', { county: 'Wake County', zone: 1 }],
    ['air', { value: 120, severity: 'elevated', source: 'open-meteo', pollutant: 'O3' }], ['uv', { value: 0.4 }], ['uv', { value: 9 }],
    ['pollen', { value: 4, category: 'grass' }], ['mold', { risk: 'high', humidity: 85, precip: 60 }], ['mold', { risk: 'low' }], ['lead', { home_year: 1960 }],
  ];
  for (const [topic, fields] of why) assertNoDash(composeWhyYours(topic, q(fields)), `why ${topic}`);
  const water = { contaminant: 'PFOS', value_ppt: 8.3, limit_ppt: 4, is_enforceable: true, exceeds_limit: true };
  for (const bands of bandSets) assertNoDash(actionPlan({ water, radon: { zone: 1, county: 'Wake County' }, lead: leadRisk({ homeYear: 1960 }), bands }), 'action plan');
});

test('no non-comment source line under lib/ or app/api/ contains a literal U+2014', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(m?js|ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(path.join(root, 'lib'));
  walk(path.join(root, 'app', 'api'));
  const hits = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!line.includes(EM_DASH)) return;
      const code = line.replace(/^\s*(\/\/|\/?\*).*$/, '').replace(/\s\/\/\s.*$/, '');
      if (code.includes(EM_DASH)) hits.push(`${path.relative(root, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
