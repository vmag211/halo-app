/**
 * POST /api/privacy/export/inspect (registry `privacy.inspect`), B07 plan,
 * Task 4; Rulings P1, P5, P6, P8, P10, P11, P15 and P17.
 *
 * Every 200 body is put through the client's OWN consumption, transcribed
 * verbatim below from this tree (types stripped) and held to the source by a
 * drift test: the runtime's status mapping and envelope unwrap
 * (lib/frontend/production/runtime.ts:144,147-153) and the inspect check
 * (components/production/ProductionPrivacy.tsx:22). A body that passes is one
 * the panel opens as a review; one that fails is the panel's "Check the
 * highlighted information" or "not confirmed" message.
 *
 * Also: the token binds this household and these records (P6); `groups: []`
 * opens either clear (trap P-3) and never an export; no inspect writes or
 * reads the ledger (trap P-2); the limiter is fail-open (P17); privacy that is
 * not available is a non-retryable 503 with nothing minted (P11); an export
 * over 4,000,000 bytes is a 422 (P8); a failed read is a 500 with nothing
 * minted. The harness's database is in memory, the three 0024 functions are
 * fakes registered by argument name, and no request leaves the process.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRouteHarness, muteConsoleError, LIMITER_UNAVAILABLE } from './helpers/routeHarness.mjs';
import { HALO_TABLES } from './helpers/tables.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { pgError } from './helpers/fakeTable.mjs';
import { contextId, entryId, markersOf, seedHouseholds } from './helpers/isolationSeed.mjs';

const { verifyReviewToken, readReviewSelection, REVIEW_TOKEN_TTL_MS } = await import('../lib/privacyToken.js');
const { fingerprintTables, EXPORT_GROUPS } = await import('../lib/privacyInventory.js');
const { buildExportDocument, EXPORT_COPY } = await import('../lib/privacyExport.js');

const ROUTE = '/api/privacy/export/inspect';
const KEY = 'k'.repeat(24) + 'privacy-review-key-for-tests';
const ENV = { HALO_PRIVACY_REVIEW_KEY: KEY };
const EM_DASH = String.fromCharCode(0x2014);
const CONFIRMED = '2026-10-01T12:00:00Z';
const SEASON_MESSAGE = 'ALICE-SEASON-MESSAGE-MARKER';
const DASHED_NOTE = `ALICE-DASH-NOTE before${EM_DASH}after`;

// ---------------------------------------------------------------------------
// The client, transcribed
// ---------------------------------------------------------------------------

/** runtime.ts:144, verbatim (types stripped): an HTTP status to the client's failure code. */
const STATUS_LINE = "response.status===401?'session':response.status===403?'permission':response.status===409||response.status===412?'conflict':response.status===400||response.status===422?'validation':response.status===429?'rate_limited':response.status>=500&&mutation?'unknown_outcome':'unavailable';";
function failureCode(response, mutation) {
  return response.status===401?'session':response.status===403?'permission':response.status===409||response.status===412?'conflict':response.status===400||response.status===422?'validation':response.status===429?'rate_limited':response.status>=500&&mutation?'unknown_outcome':'unavailable';
}

/** runtime.ts:149-152, verbatim (types stripped): the envelope is unwrapped once. */
const UNWRAP_LINES = [
  "if(Object.hasOwn(json,'data')) {",
  "return (envelope.data && typeof envelope.data==='object' && !Array.isArray(envelope.data) && envelope.meta ? {...envelope.data,_meta:envelope.meta} : envelope.data) as T;",
];
function unwrap(json) {
  if(Object.hasOwn(json,'data')) {
    const envelope=json;
    return (envelope.data && typeof envelope.data==='object' && !Array.isArray(envelope.data) && envelope.meta ? {...envelope.data,_meta:envelope.meta} : envelope.data);
  }
  return json;
}

/** ProductionPrivacy.tsx:22, the inspect check, verbatim. */
const INSPECT_CHECK = "if(typeof data.reviewToken!=='string'||!Number.isSafeInteger(data.count)||data.count<0||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now())throw new Error('invalid');";
function inspectCheck(data) {
  if(typeof data.reviewToken!=='string'||!Number.isSafeInteger(data.count)||data.count<0||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now())throw new Error('invalid');
}

/**
 * What the panel does with an inspect answer: the review it opens, or the
 * failure code its message comes from (ProductionPrivacy.tsx:22, through the
 * runtime). Inspect is a POST, so the runtime treats it as a mutation.
 */
