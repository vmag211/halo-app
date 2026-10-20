/**
 * lib/privacyStore.js, the wrappers for migration 0024's functions (B07 plan,
 * Task 2; Rulings P3, P6, P10, P11 and P15), against a stubbed client: 0024 is
 * written in parallel, so these pin the calls to the signatures in the plan
 * (and the assumptions A1 to A7 in the module header) rather than to a
 * database.
 *
 *   1. Each wrapper calls its function once, with every argument by name.
 *   2. Results: the function's shape is passed on, anything else is refused.
 *   3. The five refusal codes and the four "not applied yet" codes.
 *   4. The 503, and the module's copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIVACY_DOMAIN,
  PRIVACY_REFUSALS,
  clearHouseholdRecords,
  isPrivacyUnavailable,
  privacyCounts,
  privacyFingerprint,
  privacyRefusal,
  privacyUnavailable,
  probePrivacySchema,
  purgeAllPrivacyReceipts,
  purgePrivacyReceipts,
} from '../lib/privacyStore.js';
import { FINGERPRINT_TABLES } from '../lib/privacyInventory.js';

const ALICE = '00000000-0000-4000-8000-000000000001';
const OP = '5e5e5e5e-7777-4000-8000-000000000001';
const EM_DASH = String.fromCharCode(0x2014);

/** A client whose rpc records each call and answers with `answer(name, args)`. */
function stubClient(answer) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return answer(name, args);
    },
  };
}
const ok = (data) => () => ({ data, error: null });
const fail = (error) => () => ({ data: null, error });
const refusal = (code) => ({ code: 'P0001', message: code, details: 'Failing row contains (secret stuff)', hint: null });

// ---------------------------------------------------------------------------
// 1. Calls, by name
// ---------------------------------------------------------------------------

test('probePrivacySchema calls privacy_schema_version with no arguments and accepts version 1 only', async () => {
  const client = stubClient(ok(1));
  assert.deepEqual(await probePrivacySchema(client), { available: true });
  assert.deepEqual(client.calls, [{ name: 'privacy_schema_version', args: undefined }]);
  assert.deepEqual(await probePrivacySchema(stubClient(ok(2))), { available: false, code: 'version' });
  assert.deepEqual(await probePrivacySchema(stubClient(ok(null))), { available: false, code: 'version' });
});

test('privacyFingerprint passes p_profile_id and p_tables, the tables in FINGERPRINT_TABLES order', async () => {
  const client = stubClient(ok('f'.repeat(64)));
  const fingerprint = await privacyFingerprint(client, { profileId: ALICE, tables: ['luna_turns', 'profiles', 'symptom_logs'] });
  assert.equal(fingerprint, 'f'.repeat(64));
  assert.deepEqual(client.calls, [{
    name: 'privacy_fingerprint',
    args: { p_profile_id: ALICE, p_tables: ['profiles', 'symptom_logs', 'luna_turns'] },
  }]);
  const all = stubClient(ok('x'));
  await privacyFingerprint(all, { profileId: ALICE, tables: [...FINGERPRINT_TABLES].reverse() });
  assert.deepEqual(all.calls[0].args.p_tables, [...FINGERPRINT_TABLES]);
  const none = stubClient(ok('empty'));
  await privacyFingerprint(none, { profileId: ALICE, tables: [] });
  assert.deepEqual(none.calls[0].args, { p_profile_id: ALICE, p_tables: [] });
});

test('privacyFingerprint refuses a table outside the fingerprint list without calling the database', async () => {
  const client = stubClient(ok('x'));
  for (const tables of [['daily_scores'], ['operations'], 'profiles', undefined]) {
    await assert.rejects(privacyFingerprint(client, { profileId: ALICE, tables }), /FINGERPRINT_TABLES/);
  }
  assert.equal(client.calls.length, 0);
});

