import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeWhyYours } from '../lib/learnWhyYours.js';

const q = (obj) => (k) => (k in obj ? String(obj[k]) : null);

test('air uses the value, severity, provenance and driving pollutant', () => {
  const s = composeWhyYours('air', q({ value: 78, severity: 'moderate', source: 'open-meteo', pollutant: 'PM2.5' }));
  assert.match(s, /index is 78 \(moderate\)/);
  assert.match(s, /modeled estimate/);
  assert.match(s, /PM2\.5 is setting it/);
});

test('uv uses the value and severity, and the peak window when given', () => {
  const s = composeWhyYours('uv', q({ value: 6.2, severity: 'elevated', peak_start: '11:00', peak_end: '18:00' }));
  assert.match(s, /UV index is 6\.2 \(elevated\)/);
  assert.match(s, /from 11:00 to 18:00/);
  assert.match(composeWhyYours('uv', q({ value: 0.4 })), /too low right now/);
});

test('pollen names the category and level', () => {
  const s = composeWhyYours('pollen', q({ value: 4, severity: 'high', category: 'Weed' }));
  assert.match(s, /Weed pollen is high for you today \(index 4 of 5\)/);
});

test('mold states it is an estimate and shows its inputs', () => {
  const s = composeWhyYours('mold', q({ severity: 'elevated', humidity: 82, precip: 40 }));
  assert.match(s, /estimated elevated/);
  assert.match(s, /82% humidity and a 40% chance of rain/);
  assert.match(s, /not a measurement/);
});

test('no reading context → null, never a generic filler line', () => {
  for (const t of ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon']) {
    assert.equal(composeWhyYours(t, q({})), null, t);
  }
  // no_data isn't a reading either
  assert.equal(composeWhyYours('pollen', q({ severity: 'no_data' })), null);
});

test('pfas and radon keep their existing wording', () => {
  assert.match(composeWhyYours('pfas', q({ contaminant: 'PFOS', value: 7.3, limit: 4 })), /PFOS at 7\.3 ppt — about 1\.8× the federal limit of 4 ppt/);
  assert.match(composeWhyYours('radon', q({ county: 'Cabarrus County', zone: 3 })), /Zone 3 radon area/);
});

test('lead defers to the lead assessment text', () => {
  assert.equal(composeWhyYours('lead', q({ home_year: 1975 }), () => ({ text: 'ESTIMATE' })), 'ESTIMATE');
});
