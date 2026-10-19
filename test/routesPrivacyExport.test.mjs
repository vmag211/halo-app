/**
 * POST /api/privacy/exports (`privacy.export`) and the export overlay of
 * GET /api/operations, B07 plan, Task 5; Rulings P6, P8, P9, P15 and P17,
 * traps P-4 and P-8.
 *
 * Every answer is fed to the client's OWN consumption: `accept`
 * (ProductionPrivacy.tsx:23), transcribed verbatim in
 * test/helpers/privacyClearClient.mjs with `downloadWeekFile` recording what
 * it was given, `confirm`'s catch (:24) and `reconcile` (:25), through the
 * runtime's status mapping and envelope unwrap. Each scenario ends in what the
 * panel shows: the message, the lock (`unknown`), the review, the download.
 *
 * Reviews are opened by the real inspect route where they can be, so the
 * export verifies the tokens inspect really mints. The 0024 functions are
 * stand-ins registered by argument name (as in routesPrivacyInspect): the
 * probe, and a fingerprint over the household's fake rows in the tables named.
 *
 * Trap P-8 is checked after EVERY scenario (`scenario` below): no privacy
 * ledger row may hold a file, a row value, a title, a note, a coordinate or
 * an email, and a succeeded export's stored result is exactly the minimal
 * receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, muteConsoleError, LIMITER_UNAVAILABLE } from './helpers/routeHarness.mjs';
import { HALO_TABLES } from './helpers/tables.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { pgError } from './helpers/fakeTable.mjs';
import { entryId, markersOf, seedHouseholds } from './helpers/isolationSeed.mjs';
import { ACCEPT_SIGNATURE, ACCEPT_SOURCE, COMPONENT, MESSAGES, privacyPanel } from './helpers/privacyClearClient.mjs';

const { requestHash } = await import('../lib/operations.js');
const { mintReviewToken, REVIEW_TOKEN_TTL_MS } = await import('../lib/privacyToken.js');
const { EXPORT_GROUPS, fingerprintTables } = await import('../lib/privacyInventory.js');
const {
  EXPORT_MAX_RESPONSE_BYTES, EXPORT_REBUILD_WINDOW_MS, buildExportDocument, responseBytes, withExportFile, storedExportSelection,
  withinRebuildWindow,
} = await import('../lib/privacyExport.js');

const ROUTE = '/api/privacy/exports';
const INSPECT = '/api/privacy/export/inspect';
const OPERATIONS = '/api/operations';
const ROUTE_FILE = path.join(REPO_ROOT, 'app/api/privacy/exports/route.js');
const KEY = 'privacy-review-key-for-tests-only-0123456789';
const ENV = Object.freeze({ HALO_PRIVACY_REVIEW_KEY: KEY });
const CONFIRMED = '2026-10-01T12:00:00Z';
const EM_DASH = String.fromCharCode(0x2014);
const MINUTE = 60 * 1000;
const NAME_RULE = /^halo[-\w]*\.(json|csv)$/;

/** Every body this file receives, for the closing U+2014 and `data` checks. */
const bodies = [];

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** privacy_fingerprint stand-in: the household's rows of the listed tables, order-free. */
function fakeFingerprint(db, profileId, tables) {
  const owners = { profiles: 'id' };
  const parts = tables.map((table) => {
    const owner = owners[table] ?? 'profile_id';
    let stored;
    try { stored = db.rows(table); } catch { stored = []; }
    return `${table}:${stored.filter((row) => row[owner] === profileId).map((row) => sha(JSON.stringify(row))).sort().join(',')}`;
  });
  return sha(parts.join('|'));
}

function harness({ adjust, rateLimit, env = ENV, version = 1 } = {}) {
  const h = createRouteHarness({
    tables: HALO_TABLES,
    env,
    rateLimit,
    identities: { alice: { emailConfirmedAt: CONFIRMED }, bob: { emailConfirmedAt: CONFIRMED } },
    seed: (identities) => {
      const rows = seedHouseholds(identities, { adjust });
      return Object.fromEntries(Object.entries(rows).filter(([name]) => name in HALO_TABLES));
    },
  });
  if (version !== null) h.db.registerRpc('privacy_schema_version', () => version, { args: [] });
  h.db.registerRpc('privacy_fingerprint', ({ p_profile_id, p_tables }, db) => fakeFingerprint(db, p_profile_id, p_tables), { args: ['p_profile_id', 'p_tables'] });
  return h;
}

/** Content no privacy ledger row may hold (trap P-8): alice's and bob's markers, emails, rounded coordinates. */
function forbidden(h) {
  const out = [];
  for (const who of ['alice', 'bob']) {
    const identity = h.identities[who];
    out.push(...markersOf(who, identity).filter((marker) => marker !== identity.id), identity.email);
    const profile = h.db.rows('profiles').find((row) => row.id === identity.id);
    for (const value of [profile?.lat, profile?.lng]) if (typeof value === 'number') out.push(String(Math.round(value * 1000) / 1000));
  }
  return out.filter((marker) => typeof marker === 'string' && marker.length > 3);
}

const MINIMAL_KEYS = new Set(['operationId', 'status', 'scope', 'selection', 'reason']);

