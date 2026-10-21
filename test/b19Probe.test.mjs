/**
 * B19 probe: edge inputs and failure modes of the weekly public water import
 * (lib/publicWaterSources.js, lib/publicWaterImport.js, lib/publicWaterStore.js,
 * GET|POST /api/cron/public-evidence, water.read). Reuses the harness patterns
 * of test/publicWaterImport.test.mjs: the real migration 0033 on PGlite, a stub
 * fetch serving the recorded downloads, a mocked clock.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouteHarness, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { validWaterStewardship } = await loadFrontend('production/home-resources');
const { runPublicWaterImport } = await import('../lib/publicWaterImport.js');
const { _clearSnapshotCacheForTest } = await import('../lib/publicWaterStore.js');
const { WaterSourceError, parseConservationStatus, parseDroughtStatistics, createReviser } = await import('../lib/publicWaterSources.js');

const SECRET = 'cron-secret-for-tests';
const AUTH = { authorization: `Bearer ${SECRET}` };
const ON = { CRON_SECRET: SECRET, HALO_FEATURE_PUBLIC_IMPORT: 'on' };
const TODAY = '2026-10-20T18:00:00Z';
const fixture = (name) => readFileSync(new URL(`./fixtures/public-evidence/${name}`, import.meta.url), 'utf8');
const USDM_TEXT = fixture('usdm-nc.json');
const WUDC_TEXT = fixture('wudc.html');
const usdmRows = () => JSON.parse(USDM_TEXT);
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

function client({ missing = false, failReads = false, rpcImpl = null } = {}) {
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
      if (rpcImpl) return rpcImpl(name, args);
      if (missing || name !== 'record_public_evidence_run') return { data: null, error: { code: 'PGRST202', message: `no function ${name}` } };
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

function sources({ usdm = () => json(USDM_TEXT), wudc = () => html(WUDC_TEXT) } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const host = new URL(url).host;
    calls.push({ host, url });
    if (host === 'usdmdataservices.unl.edu') return usdm(url, init);
    if (host === 'www.ncwater.org') return wudc(url, init);
    throw new Error(`unexpected host ${host}`);
  };
  return { fetch, calls };
}

function harness(p, { env = ON, store = {} } = {}) {
  const h = createRouteHarness({
    fetch: p?.fetch,
    env,
    identities: { alice: {}, bob: {} },
    tables: haloTables('profiles', 'operations', 'operator_roles', 'source_ops_audit'),
    seed: (ids) => ({ profiles: Object.values(ids).map((who) => ({ id: who.id })) }),
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
    const text = await res.text();
    return { res, text, body: JSON.parse(text), c };
  } finally {
    t.mock.timers.reset();
  }
}

async function waterRead(t, { as = 'alice', store = {}, at = TODAY, headers = {}, query = '' } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at) });
  try {
    const { h } = harness(null, { store });
    const res = await h.call('/api/water/notices', 'GET', { as, headers, url: `/api/water/notices?resource=water-stewardship${query}` });
    const text = await res.text();
    return { res, text, body: res.status === 200 ? JSON.parse(text) : null };
  } finally {
    t.mock.timers.reset();
  }
}

const snapshots = async () => (await db.query('select id, source, source_date::text as source_date, row_count, content_sha256, body from public.public_evidence_snapshots order by id')).rows;
const runs = async () => (await db.query('select source, outcome, reason, row_count, snapshot_id from public.public_evidence_runs order by id')).rows;

/** Every console channel, for a test. */
function captureLogs(t) {
  const lines = [];
  for (const level of ['error', 'warn', 'log', 'info', 'debug']) t.mock.method(console, level, (...args) => lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' ')));
  return lines;
}
const LEAKS = /usdmdataservices|ncwater|https?:|statisticsType|<td|3718|3700|Alamance|Aberdeen|02-01-035|BODYMARK|LEAKVALUE|connection lost|secret row/i;

const usdmWith = (edit) => () => json(JSON.stringify(edit(usdmRows())));
const refusedWith = (fn, code) => assert.throws(fn, (error) => error instanceof WaterSourceError && error.code === code, `expected ${code}`);

// ------------------------------------------------------------ parser edges

