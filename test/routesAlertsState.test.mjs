/**
 * GET /api/alerts as `alerts.read` and POST /api/alerts/state as
 * `alerts.update` (B04 plan, Task 2b).
 *
 * The production client runs `validAlertSnapshot` on every read and every
 * receipt and throws the whole inbox away if one row fails it, and on a change
 * it also runs `alertReceiptCovers`, which needs every selected row back at a
 * strictly higher revision with the patched fields equal to the patch. Both are
 * transcribed below from lib/frontend/production/alerts-service.ts on
 * origin/codex/october15-review-refinement (and `validActionDate` from
 * lib/frontend/expanded-preview.ts:30-34, `notificationKinds` from
 * lib/frontend/settings-preview.ts:2), changed only from TypeScript to
 * JavaScript, so a body that passes here is a body the client accepts.
 *
 * What else this file is about:
 *
 * 1. Additive. GET keeps every legacy key (StageSession still reads `alerts`)
 *    beside `items` and `unresolvedOperations`, and before 0021 (or 0017) it
 *    serves the legacy keys alone, never a 503 (Ruling S10).
 * 2. Ruling S1. `unresolvedOperations` is a lock, so it is exactly the
 *    household's stored-pending `alerts` operations, stale ones included.
 * 3. Ruling S6. Reading never marks read; only `alerts.update` does.
 * 4. All or nothing. One stale or foreign row refuses the whole selection with
 *    a 409, and a foreign id is indistinguishable from a missing one.
 * 5. Idempotent through the ledger, domain `alerts`, and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope, UUID } from './helpers/envelope.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';

const { requestHash } = await import('@/lib/operations');
const inbox = await import('@/lib/alertsInbox');
const { evaluateAlerts } = await import('@/lib/alertRules');

// ---------------------------------------------------------------------------
// The frontend validators, transcribed (TypeScript types removed, nothing else)
// ---------------------------------------------------------------------------

const notificationKinds = ['air_quality_change', 'weather_advisory', 'new_water_results', 'radon_season', 'season_summary'];
function validActionDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const destinations={home:['tests','maintenance','food','summary'],plan:['journal','patterns','recap','outdoors','reminders'],today:[]};
const factors=['air','uv','pollen','mold','pfas','radon','lead'];
function source(value){if(!value)return true;try{const url=new URL(value.url);return typeof value.title==='string'&&!!value.title&&url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}}
function validAlertSnapshot(value){
 const v=value;
 return !!v&&Array.isArray(v.unresolvedOperations)&&v.unresolvedOperations.every(id=>typeof id==='string'&&!!id)&&Array.isArray(v.items)&&new Set(v.items.map(item=>item?.id)).size===v.items.length&&v.items.every(item=>item&&typeof item.id==='string'&&!!item.id&&Number.isSafeInteger(item.revision)&&item.revision>0&&typeof item.title==='string'&&!!item.title&&typeof item.body==='string'&&['Home','Your week','Conditions'].includes(item.category)&&!!item.date&&validActionDate(item.date)&&typeof item.read==='boolean'&&typeof item.dismissed==='boolean'&&[...notificationKinds,'app'].includes(item.kind)&&item.target&&Object.hasOwn(destinations,item.target.tab)&&(!item.target.destination||destinations[item.target.tab].includes(item.target.destination))&&(!item.target.learn||factors.includes(item.target.learn))&&source(item.source));
}
function alertReceiptCovers(value,selected,patch){
 return selected.length>0&&selected.every(previous=>{const next=value.items.find(item=>item.id===previous.id);return !!next&&next.revision>previous.revision&&(patch.read===undefined||next.read===patch.read)&&(patch.dismissed===undefined||next.dismissed===patch.dismissed);});
}

test('the transcribed validators still reject what the frontend tests reject, so they are not vacuous', () => {
  const row = { id: 'a', revision: 1, title: 'T', body: '', category: 'Home', date: '2026-10-13', read: false, dismissed: false, target: { tab: 'home', destination: 'tests' }, kind: 'app' };
  assert.equal(validAlertSnapshot({ items: [row], unresolvedOperations: [] }), true);
  for (const broken of [
    { ...row, date: '2026-02-30' }, { ...row, target: { tab: 'other' } }, { ...row, target: { tab: 'today', destination: 'tests' } },
    { ...row, target: { tab: 'home', learn: 'unreviewed' } }, { ...row, revision: 0 }, { ...row, kind: 'invented' }, { ...row, title: '' },
    { ...row, category: 'home' }, { ...row, source: { title: 'Bad', url: 'https://credentials:secret@example.com' } },
  ]) assert.equal(validAlertSnapshot({ items: [broken], unresolvedOperations: [] }), false, JSON.stringify(broken));
  assert.equal(validAlertSnapshot({ items: [row, row], unresolvedOperations: [] }), false, 'duplicate ids');
  assert.equal(validAlertSnapshot({ items: [row] }), false, 'the inventory is required');
  assert.equal(alertReceiptCovers({ items: [row] }, [{ id: 'a', revision: 1 }], { read: true }), false, 'an equal revision does not cover');
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROUTE = '/api/alerts/state';
const A_NEW = 'a11ce000-2222-4000-8000-000000000001'; // unread, air quality
const A_READ = 'a11ce000-2222-4000-8000-000000000002'; // read, season summary
const A_GONE = 'a11ce000-2222-4000-8000-000000000003'; // dismissed, radon
const A_ODD = 'a11ce000-2222-4000-8000-000000000004'; // a kind with no mapping, revision 3
const B_ONE = 'b0b00000-2222-4000-8000-000000000001';
const MISSING = '99999999-2222-4999-8999-999999999999';
const OP = '0e000000-0000-4000-8000-000000000001';
const OP_2 = '0e000000-0000-4000-8000-000000000002';
const OTHER_OP = '0e000000-0000-4000-8000-0000000000aa';

const ago = (ms) => new Date(Date.now() - ms).toISOString();

function seedAlerts({ alice, bob }) {
  return [
    { id: A_NEW, profile_id: alice.id, type: 'air_quality_change', severity: 'elevated', title: 'Air quality dropped', message: 'Air quality dropped to Elevated today.', dedupe_key: 'a-1', fired_at: '2026-10-14T13:00:00Z' },
    { id: A_READ, profile_id: alice.id, type: 'season_summary', title: 'Your summer summary is ready', message: 'You logged 12 days.', dedupe_key: 'a-2', read: true, fired_at: '2026-10-13T13:00:00Z' },
    { id: A_GONE, profile_id: alice.id, type: 'radon_season', title: 'Time to test for radon', message: 'Winter is the most accurate time to test for radon.', dedupe_key: 'a-3', dismissed: true, fired_at: '2026-10-12T13:00:00Z' },
    { id: A_ODD, profile_id: alice.id, type: 'air_quality', title: 'An older kind', message: '', dedupe_key: 'a-4', revision: 3, fired_at: '2026-10-11T13:00:00Z' },
    { id: B_ONE, profile_id: bob.id, type: 'weather_advisory', title: 'BOB-ONLY-TITLE', message: 'BOB-ONLY-MESSAGE', dedupe_key: 'b-1', fired_at: '2026-10-14T13:00:00Z' },
  ];
}

function harness({ tables = haloTables('alerts', 'operations'), alerts = seedAlerts, operations = () => [] } = {}) {
  return createRouteHarness({
    tables,
    seed: (ids) => Object.fromEntries(Object.entries({ alerts: alerts(ids), operations: operations(ids) }).filter(([table]) => table in tables)),
  });
}

const read = (h, as = 'alice', url = '/api/alerts') => h.call('/api/alerts', 'GET', { as, url });
const update = (h, body, { as = 'alice', headers = { 'idempotency-key': body?.operationId ?? '' } } = {}) =>
  h.call(ROUTE, 'POST', { as, body, headers });
const change = (operationId, selection, patch) => ({ operationId, selection, patch });
const row = (h, id) => h.db.rows('alerts').find((alert) => alert.id === id);
const alertWrites = (h) => h.db.queryLog.filter((q) => q.table === 'alerts' && q.operation !== 'select');
const ledger = (h, id) => h.db.rows('operations').find((op) => op.operation_id === id);
/**
 * The owner audit for this route's own statements: every statement on alerts
 * and every ledger read. The ledger's settle is keyed by the operation id the
 * caller just claimed (lib/operations.js, not this route's to change), so it
 * is left out here rather than claimed.
 */