/** Trap P-8, after every scenario: privacy receipts are minimal, and carry no file and no record content. */
function assertNoContent(h) {
  const markers = forbidden(h);
  for (const row of h.db.rows('operations').filter((item) => item.domain === 'privacy')) {
    const text = JSON.stringify(row.result ?? null);
    for (const marker of markers) assert.ok(!text.includes(marker), `a privacy receipt holds record content (${marker.slice(0, 24)})`);
    assert.ok(!/"file"|"text"|"mime"|halo-export-v1|"manifest"/.test(text), 'a privacy receipt holds a file');
    if (!row.result) continue;
    for (const key of Object.keys(row.result)) assert.ok(MINIMAL_KEYS.has(key), `a privacy receipt holds ${key}`);
    if (row.kind === 'privacy.export' && row.status === 'succeeded') {
      const { groups, privateText } = row.result.selection;
      assert.deepEqual(row.result, { operationId: row.operation_id, status: 'succeeded', scope: 'export', selection: { groups, privateText } });
      assert.deepEqual(storedExportSelection(row.result.selection), { groups, privateText });
    }
  }
}

/** A test whose harnesses are all checked for trap P-8 when it ends. */
function scenario(name, fn) {
  test(name, async (t) => {
    const worlds = [];
    const make = (options) => { const h = harness(options); worlds.push(h); return h; };
    await fn(t, make);
    for (const h of worlds) assertNoContent(h);
  });
}

/** A review token from the real inspect route. */
async function inspected(h, { as = 'alice', groups = ['tasks'], privateText = false } = {}) {
  const response = await h.call(INSPECT, 'POST', { as, body: { scope: 'export', groups, privateText }, headers: { 'idempotency-key': crypto.randomUUID() } });
  assert.equal(response.status, 200, 'inspect opened the review');
  return (await response.json()).reviewToken;
}

/** A token minted directly, as inspect would have at `now`. */
function minted(h, { who = 'alice', scope = 'export', groups = ['tasks'], privateText = false, now } = {}) {
  const profileId = h.identities[who].id;
  const fingerprint = fakeFingerprint(h.db, profileId, fingerprintTables(scope, groups));
  return mintReviewToken(KEY, { profileId, scope, groups, privateText, fingerprint, now }).reviewToken;
}

/** POST as `as`: the body as JSON (or `raw`), Idempotency-Key equal to its operationId unless `key` says otherwise. */
async function send(h, body, { as = 'alice', key = body?.operationId, headers = {}, raw } = {}) {
  const response = await h.call(ROUTE, 'POST', {
    as,
    rawBody: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(key == null ? {} : { 'idempotency-key': key }), ...headers },
  });
  bodies.push(await response.clone().text());
  return response;
}

const exportBody = (reviewToken, over = {}) => ({ reviewToken, scope: 'export', operationId: crypto.randomUUID(), ...over });

/** reconcile's request (:25): operations.read for the parked id, domain privacy. */
const reader = (h, as = 'alice') => async (id) => {
  const response = await h.call(OPERATIONS, 'GET', { as, url: `${OPERATIONS}?operationId=${id}&domain=privacy` });
  bodies.push(await response.clone().text());
  return response;
};

/** A panel holding an export review, as confirm sees it. */
const exportPanel = () => { const panel = privacyPanel(); panel.review = { scope: 'export' }; return panel; };

/** The answer was lost on the way back (a gateway timeout): confirm parks the id. */
const lost = async (panel, id) => panel.answer(new Response('', { status: 504 }), 'export', id);

const privacyRows = (h) => h.db.rows('operations').filter((row) => row.domain === 'privacy');
const ledgerWrites = (h, from = 0) => h.db.queryLog.slice(from).filter((q) => q.table === 'operations' && q.operation !== 'select');
const ago = (ms) => new Date(Date.now() - ms).toISOString();

async function backdate(h, operationId, ms) {
  const { error } = await h.db.from('operations').update({ created_at: ago(ms) }).eq('operation_id', operationId);
  assert.equal(error, null);
}

/** Reads of a table by anyone since `from`: how many export builds touched it. */
const readsOf = (h, table, from = 0) => h.db.queryLog.slice(from).filter((q) => q.table === table && q.operation === 'select').length;

/** What a downloaded file holds. */
function downloaded(panel) {
  assert.equal(panel.downloads.length, 1, 'one file was downloaded');
  const [file] = panel.downloads;
  assert.equal(file.mime, 'application/json');
  assert.ok(NAME_RULE.test(file.name), file.name);
  assert.ok(typeof file.text === 'string' && file.text.length <= 10 * 1024 * 1024);
  const document = JSON.parse(file.text);
  assert.equal(document.format, 'halo-export-v1');
  return { file, document };
}

// ---------------------------------------------------------------------------
// The transcription
// ---------------------------------------------------------------------------

