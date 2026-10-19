/**
 * B04 settings and alerts: the executable contract, and conformance of the
 * REAL handlers to it and to the frontend's own validators and client logic.
 *
 * The per-route suites (test/routesSettings.test.mjs,
 * test/routesAlertsState.test.mjs) prove each route right on its own terms.
 * What none of them proves is that the five operations agree:
 *
 *   - with the frontend, whose validators (validSettingsSnapshot,
 *     validAlertSnapshot, alertReceiptCovers) discard a whole snapshot, inbox
 *     or receipt on one wrong field, and whose hooks lock a whole surface on
 *     one listed unresolved operation;
 *   - with EACH OTHER. A settings save is sent with the revision a read gave,
 *     and its receipt's revision is the next If-Match. A parked save or alerts
 *     change is reconciled through operations.read, which must carry the live
 *     unresolved list of its domain without the operation itself (Ruling S16)
 *     while the ledger keeps [] (Ruling S14). A divergence between two of them
 *     is a defect even with every route's own suite green;
 *   - with the document, `docs/backend/contracts/b04.openapi.json`, which is
 *     what a reader will believe.
 *
 * The client code is TRANSCRIBED, not summarised, in
 * test/helpers/frontendB04.mjs (one copy, shared with the per-route suites;
 * its header names every source line on
 * `origin/codex/october15-review-refinement`). A transcription that always
 * said yes would pass every body here, so `the transcriptions reject what the
 * client rejects` shows each of them saying no.
 *
 * Structure, in order: the schemas against the fixtures, the contract's own
 * coverage, the transcriptions' self-checks, the fixtures against the
 * transcriptions, the real handlers against both, cross-route agreement, the
 * fixture hygiene scan, and the two directions of header documentation (last,
 * because they report on what ran before them).
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * database with 0021's save_settings and triggers stood in by
 * test/helpers/fakeSettingsDb.mjs, and a fetch that rejects every host. No
 * real Supabase project, no provider, no production URL. Migration 0021 is
 * applied nowhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { HALO_TABLES, haloTables } from './helpers/tables.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { SETTINGS } from './helpers/isolationSeed.mjs';
import { installSettingsDb } from './helpers/fakeSettingsDb.mjs';
import {
  RUNTIME_MESSAGES, alertReceiptCovers, productionAlerts, productionPreferences, validAlertSnapshot, validSettingsSnapshot,
} from './helpers/frontendB04.mjs';

const { requestHash } = await import('@/lib/operations');
const { BAND_KEYS } = await import('../lib/household.js');

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b04.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b04', components: contract.components });
const operations = new Map(
  Object.entries(contract.paths).flatMap(([path, verbs]) =>
    Object.entries(verbs).map(([method, op]) => [op.operationId, { ...op, path, method: method.toUpperCase() }])),
);
const validators = new Map();
function compiled(ref) {
  if (!validators.has(ref)) validators.set(ref, ajv.compile({ $ref: `urn:halo:b04${ref}` }));
  return validators.get(ref);
}
const schema = (name) => compiled(`#/components/schemas/${name}`);
/** The documented response for this operation and status, applied to a real or fixture body. */
function validate(operationId, status, body) {
  const op = operations.get(operationId);
  assert.ok(op, `unknown operation ${operationId}`);
  const response = op.responses[String(status)];
  assert.ok(response, `${operationId}: undocumented status ${status}`);
  const check = compiled(response.content['application/json'].schema.$ref);
  assert.equal(check(body), true, `${operationId} ${status}: ${ajv.errorsText(check.errors)}`);
}
/** The documented REQUEST body, applied to one a test is about to send. */
function validateRequest(operationId, body) {
  const ref = operations.get(operationId).requestBody?.content['application/json'].schema.$ref;
  assert.ok(ref, `${operationId} documents no request body`);
  const check = compiled(ref);
  assert.equal(check(body), true, `${operationId} request: ${ajv.errorsText(check.errors)}`);
}

const directory = new URL('../docs/backend/contracts/fixtures/b04/', import.meta.url);
const fixtures = await Promise.all(
  (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, directory), 'utf8')) })),
);
const fixture = (name) => {
  const found = fixtures.find((item) => item.name === name);
  assert.ok(found, `fixture ${name}`);
  return structuredClone(found.body);
};

const EM_DASH = String.fromCharCode(0x2014);
/** On every B04 body: no top-level data key (runtime.ts:149 would unwrap it), no U+2014 literal or escaped. */
function assertBare(body, label) {
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), `${label}: an object body`);
  assert.equal(Object.hasOwn(body, 'data'), false, `${label}: no top-level data key (the client would unwrap it, runtime.ts:149-153)`);
  const text = JSON.stringify(body);
  assert.equal(text.includes(EM_DASH), false, `${label}: no U+2014`);
  assert.equal(text.includes('\\u2014'), false, `${label}: no escaped U+2014`);
}

for (const item of fixtures) {
  test(`B04 fixture: ${item.name}`, () => {
    validate(item.operationId, item.status, item.body);
    assertBare(item.body, item.name);
  });
}

// ---------------------------------------------------------------------------
// The contract's own coverage
// ---------------------------------------------------------------------------

const SETTINGS_REASONS = ['stale_revision', 'home_changed', 'operation_mismatch', 'operation_failed', 'operation_abandoned'];
const ALERTS_REASONS = ['stale_selection', 'operation_mismatch', 'operation_failed', 'operation_abandoned', 'operation_cancelled'];

