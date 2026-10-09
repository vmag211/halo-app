import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ESM without the typeless-package warning
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';

const { HISTORY_ROW_LIMIT, JOURNAL_ROW_LIMIT, HOME_CONTEXTS_ROW_LIMIT, isTruncated } = await import('../lib/boundedRead.js');

test('the row limits are the ones the brief fixes', () => {
  assert.equal(HISTORY_ROW_LIMIT, 5000);
  assert.equal(JOURNAL_ROW_LIMIT, 2000);
});

test('the home contexts list reads at most 100 homes', () => {
  assert.equal(HOME_CONTEXTS_ROW_LIMIT, 100);
});

test('isTruncated: the exact count is the truth, so a full page that is everything is not truncated', () => {
  assert.equal(isTruncated({ count: 5000, returned: 5000, limit: 5000 }), false); // exactly the limit, nothing hidden
  assert.equal(isTruncated({ count: 5001, returned: 5000, limit: 5000 }), true);
  assert.equal(isTruncated({ count: 3, returned: 3, limit: 5000 }), false);
  assert.equal(isTruncated({ count: 0, returned: 0, limit: 5000 }), false);
});

test('isTruncated: a server row cap below our limit is still detected (count says more exist)', () => {
  assert.equal(isTruncated({ count: 1500, returned: 1000, limit: 5000 }), true);
});

test('isTruncated: without a usable count, a full page is assumed to hide rows and a short page is not', () => {
  assert.equal(isTruncated({ count: null, returned: 5000, limit: 5000 }), true);
  assert.equal(isTruncated({ count: undefined, returned: 4999, limit: 5000 }), false);
  assert.equal(isTruncated({ count: 'x', returned: 10, limit: 5000 }), false);
});

test('the fake can simulate PostgREST\'s row cap: fewer rows than .limit() asked for, count still total', async () => {
  const rows = Array.from({ length: 12 }, (_, n) => ({ id: n + 1 }));
  const db = createFakeSupabase({ tables: { items: { primaryKey: 'id' } }, seed: { items: rows } });

  const open = await db.from('items').select('*', { count: 'exact' }).limit(10);
  assert.deepEqual([open.data.length, open.count], [10, 12]);

  db.setMaxRows(4);
  const capped = await db.from('items').select('*', { count: 'exact' }).limit(10);
  assert.deepEqual([capped.data.length, capped.count], [4, 12]);
  assert.equal((await db.from('items').select('*').limit(2)).data.length, 2); // a smaller limit still wins

  db.setMaxRows(Infinity);
  assert.equal((await db.from('items').select('*')).data.length, 12);
});