test('the client lines this suite runs are the component\'s and the runtime\'s own (drift)', () => {
  const component = readFileSync(path.join(REPO_ROOT, COMPONENT), 'utf8');
  const lines = component.split('\n');
  const accept = lines.filter((line) => line.trim().startsWith('function accept('));
  assert.equal(accept.length, 1);
  assert.equal(accept[0].trim().replace(ACCEPT_SIGNATURE.typed, ACCEPT_SIGNATURE.plain), ACCEPT_SOURCE);
  // confirm (:24) sends exactly the three keys, with the id as the Idempotency-Key, and hands the answer to accept.
  assert.ok(lines[23].includes("const value=await runtime.request<Outcome>(review.scope==='export'?'privacy.export':'privacy.clear',{reviewToken:review.reviewToken,scope:review.scope,operationId:id},{idempotencyKey:id});accept(value,review.scope,id);"));
  assert.ok(lines[23].includes("catch(e){if(e instanceof FrontendServiceError&&e.code==='unknown_outcome')setUnknown({id,scope:review.scope});setMessage(serviceMessage(e));}"));
  // reconcile (:25) reads the parked id in the privacy domain and hands the answer to the same accept.
  assert.ok(lines[24].includes("accept(await runtime.request<Outcome>('operations.read',{operationId:unknown.id,domain:'privacy'}),unknown.scope,unknown.id);"));
  // downloadWeekFile is the week helper, which saves the text as a Blob of exactly that type.
  assert.ok(component.includes("import {downloadWeekFile} from '@/lib/frontend/week-preview';"));
  const week = readFileSync(path.join(REPO_ROOT, 'lib/frontend/week-preview.ts'), 'utf8');
  assert.ok(week.includes('export function downloadWeekFile(name:string,content:string,type:string){const url=URL.createObjectURL(new Blob([content],{type}));'));
  const runtime = readFileSync(path.join(REPO_ROOT, 'lib/frontend/production/runtime.ts'), 'utf8');
  assert.ok(runtime.includes("'privacy.export': {path:'/api/privacy/exports',method:'POST'},"));
  assert.ok(runtime.includes("'operations.read': {path:'/api/operations'},"));
});

test('the transcribed accept refuses a succeeded export without a valid file, as the client does (self-check)', () => {
  const id = crypto.randomUUID();
  const good = { name: 'halo-export-2026-10-19.json', mime: 'application/json', text: '{}' };
  for (const file of [undefined, { ...good, mime: 'application/json; charset=utf-8' }, { ...good, name: 'halo export.json' }, { ...good, text: 1 }]) {
    const panel = exportPanel();
    panel.accept({ operationId: id, status: 'succeeded', file }, 'export', id);
    assert.deepEqual([panel.message, panel.unknown, panel.downloads.length], [MESSAGES.notReady, { id, scope: 'export' }, 0]);
  }
  const panel = exportPanel();
  panel.accept({ operationId: id, status: 'succeeded', file: good }, 'export', id);
  assert.deepEqual([panel.message, panel.unknown, panel.downloads], [MESSAGES.downloaded, null, [good]]);
});

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

scenario('inspect then export: the panel downloads the file, and the ledger holds only the minimal receipt (trap P-8)', async (_t, make) => {
  const keys = [];
  const h = make({ rateLimit: (key) => { keys.push(key); return true; } });
  const { alice, bob } = h.identities;
  const reviewToken = await inspected(h, { groups: [...EXPORT_GROUPS], privateText: true });
  const body = exportBody(reviewToken);
  const from = h.db.queryLog.length;
  const response = await send(h, body, { headers: { 'x-halo-home-context': crypto.randomUUID() } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const answer = await response.clone().json();
  assert.deepEqual(Object.keys(answer).sort(), ['file', 'operationId', 'status'], 'no data key, no unresolvedOperations');
  assert.equal(answer.file.mime, 'application/json', 'exactly, no charset suffix');
  assert.ok(responseBytes(answer) <= EXPORT_MAX_RESPONSE_BYTES);

  const panel = exportPanel();
  await panel.answer(response, 'export', body.operationId);
  const { file, document } = downloaded(panel);
  assert.deepEqual([panel.message, panel.unknown, panel.review, panel.statusRetries], [MESSAGES.downloaded, null, null, 1]);
  assert.equal(file.name, answer.file.name);
  for (const identifier of [alice.id, alice.email, bob.id]) assert.ok(!file.name.includes(identifier), 'the name names no household');
  assert.deepEqual(document.groups, [...EXPORT_GROUPS]);
  assert.equal(document.privateText, true);
  assert.ok(file.text.includes('ALICE-NOTE-MARKER'), 'the private text that was reviewed is in the file');
  for (const marker of markersOf('bob', bob)) assert.ok(!file.text.includes(marker), `bob's ${marker} reached alice's export`);

  const rows = privacyRows(h);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].profile_id, rows[0].kind, rows[0].status], [alice.id, 'privacy.export', 'succeeded']);
  assert.deepEqual(rows[0].result, {
    operationId: body.operationId, status: 'succeeded', scope: 'export', selection: { groups: [...EXPORT_GROUPS].sort(), privateText: true },
  });
  assert.ok(!JSON.stringify(rows[0]).includes(reviewToken), 'the token is hashed into request_hash, never stored');
  // Every statement is the verified caller's (the ledger's settle by its own claimed id aside).
  auditOwnerScope(h.db.queryLog.slice(from).filter((q) => !(q.table === 'operations' && q.operation === 'update')), alice.id, 'export');
  assert.deepEqual(keys, [`privacy:${alice.id}`, `privacy:${alice.id}`], 'inspect and export spend one budget');
  assert.deepEqual(h.blockedFetches, [], 'nothing leaves the process');
});