test('B04 contract covers the four built operations and the reconcile, every documented status has a fixture, and the dropped ones are absent', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, 'b04-1');
  assert.deepEqual([...operations.keys()].sort(), ['alertsRead', 'alertsUpdate', 'operationsRead', 'settingsRead', 'settingsSave']);
  assert.deepEqual([...operations.values()].map((op) => op['x-halo-operation']).sort(), [
    'alerts.read', 'alerts.update', 'operations.read', 'settings.read', 'settings.save',
  ], 'each names its frontend registry operation');
  // Dropped before execution: documenting either would be a claim this package cannot support.
  for (const path of ['/api/capabilities', '/api/evidence']) assert.equal(path in contract.paths, false, `${path} is not built and must not be documented`);
  assert.match(contract.info.description, /capabilities\.read/);
  assert.match(contract.info.description, /evidence\.read/);
  for (const [id, op] of operations) {
    for (const status of Object.keys(op.responses)) {
      assert.ok(fixtures.some((item) => item.operationId === id && String(item.status) === status), `${id} is missing a ${status} fixture`);
    }
    assert.ok(
      fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'auth_unavailable' && item.body.retryable === true),
      `${id} is missing the retryable auth-outage fixture`,
    );
    assert.ok(op.responses['401'] && op.responses['503'], `${id}: sign-in is required, so 401 and the auth outage are documented`);
  }
  // Ruling S10: settings is unavailable before 0021, the alerts read never is.
  for (const id of ['settingsRead', 'settingsSave', 'alertsUpdate', 'operationsRead']) {
    assert.ok(
      fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'feature_unavailable' && item.body.retryable === false),
      `${id} is missing the non-retryable feature-unavailable fixture`,
    );
  }
  assert.equal(fixtures.some((item) => item.operationId === 'alertsRead' && item.body.code === 'feature_unavailable'), false, 'alerts.read never answers 503 for a migration');
  assert.match(operations.get('alertsRead').responses['503'].description, /Never for a missing migration/);
  const degraded = fixture('alertsRead-before-0021.json');
  assert.deepEqual(Object.keys(degraded).sort(), ['alerts', 'count', 'truncated', 'unread'], 'before 0021: every legacy key, and nothing else');

  // Every 409 reason each mutation can give is documented, enumerated and fixtured.
  for (const [id, name, reasons] of [['settingsSave', 'SettingsConflict', SETTINGS_REASONS], ['alertsUpdate', 'AlertsConflict', ALERTS_REASONS]]) {
    assert.deepEqual([...contract.components.schemas[name].properties.reason.enum].sort(), [...reasons].sort(), name);
    const described = operations.get(id).responses['409'].description;
    for (const reason of reasons) {
      assert.ok(described.includes(reason), `${id}: the 409 description names ${reason}`);
      assert.ok(fixtures.some((item) => item.operationId === id && item.status === 409 && item.body.reason === reason), `${id}: a ${reason} fixture`);
    }
  }

  // Request headers, with the rule each carries.
  const params = (id) => Object.fromEntries((operations.get(id).parameters ?? []).filter((p) => p.in === 'header').map((p) => [p.name, p]));
  const save = params('settingsSave');
  assert.equal(save['If-Match']?.required, true);
  assert.match(save['If-Match'].description, /next If-Match/);
  assert.equal(save['Idempotency-Key']?.schema.format, 'uuid');
  assert.match(save['X-Halo-Home-Context'].description, /IGNORED/);
  const update = params('alertsUpdate');
  assert.deepEqual(Object.keys(update), ['Idempotency-Key'], 'alerts.update carries its revisions in the selection: no If-Match');

  // The S14 and S16 shapes are stated where a reader looks for them.
  assert.match(contract.components.schemas.SettingsReceipt.description, /\[\] there \(Ruling S14\)/);
  assert.match(contract.components.schemas.AlertReceipt.description, /carries \[\] \(Ruling S14\)/);
  assert.match(contract.components.schemas.OperationRecord.description, /snapshot\.unresolvedOperations for settings.*top level for alerts/);
  assert.match(contract.components.schemas.UnresolvedOperations.description, /A LOCK, not a log/);
  // The nit 1 shape: a failed receipt answers the first call, a 409 the replay.
  assert.match(operations.get('settingsSave').responses['409'].description, /first call of a reaped save is not a 409 but a 200 failed receipt/);
  assert.deepEqual(fixture('settingsSave-not-applied.json'), { operationId: fixture('settingsSave-not-applied.json').operationId, status: 'failed' });

  for (const [name, item] of Object.entries(contract.components.schemas)) {
    assert.equal(Object.hasOwn(item.properties ?? {}, 'data'), false, `${name} declares no data property`);
  }
  assert.equal(JSON.stringify(contract).includes(EM_DASH), false, 'no U+2014 anywhere in the document');
});

test('B04 schemas reject the drift that would lock a surface, lose a draft, or tell somebody something false', () => {
  const snapshot = schema('SettingsSnapshot');
  const shown = fixture('settingsRead-success.json');
  assert.equal(snapshot(shown), true);
  assert.equal(snapshot({ ...shown, revision: 0 }), false, 'the client refuses revision 0');
  assert.equal(snapshot({ ...shown, display: { ...shown.display, palette: null } }), false, 'palette is left out, never null');
  assert.equal(snapshot({ ...shown, values: { ...shown.values, home: { ...shown.values.home, tenure: null } } }), false, 'unanswered is other, never null (S8)');
  const { unresolvedOperations, ...noLock } = shown;
  assert.deepEqual(unresolvedOperations, []);
  assert.equal(snapshot(noLock), false, 'the lock list is required');
  assert.equal(snapshot({ data: shown }), false, 'never wrapped');

  const receipt = schema('SettingsReceipt');
  const saved = fixture('settingsSave-success.json');
  assert.equal(receipt(saved), true);
  assert.equal(receipt({ operationId: saved.operationId, status: 'succeeded' }), false, 'a success carries its snapshot');
  assert.equal(receipt({ ...saved, status: 'failed' }), false, 'a failed receipt carries no snapshot');
  assert.equal(receipt({ operationId: saved.operationId, status: 'failed' }), true);

  const settingsConflict = schema('SettingsConflict');
  const stale = fixture('settingsSave-stale-revision.json');
  assert.equal(settingsConflict(stale), true);
  const { revision, ...noRevision } = stale;
  assert.ok(revision >= 1);
  assert.equal(settingsConflict(noRevision), false, 'a stale revision carries the current one');
  assert.equal(settingsConflict({ ...stale, reason: 'operation_abandoned' }), false, 'a replay reason compared no revision, so it carries none');
  assert.equal(settingsConflict({ ...noRevision, reason: 'stale_selection' }), false, 'an alerts reason');

  const read = schema('AlertsRead');
  const inbox = fixture('alertsRead-success.json');
  assert.equal(read(inbox), true);
  assert.equal(read(fixture('alertsRead-before-0021.json')), true, 'the degraded read is documented');
  const { unresolvedOperations: lock, ...noInventory } = inbox;
  assert.ok(Array.isArray(lock));
  assert.equal(read(noInventory), false, 'items and unresolvedOperations come together, or the lock state is unknown');
  const { alerts, ...noLegacy } = inbox;
  assert.ok(Array.isArray(alerts));
  assert.equal(read(noLegacy), false, 'the legacy list StageSession reads stays');

  const item = schema('AlertItem');
  const row = inbox.items[0];
  assert.equal(item(row), true);
  assert.equal(item({ ...row, target: { tab: 'today', destination: 'tests' } }), false, 'today admits no destination');
  assert.equal(item({ ...row, target: { tab: 'home', destination: 'recap' } }), false, 'recap is a plan destination');
  assert.equal(item({ ...row, category: 'home' }), false);
  assert.equal(item({ ...row, revision: 0 }), false);
  assert.equal(item({ ...row, source: { title: 'x', url: 'https://example.test/' } }), false, 'source is never sent');

  const alertsConflict = schema('AlertsConflict');
  const refused = fixture('alertsUpdate-stale-selection.json');
  assert.equal(alertsConflict(refused), true);
  assert.equal(alertsConflict({ ...refused, revision: 2 }), false, 'no revision on an alerts refusal');
  assert.equal(alertsConflict({ ...refused, reason: 'stale_revision' }), false, 'a settings reason');

  const record = schema('OperationRecord');
  const reconciled = fixture('operationsRead-settings-succeeded.json');
  assert.equal(record(reconciled), true);
  const { snapshot: gone, ...noSnapshot } = reconciled;
  assert.ok(gone);
  assert.equal(record(noSnapshot), false, 'a succeeded settings reconcile carries its snapshot');
  assert.equal(record({ ...reconciled, items: [] }), false, 'and no inbox');
  assert.equal(record({ ...reconciled, status: 'failed' }), false, 'a failed one carries no snapshot');
  const alertsDone = fixture('operationsRead-alerts-succeeded.json');
  assert.equal(record(alertsDone), true);
  assert.equal(record({ ...alertsDone, snapshot: reconciled.snapshot }), false);
  assert.equal(record({ ...alertsDone, reason: 'abandoned' }), false, 'a success has no failure reason');
  assert.equal(record({ ...fixture('operationsRead-settings-abandoned.json'), reason: 'stale_selection' }), false, 'settings never refuses a selection');
});

