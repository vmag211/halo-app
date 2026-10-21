import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
import { waterCounts } from '../lib/mapData.js';
const { exceedsLimit, waterMapReading } = await loadFrontend('map-preview');

// Live NC water layer, 2026-10-21: three systems reported PFOA or PFOS at 4.1 ppt against the 4 ppt limit.
// Their one-decimal ratio is 1.0, so a ratio test missed them and the map said 111 of 290 while the
// layer's own counts said 114.
const reading = (value_ppt, limit_ppt, ratio) => ({ value_ppt, limit_ppt, ratio, severity: 'high', proposed_for_rescission: false });
const system = (contaminants) => ({ pwsid: 'X', name: 'X', lat: 35, lng: -80, population: 1, overall_severity: 'high', coverage: 'measured', latest_sample_iso: null, hazard_index: null, detected_unregulated: [], contaminants });

test('a value above its limit is over the limit even when the rounded ratio is 1.0', () => {
  assert.equal(exceedsLimit(reading(4.1, 4, 1)), true);
  assert.equal(exceedsLimit(reading(4, 4, 1)), false);
  assert.equal(exceedsLimit(reading(3.9, 4, 1)), false);
  assert.equal(exceedsLimit(undefined), false);
  assert.equal(exceedsLimit({ limit_ppt: 4, severity: 'no_data', proposed_for_rescission: false }), false);
  assert.equal(waterMapReading(system({ PFOA: reading(4.1, 4, 1), PFOS: reading(4, 4, 1) }), 'overall'), '1 over limit');
});

test('the map counts agree with the layer counts the server returns', () => {
  const features = [
    system({ PFOA: reading(4.1, 4, 1) }),
    system({ PFOS: reading(4, 4, 1) }),
    system({ PFOS: reading(8.3, 4, 2.1) }),
    system({ PFNA: { limit_ppt: 10, severity: 'no_data', proposed_for_rescission: false } }),
  ];
  const client = features.filter(f => Object.values(f.contaminants).some(exceedsLimit)).length;
  assert.equal(client, waterCounts(features).over_limit);
  assert.equal(client, 2);
});