scenario('a daily score written since the review does not refuse the export (P6), and the file holds it', async (_t, make) => {
  const h = make();
  const alice = h.identities.alice;
  const reviewToken = await inspected(h, { groups: ['home', 'journal'] });
  h.db.seed('daily_scores', [{ id: crypto.randomUUID(), profile_id: alice.id, date: '2031-01-02', score: 77, state: 'NC', created_at: new Date().toISOString() }]);
  const body = exportBody(reviewToken);
  const panel = exportPanel();
  await panel.answer(await send(h, body), 'export', body.operationId);
  assert.equal(panel.message, MESSAGES.downloaded);
  const { document } = downloaded(panel);
  assert.ok(document.home.daily_scores.some((row) => row.date === '2031-01-02'));
});

// ---------------------------------------------------------------------------
// Reconcile (P9)
// ---------------------------------------------------------------------------

scenario('P9: a lost answer reconciled at 9 minutes downloads a file rebuilt from the stored selection', async (_t, make) => {
  const h = make();
  const reviewToken = await inspected(h, { groups: ['tasks', 'journal'], privateText: true });
  const body = exportBody(reviewToken);
  assert.equal((await send(h, body)).status, 200);
  const panel = exportPanel();
  await lost(panel, body.operationId);
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unconfirmed, { id: body.operationId, scope: 'export' }]);

  await backdate(h, body.operationId, 9 * MINUTE);
  const read = reader(h);
  const reconciled = await read(body.operationId);
  assert.equal(reconciled.headers.get('cache-control'), 'no-store', 'the reconcile body carrying the file is never cached');
  const raw = await reconciled.json();
  assert.ok(!('data' in raw));
  assert.ok(responseBytes(raw) <= EXPORT_MAX_RESPONSE_BYTES, 'the body as sent is under the cap');
  await panel.reconcile(read);
  assert.deepEqual([panel.message, panel.unknown, panel.review], [MESSAGES.downloaded, null, null]);
  const { document } = downloaded(panel);
  assert.deepEqual([document.groups, document.privateText], [['tasks', 'journal'], true]);
  assert.ok(document.journal.symptom_logs.some((row) => String(row.note).startsWith('ALICE-NOTE-MARKER')), 'built with the stored private-text choice');
});

scenario('P9: at 11 minutes the reconcile answers succeeded without a file; the panel keeps its lock with "not ready", until a reload', async (_t, make) => {
  const h = make();
  const body = exportBody(await inspected(h));
  await send(h, body);
  const panel = exportPanel();
  await lost(panel, body.operationId);
  await backdate(h, body.operationId, 11 * MINUTE);
  const from = h.db.queryLog.length;
  const read = reader(h);
  const raw = await (await read(body.operationId)).json();
  assert.equal(raw.status, 'succeeded');
  assert.ok(!('file' in raw) && !('data' in raw));
  assert.equal(readsOf(h, 'household_actions', from), 0, 'nothing is rebuilt after the window');
  await panel.reconcile(read);
  assert.deepEqual([panel.message, panel.unknown, panel.downloads], [MESSAGES.notReady, { id: body.operationId, scope: 'export' }, []]);
});

scenario('a failed export reconciles to "The request was not applied. Your data is unchanged."', async (_t, make) => {
  const h = make();
  const id = crypto.randomUUID();
  h.db.seed('operations', [{
    operation_id: id, profile_id: h.identities.alice.id, domain: 'privacy', kind: 'privacy.export', status: 'failed',
    request_hash: 'x', result: { operationId: id, status: 'failed', reason: 'too_large' }, created_at: ago(MINUTE),
  }]);
  const panel = exportPanel();
  await lost(panel, id);
  const read = reader(h);
  const raw = await (await read(id)).json();
  assert.ok(!('data' in raw) && !('file' in raw));
  await panel.reconcile(read);
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unchanged, null]);
});

// ---------------------------------------------------------------------------
// Size (P8): what is measured is the body actually sent
// ---------------------------------------------------------------------------

/** Pads alice's one inbox alert so the export receipt for `groups: ['home']` is exactly `target` bytes. */
async function padTo(h, target) {
  const alice = h.identities.alice.id;
  const alert = { id: crypto.randomUUID(), profile_id: alice, type: 'aqi', title: 'Padding', message: '', fired_at: '2026-10-01T09:00:00Z', read: false, dismissed: false };
  h.db.seed('alerts', [alert]);
  const measure = async () => (await buildExportDocument(h.db, { profileId: alice, groups: ['home'], privateText: false })).bytes;
  const base = await measure();
  const pad = 'z'.repeat(target - base);
  await h.db.from('alerts').update({ message: pad }).eq('id', alert.id);
  assert.equal(await measure(), target, 'calibrated');
}