// ---------------------------------------------------------------------------
// The transcriptions say no
// ---------------------------------------------------------------------------

test('the transcriptions reject what the client rejects', () => {
  const shown = fixture('settingsRead-success.json');
  assert.equal(validSettingsSnapshot(shown), true);
  const broken = (edit) => { const copy = structuredClone(shown); edit(copy); return copy; };
  for (const [value, why] of [
    [broken((v) => { v.revision = 0; }), 'revision 0'],
    [broken((v) => { v.revision = '4'; }), 'a string revision'],
    [broken((v) => { v.unresolvedOperations = ['']; }), 'a blank operation id'],
    [broken((v) => { delete v.unresolvedOperations; }), 'no lock list'],
    [broken((v) => { v.display.palette = null; }), 'a null palette'],
    [broken((v) => { v.values.home.tenure = null; }), 'a null tenure'],
    [broken((v) => { v.values.home.year = '75'; }), 'a two-digit year'],
    [broken((v) => { v.values.quiet.from = '7:00'; }), 'a clock without its leading zero'],
    [broken((v) => { v.values.quiet.zone = 'Mars/Olympus'; }), 'a zone Intl does not know'],
    [broken((v) => { delete v.values.notifications.radon_season; }), 'a missing switch'],
    [broken((v) => { v.display.scale = 115; }), 'a numeric scale'],
    [broken((v) => { v.calendar.linked = 'false'; }), 'a string boolean'],
  ]) assert.equal(validSettingsSnapshot(value), false, `validSettingsSnapshot: ${why}`);

  const inbox = fixture('alertsRead-success.json');
  assert.equal(validAlertSnapshot(inbox), true);
  const [row] = inbox.items;
  for (const [value, why] of [
    [{ ...inbox, items: [row, row] }, 'duplicate ids'],
    [{ items: inbox.items }, 'no inventory'],
    [{ ...inbox, items: [{ ...row, date: '2026-02-30' }] }, 'an impossible date'],
    [{ ...inbox, items: [{ ...row, target: { tab: 'today', destination: 'tests' } }] }, 'a destination today does not have'],
    [{ ...inbox, items: [{ ...row, kind: 'air_quality' }] }, 'an unmapped kind'],
    [{ ...inbox, items: [{ ...row, title: '' }] }, 'a blank title'],
    [{ ...inbox, items: [{ ...row, source: { title: 'x', url: 'https://user:pw@example.test/' } }] }, 'credentials in a source url'],
    [fixture('alertsRead-before-0021.json'), 'the degraded read (S10)'],
  ]) assert.equal(validAlertSnapshot(value), false, `validAlertSnapshot: ${why}`);

  const covered = fixture('alertsUpdate-success.json');
  const selected = [{ id: covered.items[0].id, revision: covered.items[0].revision - 1 }];
  assert.equal(alertReceiptCovers(covered, selected, { read: true }), true);
  assert.equal(alertReceiptCovers(covered, [{ ...selected[0], revision: covered.items[0].revision }], { read: true }), false, 'an equal revision does not cover');
  assert.equal(alertReceiptCovers(covered, selected, { read: false }), false, 'the patched field must equal the patch');
  assert.equal(alertReceiptCovers(covered, [], { read: true }), false, 'an empty selection covers nothing');
});

/**
 * What the client does with a 200 body of each operation. True means the
 * client handles it as designed: applies it, says "not applied", or parks it
 * to reconcile. False means it refuses it as unverifiable.
 */
const CLIENT = Object.freeze({
  settingsRead: (body) => validSettingsSnapshot(body),
  settingsSave: (body) => typeof body.operationId === 'string' && !!body.operationId
    && (body.status === 'succeeded' ? validSettingsSnapshot(body.snapshot) : ['pending', 'unknown', 'failed', 'cancelled'].includes(body.status)),
  alertsRead: (body) => validAlertSnapshot(body),
  alertsUpdate: (body) => typeof body.operationId === 'string' && !!body.operationId
    && (body.status === 'succeeded' ? validAlertSnapshot(body) : ['pending', 'unknown'].includes(body.status)),
  operationsRead: (body) => typeof body.operationId === 'string' && !!body.operationId
    && (body.status !== 'succeeded' || (body.domain === 'settings' ? validSettingsSnapshot(body.snapshot) : validAlertSnapshot(body))),
});

test('every success fixture is a payload the client handles, the degraded alerts read is refused as designed, and no error fixture could be mistaken for one', () => {
  let checked = 0;
  for (const item of fixtures) {
    const accepted = CLIENT[item.operationId](item.body);
    if (item.status !== 200) {
      assert.equal(accepted, false, `${item.name}: an error envelope must not pass as a payload`);
      continue;
    }
    checked += 1;
    // Ruling S10: the read before 0021 is served, and the client says it could not be verified, which is true.
    const expected = item.name !== 'alertsRead-before-0021.json';
    assert.equal(accepted, expected, `${item.name}: the client ${expected ? 'would refuse' : 'must refuse'} this fixture`);
  }
  assert.ok(checked >= 14, `every success fixture was checked, got ${checked}`);
});

// ---------------------------------------------------------------------------
// The harness: the real handlers
// ---------------------------------------------------------------------------

