import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { foodEvidenceRecords, evidenceForFood, foodEvidenceReviewedAt } = await loadFrontend('food-evidence');
const { catalogueFood } = await loadFrontend('food-catalogue');

test('curated food evidence retains original study scope, units, source dates and sample boundaries', () => {
  assert.equal(foodEvidenceRecords.length, 4);
  assert.equal(foodEvidenceReviewedAt, '2026-10-03');
  assert.equal(new Set(foodEvidenceRecords.map(record => record.id)).size, 4);
  for (const record of foodEvidenceRecords) {
    assert.equal(record.scope, 'food-study');
    assert.equal(record.sample.detects + record.sample.nonDetects, record.sample.count);
    assert.ok(record.sample.limit > 0);
    assert.ok(record.source.locator && record.source.sampledAt && record.source.publishedAt);
    assert.equal(new URL(record.source.url).hostname, 'www.fda.gov');
    assert.match(record.limitation, /not a measurement or estimate of your food/);
    assert.ok(record.sample.basis && record.sample.method && record.sample.description);
    for (const foodId of record.foodIds) assert.ok(catalogueFood(foodId));
    for (const forbidden of ['risk', 'score', 'safe', 'itemConcentration', 'dose']) assert.equal(Object.hasOwn(record, forbidden), false);
    assert.equal(JSON.stringify(record).includes('\u2014'), false);
  }
});

test('food lookup distinguishes study availability from an unknown household item level', () => {
  const tuna = evidenceForFood({ foodId: 'canned-tuna' });
  assert.equal(tuna.studies[0].analyte, 'PFOS');
  assert.equal(tuna.indicators[0].label, 'Study available');
  assert.equal(tuna.indicators[0].itemLevel, 'Unknown');
  assert.equal(tuna.indicators[1].label, 'Guidance available');
  assert.equal(tuna.indicators[1].itemLevel, 'Unknown');
  assert.equal(evidenceForFood({ name: '  SPINACH  ' }).studies[0].analyte, 'Lead (Pb)');
});

test('nearby names, broad categories and unknown foods cannot inherit study findings', () => {
  for (const query of [{ guideId: 'produce' }, { name: 'Spinach pie' }, { foodId: 'infant-formula' }, { foodId: 'almond-drink' }, { name: 'Chocolate milk' }, { foodId: '../../milk' }, {}]) {
    const result = evidenceForFood(query);
    assert.deepEqual(result.studies, []);
    assert.ok(result.indicators.every(item => item.itemLevel === 'Unknown' && item.evidenceCount === 0));
  }
});

test('published nondetects are not converted into measured zero or a safe badge', () => {
  const milk = evidenceForFood({ foodId: 'milk' }).studies[0];
  assert.equal(milk.sample.nonDetects, 27);
  assert.equal(milk.sample.limit, 1);
  assert.equal(milk.sample.limitKind, 'reporting-limit');
  assert.match(milk.limitation, /Not detected does not mean zero/);
  assert.equal(milk.metrics[0].qualifier, 'not-detected');
  const salmon = evidenceForFood({ foodId: 'salmon' }).studies[0];
  assert.equal(salmon.sample.nonDetects, 2);
  assert.equal(salmon.sample.limit, 16);
  assert.match(salmon.limitation, /not total PFAS/);
});

test('verified sampled results match FDA source transcription', () => {
  const tuna = evidenceForFood({ foodId: 'tuna' }).studies[0];
  assert.equal(tuna.metrics[1].value, '50 to 195');
  assert.equal(tuna.sample.detects, 5);
  assert.equal(tuna.sample.limit, 39);
  const spinach = evidenceForFood({ foodId: 'spinach' }).studies[0];
  assert.equal(spinach.metrics[1].value, '18');
  assert.equal(spinach.sample.detects, 21);
  assert.equal(spinach.sample.limit, 4);
});