scenario('the first answer and a replay fit at cap - 40 bytes, while the reconcile body (more keys) would not, so it carries no file (N6)', async (_t, make) => {
  const h = make();
  await padTo(h, EXPORT_MAX_RESPONSE_BYTES - 40);
  const body = exportBody(await inspected(h, { groups: ['home'] }));
  const first = await send(h, body);
  const answer = await first.clone().json();
  assert.equal(responseBytes(answer), EXPORT_MAX_RESPONSE_BYTES - 40);
  const panel = exportPanel();
  await panel.answer(first, 'export', body.operationId);
  assert.equal(panel.message, MESSAGES.downloaded);

  const replay = await (await send(h, body)).json();
  assert.ok(replay.file && responseBytes(replay) <= EXPORT_MAX_RESPONSE_BYTES, 'a replay answers the same three keys, measured whole');

  const later = exportPanel();
  later.unknown = { id: body.operationId, scope: 'export' };
  const read = reader(h);
  const raw = await (await read(body.operationId)).json();
  assert.ok(!('file' in raw), 'with its file the reconcile body would pass the cap');
  assert.ok(responseBytes({ ...raw, file: answer.file }) > EXPORT_MAX_RESPONSE_BYTES);
  await later.reconcile(read);
  assert.deepEqual([later.message, later.unknown], [MESSAGES.notReady, { id: body.operationId, scope: 'export' }]);
});

test('withExportFile measures the whole body: at the cap the file goes, one byte over it does not', () => {
  const body = { operationId: crypto.randomUUID(), status: 'succeeded', domain: 'privacy' };
  const sized = (n) => ({ name: 'halo-export-2026-10-19.json', mime: 'application/json', text: 'x'.repeat(n) });
  const empty = responseBytes({ ...body, file: sized(0) });
  const fits = sized(EXPORT_MAX_RESPONSE_BYTES - empty);
  assert.equal(responseBytes(withExportFile(body, fits)), EXPORT_MAX_RESPONSE_BYTES);
  assert.deepEqual(withExportFile(body, sized(EXPORT_MAX_RESPONSE_BYTES - empty + 1)), body);
  assert.equal(withExportFile(body, null), body);
});

test('the rebuild window is the review token\'s ten minutes; an unreadable created_at or selection rebuilds nothing', () => {
  assert.equal(EXPORT_REBUILD_WINDOW_MS, REVIEW_TOKEN_TTL_MS);
  const now = new Date('2026-10-19T12:00:00Z');
  assert.equal(withinRebuildWindow('2026-10-19T11:51:00.123456+00:00', now), true);
  assert.equal(withinRebuildWindow('2026-10-19T11:49:00Z', now), false);
  assert.equal(withinRebuildWindow(null, now), false);
  assert.equal(withinRebuildWindow('soon', now), false);
  for (const bad of [null, [], {}, { groups: [], privateText: true }, { groups: ['tasks'] }, { groups: ['tasks', 'tasks'], privateText: false },
    { groups: ['photos'], privateText: false }, { groups: ['tasks'], privateText: 'yes' }, { groups: ['tasks'], privateText: false, file: 'x' }]) {
    assert.equal(storedExportSelection(bad), null, JSON.stringify(bad));
  }
});

scenario('an export that outgrew the cap since its review is 200 failed too_large, stored as such, and the panel says unchanged', async (_t, make) => {
  const h = make();
  const reviewToken = await inspected(h, { groups: ['home'] });
  // Alerts are written by the server, so they are not bound by the token (P6): the review still verifies.
  h.db.seed('alerts', Array.from({ length: 5 }, (_, n) => ({
    id: crypto.randomUUID(), profile_id: h.identities.alice.id, type: 'aqi', title: `Big ${n}`, message: 'w'.repeat(900_000), fired_at: '2026-10-01T09:00:00Z',
  })));
  const body = exportBody(reviewToken);
  const response = await send(h, body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.clone().json(), { operationId: body.operationId, status: 'failed', reason: 'too_large' });
  const panel = exportPanel();
  await panel.answer(response, 'export', body.operationId);
  assert.deepEqual([panel.message, panel.unknown, panel.downloads], [MESSAGES.unchanged, null, []]);
  assert.deepEqual(privacyRows(h).map((row) => [row.status, row.result]), [['failed', { operationId: body.operationId, status: 'failed', reason: 'too_large' }]]);
  // And its reconcile says the same.
  const later = exportPanel();
  later.unknown = { id: body.operationId, scope: 'export' };
  await later.reconcile(reader(h));
  assert.equal(later.message, MESSAGES.unchanged);
});

// ---------------------------------------------------------------------------
// Refused tokens: 409 before the claim, nothing recorded (P15)
// ---------------------------------------------------------------------------

async function refusedWithNoRow(h, reviewToken, label) {
  const from = h.db.queryLog.length;
  const body = exportBody(reviewToken);
  const response = await send(h, body);
  assert.equal(response.status, 409, label);
  const raw = await response.clone().json();
  assert.equal(raw.reason, 'review_changed', label);
  assert.deepEqual(privacyRows(h), [], `${label}: no ledger row`);
  assert.deepEqual(ledgerWrites(h, from), [], `${label}: no claim was attempted`);
  assert.equal(readsOf(h, 'household_actions', from), 0, `${label}: nothing was exported`);
  const panel = exportPanel();
  await panel.answer(response, 'export', body.operationId);
  assert.deepEqual([panel.message, panel.unknown, panel.review], [MESSAGES.conflict, null, { scope: 'export' }], `${label}: the review stays open`);
}