test('drought parser: duplicated rows, bad shares, 0 maps, extra fields, whitespace in a county name', () => {
  const rows = usdmRows();
  // A duplicated row (same county and map): refused as a repeat, not silently deduplicated.
  refusedWith(() => parseDroughtStatistics([...rows, rows[0]]), 'shape');
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 7 ? { ...rows[0] } : r))), 'shape');
  // Shares that are not real percentages.
  for (const bad of [NaN, Infinity, -Infinity, -0.01, 100.01, null, undefined, '5', true, [5], {}]) {
    refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 3 ? { ...r, d2: bad } : r))), 'shape');
  }
  // Sum off by more than 0.5, and a share set that is all zero.
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 3 ? { ...r, d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, none: 0 } : r))), 'shape');
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 3 ? { ...r, d1: r.d1 + 0.6 } : r))), 'shape');
  // 0 maps, or no list at all.
  for (const empty of [[], {}, null, undefined, 'x', 0, { data: rows }]) refusedWith(() => parseDroughtStatistics(empty), empty === undefined || !Array.isArray(empty) ? 'shape' : 'incomplete');
  // null and primitive rows inside a list of the right size.
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? null : r))), 'shape');
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? 7 : r))), 'shape');
  // Wrong state, format, unknown county, a county under another county's name.
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? { ...r, state: 'SC' } : r))), 'shape');
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? { ...r, statisticFormatID: 1 } : r))), 'shape');
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? { ...r, fips: '37999' } : r))), 'shape');
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? { ...r, county: 'Wake County' } : r))), 'shape');
  // Validity inverted.
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? { ...r, validEnd: '2026-10-01T00:00:00' } : r))), 'bad_date');
  refusedWith(() => parseDroughtStatistics(rows.map((r, i) => (i === 0 ? { ...r, mapDate: undefined } : r))), 'bad_date');

  // Extra unexpected fields are ignored and never reach the output.
  const baseline = parseDroughtStatistics(rows);
  const extra = parseDroughtStatistics(rows.map((r) => ({ ...r, injected: '<script>', __proto__: { x: 1 }, nested: { a: 1 } })));
  assert.deepEqual(extra.releases, baseline.releases);
  assert.ok(extra.releases.every((r) => !('injected' in r) && !('nested' in r)));
  // Whitespace in the county name is cleaned, and the stored row is the same.
  const spaced = parseDroughtStatistics(rows.map((r) => ({ ...r, county: `  ${r.county.replace(' ', '   ')}\n\t` })));
  assert.deepEqual(spaced.releases, baseline.releases);
  // Row order does not matter.
  assert.deepEqual(parseDroughtStatistics([...rows].reverse()).releases, baseline.releases);
});

test('drought parser: more than 10 maps, and a map with a county swapped for a duplicate, are refused', () => {
  const rows = usdmRows();
  const sample = rows.filter((r) => r.mapDate.startsWith('2026-10-13'));
  // 11 whole maps of 100 counties each = 1100 rows: over the cap.
  const many = [];
  for (let k = 0; k < 11; k += 1) {
    const d = new Date(Date.UTC(2026, 0, 5 + 7 * k)).toISOString().slice(0, 10);
    for (const r of sample) many.push({ ...r, mapDate: `${d}T00:00:00`, validStart: `${d}T00:00:00`, validEnd: `${d}T23:59:59` });
  }
  refusedWith(() => parseDroughtStatistics(many), 'incomplete');
  // 100 rows on a map but one is a duplicate county (so one county is missing): shape, not accepted.
  refusedWith(() => parseDroughtStatistics(sample.map((r, i) => (i === 5 ? sample[0] : r))), 'shape');
  // A single complete map is valid.
  assert.equal(parseDroughtStatistics(sample).mapDates.length, 1);
});