test('privacyCounts passes p_profile_id and p_scope, for a clear scope only', async () => {
  const counts = { symptom_logs: 3, alerts: 1 };
  const client = stubClient(ok(counts));
  assert.deepEqual(await privacyCounts(client, { profileId: ALICE, scope: 'journal' }), counts);
  assert.deepEqual(client.calls, [{ name: 'privacy_counts', args: { p_profile_id: ALICE, p_scope: 'journal' } }]);
  await privacyCounts(client, { profileId: ALICE, scope: 'all' });
  assert.deepEqual(client.calls[1].args, { p_profile_id: ALICE, p_scope: 'all' });
  // B11 Ruling W8: clear all also counts the workspace, journal does not.
  assert.deepEqual(client.calls[2], { name: 'workspace_privacy_counts', args: { p_profile_id: ALICE } });
  // B14 Ruling A12: and the private files.
  assert.deepEqual(client.calls[3], { name: 'attachment_privacy_counts', args: { p_profile_id: ALICE } });
  await assert.rejects(privacyCounts(client, { profileId: ALICE, scope: 'export' }), /clear scope/);
  assert.equal(client.calls.length, 4);
});

test('privacyCounts for clear all adds the workspace count, and before 0026 counts without it', async () => {
  const calls = [];
  const answer = (name) => (name === 'privacy_counts' ? ok({ symptom_logs: 2 }) : name === 'attachment_privacy_counts' ? ok({ household_attachments: 1 }) : ok({ household_workspace_records: 4 }))();
  const client = { rpc: async (name) => { calls.push(name); return answer(name); } };
  assert.deepEqual(await privacyCounts(client, { profileId: ALICE, scope: 'all' }), { symptom_logs: 2, household_workspace_records: 4, household_attachments: 1 });
  assert.deepEqual(calls, ['privacy_counts', 'workspace_privacy_counts', 'attachment_privacy_counts']);
  // 0026 applied, 0028 not yet: the workspace is counted, the files are not.
  const noFiles = { rpc: async (name) => (name === 'attachment_privacy_counts' ? { data: null, error: { code: 'PGRST202', message: 'missing' } } : answer(name)) };
  assert.deepEqual(await privacyCounts(noFiles, { profileId: ALICE, scope: 'all' }), { symptom_logs: 2, household_workspace_records: 4 });
  const missing = { rpc: async (name) => (name === 'privacy_counts' ? ok({ symptom_logs: 2 })() : { data: null, error: { code: 'PGRST202', message: 'missing' } }) };
  assert.deepEqual(await privacyCounts(missing, { profileId: ALICE, scope: 'all' }), { symptom_logs: 2 });
  const broken = { rpc: async (name) => (name === 'privacy_counts' ? ok({ symptom_logs: 2 })() : { data: null, error: { code: '57014', message: 'timeout' } }) };
  await assert.rejects(privacyCounts(broken, { profileId: ALICE, scope: 'all' }), (error) => error.code === '57014');
});

test('clearHouseholdRecords passes p_profile_id, p_operation_id, p_scope and p_fingerprint', async () => {
  const client = stubClient(ok({ receipt: { operationId: OP, status: 'succeeded', scope: 'all' }, removed: 41 }));
  const result = await clearHouseholdRecords(client, { profileId: ALICE, operationId: OP, scope: 'all', fingerprint: 'fp' });
  assert.deepEqual(result, { receipt: { operationId: OP, status: 'succeeded', scope: 'all' }, removed: 41 });
  assert.deepEqual(client.calls, [{
    name: 'clear_household_records',
    args: { p_profile_id: ALICE, p_operation_id: OP, p_scope: 'all', p_fingerprint: 'fp' },
  }]);
});

test('purgePrivacyReceipts passes the owner; the global purge passes p_profile_id null explicitly (A1)', async () => {
  const client = stubClient(ok(2));
  assert.equal(await purgePrivacyReceipts(client, { profileId: ALICE }), 2);
  assert.equal(await purgeAllPrivacyReceipts(client), 2);
  assert.deepEqual(client.calls, [
    { name: 'purge_privacy_receipts', args: { p_profile_id: ALICE } },
    { name: 'purge_privacy_receipts', args: { p_profile_id: null } },
  ]);
});

