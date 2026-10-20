/**
 * B16: the curated project library (lib/data/exploreProjectLibrary.json).
 * Every project names its official public sources with a URL and the date
 * each was checked; no text uses U+2014 or the word "safe" (or "safely");
 * every guide passes the client's own validProjectGuide; and the committed
 * file is exactly what scripts/build-project-library.mjs builds from the
 * reviewed frontend guides, so an edit there must be rebuilt here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFrontend } from './frontend-test-loader.mjs';
import { buildLibrary, serialize, LIBRARY_FILE, OFFICIAL_PUBLISHERS, SAFE_WORD, EXCLUDED, KEPT } from '../scripts/build-project-library.mjs';

const { validProjectGuide } = await loadFrontend('production/explore-service');
const { projectGuides } = await loadFrontend('explore-project-guides');
const library = JSON.parse(await readFile(LIBRARY_FILE, 'utf8'));
const EM_DASH = '—';

test('the committed library is exactly what the build script makes from the reviewed guides', async () => {
  assert.equal(await readFile(LIBRARY_FILE, 'utf8'), serialize(await buildLibrary()));
});

test('every project has at least one source, each official, HTTPS and dated, and every step cites one of them', () => {
  assert.ok(library.projects.length >= 15, 'enough projects for the contract\'s 10 to 15 ideas');
  for (const project of library.projects) {
    const { guide } = project;
    assert.ok(guide.sources.length >= 1, `${project.id} has a source`);
    assert.deepEqual(project.sources.map((source) => source.url), guide.sources.map((source) => source.url), `${project.id}: the manifest lists the guide's sources`);
    for (const source of guide.sources) {
      assert.ok(OFFICIAL_PUBLISHERS.includes(source.publisher), `${project.id}: ${source.publisher}`);
      assert.match(source.url, /^https:\/\/[a-z0-9.-]+\.(gov|edu)\//, `${project.id}: ${source.url} is an official site`);
      assert.match(source.checked, /^\d{4}-\d{2}-\d{2}$/);
    }
    const ids = new Set(guide.sources.map((source) => source.id));
    for (const step of guide.steps) {
      assert.ok(step.sourceIds.length && step.sourceIds.every((id) => ids.has(id)), `${project.id}/${step.id}`);
      assert.match(step.id, /^[a-z0-9-]{1,80}$/);
    }
    assert.equal(new Set(guide.steps.map((step) => step.id)).size, guide.steps.length);
    if (guide.buildPlan) assert.ok(ids.has(guide.buildPlan.sourceId));
  }
});

test('no project text uses U+2014 or the word "safe", and none claims a benefit total', () => {
  for (const project of library.projects) {
    const text = JSON.stringify(project.guide);
    assert.equal(text.includes(EM_DASH), false, `${project.id}: U+2014`);
    assert.equal(SAFE_WORD.test(text), false, `${project.id}: ${text.match(SAFE_WORD)?.[0]}`);
    assert.equal(/\b(saves?|reduces?|prevents?)\s+\d/i.test(text), false, `${project.id}: a quantified benefit`);
  }
  assert.equal(JSON.stringify(library).includes(EM_DASH), false);
});

test('every guide passes the client\'s own check, ids are unique, and every frontend guide is either kept or excluded with a reason', () => {
  for (const project of library.projects) assert.ok(validProjectGuide(project.guide), project.id);
  assert.equal(new Set(library.projects.map((project) => project.id)).size, library.projects.length);
  assert.deepEqual(projectGuides.map((guide) => guide.id).sort(), [...Object.keys(KEPT), ...Object.keys(EXCLUDED)].sort());
  for (const { id, reason } of library.excluded) assert.ok(EXCLUDED[id] === reason && reason.length > 20);
  // The catalogue id is never the "demo" one the preview used.
  assert.equal(library.projects.some((project) => project.id.startsWith('demo')), false);
});

test('the word check catches "safe" and "safely" but not "safety" or "unsafe"', () => {
  assert.ok(SAFE_WORD.test('Keep it safe.') && SAFE_WORD.test('Move safely') && !SAFE_WORD.test('Follow the safety instructions') && !SAFE_WORD.test('unsafe food'));
});
