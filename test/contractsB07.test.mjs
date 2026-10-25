/**
 * B07 privacy: the executable contract, and conformance of the REAL handlers
 * to it and to the frontend's own consumption logic (B07 plan, Task 7).
 *
 * The per-route suites prove each route right on its own terms. What none of
 * them proves is that the four operations and the reconcile agree with the
 * panel that drives them, ProductionPrivacy, end to end. So every answer here
 * is produced by a real handler and then handed to the panel's OWN code,
 * transcribed once in test/helpers/frontendB07.mjs (ProductionPrivacy.tsx:
 * 18-25 and SettingsWorkspace.tsx:52, verbatim with the types stripped, and
 * the runtime's request from test/helpers/frontendB06.mjs), and each scenario
 * ends in what the panel then shows: whether it is verified, whether it is
 * locked and on which operation, the review it holds, the sentence, the file
 * it downloaded. A drift test holds every transcribed line to the component,
 * and a negative control per transcribed function shows that a deliberately
 * altered copy fails a scenario assertion, so agreement means something.
 *
 * THE DATABASE IS REAL. Every world is two households on PGlite with every
 * migration applied: the 0017 ledger with 0024's settled-privacy guard
 * (test/db/pgliteLedger.mjs), 0024's five functions called by argument name
 * as PostgREST calls them, and, for the privacy routes and the reconcile,
 * the household tables read straight from PGlite (test/db/pgliteSelect.mjs),
 * so the inspect-to-export run builds its file from the database the real
 * fingerprint was computed over. The other routes a scenario calls (profile,
 * settings) read a copy of PGlite's rows on the fake client, refreshed before
 * each such call, as in test/routesPrivacyClearDb.test.mjs.
 *
 * Every real answer is checked against `docs/backend/contracts/b07.openapi.json`
 * (status, body schema, the X-Request-Id echo, the bare-body and U+2014
 * rules, and an export file's document schema), and the fixtures under
 * `docs/backend/contracts/fixtures/b07/` are the normalised answers produced
 * here; a test fails if one drifts. Run
 * `node test/contractsB07.test.mjs --write-b07-fixtures` to rewrite them after
 * a deliberate contract change.
 *
 * Synthetic identities, a fetch that throws on any host, no real Supabase
 * project, no production URL.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { HALO_TABLES, OWNED_TABLES } from './helpers/tables.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteLedger } from './db/pgliteLedger.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';
import { OWNED_ROW } from './db/ownedRows.mjs';
import { installSettingsDb } from './helpers/fakeSettingsDb.mjs';
import { productionPreferences, validSettingsSnapshot } from './helpers/frontendB04.mjs';
import { messages as RUNTIME_MESSAGES } from './helpers/frontendB06.mjs';
import * as fe from './helpers/frontendB07.mjs';

const { requestHash } = await import('../lib/operations.js');
const { mintReviewToken } = await import('../lib/privacyToken.js');
const { fingerprintTables } = await import('../lib/privacyInventory.js');
const { PRIVACY_KINDS, privacyScopeOfKind } = await import('../lib/privacyStore.js');

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b07.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b07', components: contract.components });
const operations = new Map(
  Object.entries(contract.paths).flatMap(([route, verbs]) =>
    Object.entries(verbs).map(([method, op]) => [op.operationId, { ...op, path: route, method: method.toUpperCase() }])),
);
const validators = new Map();
function compiled(ref) {
  if (!validators.has(ref)) validators.set(ref, ajv.compile({ $ref: `urn:halo:b07${ref}` }));
  return validators.get(ref);
}
const schema = (name) => compiled(`#/components/schemas/${name}`);
/** The documented response for this operation and status, applied to a real or fixture body. */
function validate(operationId, status, body) {
  const op = operations.get(operationId);
  assert.ok(op, `unknown operation ${operationId}`);
  const response = op.responses[String(status)];
  assert.ok(response, `${operationId}: undocumented status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  const check = compiled(response.content['application/json'].schema.$ref);
  assert.equal(check(body), true, `${operationId} ${status}: ${ajv.errorsText(check.errors)}: ${JSON.stringify(body).slice(0, 300)}`);
  if (body?.file) {
    const document = schema('PrivacyExportDocument');
    assert.equal(document(JSON.parse(body.file.text)), true, `${operationId}: the export document: ${ajv.errorsText(document.errors)}`);
  }
}
function validateRequest(operationId, body) {
  const ref = operations.get(operationId).requestBody?.content['application/json'].schema.$ref;
  assert.ok(ref, `${operationId} documents no request body`);
  const check = compiled(ref);
  assert.equal(check(body), true, `${operationId} request: ${ajv.errorsText(check.errors)}`);
}
/** The documented operation a call reaches, or null for a route this contract does not document. */
function operationFor(route, method) {
  for (const [id, op] of operations) if (op.path === route && op.method === method.toUpperCase()) return id;
  return null;
}

const FIXTURE_DIR = new URL('../docs/backend/contracts/fixtures/b07/', import.meta.url);
const WRITE_FIXTURES = process.argv.includes('--write-b07-fixtures');
const fixtures = existsSync(FIXTURE_DIR)
  ? await Promise.all(
    (await readdir(FIXTURE_DIR))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8')) })),
  )
  : [];

const EM_DASH = String.fromCharCode(0x2014);
/** On every B07 body: no top-level data key (runtime.ts:149-153 would unwrap it), no U+2014 literal or escaped. */
function assertBare(body, label) {
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), `${label}: an object body`);
  assert.equal(Object.hasOwn(body, 'data'), false, `${label}: no top-level data key (runtime.ts:149-153)`);
  const text = JSON.stringify(body);
  assert.equal(text.includes(EM_DASH), false, `${label}: no U+2014`);
  assert.equal(text.toLowerCase().includes('\\u2014'), false, `${label}: no escaped U+2014`);
}

const KEY = 'privacy-review-key-for-tests-only-0123456789';
const ENV = Object.freeze({ HALO_PRIVACY_REVIEW_KEY: KEY });
const NO_KEY = Object.freeze({ HALO_PRIVACY_REVIEW_KEY: '' });
const REQUEST_ID = 'b07-contract-0001';
const CREATED_AT = '2026-10-19T12:00:00.000Z';
const EXPIRES_AT = '2099-01-01T00:10:00.000Z';
const HOME_CONTEXT_HEADER = '0c0c0c0c-0000-4000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const NOTE = 'PRIVATE-NOTE-MARKER the inhaler is in the blue bag';
const BOB_TASK = 'BOB-TASK-MARKER fix the gutter';

/** The panel's sentences: its own (ProductionPrivacy.tsx:22-25) and the runtime's (runtime.ts:91-97). */
const SAY = Object.freeze({
  downloaded: 'Your export was downloaded.',
  notReady: 'The export is not ready to download. Check its status.',
  cleared: 'Your records were cleared.',
  journal: 'Journal cleared.',
  unchanged: 'The request was not applied. Your data is unchanged.',
  checking: 'The request is still being checked.',
  expired: 'This review expired or changed. Review again.',
  ...RUNTIME_MESSAGES,
});

// ---------------------------------------------------------------------------
// Header documentation, both ways (as B03 to B06), recorded by every call
// ---------------------------------------------------------------------------

const CHECKED_HEADERS = ['x-request-id', 'retry-after'];
const seenHeaders = new Map();
const documentedHeaders = (id, status) =>
  new Set(Object.keys(operations.get(id).responses[String(status)].headers ?? {}).map((name) => name.toLowerCase()));
function recordHeaders(id, res) {
  const key = `${id} ${res.status}`;
  const documented = documentedHeaders(id, res.status);
  if (!seenHeaders.has(key)) seenHeaders.set(key, new Set());
  for (const name of CHECKED_HEADERS) {
    if (res.headers.get(name) === null) continue;
    seenHeaders.get(key).add(name);
    assert.ok(documented.has(name), `${key}: the response sends ${name} but the contract does not document it`);
  }
}
const TRANSPORT = new Set(['authorization', 'content-type', 'x-request-id', 'accept']);
const sentHeaders = new Map();
const documentedParams = (id) =>
  new Set((operations.get(id).parameters ?? []).filter((p) => p.in === 'header').map((p) => p.name.toLowerCase()));
function recordRequestHeaders(id, headers) {
  if (!sentHeaders.has(id)) sentHeaders.set(id, new Set());
  for (const name of Object.keys(headers).map((h) => h.toLowerCase())) {
    if (TRANSPORT.has(name)) continue;
    sentHeaders.get(id).add(name);
    assert.ok(documentedParams(id).has(name), `${id}: the request sends ${name} but the contract does not document it`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures: the normalised answers of the real handlers in this file
// ---------------------------------------------------------------------------

/** A body with its ids renumbered in order of appearance, its instants and token fixed, and an export file's document normalised the same way. */
function normalized(body) {
  const ids = new Map();
  const walk = (value, key) => {
    if (typeof value === 'string') {
      if (key === 'reviewToken') return 'review-token';
      if (key === 'expiresAt') return EXPIRES_AT;
      if (key === 'name' && /^halo-export-\d{4}-\d{2}-\d{2}\.json$/.test(value)) return 'halo-export-2026-10-19.json';
      if (ISO.test(value)) return CREATED_AT;
      if (!UUID.test(value)) return value;
      const id = value.toLowerCase();
      if (!ids.has(id)) ids.set(id, `0b070000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
      return ids.get(id);
    }
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => {
        if (name === 'text' && typeof item === 'string' && item.startsWith('{')) return [name, JSON.stringify(walk(JSON.parse(item)), null, 2)];
        return [name, walk(item, name)];
      }));
    }
    return value;
  };
  return walk(body);
}

