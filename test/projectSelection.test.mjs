/**
 * B16: the deterministic project selection (lib/projectSelection.js). The
 * transcribed constraint rules agree with the client's own compiled modules
 * over one corpus (the drift test), and every set it makes, wrapped as the
 * routes wrap it, passes the client's validProjectGeneration.
 */
import './helpers/routeLoader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
import {
  DEFAULT_CONSTRAINTS, COUNTS, SELECTION_COPY, LIBRARY_GUIDES, inferProjectConstraints, normalizeProjectConstraints, selectProjects, validProjectConstraints,
} from '../lib/projectSelection.js';
const { todayEvidence, homeEvidence, workspaceEvidence } = await import('../lib/projectEvidence.js');

const client = await loadFrontend('production/explore-service');
const personalization = await loadFrontend('explore-personalization');
const { completedResult } = await import('../lib/projectsStore.js');

const SPACES = ['any', 'indoors', 'balcony', 'yard', 'community'];
const MODES = ['any', 'solo', 'group'];
const TIMES = ['any', 'quick', 'half-day', 'ongoing'];
const BUDGETS = ['any', 'reuse', 'low'];
const all = () => SPACES.flatMap((space) => MODES.flatMap((mode) => TIMES.flatMap((time) => BUDGETS.map((budget) => ({ space, mode, time, budget })))));

test('drift: the constraint rules are the client\'s', () => {
  const corpus = [
    ...all().map((c) => ({ ...c, count: 12 })), { ...DEFAULT_CONSTRAINTS, count: 4 }, { ...DEFAULT_CONSTRAINTS, count: '12' }, { space: 'roof' }, null, [], {},
    { ...DEFAULT_CONSTRAINTS, count: 15, extra: true },
  ];
  for (const value of corpus) {
    assert.equal(validProjectConstraints(value), client.validProjectConstraints(value), JSON.stringify(value));
    if (value && typeof value === 'object') assert.deepEqual(normalizeProjectConstraints(value), personalization.normalizeProjectConstraints(value));
  }
  for (const request of ['', 'indoors only', 'no yard but a balcony', 'something with friends this afternoon', 'free and quick', 'cheap long-term 5 projects', 'my backyard', 'neighbourhood cleanup 15 ideas', 'I don\'t have a yard']) {
    assert.deepEqual(inferProjectConstraints(request, DEFAULT_CONSTRAINTS), personalization.inferProjectConstraints(request, personalization.defaultProjectConstraints), request);
  }
  assert.deepEqual(DEFAULT_CONSTRAINTS, personalization.defaultProjectConstraints);
});

const evidence = [
  ...todayEvidence({ date: '2026-10-20', aqi: 42, aqi_source: 'airnow', uv_index: 4, pollen_level: '{"tree":1}', mold_risk: 'low' }, '2026-10-20'),
  ...homeEvidence({ home: { id: 'h1', water_source: 'utility', home_year: 1975, effective_from: '2026-09-01T00:00:00Z' }, profile: null }),
];
const wrap = (selection, request = '') => completedResult({ id: 'g1', contextKey: 'u:h:1', request, generation: 1, selection, evidence });

test('every choice combination and count gives a set the client accepts, never above the count, never a project outside the choices', () => {
  for (const constraints of all()) {
    for (const count of COUNTS) {
      const selection = selectProjects({ evidence, constraints: { ...constraints, count }, state: 'NC' });
      assert.ok(selection.items.length <= count);
      assert.ok(client.validProjectGeneration(wrap(selection)), JSON.stringify({ constraints, count }));
      assert.equal(new Set(selection.items.map((item) => item.id)).size, selection.items.length);
      if (selection.items.length < count) assert.ok([SELECTION_COPY.fewer(selection.items.length), SELECTION_COPY.none].includes(selection.message));
    }
  }
  const quickIndoor = selectProjects({ evidence, constraints: { space: 'indoors', mode: 'any', time: 'quick', budget: 'any', count: 15 } });
  assert.ok(quickIndoor.items.length < 15 && quickIndoor.items.length > 0, 'fewer, honestly');
  assert.equal(quickIndoor.message, SELECTION_COPY.fewer(quickIndoor.items.length));
});