test('utility parser: whitespace, entities in names, a swapped duplicate PWSID, status/summary drift', () => {
  const base = parseConservationStatus(WUDC_TEXT);
  const pwsids = [...WUDC_TEXT.matchAll(/<td>(\d{2}-\d{2}-\d{3})<\/td>/g)].map((m) => m[1]);
  assert.equal(pwsids.length, base.total);
  // Right count, but row one carries row two's PWSID.
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace(`<td>${pwsids[0]}</td>`, `<td>${pwsids[1]}</td>`)), 'shape');
  // Right count, last row swapped for an exact copy of the first.
  const rowsHtml = [...WUDC_TEXT.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((r) => r.includes('<td'));
  assert.equal(rowsHtml.length, base.total);
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace(rowsHtml.at(-1), rowsHtml[0])), 'shape');

  // Entities decode in names: an ampersand and apostrophes are plain text and allowed.
  const named = parseConservationStatus(WUDC_TEXT.replace('<td>Alamance</td>', '<td>  Smith &amp;\n  Sons &#39;Co&#39; &nbsp; </td>'));
  assert.ok(named.notices.some((n) => n.title === "Smith & Sons 'Co' (Alamance County)"));
  // Markup smuggled through entities is refused, never rendered.
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace('<td>Alamance</td>', '<td>&lt;b&gt;x&lt;/b&gt;</td>')), 'shape');
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace('<td>Alamance</td>', '<td>&#60;script&#62;</td>')), 'shape');
  // A name over 80 characters, an empty name.
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace('<td>Alamance</td>', `<td>${'A'.repeat(81)}</td>`)), 'shape');
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace('<td>Alamance</td>', '<td>   </td>')), 'shape');
  // A status flipped on one row: the page's own summary no longer agrees.
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace('class="status-N">Not Restricted', 'class="status-N">Voluntary')), 'incomplete');
  // An invented status.
  refusedWith(() => parseConservationStatus(WUDC_TEXT.replace('class="status-N">Not Restricted', 'class="status-N">Open')), 'shape');
  // Not a page.
  for (const bad of ['', null, undefined, 5, '<html></html>']) refusedWith(() => parseConservationStatus(bad), 'shape');
});

test('revisions: createReviser keeps an unchanged row, bumps a changed one, ignores key order and junk revisions', () => {
  const old = [{ id: 'a', x: 1, y: 2, revision: 3 }, { id: 'b', x: 1, revision: 'bad' }, { id: 'c', x: 1, revision: 0 }, { id: 'd', x: 1, revision: 1.5 }];
  const revise = createReviser(old, '2026-10-20');
  assert.equal(revise({ y: 2, x: 1, id: 'a' }).revision, 3, 'key order is not a change');
  assert.equal(revise({ id: 'a', x: 1, y: 3 }).revision, 4);
  for (const id of ['b', 'c', 'd', 'new']) assert.equal(revise({ id, x: 1 }).revision, 1, id);
  assert.equal(createReviser(null, 'x')({ id: 'a' }).revision, 1);
  assert.equal(createReviser('nope', 'x')({ id: 'a' }).revision, 1);
});

// ------------------------------------------------------- failed / partial runs

const FAILURES = [
  { name: 'http 503', patch: { usdm: () => new Response('BODYMARK down', { status: 503 }), wudc: () => new Response('BODYMARK down', { status: 500 }) } },
  { name: 'thrown network error', patch: { usdm: () => { throw new TypeError('getaddrinfo ENOTFOUND usdmdataservices.unl.edu BODYMARK'); }, wudc: () => { throw new Error('https://www.ncwater.org/WUDC BODYMARK'); } } },
  { name: 'garbage', patch: { usdm: () => json('BODYMARK not json'), wudc: () => html('<html>BODYMARK</html>') } },
  { name: 'empty', patch: { usdm: () => json('[]'), wudc: () => html('') } },
  { name: 'hostile values', patch: { usdm: usdmWith((rows) => rows.map((r, i) => (i === 0 ? { ...r, county: 'LEAKVALUE' } : r))), wudc: () => html(WUDC_TEXT.replace('<td>Alamance</td>', '<td>LEAKVALUE&lt;</td>')) } },
  { name: 'partial', patch: { usdm: usdmWith((rows) => rows.slice(0, 399)), wudc: () => html(WUDC_TEXT.slice(0, 60000)) } },
  { name: 'oversize', patch: { usdm: () => json('x', { headers: { 'content-length': '9999999' } }), wudc: () => html('y'.repeat(1024 * 1024 + 5)) } },
];