/** Every answer a contract operation gave in this file, in order. */
const answers = [];
/** A contract check that failed inside a call the client runtime made (it would read as a network failure). */
const violations = [];
afterEach(() => {
  if (violations.length) throw violations.splice(0)[0];
});
/** Fixture name -> the normalised answer a real handler gave. */
const produced = new Map();
/** Records the last answer of `operationId` (with `status`, when given) as the fixture `name`. */
function keep(name, operationId, status) {
  const found = [...answers].reverse().find((item) => item.operationId === operationId && (status === undefined || item.status === status));
  assert.ok(found, `${name}: no ${operationId} ${status ?? ''} answer to keep`);
  assert.equal(produced.has(name), false, `${name} is produced once`);
  produced.set(name, { operationId, status: found.status, body: normalized(found.body) });
  return found.body;
}

/**
 * Wraps h.call so that every call to a documented route is checked against
 * the contract and recorded: the request id is set (and echoed), the request
 * headers and body are documented, the status and body match the document,
 * the body is bare, and an error envelope carries nothing proof-bearing.
 */
function instrument(h) {
  const raw = h.call;
  h.call = async (route, method, options = {}) => {
    const id = operationFor(route, method);
    if (!id) return raw(route, method, options);
    try {
      return await checked(id, route, method, options);
    } catch (error) {
      // The client runtime turns any throw into its own failure code, so the real reason is kept for afterEach.
      violations.push(error);
      throw error;
    }
  };
  const checked = async (id, route, method, options) => {
    const headers = { 'x-request-id': REQUEST_ID, ...(options.headers ?? {}) };
    recordRequestHeaders(id, headers);
    const res = await raw(route, method, { ...options, headers });
    const text = await res.clone().text();
    let body;
    try { body = JSON.parse(text); } catch { assert.fail(`${id} ${res.status}: the body is JSON`); }
    assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${id}: the request id is echoed`);
    recordHeaders(id, res);
    validate(id, res.status, body);
    assertBare(body, `${id} ${res.status}`);
    const sent = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    // A test sends malformed bodies only where it expects the 400, 401 or 413.
    if (sent !== undefined && ![400, 401, 413].includes(res.status)) validateRequest(id, JSON.parse(sent));
    if (res.status >= 400) {
      assert.equal(body.request_id, REQUEST_ID);
      assert.equal(/supabase|postgres|PGRST|P0001|HALO_[A-Z]|XX000|contractsB07|bearer|privacy-review-key/i.test(text), false, `${id} ${res.status}: nothing proof-bearing in an error envelope`);
    }
    answers.push({ operationId: id, status: res.status, body });
    return res;
  };
  return h;
}

// ---------------------------------------------------------------------------
// The world: two households on PGlite
// ---------------------------------------------------------------------------

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name) => { assert.match(name, IDENT); return `"${name}"`; };
const PROFILE = { address: '1 Test Street', lat: 35.409, lng: -80.581, zip: '28025', county: 'Cabarrus County', pwsid: 'NC9990001', water_source: 'municipal', home_year: 1981, renter_mode: false, locale: 'en', state: 'NC' };
/** Every owned table but the ledger, which the routes reach on PGlite itself. */
const MIRRORED = Object.keys(OWNED_TABLES).filter((table) => table !== 'operations');
const ORDER = ['profiles', 'home_contexts', 'luna_conversations', 'luna_turns', ...MIRRORED].filter((table, at, all) => all.indexOf(table) === at);

function seedRows(table, owner, who) {
  if (table === 'profiles') return [];
  // Settled: a pending row of the household refuses clear all (busy).
  if (table === 'operations') return [{ ...OWNED_ROW.operations(owner), domain: 'settings', kind: 'settings.save', status: 'succeeded', result: { status: 'succeeded' } }];
  const row = OWNED_ROW[table](owner, 0);
  if (table === 'luna_runs') return [{ ...row, status: 'completed', settled_at: '2026-09-10T00:00:00Z' }];
  if (table === 'symptom_logs') return [{ ...row, note: NOTE }];
  if (table === 'household_actions' && who === 'bob') return [{ ...row, title: BOB_TASK }];
  if (table === 'alerts') return [row, { profile_id: owner, type: 'season_summary', title: 'Your fall summary', message: 'This fall you logged 3 days.', dedupe_key: 'season_summary:fall:2026' }];
  return [row];
}

async function insertRow(tx, table, row) {
  const columns = Object.keys(row);
  const values = Object.values(row).map((value) => (value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value));
  await tx.query(`insert into public.${ident(table)} (${columns.map(ident).join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`, values);
}

async function seedHousehold(owner, who) {
  await db.asService(async (tx) => {
    const sets = Object.keys(PROFILE).map((column, at) => `${ident(column)} = $${at + 2}`);
    await tx.query(`update public.profiles set ${sets.join(', ')} where id = $1`, [owner, ...Object.values(PROFILE)]);
    for (const table of ['home_contexts', 'luna_conversations', 'luna_turns', ...Object.keys(OWNED_TABLES)].filter((t, at, all) => all.indexOf(t) === at)) {
      for (const row of seedRows(table, owner, who)) await insertRow(tx, table, row);
    }
  }, { commit: true });
}

async function pgRows(table, owner) {
  const { rows } = await db.query(`select row_to_json(t) as row from public.${ident(table)} t where t.${ident(OWNED_TABLES[table])} = $1 order by row_to_json(t)::text`, [owner]);
  return rows.map((row) => row.row);
}

/** A byte-for-byte picture of a household: every owned table, and its auth.users row. */
async function picture(owner) {
  const out = {};
  for (const table of Object.keys(OWNED_TABLES)) out[table] = (await pgRows(table, owner)).map((row) => JSON.stringify(row));
  out['auth.users'] = (await db.query('select row_to_json(u)::text as row from auth.users u where u.id = $1', [owner])).rows.map((row) => row.row);
  return out;
}

const count = async (table, owner, where = '') =>
  (await db.query(`select count(*)::int as n from public.${ident(table)} where ${ident(OWNED_TABLES[table])} = $1 ${where}`, [owner])).rows[0].n;
const ledgerRow = async (operationId) =>
  (await db.query('select operation_id::text, profile_id::text, domain, kind, status, result, created_at from public.operations where operation_id = $1', [operationId])).rows[0] ?? null;

async function callByName(name, args) {
  assert.match(name, IDENT);
  const entries = Object.entries(args);
  for (const [arg] of entries) assert.match(arg, IDENT);
  try {
    return await db.asService(async (tx) => (await tx.query(
      `select public.${name}(${entries.map(([arg], at) => `${arg} => $${at + 1}`).join(', ')}) as data`,
      entries.map(([, value]) => value),
    )).rows[0].data, { commit: true });
  } catch (error) {
    throw rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);
  }
}

let worlds = 0;

/**
 * @param {{ onClear?: (args, call) => Promise<unknown> }} [options] wraps the
 *   real clear: a test can change the database first, or call through and
 *   then lose the answer.
 */
async function createWorld({ onClear } = {}) {
  worlds += 1;
  const alice = `${(0xa7700000 + worlds).toString(16)}-0000-4000-8000-00000000000a`;
  const bob = `${(0xb0700000 + worlds).toString(16)}-0000-4000-8000-00000000000b`;
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${alice}', true), ('${bob}', true);`);
  await seedHousehold(alice, 'alice');
  await seedHousehold(bob, 'bob');

  const state = { mode: 'fake', beforeRead: null, ledger: null, failRpc: null, limited: false };
  const tables = Object.fromEntries(Object.entries(HALO_TABLES).filter(([name]) => name !== 'operations'));
  const h = createRouteHarness({ tables, env: ENV, identities: { alice: { id: alice }, bob: { id: bob } }, rateLimit: () => !state.limited });
  const fakeFrom = h.db.from;
  h.db.from = (name) => {
    if (name === 'operations') {
      if (state.ledger) throw state.ledger;
      return pgliteLedger(db, name, h.db.queryLog);
    }
    if (state.mode !== 'pglite') return fakeFrom(name);
    const query = pgliteSelect(db, name, h.db.queryLog);
    if (state.beforeRead) {
      const hook = state.beforeRead;
      state.beforeRead = null;
      const then = query.then;
      query.then = (ok, fail) => hook(name).then(() => then.call(query, ok, fail), fail);
    }
    return query;
  };
  installSettingsDb(h.db);

  /** The fake's household tables become exactly what PGlite holds. Not logged: no route ran it. */
  const mirrorTables = async () => {
    const mark = h.db.queryLog.length;
    for (const owner of [alice, bob]) {
      for (const table of [...ORDER].reverse()) await fakeFrom(table).delete().eq(OWNED_TABLES[table], owner);
      for (const table of ORDER) {
        const rows = await pgRows(table, owner);
        if (rows.length) h.db.seed(table, rows);
      }
    }
    h.db.queryLog.splice(mark);
  };

  // The privacy routes and the reconcile read PGlite itself; every other route reads the mirror, refreshed first.
  const raw = h.call;
  h.call = async (route, method, options) => {
    const privacy = /^\/api\/(privacy|operations)(\/|$)/.test(route);
    if (!privacy) await mirrorTables();
    state.mode = privacy ? 'pglite' : 'fake';
    return raw(route, method, options);
  };
  instrument(h);

  const rpc = (name, params, run = (args) => callByName(name, args)) => h.db.registerRpc(name, async (args) => {
    if (state.failRpc?.name === name) throw state.failRpc.error;
    return run(args);
  }, { args: params });
  rpc('privacy_schema_version', []);
  rpc('privacy_fingerprint', ['p_profile_id', 'p_tables']);
  rpc('privacy_counts', ['p_profile_id', 'p_scope']);
  rpc('purge_privacy_receipts', ['p_profile_id']);
  rpc('clear_household_records', ['p_profile_id', 'p_operation_id', 'p_scope', 'p_fingerprint'],
    (args) => (onClear ? onClear(args, () => callByName('clear_household_records', args)) : callByName('clear_household_records', args)));

  const ids = { alice, bob };
  return {
    h, ids, alice, bob, state,
    /** The client runtime of `who`, recording what it sends (frontendB07.recordingRuntime). */
    runtime: (who = 'alice', options = {}) => fe.recordingRuntime(h, who, options),
    /** A panel of `who` whose status read has settled (a page load). */
    async panel(who = 'alice', { runtime: runtimeOptions = {}, ...options } = {}) {
      const runtime = fe.recordingRuntime(h, who, runtimeOptions);
      const panel = fe.privacyPanel(runtime, options);
      panel.runtime = runtime;
      return panel.load();
    },
    /** A review token as inspect would mint it now, over the household's current records. */
    async review(who = 'alice', { scope = 'all', groups = ['tasks'], privateText = false } = {}) {
      const owner = ids[who];
      const fingerprint = await callByName('privacy_fingerprint', { p_profile_id: owner, p_tables: fingerprintTables(scope, groups) });
      return mintReviewToken(KEY, { profileId: owner, scope, groups, privateText, fingerprint }).reviewToken;
    },
    /** POST a privacy mutation body as `as`, Idempotency-Key equal to its operationId unless `key` says otherwise. */
    post(route, body, { as = 'alice', key = body?.operationId, headers = {}, raw: rawBody, env } = {}) {
      return h.call(route, 'POST', {
        as, env,
        rawBody: rawBody ?? JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(key == null ? {} : { 'idempotency-key': key }), ...headers },
      });
    },
    read: (operationId, { as = 'alice', domain = 'privacy', env } = {}) =>
      h.call('/api/operations', 'GET', { as, env, url: `/api/operations?operationId=${operationId}&domain=${domain}` }),
    get: (route, as = 'alice', options = {}) => h.call(route, 'GET', { as, ...options }),
    picture: (who = 'alice') => picture(ids[who] ?? who),
    count: (table, who = 'alice', where = '') => count(table, ids[who], where),
    /** A ledger row as runOperation would have claimed it, written straight into PGlite. */
    async claim(who, { operationId = crypto.randomUUID(), kind = PRIVACY_KINDS.export, domain = 'privacy', status = 'pending', reviewToken = 'unused', scope = 'export', ageMs = 1_000, result = null } = {}) {
      await db.query(
        `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, result, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, now() - $8 * interval '1 millisecond', now() - $8 * interval '1 millisecond')`,
        [operationId, ids[who], domain, kind, status, requestHash({ reviewToken, scope }), result === null ? null : JSON.stringify(result), ageMs],
      );
      return operationId;
    },
  };
}

/** Large inbox alerts (alerts are not fingerprinted, P6), so an export of `home` passes the 4,000,000-byte cap. */
async function addLargeAlerts(owner) {
  await db.query(
    `insert into public.alerts (profile_id, type, title, message, dedupe_key)
     select $1, 'air_quality', 'Air', repeat('y', 900000), 'large-' || g from generate_series(1, 5) g`,
    [owner],
  );
}

const addSymptomLog = (owner, day = '2026-09-25') =>
  db.query('insert into public.symptom_logs (profile_id, entry_date, symptoms) values ($1, $2, $3)', [owner, day, ['sneeze']]);

const outage = (h) => { h.forceAuthOutage(); return () => h.forceAuthOutage('off'); };

/** Alice's picture equals `before`, the given ledger rows aside: nothing was deleted. */
async function assertUnchanged(w, beforePicture, ...operationIds) {
  const now = await w.picture('alice');
  now.operations = now.operations.filter((row) => !operationIds.includes(JSON.parse(row).operation_id));
  assert.deepEqual(now, beforePicture, 'nothing of alice\'s changed');
}

/** The view of a panel a scenario asserts on. */
const view = (panel) => ({
  verified: panel.verified,
  unknown: panel.state.unknown,
  message: panel.state.message,
  review: panel.state.review ? panel.state.review.scope : null,
  downloads: panel.state.downloads.length,
});

// ---------------------------------------------------------------------------
// The contract's own coverage
// ---------------------------------------------------------------------------

for (const fixture of fixtures) {
  test(`B07 fixture: ${fixture.name}`, () => {
    validate(fixture.operationId, fixture.status, fixture.body);
    assertBare(fixture.body, fixture.name);
  });
}

test('B07 contract covers the four built operations and the privacy half of operations.read, and every documented status has a fixture', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, 'b07-1');
  assert.deepEqual(Object.fromEntries([...operations].map(([id, op]) => [id, `${op.method} ${op.path} ${op['x-halo-operation']}`])), {
    privacyStatus: 'GET /api/privacy/status privacy.status',
    privacyInspect: 'POST /api/privacy/export/inspect privacy.inspect',
    privacyExport: 'POST /api/privacy/exports privacy.export',
    privacyClear: 'POST /api/privacy/clear privacy.clear',
    operationsRead: 'GET /api/operations operations.read',
  }, 'each names its path, method and frontend registry operation (runtime.ts:28,86-89)');
  for (const [id, op] of operations) {
    for (const status of Object.keys(op.responses)) {
      assert.ok(fixtures.some((item) => item.operationId === id && String(item.status) === status), `${id} is missing a ${status} fixture`);
    }
    for (const code of ['auth_unavailable', 'feature_unavailable']) {
      assert.ok(fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === code), `${id} is missing the ${code} fixture`);
    }
  }
  const named = (name) => fixtures.find((item) => item.name === `${name}.json`)?.body;
  assert.equal(JSON.stringify(named('privacyStatus-empty')), '{"unresolvedOperations":[]}', 'the exact empty state (trap P-1)');
  // Both export success shapes, on the route and on the reconcile (carry from Task 5).
  assert.ok(named('privacyExport-succeeded').file, 'an export success carries its file');
  assert.ok(named('operationsRead-export-succeeded').file, 'a reconcile inside the window carries the rebuilt file');
  assert.equal(Object.hasOwn(named('operationsRead-export-expired'), 'file'), false, 'after the window, succeeded without file');
  // A clear's success carries its scope (carry from Task 6), both scopes.
  assert.deepEqual(['all', 'journal'].map((scope) => named(`privacyClear-succeeded-${scope}`).scope), ['all', 'journal']);
  // Every 200 failed reason, every 409 reason, the in-flight 503.
  for (const reason of ['too_large', 'abandoned']) assert.ok(fixtures.some((item) => item.operationId === 'privacyExport' && item.status === 200 && item.body.reason === reason), `export failed ${reason}`);
  for (const reason of ['review_changed', 'busy', 'abandoned']) assert.ok(fixtures.some((item) => item.operationId === 'privacyClear' && item.status === 200 && item.body.reason === reason), `clear failed ${reason}`);
  for (const id of ['privacyExport', 'privacyClear']) {
    for (const reason of contract.components.schemas.ConflictEnvelope.properties.reason.enum) {
      assert.ok(fixtures.some((item) => item.operationId === id && item.status === 409 && item.body.reason === reason), `${id}: a ${reason} fixture`);
    }
    assert.ok(fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'upstream_unavailable' && item.body.retryable === true), `${id}: the in-flight 503`);
    const headers = Object.fromEntries(operations.get(id).parameters.filter((p) => p.in === 'header').map((p) => [p.name, p]));
    assert.equal(headers['Idempotency-Key']?.required, true);
    assert.equal(headers['Idempotency-Key'].schema.format, 'uuid');
  }
  for (const id of ['privacyStatus', 'privacyInspect', 'privacyExport', 'privacyClear', 'operationsRead']) {
    assert.match(operations.get(id).parameters.find((p) => p.name === 'X-Halo-Home-Context').description, /IGNORED/);
  }
  for (const [name, item] of Object.entries(contract.components.schemas)) {
    assert.equal(Object.hasOwn(item.properties ?? {}, 'data'), false, `${name} declares no data property`);
  }
  assert.equal(JSON.stringify(contract).includes(EM_DASH), false, 'no U+2014 anywhere in the document');
});