const auditRoute = (queries, callerId, label) =>
  auditOwnerScope(queries.filter((q) => q.table === 'alerts' || (q.table === 'operations' && q.operation === 'select')), callerId, label);

// ---------------------------------------------------------------------------
// GET /api/alerts: the contract read beside the legacy one
// ---------------------------------------------------------------------------

test('GET: the contract inbox and the legacy list are both present, and the body passes the client validator', async () => {
  const h = harness();
  const res = await read(h);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['alerts', 'count', 'items', 'truncated', 'unread', 'unresolvedOperations']);
  assert.equal(validAlertSnapshot(body), true);
  assert.equal('data' in body, false, 'a top-level data key would be consumed as an envelope');
  // Legacy, unchanged: dismissed left out, newest first.
  assert.deepEqual(body.alerts.map((a) => a.id), [A_NEW, A_READ, A_ODD]);
  assert.deepEqual([body.count, body.unread, body.truncated], [3, 2, false]);
  // Contract: dismissed kept, newest first, nothing of bob's.
  assert.deepEqual(body.items.map((item) => item.id), [A_NEW, A_READ, A_GONE, A_ODD]);
  assert.deepEqual(body.unresolvedOperations, []);
  assert.deepEqual(body.items[0], {
    id: A_NEW, revision: 1, title: 'Air quality dropped', body: 'Air quality dropped to Elevated today.', category: 'Conditions',
    date: '2026-10-14', read: false, dismissed: false, target: { tab: 'today', learn: 'air' }, kind: 'air_quality_change',
  });
  assert.equal(JSON.stringify(body).includes('BOB-ONLY'), false);
});

test('GET: an empty inbox is an empty contract inbox beside the empty legacy list', async () => {
  const body = await (await read(harness({ alerts: () => [] }))).json();
  assert.deepEqual(body, { count: 0, unread: 0, truncated: false, alerts: [], items: [], unresolvedOperations: [] });
  assert.equal(validAlertSnapshot(body), true);
});

test('GET: each kind the backend writes maps to its category and target, an unknown kind to no destination', async () => {
  const kinds = ['air_quality_change', 'weather_advisory', 'new_water_results', 'radon_season', 'season_summary', 'air_quality', 'made_up'];
  const h = harness({
    alerts: ({ alice }) => kinds.map((type, i) => ({
      id: `a11ce000-3333-4000-8000-00000000000${i}`, profile_id: alice.id, type, title: type, message: 'm', dedupe_key: type,
      fired_at: new Date(Date.UTC(2026, 9, 10, 12) - i * 3_600_000).toISOString(),
    })),
  });
  const body = await (await read(h)).json();
  assert.equal(validAlertSnapshot(body), true);
  assert.deepEqual(Object.fromEntries(body.items.map((item) => [item.title, [item.kind, item.category, item.target]])), {
    air_quality_change: ['air_quality_change', 'Conditions', { tab: 'today', learn: 'air' }],
    weather_advisory: ['weather_advisory', 'Conditions', { tab: 'today' }],
    new_water_results: ['new_water_results', 'Home', { tab: 'home' }],
    radon_season: ['radon_season', 'Home', { tab: 'home', destination: 'tests', learn: 'radon' }],
    season_summary: ['season_summary', 'Your week', { tab: 'plan', destination: 'recap' }],
    air_quality: ['app', 'Conditions', { tab: 'today' }],
    made_up: ['app', 'Conditions', { tab: 'today' }],
  });
});

