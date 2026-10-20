/**
 * GET|POST /api/cron/daily-maxima in the fake route harness (B08 Task 3): the secret, the
 * unavailable answer before 0025, PostgREST's max_rows under the keyset paging (F2), the error
 * path's logs, and the route's structure (maxDuration, the vercel.json entry, the documented
 * fallback). The recorder's behaviour on the real 0025 functions is dailyMaximaRecorderDb.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { providers } from './helpers/dailyMaximaProviders.mjs';

const SECRET = 'cron-secret-for-tests';
const AUTH = { authorization: `Bearer ${SECRET}` };
const ROUTE = 'app/api/cron/daily-maxima/route.js';
const ctxId = (n) => `00000000-0000-4000-8f00-${n.toString(16).padStart(12, '0')}`;

function contexts(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: ctxId(i + 1), profile_id: `00000000-0000-4000-8e00-${(i + 1).toString(16).padStart(12, '0')}`,
    lat: 35.409, lng: -80.58, state: 'NC', effective_from: '2026-10-18T12:00:00+00:00', effective_to: null,
  }));
}

/** A harness with the three 0025 functions as simple stand-ins that record what they were sent. */
function harness({ seed = 0, rpcs = true, p = providers({ stations: [{ code: '370250004', lat: 35.43, lng: -80.6 }] }) } = {}) {
  const h = createRouteHarness({
    tables: { home_contexts: { primaryKey: 'id' }, daily_maxima: { primaryKey: 'home_context_id' } },
    seed: { home_contexts: contexts(seed) },
    fetch: p.fetch,
    env: { CRON_SECRET: SECRET, AIRNOW_API_KEY: 'airnow-key' },
  });
  const sent = [];
  if (rpcs) {
    h.db.registerRpc('begin_daily_maxima_run', ({ p_first_day: first }) => first, { args: ['p_first_day'] });
    h.db.registerRpc('record_daily_maxima', ({ p_rows: rows }) => {
      sent.push(...rows);
      return { inserted: rows.length, updated: 0, kept: 0, skipped: 0, refused: 0, refusedRules: {} };
    }, { args: ['p_rows'] });
    h.db.registerRpc('finish_daily_maxima_run', () => '2026-10-20T12:00:01Z', { args: ['p_counts'] });
  }
  return { h, sent, p };
}

async function call(t, h, method = 'GET', headers = AUTH) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00Z') });
  try {
    return await h.call('/api/cron/daily-maxima', method, { headers });
  } finally {
    t.mock.timers.reset();
  }
}

test('401 without the cron secret, for GET and POST, and nothing is read or fetched', async (t) => {
  const { h, p } = harness({ seed: 2 });
  for (const method of ['GET', 'POST']) {
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-cron-secret': 'wrong' }]) {
      assert.equal((await call(t, h, method, headers)).status, 401);
    }
  }
  assert.deepEqual(h.db.queryLog, []);
  assert.deepEqual(h.db.rpcCalls, []);
  assert.equal(p.calls.length, 0);
});

test('POST runs the same recorder as GET', async (t) => {
  const { h, sent } = harness({ seed: 1 });
  const res = await call(t, h, 'POST');
  assert.equal(res.status, 200);
  assert.equal(sent.length, 2);
});

test('with 0025 missing, a clean non-retryable 503 and no provider call', async (t) => {
  const { h, p } = harness({ seed: 3, rpcs: false });
  const res = await call(t, h);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal(body.retryable, false);
  assert.equal(p.calls.length, 0);
  assert.deepEqual(h.db.queryLog, [], 'nothing read after the probe failed');
});

test('1,200 contexts are all reached when PostgREST caps every select at 500 rows (F2)', async (t) => {
  const { h, sent, p } = harness({ seed: 1200 });
  h.db.setMaxRows(500);
  const res = await call(t, h);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.contexts, 1200);
  assert.equal(new Set(sent.map((row) => row.home_context_id)).size, 1200);
  assert.equal(p.count('airnow'), 1);
  assert.ok(h.db.queryLog.every((entry) => entry.table !== 'daily_scores'));
  // Every batch is within record_daily_maxima's 1,000 rows.
  assert.ok(h.db.rpcCalls.filter((c) => c.name === 'record_daily_maxima').every((c) => c.args.p_rows.length <= 1000));
});

test('a database failure is a 500 whose log carries the code only', async (t) => {
  const { h, p } = harness({ seed: 1, rpcs: false });
  h.db.registerRpc('begin_daily_maxima_run', () => { throw rpcError('XX000', 'boom near 35.409,-80.58', 'Failing row contains (00000000-0000-4000-8e00-000000000001)'); }, { args: ['p_first_day'] });
  const errors = t.mock.method(console, 'error', () => {});
  const res = await call(t, h);
  assert.equal(res.status, 500);
  const logged = errors.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /XX000/);
  assert.ok(!logged.includes('35.409') && !logged.includes('Failing row'), logged);
  assert.equal(p.calls.length, 0);
});

test('the route exports maxDuration 60, documents the E5 fallback, and vercel.json schedules it at 12:00 UTC', () => {
  const source = readFileSync(path.join(REPO_ROOT, ROUTE), 'utf8');
  assert.match(source, /^export const maxDuration = 60;$/m);
  assert.match(source, /FALLBACK \(E5/);
  assert.match(source, /FIRST step of \/api\/cron\/daily/);
  const crons = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')).crons;
  assert.deepEqual(crons.find((c) => c.path === '/api/cron/daily-maxima'), { path: '/api/cron/daily-maxima', schedule: '0 12 * * *' });
  assert.deepEqual(crons.find((c) => c.path === '/api/cron/daily'), { path: '/api/cron/daily', schedule: '0 11 * * *' });
  assert.ok(!/—/.test(source));
});
