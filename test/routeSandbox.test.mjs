import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { SCRUBBED_ENV, withSandbox } from './helpers/sandbox.mjs';
import { haloTables } from './helpers/tables.mjs';

const PROBE = 'test/helpers/fixtures/probeRoute.mjs';
const TABLES = haloTables('profiles');
const AUDIT = { audit: { primaryKey: 'id', defaults: { id: () => crypto.randomUUID() } } };

/** Pretends the developer's shell has real provider keys and a live network, and restores both afterwards. */
function realisticShell(t) {
  const env = {
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
    AIRNOW_API_KEY: 'airnow-key',
    GOOGLE_POLLEN_API_KEY: 'pollen-key',
    MAPBOX_TOKEN: 'pk.mapbox',
    OPENUV_API_KEY: 'openuv-key',
    ASSISTANT_MODEL_KEY: 'model-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  };
  const before = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const network = t.mock.method(globalThis, 'fetch', async () => new Response('REAL NETWORK'));
  const spy = globalThis.fetch;
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return { env, network, spy };
}

test('a call cannot reach the network or see provider keys, and both come back afterwards', async (t) => {
  const { env, network, spy } = realisticShell(t);
  const h = createRouteHarness({ tables: { ...TABLES, ...AUDIT } });

  const res = await h.call(PROBE, 'GET', { as: 'alice' });
  const body = await res.json();

  assert.deepEqual(Object.values(body.env), Object.keys(body.env).map(() => null)); // every watched key is gone
  assert.equal(body.fetched.ok, false);
  assert.match(body.fetched.error, /blocked network call to https:\/\/provider\.example\.test\/v1\/readings/);
  assert.ok(!JSON.stringify(body).includes('sk-live-secret'), 'the blocked message must not echo the query string');
  assert.deepEqual(h.blockedFetches, ['https://provider.example.test/v1/readings']);
  assert.equal(network.mock.callCount(), 0); // nothing reached the "real" fetch

  assert.equal(globalThis.fetch, spy); // restored
  for (const [name, value] of Object.entries(env)) assert.equal(process.env[name], value, name);
  assert.equal(await (await globalThis.fetch('https://anything.example.test')).text(), 'REAL NETWORK'); // outside a call it is the real one
});

test('after() callbacks run in the same sandbox', async (t) => {
  const { network } = realisticShell(t);
  const h = createRouteHarness({ tables: { ...TABLES, ...AUDIT } });
  await h.call(PROBE, 'GET', { as: 'alice' });
  assert.equal(h.db.rows('audit').length, 0);

  await h.runAfter();
  const note = JSON.parse(h.db.rows('audit')[0].note);
  assert.equal(note.env, null); // AIRNOW_API_KEY is scrubbed here too
  assert.equal(note.later.ok, false);
  assert.match(note.later.error, /blocked network call to https:\/\/after\.example\.test\/job/);
  assert.deepEqual(h.blockedFetches.slice(-1), ['https://after.example.test/job']);
  assert.equal(network.mock.callCount(), 0);
});

test('a test can hand a call its own fetch and env; the call option beats the harness option', async (t) => {
  realisticShell(t);
  delete process.env.PROBE_OVERRIDE;
  const harnessCalls = [];
  const callCalls = [];
  const h = createRouteHarness({
    tables: { ...TABLES, ...AUDIT },
    env: { PROBE_OVERRIDE: 'from-harness', AIRNOW_API_KEY: 'test-airnow' },
    fetch: async (url) => { harnessCalls.push(url); return new Response('harness body'); },
  });

  const first = await (await h.call(PROBE, 'GET', { as: 'alice' })).json();
  assert.deepEqual(first.fetched, { ok: true, text: 'harness body' });
  assert.deepEqual([first.env.PROBE_OVERRIDE, first.env.AIRNOW_API_KEY, first.env.MAPBOX_TOKEN], ['from-harness', 'test-airnow', null]);

  const second = await (await h.call(PROBE, 'GET', {
    as: 'alice',
    env: { PROBE_OVERRIDE: 'from-call' },
    fetch: async (url) => { callCalls.push(url); return new Response('call body'); },
  })).json();
  assert.deepEqual(second.fetched, { ok: true, text: 'call body' });
  assert.equal(second.env.PROBE_OVERRIDE, 'from-call');
  assert.equal(second.env.AIRNOW_API_KEY, 'test-airnow');
  assert.equal(harnessCalls.length, 1);
  assert.equal(callCalls.length, 1);

  await h.runAfter({ fetch: async () => new Response('after body') });
  assert.equal(h.blockedFetches.length, 0); // nothing was blocked: every fetch was a test's own
  assert.ok(!('PROBE_OVERRIDE' in process.env), 'a variable the shell did not have is removed again');
  assert.equal(process.env.AIRNOW_API_KEY, 'airnow-key');
});

test('overlapping sandboxes keep their own fetch, and process.env returns to the shell values', async (t) => {
  const { env } = realisticShell(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = [];
  const run = (label) =>
    withSandbox({ fetch: async () => new Response(label), env: { PROBE_OVERRIDE: 'same' } }, async () => {
      await gate;
      seen.push([label, await (await globalThis.fetch('https://x.example.test')).text(), process.env.AIRNOW_API_KEY ?? null]);
    });

  const both = Promise.all([run('first'), run('second')]);
  release();
  await both;
  assert.deepEqual(seen.sort(), [['first', 'first', null], ['second', 'second', null]]);
  assert.equal(process.env.AIRNOW_API_KEY, env.AIRNOW_API_KEY);
  assert.ok(!('PROBE_OVERRIDE' in process.env));
});

test('overlapping sandboxes that disagree about env fail loudly and leave nothing behind', async (t) => {
  const { env, spy } = realisticShell(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = withSandbox({ fetch: async () => new Response(''), env: { PROBE_OVERRIDE: 'a' } }, () => gate);

  await assert.rejects(
    withSandbox({ fetch: async () => new Response(''), env: { PROBE_OVERRIDE: 'b' } }, async () => {}),
    /overlapping calls ask for different env values/,
  );
  release();
  await first;
  assert.equal(globalThis.fetch, spy);
  assert.equal(process.env.AIRNOW_API_KEY, env.AIRNOW_API_KEY);
  assert.ok(!('PROBE_OVERRIDE' in process.env));
});

test('a handler that throws still restores fetch and env', async (t) => {
  const { env, spy } = realisticShell(t);
  await assert.rejects(
    withSandbox({ fetch: async () => new Response('') }, async () => { throw new Error('handler blew up'); }),
    /handler blew up/,
  );
  assert.equal(globalThis.fetch, spy);
  assert.equal(process.env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_URL);
});

test('drift: every environment variable the app and libs read is scrubbed during a call', () => {
  const read = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.m?js$/.test(entry.name)) {
        const source = readFileSync(full, 'utf8');
        for (const match of source.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g)) read.add(match[1]);
        for (const match of source.matchAll(/\benvNum\(\s*'([A-Z][A-Z0-9_]+)'/g)) read.add(match[1]);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'app'));
  walk(path.join(REPO_ROOT, 'lib'));

  assert.ok(read.has('UPSTASH_REDIS_REST_URL') && read.has('AIRNOW_API_KEY') && read.has('VAPID_SUBJECT'), 'the scan found nothing');
  const missing = [...read].filter((name) => !SCRUBBED_ENV.includes(name)).sort();
  assert.deepEqual(missing, [], `add these to SCRUBBED_ENV in test/helpers/sandbox.mjs: ${missing.join(', ')}`);
  for (const name of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'AIRNOW_API_KEY', 'GOOGLE_POLLEN_API_KEY', 'MAPBOX_TOKEN', 'ASSISTANT_MODEL_KEY', 'OPENUV_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.ok(SCRUBBED_ENV.includes(name), name);
  }
});