async function clientInspect(response, { scope, selection }) {
  const json = await response.json().catch(() => null);
  if (!response.ok) return { failure: failureCode(response, true) };
  if (json === null || typeof json !== 'object') return { failure: 'unknown_outcome' };
  const data = unwrap(json);
  try {
    inspectCheck(data);
  } catch {
    return { failure: 'invalid' };
  }
  return { review: { ...data, scope, selection } };
}

test('the transcriptions are the client\'s own lines (drift)', () => {
  const runtime = readFileSync(new URL('../lib/frontend/production/runtime.ts', import.meta.url), 'utf8');
  assert.ok(runtime.includes(`const code:FailureCode = ${STATUS_LINE}`), 'runtime.ts status mapping changed');
  for (const line of UNWRAP_LINES) assert.ok(runtime.includes(line), `runtime.ts unwrap changed: ${line}`);
  const panel = readFileSync(new URL('../components/production/ProductionPrivacy.tsx', import.meta.url), 'utf8');
  const lines = panel.split('\n');
  assert.ok(lines[21].includes(INSPECT_CHECK), 'ProductionPrivacy.tsx:22 changed');
  assert.ok(lines[21].includes("runtime.request<Omit<Review,'selection'|'scope'>>('privacy.inspect',{scope,groups,privateText},{idempotencyKey:crypto.randomUUID()})"));
});

