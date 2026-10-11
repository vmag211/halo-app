import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { getPreviewProjectContext, generateProjectSuggestions, createProjectGeneration, defaultProjectConstraints, inferProjectConstraints, normalizeProjectConstraints, projectGenerationNotice } = await loadFrontend('explore-personalization');
const { findProjectGuide, projectGuides } = await loadFrontend('explore-project-guides');
const collections = {
  gardens: [{ id: 'garden-a', revision: 2, title: 'Raised bed', setup: 'Raised bed', irrigation: 'Unknown' }],
  observations: [{ id: 'damp-a', revision: 1, title: 'Window condensation', kind: 'condensation', observedAt: '2026-09-30T08:30', reading: '' }],
  assets: [{ id: 'filter-a', revision: 3, title: 'Kitchen filter', factor: 'pfas', status: 'active', model: '', serviced: '2026-09-01' }],
  tests: [{ id: 'soil-a', revision: 1, title: 'Garden report', kind: 'soil', review: 'needs_clarification', reviewReason: 'Reported unit and soil sample basis are missing.', collectionStart: '2026-09-18' }],
};

test('default generation produces12unique source-backed varied ideas, preserving canonical guide IDs', () => {
  const context = getPreviewProjectContext(collections);
  const result = generateProjectSuggestions(context);
  assert.equal(result.length, 12);
  assert.equal(new Set(result.map(item => item.id)).size, 12);
  assert.ok(result.some(item => item.id === 'soil-test-plan'));
  assert.ok(result.some(item => item.id === 'moisture-check'));
  assert.ok(new Set(result.map(item => findProjectGuide(item.id).cause)).size >= 3);
  for (const item of result) {
    const guide = findProjectGuide(item.id);
    assert.ok(guide); assert.ok(item.reason); assert.ok(item.tags.length >= 2);
    assert.deepEqual(item.sourceIds, guide.sources.map(source => source.id));
    assert.ok(item.evidenceIds.every(id => context.evidence.some(evidence => evidence.id === id)));
  }
  for (const count of [10, 11, 12, 13, 14, 15]) assert.equal(generateProjectSuggestions(context, { ...defaultProjectConstraints, count }).length, count);
  const refreshed = createProjectGeneration(context, defaultProjectConstraints, '', 2);
  assert.equal(refreshed.generation, 2);
  assert.notDeepEqual(refreshed.items.map(item => item.id), result.map(item => item.id));
});

