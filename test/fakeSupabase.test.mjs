import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase, rpcError, tokenFor } from './helpers/fakeSupabase.mjs';

// A small fake with two owners, so a forgotten owner filter is visible.
const ITEMS = [
  { id: 1, owner: 'a', n: 5, label: 'Alpha', day: '2026-01-01', note: null, flag: true },
  { id: 2, owner: 'a', n: 7, label: 'beta', day: '2026-01-03', note: 'x', flag: false },
  { id: 3, owner: 'b', n: 9, label: 'Gamma', day: '2026-01-02', note: 'y', flag: true },
  { id: 4, owner: 'b', n: 1, label: 'delta', day: '2026-01-04', note: null, flag: null },
];

function makeDb(extra = {}) {
  return createFakeSupabase({
    tables: { items: { primaryKey: 'id' }, ...extra.tables },
    seed: { items: ITEMS, ...extra.seed },
    identities: extra.identities,
  });
}

const ids = async (query) => (await query).data.map((row) => row.id);

test('a filter really filters: the owner filter is the only thing keeping rows apart', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select('*')), [1, 2, 3, 4]); // a route that forgets it leaks
  assert.deepEqual(await ids(db.from('items').select('*').eq('owner', 'a')), [1, 2]);
  assert.deepEqual(await ids(db.from('items').select('*').eq('owner', 'nobody')), []);
});

test('eq, neq and in', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select().eq('id', 3)), [3]);
  assert.deepEqual(await ids(db.from('items').select().eq('n', '7')), [2]); // typed like the column
  assert.deepEqual(await ids(db.from('items').select().eq('flag', false)), [2]);
  assert.deepEqual(await ids(db.from('items').select().neq('owner', 'a')), [3, 4]);
  assert.deepEqual(await ids(db.from('items').select().in('id', [2, 4, 99])), [2, 4]);
  assert.deepEqual(await ids(db.from('items').select().in('id', [])), []);
});

test('SQL null semantics: comparisons with NULL never match, is() does', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select().neq('note', 'x')), [3]); // NULL notes excluded
  assert.deepEqual(await ids(db.from('items').select().eq('note', null)), []);
  assert.deepEqual(await ids(db.from('items').select().is('note', null)), [1, 4]);
  assert.deepEqual(await ids(db.from('items').select().not('note', 'is', null)), [2, 3]);
  assert.deepEqual(await ids(db.from('items').select().is('flag', true)), [1, 3]);
  assert.deepEqual(await ids(db.from('items').select().is('flag', false)), [2]);
  assert.deepEqual(await ids(db.from('items').select().not('note', 'eq', 'x')), [3]);
});

test('gt, gte, lt, lte compare numbers numerically and dates by value', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select().gt('n', 5)), [2, 3]);
  assert.deepEqual(await ids(db.from('items').select().gte('n', 5)), [1, 2, 3]);
  assert.deepEqual(await ids(db.from('items').select().lt('n', 5)), [4]);
  assert.deepEqual(await ids(db.from('items').select().lte('n', 5)), [1, 4]);
  assert.deepEqual(await ids(db.from('items').select().gte('day', '2026-01-02').lte('day', '2026-01-03')), [2, 3]);

  const db2 = createFakeSupabase({ seed: { logs: [{ id: 1, at: '2026-01-01T10:00:00+00:00' }, { id: 2, at: '2026-01-01T12:00:00+00:00' }] } });
  assert.deepEqual(await ids(db2.from('logs').select().gt('at', '2026-01-01T10:30:00.000Z')), [2]);
});

test('like and ilike use % and _, ilike ignores case', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select().like('label', '%a')), [1, 2, 3, 4]);
  assert.deepEqual(await ids(db.from('items').select().like('label', 'Al%')), [1]);
  assert.deepEqual(await ids(db.from('items').select().like('label', 'al%')), []);
  assert.deepEqual(await ids(db.from('items').select().ilike('label', 'AL%')), [1]);
  assert.deepEqual(await ids(db.from('items').select().ilike('label', '_ELTA')), [4]);
});