test('the transcribed check refuses what the client refuses (self-check)', () => {
  const good = { reviewToken: 't', count: 0, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  assert.doesNotThrow(() => inspectCheck(good));
  for (const bad of [
    { ...good, reviewToken: 1 }, { ...good, count: -1 }, { ...good, count: 1.5 }, { ...good, count: '3' },
    { ...good, expiresAt: 'soon' }, { ...good, expiresAt: new Date(Date.now() - 1000).toISOString() },
  ]) assert.throws(() => inspectCheck(bad));
  assert.equal(unwrap({ data: { a: 1 } }).a, 1);
  assert.equal(failureCode({ status: 422 }, true), 'validation');
  assert.equal(failureCode({ status: 503 }, true), 'unknown_outcome');
});

// ---------------------------------------------------------------------------
// The world: the isolation seed, plus fakes of the 0024 functions
// ---------------------------------------------------------------------------

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** privacy_fingerprint stand-in: the household's rows of the listed tables, order-free. */
function fakeFingerprint(db, profileId, tables) {
  const owners = { profiles: 'id' };
  const parts = tables.map((table) => {
    const owner = owners[table] ?? 'profile_id';
    let stored;
    try { stored = db.rows(table); } catch { stored = []; } // a table this deployment lacks
    const rows = stored.filter((row) => row[owner] === profileId).map((row) => sha(JSON.stringify(row))).sort();
    return `${table}:${rows.join(',')}`;
  });
  return sha(parts.join('|'));
}

/** privacy_counts stand-in, the same rules as 0024 section 4. */
function fakeCounts(db, profileId, scope) {
  const own = (table) => db.rows(table).filter((row) => row.profile_id === profileId);
  if (scope === 'journal') {
    return { symptom_logs: own('symptom_logs').length, alerts: own('alerts').filter((row) => row.type === 'season_summary').length };
  }
  const out = { profiles: 1 };
  for (const table of ['home_contexts', 'daily_scores', 'home_risks', 'household_bands', 'symptom_logs', 'alerts', 'notification_prefs',
    'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions', 'household_action_preferences',
    'household_action_state', 'luna_conversations', 'luna_turns', 'luna_runs']) out[table] = own(table).length;
  out.operations = own('operations').filter((row) => row.status !== 'pending').length;
  // 0025 where applied (0024's to_regclass check), else 0.
  let maxima = [];
  try { maxima = own('daily_maxima'); } catch { maxima = []; }
  out.daily_maxima = maxima.length;
  return out;
}

function harness({ adjust, rateLimit, env = ENV, functions = true, version = 1, tables = HALO_TABLES } = {}) {
  const h = createRouteHarness({
    tables,
    env,
    rateLimit,
    identities: { alice: { emailConfirmedAt: CONFIRMED }, bob: { emailConfirmedAt: CONFIRMED } },
    seed: (identities) => {
      const rows = seedHouseholds(identities, {
        adjust: (seeded, ids) => {
          seeded.alerts.push({
            id: 'a11ce000-1111-4000-8000-0000000000aa', profile_id: ids.alice.id, type: 'season_summary',
            title: 'Your fall summary', message: SEASON_MESSAGE, dedupe_key: 'season_summary:fall:alice', fired_at: '2026-10-01T10:00:00Z',
          });
          seeded.symptom_logs.push({ id: entryId('alice', 50), profile_id: ids.alice.id, entry_date: '2026-10-10', note: DASHED_NOTE });
          adjust?.(seeded, ids);
        },
      });
      return Object.fromEntries(Object.entries(rows).filter(([name]) => name in tables));
    },
  });
  if (functions) {
    h.db.registerRpc('privacy_schema_version', () => version, { args: [] });
    h.db.registerRpc('privacy_fingerprint', ({ p_profile_id, p_tables }, db) => fakeFingerprint(db, p_profile_id, p_tables), { args: ['p_profile_id', 'p_tables'] });
    h.db.registerRpc('privacy_counts', ({ p_profile_id, p_scope }, db) => fakeCounts(db, p_profile_id, p_scope), { args: ['p_profile_id', 'p_scope'] });
  }
  return h;
}

const inspect = (h, body, { as = 'alice', headers = {}, ...rest } = {}) =>
  h.call(ROUTE, 'POST', { as, body, headers: { 'idempotency-key': crypto.randomUUID(), ...headers }, ...rest });

const selectionOf = (body) => JSON.stringify({ groups: body.groups, privateText: body.privateText });

async function opened(h, body, options) {
  const response = await inspect(h, body, options);
  const status = response.status;
  const raw = await response.clone().json();
  const outcome = await clientInspect(response, { scope: body.scope, selection: selectionOf(body) });
  return { status, raw, ...outcome };
}

const ledgerUntouched = (h, before) => {
  assert.deepEqual(h.db.rows('operations'), before, 'the ledger changed');
  assert.ok(!h.db.queryLog.some((query) => query.table === 'operations'), 'an inspect touched the ledger (trap P-2)');
};

// ---------------------------------------------------------------------------
// The three scopes open a review the client accepts
// ---------------------------------------------------------------------------

test('export: 200, a review the client opens, count = the document\'s records, preview = manifest and field names', async () => {
  const h = harness();
  const body = { scope: 'export', groups: [...EXPORT_GROUPS], privateText: true };
  const before = h.db.rows('operations');
  const result = await opened(h, body);
  assert.equal(result.status, 200);
  assert.ok(result.review, `the client refused the answer: ${result.failure}`);
  assert.deepEqual(Object.keys(result.raw).sort(), ['count', 'expiresAt', 'preview', 'reviewToken']);
  assert.ok(!('data' in result.raw));
  const alice = h.identities.alice;
  const built = await buildExportDocument(h.db, { profileId: alice.id, groups: [...EXPORT_GROUPS], privateText: true });
  assert.equal(result.review.count, built.total);
  // What the panel shows ("N records in this review") is what the preview's manifest says, each record once.
  assert.equal(result.raw.preview.manifest.records, result.review.count);
  assert.deepEqual(result.raw.preview.manifest.counts, built.document.manifest.counts);
  assert.deepEqual(result.raw.preview.fields, built.fields);
  // The preview names fields, never records.
  const preview = JSON.stringify(result.raw.preview);
  for (const marker of ['ALICE-NOTE-MARKER', 'ALICE-TASK-TITLE-MARKER', 'ALICE-LUNA-QUESTION-MARKER', 'alice@example.test', DASHED_NOTE]) {
    assert.ok(!preview.includes(marker), `the preview carries a record: ${marker}`);
  }
  ledgerUntouched(h, before);
});

test('the review expires ten minutes from now, by the client\'s clock, and the response is never cached', async () => {
  const h = harness();
  const start = Date.now();
  const response = await inspect(h, { scope: 'journal', groups: [], privateText: false });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { expiresAt } = await response.json();
  const expiry = Date.parse(expiresAt);
  assert.ok(expiry > start + REVIEW_TOKEN_TTL_MS - 2000 && expiry <= Date.now() + REVIEW_TOKEN_TTL_MS);
});

test('Clear Journal: count = symptom logs + season summaries, and the preview says what goes and what stays', async () => {
  const h = harness();
  const alice = h.identities.alice;
  const before = h.db.rows('operations');
  const result = await opened(h, { scope: 'journal', groups: ['tasks'], privateText: false });
  assert.equal(result.status, 200);
  assert.ok(result.review);
  const own = (table) => h.db.rows(table).filter((row) => row.profile_id === alice.id);
  const expected = own('symptom_logs').length + own('alerts').filter((row) => row.type === 'season_summary').length;
  assert.equal(result.review.count, expected);
  assert.ok(expected >= 6);
  assert.deepEqual(result.raw.preview.remove, { journal: expected });
  assert.ok(result.raw.preview.notStored.includes(EXPORT_COPY.weekJournalNotStored));
  assert.ok(result.raw.preview.keep.includes(EXPORT_COPY.keepOutsideJournal));
  assert.ok(!JSON.stringify(result.raw.preview).includes(SEASON_MESSAGE));
  ledgerUntouched(h, before);
});

test('clear all: count = the sum of privacy_counts, and the preview adds up to it', async () => {
  const h = harness();
  const alice = h.identities.alice;
  const result = await opened(h, { scope: 'all', groups: ['tasks'], privateText: false });
  assert.equal(result.status, 200);
  assert.ok(result.review);
  const sum = Object.values(fakeCounts(h.db, alice.id, 'all')).reduce((a, b) => a + b, 0);
  assert.equal(result.review.count, sum);
  assert.equal(Object.values(result.raw.preview.remove).reduce((a, b) => a + b, 0), sum);
  assert.deepEqual(result.raw.preview.limits, [EXPORT_COPY.limitDownloads, EXPORT_COPY.limitBackups]);
});

test('the privacy_counts stand-in names exactly the keys 0024 counts for clear all', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0024_privacy_clear.sql', import.meta.url), 'utf8');
  const countsAll = sql.slice(sql.indexOf('create or replace function public.privacy_counts'));
  const fn = countsAll.slice(0, countsAll.indexOf('$$;'));
  // The last object the function returns is clear all's (the first is Clear Journal's).
  const body = fn.slice(fn.lastIndexOf('return jsonb_build_object('));
  const named = [...body.matchAll(/^\s*'([a-z_]+)', (?:\(select count|[a-z_]+\s*$)/gm)].map((match) => match[1]);
  const h = harness();
  assert.deepEqual(Object.keys(fakeCounts(h.db, h.identities.alice.id, 'all')).sort(), named.sort());
  assert.ok(named.includes('daily_maxima'));
});

test('daily_maxima (0025): clear all counts every one of the household\'s maxima under home, and a recorder write does not void the review (not fingerprinted, P6)', async () => {
  const h = harness();
  const alice = h.identities.alice;
  const maxima = h.db.rows('daily_maxima').filter((row) => row.profile_id === alice.id).length;
  assert.equal(maxima, 6);
  const withMaxima = await opened(h, { scope: 'all', groups: [], privateText: false });
  assert.equal(withMaxima.status, 200);
  assert.ok(withMaxima.review);
  // The same household without its maxima: the count and the home line are smaller by exactly them.
  const without = harness({ adjust: (seeded, ids) => { seeded.daily_maxima = seeded.daily_maxima.filter((row) => row.profile_id !== ids.alice.id); } });
  const withoutMaxima = await opened(without, { scope: 'all', groups: [], privateText: false });
  assert.equal(withMaxima.review.count - withoutMaxima.review.count, maxima);
  assert.equal(withMaxima.raw.preview.remove.home - withoutMaxima.raw.preview.remove.home, maxima);
  assert.ok(!('other' in withMaxima.raw.preview.remove), 'daily_maxima fell under other');
  // The recorder writes a maximum after the review: the clear-all token still verifies.
  assert.ok(!fingerprintTables('all').includes('daily_maxima'));
  const { reviewToken } = withMaxima.raw;
  h.db.seed('daily_maxima', [{
    profile_id: alice.id, home_context_id: contextId('alice', 1), local_date: '2026-01-01', factor: 'uv', value: 4, unit: 'UV index',
    source_code: 'open_meteo_forecast', station_id: null, method_version: 'daily-max-v1', time_zone: 'America/New_York',
    hours_expected: 24, hours_observed: 24, missing_code: null, retrieved_at: '2026-01-02T12:00:00Z',
  }]);
  const current = fakeFingerprint(h.db, alice.id, fingerprintTables('all'));
  assert.deepEqual(verifyReviewToken(KEY, reviewToken, { profileId: alice.id, fingerprint: current }), { ok: true, scope: 'all', groups: [], privateText: false });
});

for (const scope of ['journal', 'all']) {
  test(`groups: [] opens ${scope === 'all' ? 'clear all' : 'Clear Journal'} (trap P-3)`, async () => {
    const h = harness();
    const result = await opened(h, { scope, groups: [], privateText: false });
    assert.equal(result.status, 200);
    assert.ok(result.review);
  });
}

test('groups: [] for an export is a 400, the client\'s validation, and nothing is minted', async () => {
  const h = harness();
  const result = await opened(h, { scope: 'export', groups: [], privateText: false });
  assert.equal(result.status, 400);
  assert.equal(result.failure, 'validation');
  assert.ok(!('reviewToken' in result.raw));
  assert.equal(result.raw.field_errors[0].field, 'groups');
});

// ---------------------------------------------------------------------------
// The token (P6)
// ---------------------------------------------------------------------------

test('the token binds this household, the selection and the records it reviewed', async () => {
  const h = harness();
  const { alice, bob } = h.identities;
  const body = { scope: 'export', groups: ['tasks', 'journal'], privateText: true };
  const { reviewToken } = await (await inspect(h, body)).json();
  const tables = fingerprintTables('export', body.groups);
  const current = (who) => fakeFingerprint(h.db, who.id, tables);
  const ok = verifyReviewToken(KEY, reviewToken, { profileId: alice.id, fingerprint: current(alice) });
  assert.deepEqual(ok, { ok: true, scope: 'export', groups: ['journal', 'tasks'], privateText: true });
  assert.deepEqual(readReviewSelection(reviewToken), { scope: 'export', groups: ['journal', 'tasks'], privateText: true });
  // Another household cannot use it, with its own fingerprint or alice's.
  assert.equal(verifyReviewToken(KEY, reviewToken, { profileId: bob.id, fingerprint: current(bob) }).ok, false);
  assert.equal(verifyReviewToken(KEY, reviewToken, { profileId: bob.id, fingerprint: current(alice) }).ok, false);
  // A journal entry added since the review changes the fingerprint.
  h.db.seed('symptom_logs', [{ id: entryId('alice', 70), profile_id: alice.id, entry_date: '2026-10-12', note: 'later' }]);
  assert.deepEqual(verifyReviewToken(KEY, reviewToken, { profileId: alice.id, fingerprint: current(alice) }), { ok: false, reason: 'mismatch' });
  // The token itself names no household and no fingerprint.
  const payload = Buffer.from(reviewToken.split('.')[0], 'base64url').toString('utf8');
  assert.ok(!payload.includes(alice.id));
});

test('each scope\'s token covers that scope\'s fingerprint tables, read before the records are counted', async () => {
  const h = harness();
  // How many records had been read when the fingerprint was taken.
  let readsBeforeFingerprint = null;
  h.db.registerRpc('privacy_fingerprint', ({ p_profile_id, p_tables }, db) => {
    readsBeforeFingerprint = h.db.queryLog.length;
    return fakeFingerprint(db, p_profile_id, p_tables);
  }, { args: ['p_profile_id', 'p_tables'] });
  for (const [scope, groups] of [['journal', ['home']], ['all', []], ['export', ['preferences']]]) {
    h.db.rpcCalls.length = 0;
    h.db.queryLog.length = 0;
    const response = await inspect(h, { scope, groups, privateText: false });
    assert.equal(response.status, 200);
    const call = h.db.rpcCalls.find((entry) => entry.name === 'privacy_fingerprint');
    assert.deepEqual(call.args, { p_profile_id: h.identities.alice.id, p_tables: fingerprintTables(scope, groups) });
    const order = h.db.rpcCalls.map((entry) => entry.name);
    if (scope !== 'export') assert.ok(order.indexOf('privacy_fingerprint') < order.indexOf('privacy_counts'), 'fingerprint first');
    else {
      assert.equal(readsBeforeFingerprint, 0, 'the fingerprint is taken before any record is read');
      assert.ok(h.db.queryLog.length > 0);
    }
  }
});

// ---------------------------------------------------------------------------
// Isolation (HO-066, BE-380)
// ---------------------------------------------------------------------------

test('bob\'s records never reach alice\'s review; every statement is scoped to her; the home header and body ids are ignored or refused', async () => {
  const h = harness();
  const { alice, bob } = h.identities;
  const plain = await (await inspect(h, { scope: 'export', groups: [...EXPORT_GROUPS], privateText: true })).json();
  h.db.queryLog.length = 0;
  const withHeader = await inspect(h, { scope: 'export', groups: [...EXPORT_GROUPS], privateText: true }, { headers: { 'x-halo-home-context': contextId('bob', 1) } });
  assert.equal(withHeader.status, 200);
  const body = await withHeader.json();
  assert.equal(body.count, plain.count);
  assert.deepEqual(body.preview, plain.preview);
  auditOwnerScope(h.db.queryLog, alice.id, 'inspect');
  for (const call of h.db.rpcCalls) {
    if ('p_profile_id' in call.args) assert.equal(call.args.p_profile_id, alice.id);
  }
  const text = JSON.stringify(body);
  for (const marker of markersOf('bob', bob)) assert.ok(!text.includes(marker), `bob's ${marker}`);
  const smuggled = await inspect(h, { scope: 'all', groups: [], privateText: false, profile_id: bob.id });
  assert.equal(smuggled.status, 400);
});

// ---------------------------------------------------------------------------
// The body (P15, P17)
// ---------------------------------------------------------------------------

test('a malformed body is a 400 the client reads as validation, and nothing is minted or recorded', async () => {
  const h = harness();
  const before = h.db.rows('operations');
  const bad = [
    { scope: 'export', groups: ['tasks'], privateText: false, extra: 1 },
    { scope: 'export', groups: ['tasks'], privateText: false, confirm: 'DELETE' },
    { scope: 'export', groups: ['everything'], privateText: false },
    { scope: 'export', groups: ['tasks', 'tasks'], privateText: false },
    { scope: 'journal', groups: ['tasks', 'tasks'], privateText: false },
    { scope: 'all', groups: ['nope'], privateText: false },
    { scope: 'export', groups: 'tasks', privateText: false },
    { scope: 'export', groups: ['tasks'], privateText: 'false' },
    { scope: 'export', groups: ['tasks'] },
    { groups: ['tasks'], privateText: false },
    { scope: 'everything', groups: ['tasks'], privateText: false },
    { scope: 'export', groups: [null], privateText: false },
  ];
  for (const body of bad) {
    const result = await opened(h, body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.failure, 'validation');
    assert.ok(!('reviewToken' in result.raw));
  }
  for (const rawBody of ['not json', '[]', '"export"']) {
    const response = await h.call(ROUTE, 'POST', { as: 'alice', rawBody });
    assert.equal(response.status, 400, rawBody);
  }
  ledgerUntouched(h, before);
});

test('an If-Match header is a 400: no privacy call sends one', async () => {
  const h = harness();
  const response = await inspect(h, { scope: 'journal', groups: [], privateText: false }, { headers: { 'if-match': '3' } });
  assert.equal(response.status, 400);
});

test('over 2,048 bytes is a 413', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'POST', { as: 'alice', rawBody: JSON.stringify({ scope: 'export', groups: ['tasks'], privateText: false, pad: 'x'.repeat(2100) }) });
  assert.equal(response.status, 413);
});

