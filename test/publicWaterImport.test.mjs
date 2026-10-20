/**
 * B19: GET|POST /api/cron/public-evidence and water.read over the REAL
 * migration 0033 on PGlite (docs/backend/plans/b19-public-evidence-refresh.md).
 *
 * The routes run in the route harness. Their reads of the two 0033 tables go
 * to this database (db/pgliteSelect.mjs) and the one RPC calls the real
 * record_public_evidence_run, committed, as PostgREST does. The two sources
 * are a stub fetch serving the recorded B12 downloads
 * (test/fixtures/public-evidence/), changed per case: good, partial,
 * malformed, timeout, oversize, an HTTP error, stale. The clock is mocked to
 * the day after the newest recorded map's week.
 *
 * What water.read then shows is judged by the frontend's own validator and
 * the screen's county filter (components/homeguard/FoodWater.tsx), with a
 * drift check on that line.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRouteHarness, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { validWaterStewardship } = await loadFrontend('production/home-resources');
const sourceOpsService = await loadFrontend('production/source-operations-service');
const { runPublicWaterImport } = await import('../lib/publicWaterImport.js');
const { _clearSnapshotCacheForTest } = await import('../lib/publicWaterStore.js');

const SECRET = 'cron-secret-for-tests';
const AUTH = { authorization: `Bearer ${SECRET}` };
const ON = { CRON_SECRET: SECRET, HALO_FEATURE_PUBLIC_IMPORT: 'on' };
const TODAY = '2026-10-20T18:00:00Z';
const fixture = (name) => readFileSync(new URL(`./fixtures/public-evidence/${name}`, import.meta.url), 'utf8');
const USDM_TEXT = fixture('usdm-nc.json');
const WUDC_TEXT = fixture('wudc.html');
const BUNDLED = JSON.parse(readFileSync(new URL('../lib/data/ncWaterStewardship.json', import.meta.url), 'utf8'));
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The screen's own selection (FoodWater.tsx ProductionWaterStewardship). */
const SCREEN_FILTER = 'const releases = data?.releases.filter(item => item.countyId === selection.county) ?? [];';
const screenReleases = (data, county) => data?.releases.filter((item) => item.countyId === county) ?? [];

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.public_evidence_runs; delete from public.public_evidence_snapshots;');
  _clearSnapshotCacheForTest();
});

const TABLES = new Set(['public_evidence_snapshots', 'public_evidence_runs']);
const missingTable = () => {
  const query = new Proxy({}, { get: (_, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: { code: 'PGRST205', message: 'not found' } }) : () => query) });
  return query;
};

/** A Supabase-shaped client over this database, recording every read and RPC. */
function client({ missing = false, failReads = false } = {}) {
  const log = [];
  const rpcs = [];
  return {
    log,
    rpcs,
    from(name) {
      if (!TABLES.has(name)) throw new Error(`the import read ${name}`);
      if (missing) return missingTable();
      if (failReads) return new Proxy({}, { get: (_, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: { code: 'XX000', message: 'connection lost' } }) : () => this.from(name)) });
      return pgliteSelect(db, name, log);
    },
    async rpc(name, args) {
      rpcs.push({ name, args });
      if (missing || name !== 'record_public_evidence_run') return { data: null, error: { code: 'PGRST202', message: `no function ${name}` } };
      assert.deepEqual(Object.keys(args), ['p_results']);
      try {
        const data = await db.asService(async (tx) => (await tx.query('select public.record_public_evidence_run(p_results => $1::jsonb) as result', [JSON.stringify(args.p_results)])).rows[0].result, { commit: true });
        return { data, error: null };
      } catch (error) {
        return { data: null, error: rpcError(error.code, error.message) };
      }
    },
  };
}