test('or and match combine conditions', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select().or('id.eq.1,id.eq.4')), [1, 4]);
  assert.deepEqual(await ids(db.from('items').select().or('note.is.null,n.gt.8')), [1, 3, 4]);
  assert.deepEqual(await ids(db.from('items').select().or('and(owner.eq.a,n.gt.5),id.in.(4)')), [2, 4]);
  assert.deepEqual(await ids(db.from('items').select().eq('owner', 'b').or('note.is.null,n.gt.8')), [3, 4]);
  assert.deepEqual(await ids(db.from('items').select().match({ owner: 'a', flag: true })), [1]);
});

test('unsupported builder methods throw instead of silently matching everything', () => {
  const db = makeDb();
  assert.throws(() => db.from('items').select().contains('label', ['x']), /does not support \.contains\(\)/);
  assert.throws(() => db.from('items').select('id, other(*)'), /embedded resources/);
});

test('select projects columns, aliases them, and never hands out stored rows', async () => {
  const db = makeDb();
  const { data } = await db.from('items').select('id, tag:label, missing').eq('id', 1);
  assert.deepEqual(data, [{ id: 1, tag: 'Alpha', missing: null }]);

  const all = (await db.from('items').select('*').eq('id', 1)).data[0];
  all.label = 'tampered';
  assert.equal((await db.from('items').select('label').eq('id', 1)).data[0].label, 'Alpha');
});

test('order sorts by several keys, honours ascending and null placement', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select().order('owner', { ascending: false }).order('n')), [4, 3, 1, 2]);
  assert.deepEqual(await ids(db.from('items').select().order('day', { ascending: false })), [4, 2, 3, 1]);
  // Postgres: NULLs last when ascending, first when descending, unless told otherwise.
  assert.deepEqual(await ids(db.from('items').select().order('note')), [2, 3, 1, 4]);
  assert.deepEqual(await ids(db.from('items').select().order('note', { ascending: false })), [1, 4, 3, 2]);
  assert.deepEqual(await ids(db.from('items').select().order('note', { nullsFirst: true })), [1, 4, 2, 3]);
});

test('limit, range and count', async () => {
  const db = makeDb();
  assert.deepEqual(await ids(db.from('items').select().order('id').limit(2)), [1, 2]);
  assert.deepEqual(await ids(db.from('items').select().order('id').range(1, 2)), [2, 3]);
  const counted = await db.from('items').select('*', { count: 'exact' }).eq('owner', 'a').limit(1);
  assert.equal(counted.data.length, 1);
  assert.equal(counted.count, 2); // the total before the limit
  const head = await db.from('items').select('id', { count: 'exact', head: true });
  assert.deepEqual([head.data, head.count, head.error], [null, 4, null]);
  assert.equal((await db.from('items').select()).count, null);
});

test('single and maybeSingle follow PostgREST for zero, one and many rows', async () => {
  const db = makeDb();
  assert.equal((await db.from('items').select().eq('id', 2).single()).data.label, 'beta');
  assert.equal((await db.from('items').select().eq('id', 2).maybeSingle()).data.label, 'beta');

  const none = await db.from('items').select().eq('id', 99).maybeSingle();
  assert.deepEqual([none.data, none.error], [null, null]);
  const missing = await db.from('items').select().eq('id', 99).single();
  assert.equal(missing.error.code, 'PGRST116');
  assert.equal(missing.data, null);

  for (const method of ['single', 'maybeSingle']) {
    const many = await db.from('items').select().eq('owner', 'a')[method]();
    assert.equal(many.error.code, 'PGRST116');
    assert.match(many.error.details, /2 rows/);
  }
});