test('an Idempotency-Key present or absent makes no difference', async () => {
  const h = harness();
  const body = { scope: 'export', groups: ['tasks', 'preferences'], privateText: false };
  const withKey = await (await inspect(h, body)).json();
  const without = await (await h.call(ROUTE, 'POST', { as: 'alice', body })).json();
  const odd = await (await inspect(h, body, { headers: { 'idempotency-key': 'not-a-uuid' } })).json();
  for (const other of [without, odd]) {
    assert.equal(other.count, withKey.count);
    assert.deepEqual(other.preview, withKey.preview);
    assert.notEqual(other.reviewToken, withKey.reviewToken, 'each review is its own token');
  }
});

// ---------------------------------------------------------------------------
// Private text, D-P5 and stored content through the route
// ---------------------------------------------------------------------------

test('without private text the conversation is excluded in the preview, and the bands are named as left out', async () => {
  const h = harness();
  const { preview } = await (await inspect(h, { scope: 'export', groups: ['home', 'conversation'], privateText: false })).json();
  assert.deepEqual(preview.fields.conversation, { excluded: 'Private text was not selected.' });
  assert.ok(!('household_bands' in preview.fields.home));
  assert.ok(preview.manifest.omitted.some((item) => item.table === 'household_bands'));
});

test('the preview names the email field with preferences; the count includes the login; no server text has U+2014', async () => {
  const h = harness();
  const { preview, count } = await (await inspect(h, { scope: 'export', groups: ['preferences'], privateText: false })).json();
  assert.deepEqual(preview.fields.preferences['auth.users'], ['email']);
  assert.equal(preview.manifest.counts.preferences['auth.users'], 1);
  assert.ok(count >= 4);
  for (const scope of ['journal', 'all']) {
    const answer = await (await inspect(h, { scope, groups: [], privateText: false })).json();
    assert.ok(!JSON.stringify(answer.preview).includes(EM_DASH));
  }
  assert.ok(!JSON.stringify(preview).includes(EM_DASH));
});