scenario('another household\'s token, an expired token, a tampered token, a journal entry since inspect: each 409 with no ledger row', async (_t, make) => {
  const h = make();
  await refusedWithNoRow(h, await inspected(h, { as: 'bob' }), 'bob\'s token');
  await refusedWithNoRow(h, minted(h, { now: Date.now() - REVIEW_TOKEN_TTL_MS - 1000 }), 'expired');
  const good = minted(h);
  const flipped = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
  await refusedWithNoRow(h, flipped, 'tampered MAC');
  const journal = await inspected(h, { groups: ['tasks', 'journal'] });
  h.db.seed('symptom_logs', [{ id: entryId('alice', 90), profile_id: h.identities.alice.id, entry_date: '2026-10-15', note: 'since review' }]);
  await refusedWithNoRow(h, journal, 'a symptom log since inspect');
  assert.deepEqual(h.db.rows('symptom_logs').filter((row) => row.profile_id === h.identities.bob.id).length > 0, true);
});

scenario("another household's operation id: with bob's own token it is 409 operation_mismatch, with a stale one 409 review_changed; alice's row is untouched", async (_t, make) => {
  const h = make();
  const body = exportBody(await inspected(h));
  await send(h, body);
  const before = privacyRows(h);
  const fresh = await send(h, { ...body, reviewToken: await inspected(h, { as: 'bob' }) }, { as: 'bob' });
  assert.equal(fresh.status, 409);
  assert.equal((await fresh.json()).reason, 'operation_mismatch');
  const stale = await send(h, { ...body, reviewToken: minted(h, { who: 'bob', now: Date.now() - REVIEW_TOKEN_TTL_MS - 1000 }) }, { as: 'bob' });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).reason, 'review_changed', "bob is told nothing about alice's row");
  assert.deepEqual(privacyRows(h), before);
});

scenario('an unverified token on an id alice recorded in another domain (settings) is a privacy miss, 409 review_changed, not that row', async (_t, make) => {
  const h = make();
  const id = crypto.randomUUID();
  const settingsRow = {
    operation_id: id, profile_id: h.identities.alice.id, domain: 'settings', kind: 'settings.save', status: 'succeeded',
    request_hash: 'settings-hash', result: { operationId: id, status: 'succeeded' }, created_at: ago(MINUTE),
  };
  h.db.seed('operations', [settingsRow]);
  const recorded = h.db.rows('operations').find((row) => row.operation_id === id);
  const stale = minted(h, { now: Date.now() - REVIEW_TOKEN_TTL_MS - 1000 });
  const response = await send(h, exportBody(stale, { operationId: id }));
  assert.equal(response.status, 409);
  assert.equal((await response.clone().json()).reason, 'review_changed');
  const panel = exportPanel();
  await panel.answer(response, 'export', id);
  assert.deepEqual([panel.message, panel.unknown, panel.review], [MESSAGES.conflict, null, { scope: 'export' }]);
  assert.deepEqual(h.db.rows('operations').find((row) => row.operation_id === id), recorded, 'the settings row is untouched');
});

// ---------------------------------------------------------------------------
// Replays (P9, P15)
// ---------------------------------------------------------------------------

scenario('the same key and body replays the recorded export: one row, no second export, only P9\'s rebuild; after the window no file', async (_t, make) => {
  const h = make();
  const body = exportBody(await inspected(h));
  let from = h.db.queryLog.length;
  assert.equal((await send(h, body)).status, 200);
  const once = readsOf(h, 'household_actions', from);
  assert.ok(once >= 1);

  from = h.db.queryLog.length;
  const replay = await send(h, body);
  assert.equal(replay.status, 200);
  assert.equal(readsOf(h, 'household_actions', from), once, 'the replay read the household once more, for the rebuild only');
  assert.deepEqual(ledgerWrites(h, from).filter((q) => q.operation !== 'upsert'), [], 'no second settle');
  const panel = exportPanel();
  await panel.answer(replay, 'export', body.operationId);
  assert.equal(panel.message, MESSAGES.downloaded);
  assert.equal(privacyRows(h).length, 1);

  await backdate(h, body.operationId, 11 * MINUTE);
  from = h.db.queryLog.length;
  const late = await send(h, body);
  assert.deepEqual(await late.clone().json(), { operationId: body.operationId, status: 'succeeded' });
  assert.equal(readsOf(h, 'household_actions', from), 0);
  const parked = exportPanel();
  await parked.answer(late, 'export', body.operationId);
  assert.deepEqual([parked.message, parked.unknown], [MESSAGES.notReady, { id: body.operationId, scope: 'export' }]);
});

