import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { createRouteHooks } from './helpers/routeHooks.mjs';

const TABLES = {
  profiles: { primaryKey: 'id', ownerColumn: 'id' },
  household_bands: { primaryKey: 'profile_id', ownerColumn: 'profile_id' },
  symptom_logs: {
    primaryKey: 'id',
    unique: [['profile_id', 'entry_date', 'band']],
    ownerColumn: 'profile_id',
    defaults: { id: () => crypto.randomUUID() },
  },
  daily_scores: { primaryKey: 'id', ownerColumn: 'profile_id' },
  push_subscriptions: { primaryKey: 'id', unique: [['endpoint']], ownerColumn: 'profile_id', defaults: { id: () => crypto.randomUUID() } },
};

function twoHouseholds() {
  return createRouteHarness({
    tables: TABLES,
    seed: ({ alice, bob }) => ({
      profiles: [
        { id: alice.id, renter_mode: true, locale: 'es' },
        { id: bob.id, renter_mode: false, locale: 'en' },
      ],
      household_bands: [
        { profile_id: alice.id, has_senior: true },
        { profile_id: bob.id, has_toddler: true },
      ],
      symptom_logs: [
        { id: 'a1', profile_id: alice.id, entry_date: '2026-09-01', band: 'household', note: 'alice note' },
        { id: 'b1', profile_id: bob.id, entry_date: '2026-09-01', band: 'household', note: 'bob note' },
      ],
      daily_scores: [
        { id: 'sa', profile_id: alice.id, date: '2026-09-10', score: 81, aqi: 40, created_at: '2026-09-10T10:00:00Z' },
        { id: 'sb', profile_id: bob.id, date: '2026-09-10', score: 22, aqi: 160, created_at: '2026-09-10T10:00:00Z' },
      ],
    }),
  });
}

test('GET /api/household returns the seeded bands for the signed-in household only', async () => {
  const h = twoHouseholds();
  const res = await h.call('/api/household', 'GET', { as: 'alice' });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('application/json'));
  const body = await res.json();
  assert.equal(body.household.has_senior, true);
  assert.equal(body.household.has_toddler, false); // bob's band never shows up
  assert.deepEqual([body.household_set, body.renter_mode, body.locale], [true, true, 'es']);

  const bob = await (await h.call('/api/household', 'GET', { as: 'bob' })).json();
  assert.deepEqual([bob.household.has_toddler, bob.household.has_senior, bob.locale], [true, false, 'en']);
});

test('a household with no rows gets the defaults, not someone else\'s row', async () => {
  const h = createRouteHarness({ tables: TABLES, seed: ({ bob }) => ({ household_bands: [{ profile_id: bob.id, has_toddler: true }], profiles: [] }) });
  const body = await (await h.call('/api/household', 'GET', { as: 'alice' })).json();
  assert.deepEqual([body.household_set, body.household.has_toddler, body.locale], [false, false, 'en']);
});

test('a request without a token is a 401 in the real error envelope', async () => {
  const h = twoHouseholds();
  const res = await h.call('/api/household', 'GET');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'Sign-in required.');
  assert.equal(body.code, 'auth_required');
  assert.equal(body.message, body.error);
  assert.deepEqual([body.field_errors, body.retryable], [[], false]);
  assert.equal(res.headers.get('x-request-id'), body.request_id);
});

test('a token the identity table does not know is a 401 with the expired-session message', async () => {
  const h = twoHouseholds();
  for (const authorization of ['Bearer test-token:mallory', 'Bearer not-a-real-token', 'Basic abc']) {
    const res = await h.call('/api/household', 'GET', { headers: { authorization } });
    assert.equal(res.status, 401);
    const { error } = await res.json();
    assert.equal(error, authorization.startsWith('Basic') ? 'Sign-in required.' : 'Your session has expired. Please reload the app.');
  }
});