// ---------------------------------------------------------------------------
// Size, tolerance and failures
// ---------------------------------------------------------------------------

function oversizeLuna(seeded, ids) {
  const conversation = seeded.luna_conversations.find((row) => row.profile_id === ids.alice.id);
  for (let n = 0; n < 25; n += 1) {
    seeded.luna_turns.push({
      id: `a11ce000-6666-4000-8000-${(200 + n).toString(16).padStart(12, '0')}`, conversation_id: conversation.id,
      profile_id: ids.alice.id, seq: 200 + n, role: 'user', body: 'y'.repeat(200_000), created_at: '2026-10-01T00:00:00Z',
    });
  }
}

test('an export over 4,000,000 bytes is a 422 export_too_large: the client\'s validation, nothing minted (P8)', async () => {
  const h = harness({ adjust: oversizeLuna });
  const before = h.db.rows('operations');
  const result = await opened(h, { scope: 'export', groups: ['conversation'], privateText: true });
  assert.equal(result.status, 422);
  assert.equal(result.raw.code, 'export_too_large');
  assert.equal(result.raw.retryable, false);
  assert.equal(result.failure, 'validation');
  assert.ok(!('reviewToken' in result.raw));
  assert.ok(!result.raw.message.includes(EM_DASH));
  ledgerUntouched(h, before);
  // Without private text the same household's export fits.
  const small = await opened(h, { scope: 'export', groups: ['conversation'], privateText: false });
  assert.equal(small.status, 200);
  // And a clear is never refused for size.
  assert.equal((await opened(h, { scope: 'all', groups: ['conversation'], privateText: true })).status, 200);
});