const json = (text, init = {}) => new Response(text, { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const html = (text, init = {}) => new Response(text, { status: 200, headers: { 'content-type': 'text/html' }, ...init });

/** The two sources, each a function of (url, init) returning a Response. */
function sources({ usdm = () => json(USDM_TEXT), wudc = () => html(WUDC_TEXT) } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const host = new URL(url).host;
    calls.push({ host, accept: init.headers?.accept, url });
    if (host === 'usdmdataservices.unl.edu') return usdm(url, init);
    if (host === 'www.ncwater.org') return wudc(url, init);
    throw new Error(`unexpected host ${host}`);
  };
  return { fetch, calls };
}

function harness(p, { env = ON, store = {}, tables = [] } = {}) {
  const h = createRouteHarness({
    fetch: p?.fetch,
    env,
    identities: { alice: {}, bob: {}, operator: {} },
    tables: haloTables('profiles', 'operations', 'operator_roles', 'source_ops_audit', ...tables),
    seed: (ids) => ({
      profiles: Object.values(ids).map((who) => ({ id: who.id })),
      operator_roles: [{ profile_id: ids.operator.id, role: 'viewer', granted_by: 'test' }],
    }),
  });
  const c = client(store);
  const fakeFrom = h.db.from;
  h.db.from = (name) => (TABLES.has(name) ? c.from(name) : fakeFrom(name));
  h.db.rpc = (name, args) => c.rpc(name, args);
  return { h, c };
}

async function cron(t, p, { at = TODAY, method = 'GET', headers = AUTH, ...options } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at) });
  try {
    const { h, c } = harness(p, options);
    const res = await h.call('/api/cron/public-evidence', method, { headers });
    return { res, body: await res.json(), c, h };
  } finally {
    t.mock.timers.reset();
  }
}

async function waterRead(t, { as = 'alice', store = {}, at = TODAY } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at) });
  try {
    const { h, c } = harness(null, { store });
    const res = await h.call('/api/water/notices', 'GET', { as, url: '/api/water/notices?resource=water-stewardship' });
    return { res, body: res.status === 200 ? await res.json() : null, text: res.status === 200 ? null : await res.text(), c };
  } finally {
    t.mock.timers.reset();
  }
}

const snapshots = async () => (await db.query('select id, source, source_date::text as source_date, row_count, content_sha256, body from public.public_evidence_snapshots order by id')).rows;
const runs = async () => (await db.query('select source, outcome, reason, row_count, snapshot_id from public.public_evidence_runs order by id')).rows;

/** Captures console.error and console.warn for a test. */
function captureLogs(t) {
  const lines = [];
  for (const level of ['error', 'warn']) t.mock.method(console, level, (...args) => lines.push(args.map(String).join(' ')));
  return lines;
}
const LEAKS = /usdmdataservices|ncwater|https?:|Aberdeen|statisticsType|<td|37183|Wake/;

/** The USDM rows as an edited JSON body. */
const usdmWith = (edit) => () => json(JSON.stringify(edit(JSON.parse(USDM_TEXT))));

test('drift: the screen\'s county filter is still the line transcribed here', () => {
  const screen = readFileSync(new URL('../components/homeguard/FoodWater.tsx', import.meta.url), 'utf8');
  assert.ok(screen.includes(SCREEN_FILTER));
});

test('without the secret nothing is read, fetched or stored, on GET and POST', async (t) => {
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-cron-secret': 'wrong' }]) {
    for (const method of ['GET', 'POST']) {
      const p = sources();
      const { res, c } = await cron(t, p, { headers, method });
      assert.equal(res.status, 401);
      assert.deepEqual(p.calls, []);
      assert.deepEqual(c.log, []);
      assert.deepEqual(c.rpcs, []);
    }
  }
  assert.deepEqual(await runs(), []);
});

test('flag off, or 0033 not applied: a non-retryable 503 and nothing fetched or stored', async (t) => {
  for (const options of [{ env: { CRON_SECRET: SECRET } }, { env: { CRON_SECRET: SECRET, HALO_FEATURE_PUBLIC_IMPORT: 'yes' } }, { store: { missing: true } }]) {
    const p = sources();
    const { res, body, c } = await cron(t, p, options);
    assert.equal(res.status, 503, JSON.stringify(options));
    assert.equal(body.code, 'feature_unavailable');
    assert.equal(body.retryable, false);
    assert.deepEqual(p.calls, [], 'nothing is fetched');
    assert.deepEqual(c.rpcs, []);
  }
  assert.deepEqual(await snapshots(), []);
});

