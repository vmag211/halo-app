import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrospectiveComparison, seasonSummary, seasonRange, lastEndedSeason } from '../lib/journalRetro.js';
import { rowsToHistory } from '../lib/journalHistory.js';

// A month of history: grass pollen high on the 3 flagged days, low otherwise.
function month() {
  const h = [];
  for (let d = 1; d <= 20; d++) {
    const date = `2026-04-${String(d).padStart(2, '0')}`;
    const flagged = [3, 9, 15].includes(d);
    h.push({ date, air: 'good', uv: 'moderate', mold: 'good', pollen: flagged ? 'high' : 'good',
      tree: 'good', grass: flagged ? 'high' : 'good', weed: 'good' });
  }
  return h;
}

test('retrospective: reports the factor with the biggest flagged-vs-unflagged gap', () => {
  const r = retrospectiveComparison({ dates: ['2026-04-03', '2026-04-09', '2026-04-15'], history: month() });
  assert.equal(r.ready, true);
  assert.equal(r.factor, 'grass');
  assert.equal(r.statement, "On the 3 days you flagged, grass pollen averaged High. The month's average was Good. Days you didn't flag averaged Good.");
});

test('retrospective: not ready with fewer than two flagged days that have readings', () => {
  const r = retrospectiveComparison({ dates: ['2026-04-03', '2026-05-30'], history: month() });
  assert.equal(r.ready, false);
  assert.equal(r.flagged_days_with_readings, 1);
  assert.match(r.statement, /only one of the days/);
  assert.equal(retrospectiveComparison({ dates: [], history: month() }).ready, false);
});

test('retrospective: no factor stands out → ready, factor null, says so plainly', () => {
  const flat = month().map((d) => ({ ...d, grass: 'good', pollen: 'good' }));
  const r = retrospectiveComparison({ dates: ['2026-04-03', '2026-04-09'], history: flat });
  assert.equal(r.ready, true);
  assert.equal(r.factor, null);
  assert.match(r.statement, /none of the readings/);
});

test('season ranges and the most recently ended season', () => {
  assert.deepEqual(seasonRange('spring', 2026), { from: '2026-03-01', to: '2026-05-31' });
  assert.deepEqual(seasonRange('winter', 2027), { from: '2027-12-01', to: '2028-02-29' }); // leap year
  assert.deepEqual(lastEndedSeason('2026-09-27'), { season: 'summer', year: 2026 });
  assert.deepEqual(lastEndedSeason('2026-01-10'), { season: 'fall', year: 2025 });
  assert.deepEqual(lastEndedSeason('2026-04-01'), { season: 'winter', year: 2025 });
});

test('season summary counts logged days and flagged high days, excluding illness', () => {
  const entries = [
    { entry_date: '2026-04-03', symptoms: ['cough'] },
    { entry_date: '2026-04-09', symptoms: ['congestion'] },
    { entry_date: '2026-04-15', symptoms: ['sneezing'], possibly_illness: true }, // excluded from flagged
    { entry_date: '2026-04-16', symptoms: [] }, // logged, nothing flagged
  ];
  const s = seasonSummary({ season: 'spring', year: 2026, entries, history: month() });
  assert.equal(s.logged_days, 4);
  assert.equal(s.factor, 'pollen');
  assert.equal(s.statement, 'This spring you logged 4 days. On the 3 high-pollen days, you flagged symptoms 2 times.');
});

test('season summary with nothing logged just says so', () => {
  const s = seasonSummary({ season: 'summer', year: 2026, entries: [], history: [] });
  assert.equal(s.statement, 'This summer you logged 0 days.');
  assert.equal(s.factor, null);
});

test('rowsToHistory: one record per date (first row = latest), per-category pollen', () => {
  const h = rowsToHistory([
    { date: '2026-04-02', aqi: 40, uv_index: 2, pollen_level: '{"tree":1,"grass":4,"weed":null}', mold_risk: 'low' },
    { date: '2026-04-02', aqi: 180, uv_index: 9, pollen_level: null, mold_risk: 'high' }, // older refresh
    { date: '2026-04-01', aqi: null, uv_index: null, pollen_level: 'not json', mold_risk: null },
  ]);
  assert.equal(h.length, 2);
  assert.equal(h[0].date, '2026-04-01');
  assert.equal(h[0].air, 'no_data');
  assert.equal(h[1].grass, 'high');
  assert.equal(h[1].pollen, 'high');
  assert.equal(h[1].air, 'good');
});
