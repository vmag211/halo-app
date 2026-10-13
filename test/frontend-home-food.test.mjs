import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { compareUsage, validateUsage, periodDays, validFoodDate, initialUsage, matchFishRules, droughtReleases, fishRules, foodEvidence } = await loadFrontend('home-food-preview');

test('unverified public fixtures never become food limits or utility instructions', () => {
  const fish = readFileSync(new URL('../components/homeguard/FoodFish.tsx', import.meta.url), 'utf8');
  const water = readFileSync(new URL('../components/homeguard/FoodWater.tsx', import.meta.url), 'utf8');
  const evidence = readFileSync(new URL('../components/homeguard/FoodEvidence.tsx', import.meta.url), 'utf8');
  const share = readFileSync(new URL('../components/homeguard/FoodShared.tsx', import.meta.url), 'utf8');
  assert.match(fish, /mode === 'production' \? rule\.wording : 'No verified recommendation/, 'only verified production sources may provide recommendation text');
  assert.match(fish, /mode === 'production' && <>.*\{rule\.condition\}/, 'source conditions remain gated to production evidence');
  assert.match(fish, /No verified recommendation is available/);
  assert.doesNotMatch(water, /\{release\[item\.key\]\}|Synthetic notice instructions/);
  assert.match(water, /No verified instructions are available/);
  assert.match(evidence, /mode === 'production' \? evidence\.finding : 'Not available'/);
  assert.match(evidence, /mode === 'production' && <FoodDetails[^\n]+\{evidence\.instruction\}/);
  assert.match(evidence, /No verified notice or study is available/);
  assert.match(share, /sourceStatus: mode === 'production' \? 'source-linked' : 'unverified'/);
  assert.match(share, /record: mode === 'production' \? publicRecord : kind === 'resource' \? record : \{ sourceAvailable: false \}/, 'unverified advice must not escape through reference exports');
});

test('fish matching keeps statewide and local records separate and unresolved labels unresolved', () => {
  assert.deepEqual(matchFishRules('demo-willow-lake', 'Largemouth bass').map(item => item.kind), ['Waterbody-specific', 'Statewide']);
  assert.equal(matchFishRules('demo-uncovered', 'Largemouth bass').length, 0);
  assert.equal(matchFishRules('demo-willow-lake', 'unknown').length, 0);
  assert.equal(matchFishRules('demo-willow-river', 'Catfish (unresolved group)')[0].status, 'Review required');
  assert.match(fishRules.find(item => item.id === 'demo-fish-conflict').wording, /withheld/);
});

test('food lifecycle and sample scope remain independent', () => {
  assert.equal(foodEvidence.find(item => item.id === 'demo-terminated').status, 'Terminated in fixture');
  assert.match(foodEvidence.find(item => item.id === 'demo-notice').scope, /DEMO-042 only/);
  assert.equal(foodEvidence.find(item => item.id === 'demo-study').kind, 'Study');
  assert.match(foodEvidence.find(item => item.id === 'demo-study').applicability, /does not identify/);
});

test('dated categorical county releases total 100 without being a home classification', () => {
  for (const release of droughtReleases) assert.equal(['none', 'd0', 'd1', 'd2', 'd3', 'd4'].reduce((total, key) => total + release[key], 0), 100);
});

test('measured interval comparisons retain length, units and gaps without savings attribution', () => {
  const comparison = compareUsage(...initialUsage);
  assert.equal(comparison.compatible, true);
  assert.equal(comparison.difference, -200);
  assert.equal(comparison.days, 30);
  assert.equal(comparison.gapDays, 1);
  assert.equal(comparison.unit, 'US gal');
  assert.match(comparison.description, /not savings attributed/);
  assert.deepEqual(compareUsage(initialUsage[1], initialUsage[0]), comparison, 'input order does not invert chronological change');
});

test('usage comparisons reject incompatible sources, units, bases, intervals and contexts', () => {
  const [a, b] = initialUsage;
  for (const patch of [{ unit: 'L' }, { basis: 'estimated' }, { basis: 'user-reported' }, { source: 'Different method' }, { site: 'Other site' }, { meter: 'Other meter' }, { reset: true }, { kind: 'meter' }, { end: '2026-10-02' }]) assert.equal(compareUsage(a, { ...b, ...patch }).compatible, false, JSON.stringify(patch));
  assert.equal(compareUsage(a, { ...b, start: '2026-08-02', end: '2026-09-01' }).compatible, false, 'overlapping periods');
  assert.equal(compareUsage(a, a).compatible, false);
});

test('cumulative meter readings calculate use only and reject rollovers and same-date readings', () => {
  const a = { ...initialUsage[0], kind: 'meter', end: '2026-09-01', quantity: '1000' };
  const b = { ...initialUsage[1], kind: 'meter', end: '2026-10-01', quantity: '1400' };
  const result = compareUsage(a, b);
  assert.equal(result.compatible, true);
  assert.equal(result.kind, 'meter');
  assert.equal(result.difference, 400);
  assert.equal(result.days, 30);
  assert.match(result.description, /not a change between two usage periods/);
  assert.equal(compareUsage(a, { ...b, quantity: '50' }).compatible, false);
  assert.equal(compareUsage(a, { ...b, reset: true }).compatible, false);
  assert.equal(compareUsage(a, { ...b, end: a.end }).compatible, false);
});

test('usage validation preserves zero and rejects blank, nonfinite, negative and impossible dates', () => {
  const a = initialUsage[0];
  assert.equal(validateUsage({ ...a, quantity: '0' }), null);
  for (const patch of [{ quantity: '' }, { quantity: 'NaN' }, { quantity: '-1' }, { quantity: 'Infinity' }, { end: '2026-02-30' }, { start: '2026-02-30' }, { unit: '' }, { site: '' }, { end: a.start }]) assert.ok(validateUsage({ ...a, ...patch }), JSON.stringify(patch));
  assert.ok(validateUsage({ ...a, kind: 'meter', end: '2026-02-30' }));
  assert.equal(validFoodDate('2028-02-29'), true);
  assert.equal(validFoodDate('2026-02-29'), false);
  assert.equal(periodDays('2026-03-01', '2026-04-01'), 31, 'day count ignores daylight saving');
});