test('insert stores rows, returns them only after select(), and applies defaults', async () => {
  const db = makeDb({ tables: { notes: { primaryKey: 'id', defaults: { id: () => 'generated', kind: 'plain' } } } });
  const bare = await db.from('notes').insert({ text: 'one' });
  assert.deepEqual([bare.data, bare.error], [null, null]);

  const returned = await db.from('notes').insert([{ id: 'n2', text: 'two' }, { id: 'n3', text: 'three' }]).select('id, kind');
  assert.deepEqual(returned.data, [{ id: 'n2', kind: 'plain' }, { id: 'n3', kind: 'plain' }]);
  assert.deepEqual(db.rows('notes').map((row) => row.id), ['generated', 'n2', 'n3']);

  const single = await db.from('notes').insert({ id: 'n4', text: 'four' }).select().single();
  assert.equal(single.data.text, 'four');
});

test('an insert that breaks a primary key or unique constraint fails whole, Postgres style', async () => {
  const db = createFakeSupabase({
    tables: { logs: { primaryKey: 'id', unique: [['owner', 'day', 'band']] } },
    seed: { logs: [{ id: 1, owner: 'a', day: 'd1', band: 'x' }] },
  });
  const pk = await db.from('logs').insert([{ id: 2, owner: 'a', day: 'd2', band: 'x' }, { id: 1, owner: 'b', day: 'd1', band: 'x' }]);
  assert.equal(pk.error.code, '23505');
  assert.match(pk.error.message, /duplicate key value violates unique constraint "logs_pkey"/);
  assert.match(pk.error.details, /Key \(id\)=\(1\) already exists/);
  assert.equal(db.rows('logs').length, 1); // the valid first row was not kept

  const composite = await db.from('logs').insert({ id: 3, owner: 'a', day: 'd1', band: 'x' });
  assert.equal(composite.error.code, '23505');
  assert.match(composite.error.message, /logs_owner_day_band_key/);

  const withinBatch = await db.from('logs').insert([{ id: 5, owner: 'z', day: 'd', band: 'x' }, { id: 6, owner: 'z', day: 'd', band: 'x' }]);
  assert.equal(withinBatch.error.code, '23505');

  const nullKey = await db.from('logs').insert({ owner: 'a', day: 'd9', band: 'x' });
  assert.equal(nullKey.error.code, '23502');

  // NULLs never collide in a unique constraint.
  assert.equal((await db.from('logs').insert([{ id: 7, owner: 'q', day: null, band: 'x' }, { id: 8, owner: 'q', day: null, band: 'x' }])).error, null);
});

test('upsert merges on the declared conflict columns and keeps the other columns', async () => {
  const db = createFakeSupabase({
    tables: { prefs: { primaryKey: 'profile_id' } },
    seed: { prefs: [{ profile_id: 'a', locale: 'en', renter: true }, { profile_id: 'b', locale: 'en', renter: false }] },
  });
  const merged = await db.from('prefs').upsert({ profile_id: 'a', locale: 'es' }, { onConflict: 'profile_id' }).select().maybeSingle();
  assert.deepEqual(merged.data, { profile_id: 'a', locale: 'es', renter: true });
  assert.deepEqual(db.rows('prefs').find((row) => row.profile_id === 'b'), { profile_id: 'b', locale: 'en', renter: false });

  await db.from('prefs').upsert({ profile_id: 'c', locale: 'es' }); // onConflict defaults to the primary key
  assert.equal(db.rows('prefs').length, 3);

  const bulk = await db.from('prefs').upsert([{ profile_id: 'a', locale: 'en' }, { profile_id: 'd', locale: 'fr' }]).select('profile_id');
  assert.deepEqual(bulk.data, [{ profile_id: 'a' }, { profile_id: 'd' }]);
});