test('every registry path resolves to a route file with the declared method, maxDuration 60 and no U+2014', () => {
  for (const [operation, { path: route, method = 'GET' }] of Object.entries(fe.PRIVACY_OPERATIONS)) {
    const op = [...operations.values()].find((item) => item['x-halo-operation'] === operation);
    assert.ok(op, `${operation} is documented`);
    assert.deepEqual([op.path, op.method], [route, method], `${operation}: the client's path and method`);
    const file = path.join(REPO_ROOT, 'app', ...route.split('/').filter(Boolean), 'route.js');
    assert.ok(existsSync(file), `${route} has a route file`);
    const source = readFileSync(file, 'utf8');
    assert.match(source, new RegExp(`^export async function ${method}\\(`, 'm'), `${route} exports ${method}`);
    if (route !== '/api/operations') assert.match(source, /^export const maxDuration = 60;$/m, `${route}: maxDuration 60 (P17)`);
    assert.equal(source.includes(EM_DASH), false, `${route}: no U+2014 in server copy`);
  }
  for (const file of ['lib/privacyStore.js', 'lib/privacyExport.js', 'lib/privacyInventory.js', 'lib/privacyToken.js']) {
    assert.equal(readFileSync(path.join(REPO_ROOT, file), 'utf8').includes(EM_DASH), false, `${file}: no U+2014`);
  }
});

