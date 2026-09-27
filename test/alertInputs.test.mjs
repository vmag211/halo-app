import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNwsAdvisories, readingsFingerprint, normalizePrefs, justEndedSeason } from '../lib/alertInputs.js';
import { evaluateAlerts } from '../lib/alertRules.js';

test('NWS: flood and heat events kept with their ids; others and test messages dropped', () => {
  const a = parseNwsAdvisories({ features: [
    { properties: { id: 'urn:1', event: 'Flood Warning', status: 'Actual', ends: 'x' } },
    { properties: { id: 'urn:2', event: 'Heat Advisory', status: 'Actual' } },
    { properties: { id: 'urn:3', event: 'Beach Hazards Statement', status: 'Actual' } },
    { properties: { id: 'urn:4', event: 'Coastal Flood Advisory', status: 'Test' } },
  ] });
  assert.deepEqual(a.map((x) => [x.id, x.kind]), [['urn:1', 'flood'], ['urn:2', 'heat']]);
  assert.deepEqual(parseNwsAdvisories(null), []);
});

test('fingerprint is stable under reordering and changes when readings change', () => {
  const x = { PFOS: [{ date: '1/7/2025', value_ppt: 9.1 }, { date: '10/23/2024', value_ppt: 8.2 }], PFOA: [] };
  const y = { PFOA: [], PFOS: [{ value_ppt: 8.2, date: '10/23/2024' }, { value_ppt: 9.1, date: '1/7/2025' }] };
  assert.equal(readingsFingerprint(x), readingsFingerprint(y));
  const z = { ...x, PFOS: [...x.PFOS, { date: '4/1/2025', value_ppt: 8.6 }] };
  assert.notEqual(readingsFingerprint(x), readingsFingerprint(z));
});

test('preferences default every type on; stored false values are respected', () => {
  assert.deepEqual(Object.values(normalizePrefs(null)), [true, true, true, true, true]);
  assert.equal(normalizePrefs({ radon_season: false }).radon_season, false);
  assert.equal(normalizePrefs({ radon_season: false }).air_quality_change, true);
});

test('a season "just ended" only in the first week of the next one', () => {
  assert.deepEqual(justEndedSeason('2026-06-03'), { season: 'spring', year: 2026 });
  assert.deepEqual(justEndedSeason('2027-03-01'), { season: 'winter', year: 2026 });
  assert.equal(justEndedSeason('2026-06-08'), null);
  assert.equal(justEndedSeason('2026-07-01'), null);
});

test('advisories dedupe on the NWS id, so a multi-day advisory fires once', () => {
  const day1 = evaluateAlerts({ advisories: [{ id: 'urn:1', kind: 'flood' }], date: '2026-09-27' });
  const day2 = evaluateAlerts({ advisories: [{ id: 'urn:1', kind: 'flood' }], date: '2026-09-28' });
  assert.equal(day1[0].dedupe_key, day2[0].dedupe_key);
});

test('season summary uses the season year and carries the recap sentence', () => {
  const [a] = evaluateAlerts({
    seasonEnded: { season: 'winter', year: 2025, statement: 'This winter you logged 5 days.' },
    hasJournalEntries: true, year: 2026, month: 3,
  });
  assert.equal(a.dedupe_key, 'season_summary:winter:2025');
  assert.equal(a.message, 'This winter you logged 5 days.');
});