test('a good run stores both sources, continues the bundled revisions, and water.read serves the stored copies', async (t) => {
  const logs = captureLogs(t);
  const p = sources();
  const { res, body } = await cron(t, p);
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, results: [
    { source: 'usdm-drought', outcome: 'stored', reason: null, rows: 400 },
    { source: 'ncdwr-conservation', outcome: 'stored', reason: null, rows: 277 },
  ] });
  assert.deepEqual(p.calls.map((c) => [c.host, c.accept]), [['usdmdataservices.unl.edu', 'application/json'], ['www.ncwater.org', 'text/html']]);
  assert.match(p.calls[0].url, /aoi=NC&startdate=9\/22\/2026&enddate=10\/20\/2026&statisticsType=2$/, 'the last 28 days, DS-108');

  const [drought, utility] = await snapshots();
  assert.equal(drought.source_date, '2026-10-13', 'the newest weekly map');
  assert.equal(drought.content_sha256, sha(USDM_TEXT));
  assert.deepEqual(drought.body.releases, BUNDLED.releases, 'the same download keeps every bundled revision');
  assert.deepEqual(utility.body.notices, BUNDLED.notices);
  assert.deepEqual(utility.body.source.summary, BUNDLED.source.utility.summary);
  assert.deepEqual((await runs()).map((r) => [r.source, r.outcome, r.reason, r.row_count, r.snapshot_id !== null]), [
    ['usdm-drought', 'stored', null, 400, true], ['ncdwr-conservation', 'stored', null, 277, true],
  ]);

  const read = await waterRead(t);
  assert.equal(read.res.status, 200);
  assert.equal(validWaterStewardship(read.body), true, 'the frontend accepts it');
  assert.equal(read.body.copies.drought.origin, 'scheduled');
  assert.equal(read.body.copies.utility.origin, 'scheduled');
  assert.equal(read.body.copies.drought.sourceDate, '2026-10-13');
  assert.match(read.body.copies.drought.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  const wake = screenReleases(read.body, '37183');
  assert.deepEqual(wake.map((r) => r.date), ['2026-10-13', '2026-10-06', '2026-09-29', '2026-09-22']);
  assert.match(wake[0].status, /^U\.S\. Drought Monitor map for 2026-10-13, valid 2026-10-13 to 2026-10-19\. A newer weekly map has likely been published/);
  const bob = await waterRead(t, { as: 'bob' });
  assert.deepEqual(bob.body, read.body, 'the same for every household');
  assert.equal(logs.filter((line) => LEAKS.test(line)).length, 0, logs.join('\n'));
});

test('a changed source is a new copy: changed rows get revision 2, unchanged keep 1, and water.read serves the newest', async (t) => {
  await cron(t, sources());
  // Alamance's newest map moves one point from D1 to D2 (69.80 and 27.51 in the recording).
  const changed = usdmWith((rows) => rows.map((row) => (row.fips === '37001' && row.mapDate.startsWith('2026-10-13') ? { ...row, d1: row.d1 - 1, d2: row.d2 + 1 } : row)));
  const { body } = await cron(t, sources({ usdm: changed }), { at: '2026-10-21T18:00:00Z' });
  assert.equal(body.results[0].outcome, 'stored');
  const read = await waterRead(t);
  const alamance = screenReleases(read.body, '37001');
  assert.equal(alamance[0].revision, 2);
  assert.equal(alamance[0].d2, 28.51);
  assert.deepEqual(alamance.map((r) => r.revision), [2, 1, 1, 1]);
  assert.deepEqual(screenReleases(read.body, '37183').map((r) => r.revision), [1, 1, 1, 1]);
  assert.equal((await snapshots()).filter((s) => s.source === 'usdm-drought').length, 2, 'the previous copy is retained');
});

test('a partial drought download (99 counties on the newest map) stores nothing for drought, keeps the last good copy, and the utility still refreshes', async (t) => {
  await cron(t, sources());
  const before = await snapshots();
  const partial = usdmWith((rows) => rows.filter((row) => !(row.fips === '37183' && row.mapDate.startsWith('2026-10-13'))));
  const logs = captureLogs(t);
  const { res, body } = await cron(t, sources({ usdm: partial }));
  assert.equal(res.status, 200);
  assert.deepEqual(body.results.map((r) => [r.source, r.outcome, r.reason, r.rows]), [['usdm-drought', 'failed', 'incomplete', null], ['ncdwr-conservation', 'stored', null, 277]]);
  const after = await snapshots();
  assert.equal(after.filter((s) => s.source === 'usdm-drought').length, 1, 'no new drought copy');
  assert.equal(after.find((s) => s.source === 'usdm-drought').id, before.find((s) => s.source === 'usdm-drought').id);
  assert.equal(after.filter((s) => s.source === 'ncdwr-conservation').length, 2);
  const failed = (await runs()).at(-2);
  assert.deepEqual([failed.outcome, failed.reason, failed.row_count, failed.snapshot_id], ['failed', 'incomplete', null, null]);
  const read = await waterRead(t);
  assert.equal(screenReleases(read.body, '37183').length, 4, 'Wake keeps its four maps from the last good copy');
  assert.ok(logs.some((line) => line.includes('usdm-drought not stored (incomplete)')));
  assert.equal(logs.filter((line) => LEAKS.test(line)).length, 0, logs.join('\n'));
});