test('one table of privacy ledger kinds: the routes write PRIVACY_KINDS, and privacy.status maps each back to its scope', () => {
  assert.deepEqual(PRIVACY_KINDS, { export: 'privacy.export', journal: 'privacy.clear.journal', all: 'privacy.clear.all' });
  for (const [scope, kind] of Object.entries(PRIVACY_KINDS)) assert.equal(privacyScopeOfKind(kind), scope);
  for (const kind of ['privacy.inspect', 'privacy.clear', 'settings.save', '', null, undefined, 'constructor', '__proto__']) assert.equal(privacyScopeOfKind(kind), null, String(kind));
  const sources = ['app/api/privacy/status/route.js', 'app/api/privacy/exports/route.js', 'app/api/privacy/clear/route.js', 'app/api/operations/route.js', 'lib/privacyExport.js']
    .map((file) => readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  for (const source of sources) assert.equal(/'privacy\.(export|clear\.journal|clear\.all)'/.test(source), false, 'no route spells a privacy kind itself');
});

// ---------------------------------------------------------------------------
// The transcriptions: drift, and a negative control per function
// ---------------------------------------------------------------------------

test('drift: every transcribed line is still the client\'s own', () => {
  const component = readFileSync(path.join(REPO_ROOT, fe.COMPONENT), 'utf8').split('\n');
  for (const [name, line] of Object.entries(fe.CLIENT_LINES)) assert.ok(component.includes(line), `${name} changed in ${fe.COMPONENT}; re-transcribe it`);
  assert.ok(readFileSync(path.join(REPO_ROOT, fe.SETTINGS_COMPONENT), 'utf8').split('\n').includes(fe.BLOCKED_LINE), 'the settings gate (SettingsWorkspace.tsx:52) changed');
  const runtime = readFileSync(path.join(REPO_ROOT, fe.RUNTIME_FILE), 'utf8').split('\n');
  for (const line of fe.REGISTRY_LINES) assert.ok(runtime.includes(line), `${line.trim()} changed in runtime.ts`);
  const plain = fe.plainLines();
  for (const [name, line] of Object.entries(plain)) assert.equal(/:(string|Outcome|Review)\b|<[A-Z]\w*[<>,]/.test(line), false, `${name}: no TypeScript left after stripping`);
});

/** A runtime answering each operation from a table of [status, body], with a mutation's operationId taken from its Idempotency-Key. */
function cannedRuntime(table) {
  const h = {
    call: async (route, method, { url, headers = {} } = {}) => {
      const operation = Object.entries(fe.PRIVACY_OPERATIONS).find(([, entry]) => entry.path === route)?.[0];
      let entry = table[operation];
      if (typeof entry === 'function') entry = entry(url);
      if (!entry) return Response.json({ error: 'none', code: 'not_found' }, { status: 404 });
      const [status, body] = entry;
      const key = headers['Idempotency-Key'];
      const answer = key && body && typeof body === 'object' && 'operationId' in body ? { ...body, operationId: key } : body;
      return Response.json(answer, { status });
    },
  };
  return fe.recordingRuntime(h, 'alice');
}
const FRESH_REVIEW = () => [200, { reviewToken: 'review-token', expiresAt: new Date(Date.now() + 600_000).toISOString(), count: 3, preview: { scope: 'all' } }];
const EMPTY_STATUS = [200, { unresolvedOperations: [] }];
const FILE = { name: 'halo-export-2026-10-19.json', mime: 'application/json', text: '{"format":"halo-export-v1"}' };
const PARKED = '0b070000-0000-4000-8000-0000000000aa';

/**
 * One scenario per transcribed function, written once and run twice: on the
 * component's own lines (it must pass) and on a deliberately altered copy (it
 * must fail). Each alteration is the kind of edit that would break the panel.
 */
const CONTROLS = [
  {
    name: 'verified (:18)', line: 'verified', from: '.every(', to: '.some(',
    async run(lines) {
      const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': EMPTY_STATUS }), { lines }).load();
      assert.equal(panel.verified, true, 'an empty list is verified');
    },
  },
  {
    name: 'the lock effect (:19)', line: 'lock', from: '?.[0]', to: '?.[1]',
    async run(lines) {
      const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': [200, { unresolvedOperations: [{ operationId: PARKED, scope: 'export' }] }] }), { lines }).load();
      assert.deepEqual(panel.state.unknown, { id: PARKED, scope: 'export' }, 'locked on the first entry');
    },
  },
  {
    name: 'selected (:20)', line: 'selected', from: '{groups,privateText}', to: '{groups}',
    async run(lines) {
      const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': EMPTY_STATUS, 'privacy.inspect': FRESH_REVIEW() }), { lines }).load();
      await panel.inspect('export');
      assert.equal(panel.state.review.selection, JSON.stringify({ groups: ['tasks'], privateText: false }), 'the review remembers the whole selection');
    },
  },
  {
    name: 'inspect (:22)', line: 'inspect', from: '||Date.parse(data.expiresAt)<=Date.now()', to: '',
    async run(lines) {
      const expired = [200, { reviewToken: 'review-token', expiresAt: '2020-01-01T00:00:00.000Z', count: 3, preview: {} }];
      const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': EMPTY_STATUS, 'privacy.inspect': expired }), { lines }).load();
      await panel.inspect('export');
      assert.equal(panel.state.review, null, 'an expired review is refused');
    },
  },
  {
    name: 'accept (:23)', line: 'accept', from: 'downloadWeekFile(file.name,file.text,file.mime);', to: '',
    async run(lines) {
      const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': EMPTY_STATUS, 'privacy.inspect': FRESH_REVIEW(), 'privacy.export': [200, { operationId: PARKED, status: 'succeeded', file: FILE }] }), { lines }).load();
      await panel.inspect('export');
      await panel.confirm();
      assert.deepEqual([panel.state.downloads.length, panel.state.message], [1, SAY.downloaded], 'the file is downloaded');
    },
  },
  {
    name: 'confirm (:24)', line: 'confirm', from: "if(review.scope==='all'&&word!=='DELETE')return;", to: '',
    async run(lines) {
      const runtime = cannedRuntime({ 'privacy.status': EMPTY_STATUS, 'privacy.inspect': FRESH_REVIEW(), 'privacy.clear': [200, { operationId: PARKED, status: 'succeeded', scope: 'all' }] });
      const panel = await fe.privacyPanel(runtime, { lines }).load();
      await panel.inspect('all');
      await panel.confirm();
      assert.equal(runtime.sent.some((item) => item.operation === 'privacy.clear'), false, 'nothing is sent before DELETE is typed');
    },
  },
  {
    name: 'reconcile (:25)', line: 'reconcile', from: "domain:'privacy'", to: "domain:'settings'",
    async run(lines) {
      const read = (url) => (new URL(url, 'http://x').searchParams.get('domain') === 'privacy'
        ? [200, { operationId: PARKED, domain: 'privacy', kind: 'privacy.clear.all', status: 'succeeded', scope: 'all', created_at: CREATED_AT }]
        : [404, { code: 'not_found' }]);
      // The first status read lists the parked clear; the reload after a settled answer does not.
      let reads = 0;
      const status = () => [200, { unresolvedOperations: reads++ === 0 ? [{ operationId: PARKED, scope: 'all' }] : [] }];
      const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': status, 'operations.read': read }), { lines }).load();
      await panel.reconcile();
      assert.deepEqual([panel.state.message, panel.state.unknown], [SAY.cleared, null], 'the reconcile reads the privacy domain');
    },
  },
];

test('the transcriptions: each scenario passes on the component\'s lines and fails on a deliberately altered copy (a negative control per function)', async () => {
  for (const control of CONTROLS) {
    await control.run(fe.CLIENT_LINES);
    const original = fe.CLIENT_LINES[control.line];
    assert.ok(original.includes(control.from), `${control.name}: the alteration applies`);
    const altered = { ...fe.CLIENT_LINES, [control.line]: original.replace(control.from, control.to) };
    await assert.rejects(control.run(altered), assert.AssertionError, `${control.name}: an altered copy must fail its scenario`);
  }
  // SettingsWorkspace.tsx:52.
  const production = { loading: false, pending: false, unknown: null, snapshot: { revision: 1 } };
  assert.equal(fe.settingsBlocked(production), false, 'a verified snapshot leaves the panel enabled');
  assert.equal(fe.settingsBlocked({ ...production, snapshot: null }), true, 'no snapshot blocks it');
  assert.equal(fe.settingsBlocked({ ...production, unknown: 'parked' }), true, 'a parked settings save blocks it');
  assert.equal(fe.settingsBlocked(production, { line: fe.BLOCKED_LINE.replace('||!production.snapshot', '') }), false);
  assert.equal(fe.settingsBlocked({ ...production, snapshot: null }, { line: fe.BLOCKED_LINE.replace('||!production.snapshot', '') }), false, 'the altered gate no longer blocks, so the check above is the line\'s own');
});

// ---------------------------------------------------------------------------
// The client end to end, on the real handlers and the real database
// ---------------------------------------------------------------------------

test('a new household loads verified with no lock; Review export opens a review with the server\'s count', async () => {
  const w = await createWorld();
  const panel = await w.panel('alice', { runtime: { homeContextId: HOME_CONTEXT_HEADER } });
  keep('privacyStatus-empty', 'privacyStatus', 200);
  assert.deepEqual(panel.status.data, { unresolvedOperations: [] });
  assert.deepEqual(view(panel), { verified: true, unknown: null, message: '', review: null, downloads: 0 });

  await panel.inspect('export');
  const answer = keep('privacyInspect-export', 'privacyInspect', 200);
  // Without private text, the tasks group is the tasks and the non-private preference keys (P2).
  const expected = (await w.count('household_actions')) + (await w.count('household_action_preferences', 'alice', "and pref_key not in ('week:focus', 'outdoorPlan')"));
  assert.ok(expected > 0);
  assert.equal(panel.state.review.count, expected, 'the review shows the server\'s count, which is the rows of the selected group');
  assert.equal(answer.count, expected);
  assert.deepEqual(answer.preview.manifest.counts, { tasks: { household_actions: 1, household_action_preferences: 0 } }, 'the seeded preference is week:focus, private text');
  assert.equal(answer.preview.manifest.records, expected);
  assert.ok(!JSON.stringify(answer.preview).includes('Test task'), 'the preview names fields, not records (MP-388)');
  assert.deepEqual(panel.runtime.sent.at(-1).body, { scope: 'export', groups: ['tasks'], privateText: false }, 'what the panel sends');
  assert.equal(panel.state.review.selection, JSON.stringify({ groups: ['tasks'], privateText: false }));
  assert.equal(await w.count('operations', 'alice', "and domain = 'privacy'"), 0, 'no inspect writes a ledger row (trap P-2)');
  assert.deepEqual(w.h.blockedFetches, []);
});

test('inspect-to-export on PGlite: the panel downloads the real file, unlocks, and the ledger holds only the selection', async () => {
  const w = await createWorld();
  const panel = await w.panel('alice', { runtime: { homeContextId: HOME_CONTEXT_HEADER } });
  await panel.inspect('export');
  await panel.confirm();
  const answer = keep('privacyExport-succeeded', 'privacyExport', 200);
  assert.deepEqual(view(panel), { verified: true, unknown: null, message: SAY.downloaded, review: null, downloads: 1 });
  assert.equal(panel.state.statusRetries, 1, 'the panel reloads its status');
  const [download] = panel.state.downloads;
  assert.deepEqual(download, answer.file, 'what downloadWeekFile was given is the route\'s file');
  assert.match(download.name, /^halo-export-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(download.mime, 'application/json');
  const document = JSON.parse(download.text);
  assert.equal(document.format, 'halo-export-v1');
  assert.deepEqual(document.groups, ['tasks']);
  assert.equal(document.tasks.household_actions.length, 1);
  assert.ok(!download.text.includes(BOB_TASK) && !download.text.includes(w.bob), 'nothing of bob\'s (HO-066)');
  assert.ok(!download.text.includes(w.alice), 'no household identifier in the file (UI-146)');
  const sent = panel.runtime.sent.find((item) => item.operation === 'privacy.export');
  assert.deepEqual(Object.keys(sent.body).sort(), ['operationId', 'reviewToken', 'scope'], 'exactly the three keys');
  const row = await ledgerRow(sent.body.operationId);
  assert.deepEqual([row.kind, row.status], [PRIVACY_KINDS.export, 'succeeded']);
  assert.deepEqual(row.result, { operationId: sent.body.operationId, status: 'succeeded', scope: 'export', selection: { groups: ['tasks'], privateText: false } }, 'the minimal receipt, no file (trap P-8)');
  assert.deepEqual(w.h.blockedFetches, []);
});

test('a lost export answer reconciles to a download within the window; after it, the lock is kept with "not ready", and a reload unlocks', async () => {
  const w = await createWorld();
  let losing = true;
  const panel = await w.panel('alice', { runtime: { homeContextId: HOME_CONTEXT_HEADER, lose: (operation) => losing && operation === 'privacy.export' } });
  await panel.inspect('export');
  await panel.confirm();
  const id = panel.state.unknown?.id;
  assert.deepEqual(view(panel), { verified: true, unknown: { id, scope: 'export' }, message: SAY.unknown_outcome, review: 'export', downloads: 0 });
  losing = false;
  await panel.reconcile();
  keep('operationsRead-export-succeeded', 'operationsRead', 200);
  assert.deepEqual(view(panel), { verified: true, unknown: null, message: SAY.downloaded, review: null, downloads: 1 });
  assert.equal(JSON.parse(panel.state.downloads[0].text).format, 'halo-export-v1');

  // Again, but the reconcile comes eleven minutes later.
  losing = true;
  await panel.inspect('export');
  await panel.confirm();
  const late = panel.state.unknown.id;
  await db.query("update public.operations set created_at = now() - interval '11 minutes' where operation_id = $1", [late]);
  await panel.reconcile();
  keep('operationsRead-export-expired', 'operationsRead', 200);
  assert.deepEqual(view(panel), { verified: true, unknown: { id: late, scope: 'export' }, message: SAY.notReady, review: 'export', downloads: 1 }, 'the lock is kept');
  const reload = await w.panel('alice');
  assert.deepEqual(view(reload), { verified: true, unknown: null, message: '', review: null, downloads: 0 }, 'a fresh privacy.status unlocks: the settled row is not listed');
});

test('a real pending export, and a real pending clear, are listed by privacy.status with their scope, and lock a new page until reconciled', async () => {
  const w = await createWorld({
    onClear: async (_args, call) => {
      const other = await w.panel('alice');
      seen.clear = { unknown: other.state.unknown, verified: other.verified, entries: other.status.data.unresolvedOperations };
      seen.clearPanel = other;
      return call();
    },
  });
  const seen = {};
  // Export: while the real export's claim is pending (its first record read), a second page loads.
  const panel = await w.panel('alice');
  await panel.inspect('export');
  w.state.beforeRead = async () => {
    const other = await w.panel('alice');
    keep('privacyStatus-locked', 'privacyStatus', 200);
    seen.export = { unknown: other.state.unknown, verified: other.verified, entries: other.status.data.unresolvedOperations };
    // While locked, nothing new can be opened (ProductionPrivacy.tsx:22, `unknown`).
    const before = other.runtime.sent.length;
    await other.inspect('journal');
    seen.exportGuard = other.runtime.sent.length - before;
    seen.exportPanel = other;
  };
  await panel.confirm();
  const exportId = panel.runtime.sent.find((item) => item.operation === 'privacy.export').body.operationId;
  assert.deepEqual(seen.export.entries, [{ operationId: exportId, scope: 'export' }], 'the real claim is listed with scope export');
  assert.deepEqual(seen.export.unknown, { id: exportId, scope: 'export' });
  assert.equal(seen.export.verified, true);
  assert.equal(seen.exportGuard, 0, 'a locked panel sends no inspect');
  await seen.exportPanel.reconcile();
  assert.deepEqual(view(seen.exportPanel), { verified: true, unknown: null, message: SAY.downloaded, review: null, downloads: 1 }, 'reconciled: the file, and unlocked');

  // Clear all: the same, from inside the real clear's pending claim.
  const clearing = await w.panel('alice');
  await clearing.inspect('all');
  clearing.type('DELETE');
  await clearing.confirm();
  const clearId = clearing.runtime.sent.find((item) => item.operation === 'privacy.clear').body.operationId;
  assert.deepEqual(seen.clear.entries, [{ operationId: clearId, scope: 'all' }], 'the real claim is listed with scope all');
  assert.deepEqual(seen.clear.unknown, { id: clearId, scope: 'all' });
  assert.equal(clearing.state.message, SAY.cleared);
  await seen.clearPanel.reconcile();
  assert.deepEqual([seen.clearPanel.state.message, seen.clearPanel.state.unknown], [SAY.cleared, null], 'reconciled to the clear');
});

test('Clear Journal ends in "Journal cleared." and the database proves AC-282', async () => {
  const w = await createWorld();
  const tasksBefore = (await w.picture()).household_actions;
  const bobBefore = await w.picture('bob');
  const panel = await w.panel('alice', { runtime: { homeContextId: HOME_CONTEXT_HEADER } });
  await panel.inspect('journal');
  keep('privacyInspect-journal', 'privacyInspect', 200);
  assert.equal(panel.state.review.count, 2, 'the symptom log and the season summary');
  await panel.confirm();
  keep('privacyClear-succeeded-journal', 'privacyClear', 200);
  assert.deepEqual(view(panel), { verified: true, unknown: null, message: SAY.journal, review: null, downloads: 0 });
  assert.equal(Object.keys(panel.state.drafts).length, 2, 'Clear Journal keeps the local drafts');
  assert.equal(await w.count('symptom_logs'), 0);
  assert.equal(await w.count('alerts', 'alice', "and type = 'season_summary'"), 0);
  assert.equal(await w.count('alerts', 'alice', "and type <> 'season_summary'"), 1, 'the inbox alert stays');
  assert.deepEqual((await w.picture()).household_actions, tasksBefore, 'tasks unchanged');
  assert.equal(await w.count('daily_scores'), 1, 'readings unchanged');
  assert.deepEqual(await w.picture('bob'), bobBefore, 'bob untouched');
  assert.equal((await (await w.get('/api/profile')).json()).onboarded, true, 'still onboarded');
});

test('clear all ends in "Your records were cleared.", the settings gate still passes, and the household reads as not onboarded', async () => {
  const w = await createWorld();
  const gate = async () => {
    const prefs = productionPreferences(w.h, 'alice');
    await prefs.reload();
    return fe.settingsBlocked({ loading: false, pending: prefs.state.pending, unknown: prefs.unknown, snapshot: prefs.snapshot });
  };
  assert.equal(await gate(), false, 'the precondition: the panel is enabled');
  const bobBefore = await w.picture('bob');
  const panel = await w.panel('alice', { runtime: { homeContextId: HOME_CONTEXT_HEADER } });
  await panel.inspect('all');
  keep('privacyInspect-all', 'privacyInspect', 200);
  assert.ok(panel.state.review.count > 10);
  await panel.confirm();
  assert.equal(panel.runtime.sent.some((item) => item.operation === 'privacy.clear'), false, 'nothing is sent before DELETE is typed');
  panel.type('DELETE');
  await panel.confirm();
  keep('privacyClear-succeeded-all', 'privacyClear', 200);
  assert.deepEqual(view(panel), { verified: true, unknown: null, message: SAY.cleared, review: null, downloads: 0 });
  assert.deepEqual(panel.state.drafts, {}, 'clear all clears every local draft');
  assert.deepEqual([panel.state.workspaceRetries, panel.state.taskReloads, panel.state.statusRetries], [1, 1, 1]);

  assert.equal(await gate(), false, 'the settings gate still passes on the reset household');
  const settings = await (await w.get('/api/settings')).json();
  assert.equal(validSettingsSnapshot(settings), true);
  assert.equal((await (await w.get('/api/profile')).json()).onboarded, false, 'back through onboarding (D-P1)');
  for (const table of ['symptom_logs', 'household_actions', 'home_contexts', 'luna_turns', 'daily_scores', 'alerts']) assert.equal(await w.count(table), 0, `${table} cleared`);
  const clearId = panel.runtime.sent.find((item) => item.operation === 'privacy.clear').body.operationId;
  await w.read(clearId);
  keep('operationsRead-clear-succeeded', 'operationsRead', 200);
  assert.deepEqual(await w.picture('bob'), bobBefore, 'bob untouched');
  assert.equal(await w.count('profiles'), 1, 'the profile row survives, reset');
});

test('a lost clear answer reconciles to "Your records were cleared."; a reaped clear reconciles to "unchanged", and nothing changed', async (t) => {
  muteConsoleError(t);
  let mode = 'lose';
  const w = await createWorld({
    onClear: async (args, call) => {
      if (mode === 'lose') {
        await call();
        throw rpcError('', 'TypeError: fetch failed', null, null);
      }
      // The reaper settled the claim before the function ran.
      await db.query("update public.operations set status = 'failed', result = '{\"status\":\"failed\",\"reason\":\"abandoned\"}'::jsonb where operation_id = $1", [args.p_operation_id]);
      return call();
    },
  });
  const panel = await w.panel('alice');
  await panel.inspect('journal');
  await panel.confirm();
  keep('privacyClear-internal-error', 'privacyClear', 500);
  const lost = panel.state.unknown?.id;
  assert.deepEqual(view(panel), { verified: true, unknown: { id: lost, scope: 'journal' }, message: SAY.unknown_outcome, review: 'journal', downloads: 0 });
  assert.equal((await ledgerRow(lost)).status, 'succeeded', 'the clear committed and its row stays succeeded (P16)');
  await panel.reconcile();
  assert.deepEqual([panel.state.message, panel.state.unknown], [SAY.journal, null]);

  mode = 'reap';
  const beforeAll = await w.picture();
  const second = await w.panel('alice');
  await second.inspect('all');
  second.type('DELETE');
  await second.confirm();
  const reaped = second.state.unknown?.id;
  assert.equal(second.state.message, SAY.unknown_outcome);
  await second.reconcile();
  keep('operationsRead-failed', 'operationsRead', 200);
  assert.deepEqual([second.state.message, second.state.unknown], [SAY.unchanged, null]);
  await assertUnchanged(w, beforeAll, reaped);
});

test('a stale review gives the 409 message and leaves the review open; nothing is recorded', async () => {
  const w = await createWorld();
  const panel = await w.panel('alice');
  panel.choose(['journal']);
  await panel.inspect('export');
  await addSymptomLog(w.alice);
  await panel.confirm();
  keep('privacyExport-review-changed', 'privacyExport', 409);
  assert.deepEqual(view(panel), { verified: true, unknown: null, message: SAY.conflict, review: 'export', downloads: 0 });
  assert.equal(await w.count('operations', 'alice', "and domain = 'privacy'"), 0, 'no ledger row');

  await panel.inspect('journal');
  await addSymptomLog(w.alice, '2026-09-26');
  await panel.confirm();
  keep('privacyClear-review-changed', 'privacyClear', 409);
  assert.deepEqual(view(panel), { verified: true, unknown: null, message: SAY.conflict, review: 'journal', downloads: 0 });
  assert.equal(await w.count('symptom_logs'), 3, 'nothing deleted');
  // The selection changed under an open review: the client drops it itself, before sending.
  await panel.inspect('export');
  const sent = panel.runtime.sent.length;
  panel.state.groups = ['home'];
  await panel.confirm();
  assert.deepEqual([panel.state.message, panel.state.review, panel.runtime.sent.length], [SAY.expired, null, sent]);
});

// ---------------------------------------------------------------------------
// Every other answer each route gives, for the contract and its fixtures
// ---------------------------------------------------------------------------

test('privacy.status: unauthenticated, auth outage, no key, and a ledger failure', async (t) => {
  muteConsoleError(t);
  const w = await createWorld();
  await w.get('/api/privacy/status', null);
  keep('privacyStatus-unauthenticated', 'privacyStatus', 401);
  const restore = outage(w.h);
  await w.get('/api/privacy/status');
  keep('privacyStatus-auth-unavailable', 'privacyStatus', 503);
  restore();
  const noKey = await w.panel('alice', { runtime: { env: NO_KEY } });
  keep('privacyStatus-feature-unavailable', 'privacyStatus', 503);
  assert.deepEqual([noKey.verified, noKey.status.error], [false, SAY.unavailable], 'the panel reads "Privacy requests are unavailable." (its banner)');
  // Before 0024 (its probe is PGRST202): the same honest 503, on the status read and on every mutation, with nothing recorded.
  w.state.failRpc = { name: 'privacy_schema_version', error: rpcError('PGRST202', 'Could not find the function public.privacy_schema_version', null, null) };
  const before0024 = await w.panel('alice');
  assert.deepEqual([before0024.verified, answers.at(-1).status, answers.at(-1).body.code, answers.at(-1).body.retryable], [false, 503, 'feature_unavailable', false]);
  const token = await w.review('alice', { scope: 'journal', groups: [] });
  for (const [route, body] of [
    ['/api/privacy/export/inspect', { scope: 'export', groups: ['tasks'], privateText: false }],
    ['/api/privacy/exports', { reviewToken: await w.review('alice', { scope: 'export' }), scope: 'export', operationId: crypto.randomUUID() }],
    ['/api/privacy/clear', { reviewToken: token, scope: 'journal', operationId: crypto.randomUUID() }],
  ]) {
    const res = await w.post(route, body, { key: body.operationId ?? crypto.randomUUID() });
    assert.deepEqual([res.status, (await res.json()).code], [503, 'feature_unavailable'], route);
  }
  assert.equal(await w.count('operations', 'alice', "and domain = 'privacy'"), 0, 'nothing claimed before 0024');
  assert.equal(await w.count('symptom_logs'), 1, 'nothing cleared');
  w.state.failRpc = null;
  w.state.ledger = rpcError('XX000', 'contractsB07: boom', null, null);
  const broken = await w.panel('alice');
  keep('privacyStatus-internal-error', 'privacyStatus', 500);
  assert.equal(broken.verified, false);
});

test('privacy.inspect: every refusal, the too-large export, the limiter and a failed read', async (t) => {
  muteConsoleError(t);
  const w = await createWorld();
  const inspect = (body, options = {}) => w.post('/api/privacy/export/inspect', body, { key: crypto.randomUUID(), ...options });
  await inspect({ scope: 'export', groups: [], privateText: false });
  keep('privacyInspect-validation', 'privacyInspect', 400);
  await inspect({ scope: 'all', groups: [], privateText: false }, { headers: { 'if-match': '1' } });
  assert.equal(answers.at(-1).status, 400, 'any If-Match is a 400');
  await inspect(null, { as: null, raw: '{}' });
  keep('privacyInspect-unauthenticated', 'privacyInspect', 401);
  await inspect(null, { raw: JSON.stringify({ scope: 'export', groups: ['tasks'], privateText: false, pad: 'x'.repeat(3000) }) });
  keep('privacyInspect-payload-too-large', 'privacyInspect', 413);
  w.state.limited = true;
  await inspect({ scope: 'export', groups: ['tasks'], privateText: false });
  keep('privacyInspect-rate-limited', 'privacyInspect', 429);
  w.state.limited = false;
  const restore = outage(w.h);
  await inspect({ scope: 'export', groups: ['tasks'], privateText: false });
  keep('privacyInspect-auth-unavailable', 'privacyInspect', 503);
  restore();
  await inspect({ scope: 'export', groups: ['tasks'], privateText: false }, { env: NO_KEY });
  keep('privacyInspect-feature-unavailable', 'privacyInspect', 503);
  w.state.failRpc = { name: 'privacy_fingerprint', error: rpcError('XX000', 'contractsB07: boom', null, null) };
  await inspect({ scope: 'export', groups: ['tasks'], privateText: false });
  keep('privacyInspect-internal-error', 'privacyInspect', 500);
  w.state.failRpc = null;

  await addLargeAlerts(w.alice);
  const panel = await w.panel('alice');
  panel.choose(['home']);
  await panel.inspect('export');
  keep('privacyInspect-too-large', 'privacyInspect', 422);
  assert.deepEqual([panel.state.review, panel.state.message], [null, SAY.validation], 'no review, the client\'s validation sentence, no lock');
  assert.equal(await w.count('operations', 'alice', "and domain = 'privacy'"), 0, 'no inspect writes a ledger row (trap P-2)');
});

test('privacy.export: too large since review, replays (abandoned, in flight, mismatch), refusals, the limiter and an in-process failure', async (t) => {
  muteConsoleError(t);
  const w = await createWorld();
  const body = async (over = {}) => ({ reviewToken: await w.review('alice', { scope: 'export', groups: ['tasks'] }), scope: 'export', operationId: crypto.randomUUID(), ...over });
  const post = (value, options) => w.post('/api/privacy/exports', value, options);

  // Grown past the cap since the review (alerts are not fingerprinted, so the token still verifies).
  const panel = await w.panel('alice');
  panel.choose(['home']);
  await panel.inspect('export');
  await addLargeAlerts(w.alice);
  await panel.confirm();
  keep('privacyExport-too-large', 'privacyExport', 200);
  assert.deepEqual([panel.state.message, panel.state.unknown, panel.state.downloads.length], [SAY.unchanged, null, 0]);
  await db.query("delete from public.alerts where profile_id = $1 and dedupe_key like 'large-%'", [w.alice]);

  // A replay meeting a reaped claim, and one meeting a claim still running.
  const stale = await body();
  await w.claim('alice', { operationId: stale.operationId, reviewToken: stale.reviewToken, ageMs: 10 * 60 * 1000 });
  await post(stale);
  keep('privacyExport-abandoned', 'privacyExport', 200);
  const running = await body();
  await w.claim('alice', { operationId: running.operationId, reviewToken: running.reviewToken });
  await post(running);
  keep('privacyExport-in-flight', 'privacyExport', 503);
  await db.query("update public.operations set status = 'failed' where operation_id = $1", [running.operationId]);
  // The same id with a different, valid token.
  const first = await body();
  assert.equal((await post(first)).status, 200);
  await post(await body({ operationId: first.operationId }));
  keep('privacyExport-operation-mismatch', 'privacyExport', 409);

  // trap P-5: no confirmation word travels; an extra key is a 400 with nothing recorded.
  await post(await body({ confirm: 'DELETE' }));
  keep('privacyExport-validation', 'privacyExport', 400);
  await post(await body(), { headers: { 'if-match': '1' } });
  assert.equal(answers.at(-1).body.field_errors[0].code, 'precondition_unsupported', 'any If-Match is a 400');
  await post(await body(), { as: null });
  keep('privacyExport-unauthenticated', 'privacyExport', 401);
  const big = await body();
  await post(null, { key: big.operationId, raw: JSON.stringify({ ...big, reviewToken: 'x'.repeat(5000) }) });
  keep('privacyExport-payload-too-large', 'privacyExport', 413);
  w.state.limited = true;
  await post(await body());
  keep('privacyExport-rate-limited', 'privacyExport', 429);
  w.state.limited = false;
  const restore = outage(w.h);
  await post(await body());
  keep('privacyExport-auth-unavailable', 'privacyExport', 503);
  restore();
  await post(await body(), { env: NO_KEY });
  keep('privacyExport-feature-unavailable', 'privacyExport', 503);

  // A record read failing after the claim: 500, and the reconcile says unchanged (an export changes nothing).
  const failing = await w.panel('alice');
  await failing.inspect('export');
  w.state.beforeRead = async () => { throw rpcError('XX000', 'contractsB07: boom', null, null); };
  await failing.confirm();
  keep('privacyExport-internal-error', 'privacyExport', 500);
  assert.equal(failing.state.message, SAY.unknown_outcome);
  await failing.reconcile();
  assert.deepEqual([failing.state.message, failing.state.unknown], [SAY.unchanged, null]);
  assert.ok(await w.count('operations', 'alice', "and domain = 'privacy' and result::text like '%halo-export-v1%'") === 0, 'no receipt holds a file (trap P-8)');
});

test('privacy.clear: busy, a race, replays (abandoned, in flight, mismatch), refusals and availability', async (t) => {
  muteConsoleError(t);
  let race = false;
  const w = await createWorld({
    onClear: async (_args, call) => {
      if (race) { race = false; await addSymptomLog(w.alice, '2026-09-27'); }
      return call();
    },
  });
  const body = async (scope = 'journal', over = {}) => ({ reviewToken: await w.review('alice', { scope, groups: [] }), scope, operationId: crypto.randomUUID(), ...over });
  const post = (value, options) => w.post('/api/privacy/clear', value, options);

  // Busy: another request of the household is pending.
  const busyPanel = await w.panel('alice');
  await busyPanel.inspect('all');
  busyPanel.type('DELETE');
  const settings = await w.claim('alice', { domain: 'settings', kind: 'settings.save' });
  await busyPanel.confirm();
  keep('privacyClear-refused-busy', 'privacyClear', 200);
  assert.deepEqual([busyPanel.state.message, busyPanel.state.unknown], [SAY.unchanged, null]);
  await db.query("update public.operations set status = 'failed' where operation_id = $1", [settings]);

  // A race: a symptom log lands between the route's check and the function's.
  race = true;
  const racePanel = await w.panel('alice');
  await racePanel.inspect('journal');
  await racePanel.confirm();
  keep('privacyClear-refused-review-changed', 'privacyClear', 200);
  assert.deepEqual([racePanel.state.message, racePanel.state.unknown], [SAY.unchanged, null]);
  assert.ok(await w.count('symptom_logs') >= 2, 'nothing deleted');

  const stale = await body();
  await w.claim('alice', { operationId: stale.operationId, kind: PRIVACY_KINDS.journal, reviewToken: stale.reviewToken, scope: 'journal', ageMs: 10 * 60 * 1000 });
  await post(stale);
  keep('privacyClear-abandoned', 'privacyClear', 200);
  const running = await body();
  await w.claim('alice', { operationId: running.operationId, kind: PRIVACY_KINDS.journal, reviewToken: running.reviewToken, scope: 'journal' });
  await post(running);
  keep('privacyClear-in-flight', 'privacyClear', 503);
  await db.query("update public.operations set status = 'failed' where operation_id = $1", [running.operationId]);
  const first = await body();
  assert.equal((await post(first)).status, 200);
  await post(await body('journal', { operationId: first.operationId }));
  keep('privacyClear-operation-mismatch', 'privacyClear', 409);

  await post(await body('all', { confirm: 'DELETE' }));
  keep('privacyClear-validation', 'privacyClear', 400);
  await post(await body(), { headers: { 'if-match': '1' } });
  assert.equal(answers.at(-1).body.field_errors[0].code, 'precondition_unsupported', 'any If-Match is a 400');
  const journalToken = await body('journal');
  await post({ ...journalToken, scope: 'all' });
  assert.equal(answers.at(-1).status, 400, 'a journal token sent for all is a 400');
  await post(await body(), { as: null });
  keep('privacyClear-unauthenticated', 'privacyClear', 401);
  const big = await body();
  await post(null, { key: big.operationId, raw: JSON.stringify({ ...big, reviewToken: 'x'.repeat(5000) }) });
  keep('privacyClear-payload-too-large', 'privacyClear', 413);
  const restore = outage(w.h);
  await post(await body());
  keep('privacyClear-auth-unavailable', 'privacyClear', 503);
  restore();
  await post(await body(), { env: NO_KEY });
  keep('privacyClear-feature-unavailable', 'privacyClear', 503);
});

test('operations.read for privacy: pending, a bad id, unauthenticated, not found, the rebuild limiter, the ledger missing and failing', async (t) => {
  muteConsoleError(t);
  const w = await createWorld();
  const pending = await w.claim('alice', { kind: PRIVACY_KINDS.all, scope: 'all' });
  const parked = await fe.privacyPanel(w.runtime('alice'), {}).load();
  assert.deepEqual(parked.state.unknown, { id: pending, scope: 'all' });
  await parked.reconcile();
  keep('operationsRead-pending', 'operationsRead', 200);
  assert.deepEqual([parked.state.message, parked.state.unknown], [SAY.checking, { id: pending, scope: 'all' }], 'still locked');
  await w.read('not-a-uuid');
  keep('operationsRead-validation', 'operationsRead', 400);
  await w.read(pending, { as: null });
  keep('operationsRead-unauthenticated', 'operationsRead', 401);
  await w.read(pending, { as: 'bob' });
  keep('operationsRead-not-found', 'operationsRead', 404);
  assert.equal(answers.at(-1).body.message, 'That request was not found.', 'another household\'s id says nothing about whose it is');

  const panel = await w.panel('bob');
  await panel.inspect('export');
  await panel.confirm();
  const exported = panel.runtime.sent.find((item) => item.operation === 'privacy.export').body.operationId;
  w.state.limited = true;
  await w.read(exported, { as: 'bob' });
  keep('operationsRead-rate-limited', 'operationsRead', 429);
  w.state.limited = false;
  const restore = outage(w.h);
  await w.read(pending);
  keep('operationsRead-auth-unavailable', 'operationsRead', 503);
  restore();
  w.state.ledger = rpcError('PGRST205', 'Could not find the table public.operations in the schema cache', null, null);
  await w.read(pending);
  keep('operationsRead-feature-unavailable', 'operationsRead', 503);
  w.state.ledger = rpcError('XX000', 'contractsB07: boom', null, null);
  await w.read(pending);
  keep('operationsRead-internal-error', 'operationsRead', 500);
});

// ---------------------------------------------------------------------------
// Every fixture through the client, and the fixtures against the handlers
// ---------------------------------------------------------------------------

/**
 * What the panel does with a fixture's answer: the status read, an inspect,
 * a confirm of the fixture's scope, or a reconcile of its operation, each on
 * a canned runtime that answers with the fixture.
 */
async function consequence(fixture) {
  const { operationId: id, status, body } = fixture;
  const answer = [status, body];
  if (id === 'privacyStatus') return fe.privacyPanel(cannedRuntime({ 'privacy.status': answer })).load();
  if (id === 'privacyInspect') {
    const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': EMPTY_STATUS, 'privacy.inspect': answer })).load();
    return panel.inspect('export');
  }
  if (id === 'operationsRead') {
    const scope = privacyScopeOfKind(body.kind) ?? 'export';
    const parked = body.operationId ?? PARKED;
    // The page load lists the parked operation; the reload after a settled answer no longer does.
    let reads = 0;
    const status = () => [200, { unresolvedOperations: reads++ === 0 ? [{ operationId: parked, scope }] : [] }];
    const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': status, 'operations.read': answer })).load();
    return panel.reconcile();
  }
  const scope = id === 'privacyExport' ? 'export' : body.scope ?? 'all';
  const panel = await fe.privacyPanel(cannedRuntime({ 'privacy.status': EMPTY_STATUS, 'privacy.inspect': FRESH_REVIEW(), [id === 'privacyExport' ? 'privacy.export' : 'privacy.clear']: answer })).load();
  await panel.inspect(scope);
  panel.type('DELETE');
  return panel.confirm();
}

/** The sentence the contract says the panel shows for a failure status (runtime.ts:144). */
function failureSentence(status, mutation) {
  if (status === 401) return SAY.session;
  if (status === 409) return SAY.conflict;
  if (status === 400 || status === 422) return SAY.validation;
  if (status === 429) return SAY.rate_limited;
  if (status >= 500 && mutation) return SAY.unknown_outcome;
  return SAY.unavailable;
}

test('every fixture has the consequence in the client that the contract says it has', async () => {
  assert.ok(fixtures.length > 0 || WRITE_FIXTURES, 'fixtures exist');
  for (const fixture of fixtures) {
    const panel = await consequence(fixture);
    const { operationId: id, status, body } = fixture;
    const label = fixture.name;
    if (id === 'privacyStatus') {
      assert.equal(panel.verified, status === 200, `${label}: verified`);
      if (status === 200) assert.deepEqual(panel.state.unknown, body.unresolvedOperations[0] ? { id: body.unresolvedOperations[0].operationId, scope: body.unresolvedOperations[0].scope } : null, `${label}: the lock`);
      else assert.equal(panel.status.error, failureSentence(status, false), `${label}: the banner's cause`);
    } else if (id === 'privacyInspect') {
      if (status === 200) assert.equal(panel.state.review?.count, body.count, `${label}: the review opens with the count`);
      // Inspect writes nothing (P-2), so a 5xx on it is a review that was not prepared, never an outcome to check (release QA 2026-10-25).
      else assert.deepEqual([panel.state.review, panel.state.message, panel.state.unknown], [null, status >= 500 ? 'The review could not be prepared. Nothing was changed. Try again.' : failureSentence(status, true), null], `${label}: no review, no lock`);
    } else if (id === 'operationsRead') {
      const expected = status !== 200 ? failureSentence(status, false)
        : body.status === 'failed' ? SAY.unchanged
          : body.status !== 'succeeded' ? SAY.checking
            : body.kind === PRIVACY_KINDS.export ? (body.file ? SAY.downloaded : SAY.notReady)
              : body.scope === 'journal' ? SAY.journal : SAY.cleared;
      assert.equal(panel.state.message, expected, `${label}: the reconcile's sentence`);
      const unlocked = status === 200 && (body.status === 'failed' || (body.status === 'succeeded' && (body.kind !== PRIVACY_KINDS.export || !!body.file)));
      assert.equal(panel.state.unknown === null, unlocked, `${label}: unlocked only when the outcome is known`);
    } else {
      const expected = status !== 200 ? failureSentence(status, true)
        : body.status === 'failed' ? SAY.unchanged
          : id === 'privacyExport' ? SAY.downloaded : body.scope === 'journal' ? SAY.journal : SAY.cleared;
      assert.equal(panel.state.message, expected, `${label}: the confirm's sentence`);
      assert.equal(panel.state.unknown !== null, status >= 500, `${label}: locked exactly on a 5xx (unknown outcome)`);
      assert.equal(panel.state.review === null, status === 200 && body.status === 'succeeded', `${label}: the review closes only on success`);
      assert.equal(panel.state.downloads.length, status === 200 && body.file ? 1 : 0, `${label}: a download only with a file`);
    }
  }
});

test('every fixture is the normalised answer of a real handler in this file, and every answer recorded as one has a fixture', async () => {
  if (WRITE_FIXTURES) {
    for (const [name, value] of produced) {
      await writeFile(new URL(`${name}.json`, FIXTURE_DIR), `${JSON.stringify(value, null, 2)}\n`);
    }
    return;
  }
  const names = new Set(fixtures.map((item) => item.name.replace(/\.json$/, '')));
  assert.deepEqual([...names].sort(), [...produced.keys()].sort(), 'the fixture set is the produced set');
  for (const fixture of fixtures) {
    const { name, ...stored } = fixture;
    assert.deepEqual(stored, produced.get(name.replace(/\.json$/, '')), `${name} is what the handler answers today`);
  }
});

test('no B07 fixture carries a secret, a token, an email, a database detail or a real address', () => {
  const forbidden = [
    /\bsk-[A-Za-z0-9]/, /Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/, /api[_-]?key/i, /secret/i, /password/i, /authorization/i,
    /supabase|upstash|openrouter|openai|mapbox|postgres|PGRST|HALO_[A-Z]/i,
    /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/,
    /https?:\/\//, /@/, /privacy-review-key/, /p256dh|fcm\.googleapis/,
  ];
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture.body);
    for (const pattern of forbidden) assert.equal(pattern.test(serialized), false, `${fixture.name} matches ${pattern}`);
    assert.ok([REQUEST_ID, undefined].includes(fixture.body.request_id), `${fixture.name}: a synthetic request id`);
    for (const id of serialized.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) {
      assert.ok(id.startsWith('0b070000-0000-4000-8000-'), `${fixture.name}: ${id} is synthetic`);
    }
    if (fixture.body.reviewToken !== undefined) assert.equal(fixture.body.reviewToken, 'review-token', `${fixture.name}: the token is a placeholder`);
  }
});

// ---------------------------------------------------------------------------
// Header documentation, both ways. Runs last: tests in one file run in order.
// ---------------------------------------------------------------------------

test('B07 contract headers: every documented response header is really sent, for the pairs these tests exercise', () => {
  assert.ok(seenHeaders.size > 0, 'no conformance responses were recorded');
  for (const [key, seen] of seenHeaders) {
    const [id, status] = key.split(' ');
    for (const name of documentedHeaders(id, status)) {
      if (CHECKED_HEADERS.includes(name)) assert.ok(seen.has(name), `${key}: the contract documents ${name} but no exercised response sent it`);
    }
  }
});

test('B07 contract headers: every documented request header was sent by an exercised request', () => {
  for (const id of operations.keys()) {
    for (const name of documentedParams(id)) {
      assert.ok(sentHeaders.get(id)?.has(name), `${id}: the contract documents the ${name} header but no exercised request sent it`);
    }
  }
});