test('GET: a category and target the producer stored win over the mapping; one the client could not route is not sent', async () => {
  const h = harness({
    alerts: ({ alice }) => [
      { id: A_NEW, profile_id: alice.id, type: 'air_quality_change', title: 'Stored', message: 'm', dedupe_key: '1', fired_at: '2026-10-14T13:00:00Z',
        category: 'Your week', target_tab: 'plan', target_destination: 'outdoors', target_learn: 'pollen' },
      { id: A_READ, profile_id: alice.id, type: 'radon_season', title: 'Unroutable', message: 'm', dedupe_key: '2', fired_at: '2026-10-13T13:00:00Z',
        category: 'Elsewhere', target_tab: 'today', target_destination: 'tests' },
    ],
  });
  const body = await (await read(h)).json();
  assert.equal(validAlertSnapshot(body), true);
  assert.deepEqual(body.items.map((item) => [item.category, item.target]), [
    ['Your week', { tab: 'plan', destination: 'outdoors', learn: 'pollen' }],
    ['Home', { tab: 'home', destination: 'tests', learn: 'radon' }],
  ]);
});

test('GET: the date is the household\'s New York calendar day, not the UTC one', async () => {
  const h = harness({
    alerts: ({ alice }) => [{ id: A_NEW, profile_id: alice.id, type: 'weather_advisory', title: 'Late', message: 'm', dedupe_key: '1', fired_at: '2026-10-14T02:30:00Z' }],
  });
  const [item] = (await (await read(h)).json()).items;
  assert.equal(item.date, '2026-10-13', '10:30pm Eastern on the 13th');
});

test('GET: a stored em dash never reaches the contract inbox; the legacy list is left exactly as stored', async () => {
  const h = harness({
    alerts: ({ alice }) => [{
      id: A_NEW, profile_id: alice.id, type: 'weather_advisory', title: 'Weather advisory', dedupe_key: '1', fired_at: '2026-10-14T13:00:00Z',
      message: 'Flood advisory for Wake. Flooding can affect well water \u2014 retest after it recedes.',
    }],
  });
  const body = await (await read(h)).json();
  assert.equal(body.items[0].body, 'Flood advisory for Wake. Flooding can affect well water, retest after it recedes.');
  assert.equal(JSON.stringify(body.items).includes('\u2014'), false);
  assert.ok(body.alerts[0].message.includes('\u2014'), 'the legacy response is unchanged');
});

test('the alert rules no longer write an em dash into any alert', () => {
  const fired = evaluateAlerts({
    airToday: 'high', airYesterday: 'good', sensitive: true, county: 'Wake',
    advisories: [{ kind: 'flood' }, { kind: 'boil_water' }, { kind: 'heat' }],
    waterResultsChanged: true, radonZone: 1, month: 11, year: 2026,
    seasonEnded: { season: 'summer', year: 2026 }, hasJournalEntries: true, date: '2026-11-02',
  });
  assert.equal(fired.length, 7);
  for (const alert of fired) assert.equal(`${alert.title} ${alert.message}`.includes('\u2014'), false, alert.message);
});

test('GET: unresolvedOperations is exactly this household\'s stored-pending alerts operations, stale ones included (Ruling S1)', async () => {
  const h = harness({
    operations: ({ alice, bob }) => [
      { operation_id: '0e000000-0000-4000-8000-000000000011', profile_id: alice.id, domain: 'alerts', kind: 'alerts.update', status: 'pending', created_at: ago(5_000) },
      { operation_id: '0e000000-0000-4000-8000-000000000012', profile_id: alice.id, domain: 'alerts', kind: 'alerts.update', status: 'pending', created_at: ago(24 * 3_600_000) },
      { operation_id: '0e000000-0000-4000-8000-000000000013', profile_id: alice.id, domain: 'alerts', kind: 'alerts.update', status: 'succeeded', created_at: ago(1_000) },
      { operation_id: '0e000000-0000-4000-8000-000000000014', profile_id: alice.id, domain: 'alerts', kind: 'alerts.update', status: 'failed', created_at: ago(1_000) },
      { operation_id: '0e000000-0000-4000-8000-000000000015', profile_id: alice.id, domain: 'settings', kind: 'settings.save', status: 'pending', created_at: ago(1_000) },
      { operation_id: '0e000000-0000-4000-8000-000000000016', profile_id: bob.id, domain: 'alerts', kind: 'alerts.update', status: 'pending', created_at: ago(1_000) },
    ],
  });
  const body = await (await read(h)).json();
  assert.deepEqual(body.unresolvedOperations, ['0e000000-0000-4000-8000-000000000012', '0e000000-0000-4000-8000-000000000011'], 'oldest first, the stale one too');
  assert.equal(validAlertSnapshot(body), true);
  assert.deepEqual((await (await read(h, 'bob')).json()).unresolvedOperations, ['0e000000-0000-4000-8000-000000000016']);
});