test('a table this deployment lacks still opens the review, with the warning in the manifest (P11)', async () => {
  const tables = Object.fromEntries(Object.entries(HALO_TABLES).filter(([name]) => name !== 'explore_areas'));
  const h = harness({ tables });
  const result = await opened(h, { scope: 'export', groups: ['explore', 'tasks'], privateText: false });
  assert.equal(result.status, 200);
  assert.ok(result.review);
  assert.equal(result.raw.preview.manifest.counts.explore.explore_areas, 0);
  assert.ok(result.raw.preview.manifest.warnings.includes(EXPORT_COPY.missingTable('explore_areas')));
});

test('a read that fails for any other reason is a 500 with nothing minted and nothing recorded; the log has no id', async (t) => {
  const errors = muteConsoleError(t);
  const h = harness();
  const before = h.db.rows('operations');
  const realFrom = h.db.from;
  h.db.from = (name) => {
    const builder = realFrom(name);
    if (name === 'symptom_logs') builder.limit = () => ({ then: (resolve) => resolve({ data: null, count: null, error: pgError('57014', 'canceling statement due to statement timeout') }) });
    return builder;
  };
  const result = await opened(h, { scope: 'export', groups: ['journal'], privateText: true });
  assert.equal(result.status, 500);
  assert.equal(result.failure, 'unknown_outcome');
  assert.ok(!('reviewToken' in result.raw));
  h.db.from = realFrom;
  ledgerUntouched(h, before);
  const logged = JSON.stringify(errors.mock.calls.map((call) => call.arguments));
  assert.ok(logged.includes('57014'));
  assert.ok(!logged.includes(h.identities.alice.id));
});

