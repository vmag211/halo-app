import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utilityLeadInventory } from '../lib/leadInventory.js';

test('Concord: counts from the NC DEQ results, galvanized summed into needs_replacement', () => {
  const inv = utilityLeadInventory('NC0113010');
  assert.equal(inv.utility, 'CONCORD, CITY OF');
  assert.equal(inv.lead, 0);
  assert.equal(inv.galvanized_requiring_replacement, 1449);
  assert.equal(inv.non_lead, 43255);
  assert.equal(inv.needs_replacement, 1449);
  assert.equal(inv.address_level, false);
  assert.match(inv.source.url, /^https:\/\/www\.deq\.nc\.gov\//);
});

test('unknown utility or bad input → null', () => {
  assert.equal(utilityLeadInventory('NC9999999'), null);
  assert.equal(utilityLeadInventory(undefined), null);
});