test('GET: before 0021 every legacy key is served and only the contract keys are left out, never a 503 (Ruling S10)', async () => {
  for (const code of ['PGRST204', '42703']) {
    const h = harness();
    const legacy = await (await read(h)).json();
    delete legacy.items;
    delete legacy.unresolvedOperations;
    withoutColumn(h.db, 'alerts', 'revision', code);
    const res = await read(h);
    assert.equal(res.status, 200, code);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['alerts', 'count', 'truncated', 'unread'], code);
    assert.deepEqual(body, legacy, `${code}: the legacy answer is the one it always was`);
    assert.equal(validAlertSnapshot(body), false, 'the client is told the inbox could not be verified, which is true');
  }
});

test('GET: before 0017 (no ledger) the legacy keys are served, the contract keys left out, and the inbox not read', async () => {
  const h = harness({ tables: haloTables('alerts') });
  const res = await read(h);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['alerts', 'count', 'truncated', 'unread']);
  assert.equal(h.db.queryLog.filter((q) => q.table === 'alerts').length, 2, 'the legacy list and its count, and no contract read');
});

test('GET: reading the inbox, as often as you like, marks nothing read and writes nothing (Ruling S6)', async () => {
  const h = harness();
  const before = h.db.rows('alerts');
  for (let i = 0; i < 3; i += 1) await read(h);
  await h.call('/api/operations', 'GET', { as: 'alice', url: `/api/operations?operationId=${OP}&domain=alerts` });
  assert.deepEqual(h.db.rows('alerts'), before);
  assert.deepEqual(h.db.queryLog.filter((q) => q.operation !== 'select'), []);
});

test('GET: every statement is scoped to the caller, and ids in the query change nothing', async () => {
  const h = harness();
  const plain = await (await read(h)).json();
  const before = h.db.queryLog.length;
  const junk = await (await read(h, 'alice', `/api/alerts?profile_id=${h.identities.bob.id}&id=${B_ONE}`)).json();
  assert.deepEqual(junk, plain);
  auditOwnerScope(h.db.queryLog.slice(before), h.identities.alice.id, 'GET /api/alerts');
});

// ---------------------------------------------------------------------------
// POST /api/alerts/state: changes
// ---------------------------------------------------------------------------

test('POST: mark as read answers a succeeded receipt the client accepts, and advances only the selected row', async () => {
  const h = harness();
  const selection = [{ id: A_NEW, revision: 1 }];
  const res = await update(h, change(OP, selection, { read: true }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const receipt = await res.json();
  assert.deepEqual(Object.keys(receipt).sort(), ['items', 'operationId', 'status', 'unresolvedOperations']);
  assert.deepEqual([receipt.operationId, receipt.status, receipt.unresolvedOperations], [OP, 'succeeded', []]);
  assert.equal(validAlertSnapshot(receipt), true);
  assert.equal(alertReceiptCovers(receipt, selection, { read: true }), true);
  assert.deepEqual(receipt.items.map((item) => [item.id, item.revision, item.read]), [[A_NEW, 2, true], [A_READ, 1, true], [A_GONE, 1, false], [A_ODD, 3, false]]);
  assert.deepEqual([row(h, A_NEW).read, row(h, A_NEW).revision], [true, 2]);
  assert.equal(ledger(h, OP).status, 'succeeded');
  assert.deepEqual(ledger(h, OP).result.unresolvedOperations, [], 'the stored receipt does not lock the inbox on reconcile either');
  // The next read is the same inbox.
  assert.deepEqual((await (await read(h)).json()).items, receipt.items);
});

test('POST: dismiss and then Undo are two revision-bound changes; the dismissed row stays in the inbox for Undo', async () => {
  const h = harness();
  const dismissed = await (await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { dismissed: true }))).json();
  assert.equal(alertReceiptCovers(dismissed, [{ id: A_NEW, revision: 1 }], { dismissed: true }), true);
  const undoTarget = dismissed.items.find((item) => item.id === A_NEW);
  assert.deepEqual([undoTarget.dismissed, undoTarget.revision], [true, 2]);

  const restored = await (await update(h, change(OP_2, [{ id: A_NEW, revision: undoTarget.revision }], { dismissed: false }))).json();
  assert.equal(validAlertSnapshot(restored), true);
  assert.equal(alertReceiptCovers(restored, [{ id: A_NEW, revision: 2 }], { dismissed: false }), true);
  assert.deepEqual([row(h, A_NEW).dismissed, row(h, A_NEW).revision], [false, 3]);
  // Undo is not a reversal: replaying the dismiss now is a replay, not a new dismiss.
  const replay = await (await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { dismissed: true }))).json();
  assert.deepEqual(replay, dismissed);
  assert.equal(row(h, A_NEW).dismissed, false);
});

test('POST: mark all as read covers every selected row, across rows at different revisions', async () => {
  const h = harness();
  const selection = [{ id: A_NEW, revision: 1 }, { id: A_ODD, revision: 3 }];
  const receipt = await (await update(h, change(OP, selection, { read: true }))).json();
  assert.equal(receipt.status, 'succeeded');
  assert.equal(alertReceiptCovers(receipt, selection, { read: true }), true);
  assert.deepEqual([row(h, A_NEW).revision, row(h, A_ODD).revision], [2, 4]);
  assert.deepEqual([row(h, A_READ).revision, row(h, A_GONE).revision], [1, 1], 'unselected rows are untouched');
});