test('a failing privacy_counts or fingerprint is a 500, and a missing one a 503, each with nothing minted', async (t) => {
  muteConsoleError(t);
  const h = harness();
  h.db.registerRpc('privacy_counts', () => { throw pgError('57014', 'timeout'); }, { args: ['p_profile_id', 'p_scope'] });
  const failed = await inspect(h, { scope: 'all', groups: [], privateText: false });
  assert.equal(failed.status, 500);
  assert.ok(!('reviewToken' in (await failed.json())));
  const missing = harness();
  missing.db.registerRpc('privacy_fingerprint', () => { throw pgError('PGRST202', 'Could not find the function'); }, { args: ['p_profile_id', 'p_tables'] });
  const gone = await inspect(missing, { scope: 'journal', groups: [], privateText: false });
  assert.equal(gone.status, 503);
  assert.ok(!('reviewToken' in (await gone.json())));
});

// ---------------------------------------------------------------------------
// The limiter (P17): shared key, 429, fail-open
// ---------------------------------------------------------------------------

test('a household over its privacy budget gets 429, the client\'s rate_limited, keyed by the household', async () => {
  const keys = [];
  const h = harness({ rateLimit: (key) => { keys.push(key); return false; } });
  const before = h.db.rows('operations');
  const result = await opened(h, { scope: 'export', groups: ['tasks'], privateText: false });
  assert.equal(result.status, 429);
  assert.equal(result.failure, 'rate_limited');
  assert.deepEqual(keys, [`privacy:${h.identities.alice.id}`]);
  assert.ok(!h.db.rpcCalls.some((call) => call.name === 'privacy_fingerprint'), 'nothing was read past the limit');
  ledgerUntouched(h, before);
});