test('refresh prioritizes unseen eligible ideas and short interest requests never use unrelated filler', () => {
  const context = getPreviewProjectContext(collections);
  const first = createProjectGeneration(context);
  const next = createProjectGeneration({ ...context, previousIdeaIds: first.items.map(item => item.id) }, first.constraints, first.request, 2, false);
  assert.notEqual(next.items[0].id, first.items[0].id);
  assert.ok(next.items.some(item => !first.items.some(previous => previous.id === item.id)));
  const focused = createProjectGeneration({ ...context, interestOnly: true }, { ...defaultProjectConstraints, count: 3 }, 'native plants and pollinators');
  assert.equal(focused.items.length, 3); assert.ok(focused.items.every(item => item.fit === 'interest'));
  const unsupported = createProjectGeneration({ ...context, interestOnly: true }, { ...defaultProjectConstraints, count: 3 }, 'an aquaponics installation');
  assert.equal(unsupported.items.length, 0);
  assert.equal(normalizeProjectConstraints({ count: 3 }).count, 3);
  assert.equal(normalizeProjectConstraints({ count: 5 }).count, 5);
});
test('the guide bank provides19real differentiated families with safe instructions and provenance', () => {
  assert.equal(projectGuides.length, 19);
  for (const guide of projectGuides) {
    assert.ok(guide.materials.length >= 4); assert.ok(guide.constraints.length >= 3); assert.equal(guide.steps.length, 4);
    for (const step of guide.steps) { assert.ok(step.instructions.length >= 2); assert.ok(step.checkpoint); assert.ok(step.sourceIds.every(id => guide.sources.some(source => source.id === id))); }
    assert.ok(guide.completion); assert.ok(guide.followup);
  }
  assert.match(findProjectGuide('rain-barrel').constraints.join(' '), /Do not drink/);
  assert.match(findProjectGuide('soil-test-plan').constraints.join(' '), /does not certify crop safety/);
  assert.match(findProjectGuide('air-cleaner-plan').constraints.join(' '), /not a radon/);
});
test('missing public environment context does not load fixture evidence or private records', () => {
  for (const input of [undefined, {}, { assets: [] }, { tests: [] }, { gardens: [null, {}, { id: '', title: 'Invalid', revision: 1 }] }]) {
    const context = getPreviewProjectContext(input, undefined, false);
    assert.equal(context.evidence.length, 0); assert.equal(context.state, ''); assert.equal(context.county, '');
    assert.equal(context.hasGarden, false); assert.equal(context.hasMoistureObservation, false); assert.equal(context.filterModelKnown, false);
    const ideas = generateProjectSuggestions(context);
    assert.equal(ideas.length, 12); assert.ok(ideas.every(item => item.fit === 'general' && item.evidenceIds.length === 0));
  }
  const context = getPreviewProjectContext(undefined);
  assert.ok(context.evidence.length > 0);
  assert.ok(context.evidence.every(item => !['garden', 'moisture', 'filter', 'test'].includes(item.topic)));
});
test('explicit owned records may contribute when public context is missing, without other domains leaking in', () => {
  const context = getPreviewProjectContext({ gardens: collections.gardens }, undefined, false);
  assert.equal(context.evidence.length, 1); assert.equal(context.evidence[0].topic, 'garden');
  assert.equal(context.hasGarden, true); assert.equal(context.hasMoistureObservation, false);
  const changed = getPreviewProjectContext({ gardens: [{ ...collections.gardens[0], revision: 3 }] }, undefined, false);
  assert.notEqual(context.key, changed.key);
});
test('stale daily examples and public versus home scopes are explicit and never produce invented diagnoses', () => {
  const context = getPreviewProjectContext(collections);
  assert.ok(context.evidence.filter(item => ['air', 'uv', 'pollen', 'weather'].includes(item.topic)).every(item => item.stale));
  assert.match(context.evidence.find(item => item.topic === 'weather').scope, /not an indoor/);
  assert.match(context.evidence.find(item => item.topic === 'water').scope, /not a test of this tap or garden water/);
  assert.match(context.evidence.find(item => item.topic === 'radon').scope, /not an indoor home concentration/);
  assert.equal(context.gardenWaterKnown, false);
  assert.match(generateProjectSuggestions(context).find(item => item.id === 'garden-water').reason, /unknown/);
  const outdoor = generateProjectSuggestions(context).find(item => item.id === 'demo-habitat-project');
  assert.match(outdoor.needsCheck.join(' '), /outdated.*current air/);
  assert.ok(outdoor.evidenceIds.some(id => id.includes('today:uv')));
  const currentParticles = { ...context, evidence: [{ id: 'real-current-air', topic: 'air', label: 'Outdoor air', value: '135 AQI', numericValue: 135, unit: 'AQI', pollutant: 'PM2.5', stale: false, status: 'available', scope: 'Outdoor monitor', asOf: 'Current test evidence', provenance: 'Measured' }] };
  const particleIdea = generateProjectSuggestions(currentParticles, { ...defaultProjectConstraints, count: 15 }).find(item => item.id === 'air-cleaner-plan');
  assert.match(particleIdea.reason, /does not measure indoor air or establish smoke/);
  assert.ok(!generateProjectSuggestions({ ...currentParticles, evidence: [{ ...currentParticles.evidence[0], pollutant: 'O3' }] }, defaultProjectConstraints, 'air').find(item => item.id === 'air-cleaner-plan').reason.includes('supplied current outdoor'));
  assert.ok(!JSON.stringify(context).includes('\u2014'));
});
test('natural-language interests change recommendations without treating source data as instructions', () => {
  const context = getPreviewProjectContext(collections);
  const base = generateProjectSuggestions(context);
  const solar = generateProjectSuggestions(context, defaultProjectConstraints, 'I want a solar energy experiment for fun');
  assert.equal(solar[0].id, 'solar-oven'); assert.notEqual(solar[0].id, base[0].id);
  const indoor = generateProjectSuggestions(context, defaultProjectConstraints, 'Projects I can do inside on my own with existing materials');
  assert.ok(indoor.every(item => !['demo-habitat-project', 'bee-house', 'community-cleanup', 'solar-oven', 'native-tree', 'rain-barrel'].includes(item.id)));
  assert.ok(indoor.length < 12);
  assert.match(projectGenerationNotice(context, createProjectGeneration(context, defaultProjectConstraints, 'inside on my own with existing materials')), /does not invent unsuitable/);
  const parsed = inferProjectConstraints('Give me 15 projects on my balcony with friends');
  assert.equal(parsed.count, 15); assert.equal(parsed.space, 'balcony'); assert.equal(parsed.mode, 'group');
  assert.ok(generateProjectSuggestions(context, { ...defaultProjectConstraints, time: 'half-day' }).every(item => item.tags.includes('Build or planting session')));
  assert.ok(!generateProjectSuggestions(context, { ...defaultProjectConstraints, time: 'ongoing' }).some(item => item.id === 'solar-oven'));
  const explicit = createProjectGeneration(context, { ...defaultProjectConstraints, space: 'indoors', mode: 'solo' }, 'A project in my yard with friends', 2, false);
  assert.equal(explicit.constraints.space, 'indoors'); assert.equal(explicit.constraints.mode, 'solo');
  assert.ok(!explicit.items.some(item => item.id === 'native-tree' || item.id === 'community-cleanup'));
});
test('source-unavailable and constrained-no-match differ; inputs and canonical projects remain unmutated', () => {
  const context = getPreviewProjectContext(collections);
  const snapshot = structuredClone(context);
  const constraints = { ...defaultProjectConstraints, space: 'indoors', mode: 'group', budget: 'reuse' };
  const original = structuredClone(constraints);
  const batch = createProjectGeneration(context, constraints);
  assert.deepEqual(context, snapshot); assert.deepEqual(constraints, original);
  const unavailable = { ...context, sourceStatus: 'unavailable' };
  assert.deepEqual(generateProjectSuggestions(unavailable), []);
  assert.match(projectGenerationNotice(unavailable, createProjectGeneration(unavailable)), /unavailable.*not a no-match/);
  assert.ok(batch.items.every(item => findProjectGuide(item.id)));
  assert.deepEqual(normalizeProjectConstraints({ space: 'invented', count: 999 }), defaultProjectConstraints);
});