test('POST: a patch that changes nothing visible still advances the revision, because the receipt must prove it', async () => {
  const h = harness();
  const receipt = await (await update(h, change(OP, [{ id: A_READ, revision: 1 }], { read: true }))).json();
  assert.equal(alertReceiptCovers(receipt, [{ id: A_READ, revision: 1 }], { read: true }), true);
  assert.equal(row(h, A_READ).revision, 2);
});

test('POST: the receipt carries a selected row even when newer alerts pushed it out of the newest 100', async () => {
  const h = harness({
    alerts: ({ alice }) => [
      { id: A_NEW, profile_id: alice.id, type: 'weather_advisory', title: 'Oldest', message: 'm', dedupe_key: 'old', fired_at: '2025-01-01T12:00:00Z' },
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `a11ce000-4444-4000-8000-${i.toString(16).padStart(12, '0')}`, profile_id: alice.id, type: 'weather_advisory',
        title: `Newer ${i}`, message: 'm', dedupe_key: `n-${i}`, fired_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      })),
    ],
  });
  assert.equal((await (await read(h)).json()).items.some((item) => item.id === A_NEW), false, 'the read page does not hold it');
  const receipt = await (await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }))).json();
  assert.equal(validAlertSnapshot(receipt), true);
  assert.equal(alertReceiptCovers(receipt, [{ id: A_NEW, revision: 1 }], { read: true }), true);
  assert.equal(receipt.items.length, 101);
  assert.equal(receipt.items.at(-1).id, A_NEW, 'still in date order, oldest last');
});

test('POST: the receipt lists other unsettled alerts operations but never its own', async () => {
  const h = harness({
    operations: ({ alice }) => [{ operation_id: OTHER_OP, profile_id: alice.id, domain: 'alerts', kind: 'alerts.update', status: 'pending', created_at: ago(1_000) }],
  });
  const receipt = await (await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }))).json();
  assert.deepEqual(receipt.unresolvedOperations, [OTHER_OP]);
});

test('POST: GET /api/operations replays the succeeded receipt flat, and it passes the client validator', async () => {
  const h = harness();
  const receipt = await (await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }))).json();
  const replay = await (await h.call('/api/operations', 'GET', { as: 'alice', url: `/api/operations?operationId=${OP}&domain=alerts` })).json();
  assert.deepEqual([replay.operationId, replay.status, replay.domain, replay.kind], [OP, 'succeeded', 'alerts', 'alerts.update']);
  assert.equal(validAlertSnapshot(replay), true);
  assert.deepEqual([replay.items, replay.unresolvedOperations], [receipt.items, []]);
});

// ---------------------------------------------------------------------------
// POST: conflicts, all or nothing, and other households
// ---------------------------------------------------------------------------

