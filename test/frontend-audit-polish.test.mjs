import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
import { LEARN_CONTENT, LEARN_TOPICS } from '../lib/learnContent.js';
import { formatDailyPayload } from '../lib/dailyPayload.js';

const search = await loadFrontend('learn-search');
const { readingFromLabel } = await loadFrontend('time-format');
const { buildStageData } = await loadFrontend('stage-data');
const { completionCopy } = await loadFrontend('copy/completion');

const topicsFor = (query) => LEARN_TOPICS.filter((key) => search.learnSearchMatches(query, search.learnTopicFields(key, LEARN_CONTENT[key])));
const termsFor = (query) => completionCopy.glossary.filter((term) => search.learnSearchMatches(query, search.learnTermFields(term))).map((term) => term.id);

test('Learn search finds topics by standard abbreviations, in any case or punctuation', () => {
  for (const query of ['AQI', 'aqi', ' Aqi ', 'PM2.5', 'pm 2.5', 'pm25', 'PM10', 'ozone', 'O3', 'AirNow', 'air quality index', 'index air']) assert.ok(topicsFor(query).includes('air'), query);
  for (const query of ['UV', 'uv', 'UVI', 'U.V.', 'sunscreen', 'SPF']) assert.ok(topicsFor(query).includes('uv'), query);
  for (const query of ['PFAS', 'pfas', 'PFOA', 'PFOS', 'forever chemicals', 'polyfluoroalkyl']) assert.ok(topicsFor(query).includes('pfas'), query);
  for (const query of ['radon', 'pCi/L', 'pcil', 'soil gas']) assert.ok(topicsFor(query).includes('radon'), query);
  for (const query of ['Pb', 'solder']) assert.ok(topicsFor(query).includes('lead'), query);
  for (const query of ['mould', 'humidity']) assert.ok(topicsFor(query).includes('mold'), query);
  for (const query of ['allergies', 'hay fever']) assert.ok(topicsFor(query).includes('pollen'), query);
});

test('agency abbreviations find the topics whose sources they publish', () => {
  assert.deepEqual(topicsFor('EPA').sort(), ['lead', 'pfas', 'radon', 'uv']);
  assert.deepEqual(topicsFor('cdc').sort(), ['mold', 'pollen']);
  assert.deepEqual(topicsFor('ATSDR'), ['pfas']);
});

test('short queries match at word starts only, and unknown terms match nothing', () => {
  assert.deepEqual(topicsFor('AQI'), ['air'], 'AQI is only an air abbreviation');
  assert.deepEqual(topicsFor('UV'), ['uv']);
  assert.deepEqual(topicsFor('PM 10'), ['air'], 'not "4:00 PM" beside an unrelated 10');
  assert.deepEqual(topicsFor('O 3'), ['air']);
  assert.deepEqual(topicsFor('zzzz'), []);
  assert.deepEqual(topicsFor('NWS'), [], 'no Learn topic is about the Weather Service, so none is claimed');
  assert.equal(search.learnSearchMatches('', ['anything']), true, 'an empty query shows everything');
  assert.equal(search.learnSearchMatches('epa', ['keep a filter']), false, 'never across a word gap');
});

test('glossary search uses the same normalisation and its own abbreviations', () => {
  assert.ok(termsFor('ND').includes('non-detect'));
  assert.ok(termsFor('nondetect').includes('non-detect'));
  assert.ok(termsFor('NON DETECT').includes('non-detect'));
  assert.ok(termsFor('detection limit').includes('non-detect'));
  assert.ok(termsFor('missing data').includes('coverage'));
  assert.ok(termsFor('outlook').includes('forecast'));
  assert.deepEqual(termsFor('zzzz'), []);
});