test('upsert on a composite key, with ignoreDuplicates, and with a bad conflict target', async () => {
  const db = createFakeSupabase({
    tables: { logs: { primaryKey: 'id', unique: [['owner', 'day']], defaults: { id: () => crypto.randomUUID() } } },
    seed: { logs: [{ id: 'l1', owner: 'a', day: 'd1', note: 'old' }] },
  });
  const updated = await db.from('logs').upsert({ owner: 'a', day: 'd1', note: 'new' }, { onConflict: 'owner,day' }).select();
  assert.deepEqual(updated.data, [{ id: 'l1', owner: 'a', day: 'd1', note: 'new' }]);

  const ignored = await db.from('logs').upsert([{ owner: 'a', day: 'd1', note: 'again' }, { owner: 'a', day: 'd2', note: 'fresh' }], { onConflict: 'owner,day', ignoreDuplicates: true }).select();
  assert.deepEqual(ignored.data.map((row) => row.note), ['fresh']); // only inserted rows come back
  assert.equal(db.rows('logs').find((row) => row.day === 'd1').note, 'new');

  const bad = await db.from('logs').upsert({ owner: 'a', note: 'x' }, { onConflict: 'owner' });
  assert.equal(bad.error.code, '42P10');
});

test('upsert refuses to touch one row twice and rolls back on any other unique clash', async () => {
  const db = createFakeSupabase({
    tables: { subs: { primaryKey: 'id', unique: [['endpoint']] } },
    seed: { subs: [{ id: 1, endpoint: 'e1', owner: 'a' }, { id: 2, endpoint: 'e2', owner: 'b' }] },
  });
  const twice = await db.from('subs').upsert([{ id: 1, owner: 'x' }, { id: 1, owner: 'y' }]);
  assert.equal(twice.error.code, '21000');

  // Conflict on id, but the new endpoint already belongs to another row.
  const clash = await db.from('subs').upsert({ id: 1, endpoint: 'e2', owner: 'a' });
  assert.equal(clash.error.code, '23505');
  assert.deepEqual(db.rows('subs').map((row) => row.endpoint), ['e1', 'e2']);

  // Upserting on the unique column itself moves the row to the new owner.
  await db.from('subs').upsert({ endpoint: 'e2', owner: 'a' }, { onConflict: 'endpoint' }).select();
  assert.equal(db.rows('subs').find((row) => row.endpoint === 'e2').owner, 'a');
});

test('update changes only the filtered rows and returns them after select()', async () => {
  const db = makeDb();
  const updated = await db.from('items').update({ note: 'seen' }).eq('owner', 'b').eq('id', 3).select('id, note');
  assert.deepEqual(updated.data, [{ id: 3, note: 'seen' }]);
  assert.deepEqual(db.rows('items').map((row) => row.note), [null, 'x', 'seen', null]);

  const none = await db.from('items').update({ note: 'z' }).eq('owner', 'nobody').select();
  assert.deepEqual([none.data, none.error], [[], null]);
  assert.deepEqual((await db.from('items').update({ note: 'q' }).eq('id', 1)).data, null);

  const broke = createFakeSupabase({ tables: { u: { primaryKey: 'id', unique: [['slug']] } }, seed: { u: [{ id: 1, slug: 'a' }, { id: 2, slug: 'b' }] } });
  const clash = await broke.from('u').update({ slug: 'a' }).eq('id', 2);
  assert.equal(clash.error.code, '23505');
  assert.equal(broke.rows('u')[1].slug, 'b');
});

test('delete removes only the filtered rows, and select() afterwards returns what was removed', async () => {
  const db = makeDb();
  const removed = await db.from('items').delete().eq('owner', 'a').select('id');
  assert.deepEqual(removed.data, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(db.rows('items').map((row) => row.id), [3, 4]);

  assert.equal((await db.from('items').delete().eq('id', 99).select('id')).data.length, 0);
  assert.deepEqual((await db.from('items').delete().in('id', [3])).data, null);
  assert.deepEqual(db.rows('items').map((row) => row.id), [4]);
});

test('single() after a write needs select(), and a write that is not exactly one row rolls back', async () => {
  const db = makeDb();
  for (const method of ['single', 'maybeSingle']) {
    await assert.rejects(async () => db.from('items').update({ note: 'q' }).eq('id', 1)[method](), /needs \.select\(\)/);
  }

  const many = await db.from('items').update({ note: 'rolled back' }).eq('owner', 'a').select().single();
  assert.equal(many.error.code, 'PGRST116');
  assert.deepEqual(db.rows('items').map((row) => row.note), [null, 'x', 'y', null]);

  const one = await db.from('items').update({ note: 'kept' }).eq('id', 1).select().maybeSingle();
  assert.equal(one.data.note, 'kept');
});

test('a table that was never declared behaves like an unapplied migration', async () => {
  const db = makeDb();
  const result = await db.from('home_contexts').select('*');
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'PGRST205');
  assert.match(result.error.message, /home_contexts/);
  assert.throws(() => db.rows('home_contexts'), /no table "home_contexts"/);
});