test('POST: one stale row refuses the whole selection with a 409, changes nothing, and is recorded as failed', async () => {
  const h = harness();
  const before = h.db.rows('alerts');
  const res = await update(h, change(OP, [{ id: A_NEW, revision: 1 }, { id: A_ODD, revision: 2 }], { read: true }));
  const body = await expectEnvelope(res, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(body.reason, 'stale_selection');
  assert.equal(body.error.includes('\u2014'), false);
  assert.deepEqual(h.db.rows('alerts'), before);
  assert.deepEqual(alertWrites(h), [], 'nothing was written, not even the fresh row');
  assert.deepEqual([ledger(h, OP).status, ledger(h, OP).result.reason], ['failed', 'stale_selection']);
  const status = await (await h.call('/api/operations', 'GET', { as: 'alice', url: `/api/operations?operationId=${OP}&domain=alerts` })).json();
  assert.equal(status.status, 'failed', 'the client reconciles to "not applied" and reloads');
  // The replay is the same conflict, and still writes nothing.
  await expectEnvelope(await update(h, change(OP, [{ id: A_NEW, revision: 1 }, { id: A_ODD, revision: 2 }], { read: true })), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.deepEqual(alertWrites(h), []);
});

test('POST: another household\'s alert id is the identical 409 to an id that never existed, alone or beside the caller\'s own', async () => {
  const h = harness();
  const before = h.db.rows('alerts');
  const strip = (body) => ({ ...body, request_id: null });
  const cases = [
    [[{ id: B_ONE, revision: 1 }], [{ id: MISSING, revision: 1 }]],
    [[{ id: A_NEW, revision: 1 }, { id: B_ONE, revision: 1 }], [{ id: A_NEW, revision: 1 }, { id: MISSING, revision: 1 }]],
  ];
  let n = 0;
  for (const [foreign, missing] of cases) {
    for (const patch of [{ read: true }, { dismissed: true }, { dismissed: false }]) {
      n += 1;
      const one = `0e000000-0000-4000-8000-0000000001${n.toString(16).padStart(2, '0')}`;
      const two = `0e000000-0000-4000-8000-0000000002${n.toString(16).padStart(2, '0')}`;
      const queriesBefore = h.db.queryLog.length;
      const a = await update(h, change(one, foreign, patch));
      const b = await update(h, change(two, missing, patch));
      auditRoute(h.db.queryLog.slice(queriesBefore), h.identities.alice.id, 'POST /api/alerts/state');
      assert.equal(a.status, 409);
      assert.equal(b.status, a.status);
      assert.deepEqual(strip(await a.json()), strip(await b.json()), JSON.stringify(patch));
    }
  }
  assert.deepEqual(h.db.rows('alerts'), before, 'neither bob\'s row nor alice\'s own selected row changed');
  assert.deepEqual(alertWrites(h), []);
});

test('POST: a body naming another profile is refused, and the owner\'s own change is scoped to the owner', async () => {
  const h = harness();
  const before = h.db.rows('alerts');
  const smuggled = await update(h, { ...change(OP, [{ id: B_ONE, revision: 1 }], { read: true }), profile_id: h.identities.bob.id });
  const body = await expectEnvelope(smuggled, { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['profile_id', 'unknown_field']]);
  const query = await h.call(ROUTE, 'POST', { as: 'alice', url: `${ROUTE}?profile_id=${h.identities.bob.id}`, body: change(OP_2, [{ id: B_ONE, revision: 1 }], { read: true }) });
  assert.equal(query.status, 409, 'a query naming bob does not make his row the caller\'s');
  assert.deepEqual(h.db.rows('alerts'), before);

  const queriesBefore = h.db.queryLog.length;
  const own = await update(h, change(OP, [{ id: B_ONE, revision: 1 }], { read: true }), { as: 'bob' });
  assert.equal(own.status, 200);
  auditRoute(h.db.queryLog.slice(queriesBefore), h.identities.bob.id, 'POST /api/alerts/state as bob');
  assert.equal(row(h, B_ONE).read, true);
  assert.deepEqual(h.db.rows('alerts').filter((a) => a.id !== B_ONE), before.filter((a) => a.id !== B_ONE));
});

/**
 * Runs `inject(from)` once, right before the `n`th write statement on alerts
 * executes, using the unwrapped client: another writer getting in between this
 * route's read and its write.
 */
function interleave(h, injections) {
  const realFrom = h.db.from.bind(h.db);
  let writesSeen = 0;
  h.db.from = (name) => {
    const builder = realFrom(name);
    if (name !== 'alerts') return builder;
    const update = builder.update.bind(builder);
    builder.update = (...args) => {
      writesSeen += 1;
      const inject = injections[writesSeen];
      const out = update(...args);
      if (inject) {
        const then = builder.then.bind(builder);
        builder.then = (resolve, reject) => Promise.resolve(inject(realFrom)).then(() => then(resolve, reject));
      }
      return out;
    };
    return builder;
  };
}

test('POST: a row changed between the check and the write puts back what was applied, and the answer is the same 409', async () => {
  const h = harness({
    alerts: ({ alice }) => [
      { id: A_NEW, profile_id: alice.id, type: 'weather_advisory', title: 'One', message: 'm', dedupe_key: '1', fired_at: '2026-10-14T13:00:00Z' },
      { id: A_READ, profile_id: alice.id, type: 'weather_advisory', title: 'Two', message: 'm', dedupe_key: '2', fired_at: '2026-10-13T13:00:00Z' },
    ],
  });
  interleave(h, { 1: (from) => from('alerts').update({ read: true, revision: 2 }).eq('id', A_READ) });
  const res = await update(h, change(OP, [{ id: A_NEW, revision: 1 }, { id: A_READ, revision: 1 }], { dismissed: true }));
  await expectEnvelope(res, { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.deepEqual([row(h, A_NEW).dismissed, row(h, A_NEW).revision], [false, 3], 'put back, at a revision that only rose');
  assert.deepEqual([row(h, A_READ).read, row(h, A_READ).dismissed, row(h, A_READ).revision], [true, false, 2], 'the other writer\'s change stands');
  assert.equal(ledger(h, OP).status, 'failed');
});

test('POST: when a write that built on this one gets in before the put-back, nothing is clobbered and the outcome is an error, not a success', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({
    alerts: ({ alice }) => [
      { id: A_NEW, profile_id: alice.id, type: 'weather_advisory', title: 'One', message: 'm', dedupe_key: '1', fired_at: '2026-10-14T13:00:00Z' },
      { id: A_READ, profile_id: alice.id, type: 'weather_advisory', title: 'Two', message: 'm', dedupe_key: '2', fired_at: '2026-10-13T13:00:00Z' },
    ],
  });
  interleave(h, {
    1: (from) => from('alerts').update({ revision: 2 }).eq('id', A_READ),
    2: (from) => from('alerts').update({ read: true, revision: 3 }).eq('id', A_NEW),
  });
  const res = await update(h, change(OP, [{ id: A_NEW, revision: 1 }, { id: A_READ, revision: 1 }], { dismissed: true }));
  await expectEnvelope(res, { status: 500, code: 'internal_error' });
  assert.deepEqual([row(h, A_NEW).dismissed, row(h, A_NEW).read, row(h, A_NEW).revision], [true, true, 3], 'the later writer\'s row is left as they wrote it');
  assert.equal(ledger(h, OP).status, 'failed');
  assert.ok(logged.mock.calls.length > 0);
});

// ---------------------------------------------------------------------------
// POST: idempotency through the ledger
// ---------------------------------------------------------------------------

test('POST: the same operation id replays the first receipt and writes nothing the second time', async () => {
  const h = harness();
  const body = change(OP, [{ id: A_NEW, revision: 1 }], { read: true });
  const first = await (await update(h, body)).json();
  const writes = alertWrites(h).length;
  const second = await (await update(h, body)).json();
  assert.deepEqual(second, first);
  assert.equal(alertWrites(h).length, writes, 'no second write');
  assert.equal(row(h, A_NEW).revision, 2, 'advanced once');
  // The same rows in another order are the same request.
  const reordered = await update(h, change(OP_2, [{ id: A_ODD, revision: 3 }, { id: A_GONE, revision: 1 }], { read: true }));
  assert.equal(reordered.status, 200);
  const again = await update(h, change(OP_2, [{ id: A_GONE, revision: 1 }, { id: A_ODD, revision: 3 }], { read: true }));
  assert.equal(again.status, 200);
  assert.equal(row(h, A_ODD).revision, 4);
});

test('POST: the same operation id with a different selection or patch is a 409 mismatch, never a wrong replay', async () => {
  const h = harness();
  await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }));
  const before = h.db.rows('alerts');
  for (const other of [change(OP, [{ id: A_NEW, revision: 1 }], { dismissed: true }), change(OP, [{ id: A_ODD, revision: 3 }], { read: true })]) {
    const body = await expectEnvelope(await update(h, other), { status: 409, code: 'conflict', extraKeys: ['reason'] });
    assert.equal(body.reason, 'operation_mismatch');
  }
  // Another household cannot reuse alice's id to learn anything either.
  const bob = await expectEnvelope(await update(h, change(OP, [{ id: B_ONE, revision: 1 }], { read: true }), { as: 'bob' }), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(bob.reason, 'operation_mismatch');
  assert.deepEqual(h.db.rows('alerts'), before);
});

test('POST: a replay of an operation still running, or that died, is pending or unknown with no inbox, and writes nothing', async () => {
  const body = change(OP, [{ id: A_NEW, revision: 1 }], { read: true });
  const hash = requestHash({ selection: body.selection, patch: body.patch });
  for (const [createdAt, status] of [[ago(1_000), 'pending'], [ago(10 * 60_000), 'unknown']]) {
    const h = harness({
      operations: ({ alice }) => [{ operation_id: OP, profile_id: alice.id, domain: 'alerts', kind: 'alerts.update', status: 'pending', request_hash: hash, created_at: createdAt }],
    });
    const res = await update(h, body);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { operationId: OP, status });
    assert.deepEqual(alertWrites(h), []);
  }
});

