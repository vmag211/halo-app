import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { foodGuides, foodGuide, foodGuideSources, foodGuideEssentials, foodOriginContext, searchFoodGuides, validatePantryItem, cleanFoodNote, initialPantryItems } = await loadFrontend('food-pfas-guide');
const { foodCatalogue, catalogueFood, searchFoods, pantryContaminants, pantryResultLabel, validFoodStorage } = await loadFrontend('food-catalogue');

test('food guide has five sourced educational categories, no seeded private inventory or measured result', () => {
  assert.equal(foodGuides.length, 5);
  assert.equal(new Set(foodGuides.map(guide => guide.id)).size, 5);
  assert.deepEqual(initialPantryItems, []);
  for (const guide of foodGuides) {
    assert.ok(foodGuideSources[guide.findingSource]);
    assert.ok(guide.finding && guide.limit && guide.question);
    for (const forbidden of ['score', 'concentration', 'risk', 'dose', 'brand', 'result', 'safe']) assert.equal(Object.hasOwn(guide, forbidden), false);
  }
  assert.match(foodGuideEssentials.boundary, /cannot detect PFAS/);
  assert.match(foodGuideEssentials.diet, /varied, balanced diet/);
});

test('food search matches foods rather than suggesting a contamination measurement', () => {
  assert.equal(searchFoodGuides('SALMON')[0].id, 'seafood');
  assert.equal(searchFoodGuides('  spinach ')[0].id, 'produce');
  assert.equal(searchFoodGuides('milk')[0].id, 'dairy');
  assert.equal(searchFoodGuides('chicken')[0].id, 'meat');
  assert.equal(searchFoodGuides('peanut butter')[0].id, 'pantry');
  assert.deepEqual(searchFoodGuides('unreviewed dragonfruit'), []);
  assert.equal(searchFoodGuides('').length, 5);
  assert.equal(foodGuide('../../source'), undefined);
  assert.equal(foodGuide(undefined), undefined);
});

test('origins lead to distinct relevant next steps and invalid origins cannot fabricate fish context', () => {
  assert.equal(foodOriginContext(foodGuide('seafood'), 'caught').nextView, 'fish');
  assert.equal(foodOriginContext(foodGuide('produce'), 'homegrown').nextView, 'gardens');
  assert.equal(foodOriginContext(foodGuide('dairy'), 'store').nextView, 'evidence');
  assert.equal(foodOriginContext(foodGuide('dairy'), 'caught').nextView, 'evidence');
  assert.equal(foodOriginContext(foodGuide('meat'), 'homegrown').title, 'Start with what you know');
});

test('food notes require valid category and source context, bounded name and a useful question', () => {
  const valid = { title: 'Example spinach', guideId: 'produce', origin: 'homegrown', question: 'What is known about my irrigation source?' };
  assert.equal(validatePantryItem(valid), '');
  for (const patch of [{ title: '' }, { title: 'a'.repeat(81) }, { guideId: 'unknown' }, { origin: 'caught' }, { question: ' ' }, { question: 'a'.repeat(501) }]) assert.notEqual(validatePantryItem({ ...valid, ...patch }), '');
  assert.equal(cleanFoodNote('  A question\u2014not a result  '), 'A question, not a result');
  assert.equal(validatePantryItem({ ...valid, storage: 'fridge', question: '' }), '');
  assert.equal(validatePantryItem({ ...valid, storage: 'pantry', question: '   ' }), '');
  assert.notEqual(validatePantryItem({ ...valid, storage: 'missing', question: '' }), '');
  assert.notEqual(validatePantryItem({ ...valid, storage: 'freezer', question: 'a'.repeat(501) }), '');
});

test('editorial source URLs are primary references and all copy avoids em dashes', () => {
  for (const source of Object.values(foodGuideSources)) assert.match(new URL(source.url).hostname, /^(www\.(fda|epa)\.gov|content\.ces\.ncsu\.edu)$/);
  assert.equal(JSON.stringify({ foodGuides, foodGuideSources, foodGuideEssentials }).includes('\u2014'), false);
});

test('individual catalogue covers common household foods and aliases without invented concentration fields', () => {
  assert.ok(foodCatalogue.length >= 140);
  assert.equal(new Set(foodCatalogue.map(food => food.id)).size, foodCatalogue.length);
  for (const food of foodCatalogue) {
    assert.ok(foodGuide(food.guideId));
    assert.ok(food.name && food.id);
    assert.deepEqual(Object.keys(food).sort(), ['aliases', 'guideId', 'id', 'name']);
  }
  for (const [query, expected] of [['oatmeal', 'Oats'], ['prawns', 'Shrimp'], ['yoghurt', 'Yogurt'], ['bell pepper', 'Bell peppers'], ['baby formula', 'Infant formula'], ['almond milk', 'Almond drink']]) assert.ok(searchFoods(query).some(food => food.name === expected));
  assert.equal(catalogueFood('milk').name, 'Milk');
  assert.equal(catalogueFood('../../private'), undefined);
  assert.deepEqual(searchFoods('a-food-not-in-the-catalogue'), []);
  assert.deepEqual(pantryContaminants, ['PFAS', 'Lead']);
  assert.equal(pantryResultLabel, 'Unknown');
  assert.ok(validFoodStorage('pantry'));
  assert.equal(validFoodStorage('risk'), false);
});