test('malformed bodies store nothing: not JSON, a broken row, a bad date, a cut-off page, a missing total', async (t) => {
  const badPage = () => html('');
  const cases = [
    [{ usdm: () => json('<html>maintenance</html>'), wudc: badPage }, ['invalid', 'shape']],
    [{ usdm: usdmWith((rows) => rows.map((row, at) => (at === 0 ? { ...row, d4: 101 } : row))), wudc: badPage }, ['shape', 'shape']],
    [{ usdm: usdmWith((rows) => ({ data: rows })), wudc: () => html(WUDC_TEXT.slice(0, 40000)) }, ['shape', 'incomplete']],
    [{ usdm: usdmWith((rows) => rows.map((row, at) => (at === 0 ? { ...row, mapDate: '2026-13-01T00:00:00' } : row))), wudc: () => html(WUDC_TEXT.replace('Total Systems', 'All')) }, ['bad_date', 'shape']],
  ];
  for (const [patch, reasons] of cases) {
    const { body } = await cron(t, sources(patch));
    assert.deepEqual(body.results.map((r) => [r.outcome, r.reason, r.rows]), reasons.map((reason) => ['failed', reason, null]), reasons.join());
  }
  assert.deepEqual(await snapshots(), [], 'nothing stored');
  assert.equal((await runs()).length, 8, 'every attempt is recorded');
  assert.ok((await runs()).every((r) => r.outcome === 'failed' && r.snapshot_id === null && r.row_count === null));
  // With nothing stored, water.read serves the bundled copies and says so.
  const read = await waterRead(t);
  assert.deepEqual([read.body.copies.drought.origin, read.body.copies.utility.origin], ['bundled', 'bundled']);
  assert.equal(read.body.copies.drought.retrieved, '2026-10-20');
  assert.deepEqual(read.body.notices, BUNDLED.notices);
  const withoutStatus = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'status')));
  assert.deepEqual(withoutStatus(read.body.releases), withoutStatus(BUNDLED.releases), 'the status gains only its currency note');
  assert.equal(validWaterStewardship(read.body), true);
});

test('an HTTP error, an oversize body (declared or streamed) and a network failure are recorded by code', async (t) => {
  const big = 'x'.repeat(1024 * 1024 + 10);
  const cases = [
    [{ usdm: () => new Response('down', { status: 503 }) }, 'http_503'],
    [{ usdm: () => json('[]', { headers: { 'content-length': String(5 * 1024 * 1024) } }) }, 'too_large'],
    [{ usdm: () => json(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(big)); controller.close(); } })) }, 'too_large'],
    [{ usdm: () => { throw new TypeError('getaddrinfo ENOTFOUND usdmdataservices.unl.edu'); } }, 'network'],
  ];
  const logs = captureLogs(t);
  for (const [patch, reason] of cases) {
    const { body } = await cron(t, sources(patch));
    assert.equal(body.results[0].reason, reason);
    assert.equal(body.results[1].outcome, 'stored', 'the utility is not held back');
  }
  assert.equal(logs.filter((line) => LEAKS.test(line)).length, 0, logs.join('\n'));
});

test('a timeout over either source is recorded as timeout, stores nothing, and is bounded', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const c = client();
  const started = Date.now();
  const result = await runPublicWaterImport({ supabase: c, fetchImpl: hang, timeoutMs: 50, now: new Date(TODAY) });
  assert.ok(Date.now() - started < 5000);
  assert.deepEqual(result.results.map((r) => [r.outcome, r.reason]), [['failed', 'timeout'], ['failed', 'timeout']]);
  assert.deepEqual(await snapshots(), []);
  assert.equal((await runs()).length, 2);
  // A stub that ignores the signal is bounded too.
  const ignore = () => new Promise(() => {});
  const again = await runPublicWaterImport({ supabase: c, fetchImpl: ignore, timeoutMs: 50, now: new Date(TODAY) });
  assert.deepEqual(again.results.map((r) => r.reason), ['timeout', 'timeout']);
});