test('an owner is required, so a missing one can never widen a call to every household', async () => {
  const client = stubClient(ok(0));
  for (const profileId of [undefined, null, '']) {
    await assert.rejects(purgePrivacyReceipts(client, { profileId }), /requires an owner/);
    await assert.rejects(privacyFingerprint(client, { profileId, tables: [] }), /requires an owner/);
    await assert.rejects(privacyCounts(client, { profileId, scope: 'all' }), /requires an owner/);
    await assert.rejects(clearHouseholdRecords(client, { profileId, operationId: OP, scope: 'all', fingerprint: 'f' }), /requires an owner/);
  }
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Results
// ---------------------------------------------------------------------------

test('a result that is not the function\'s shape is refused, not passed on', async () => {
  for (const data of [null, '', 42, 'x'.repeat(257)]) {
    await assert.rejects(privacyFingerprint(stubClient(ok(data)), { profileId: ALICE, tables: [] }), /unexpected shape/, String(data));
  }
  for (const data of [null, [], { symptom_logs: -1 }, { symptom_logs: 1.5 }, { symptom_logs: '3' }]) {
    await assert.rejects(privacyCounts(stubClient(ok(data)), { profileId: ALICE, scope: 'journal' }), /unexpected shape/, JSON.stringify(data));
  }
  const good = { operationId: OP, status: 'succeeded', scope: 'journal' };
  for (const data of [
    null,
    { receipt: good },
    { receipt: good, removed: -1 },
    { receipt: { ...good, operationId: 'other' }, removed: 1 },
    { receipt: { ...good, status: 'failed' }, removed: 1 },
    { receipt: { ...good, scope: 'all' }, removed: 1 },
    { receipt: { ...good, file: { text: 'records' } }, removed: 1 },
  ]) {
    await assert.rejects(
      clearHouseholdRecords(stubClient(ok(data)), { profileId: ALICE, operationId: OP, scope: 'journal', fingerprint: 'f' }),
      /unexpected shape/,
      JSON.stringify(data),
    );
  }
  for (const data of [null, -1, '1', 1.5]) {
    await assert.rejects(purgePrivacyReceipts(stubClient(ok(data)), { profileId: ALICE }), /unexpected shape/, String(data));
  }
});

test('the clear\'s receipt is rebuilt from known values only, never copied wholesale', async () => {
  const client = stubClient(ok({ receipt: { operationId: OP, status: 'succeeded', scope: 'journal' }, removed: 0, extra: 'x' }));
  const { receipt } = await clearHouseholdRecords(client, { profileId: ALICE, operationId: OP, scope: 'journal', fingerprint: 'f' });
  assert.deepEqual(Object.keys(receipt), ['operationId', 'status', 'scope']);
});

test('the clear\'s receipt check lowercases the operation id, as Postgres writes a uuid (Task 2 review, finding 7)', async () => {
  const upper = OP.toUpperCase();
  const client = stubClient(ok({ receipt: { operationId: OP, status: 'succeeded', scope: 'all' }, removed: 3 }));
  const result = await clearHouseholdRecords(client, { profileId: ALICE, operationId: upper, scope: 'all', fingerprint: 'f' });
  assert.deepEqual(result, { receipt: { operationId: OP, status: 'succeeded', scope: 'all' }, removed: 3 });
  // A receipt for another id is still refused, in any case.
  const other = stubClient(ok({ receipt: { operationId: OP.replace(/1$/, '2'), status: 'succeeded', scope: 'all' }, removed: 3 }));
  await assert.rejects(clearHouseholdRecords(other, { profileId: ALICE, operationId: upper, scope: 'all', fingerprint: 'f' }), /unexpected shape/);
});

// ---------------------------------------------------------------------------
// 3. Refusals and "not applied yet"
// ---------------------------------------------------------------------------

test('the five refusal codes map to their reasons; anything else is not a refusal', () => {
  assert.deepEqual(PRIVACY_REFUSALS, {
    HALO_INVALID_INPUT: 'invalid_input',
    HALO_OPERATION_NOT_PENDING: 'operation_not_pending',
    HALO_REVIEW_CHANGED: 'review_changed',
    HALO_BUSY: 'busy',
    HALO_OPERATION_SETTLED: 'operation_settled',
  });
  for (const [code, reason] of Object.entries(PRIVACY_REFUSALS)) {
    const read = privacyRefusal(refusal(code));
    assert.deepEqual(read, { code, reason });
    assert.ok(!JSON.stringify(read).includes('secret'), 'the details are never read');
  }
  for (const error of [
    null,
    undefined,
    { code: 'P0001', message: 'HALO_STALE_BASE' },
    { code: 'P0001', message: 'HALO_BUSY: and more' },
    { code: 'P0001', message: 'hasOwnProperty' },
    { code: '23505', message: 'HALO_BUSY' },
    { code: 'P0001' },
    new Error('HALO_BUSY'),
  ]) {
    assert.equal(privacyRefusal(error), null, JSON.stringify(error));
  }
});

test('a refusal from a wrapper is thrown as it came, for privacyRefusal to read', async () => {
  for (const code of ['HALO_REVIEW_CHANGED', 'HALO_BUSY', 'HALO_OPERATION_NOT_PENDING', 'HALO_INVALID_INPUT']) {
    const client = stubClient(fail(refusal(code)));
    await assert.rejects(
      clearHouseholdRecords(client, { profileId: ALICE, operationId: OP, scope: 'all', fingerprint: 'f' }),
      (error) => privacyRefusal(error)?.code === code,
    );
  }
  await assert.rejects(
    privacyFingerprint(stubClient(fail(refusal('HALO_INVALID_INPUT'))), { profileId: ALICE, tables: ['profiles'] }),
    (error) => privacyRefusal(error)?.reason === 'invalid_input',
  );
});

test('the four "not applied yet" codes are unavailable; others are not', async () => {
  for (const code of ['PGRST202', '42883', 'PGRST205', '42P01']) {
    assert.equal(isPrivacyUnavailable({ code, message: 'missing' }), true, code);
    assert.deepEqual(await probePrivacySchema(stubClient(fail({ code, message: 'missing' }))), { available: false, code });
    await assert.rejects(privacyCounts(stubClient(fail({ code })), { profileId: ALICE, scope: 'all' }), (error) => isPrivacyUnavailable(error));
  }
  for (const error of [null, undefined, { code: 'P0001', message: 'HALO_BUSY' }, { code: '42703' }, { code: 'PGRST204' }, { code: '57014' }]) {
    assert.equal(isPrivacyUnavailable(error), false, JSON.stringify(error));
  }
  await assert.rejects(probePrivacySchema(stubClient(fail({ code: '57014', message: 'timeout' }))), (error) => error.code === '57014');
});

// ---------------------------------------------------------------------------
// 4. The 503 and the copy
// ---------------------------------------------------------------------------

test('privacyUnavailable is a non-retryable 503 feature_unavailable with the request id', async () => {
  const response = privacyUnavailable('req-12345678');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-Request-Id'), 'req-12345678');
  const body = await response.json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal(body.retryable, false);
  assert.equal(body.request_id, 'req-12345678');
  assert.ok(!Object.hasOwn(body, 'data'));
  assert.ok(!body.message.includes(EM_DASH));
});

test('privacyLimiter is 30 per hour per household (P17), and the route harness stub exports it', async () => {
  const limits = readFileSync(new URL('../lib/ratelimit.js', import.meta.url), 'utf8');
  const found = /privacyLimiter = new Ratelimit\(\{[\s\S]*?slidingWindow\((\d+), '([^']+)'\)/.exec(limits);
  assert.ok(found, 'privacyLimiter is declared');
  assert.equal(Number(found[1]), 30);
  assert.equal(found[2], '1 h');
  const stub = readFileSync(new URL('./helpers/stubs/ratelimit.mjs', import.meta.url), 'utf8');
  assert.match(stub, /export const privacyLimiter = allowAll\(\);/);
});

test('the domain is privacy, and the module has no em dash, no select and no log', () => {
  assert.equal(PRIVACY_DOMAIN, 'privacy');
  const source = readFileSync(new URL('../lib/privacyStore.js', import.meta.url), 'utf8');
  assert.ok(!source.includes(EM_DASH));
  assert.ok(!/console\./.test(source));
  assert.ok(!/\.select\(/.test(source));
});

// ---------------------------------------------------------------------------
// Task 7: the helpers folded into this module (kinds, log codes, the opening)
// ---------------------------------------------------------------------------

const { PRIVACY_KINDS, loggableCode, openPrivacy, privacyScopeOfKind } = await import('../lib/privacyStore.js');

test('loggableCode keeps only a short code: never a message, a long or odd code, or a non-string', () => {
  assert.equal(loggableCode({ code: 'PGRST202', message: 'Could not find public.privacy_schema_version for profile a11ce' }), 'PGRST202');
  assert.equal(loggableCode({ code: 'XX000' }), 'XX000');
  for (const err of [
    { message: 'relation "operations" for 00000000-0000-4000-8000-00000000000a' },
    { code: 'a'.repeat(17) },
    { code: 'HALO 0024: 35.409,-80.581' },
    { code: 42 },
    null,
    undefined,
    'a bare string error',
  ]) assert.equal(loggableCode(err), 'unexpected', JSON.stringify(err));
});

test('PRIVACY_KINDS and privacyScopeOfKind are one table, both ways', () => {
  assert.ok(Object.isFrozen(PRIVACY_KINDS));
  for (const [scope, kind] of Object.entries(PRIVACY_KINDS)) assert.equal(privacyScopeOfKind(kind), scope);
  for (const kind of ['privacy.clear', 'toString', '__proto__', '', null]) assert.equal(privacyScopeOfKind(kind), null);
});

test('openPrivacy checks the key before asking the database, then the 0024 probe', async () => {
  const saved = process.env.HALO_PRIVACY_REVIEW_KEY;
  const calls = [];
  const db = (answer) => ({ rpc: async (name) => { calls.push(name); return answer; } });
  try {
    delete process.env.HALO_PRIVACY_REVIEW_KEY;
    assert.equal(await openPrivacy(db({ data: 1, error: null })), null);
    process.env.HALO_PRIVACY_REVIEW_KEY = 'short';
    assert.equal(await openPrivacy(db({ data: 1, error: null })), null);
    assert.deepEqual(calls, [], 'no key: nothing is asked of the database');
    const key = 'privacy-review-key-for-tests-only-0123456789';
    process.env.HALO_PRIVACY_REVIEW_KEY = key;
    assert.equal(await openPrivacy(db({ data: 1, error: null })), key);
    assert.equal(await openPrivacy(db({ data: null, error: { code: 'PGRST202', message: 'missing' } })), null, 'before 0024');
    assert.equal(await openPrivacy(db({ data: 2, error: null })), null, 'another 0024 version');
    await assert.rejects(openPrivacy(db({ data: null, error: { code: 'XX000', message: 'boom' } })), (err) => err.code === 'XX000', 'any other failure propagates');
    assert.equal(calls.length, 4, 'one probe per call with a key');
  } finally {
    if (saved === undefined) delete process.env.HALO_PRIVACY_REVIEW_KEY;
    else process.env.HALO_PRIVACY_REVIEW_KEY = saved;
  }
});