const REQUEST_ID = 'b04-conformance-0001';
const uuid = (n) => `0b040000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A1 = 'a11ce000-0404-4000-8000-000000000001';
const A2 = 'a11ce000-0404-4000-8000-000000000002';
const A3 = 'a11ce000-0404-4000-8000-000000000003';
const B1 = 'b0b00000-0404-4000-8000-000000000001';
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * alice has saved settings (revision 4) and three alerts; bob has never
 * opened settings and has one alert. `operations` rows are alice's unless
 * they say `profile_id: 'bob'`.
 */
function harness({ tables = HALO_TABLES, operations: ledger = [], identities } = {}) {
  const h = createRouteHarness({
    tables,
    ...(identities ? { identities } : {}),
    seed: ({ alice, bob }) => Object.fromEntries(Object.entries({
      profiles: [
        { id: alice.id, home_year: 1975, water_source: 'well', locale: 'en', renter_mode: false, tenure: 'owner' },
        { id: bob.id, home_year: null, water_source: null, locale: 'en', renter_mode: false, tenure: null },
      ],
      profile_preferences: [{ profile_id: alice.id, ...SETTINGS.alice }],
      notification_prefs: [{ profile_id: alice.id, weather_advisory: false }],
      household_bands: [{ profile_id: alice.id, has_adult: true }],
      alerts: [
        { id: A1, profile_id: alice.id, type: 'air_quality_change', severity: 'elevated', title: 'Air quality dropped', message: 'Air quality dropped to Elevated today.', dedupe_key: 'c-1', fired_at: '2026-10-14T13:00:00Z' },
        { id: A2, profile_id: alice.id, type: 'radon_season', title: 'Time to test for radon', message: 'Winter is the most accurate time to test for radon.', dedupe_key: 'c-2', read: true, fired_at: '2026-10-13T13:00:00Z' },
        { id: A3, profile_id: alice.id, type: 'season_summary', title: 'Your summer summary is ready', message: 'You logged 12 days.', dedupe_key: 'c-3', dismissed: true, revision: 2, fired_at: '2026-10-12T13:00:00Z' },
        { id: B1, profile_id: bob.id, type: 'weather_advisory', title: 'Heat advisory', message: 'A heat advisory is in effect.', dedupe_key: 'c-4', fired_at: '2026-10-14T13:00:00Z' },
      ],
      operations: ledger.map((row) => ({ created_at: ago(1000), result: null, ...row, profile_id: row.profile_id === 'bob' ? bob.id : alice.id })),
    }).filter(([table]) => Object.hasOwn(tables, table))),
  });
  installSettingsDb(h.db);
  return h;
}
const allBut = (...missing) => haloTables(...Object.keys(HALO_TABLES).filter((name) => !missing.includes(name)));

// Response headers: both directions, for the pairs exercised below (as B03 and B05).
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

// Request headers: every header a test sends beyond the transport ones must be
// a documented parameter of that operation, and every documented header
// parameter must be sent by some exercised request.
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

/** One call to a real handler, checked against the document, the request id, the bare-body rule and the client. */
async function call(h, id, { expected = 200, query = '', body, rawBody, as = 'alice', headers = {}, clientRefuses = false } = {}) {
  const op = operations.get(id);
  const sent = { 'x-request-id': REQUEST_ID, ...headers };
  recordRequestHeaders(id, sent);
  const res = await h.call(op.path, op.method, { as, url: `${op.path}${query}`, body, rawBody, headers: sent });
  assert.equal(res.status, expected, `${id}${query}: expected ${expected}, got ${res.status}`);
  assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${id}: the request id is echoed`);
  recordHeaders(id, res);
  const json = await res.json();
  validate(id, res.status, json);
  assertBare(json, `${id} ${res.status}`);
  if (expected >= 400) {
    assert.equal(json.request_id, REQUEST_ID);
    assert.equal(/supabase|postgres|PGRST|42P01|42703|profile_preferences|bearer|failing row/i.test(JSON.stringify(json)), false, `${id} ${expected}: nothing proof-bearing in an error envelope`);
  } else {
    // Only the degraded alerts read is refused, by design (Ruling S10): the client says it could not be verified.
    assert.equal(CLIENT[id](json), !clientRefuses, `${id}: the client would ${clientRefuses ? 'accept' : 'refuse'} this payload: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { body: json, res };
}

const readSettings = (h, options = {}) => call(h, 'settingsRead', options);
/** A save as the workspace builds it (SettingsWorkspace.tsx:88-90), its body validated as documented. */
function saveSettings(h, snapshot, group, { edit, key = uuid(1), revision = snapshot.revision, ifMatch = String(revision), expected = 200, as = 'alice', headers = {} } = {}) {
  const values = structuredClone(snapshot.values);
  if (edit) edit(values);
  const body = { group, values, operationId: key };
  if (group === 'home') body.household = { ...Object.fromEntries(BAND_KEYS.map((name) => [name, false])), has_adult: true };
  if (group === 'display') {
    const { scale, motion, contrast, appearance, ambient } = snapshot.display;
    body.display = { scale, motion, contrast, palette: snapshot.display.palette ?? 'ocean', appearance, ambient };
    body.calendar = { ...snapshot.calendar };
  }
  validateRequest('settingsSave', body);
  return call(h, 'settingsSave', {
    as,
    body,
    expected,
    headers: { 'idempotency-key': key, ...(ifMatch === null ? {} : { 'if-match': ifMatch }), ...headers },
  });
}
const toggleLuna = (values) => { values.luna.home = !values.luna.home; };
/** An alerts change as the hook sends it (ProductionAlerts.tsx:17), its body validated as documented. */
function updateAlerts(h, selection, patch, { key = uuid(1), expected = 200, as = 'alice' } = {}) {
  const body = { operationId: key, selection, patch };
  validateRequest('alertsUpdate', body);
  return call(h, 'alertsUpdate', { as, body, expected, headers: { 'idempotency-key': key } });
}
const reconcile = (h, operationId, domain, options = {}) =>
  call(h, 'operationsRead', { query: `?${new URLSearchParams({ operationId, domain })}`, ...options });
const outage = (h) => { h.forceAuthOutage(); return h; };
async function authOutage(h, id, options) {
  const { res, body } = await call(outage(h), id, { ...options, expected: 503 });
  assert.equal(body.code, 'auth_unavailable');
  assert.equal(res.headers.get('retry-after'), '2');
}
async function unavailable(h, id, options) {
  const { res, body } = await call(h, id, { ...options, expected: 503 });
  assert.deepEqual([body.code, body.retryable, res.headers.get('retry-after')], ['feature_unavailable', false, null]);
}
/** The ledger hash of a luna save at `revision` with these switches (routes/settings, input { group, patch, expectedRevision }). */
const lunaHash = (luna, revision) => requestHash({ group: 'luna', patch: { luna }, expectedRevision: revision });
/** A query that answers a plain database error however it is chained. */
function failingQuery() {
  const answer = { data: null, count: null, error: { code: 'XX000', message: 'contractsB04: boom' } };
  const query = new Proxy({}, { get: (_, property) => (property === 'then' ? (ok, ko) => Promise.resolve(answer).then(ok, ko) : () => query) });
  return query;
}
/** Every statement on `table`, or only its `method` statements, fails with a plain database error. */
function breakTable(h, table, method) {
  const from = h.db.from;
  h.db.from = (name) => {
    if (name !== table) return from(name);
    if (!method) return failingQuery();
    const builder = from(name);
    builder[method] = failingQuery;
    return builder;
  };
}
/** The reaper settles this save's row between the claim and save_settings, once (routesSettings, nit 1). */
function reapBeforeSave(h) {
  const rpc = h.db.rpc;
  h.db.rpc = async (name, args) => {
    if (name === 'save_settings') {
      h.db.rpc = rpc;
      await h.db.from('operations').update({ status: 'failed', result: { status: 'failed', reason: 'abandoned' } })
        .eq('operation_id', args.p_operation_id).eq('status', 'pending');
    }
    return rpc(name, args);
  };
}

// ---------------------------------------------------------------------------
// Handler conformance: every state each route can answer with
// ---------------------------------------------------------------------------

test('B04 handler conformance: settings.read answers a saved household, a never-saved one at revision 1, the lock list, and every error', async (t) => {
  muteConsoleError(t);
  const PENDING = uuid(11);
  const h = harness({ operations: [{ operation_id: PENDING, domain: 'settings', kind: 'settings.save', status: 'pending' }, { operation_id: uuid(12), domain: 'alerts', kind: 'alerts.update', status: 'pending' }] });
  const { body: alice } = await readSettings(h, { headers: { 'x-halo-home-context': uuid(999) } });
  assert.equal(alice.revision, 4);
  assert.deepEqual(alice.unresolvedOperations, [PENDING], 'the household\'s pending settings operations only (Ruling S1)');
  const { body: bob } = await readSettings(h, { as: 'bob' });
  assert.equal(bob.revision, 1);
  assert.deepEqual([bob.values.home.tenure, bob.values.luna, bob.calendar.linked, Object.hasOwn(bob.display, 'palette')], ['other', { tasks: false, home: false, projects: false }, false, false], 'Rulings S8 and S9');
  await readSettings(h, { as: null, expected: 401 });
  const carol = harness({ identities: { alice: {}, bob: {}, carol: {} } });
  await readSettings(carol, { as: 'carol', expected: 404 });
  const broken = harness();
  breakTable(broken, 'profile_preferences');
  await readSettings(broken, { expected: 500 });
  await unavailable(harness({ tables: allBut('profile_preferences') }), 'settingsRead');
  await unavailable(harness({ tables: allBut('operations') }), 'settingsRead');
  const noTenure = harness();
  withoutColumn(noTenure.db, 'profiles', 'tenure', '42703');
  await unavailable(noTenure, 'settingsRead');
  await authOutage(harness(), 'settingsRead');
});

test('B04 handler conformance: settings.save answers a receipt, a replay, the not-applied first call, and every documented refusal', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: shown } = await readSettings(h);
  const { body: saved } = await saveSettings(h, shown, 'luna', { edit: toggleLuna, headers: { 'x-halo-home-context': uuid(999) } });
  assert.deepEqual([saved.status, saved.snapshot.revision, saved.snapshot.unresolvedOperations], ['succeeded', 5, []]);
  const { body: replayed } = await saveSettings(h, shown, 'luna', { edit: toggleLuna });
  assert.deepEqual(replayed, saved, 'the same key and body is the first outcome');
  for (const group of ['home', 'notifications', 'display']) {
    const { body: current } = await readSettings(h);
    await saveSettings(h, current, group, { key: uuid(20 + group.length) });
  }

  const reasons = {};
  reasons.stale_revision = (await saveSettings(h, shown, 'luna', { key: uuid(2), expected: 409 })).body;
  assert.equal(reasons.stale_revision.revision, (await readSettings(h)).body.revision, 'and says which revision is current');
  reasons.operation_mismatch = (await saveSettings(h, shown, 'luna', { expected: 409 })).body;

  const homeChanged = harness();
  homeChanged.db.seed('home_contexts', [{ id: uuid(30), profile_id: homeChanged.identities.alice.id, sequence: 1, revision: 3, effective_to: null }]);
  homeChanged.db.registerRpc('update_home_context_attributes', () => { throw rpcError('P0001', 'HALO_STALE_REVISION', '{"revision": 4}'); });
  t.mock.method(console, 'warn', () => {});
  const { body: before } = await readSettings(homeChanged);
  reasons.home_changed = (await saveSettings(homeChanged, before, 'home', { edit: (v) => { v.home.year = '1999'; }, expected: 409 })).body;

  // A save that throws in process is a 500 the first time and a terminal operation_failed on replay.
  const failing = harness();
  const { body: failingShown } = await readSettings(failing);
  const rpc = failing.db.rpc;
  failing.db.rpc = async (name, args) => (name === 'save_settings' ? { data: null, error: { code: 'XX000', message: 'contractsB04: boom' } } : rpc(name, args));
  await saveSettings(failing, failingShown, 'luna', { key: uuid(3), edit: toggleLuna, expected: 500 });
  failing.db.rpc = rpc;
  reasons.operation_failed = (await saveSettings(failing, failingShown, 'luna', { key: uuid(3), edit: toggleLuna, expected: 409 })).body;

  // The reaper got there first: the first call is a 200 failed receipt (nit 1), the replay a 409.
  const reaped = harness();
  const { body: reapedShown } = await readSettings(reaped);
  reapBeforeSave(reaped);
  const { body: notApplied } = await saveSettings(reaped, reapedShown, 'luna', { key: uuid(4), edit: toggleLuna });
  assert.deepEqual(notApplied, { operationId: uuid(4), status: 'failed' });
  reasons.operation_abandoned = (await saveSettings(reaped, reapedShown, 'luna', { key: uuid(4), edit: toggleLuna, expected: 409 })).body;
  for (const reason of SETTINGS_REASONS) {
    assert.equal(reasons[reason].reason, reason, `${reason} is really produced by the handler`);
    assert.equal(reasons[reason].retryable, false);
  }

  // Replays of unsettled and cancelled work answer the receipt status alone.
  const luna = { tasks: SETTINGS.alice.luna_tasks, home: !SETTINGS.alice.luna_home, projects: SETTINGS.alice.luna_projects };
  const row = (operation_id, extra) => ({ operation_id, domain: 'settings', kind: 'settings.save', request_hash: lunaHash(luna, 4), ...extra });
  const ledger = harness({ operations: [row(uuid(5), { status: 'pending' }), row(uuid(6), { status: 'cancelled' })] });
  const { body: ledgerShown } = await readSettings(ledger);
  assert.deepEqual((await saveSettings(ledger, ledgerShown, 'luna', { key: uuid(5), edit: toggleLuna })).body, { operationId: uuid(5), status: 'pending' });
  assert.deepEqual((await saveSettings(ledger, ledgerShown, 'luna', { key: uuid(6), edit: toggleLuna })).body, { operationId: uuid(6), status: 'cancelled' });

  // Refused before anything is read: 400, 413 and 422 claim nothing.
  const fresh = harness();
  const { body: freshShown } = await readSettings(fresh);
  await call(fresh, 'settingsSave', { rawBody: '{', headers: { 'idempotency-key': uuid(7), 'if-match': '4' }, expected: 400 });
  await call(fresh, 'settingsSave', { rawBody: JSON.stringify({ padding: 'x'.repeat(9000) }), headers: { 'idempotency-key': uuid(7), 'if-match': '4' }, expected: 413 });
  await saveSettings(fresh, freshShown, 'luna', { key: uuid(7), ifMatch: null, expected: 422 });
  await saveSettings(fresh, freshShown, 'luna', { key: uuid(7), headers: { 'idempotency-key': uuid(8) }, expected: 422 });
  await saveSettings(fresh, freshShown, 'notifications', { key: uuid(7), edit: (v) => { v.quiet = { enabled: true, from: '22:00', to: '22:00', zone: 'UTC' }; }, expected: 422 });
  await saveSettings(fresh, freshShown, 'display', { key: uuid(7), edit: (v) => { v.language = 'fr'; }, expected: 422 });
  await call(fresh, 'settingsSave', { body: { group: 'privacy', values: freshShown.values, operationId: uuid(7) }, headers: { 'idempotency-key': uuid(7), 'if-match': '4' }, expected: 422 });
  assert.deepEqual(fresh.db.rows('operations'), [], 'no operation id was claimed by a refused request');
  await saveSettings(fresh, freshShown, 'luna', { as: null, expected: 401 });

  const carol = harness({ identities: { alice: {}, bob: {}, carol: {} } });
  await call(carol, 'settingsSave', { as: 'carol', body: { group: 'luna', values: freshShown.values, operationId: uuid(9) }, headers: { 'idempotency-key': uuid(9), 'if-match': '1' }, expected: 404 });
  await unavailable(harness({ tables: allBut('profile_preferences') }), 'settingsSave', { body: { group: 'luna', values: freshShown.values, operationId: uuid(9) }, headers: { 'idempotency-key': uuid(9), 'if-match': '1' } });
  await authOutage(harness(), 'settingsSave', { body: { group: 'luna', values: freshShown.values, operationId: uuid(9) }, headers: { 'idempotency-key': uuid(9), 'if-match': '1' } });
});

test('B04 handler conformance: alerts.read answers the legacy list with the inbox, the legacy list alone before 0021 or 0017, and never 503 for a migration', async (t) => {
  muteConsoleError(t);
  const PENDING = uuid(40);
  const h = harness({ operations: [{ operation_id: PENDING, domain: 'alerts', kind: 'alerts.update', status: 'pending' }] });
  const { body } = await call(h, 'alertsRead');
  assert.deepEqual(body.items.map((item) => item.id), [A1, A2, A3], 'newest first, the dismissed row included');
  assert.deepEqual(body.alerts.map((row) => row.id), [A1, A2], 'the legacy list as it was: dismissed left out');
  assert.deepEqual(body.unresolvedOperations, [PENDING]);
  assert.deepEqual((await call(h, 'alertsRead', { as: 'bob' })).body.items.map((item) => item.id), [B1]);
  for (const make of [
    () => { const before = harness(); withoutColumn(before.db, 'alerts', 'revision', '42703'); return before; },
    () => harness({ tables: allBut('operations') }),
  ]) {
    const { body: degraded } = await call(make(), 'alertsRead', { clientRefuses: true });
    assert.deepEqual(Object.keys(degraded).sort(), ['alerts', 'count', 'truncated', 'unread'], 'Ruling S10');
  }
  await call(h, 'alertsRead', { as: null, expected: 401 });
  const broken = harness();
  breakTable(broken, 'alerts');
  await call(broken, 'alertsRead', { expected: 500 });
  await authOutage(harness(), 'alertsRead');
});

test('B04 handler conformance: alerts.update answers the whole inbox, a replay, and every documented refusal', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: read } = await updateAlerts(h, [{ id: A1, revision: 1 }], { read: true });
  assert.ok(alertReceiptCovers(read, [{ id: A1, revision: 1 }], { read: true }));
  assert.deepEqual((await updateAlerts(h, [{ id: A1, revision: 1 }], { read: true })).body, read, 'the same key and body is the first outcome');
  const { body: dismissed } = await updateAlerts(h, [{ id: A2, revision: 1 }], { dismissed: true }, { key: uuid(41) });
  const { body: undone } = await updateAlerts(h, [{ id: A2, revision: 2 }], { dismissed: false }, { key: uuid(42) });
  assert.deepEqual([dismissed.items.find((i) => i.id === A2).dismissed, undone.items.find((i) => i.id === A2).dismissed], [true, false], 'Undo is an ordinary second change');

  const reasons = {};
  reasons.stale_selection = (await updateAlerts(h, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(43), expected: 409 })).body;
  const foreign = (await updateAlerts(h, [{ id: B1, revision: 1 }], { read: true }, { key: uuid(44), expected: 409 })).body;
  assert.deepEqual({ ...foreign }, { ...reasons.stale_selection }, 'another household\'s alert is the same refusal');
  reasons.operation_mismatch = (await updateAlerts(h, [{ id: A1, revision: 2 }], { dismissed: true }, { expected: 409 })).body;

  const hash = requestHash({ selection: [{ id: A1, revision: 1 }], patch: { read: true } });
  const row = (operation_id, extra) => ({ operation_id, domain: 'alerts', kind: 'alerts.update', request_hash: hash, ...extra });
  const ledger = harness({
    operations: [
      row(uuid(45), { status: 'pending' }),
      row(uuid(46), { status: 'pending', created_at: ago(10 * 60_000) }),
      row(uuid(47), { status: 'failed' }),
      row(uuid(48), { status: 'cancelled' }),
    ],
  });
  assert.deepEqual((await updateAlerts(ledger, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(45) })).body, { operationId: uuid(45), status: 'pending' });
  reasons.operation_abandoned = (await updateAlerts(ledger, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(46), expected: 409 })).body;
  reasons.operation_failed = (await updateAlerts(ledger, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(47), expected: 409 })).body;
  reasons.operation_cancelled = (await updateAlerts(ledger, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(48), expected: 409 })).body;
  for (const reason of ALERTS_REASONS) {
    assert.equal(reasons[reason].reason, reason, `${reason} is really produced by the handler`);
    assert.equal(reasons[reason].retryable, false);
  }

  const fresh = harness();
  await call(fresh, 'alertsUpdate', { rawBody: '{', headers: { 'idempotency-key': uuid(49) }, expected: 400 });
  await call(fresh, 'alertsUpdate', { body: { operationId: uuid(49), selection: [], patch: { read: true } }, headers: { 'idempotency-key': uuid(49) }, expected: 400 });
  await call(fresh, 'alertsUpdate', { body: { operationId: uuid(49), selection: [{ id: A1, revision: 1 }, { id: A1, revision: 1 }], patch: { read: true } }, headers: { 'idempotency-key': uuid(49) }, expected: 400 });
  await call(fresh, 'alertsUpdate', { body: { operationId: uuid(49), selection: [{ id: A1, revision: 1 }], patch: { read: true } }, headers: { 'idempotency-key': uuid(50) }, expected: 400 });
  await call(fresh, 'alertsUpdate', { rawBody: JSON.stringify({ padding: 'x'.repeat(17000) }), headers: { 'idempotency-key': uuid(49) }, expected: 413 });
  assert.deepEqual(fresh.db.rows('operations'), [], 'no operation id was claimed by a refused request');
  await updateAlerts(fresh, [{ id: A1, revision: 1 }], { read: true }, { as: null, expected: 401 });

  const broken = harness();
  breakTable(broken, 'alerts', 'update');
  await updateAlerts(broken, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(51), expected: 500 });
  const before = harness();
  withoutColumn(before.db, 'alerts', 'revision', '42703');
  await unavailable(before, 'alertsUpdate', { body: { operationId: uuid(52), selection: [{ id: A1, revision: 1 }], patch: { read: true } }, headers: { 'idempotency-key': uuid(52) } });
  assert.deepEqual(before.db.rows('operations'), [], 'decided before the id is claimed');
  await authOutage(harness(), 'alertsUpdate', { body: { operationId: uuid(53), selection: [{ id: A1, revision: 1 }], patch: { read: true } }, headers: { 'idempotency-key': uuid(53) } });
});

test('B04 handler conformance: operations.read answers each settled, unsettled and refused shape for settings and alerts', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: shown } = await readSettings(h);
  await saveSettings(h, shown, 'luna', { key: uuid(60), edit: toggleLuna });
  const { body: settings } = await reconcile(h, uuid(60), 'settings');
  assert.deepEqual([settings.status, settings.kind, settings.snapshot.revision], ['succeeded', 'settings.save', 5]);
  await updateAlerts(h, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(61) });
  assert.equal((await reconcile(h, uuid(61), 'alerts')).body.status, 'succeeded');
  await updateAlerts(h, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(62), expected: 409 });
  const { body: refused } = await reconcile(h, uuid(62), 'alerts');
  assert.deepEqual([refused.status, refused.reason], ['failed', 'stale_selection']);

  const ledger = harness({
    operations: [
      { operation_id: uuid(63), domain: 'settings', kind: 'settings.save', status: 'pending' },
      { operation_id: uuid(64), domain: 'settings', kind: 'settings.save', status: 'pending', created_at: ago(10 * 60_000) },
      { operation_id: uuid(65), domain: 'settings', kind: 'settings.save', status: 'failed' },
    ],
  });
  assert.equal((await reconcile(ledger, uuid(63), 'settings')).body.status, 'pending');
  const { body: abandoned } = await reconcile(ledger, uuid(64), 'settings');
  assert.deepEqual([abandoned.status, abandoned.reason], ['failed', 'abandoned'], 'reaped as it is read');
  const { body: threw } = await reconcile(ledger, uuid(65), 'settings');
  assert.deepEqual([threw.status, 'reason' in threw], ['failed', false]);

  await reconcile(h, 'not-a-uuid', 'settings', { expected: 400 });
  await reconcile(h, uuid(60), 'recovery', { expected: 400 });
  await reconcile(h, uuid(60), 'alerts', { expected: 404 });
  await reconcile(h, uuid(60), 'settings', { as: 'bob', expected: 404 });
  await reconcile(h, uuid(60), 'settings', { as: null, expected: 401 });
  const broken = harness();
  breakTable(broken, 'operations');
  await reconcile(broken, uuid(60), 'settings', { expected: 500 });
  await unavailable(harness({ tables: allBut('operations') }), 'operationsRead', { query: `?operationId=${uuid(60)}&domain=settings` });
  await authOutage(harness(), 'operationsRead', { query: `?operationId=${uuid(60)}&domain=settings` });
});

// ---------------------------------------------------------------------------
// Cross-route agreement
// ---------------------------------------------------------------------------

test('a settings save is sent with the revision a read gave, and each receipt\'s revision is the next If-Match; the one before it is a stale_revision naming it', async (t) => {
  muteConsoleError(t);
  const h = harness();
  let { body: snapshot } = await readSettings(h);
  let key = 100;
  for (const [group, edit] of [
    ['luna', toggleLuna],
    ['notifications', (v) => { v.notifications.radon_season = !v.notifications.radon_season; }],
    ['display', (v) => { v.language = 'es'; }],
    ['home', (v) => { v.home.year = '1990'; }],
  ]) {
    const { body: receipt } = await saveSettings(h, snapshot, group, { key: uuid((key += 1)), edit });
    assert.equal(receipt.snapshot.revision, snapshot.revision + 1, `${group}: the revision the save was sent with was accepted, and advanced once`);
    const { body: reread } = await readSettings(h);
    assert.deepEqual(reread, receipt.snapshot, `${group}: the read is the save's own snapshot`);
    snapshot = receipt.snapshot;
  }
  const { body: stale } = await saveSettings(h, { ...snapshot, revision: snapshot.revision - 1 }, 'luna', { key: uuid((key += 1)), edit: toggleLuna, expected: 409 });
  assert.deepEqual([stale.reason, stale.revision], ['stale_revision', snapshot.revision], 'the conflict names the revision to send next');
  const { body: retried } = await saveSettings(h, { ...snapshot, revision: stale.revision }, 'luna', { key: uuid((key += 1)), edit: toggleLuna });
  assert.equal(retried.snapshot.revision, snapshot.revision + 1);
  // The entity-tag form of the same revision is the same precondition.
  const { body: tagged } = await saveSettings(h, retried.snapshot, 'luna', { key: uuid((key += 1)), edit: toggleLuna, ifMatch: `W/"${retried.snapshot.revision}"` });
  assert.equal(tagged.snapshot.revision, retried.snapshot.revision + 1);
});

