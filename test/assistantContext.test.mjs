import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHouseholdContext, sectionOrder } from '../lib/assistantContext.js';

const today = { date: '2026-09-27', aqi: 160, aqi_source: 'open-meteo', uv_index: 5, pollen: { tree: 1, grass: 4, weed: null }, mold_risk: 'moderate' };
const home = { score: 6, severity: 'severe', utility: 'CONCORD, CITY OF', worst: { contaminant: 'PFOS', value_ppt: 7.3, limit_ppt: 4 }, county: 'Cabarrus County', radon_zone: 3, lead_level: 'elevated', actions: ['Filter your drinking water for PFOS'] };
const journal = { entries: [{ entry_date: '2026-09-26', symptoms: ['cough'], note: 'PRIVATE NOTE' }], findings: ['Symptoms were logged more on high-pollen days.'] };

test('includes readings with severities, the home summary, and journal symptoms', () => {
  const c = buildHouseholdContext({ today, home, journal });
  assert.match(c, /Air quality index 160 \(High\), modeled/);
  assert.match(c, /Pollen High, mostly grass/);
  assert.match(c, /PFOS most recently measured at 7\.3 ppt against a federal limit of 4 ppt/);
  assert.match(c, /Zone 3 \(a county estimate/);
  assert.match(c, /2026-09-26: cough/);
  assert.match(c, /Pattern: Symptoms were logged more/);
});

test('never includes journal free-text notes', () => {
  assert.doesNotMatch(buildHouseholdContext({ journal }), /PRIVATE NOTE/);
});

test('the page decides which section comes first', () => {
  assert.deepEqual(sectionOrder('homeguard'), ['home', 'today', 'journal']);
  assert.deepEqual(sectionOrder('journal'), ['journal', 'today', 'home']);
  const c = buildHouseholdContext({ page: 'home', today, home });
  assert.ok(c.indexOf('Home assessment') < c.indexOf("Today's readings"));
});

test('a well household is told there is no water reading; nothing at all → null', () => {
  assert.match(buildHouseholdContext({ home: { water_source: 'well', county: 'Buncombe County', radon_zone: 1 } }), /private well; no agency tests it/);
  assert.equal(buildHouseholdContext({}), null);
});
