import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { projectGuides, findProjectGuide, searchProjectGuides, projectStepIndex, projectActionKey, projectCompletionError } = await loadFrontend('explore-project-guides');

test('project catalogue supplies concrete versioned guides with ordered instructions and follow-up', () => {
  assert.equal(new Set(projectGuides.map(item => item.id)).size, projectGuides.length);
  for (const id of ['demo-habitat-project', 'bee-house', 'community-cleanup', 'solar-oven', 'demo-water-project']) {
    const guide = findProjectGuide(id);
    assert.ok(guide); assert.match(guide.version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
    assert.equal(guide.steps.length, 4); assert.ok(guide.materials.length >= 4);
    assert.ok(guide.constraints.length >= 3); assert.ok(guide.completion); assert.ok(guide.followup);
    for (const step of guide.steps) {
      assert.ok(step.title); assert.ok(step.instructions.length >= 2); assert.ok(step.checkpoint);
      for (const sourceId of step.sourceIds) assert.ok(guide.sources.some(item => item.id === sourceId));
    }
  }
});
test('guide citations remain primary HTTPS sources, checked dates and no invented live claims', () => {
  for (const guide of projectGuides) for (const source of guide.sources) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(['content.ces.ncsu.edu', 'www.charlottenc.gov', 'www.ncdot.gov', 'www.nasa.gov', 'science.nasa.gov', 'www.epa.gov', 'www.fws.gov', 'extension.umn.edu', 'parkandrec.mecknc.gov'].includes(url.hostname));
    assert.equal(source.checked, '2026-10-11');
  }
  assert.ok(!JSON.stringify(projectGuides).includes('\u2014'));
});
test('project keys preserve canonical legacy IDs and reject stale or malformed indices', () => {
  assert.equal(projectActionKey('demo-water-project', 0), 'explore:project:demo-water-project:step:0');
  assert.equal(projectActionKey('demo-habitat-project', 3), 'explore:project:demo-habitat-project:step:3');
  for (const index of [-1, 4, 0.5, NaN, Infinity]) assert.equal(projectActionKey('demo-water-project', index), null);
  assert.equal(projectActionKey('missing', 0), null);
  assert.equal(projectStepIndex(100, 4), 3); assert.equal(projectStepIndex(-2, 4), 0); assert.equal(projectStepIndex(NaN, 4), 0);
});
test('project search works across materials and cause without hiding alternatives', () => {
  assert.deepEqual(searchProjectGuides('solar').map(item => item.id), ['solar-oven']);
  assert.deepEqual(searchProjectGuides('bee house', 'Habitats').map(item => item.id), ['bee-house']);
  assert.deepEqual(searchProjectGuides('foil').map(item => item.id), ['solar-oven']);
  assert.equal(searchProjectGuides('not-a-project').length, 0);
  assert.equal(searchProjectGuides('   ').length, 19);
});
test('whole-project completion requires all canonical steps and a real result', () => {
  assert.match(projectCompletionError(3, 4, 'Actual work'), /each project step/);
  assert.match(projectCompletionError(4, 4, '  '), /actually recorded/);
  assert.match(projectCompletionError(4, 4, 'x'.repeat(2001)), /2,000/);
  assert.equal(projectCompletionError(4, 4, 'I planted two locally selected plants and recorded a care check.'), null);
  assert.ok(projectCompletionError(0, 0, 'Invalid template'));
});
test('physical activities retain their specific safety and suitability limits', () => {
  assert.match(findProjectGuide('bee-house').constraints.join(' '), /Never open, clean or discard occupied nests/);
  assert.match(findProjectGuide('solar-oven').constraints.join(' '), /without food/);
  assert.match(findProjectGuide('community-cleanup').constraints.join(' '), /needles/);
  assert.match(findProjectGuide('demo-habitat-project').scope, /North Carolina/);
  const build = findProjectGuide('bee-house').buildPlan;
  assert.equal(build.parts.reduce((count, item) => count + item.quantity, 0), 7);
  assert.equal(build.assembly.length, 4);
  assert.match(build.note, /actual dimensions/);
  assert.match(build.note, /experienced adult/);
  const seasonal = findProjectGuide('bee-house').steps[3].instructions.join(' ');
  assert.match(seasonal, /During active nesting/);
  assert.match(seasonal, /intact occupied tubes/);
  assert.match(seasonal, /bring the box outdoors after the last spring frost/);
  assert.match(seasonal, /full growing season/);
});