test('Rulings S14 and S16: the direct answer and a reconcile carry the live list without the operation itself, the ledger keeps [], for both domains', async (t) => {
  muteConsoleError(t);
  const OTHER_SETTINGS = uuid(201);
  const OTHER_ALERTS = uuid(202);
  const h = harness({
    operations: [
      { operation_id: OTHER_SETTINGS, domain: 'settings', kind: 'settings.save', status: 'pending' },
      { operation_id: OTHER_ALERTS, domain: 'alerts', kind: 'alerts.update', status: 'pending' },
    ],
  });
  const { body: shown } = await readSettings(h);
  const { body: saved } = await saveSettings(h, shown, 'luna', { key: uuid(203), edit: toggleLuna });
  assert.deepEqual(saved.snapshot.unresolvedOperations, [OTHER_SETTINGS], 'the direct answer: the live settings list, not itself, not the alerts one');
  const { body: changed } = await updateAlerts(h, [{ id: A1, revision: 1 }], { read: true }, { key: uuid(204) });
  assert.deepEqual(changed.unresolvedOperations, [OTHER_ALERTS], 'top level for alerts');
  const stored = (id) => h.db.rows('operations').find((row) => row.operation_id === id).result;
  assert.deepEqual([stored(uuid(203)).snapshot.unresolvedOperations, stored(uuid(204)).unresolvedOperations], [[], []], 'the stored receipts are history (S14)');

  const { body: settingsCheck } = await reconcile(h, uuid(203), 'settings');
  const { body: alertsCheck } = await reconcile(h, uuid(204), 'alerts');
  assert.deepEqual(settingsCheck.snapshot.unresolvedOperations, [OTHER_SETTINGS], 'S16: snapshot.unresolvedOperations for settings');
  assert.deepEqual(alertsCheck.unresolvedOperations, [OTHER_ALERTS], 'S16: top level for alerts');
  assert.equal('unresolvedOperations' in settingsCheck, false, 'settings carries it only in the snapshot');
  // A replay serves the stored receipt as it is.
  assert.deepEqual((await saveSettings(h, shown, 'luna', { key: uuid(203), edit: toggleLuna })).body.snapshot.unresolvedOperations, []);

  // Once the other work settles, the next check carries nothing, and the surfaces unlock.
  for (const id of [OTHER_SETTINGS, OTHER_ALERTS]) await h.db.from('operations').update({ status: 'succeeded', result: { status: 'succeeded' } }).eq('operation_id', id);
  assert.deepEqual((await reconcile(h, uuid(203), 'settings')).body.snapshot.unresolvedOperations, []);
  assert.deepEqual((await reconcile(h, uuid(204), 'alerts')).body.unresolvedOperations, []);
});