test('a stale or future newest map is refused', async (t) => {
  let { body } = await cron(t, sources(), { at: '2026-11-20T18:00:00Z' });
  assert.deepEqual([body.results[0].outcome, body.results[0].reason], ['failed', 'stale']);
  ({ body } = await cron(t, sources(), { at: '2026-10-01T18:00:00Z' }));
  assert.deepEqual([body.results[0].outcome, body.results[0].reason], ['failed', 'bad_date']);
  assert.equal(body.results[1].reason, 'bad_date', 'a status updated after the run date is refused too');
});

test('water.read before 0033, and when the copies cannot be read, serves the bundled copy dated, logging a code only', async (t) => {
  const missing = await waterRead(t, { store: { missing: true } });
  assert.equal(missing.res.status, 200);
  assert.deepEqual(missing.body.copies, {
    drought: { origin: 'bundled', retrieved: '2026-10-20', sourceDate: '2026-10-13' },
    utility: { origin: 'bundled', retrieved: '2026-10-20', sourceDate: missing.body.copies.utility.sourceDate },
  });
  assert.match(missing.body.copies.utility.sourceDate, /^2026-\d{2}-\d{2}$/);
  assert.equal(validWaterStewardship(missing.body), true);
  const logs = captureLogs(t);
  const down = await waterRead(t, { store: { failReads: true } });
  assert.equal(down.res.status, 200);
  assert.deepEqual(down.body, missing.body);
  assert.ok(logs.some((line) => /serving the bundled copy: XX000 snapshot read failed/.test(line)));
  assert.equal(logs.filter((line) => /connection lost/.test(line)).length, 0, 'the database message is not logged');
});

test('a stored copy that fails the shape check falls back to the bundled copy, never a broken answer', async (t) => {
  await cron(t, sources());
  await db.exec(`update public.public_evidence_snapshots set body = jsonb_set(body, '{releases,0,d1}', '140') where source = 'usdm-drought'`);
  _clearSnapshotCacheForTest();
  captureLogs(t);
  const read = await waterRead(t);
  assert.equal(read.res.status, 200);
  assert.equal(read.body.copies.drought.origin, 'bundled');
  assert.equal(read.body.copies.utility.origin, 'bundled', 'the whole answer falls back');
  assert.equal(validWaterStewardship(read.body), true);
});

test('the operations screen lists the two sources only after a run, with the real run time and a failed run as failed', async (t) => {
  const viewer = async () => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(TODAY) });
    try {
      const { h } = harness(null);
      return await (await h.call('/api/operator/sources', 'GET', { as: 'operator' })).json();
    } finally {
      t.mock.timers.reset();
    }
  };
  let snapshot = await viewer();
  assert.equal(snapshot.sources.some((s) => ['usdm-drought', 'ncdwr-conservation'].includes(s.id)), false, 'not listed before any run');

  await cron(t, sources());
  await cron(t, sources({ usdm: () => new Response('down', { status: 502 }) }));
  snapshot = await viewer();
  assert.equal(sourceOpsService.validSourceOpsSnapshot(snapshot), true);
  const by = Object.fromEntries(snapshot.sources.map((s) => [s.id, s]));
  const [stored] = (await db.query(`select retrieved_at from public.public_evidence_snapshots where source = 'usdm-drought' order by id desc limit 1`)).rows;
  assert.equal(by['usdm-drought'].lastSuccess, stored.retrieved_at.toISOString(), 'the last good retrieval, not the failed run');
  assert.equal(by['usdm-drought'].run.state, 'failed');
  assert.match(by['usdm-drought'].run.diagnostic, /stored nothing \(http_502\); the previous copy is kept\./);
  assert.equal(by['ncdwr-conservation'].run.state, 'complete');
  assert.match(by['ncdwr-conservation'].run.diagnostic, /stored 277 rows/);
  assert.equal(by['usdm-drought'].freshness, 'current');
  assert.deepEqual(by['usdm-drought'].allowedDecisions, []);
});

test('the route exports maxDuration 60 and vercel.json schedules it weekly', () => {
  const route = readFileSync(new URL('../app/api/cron/public-evidence/route.js', import.meta.url), 'utf8');
  assert.match(route, /export const maxDuration = 60;/);
  const crons = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons;
  assert.deepEqual(crons.find((c) => c.path === '/api/cron/public-evidence'), { path: '/api/cron/public-evidence', schedule: '0 18 * * 4' });
});