test('forceAuthOutage() turns every authenticated call into the 503 envelope, and can be switched off', async (t) => {
  const logged = muteConsoleError(t);
  const h = twoHouseholds();

  h.forceAuthOutage();
  const res = await h.call('/api/household', 'GET', { as: 'alice' });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'auth_unavailable');
  assert.equal(body.retryable, true);
  assert.equal(res.headers.get('retry-after'), '2');
  assert.equal(body.error, 'Could not verify your session right now. Please try again.');

  h.forceAuthOutage('thrown'); // network failure instead of an auth-js error result
  assert.equal((await h.call('/api/household', 'GET', { as: 'alice' })).status, 503);
  assert.equal(logged.mock.callCount(), 2);

  h.forceAuthOutage('off');
  assert.equal((await h.call('/api/household', 'GET', { as: 'alice' })).status, 200);
});

test('PUT /api/household persists to the fake and leaves the other household alone', async () => {
  const h = twoHouseholds();
  const res = await h.call('/api/household', 'PUT', {
    as: 'alice',
    body: { has_child: true, has_senior: false, locale: 'en', renter_mode: false, profile_id: 'someone-else', has_unknown: true },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).household.has_child, true);

  const alice = h.db.rows('household_bands').find((row) => row.profile_id === h.identities.alice.id);
  assert.deepEqual([alice.has_child, alice.has_senior, 'has_unknown' in alice], [true, false, false]);
  assert.equal(h.db.rows('household_bands').length, 2); // upsert merged, did not duplicate
  const bob = h.db.rows('household_bands').find((row) => row.profile_id === h.identities.bob.id);
  assert.equal(bob.has_toddler, true);
  assert.deepEqual(h.db.rows('profiles').find((row) => row.id === h.identities.alice.id), { id: h.identities.alice.id, renter_mode: false, locale: 'en' });
});

test('malformed JSON reaches the route as a raw body, and the route\'s own handling decides', async () => {
  const h = twoHouseholds();
  const res = await h.call('/api/household', 'PUT', { as: 'alice', rawBody: '{not json' });
  assert.equal(res.status, 200); // household treats an unreadable body as "no booleans set"
  assert.equal(h.db.rows('household_bands').find((row) => row.profile_id === h.identities.alice.id).has_senior, false);
});