test('many failed runs, and a mix, never replace or remove a good stored copy, and water.read keeps serving it', async (t) => {
  const logs = captureLogs(t);
  await cron(t, sources());
  const good = await snapshots();
  assert.equal(good.length, 2);
  const served = (await waterRead(t)).body;
  assert.equal(served.copies.drought.origin, 'scheduled');

  let runCount = 2;
  for (let round = 0; round < 3; round += 1) {
    for (const failure of FAILURES) {
      const { res, body } = await cron(t, sources(failure.patch));
      assert.equal(res.status, 200, failure.name);
      assert.ok(body.results.every((r) => r.outcome === 'failed' && r.rows === null), failure.name);
      runCount += 2;
      assert.deepEqual(await snapshots(), good, `${failure.name}: stored copies untouched`);
    }
  }
  assert.equal((await runs()).length, runCount, 'every attempt is recorded');
  const again = await waterRead(t);
  assert.deepEqual(again.body, served, 'water.read serves the same body');

  // A mix: drought fails, utility stores a changed table; the drought copy is untouched, the utility is replaced by a newer one only.
  const changed = WUDC_TEXT.replace('<td>Alamance</td>', '<td>Alamance Renamed</td>');
  const mixed = await cron(t, sources({ usdm: () => new Response('down', { status: 502 }), wudc: () => html(changed) }));
  assert.deepEqual(mixed.body.results.map((r) => r.outcome), ['failed', 'stored']);
  const after = await snapshots();
  assert.deepEqual(after.filter((s) => s.source === 'usdm-drought'), good.filter((s) => s.source === 'usdm-drought'));
  assert.equal(after.filter((s) => s.source === 'ncdwr-conservation').length, 2);
  // And the other way round.
  const reverse = await cron(t, sources({ usdm: usdmWith((rows) => rows.map((r) => (r.fips === '37001' && r.mapDate.startsWith('2026-10-13') ? { ...r, d1: r.d1 - 1, d2: r.d2 + 1 } : r))), wudc: () => new Response('', { status: 404 }) }));
  assert.deepEqual(reverse.body.results.map((r) => [r.outcome, r.reason]), [['stored', null], ['failed', 'http_404']]);
  const last = await snapshots();
  assert.equal(last.filter((s) => s.source === 'ncdwr-conservation').length, 2);
  assert.equal(last.filter((s) => s.source === 'usdm-drought').length, 2);
  const read = await waterRead(t);
  assert.equal(validWaterStewardship(read.body), true);
  assert.equal(read.body.copies.drought.origin, 'scheduled');
  assert.equal(read.body.copies.utility.origin, 'scheduled');
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.filter((l) => LEAKS.test(l)).join('\n'));
});

test('the import\'s logs, the cron response and the run table carry no URL, host, body text or row value', async (t) => {
  const logs = captureLogs(t);
  for (const failure of FAILURES) {
    const p = sources(failure.patch);
    const { res, text } = await cron(t, p);
    assert.equal(res.status, 200);
    assert.doesNotMatch(text, LEAKS, `${failure.name}: response`);
    assert.deepEqual(Object.keys(JSON.parse(text)), ['ok', 'results']);
    for (const r of JSON.parse(text).results) assert.deepEqual(Object.keys(r), ['source', 'outcome', 'reason', 'rows']);
  }
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.join('\n'));
  assert.ok(logs.length > 0);
  for (const r of await runs()) assert.match(r.reason, /^(timeout|network|too_large|invalid|no_timeout|bad_headers|shape|incomplete|bad_date|stale|internal|http_\d{3})$/);
  // An impossible character reference is left as written and refused by the name check (it used to crash the decoder).
  const crash = await cron(t, sources({ wudc: () => html(WUDC_TEXT.replace('<td>Alamance</td>', '<td>&#99999999999;</td>')) }));
  assert.equal(crash.body.results[1].reason, 'shape');
  assert.doesNotMatch(crash.text, LEAKS);
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.join('\n'));
});

// ------------------------------------------------------------ cron answers

test('cron: missing migration at either step is a 503 and stores nothing; flag off fetches nothing', async (t) => {
  const logs = captureLogs(t);
  let p = sources();
  let r = await cron(t, p, { store: { missing: true } });
  assert.equal(r.res.status, 503);
  assert.deepEqual([r.body.code, r.body.retryable], ['feature_unavailable', false]);
  assert.deepEqual(p.calls, []);
  // Reads work but the RPC is gone (partial application): 503, nothing stored, but no stale claims.
  p = sources();
  r = await cron(t, p, { store: { rpcImpl: async () => ({ data: null, error: { code: '42883', message: 'function secret row does not exist' } }) } });
  assert.equal(r.res.status, 503);
  assert.deepEqual(await snapshots(), []);
  assert.doesNotMatch(r.text, LEAKS);
  // Flag off: no secret needed to learn nothing; with the secret, 503 and nothing fetched.
  p = sources();
  r = await cron(t, p, { env: { CRON_SECRET: SECRET }, method: 'POST' });
  assert.equal(r.res.status, 503);
  assert.deepEqual(p.calls, []);
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.join('\n'));
});