test('rpc dispatches to registered handlers and reports unknown functions like PostgREST', async () => {
  const db = makeDb();
  const unknown = await db.rpc('save_household', { a: 1 });
  assert.equal(unknown.error.code, 'PGRST202');
  assert.match(unknown.error.message, /save_household/);

  db.registerRpc('count_items', (args, fake) => ({ owner: args.owner, count: fake.rows('items').filter((row) => row.owner === args.owner).length }));
  const ok = await db.rpc('count_items', { owner: 'a' });
  assert.deepEqual(ok, { data: { owner: 'a', count: 2 }, error: null });

  db.registerRpc('refuse', () => { throw rpcError('P0001', 'not allowed'); });
  const refused = await db.rpc('refuse');
  assert.deepEqual([refused.data, refused.error.code, refused.error.message], [null, 'P0001', 'not allowed']);

  db.registerRpc('boom', () => { throw new Error('test bug'); });
  await assert.rejects(db.rpc('boom'), /test bug/); // a bug in a handler is not a database error

  assert.deepEqual(db.rpcCalls.map((call) => call.name), ['save_household', 'count_items', 'refuse', 'boom']);
});

test('rpc with declared parameters finds the function only by its exact argument names, like PostgREST', async () => {
  const db = makeDb();
  const seen = [];
  db.registerRpc('pair', (args) => { seen.push(args); return { ok: true }; }, { args: ['p_a', 'p_b'] });

  // An undefined argument is dropped on the way (JSON), so the call names one parameter and matches nothing.
  const dropped = await db.rpc('pair', { p_a: 1, p_b: undefined });
  assert.deepEqual([dropped.data, dropped.error.code], [null, 'PGRST202']);
  assert.equal(dropped.error.message, 'Could not find the function public.pair(p_a) in the schema cache');
  assert.equal(dropped.error.hint, 'Perhaps you meant to call the function public.pair(p_a, p_b)');
  const extra = await db.rpc('pair', { p_a: 1, p_b: 2, p_c: 3 });
  assert.equal(extra.error.code, 'PGRST202');
  assert.deepEqual(seen, [], 'the handler never ran for a call PostgREST could not match');

  // null is a value, so it counts as given; key order does not matter.
  assert.deepEqual(await db.rpc('pair', { p_b: null, p_a: 1 }), { data: { ok: true }, error: null });
  assert.deepEqual(seen, [{ p_b: null, p_a: 1 }]);

  // Without declared parameters any arguments reach the handler, as before.
  db.registerRpc('loose', (args) => args);
  assert.deepEqual((await db.rpc('loose', { x: 1, y: undefined })).data, { x: 1 });
});

const people = [{ id: 'u-a', name: 'alice', email: 'alice@example.test' }, { id: 'u-b', name: 'bob', isAnonymous: true }];

test('auth.getUser follows the identity table', async () => {
  const db = makeDb({ identities: people });
  const alice = await db.auth.getUser(tokenFor('alice'));
  assert.deepEqual([alice.error, alice.data.user.id, alice.data.user.email, alice.data.user.is_anonymous], [null, 'u-a', 'alice@example.test', false]);
  assert.equal((await db.auth.getUser(tokenFor('bob'))).data.user.is_anonymous, true);

  for (const token of ['junk', 'test-token:mallory', '', undefined]) {
    const result = await db.auth.getUser(token);
    assert.equal(result.data.user, null);
    assert.equal(result.error.status, 401);
  }

  db.setAuthOutage('returned');
  const outage = await db.auth.getUser(tokenFor('alice'));
  assert.deepEqual([outage.data.user, outage.error.status, outage.error.name], [null, 503, 'AuthRetryableFetchError']);
  db.setAuthOutage('thrown');
  await assert.rejects(db.auth.getUser(tokenFor('alice')), /fetch failed/);
  db.setAuthOutage('off');
  assert.equal((await db.auth.getUser(tokenFor('alice'))).error, null);
});

