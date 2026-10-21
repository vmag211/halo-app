/**
 * lib/exploreArea.js, the storage half of a household's saved discovery area
 * (B05 plan, Task 3, Rulings D5 and D6), against the in-memory Supabase fake.
 * The database's own rules are in test/exploreAreaSchema.test.mjs (PGlite).
 *
 *  1. No row reads as `{ place: null, revision: 1 }`, the never-saved state.
 *  2. A first save expects revision 1 and stores revision 2, as an insert.
 *  3. A later save at revision N stores N + 1, as an update scoped to N.
 *  4. A stale revision, at 1 or above, is a conflict carrying the revision
 *     held now, and changes nothing.
 *  5. Two first saves racing leave one row: the loser's insert hits the
 *     primary key and is reported as a conflict, not as an error.
 *  6. Clearing keeps the row and still advances the revision.
 *  7. Every query is scoped to the caller, and a second household is untouched.
 *  8. A missing 0022 is recognized, and answered with one non-retryable 503.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // module hooks first, so lib files load as ESM
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';

const exploreArea = await import('../lib/exploreArea.js');
const { readArea, writeArea, isExploreAreaUnavailable, exploreAreaUnavailable, NEVER_SAVED_REVISION } = exploreArea;

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';

const ROWAN = { id: 'us-county:37159', place: 'Rowan County', state: 'NC', label: 'Rowan County, NC', timezone: 'America/New_York' };
const GASTON = { id: 'us-county:37071', place: 'Gaston County', state: 'NC', label: 'Gaston County, NC', timezone: 'America/New_York' };

const fresh = () => createFakeSupabase({ tables: haloTables('explore_areas') });
const rowsOf = (db, owner) => db.rows('explore_areas').filter((row) => row.profile_id === owner);

test('a household that never saved an area reads as no place at revision 1, and has no row', async () => {
  const db = fresh();
  assert.equal(NEVER_SAVED_REVISION, 1);
  assert.deepEqual(await readArea(db, ALICE), { place: null, revision: 1 });
  assert.deepEqual(db.rows('explore_areas'), [], 'reading creates nothing');
});

test('the first save expects revision 1, inserts revision 2 and reads back the same place', async () => {
  const db = fresh();
  const result = await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN });
  assert.deepEqual(result, { ok: true, area: { place: ROWAN, revision: 2 } });
  assert.deepEqual(await readArea(db, ALICE), { place: ROWAN, revision: 2 });
  const [row] = rowsOf(db, ALICE);
  assert.deepEqual(
    { place_id: row.place_id, place: row.place, state: row.state, label: row.label, timezone: row.timezone, revision: row.revision },
    { place_id: ROWAN.id, place: ROWAN.place, state: ROWAN.state, label: ROWAN.label, timezone: ROWAN.timezone, revision: 2 },
  );
  const writes = db.queryLog.filter((query) => query.table === 'explore_areas' && query.operation !== 'select');
  assert.deepEqual(writes.map((query) => query.operation), ['insert'], 'a first save is a plain insert, never an upsert');
});

test('each later save at revision N stores N + 1, as an update scoped to the owner and to N', async () => {
  const db = fresh();
  await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN });
  let revision = 2;
  for (const place of [GASTON, ROWAN, GASTON]) {
    const before = db.queryLog.length;
    const result = await writeArea(db, { profileId: ALICE, expectedRevision: revision, place });
    assert.deepEqual(result, { ok: true, area: { place, revision: revision + 1 } });
    const [update] = db.queryLog.slice(before).filter((query) => query.operation === 'update');
    assert.ok(update, 'a later save is an update');
    assert.ok(
      update.filters.some((filter) => filter.column === 'revision' && filter.op === 'eq' && filter.value === revision),
      'scoped to the expected revision, which is the compare and set',
    );
    revision += 1;
  }
  assert.deepEqual(await readArea(db, ALICE), { place: GASTON, revision: 5 });
  assert.equal(rowsOf(db, ALICE).length, 1, 'still one row');
});

test('a stale revision is a conflict carrying the current revision, and nothing changes', async () => {
  const db = fresh();
  await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN });
  await writeArea(db, { profileId: ALICE, expectedRevision: 2, place: GASTON });
  const before = db.rows('explore_areas');

  assert.deepEqual(
    await writeArea(db, { profileId: ALICE, expectedRevision: 2, place: ROWAN }),
    { ok: false, reason: 'conflict', revision: 3 },
    'an update at a revision the row has moved past',
  );
  assert.deepEqual(
    await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN }),
    { ok: false, reason: 'conflict', revision: 3 },
    'a first save when a row already exists',
  );
  assert.deepEqual(
    await writeArea(db, { profileId: ALICE, expectedRevision: 9, place: ROWAN }),
    { ok: false, reason: 'conflict', revision: 3 },
    'a revision from the future is just as stale',
  );
  assert.deepEqual(db.rows('explore_areas'), before, 'no conflict wrote anything');
});

test('a save at a revision above 1 for a household with no row is a conflict at revision 1', async () => {
  const db = fresh();
  assert.deepEqual(
    await writeArea(db, { profileId: ALICE, expectedRevision: 2, place: ROWAN }),
    { ok: false, reason: 'conflict', revision: 1 },
  );
  assert.deepEqual(db.rows('explore_areas'), [], 'and no row was created');
});

test('two first saves racing leave one row, and the loser is told it conflicted', async () => {
  const db = fresh();
  const results = await Promise.all([
    writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN }),
    writeArea(db, { profileId: ALICE, expectedRevision: 1, place: GASTON }),
  ]);
  const won = results.filter((result) => result.ok);
  const lost = results.filter((result) => !result.ok);
  assert.equal(won.length, 1, 'exactly one first save wins');
  assert.deepEqual(lost, [{ ok: false, reason: 'conflict', revision: 2 }], 'the other sees the winner\'s revision');
  assert.equal(rowsOf(db, ALICE).length, 1, 'one row');
  assert.deepEqual(await readArea(db, ALICE), won[0].area, 'and it holds the winner\'s place');
});

test('two later saves at the same revision: one wins, one conflicts', async () => {
  const db = fresh();
  await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN });
  const results = await Promise.all([
    writeArea(db, { profileId: ALICE, expectedRevision: 2, place: GASTON }),
    writeArea(db, { profileId: ALICE, expectedRevision: 2, place: ROWAN }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.filter((result) => !result.ok), [{ ok: false, reason: 'conflict', revision: 3 }]);
});

test('clearing keeps the row with no place and still advances the revision, and a first save may be a clear', async () => {
  const db = fresh();
  await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN });
  assert.deepEqual(
    await writeArea(db, { profileId: ALICE, expectedRevision: 2, place: null }),
    { ok: true, area: { place: null, revision: 3 } },
  );
  assert.deepEqual(await readArea(db, ALICE), { place: null, revision: 3 });
  const [row] = rowsOf(db, ALICE);
  assert.deepEqual([row.place_id, row.place, row.state, row.label, row.timezone], [null, null, null, null, null], 'all five together');

  assert.deepEqual(
    await writeArea(db, { profileId: BOB, expectedRevision: 1, place: null }),
    { ok: true, area: { place: null, revision: 2 } },
    'a first save that clears still stores revision 2, so a stale 1 cannot follow it',
  );
});

test('every query is scoped to the caller, and the other household is untouched', async () => {
  const db = fresh();
  await writeArea(db, { profileId: BOB, expectedRevision: 1, place: GASTON });
  const bobBefore = rowsOf(db, BOB);
  const before = db.queryLog.length;

  await readArea(db, ALICE);
  await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN });
  await writeArea(db, { profileId: ALICE, expectedRevision: 2, place: GASTON });
  await writeArea(db, { profileId: ALICE, expectedRevision: 2, place: ROWAN }); // conflict, re-reads
  await writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN }); // conflict on the key, re-reads

  auditOwnerScope(db.queryLog.slice(before), ALICE, 'lib/exploreArea.js');
  assert.deepEqual(rowsOf(db, BOB), bobBefore, 'bob\'s area did not move');
  assert.deepEqual(await readArea(db, BOB), { place: GASTON, revision: 2 });
});

test('a save that is not a positive integer revision or a whole place is refused before any query', async () => {
  const db = fresh();
  const bad = [
    { profileId: ALICE, expectedRevision: 0, place: ROWAN },
    { profileId: ALICE, expectedRevision: 1.5, place: ROWAN },
    { profileId: ALICE, expectedRevision: '2', place: ROWAN },
    { profileId: ALICE, expectedRevision: 1, place: undefined },
    { profileId: ALICE, expectedRevision: 1, place: { ...ROWAN, label: undefined } },
    { profileId: ALICE, expectedRevision: 1, place: { ...ROWAN, id: '' } },
    { profileId: ALICE, expectedRevision: 1, place: 'Rowan County' },
    { profileId: '', expectedRevision: 1, place: ROWAN },
  ];
  for (const input of bad) {
    await assert.rejects(() => writeArea(db, input), /exploreArea:/, JSON.stringify(input));
  }
  assert.deepEqual(db.queryLog, [], 'nothing reached the database');
});

test('a database error that is not a conflict is thrown, not reported as one', async () => {
  const failing = {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23514', message: 'check' } }) }) }),
    }),
  };
  await assert.rejects(() => writeArea(failing, { profileId: ALICE, expectedRevision: 1, place: ROWAN }), (error) => error.code === '23514');
});

test('a database error on a later save is thrown, never reported as a stale revision', async () => {
  // If this were mapped to a conflict, the route would answer 409
  // stale_revision and the client would re-read and retry into the same fault.
  // The stub has no select(): a re-read would fail loudly rather than produce
  // a plausible current revision.
  const failing = {
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ select: async () => ({ data: null, error: { code: '23514', message: 'check' } }) }) }),
      }),
    }),
  };
  await assert.rejects(
    () => writeArea(failing, { profileId: ALICE, expectedRevision: 2, place: ROWAN }),
    (error) => error.code === '23514',
  );
});

// ---------------------------------------------------------------------------
// Before migration 0022
// ---------------------------------------------------------------------------

test('a missing table is recognized on read and on write, by the code PostgREST and Postgres use', async () => {
  const db = createFakeSupabase({ tables: {} }); // 0022 not applied
  await assert.rejects(() => readArea(db, ALICE), (error) => isExploreAreaUnavailable(error));
  await assert.rejects(
    () => writeArea(db, { profileId: ALICE, expectedRevision: 1, place: ROWAN }),
    (error) => isExploreAreaUnavailable(error),
  );
  await assert.rejects(
    () => writeArea(db, { profileId: ALICE, expectedRevision: 4, place: ROWAN }),
    (error) => isExploreAreaUnavailable(error),
  );
  for (const code of ['PGRST205', '42P01']) assert.equal(isExploreAreaUnavailable({ code }), true, code);
  for (const error of [null, undefined, {}, { code: '23505' }, { code: '23514' }, { code: 'PGRST116' }, new Error('nope')]) {
    assert.equal(isExploreAreaUnavailable(error), false, JSON.stringify(error));
  }
});

test('the unavailable answer is one non-retryable 503 with no database detail and no em dash', async () => {
  const response = exploreAreaUnavailable(REQUEST_ID);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), null, 'retrying cannot help, so nothing invites it');
  assert.equal(response.headers.get('X-Request-Id'), REQUEST_ID);
  const body = await response.json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal(body.retryable, false);
  assert.ok(body.error && body.error.length > 0, 'there is a sentence to show');
  assert.equal(JSON.stringify(body).includes('—'), false, 'no em dash in app-facing copy');
  assert.equal(/supabase|postgres|pgrst|relation|explore_areas/i.test(JSON.stringify(body)), false, 'nothing about the database leaves');
  const second = await exploreAreaUnavailable('99999999-8888-4777-8666-555555555555').json();
  assert.equal(second.error, body.error, 'every caller gets the identical sentence');
});