test('reading age names the date and a 12-hour time', () => {
  assert.equal(readingFromLabel('2026-10-24T19:00:00Z'), 'Reading from Oct 24, 3:00 PM');
  assert.equal(readingFromLabel('2026-10-25T04:30:00Z', 'America/New_York'), 'Reading from Oct 25, 12:30 AM');
  assert.equal(readingFromLabel('2026-10-24T19:00:00Z', 'America/Los_Angeles'), 'Reading from Oct 24, 12:00 PM');
  for (const value of [null, undefined, '', 'not a date']) assert.equal(readingFromLabel(value), null);
  assert.equal(readingFromLabel('2026-10-24T19:00:00Z', 'Not/AZone'), null);
});

const daily = {
  air: { aqi: 37, source: 'airnow', is_measured: true, severity: 'good' },
  uv: { index: 5.2, severity: 'moderate' },
  pollen: { tree: 1, grass: 3, weed: 2, dominant: 'grass', severity: 'elevated' },
  mold: { risk: 'low', severity: 'good' },
  retrieved_at: '2026-10-24T19:00:00Z',
};

test('Today readings carry their retrieval instant only when a reading exists', () => {
  const { readings } = buildStageData(daily, null, null);
  for (const key of ['air', 'uv', 'pollen', 'mold']) assert.equal(readings[key].readingAt, '2026-10-24T19:00:00.000Z', key);
  const empty = buildStageData({ ...daily, air: { aqi: null }, uv: { index: null }, pollen: {}, mold: { risk: null } }, null, null).readings;
  for (const key of ['air', 'uv', 'pollen', 'mold']) assert.equal(empty[key].readingAt ?? null, null, key);
  const undated = buildStageData({ ...daily, retrieved_at: 'garbage' }, null, null).readings;
  assert.equal(undated.air.readingAt, null);
  for (const key of ['pfas', 'radon', 'lead']) assert.equal(buildStageData(daily, null, null).readings[key].readingAt ?? null, null, key);
});

test('a named UV provider replaces the missing-provider disclosure; an unnamed one keeps it', () => {
  const openMeteo = buildStageData({ ...daily, uv: { ...daily.uv, source: 'open-meteo' } }, null, null).readings.uv;
  assert.equal(openMeteo.source, 'Open-Meteo');
  assert.equal(openMeteo.provenance, 'modeled');
  assert.deepEqual(openMeteo.disclosures, ['A separate UV score is not supplied with this reading.']);
  const openUv = buildStageData({ ...daily, uv: { ...daily.uv, source: 'openuv' } }, null, null).readings.uv;
  assert.equal(openUv.source, 'OpenUV');
  assert.equal(openUv.provenance, null, 'OpenUV method is not asserted');
  for (const source of [undefined, null, 'something-else']) {
    const uv = buildStageData({ ...daily, uv: { ...daily.uv, source } }, null, null).readings.uv;
    assert.equal(uv.source, 'UV forecast', String(source));
    assert.match(uv.disclosures.join(' '), /provider name are not supplied/);
  }
  const noIndex = buildStageData({ ...daily, uv: { index: null, source: 'open-meteo' } }, null, null).readings.uv;
  assert.equal(noIndex.source, 'UV forecast', 'a provider is not credited for a missing reading');
});

test('the daily payload names the UV provider only alongside an index', () => {
  const base = { aqi: 40, pollen: { tree: 1, grass: null, weed: null }, mold: { risk: 'low', basis: null }, cached: false, retrievedAt: '2026-10-25T12:00:00Z' };
  assert.equal(formatDailyPayload({ ...base, uvIndex: 4, uvSource: 'open-meteo' }).uv.source, 'open-meteo');
  assert.equal(formatDailyPayload({ ...base, uvIndex: 4 }).uv.source, null, 'older cached rows stay null');
  assert.equal(formatDailyPayload({ ...base, uvIndex: null, uvSource: 'open-meteo' }).uv.source, null);
  const viaStage = buildStageData(formatDailyPayload({ ...base, uvIndex: 4, uvSource: 'openuv' }), null, null).readings.uv;
  assert.equal(viaStage.source, 'OpenUV');
});