test('cron: a database error on the RPC is a 500, logged by code only, nothing stored', async (t) => {
  const logs = captureLogs(t);
  const failing = async () => ({ data: null, error: rpcError('XX001', 'secret row Alamance https://www.ncwater.org/WUDC connection lost') });
  const r = await cron(t, sources(), { store: { rpcImpl: failing } });
  assert.equal(r.res.status, 500);
  assert.doesNotMatch(r.text, LEAKS);
  assert.ok(logs.some((l) => /Public water import failed: XX001 public evidence store failed/.test(l)), logs.join('\n'));
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.join('\n'));
  assert.deepEqual(await snapshots(), []);
  // A thrown (not returned) rpc failure and a read failure also stay generic.
  const thrower = await cron(t, sources(), { store: { rpcImpl: async () => { throw new Error('secret row Alamance https://www.ncwater.org'); } } });
  assert.equal(thrower.res.status, 500);
  assert.doesNotMatch(thrower.text, LEAKS);
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.join('\n'));
  const reads = await cron(t, sources(), { store: { failReads: true } });
  assert.equal(reads.res.status, 500);
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.join('\n'));
});

// ---------------------------------------------------------------- water.read

test('water.read: two households get the identical body; home context and profile ids are ignored', async (t) => {
  await cron(t, sources());
  const a = await waterRead(t, { as: 'alice' });
  const b = await waterRead(t, { as: 'bob', headers: { 'x-halo-home-context': JSON.stringify({ homeId: 'h-1', county: '37183', zip: '27601' }) }, query: '&profile_id=00000000-0000-0000-0000-000000000001&home_id=x&county=37183' });
  assert.equal(a.res.status, 200);
  assert.equal(b.res.status, 200);
  assert.equal(b.text, a.text);
  // Bundled origin too.
  await db.exec('delete from public.public_evidence_runs; delete from public.public_evidence_snapshots;');
  _clearSnapshotCacheForTest();
  const c = await waterRead(t, { as: 'alice' });
  const d = await waterRead(t, { as: 'bob', headers: { 'x-halo-home-context': 'garbage' }, query: '&profile_id=zzz' });
  assert.equal(d.text, c.text);
  assert.equal(c.body.copies.drought.origin, 'bundled');
});

test('water.read: still answers with 0033 missing, origin bundled, validator accepts', async (t) => {
  const logs = captureLogs(t);
  const r = await waterRead(t, { store: { missing: true } });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.copies.drought.origin, 'bundled');
  assert.equal(r.body.copies.utility.origin, 'bundled');
  assert.equal(validWaterStewardship(r.body), true);
  assert.equal(r.res.headers.get('cache-control'), 'private, max-age=600');
  assert.equal(logs.length, 0, 'a missing table is expected, not an error');
});

test('the frontend validator accepts every answer water.read can give: bundled, scheduled, mixed either way', async (t) => {
  const check = (body, drought, utility) => {
    assert.equal(validWaterStewardship(body), true, `${drought}/${utility}`);
    assert.deepEqual([body.copies.drought.origin, body.copies.utility.origin], [drought, utility]);
    assert.ok(body.counties.length === 100);
    for (const county of body.counties) assert.ok(screenReleases(body, county.id).length >= 1, `${county.id} has a release`);
    assert.ok(body.notices.length > 0);
  };
  check((await waterRead(t)).body, 'bundled', 'bundled');
  // Mixed: only the drought stores.
  await cron(t, sources({ wudc: () => new Response('', { status: 500 }) }));
  check((await waterRead(t)).body, 'scheduled', 'bundled');
  // Both.
  await cron(t, sources());
  check((await waterRead(t)).body, 'scheduled', 'scheduled');
  // Mixed the other way: utility only.
  await db.exec('delete from public.public_evidence_runs; delete from public.public_evidence_snapshots;');
  _clearSnapshotCacheForTest();
  await cron(t, sources({ usdm: () => new Response('', { status: 500 }) }));
  check((await waterRead(t)).body, 'bundled', 'scheduled');
  // After a stored copy, the store becoming unreadable falls back to bundled, still valid.
  captureLogs(t);
  check((await waterRead(t, { store: { failReads: true } })).body, 'bundled', 'bundled');
});

// ----------------------------------------------------------------- revisions