test('the default asks reach 10 to 15 ideas, deterministically, with diversity and no repeated id', () => {
  for (const count of [10, 12, 15]) {
    const a = selectProjects({ evidence, constraints: { ...DEFAULT_CONSTRAINTS, count } });
    const b = selectProjects({ evidence, constraints: { ...DEFAULT_CONSTRAINTS, count } });
    assert.equal(a.items.length, count);
    assert.deepEqual(a, b);
  }
  const first = selectProjects({ evidence, constraints: { ...DEFAULT_CONSTRAINTS, count: 5 } });
  assert.ok(new Set(first.items.map((item) => LIBRARY_GUIDES.find((guide) => guide.id === item.id).cause)).size >= 2, 'more than one kind of project');
});

test('previous ideas are ranked last and a later generation rotates the general ones', () => {
  const first = selectProjects({ evidence, constraints: { ...DEFAULT_CONSTRAINTS, count: 5 } });
  const next = selectProjects({ evidence, constraints: { ...DEFAULT_CONSTRAINTS, count: 5 }, previousIdeaIds: first.items.map((item) => item.id), generation: 2 });
  assert.equal(next.items.filter((item) => first.items.some((seen) => seen.id === item.id)).length, 0);
});

test('reasons follow the evidence, unknown evidence never boosts, and the checks name what to confirm', () => {
  const water = selectProjects({ evidence, constraints: DEFAULT_CONSTRAINTS }).items.find((item) => item.id === 'water-report-check');
  assert.equal(water.fit, 'context');
  assert.deepEqual(water.evidenceIds, ['home:water-source', 'home:building-year']);
  const unknownWater = homeEvidence({ home: null, profile: { water_source: null } });
  const plain = selectProjects({ evidence: unknownWater, constraints: DEFAULT_CONSTRAINTS }).items.find((item) => item.id === 'water-report-check');
  assert.equal(plain.fit, 'general');
  assert.equal(plain.reason, SELECTION_COPY.general);
  const outdoor = selectProjects({ evidence: [], constraints: DEFAULT_CONSTRAINTS, renter: true, state: 'VA' }).items;
  const rain = selectProjects({ evidence: [], constraints: { ...DEFAULT_CONSTRAINTS, space: 'yard' }, renter: true, state: 'VA' }).items.find((item) => item.id === 'rain-garden-plan');
  assert.ok(rain.needsCheck.includes(SELECTION_COPY.owner));
  assert.ok(rain.needsCheck.includes(SELECTION_COPY.region));
  assert.ok(outdoor.some((item) => item.needsCheck.includes(SELECTION_COPY.outdoorNone)));
  // Workspace records drive context without copying their text.
  const records = workspaceEvidence({ observations: [{ id: 'o1', revision: 2, homeContextId: 'h1', reading: '70', observedAt: '2026-10-01T00:00:00Z', note: 'TYPED' }] }, 'h1');
  assert.equal(JSON.stringify(records).includes('TYPED'), false);
  const moisture = selectProjects({ evidence: records, constraints: DEFAULT_CONSTRAINTS }).items[0];
  assert.equal(moisture.id, 'moisture-check');
  assert.deepEqual(moisture.evidenceIds, ['workspace:observations:o1:2']);
});

test('every sentence the selection writes is free of U+2014 and of the word "safe"', () => {
  const sentences = [...Object.values(SELECTION_COPY).map((value) => (typeof value === 'function' ? value(3) : value))];
  for (const constraints of all()) for (const item of selectProjects({ evidence, constraints: { ...constraints, count: 15 }, request: 'bees and trees', state: 'VA', renter: true }).items) sentences.push(item.reason, ...item.tags, ...item.needsCheck);
  for (const sentence of sentences) {
    assert.equal(sentence.includes('—'), false, sentence);
    assert.equal(/\bsafe(ly)?\b/i.test(sentence), false, sentence);
  }
});
