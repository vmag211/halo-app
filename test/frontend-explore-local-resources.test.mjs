import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { localResourceScope, filterLocalResources, localParticipationResources } = await loadFrontend('explore-local-resources');

test('only exact supported NC labels choose a curated local scope', () => {
  assert.equal(localResourceScope({ place: '', state: '' }), 'examples');
  assert.equal(localResourceScope({ place: ' Charlotte ', state: 'NC' }), 'charlotte');
  assert.equal(localResourceScope({ place: 'Mecklenburg County', state: 'North Carolina' }), 'charlotte');
  assert.equal(localResourceScope({ place: 'Union County', state: 'NC' }), 'union');
  assert.equal(localResourceScope({ place: 'Monroe', state: 'NC' }), 'union');
  for (const area of [{ place: 'Charlotte', state: '' }, { place: 'Charlotte', state: 'Michigan' }, { place: 'Union County', state: 'New Jersey' }, { place: 'Raleigh', state: 'NC' }, { place: '', state: 'NC' }, { place: 'Not Charlotte', state: 'NC' }]) {
    assert.equal(localResourceScope(area), 'elsewhere');
  }
});

test('unsupported geography never produces invented local matches', () => {
  assert.deepEqual(filterLocalResources('elsewhere'), []);
  assert.ok(filterLocalResources('charlotte').every(resource => resource.scopes.includes('charlotte')));
  assert.deepEqual(filterLocalResources('union').map(resource => resource.id), ['union-gardener']);
});

test('resource filters require every search term and preserve actual interest scope', () => {
  assert.deepEqual(filterLocalResources('charlotte', 'Trees & habitat').map(resource => resource.id), ['trees-charlotte']);
  assert.deepEqual(filterLocalResources('examples', 'All interests', 'Union gardening').map(resource => resource.id), ['union-gardener']);
  assert.deepEqual(filterLocalResources('examples', 'All interests', 'Union madeup'), []);
});

test('reviewed routes have factual guides and no invented event availability', () => {
  assert.equal(new Set(localParticipationResources.map(resource => resource.id)).size, localParticipationResources.length);
  for (const resource of localParticipationResources) {
    assert.equal(new URL(resource.url).protocol, 'https:');
    assert.equal(resource.steps.length, 4);
    assert.ok(resource.age && resource.cost && resource.access && resource.followup);
    assert.equal(Object.hasOwn(resource, 'eventDate'), false);
    assert.equal(Object.hasOwn(resource, 'capacity'), false);
    if (resource.address) assert.ok(resource.addressRole);
  }
});