scenario('a replay whose token no longer verifies is answered from the ledger, never claimed: P9 within the window', async (_t, make) => {
  const h = make();
  const body = exportBody(await inspected(h, { groups: ['journal'], privateText: true }));
  await send(h, body);
  h.db.seed('symptom_logs', [{ id: entryId('alice', 91), profile_id: h.identities.alice.id, entry_date: '2026-10-16', note: 'ALICE-LATER-NOTE' }]);
  const from = h.db.queryLog.length;
  const replay = await send(h, body);
  assert.equal(replay.status, 200);
  assert.ok(!ledgerWrites(h, from).some((q) => q.operation === 'upsert' || q.operation === 'insert'), 'no claim on an unverified token');
  const panel = exportPanel();
  await panel.answer(replay, 'export', body.operationId);
  const { document } = downloaded(panel);
  assert.ok(document.journal.symptom_logs.some((row) => row.note === 'ALICE-LATER-NOTE'), 'rebuilt from the rows as they are now (generatedAt says when)');
});

scenario('the same key with a different token is 409 operation_mismatch, verified or not, and the row is unchanged', async (_t, make) => {
  const h = make();
  const body = exportBody(await inspected(h));
  await send(h, body);
  const before = privacyRows(h);
  const other = await inspected(h, { groups: ['explore'] });
  for (const token of [other, minted(h, { groups: ['tasks'], now: Date.now() - REVIEW_TOKEN_TTL_MS - 1000 })]) {
    const response = await send(h, { ...body, reviewToken: token });
    assert.equal(response.status, 409);
    assert.equal((await response.clone().json()).reason, 'operation_mismatch');
    const panel = exportPanel();
    await panel.answer(response, 'export', body.operationId);
    assert.deepEqual([panel.message, panel.unknown], [MESSAGES.conflict, null]);
  }
  assert.deepEqual(privacyRows(h), before);
});

scenario('a pending row replays as the retryable 503 in flight; the panel parks the id', async (_t, make) => {
  const h = make();
  const reviewToken = await inspected(h);
  const id = crypto.randomUUID();
  h.db.seed('operations', [{
    operation_id: id, profile_id: h.identities.alice.id, domain: 'privacy', kind: 'privacy.export', status: 'pending',
    request_hash: requestHash({ reviewToken, scope: 'export' }), result: null, created_at: new Date().toISOString(),
  }]);
  const response = await send(h, exportBody(reviewToken, { operationId: id }));
  assert.equal(response.status, 503);
  assert.equal((await response.clone().json()).retryable, true);
  const panel = exportPanel();
  await panel.answer(response, 'export', id);
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unconfirmed, { id, scope: 'export' }]);
});

const REAPED = [
  ['settled failed with no receipt (an in-process throw)', { status: 'failed', result: null }],
  ['reaped as abandoned', { status: 'failed', result: { status: 'failed', reason: 'abandoned' } }],
  ['a stale pending claim, reaped by this replay', { status: 'pending', result: null, created_at: ago(3 * MINUTE) }],
];
for (const [label, row] of REAPED) {
  scenario(`a replay of a row ${label} answers 200 failed; the panel says unchanged`, async (_t, make) => {
    const h = make();
    const reviewToken = await inspected(h);
    const id = crypto.randomUUID();
    h.db.seed('operations', [{
      operation_id: id, profile_id: h.identities.alice.id, domain: 'privacy', kind: 'privacy.export',
      request_hash: requestHash({ reviewToken, scope: 'export' }), created_at: ago(MINUTE), ...row,
    }]);
    const response = await send(h, exportBody(reviewToken, { operationId: id }));
    assert.equal(response.status, 200);
    const answer = await response.clone().json();
    assert.equal(answer.status, 'failed');
    assert.ok(!('file' in answer));
    const panel = exportPanel();
    await panel.answer(response, 'export', id);
    assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unchanged, null]);
  });
}

// ---------------------------------------------------------------------------
// 400 before anything is read or recorded
// ---------------------------------------------------------------------------

scenario('400 with no row: Idempotency-Key missing, not a UUID or not the id; scope journal; an extra key; If-Match; a clear token; a malformed token', async (_t, make) => {
  const h = make();
  const reviewToken = await inspected(h);
  const journalToken = minted(h, { scope: 'journal', groups: [] });
  const cases = [
    ['no Idempotency-Key', exportBody(reviewToken), { key: null }],
    ['a non-UUID key', exportBody(reviewToken), { key: 'not-a-uuid' }],
    ['a mismatched key', exportBody(reviewToken), { key: crypto.randomUUID() }],
    ['scope journal', exportBody(reviewToken, { scope: 'journal' }), {}],
    ['an extra key', { ...exportBody(reviewToken), groups: ['tasks'] }, {}],
    ['confirm', { ...exportBody(reviewToken), confirm: 'DELETE' }, {}],
    ['If-Match', exportBody(reviewToken), { headers: { 'if-match': '3' } }],
    ['a journal token', exportBody(journalToken), {}],
    ['a journal token sent as a journal request', exportBody(journalToken, { scope: 'journal' }), {}],
    ['a malformed token', exportBody('not.a-token'), {}],
    ['a non-UUID operationId', exportBody(reviewToken, { operationId: 'abc' }), { key: 'abc' }],
  ];
  for (const [label, body, options] of cases) {
    const from = h.db.queryLog.length;
    const calls = h.db.rpcCalls.length;
    const response = await send(h, body, options);
    assert.equal(response.status, 400, label);
    assert.equal(h.db.queryLog.length, from, `${label}: nothing was read`);
    assert.equal(h.db.rpcCalls.length, calls, `${label}: no function was called`);
    const panel = exportPanel();
    await panel.answer(response, 'export', body.operationId);
    assert.deepEqual([panel.message, panel.unknown, panel.review], [MESSAGES.validation, null, { scope: 'export' }], label);
  }
  assert.deepEqual(privacyRows(h), []);
});