test('the clients themselves, over the real handlers: a parked save and a parked change are cleared by one check, and the reaped save keeps its draft', async (t) => {
  muteConsoleError(t);
  const PARKED_SETTINGS = uuid(301);
  const PARKED_ALERTS = uuid(302);
  const h = harness({
    operations: [
      { operation_id: PARKED_SETTINGS, domain: 'settings', kind: 'settings.save', status: 'pending' },
      { operation_id: PARKED_ALERTS, domain: 'alerts', kind: 'alerts.update', status: 'pending' },
    ],
  });
  const settings = productionPreferences(h);
  const alerts = productionAlerts(h);
  await settings.reload();
  await alerts.reload();
  assert.deepEqual([settings.unknown, alerts.unknown], [PARKED_SETTINGS, PARKED_ALERTS], 'each surface is locked by its own domain only');
  assert.equal(await settings.saveGroup('luna', { values: toggleLuna }), null, 'a locked surface sends nothing');
  for (const id of [PARKED_SETTINGS, PARKED_ALERTS]) await h.db.from('operations').update({ status: 'failed', result: null }).eq('operation_id', id);
  await settings.reconcile();
  await alerts.retry();
  assert.deepEqual([settings.unknown, settings.error], [null, 'The save was not applied. Your draft is still here.']);
  assert.deepEqual([alerts.unknown, alerts.message], [null, 'The update was not applied.']);
  assert.ok(await settings.saveGroup('luna', { values: toggleLuna }));
  assert.ok(await alerts.read(alerts.item(A1)));
  assert.deepEqual([settings.unknown, settings.error, alerts.unknown, alerts.message], [null, null, null, '']);

  // Nit 1: the reaper settled the save first, so the client keeps the draft and does not re-read.
  const drafts = { ...settings.drafts };
  const sent = settings.sent.length;
  reapBeforeSave(h);
  assert.equal(await settings.saveGroup('luna', { values: toggleLuna }), null);
  assert.deepEqual([settings.error, settings.unknown, settings.state.conflict], ['The save was not applied. Your draft is still here.', null, false]);
  assert.deepEqual(settings.sent.slice(sent), ['settings.save'], 'no re-read replaced the draft');
  assert.deepEqual({ ...settings.drafts }, drafts);
  assert.notEqual(settings.error, RUNTIME_MESSAGES.conflict, 'never told the settings changed');
});