test('an Upstash outage does not stop a review: the limiter fails OPEN (200)', async (t) => {
  const errors = muteConsoleError(t);
  const h = harness({ rateLimit: () => LIMITER_UNAVAILABLE });
  const result = await opened(h, { scope: 'all', groups: [], privateText: false });
  assert.equal(result.status, 200);
  assert.ok(result.review);
  assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes('privacy limiter unavailable') && String(call.arguments[0]).includes('allowing')));
});

// ---------------------------------------------------------------------------
// Availability (P11) and the session
// ---------------------------------------------------------------------------

const UNAVAILABLE = [
  ['no review key', { env: {} }],
  ['a 31-character key', { env: { HALO_PRIVACY_REVIEW_KEY: 'x'.repeat(31) } }],
  ['a key of spaces', { env: { HALO_PRIVACY_REVIEW_KEY: ' '.repeat(40) } }],
  ['0024 not applied (no probe function)', { functions: false }],
  ['a different 0024 version', { version: 2 }],
];
for (const [label, options] of UNAVAILABLE) {
  test(`${label}: a non-retryable 503 feature_unavailable, nothing read, nothing minted, nothing recorded`, async () => {
    const h = harness(options);
    const before = h.db.rows('operations');
    h.db.queryLog.length = 0;
    for (const scope of ['export', 'journal', 'all']) {
      const response = await inspect(h, { scope, groups: ['tasks'], privateText: false });
      assert.equal(response.status, 503, scope);
      const body = await response.json();
      assert.equal(body.code, 'feature_unavailable');
      assert.equal(body.retryable, false);
      assert.ok(!('reviewToken' in body));
    }
    assert.equal(h.db.queryLog.length, 0, 'no table was read');
    assert.ok(!h.db.rpcCalls.some((call) => call.name === 'privacy_fingerprint' || call.name === 'privacy_counts'));
    ledgerUntouched(h, before);
  });
}

test('no session is a 401, before anything else', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'POST', { body: { scope: 'all', groups: [], privateText: false } });
  assert.equal(response.status, 401);
  assert.equal(h.db.rpcCalls.length, 0);
});

test('maxDuration is 60, under the ledger\'s 120 s window (P17)', async () => {
  const route = await import('../app/api/privacy/export/inspect/route.js');
  assert.equal(route.maxDuration, 60);
});

test('no inspect writes an operations row: success, refusal, size, failure and unavailability alike (trap P-2)', async (t) => {
  muteConsoleError(t);
  const worlds = [harness(), harness({ adjust: oversizeLuna }), harness({ rateLimit: () => false }), harness({ env: {} })];
  for (const h of worlds) {
    const before = h.db.rows('operations');
    for (const body of [
      { scope: 'export', groups: [...EXPORT_GROUPS], privateText: true },
      { scope: 'journal', groups: [], privateText: false },
      { scope: 'all', groups: [], privateText: false },
      { scope: 'export', groups: [], privateText: false },
    ]) await inspect(h, body);
    ledgerUntouched(h, before);
  }
});

test('nothing leaves the process: no fetch from any inspect (the email is the provider client, not a fetch)', async () => {
  const h = harness();
  for (const scope of ['export', 'journal', 'all']) {
    await inspect(h, { scope, groups: [...EXPORT_GROUPS], privateText: true });
  }
  assert.deepEqual(h.blockedFetches, []);
});