test('POST: a replay that meets a settled failed row is a terminal 409 with the recorded reason, in both stored shapes', async () => {
  const body = change(OP, [{ id: A_NEW, revision: 1 }], { read: true });
  const hash = requestHash({ selection: body.selection, patch: body.patch });
  const shapes = [
    // Settled afterwards by the reaper.
    [{ status: 'failed', result: { status: 'failed', reason: 'abandoned' } }, 'operation_abandoned', 'That change was stopped before it finished. Reload your alerts to see where they stand.'],
    // The attempt threw inside the ledger, which stores no receipt.
    [{ status: 'failed', result: null }, 'operation_failed', 'That change did not complete. Reload your alerts to see where they stand.'],
    [{ status: 'cancelled', result: null }, 'operation_cancelled', 'That change was cancelled. Reload your alerts to see where they stand.'],
  ];
  for (const [stored, reason, message] of shapes) {
    const h = harness({
      operations: ({ alice }) => [{ operation_id: OP, profile_id: alice.id, domain: 'alerts', kind: 'alerts.update', request_hash: hash, created_at: ago(10 * 60_000), ...stored }],
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const envelope = await expectEnvelope(await update(h, body), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
      assert.deepEqual([envelope.reason, envelope.error], [reason, message], JSON.stringify(stored));
    }
    assert.deepEqual(alertWrites(h), [], 'a settled operation is never performed again');
  }
});

test('POST: an attempt that failed with a 500 replays as a terminal 409, not a 5xx forever', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const realFrom = h.db.from.bind(h.db);
  let broken = true;
  h.db.from = (name) => {
    const builder = realFrom(name);
    if (name === 'alerts' && broken) builder.update = () => { throw new Error('secret database detail'); };
    return builder;
  };
  const body = change(OP, [{ id: A_NEW, revision: 1 }], { read: true });
  await expectEnvelope(await update(h, body), { status: 500, code: 'internal_error' });
  broken = false;
  const replay = await expectEnvelope(await update(h, body), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(replay.reason, 'operation_failed');
  assert.equal(row(h, A_NEW).read, false, 'the replay did not perform the change after all');
});

test('the ledger route declares maxDuration under the ledger\'s staleness window', async () => {
  const { DEFAULT_STALE_AFTER_MS } = await import('@/lib/operations');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../app/api/alerts/state/route.js', import.meta.url), 'utf8');
  const declared = /^export const maxDuration = (\d+);$/m.exec(source);
  assert.ok(declared, 'POST /api/alerts/state exports maxDuration');
  assert.equal(Number(declared[1]), 60);
  assert.ok(Number(declared[1]) * 1000 < DEFAULT_STALE_AFTER_MS);
});

test('POST: an Idempotency-Key that is not the operationId is refused before anything is claimed', async () => {
  const h = harness();
  const res = await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }), { headers: { 'idempotency-key': OP_2 } });
  const body = await expectEnvelope(res, { status: 400, code: 'validation_failed' });
  assert.deepEqual(body.field_errors.map((e) => e.code), ['idempotency_key_mismatch']);
  assert.deepEqual(h.db.queryLog, []);
  // The header is optional; the body's id is the ledger key.
  assert.equal((await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }), { headers: {} })).status, 200);
});

// ---------------------------------------------------------------------------
// POST: invalid input and the unavailable states
// ---------------------------------------------------------------------------