// ---------------------------------------------------------------------------
// Availability, limits, failures, the session
// ---------------------------------------------------------------------------

const UNAVAILABLE = [
  ['no review key', { env: {} }],
  ['a 31-character key', { env: { HALO_PRIVACY_REVIEW_KEY: 'x'.repeat(31) } }],
  ['0024 not applied', { version: null }],
  ['a different 0024 version', { version: 2 }],
];
for (const [label, options] of UNAVAILABLE) {
  scenario(`${label}: a non-retryable 503 with no claim; the panel parks the id and its reconcile is the 404`, async (_t, make) => {
    const ready = make();
    const reviewToken = await inspected(ready);
    const h = make(options);
    const body = exportBody(reviewToken);
    const response = await send(h, body);
    assert.equal(response.status, 503);
    const raw = await response.clone().json();
    assert.deepEqual([raw.code, raw.retryable], ['feature_unavailable', false]);
    assert.deepEqual(privacyRows(h), []);
    assert.deepEqual(ledgerWrites(h), []);
    const panel = exportPanel();
    await panel.answer(response, 'export', body.operationId);
    assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unconfirmed, { id: body.operationId, scope: 'export' }]);
    await panel.reconcile(reader(h));
    assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unavailable, { id: body.operationId, scope: 'export' }]);
  });
}

scenario('over the shared privacy budget: 429 keyed by the household, nothing recorded; an Upstash outage fails open', async (t, make) => {
  const keys = [];
  const limited = make({ rateLimit: (key) => { keys.push(key); return false; } });
  const body = exportBody(minted(limited));
  const response = await send(limited, body);
  assert.equal(response.status, 429);
  assert.deepEqual(keys, [`privacy:${limited.identities.alice.id}`]);
  assert.deepEqual(privacyRows(limited), []);
  assert.ok(!limited.db.rpcCalls.some((call) => call.name === 'privacy_fingerprint'), 'nothing was read past the limit');
  const panel = exportPanel();
  await panel.answer(response, 'export', body.operationId);
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.rateLimited, null]);

  const errors = muteConsoleError(t);
  const open = make({ rateLimit: () => LIMITER_UNAVAILABLE });
  const fine = exportBody(minted(open));
  const answered = exportPanel();
  await answered.answer(await send(open, fine), 'export', fine.operationId);
  assert.equal(answered.message, MESSAGES.downloaded);
  assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes('privacy limiter unavailable')));
});

scenario('a read that fails mid-export is a 500 with the row settled failed; the reconcile says unchanged; the log has no id or token', async (t, make) => {
  const errors = muteConsoleError(t);
  const h = make();
  const reviewToken = await inspected(h, { groups: ['tasks'] });
  const realFrom = h.db.from;
  h.db.from = (name) => {
    const builder = realFrom(name);
    if (name === 'household_actions') builder.limit = () => ({ then: (resolve) => resolve({ data: null, count: null, error: pgError('57014', 'canceling statement due to statement timeout') }) });
    return builder;
  };
  const body = exportBody(reviewToken);
  const response = await send(h, body);
  h.db.from = realFrom;
  assert.equal(response.status, 500);
  assert.deepEqual(privacyRows(h).map((row) => [row.status, row.result]), [['failed', null]]);
  const panel = exportPanel();
  await panel.answer(response, 'export', body.operationId);
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unconfirmed, { id: body.operationId, scope: 'export' }]);
  await panel.reconcile(reader(h));
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.unchanged, null]);
  const logged = JSON.stringify(errors.mock.calls.map((call) => call.arguments));
  assert.ok(logged.includes('57014'));
  for (const secret of [reviewToken, h.identities.alice.id]) assert.ok(!logged.includes(secret));
});

test('401 without a session, before anything is read', async () => {
  const h = harness();
  const response = await send(h, exportBody(minted(h)), { as: null });
  assert.equal(response.status, 401);
  assert.deepEqual([h.db.rpcCalls, privacyRows(h)], [[], []]);
});

test('maxDuration is 60, under the ledger\'s staleness window', async () => {
  const route = await import('../app/api/privacy/exports/route.js');
  assert.equal(route.maxDuration, 60);
});

test('no U+2014 in the route\'s source or in any body; no body has a top-level data key', () => {
  assert.ok(!readFileSync(ROUTE_FILE, 'utf8').includes(EM_DASH));
  assert.ok(bodies.length > 30);
  for (const text of bodies) {
    if (!text) continue;
    const parsed = JSON.parse(text);
    assert.ok(!Object.hasOwn(parsed, 'data'), 'a body carries a top-level data key');
    const server = { ...parsed };
    delete server.file; // the household's own stored content travels verbatim (C8)
    assert.ok(!JSON.stringify(server).includes(EM_DASH));
  }
});