// ---------------------------------------------------------------------------
// Fixture hygiene
// ---------------------------------------------------------------------------

test('no B04 fixture carries a secret, a token, a real address, a location or a request id that is not synthetic', () => {
  const forbidden = [
    /sk-[A-Za-z0-9]/, /Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/,
    /api[_-]?key/i, /secret/i, /password/i, /authorization/i,
    /supabase|upstash|openrouter|openai|mapbox|PGRST|postgres/i,
    /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/,
    /\b\d{3}-\d{2}-\d{4}\b/, /"lat"|"lng"|"zip"|pwsid/i, /https?:\/\//,
  ];
  for (const item of fixtures) {
    const serialized = JSON.stringify(item.body);
    for (const pattern of forbidden) assert.equal(pattern.test(serialized), false, `${item.name} matches ${pattern}`);
    assert.ok(['b04-contract-0001', undefined].includes(item.body.request_id), `${item.name}: a synthetic request id`);
    assert.equal(serialized.includes(EM_DASH), false, `${item.name}: no U+2014`);
  }
});

// ---------------------------------------------------------------------------
// Header documentation, both ways. Runs last: tests in one file run in order.
// ---------------------------------------------------------------------------

test('B04 contract headers: every documented response header is really sent, for the pairs these tests exercise', () => {
  assert.ok(seenHeaders.size > 0, 'no conformance responses were recorded');
  for (const [key, seen] of seenHeaders) {
    const [id, status] = key.split(' ');
    for (const name of documentedHeaders(id, status)) {
      if (CHECKED_HEADERS.includes(name)) assert.ok(seen.has(name), `${key}: the contract documents ${name} but no exercised response sent it`);
    }
  }
});

test('B04 contract headers: every documented request header (Idempotency-Key, If-Match, X-Halo-Home-Context) was sent by an exercised request', () => {
  for (const id of operations.keys()) {
    for (const name of documentedParams(id)) {
      assert.ok(sentHeaders.get(id)?.has(name), `${id}: the contract documents the ${name} header but no exercised request sent it`);
    }
  }
  assert.deepEqual([...documentedParams('settingsSave')].sort(), ['idempotency-key', 'if-match', 'x-halo-home-context']);
  assert.deepEqual([...documentedParams('alertsUpdate')], ['idempotency-key']);
});