test('revisions across imports: unchanged keeps all, a changed row bumps only that row, and it persists', async (t) => {
  const revisionsOf = async () => {
    const body = (await waterRead(t)).body;
    return { drought: new Map(body.releases.map((r) => [r.id, r.revision])), utility: new Map(body.notices.map((n) => [n.id, n.revision])), body };
  };
  await cron(t, sources());
  const first = await revisionsOf();
  // Unchanged re-import (a day later): every revision identical.
  await cron(t, sources(), { at: '2026-10-21T18:00:00Z' });
  const second = await revisionsOf();
  assert.deepEqual(second.drought, first.drought);
  assert.deepEqual(second.utility, first.utility);
  assert.equal((await snapshots()).length, 4, 'a re-import still stores a dated copy');
  // Change one drought row and one utility row (Alamance's reason).
  const alamanceRow = WUDC_TEXT.indexOf('<td>02-01-035</td>');
  const tail = WUDC_TEXT.slice(alamanceRow).replace('<td style="text-align:center" ></td>', '<td style="text-align:center">Drought</td>');
  const changedHtml = WUDC_TEXT.slice(0, alamanceRow) + tail;
  assert.notEqual(changedHtml, WUDC_TEXT);
  const changedUsdm = usdmWith((rows) => rows.map((r) => (r.fips === '37183' && r.mapDate.startsWith('2026-09-29') ? { ...r, d0: r.d0 + 0.2, none: Math.max(0, r.none - 0.2) } : r)));
  const run3 = await cron(t, sources({ usdm: changedUsdm, wudc: () => html(changedHtml) }), { at: '2026-10-22T18:00:00Z' });
  assert.deepEqual(run3.body.results.map((r) => r.outcome), ['stored', 'stored']);
  const third = await revisionsOf();
  const bumpedDrought = [...third.drought].filter(([id, rev]) => rev !== first.drought.get(id));
  const bumpedUtility = [...third.utility].filter(([id, rev]) => rev !== first.utility.get(id));
  assert.deepEqual(bumpedDrought.map(([id, rev]) => [id, rev]), [['usdm-37183-2026-09-29', first.drought.get('usdm-37183-2026-09-29') + 1]]);
  assert.deepEqual(bumpedUtility.map(([id]) => id), ['ncdwr-02-01-035']);
  assert.equal(bumpedUtility[0][1], first.utility.get('ncdwr-02-01-035') + 1);
  assert.equal(third.drought.size, first.drought.size);
  // The same changed content imported again: the bumped revision stays, nothing else moves.
  await cron(t, sources({ usdm: changedUsdm, wudc: () => html(changedHtml) }), { at: '2026-10-23T18:00:00Z' });
  const fourth = await revisionsOf();
  assert.deepEqual(fourth.drought, third.drought);
  assert.deepEqual(fourth.utility, third.utility);
});

test('retention: ten changed runs keep the newest 8 copies per source, and the newest is the last stored', async (t) => {
  for (let k = 0; k < 10; k += 1) {
    const p = sources({
      usdm: usdmWith((rows) => rows.map((r) => (r.fips === '37001' && r.mapDate.startsWith('2026-10-13') ? { ...r, d1: r.d1 - (k + 1) * 0.01, d2: r.d2 + (k + 1) * 0.01 } : r))),
      wudc: () => html(WUDC_TEXT.replace('<td>Alamance</td>', `<td>Alamance V${'x'.repeat(k)}</td>`)),
    });
    const { body } = await cron(t, p);
    assert.deepEqual(body.results.map((r) => r.outcome), ['stored', 'stored'], `run ${k}`);
  }
  const all = await snapshots();
  assert.equal(all.filter((s) => s.source === 'usdm-drought').length, 8);
  assert.equal(all.filter((s) => s.source === 'ncdwr-conservation').length, 8);
  const read = (await waterRead(t)).body;
  assert.equal(validWaterStewardship(read), true);
  assert.ok(read.notices.some((n) => n.title.startsWith(`Alamance V${'x'.repeat(9)} `)));
});

// ------------------------------------------------------------ direct import

test('runPublicWaterImport: the timeout seam bounds a hung source without touching a stored copy', async (t) => {
  const c = client();
  await runPublicWaterImport({ supabase: c, fetchImpl: sources().fetch, now: new Date(TODAY) });
  const good = await snapshots();
  const logs = captureLogs(t);
  const result = await runPublicWaterImport({ supabase: c, fetchImpl: () => new Promise(() => {}), timeoutMs: 30, now: new Date(TODAY) });
  assert.deepEqual(result.results.map((r) => r.reason), ['timeout', 'timeout']);
  assert.deepEqual(await snapshots(), good);
  assert.equal(logs.filter((l) => LEAKS.test(l)).length, 0, logs.join('\n'));
});