test('GET /api/history reads daily_scores through the fake: ranges and the owner filter both apply', async () => {
  const h = twoHouseholds();
  const res = await h.call('/api/history', 'GET', { as: 'alice', url: '/api/history?from=2026-09-01&to=2026-09-30' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.history.map((row) => [row.date, row.score]), [['2026-09-10', 81]]); // bob's 22 is absent

  const outside = await (await h.call('/api/history', 'GET', { as: 'alice', url: '/api/history?from=2026-10-01&to=2026-10-31' })).json();
  assert.equal(outside.count, 0);
});

test('DELETE /api/journal?all=true removes only the caller\'s rows and select() reports the count', async () => {
  const h = twoHouseholds();
  const res = await h.call('/api/journal', 'DELETE', { as: 'alice', url: '/api/journal?all=true' });
  assert.deepEqual(await res.json(), { deleted: 1 });
  assert.deepEqual(h.db.rows('symptom_logs').map((row) => row.id), ['b1']);

  const other = await h.call('/api/journal', 'DELETE', { as: 'bob', url: '/api/journal?id=11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(await other.json(), { deleted: 0 });
});

test('POST /api/journal upserts on the declared composite key', async () => {
  const h = twoHouseholds();
  const entry = { entry_date: '2026-09-01', band: 'household', severity: 'bad', note: 'updated' };
  const res = await h.call('/api/journal', 'POST', { as: 'alice', body: entry });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).entry.id, 'a1'); // merged into alice's existing row, not a new one
  assert.equal(h.db.rows('symptom_logs').length, 2);

  const fresh = await h.call('/api/journal', 'POST', { as: 'alice', body: { ...entry, entry_date: '2026-09-02' } });
  assert.match((await fresh.json()).entry.id, /^[0-9a-f-]{36}$/); // the declared default id
  assert.equal(h.db.rows('symptom_logs').length, 3);
});

test('POST /api/push/subscribe goes through the stubbed rate limiter and the endpoint unique key', async () => {
  const h = twoHouseholds();
  const subscription = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p', auth: 'a' } };
  const res = await h.call('/api/push/subscribe', 'POST', { as: 'alice', body: subscription });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(h.db.rows('push_subscriptions')[0].profile_id, h.identities.alice.id);

  await h.call('/api/push/subscribe', 'POST', { as: 'bob', body: subscription });
  assert.equal(h.db.rows('push_subscriptions').length, 1); // same endpoint: one row, upsert on endpoint
  assert.equal(h.db.rows('push_subscriptions')[0].profile_id, h.identities.bob.id);
});

test('DELETE /api/account deletes the auth user and cascades to every owned table', async () => {
  const h = twoHouseholds();
  const refused = await h.call('/api/account', 'DELETE', { as: 'alice', body: { confirm: 'nope' } });
  assert.equal(refused.status, 400);
  assert.equal(h.db.rows('profiles').length, 2);

  const res = await h.call('/api/account', 'DELETE', { as: 'alice', body: { confirm: 'DELETE' } });
  assert.deepEqual(await res.json(), { deleted: true });
  for (const table of ['profiles', 'household_bands', 'symptom_logs', 'daily_scores']) {
    const owner = table === 'profiles' ? 'id' : 'profile_id';
    assert.deepEqual(h.db.rows(table).map((row) => row[owner]), [h.identities.bob.id], table);
  }
  const after = await h.call('/api/household', 'GET', { as: 'alice' });
  assert.equal(after.status, 401); // the deleted user's token no longer verifies
});

test('a table the harness was not given behaves like an unapplied migration', async () => {
  const h = createRouteHarness({ tables: { profiles: { primaryKey: 'id' } } });
  const res = await h.call('/api/volunteer', 'GET', { as: 'alice', url: '/api/volunteer?county=Wake' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).note, 'Volunteer directory not available yet.');
});

test('dynamic params arrive as a Promise, nextUrl works, and after() waits for runAfter()', async () => {
  const h = createRouteHarness({ tables: { audit: { primaryKey: 'id', defaults: { id: () => crypto.randomUUID() } } } });
  const res = await h.call('test/helpers/fixtures/echoRoute.mjs', 'POST', {
    as: 'bob',
    url: '/echo/7?x=1',
    params: { id: '7' },
    body: { hello: 'world' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('x-echo'), 'yes');
  assert.deepEqual(await res.json(), {
    userId: h.identities.bob.id,
    id: '7',
    paramsWasPromise: true,
    search: '?x=1',
    body: { hello: 'world' },
    allowed: true,
  });

  assert.equal(h.db.rows('audit').length, 0); // recorded, not run
  await h.runAfter();
  assert.deepEqual(h.db.rows('audit').map((row) => [row.profile_id, row.note]), [[h.identities.bob.id, 'after 7']]);
  await h.runAfter(); // nothing left to run
  assert.equal(h.db.rows('audit').length, 1);
});

test('harnesses are isolated: same route, separate databases, identities and after queues', async () => {
  const first = createRouteHarness({ tables: TABLES, seed: ({ alice }) => ({ household_bands: [{ profile_id: alice.id, has_senior: true }] }) });
  const second = createRouteHarness({ tables: TABLES, seed: ({ alice }) => ({ household_bands: [{ profile_id: alice.id, has_adult: true }] }) });
  const [a, b] = await Promise.all([
    first.call('/api/household', 'GET', { as: 'alice' }).then((res) => res.json()),
    second.call('/api/household', 'GET', { as: 'alice' }).then((res) => res.json()),
  ]);
  assert.deepEqual([a.household.has_senior, a.household.has_adult], [true, false]);
  assert.deepEqual([b.household.has_senior, b.household.has_adult], [false, true]);
});

test('custom identities, unknown identities and unsupported methods', async () => {
  const h = createRouteHarness({ tables: TABLES, identities: { carol: { isAnonymous: true } } });
  assert.deepEqual(Object.keys(h.identities), ['carol']);
  assert.equal(h.identities.carol.token, 'test-token:carol');
  assert.equal(h.identities.carol.isAnonymous, true);
  await assert.rejects(h.call('/api/household', 'GET', { as: 'alice' }), /no identity named "alice"/);

  const res = await h.call('/api/household', 'DELETE', { as: 'carol' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, PUT');
  await assert.rejects(h.call('/api/nope', 'GET'), /no route file at app\/api\/nope\/route\.js/);
});

test('the stubs refuse to run outside a harness call instead of using some default database', async () => {
  createRouteHarness(); // a harness exists, but no call is in flight
  const { supabaseAdmin } = await import('./helpers/stubs/serverAuth.mjs');
  assert.throws(() => supabaseAdmin.from('profiles'), /outside a harness call/);
  const { after } = await import('./helpers/stubs/nextServer.mjs');
  assert.throws(() => after(() => {}), /outside a harness call/);
});

test('hooks: @/ resolves .js, .mjs, .ts, .json and /index.js in that order, and says so when nothing matches', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'halo-hooks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'lib', 'dir'), { recursive: true });
  for (const file of ['both.js', 'both.mjs', 'only.mjs', 'typed.ts', 'data.json', 'dir/index.js']) {
    writeFileSync(path.join(root, 'lib', file), '');
  }
  const { resolve } = createRouteHooks({ repoRoot: root, stubDir: path.join(REPO_ROOT, 'test/helpers/stubs') });
  const nextResolve = (specifier, context) => ({ url: new URL(specifier, context.parentURL ?? 'file:///').href });
  const at = (specifier) => resolve(specifier, { parentURL: 'file:///importer.js' }, nextResolve).url;
  const file = (name) => pathToFileURL(path.join(root, 'lib', name)).href;

  assert.equal(at('@/lib/both'), file('both.js'));
  assert.equal(at('@/lib/only'), file('only.mjs'));
  assert.equal(at('@/lib/typed'), file('typed.ts'));
  assert.equal(at('@/lib/data.json'), file('data.json'));
  assert.equal(at('@/lib/dir'), file('dir/index.js'));
  assert.throws(() => at('@/lib/missing'), { code: 'ERR_MODULE_NOT_FOUND', message: /cannot resolve "@\/lib\/missing"/ });
});

test('hooks: serverAuth and ratelimit are replaced however they are imported, and nothing else is', () => {
  const stubs = path.join(REPO_ROOT, 'test/helpers/stubs');
  const { resolve } = createRouteHooks({ repoRoot: REPO_ROOT, stubDir: stubs });
  const nextResolve = (specifier, context) => ({ url: new URL(specifier, context.parentURL).href });
  const importer = pathToFileURL(path.join(REPO_ROOT, 'app/api/x/route.js')).href;
  const at = (specifier, parentURL = importer) => resolve(specifier, { parentURL }, nextResolve);
  const stub = (name) => pathToFileURL(path.join(stubs, name)).href;

  assert.equal(at('@/lib/serverAuth').url, stub('serverAuth.mjs'));
  assert.equal(at('@/lib/ratelimit').url, stub('ratelimit.mjs'));
  assert.equal(at('./serverAuth.js', pathToFileURL(path.join(REPO_ROOT, 'lib/other.js')).href).url, stub('serverAuth.mjs'));
  assert.equal(at('next/server').url, stub('nextServer.mjs'));
  assert.equal(at('@supabase/supabase-js').url, stub('supabaseJs.mjs'));

  const real = at('@/lib/household');
  assert.equal(real.url, pathToFileURL(path.join(REPO_ROOT, 'lib/household.js')).href);
  assert.equal(real.format, 'module'); // no "type" sniffing, so no MODULE_TYPELESS_PACKAGE_JSON warning
});

test('every route under app/api loads through the hooks (nothing reaches Redis or Supabase at import)', async () => {
  const h = createRouteHarness();
  const routes = readdirSync(`${REPO_ROOT}/app/api`, { recursive: true })
    .filter((file) => file.endsWith('route.js'))
    .sort();
  assert.ok(routes.length >= 20, `expected the app's routes, found ${routes.length}`);
  for (const route of routes) {
    const res = await h.call(`app/api/${route}`, 'TRACE');
    assert.equal(res.status, 405, route);
  }
});

// ---- Drift: the stubs must keep matching the real files they replace. ----

const read = (relative) => readFileSync(`${REPO_ROOT}/${relative}`, 'utf8');

function exportedNames(source) {
  const declared = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([\w$]+)/gm)].map((match) => match[1]);
  const listed = [...source.matchAll(/^export\s*\{([^}]*)\}/gm)]
    .flatMap((match) => match[1].split(','))
    .map((item) => item.trim().split(/\s+as\s+/).pop())
    .filter(Boolean);
  const defaults = /^export\s+default\b/m.test(source) ? ['default'] : [];
  return [...declared, ...listed, ...defaults].sort();
}

function authErrors(source) {
  return [...source.matchAll(/new AuthError\(\s*(\d+)\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2\s*\)/g)].map((match) => `${match[1]} ${match[3]}`).sort();
}

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The source of `export [async] function|class name ...` through its closing brace, whitespace-normalised. */
function declaration(source, name) {
  const clean = withoutComments(source);
  const start = clean.search(new RegExp(`export\\s+(?:async\\s+)?(?:function|class)\\s+${name}\\b`));
  assert.notEqual(start, -1, `${name} not found`);
  let depth = 0;
  for (let at = clean.indexOf('{', start); at < clean.length; at += 1) {
    if (clean[at] === '{') depth += 1;
    if (clean[at] === '}' && --depth === 0) return clean.slice(start, at + 1).replace(/\s+/g, ' ').trim();
  }
  throw new Error(`${name} is not closed`);
}

test('drift: the serverAuth stub exports exactly what lib/serverAuth.js exports', async () => {
  const real = exportedNames(read('lib/serverAuth.js'));
  assert.deepEqual(real, ['AuthError', 'assertProfileMatches', 'authErrorResponse', 'requireUser', 'supabaseAdmin']);
  const stub = await import('./helpers/stubs/serverAuth.mjs');
  assert.deepEqual(Object.keys(stub).sort(), real);
  assert.deepEqual(exportedNames(read('test/helpers/stubs/serverAuth.mjs')), real);
});

test('drift: AuthError statuses and messages in the stub match the real file', () => {
  const real = authErrors(read('lib/serverAuth.js'));
  assert.ok(real.length >= 5, `expected the real AuthError sites, found ${real.length}`);
  assert.deepEqual(authErrors(read('test/helpers/stubs/serverAuth.mjs')), real);
});

test('drift: the stub\'s logic is a verbatim copy of the real functions', () => {
  const real = read('lib/serverAuth.js');
  const stub = read('test/helpers/stubs/serverAuth.mjs');
  for (const name of ['AuthError', 'requireUser', 'assertProfileMatches', 'authErrorResponse']) {
    assert.equal(declaration(stub, name), declaration(real, name), `${name} drifted from lib/serverAuth.js`);
  }
  const helper = (source) => /function readBearerToken[\s\S]*?\n}\n/.exec(withoutComments(source))?.[0].replace(/\s+/g, ' ');
  assert.ok(helper(real));
  assert.equal(helper(stub), helper(real), 'readBearerToken drifted from lib/serverAuth.js');
});

test('drift: the ratelimit stub exports the same names as lib/ratelimit.js', async () => {
  const real = exportedNames(read('lib/ratelimit.js'));
  assert.ok(real.includes('checkLimit') && real.length >= 8);
  const stub = await import('./helpers/stubs/ratelimit.mjs');
  assert.deepEqual(Object.keys(stub).sort(), real);
});