test('POST: every malformed body is a 400 validation error naming the field, and nothing is read, claimed or written', async () => {
  const ok = { id: A_NEW, revision: 1 };
  const many = Array.from({ length: 101 }, (_, i) => ({ id: `a11ce000-5555-4000-8000-${i.toString(16).padStart(12, '0')}`, revision: 1 }));
  const cases = [
    [{ selection: [ok], patch: { read: true } }, [['operationId', 'invalid_uuid']]],
    [{ operationId: 'not-a-uuid', selection: [ok], patch: { read: true } }, [['operationId', 'invalid_uuid']]],
    [change(OP, [], { read: true }), [['selection', 'selection_required']]],
    [change(OP, 'all', { read: true }), [['selection', 'selection_required']]],
    [change(OP, many, { read: true }), [['selection', 'selection_too_long']]],
    [change(OP, [ok, { ...ok, revision: 2 }], { read: true }), [['selection.1.id', 'duplicate_id']]],
    [change(OP, [ok, { id: A_NEW.toUpperCase(), revision: 1 }], { read: true }), [['selection.1.id', 'duplicate_id']]],
    [change(OP, [{ id: A_NEW, revision: 0 }], { read: true }), [['selection.0.revision', 'invalid_revision']]],
    [change(OP, [{ id: A_NEW, revision: '1' }], { read: true }), [['selection.0.revision', 'invalid_revision']]],
    [change(OP, [{ id: A_NEW, revision: 1.5 }], { read: true }), [['selection.0.revision', 'invalid_revision']]],
    [change(OP, [{ id: A_NEW }], { read: true }), [['selection.0.revision', 'invalid_revision']]],
    [change(OP, [{ id: 'x', revision: 1 }], { read: true }), [['selection.0.id', 'invalid_uuid']]],
    [change(OP, [{ ...ok, profile_id: 'someone' }], { read: true }), [['selection.0.profile_id', 'unknown_field']]],
    [change(OP, [null], { read: true }), [['selection.0', 'invalid_selection']]],
    [change(OP, [ok], undefined), [['patch', 'patch_required']]],
    [change(OP, [ok], {}), [['patch', 'patch_required']]],
    [change(OP, [ok], [true]), [['patch', 'patch_required']]],
    [change(OP, [ok], { read: 'true' }), [['patch.read', 'invalid_boolean']]],
    [change(OP, [ok], { read: null }), [['patch.read', 'invalid_boolean']]],
    [change(OP, [ok], { revision: 9 }), [['patch.revision', 'unknown_field']]],
    [{ ...change(OP, [ok], { read: true }), all: true }, [['all', 'unknown_field']]],
  ];
  for (const [body, expected] of cases) {
    const h = harness();
    const res = await update(h, body, { headers: {} });
    const envelope = await expectEnvelope(res, { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected, JSON.stringify(body).slice(0, 120));
    assert.equal(JSON.stringify(envelope).includes('\u2014'), false);
    assert.deepEqual(h.db.queryLog, [], 'nothing was read, claimed or written');
  }
});

test('POST: a body that is not JSON, or too large, is refused the house way', async () => {
  const h = harness();
  await expectEnvelope(await h.call(ROUTE, 'POST', { as: 'alice', rawBody: '{nope' }), { status: 400, code: 'bad_request' });
  await expectEnvelope(await h.call(ROUTE, 'POST', { as: 'alice', rawBody: '[]' }), { status: 400, code: 'bad_request' });
  await expectEnvelope(await h.call(ROUTE, 'POST', { as: 'alice', rawBody: 'x'.repeat(20_000) }), { status: 413, code: 'payload_too_large' });
  assert.deepEqual(h.db.queryLog, []);
});

test('POST: without a session it is a 401 and nothing is read', async () => {
  const h = harness();
  await expectEnvelope(await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }), { as: null }), { status: 401, code: 'auth_required' });
  assert.deepEqual(h.db.queryLog, []);
});

test('POST: before 0021 it is the one non-retryable 503, decided before the id is claimed, and nothing changes', async () => {
  for (const column of ['revision', 'target_learn']) {
    const h = harness();
    const before = h.db.rows('alerts');
    withoutColumn(h.db, 'alerts', column, '42703');
    const res = await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true }));
    const body = await expectEnvelope(res, { status: 503, code: 'feature_unavailable', retryable: false });
    assert.equal(body.error, 'Settings and alerts are not available yet. Nothing was changed. Please try again later.');
    assert.deepEqual(h.db.rows('operations'), [], `${column}: no operation id was claimed`);
    assert.deepEqual(h.db.rows('alerts'), before);
  }
});

test('POST: before 0017 (no ledger) it is the same 503 and nothing changes', async () => {
  const h = harness({ tables: haloTables('alerts') });
  const before = h.db.rows('alerts');
  await expectEnvelope(await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true })), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.deepEqual(h.db.rows('alerts'), before);
  assert.deepEqual(alertWrites(h), []);
});

test('POST: an unexpected database failure is a 500 with no database text, and the attempt is recorded as failed', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const realFrom = h.db.from.bind(h.db);
  h.db.from = (name) => {
    const builder = realFrom(name);
    if (name === 'alerts') builder.update = () => { throw new Error('secret database detail'); };
    return builder;
  };
  const body = await expectEnvelope(await update(h, change(OP, [{ id: A_NEW, revision: 1 }], { read: true })), { status: 500, code: 'internal_error' });
  assert.equal(JSON.stringify(body).includes('secret'), false);
  assert.equal(ledger(h, OP).status, 'failed');
});

// ---------------------------------------------------------------------------
// The pure parts
// ---------------------------------------------------------------------------

test('every mapped target is one the client can route, and the mapping covers exactly the kinds the rules write', () => {
  assert.deepEqual(Object.keys(inbox.ALERT_PRESENTATION).sort(), [...notificationKinds].sort());
  for (const [kind, { category, target }] of [...Object.entries(inbox.ALERT_PRESENTATION), ['unknown', inbox.UNKNOWN_PRESENTATION]]) {
    const item = { id: 'x', revision: 1, title: 't', body: '', category, date: '2026-10-13', read: false, dismissed: false, target, kind: 'app' };
    assert.equal(validAlertSnapshot({ items: [item], unresolvedOperations: [] }), true, kind);
  }
  assert.equal(inbox.MAX_SELECTION, 100);
});
