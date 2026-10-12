import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { appTabs, routeOwner, deliveredStagePath } = await loadFrontend('navigation');
const { actionDraftError, validActionDate, destinations, followThrough } = await loadFrontend('expanded-preview');

test('four-tab ownership moves Map to Explore and Journal to My Week, not live delivery', () => {
  assert.deepEqual(appTabs.map(tab => tab.label), ['My Week', 'Today', 'Homeguard', 'Explore']);
  for (const path of ['/map', '/map/district?layer=water', '/act/projects']) assert.equal(routeOwner(path), 'act');
  for (const path of ['/journal', '/journal/patterns', '/plan/actions/a']) assert.equal(routeOwner(path), 'plan');
  for (const path of ['/factors/pfas', '/factors/radon', '/factors/lead', '/household/senior', '/home/tests']) assert.equal(routeOwner(path), 'home');
  for (const path of ['/factors/air', '/factors/uv', '/factors/pollen', '/factors/mold', '/family']) assert.equal(routeOwner(path), 'today');
  for (const path of ['/map', '/plan', '/home/tests', '/journal', '/act']) assert.equal(deliveredStagePath(path), false);
  for (const path of ['/settings', '/factors/uv', '/household/pregnant']) assert.equal(deliveredStagePath(path), true);
  for (const path of ['/homeish', '/actress', '//evil.example', '/settings']) assert.equal(routeOwner(path), null);
});
test('all seven factors have owned follow-through destinations', () => {
  assert.equal(Object.keys(followThrough).length, 7);
  for (const factor of Object.values(followThrough)) assert.ok(destinations[factor.destination]);
  assert.equal(destinations.food.tab, 'home');
  assert.equal(destinations.journal.tab, 'plan');
});
test('preview calendar dates are dates, not fabricated timestamps', () => {
  for (const date of ['', '2026-10-03', '2028-02-29']) assert.equal(validActionDate(date), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-10-03T10:00Z', 'bad', '2026-13-01']) assert.equal(validActionDate(date), false);
  assert.ok(actionDraftError('   ', ''));
  assert.ok(actionDraftError('a'.repeat(161), ''));
  assert.equal(actionDraftError('Call my water utility', ''), null);
});