test('auth.admin.deleteUser removes the user and cascades through tables with an ownerColumn', async () => {
  const db = createFakeSupabase({
    identities: people,
    tables: {
      profiles: { primaryKey: 'id', ownerColumn: 'id' },
      notes: { primaryKey: 'id', ownerColumn: 'profile_id' },
      catalog: { primaryKey: 'id' }, // shared data: no owner, never cascades
    },
    seed: {
      profiles: [{ id: 'u-a' }, { id: 'u-b' }],
      notes: [{ id: 1, profile_id: 'u-a' }, { id: 2, profile_id: 'u-b' }, { id: 3, profile_id: 'u-a' }],
      catalog: [{ id: 'c1', profile_id: 'u-a' }],
    },
  });
  const result = await db.auth.admin.deleteUser('u-a');
  assert.equal(result.error, null);
  assert.deepEqual(db.rows('profiles'), [{ id: 'u-b' }]);
  assert.deepEqual(db.rows('notes'), [{ id: 2, profile_id: 'u-b' }]);
  assert.equal(db.rows('catalog').length, 1);

  const revoked = await db.auth.getUser(tokenFor('alice'));
  assert.equal(revoked.error.status, 401); // a deleted user's token stops working
  assert.equal((await db.auth.getUser(tokenFor('bob'))).error, null);

  const again = await db.auth.admin.deleteUser('u-a');
  assert.equal(again.error.status, 404);
});

test('seeding rejects rows that break a declared key, so a bad fixture fails loudly', () => {
  assert.throws(
    () => createFakeSupabase({ tables: { t: { primaryKey: 'id' } }, seed: { t: [{ id: 1 }, { id: 1 }] } }),
    /seed for "t".*duplicate key/,
  );
});

test('queryLog records every statement with its filters and payloads, in order', async () => {
  const db = makeDb();
  await db.from('items').select('*').eq('owner', 'a').gte('n', 6);
  await db.from('items').update({ label: 'renamed' }).eq('owner', 'a').eq('id', 1).select('id');
  await db.from('items').insert([{ id: 9, owner: 'b' }]);
  await db.from('items').upsert({ id: 1, owner: 'a', n: 50 }, { onConflict: 'id' });
  await db.from('items').delete().eq('owner', 'b').in('id', [3, 4]).select('id');
  await db.from('missing_table').select('*'); // a statement against a table that does not exist is still logged

  assert.deepEqual(db.queryLog.map((entry) => [entry.table, entry.operation]), [
    ['items', 'select'], ['items', 'update'], ['items', 'insert'], ['items', 'upsert'], ['items', 'delete'], ['missing_table', 'select'],
  ]);
  const [select, update, insert, upsert, remove] = db.queryLog;
  assert.deepEqual(select.filters, [
    { type: 'cmp', column: 'owner', op: 'eq', value: 'a' },
    { type: 'cmp', column: 'n', op: 'gte', value: 6 },
  ]);
  assert.deepEqual([update.values, update.rows], [{ label: 'renamed' }, []]);
  assert.deepEqual(update.filters.map((filter) => filter.column), ['owner', 'id']);
  assert.deepEqual(insert.rows, [{ id: 9, owner: 'b' }]);
  assert.deepEqual(upsert.rows, [{ id: 1, owner: 'a', n: 50 }]);
  assert.deepEqual(remove.filters.map((filter) => [filter.column, filter.op]), [['owner', 'eq'], ['id', 'in']]);

  const logged = db.queryLog.length;
  db.rows('items'); // reading the fake for assertions is not a statement
  assert.equal(db.queryLog.length, logged);
});
