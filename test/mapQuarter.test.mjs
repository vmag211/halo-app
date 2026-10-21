import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMapQuarter, QUARTER_RE, LATEST_QUARTER } from '../lib/mapQuarter.js';

const LAYERS = ['water', 'radon', 'facilities', 'air'];
const NONE = { ok: true, quarter: null };
const NOT_APPLICABLE = { ok: false, code: 'quarter_not_applicable', message: 'quarter applies to the water layer only.' };
const INVALID = { ok: false, code: 'invalid_quarter', message: 'quarter looks like 2024Q3.' };
// The route suite's BAD_QUARTERS (test/routesMapDistrict.test.mjs), as the query decodes them, plus casing of `latest`.
const BAD_QUARTERS = ['2024Q5', '2024Q0', '2024q3', '24Q3', '2024Q', '2024Q3 ', '2024-Q3', '20245Q3', 'abc', "2024Q3'"];
const NOT_LATEST = ['Latest', 'LATEST', 'latest ', ' latest', 'latest\n', 'lates', 'latest,2024Q3', 'newest', 'current'];

test('mapQuarter: absent, empty and exactly `latest` all mean no quarter, on every layer (D2)', () => {
  assert.equal(LATEST_QUARTER, 'latest');
  for (const layer of LAYERS) {
    for (const value of [null, undefined, '', 'latest']) {
      assert.deepEqual(parseMapQuarter(value, layer), NONE, `${layer} ${JSON.stringify(value)}`);
    }
  }
});

test('mapQuarter: a well formed quarter is the quarter on water, and not applicable on every other layer', () => {
  for (const quarter of ['2024Q1', '2024Q2', '2024Q3', '2024Q4', '1999Q1']) {
    assert.deepEqual(parseMapQuarter(quarter, 'water'), { ok: true, quarter });
    for (const layer of ['radon', 'facilities', 'air']) assert.deepEqual(parseMapQuarter(quarter, layer), NOT_APPLICABLE, `${layer} ${quarter}`);
  }
});

test('mapQuarter: every other value on water is invalid_quarter, including `Latest` and `LATEST`', () => {
  for (const value of [...BAD_QUARTERS, ...NOT_LATEST]) assert.deepEqual(parseMapQuarter(value, 'water'), INVALID, JSON.stringify(value));
});

test('mapQuarter: on a layer other than water anything but `latest` keeps its quarter_not_applicable, as before D2', () => {
  for (const layer of ['radon', 'facilities', 'air']) {
    for (const value of [...BAD_QUARTERS, ...NOT_LATEST]) assert.deepEqual(parseMapQuarter(value, layer), NOT_APPLICABLE, `${layer} ${JSON.stringify(value)}`);
  }
});

test('mapQuarter: the quarter shape is the one the client filters `quarters` with (F: map-service.ts:29)', () => {
  const clientRule = /^\d{4}Q[1-4]$/;
  assert.equal(QUARTER_RE.source, clientRule.source);
  assert.equal(QUARTER_RE.flags, clientRule.flags);
});

test('mapQuarter: a non-string value is never a quarter', () => {
  for (const value of [2024, ['2024Q3'], { quarter: '2024Q3' }, true]) assert.deepEqual(parseMapQuarter(value, 'water'), INVALID);
});
