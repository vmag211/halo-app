/**
 * lib/privacyToken.js, the privacy review token (B07 plan, Rulings P6, P10
 * and P11).
 *
 *   1. The key: its own variable (never HALO_RECOVERY_TOKEN_KEY), trimmed, a
 *      32-character floor, null otherwise, and scrubbed from route tests.
 *   2. Mint and verify: a round trip; refusal for another household, another
 *      fingerprint, a flipped bit in the payload or the MAC, reordered groups,
 *      expiry, a different key; a missing key reported as unavailable.
 *   3. What the token reveals: no household id and no fingerprint.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SCRUBBED_ENV } from './helpers/sandbox.mjs';
import {
  MIN_REVIEW_KEY_LENGTH,
  REVIEW_TOKEN_TTL_MS,
  mintReviewToken,
  privacyReviewKey,
  readReviewSelection,
  verifyReviewToken,
} from '../lib/privacyToken.js';
import { fingerprintTables } from '../lib/privacyInventory.js';

const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const KEY = 'k'.repeat(16) + 'privacy-review-key-for-tests';
const OTHER_KEY = 'o'.repeat(16) + 'privacy-review-key-for-tests';
const FINGERPRINT = 'a'.repeat(64);
const NOW = new Date('2026-10-19T12:00:00.000Z');
const EM_DASH = String.fromCharCode(0x2014);

const review = (overrides = {}) => ({
  profileId: ALICE,
  scope: 'export',
  groups: ['tasks', 'home'],
  privateText: false,
  fingerprint: FINGERPRINT,
  now: NOW,
  ...overrides,
});

const mint = (overrides) => mintReviewToken(KEY, review(overrides));
const verify = (token, overrides = {}) => verifyReviewToken(KEY, token, { profileId: ALICE, fingerprint: FINGERPRINT, now: NOW, ...overrides });

const decodePayload = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
const encodePayload = (payload) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

/** The token with one bit of one character of segment `index` flipped, staying base64url. */
function flipBit(token, index) {
  const parts = token.split('.');
  const bytes = Buffer.from(parts[index], 'base64url');
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  parts[index] = bytes.toString('base64url');
  return parts.join('.');
}

async function withEnv(env, work) {
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await work();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. The key
// ---------------------------------------------------------------------------

test('the review key is HALO_PRIVACY_REVIEW_KEY, trimmed, with a 32-character floor', async () => {
  assert.equal(MIN_REVIEW_KEY_LENGTH, 32);
  await withEnv({ HALO_PRIVACY_REVIEW_KEY: `  ${KEY}  ` }, () => assert.equal(privacyReviewKey(), KEY));
  await withEnv({ HALO_PRIVACY_REVIEW_KEY: 'x'.repeat(32) }, () => assert.equal(privacyReviewKey(), 'x'.repeat(32)));
  await withEnv({ HALO_PRIVACY_REVIEW_KEY: 'x'.repeat(31) }, () => assert.equal(privacyReviewKey(), null));
  await withEnv({ HALO_PRIVACY_REVIEW_KEY: ' '.repeat(40) }, () => assert.equal(privacyReviewKey(), null));
  await withEnv({ HALO_PRIVACY_REVIEW_KEY: `${'x'.repeat(31)}   ` }, () => assert.equal(privacyReviewKey(), null));
  await withEnv({ HALO_PRIVACY_REVIEW_KEY: undefined }, () => assert.equal(privacyReviewKey(), null));
});

test('the recovery key is never the review key', async () => {
  await withEnv({ HALO_PRIVACY_REVIEW_KEY: undefined, HALO_RECOVERY_TOKEN_KEY: KEY }, () => assert.equal(privacyReviewKey(), null));
  const source = readFileSync(new URL('../lib/privacyToken.js', import.meta.url), 'utf8');
  assert.ok(!/process\.env\.HALO_RECOVERY_TOKEN_KEY/.test(source));
  assert.match(source, /process\.env\.HALO_PRIVACY_REVIEW_KEY/);
});

test('route tests never inherit the review key from the shell', () => {
  assert.ok(SCRUBBED_ENV.includes('HALO_PRIVACY_REVIEW_KEY'));
});

test('a missing or short key is reported as unavailable: nothing is minted and nothing verifies (P11)', () => {
  for (const key of [null, undefined, '', 'x'.repeat(31)]) {
    assert.equal(mintReviewToken(key, review()), null, String(key));
  }
  const { reviewToken } = mint();
  for (const key of [null, undefined, '', 'x'.repeat(31)]) {
    assert.deepEqual(verifyReviewToken(key, reviewToken, { profileId: ALICE, fingerprint: FINGERPRINT, now: NOW }), { ok: false, reason: 'unavailable' });
  }
});

// ---------------------------------------------------------------------------
// 2. Mint and verify
// ---------------------------------------------------------------------------

test('a token round-trips its scope, its sorted groups and the private-text choice', () => {
  const { reviewToken, expiresAt } = mint({ groups: ['tasks', 'home'], privateText: true });
  assert.equal(typeof reviewToken, 'string');
  assert.equal(expiresAt, '2026-10-19T12:10:00.000Z');
  assert.deepEqual(verify(reviewToken), { ok: true, scope: 'export', groups: ['home', 'tasks'], privateText: true });

  for (const scope of ['journal', 'all']) {
    const minted = mint({ scope, groups: [] });
    assert.deepEqual(verify(minted.reviewToken), { ok: true, scope, groups: [], privateText: false });
  }
});

test('expiresAt is ten minutes after now, on a whole second, never later', () => {
  assert.equal(REVIEW_TOKEN_TTL_MS, 600_000);
  const at = new Date('2026-10-19T12:00:00.750Z');
  const { expiresAt } = mint({ now: at });
  const delta = Date.parse(expiresAt) - at.getTime();
  assert.ok(delta <= REVIEW_TOKEN_TTL_MS && delta > REVIEW_TOKEN_TTL_MS - 1000, String(delta));
  assert.equal(decodePayload(mint({ now: at }).reviewToken).e * 1000, Date.parse(expiresAt));
});

test('the token is refused after its expiry, and accepted until just before it', () => {
  const { reviewToken, expiresAt } = mint();
  const end = Date.parse(expiresAt);
  assert.equal(verify(reviewToken, { now: end - 1 }).ok, true);
  assert.deepEqual(verify(reviewToken, { now: end }), { ok: false, reason: 'expired' });
  assert.deepEqual(verify(reviewToken, { now: new Date(end + 60_000) }), { ok: false, reason: 'expired' });
});

test('a token minted for one household fails for another (HO-066)', () => {
  const { reviewToken } = mint();
  assert.deepEqual(verify(reviewToken, { profileId: BOB }), { ok: false, reason: 'mismatch' });
  const bobs = mint({ profileId: BOB });
  assert.deepEqual(verify(bobs.reviewToken), { ok: false, reason: 'mismatch' });
});

test('a token fails once the records it reviewed have changed (another fingerprint)', () => {
  const { reviewToken } = mint();
  assert.deepEqual(verify(reviewToken, { fingerprint: 'b'.repeat(64) }), { ok: false, reason: 'mismatch' });
  assert.deepEqual(verify(reviewToken, { fingerprint: '' }), { ok: false, reason: 'mismatch' });
  assert.deepEqual(verify(reviewToken, { fingerprint: undefined }), { ok: false, reason: 'mismatch' });
});

test('a token signed under a different key fails', () => {
  const { reviewToken } = mintReviewToken(OTHER_KEY, review());
  assert.deepEqual(verify(reviewToken), { ok: false, reason: 'mismatch' });
});

test('a flipped bit in the payload or in the MAC fails', () => {
  const { reviewToken } = mint();
  const payloadFlipped = flipBit(reviewToken, 0);
  assert.notEqual(payloadFlipped, reviewToken);
  assert.equal(verify(payloadFlipped).ok, false);
  const macFlipped = flipBit(reviewToken, 1);
  assert.notEqual(macFlipped, reviewToken);
  assert.deepEqual(verify(macFlipped), { ok: false, reason: 'mismatch' });
});

test('a rewritten payload fails: a widened selection, private text, a later expiry, another scope', () => {
  const { reviewToken } = mint();
  const [, macSegment] = reviewToken.split('.');
  const payload = decodePayload(reviewToken);
  for (const change of [
    { g: ['home', 'journal', 'tasks'] },
    { p: true },
    { e: payload.e + 3600 },
    { s: 'all' },
  ]) {
    const forged = `${encodePayload({ ...payload, ...change })}.${macSegment}`;
    assert.deepEqual(verify(forged), { ok: false, reason: 'mismatch' }, JSON.stringify(change));
  }
});

test('groups in an order that was not re-sorted fail', () => {
  const { reviewToken } = mint({ groups: ['tasks', 'home'] });
  const [, macSegment] = reviewToken.split('.');
  const payload = decodePayload(reviewToken);
  assert.deepEqual(payload.g, ['home', 'tasks']);
  const reordered = `${encodePayload({ ...payload, g: ['tasks', 'home'] })}.${macSegment}`;
  assert.equal(verify(reordered).ok, false);
});

test('anything that is not a token this code mints is malformed', () => {
  const { reviewToken } = mint();
  const payload = decodePayload(reviewToken);
  const [, macSegment] = reviewToken.split('.');
  const shaped = (changes) => `${encodePayload({ ...payload, ...changes })}.${macSegment}`;
  const { n: _nonce, ...withoutNonce } = payload;
  void _nonce;
  for (const token of [
    undefined, null, 42, '', 'abc', `${reviewToken}.extra`, `${reviewToken.replace('.', '!')}`, 'a'.repeat(2000),
    `.${macSegment}`, `${reviewToken.split('.')[0]}.`,
    `${Buffer.from('not json').toString('base64url')}.${macSegment}`,
    shaped({ v: 2 }), shaped({ s: 'delete' }), shaped({ g: ['photos'] }), shaped({ g: ['home', 'home'] }),
    shaped({ p: 'false' }), shaped({ e: 1.5 }), shaped({ n: 'short' }), shaped({ extra: 1 }),
    shaped({ g: [] }),
    `${encodePayload(withoutNonce)}.${macSegment}`,
  ]) {
    assert.deepEqual(verify(token), { ok: false, reason: 'malformed' }, String(token).slice(0, 40));
  }
});

test('readReviewSelection reads the claimed selection with the same parser, and null for anything malformed', () => {
  const { reviewToken } = mint({ groups: ['tasks', 'home'], privateText: true });
  assert.deepEqual(readReviewSelection(reviewToken), { scope: 'export', groups: ['home', 'tasks'], privateText: true });
  assert.deepEqual(readReviewSelection(mint({ scope: 'all', groups: [] }).reviewToken), { scope: 'all', groups: [], privateText: false });
  const payload = decodePayload(reviewToken);
  const [, macSegment] = reviewToken.split('.');
  for (const token of [
    undefined, null, 42, '', 'abc', `${reviewToken}.extra`, 'a'.repeat(2000), `.${macSegment}`,
    `${encodePayload({ ...payload, v: 2 })}.${macSegment}`,
    `${encodePayload({ ...payload, g: ['tasks', 'home'] })}.${macSegment}`,
    `${encodePayload({ ...payload, g: [] })}.${macSegment}`,
  ]) {
    assert.equal(readReviewSelection(token), null, String(token).slice(0, 40));
    // Exactly the tokens verify calls malformed.
    assert.deepEqual(verify(token), { ok: false, reason: 'malformed' });
  }
});

test('readReviewSelection is untrusted: it reads a forged selection, which then fails to verify', () => {
  const { reviewToken } = mint({ groups: ['tasks'] });
  const [, macSegment] = reviewToken.split('.');
  const forged = `${encodePayload({ ...decodePayload(reviewToken), g: ['conversation', 'tasks'], p: true })}.${macSegment}`;
  assert.deepEqual(readReviewSelection(forged), { scope: 'export', groups: ['conversation', 'tasks'], privateText: true });
  assert.deepEqual(verify(forged), { ok: false, reason: 'mismatch' });
});

test('the export flow: read the claimed groups, fingerprint their tables, then verify (Task 2 review, finding 3)', () => {
  // A stand-in for privacy_fingerprint: a value per table set, as the database's would be.
  const fingerprintOf = (tables) => createHash('sha256').update(`${ALICE}:${tables.join(',')}`).digest('hex');
  const groups = ['tasks', 'journal'];
  const { reviewToken } = mintReviewToken(KEY, review({ groups, fingerprint: fingerprintOf(fingerprintTables('export', groups)) }));
  const claimed = readReviewSelection(reviewToken);
  const fingerprint = fingerprintOf(fingerprintTables(claimed.scope, claimed.groups));
  assert.deepEqual(verifyReviewToken(KEY, reviewToken, { profileId: ALICE, fingerprint, now: NOW }), {
    ok: true, scope: 'export', groups: ['journal', 'tasks'], privateText: false,
  });
  // A widened claim leads to another table set, so another fingerprint, so a mismatch.
  const [, macSegment] = reviewToken.split('.');
  const widened = `${encodePayload({ ...decodePayload(reviewToken), g: ['home', 'journal', 'tasks'] })}.${macSegment}`;
  const claimedWide = readReviewSelection(widened);
  const wideFingerprint = fingerprintOf(fingerprintTables(claimedWide.scope, claimedWide.groups));
  assert.deepEqual(verifyReviewToken(KEY, widened, { profileId: ALICE, fingerprint: wideFingerprint, now: NOW }), { ok: false, reason: 'mismatch' });
});

test('mint refuses input a route should already have refused', () => {
  for (const overrides of [
    { profileId: 'not-a-uuid' },
    { scope: 'delete' },
    { groups: ['photos'] },
    { groups: ['tasks', 'tasks'] },
    { groups: [] },
    { privateText: 'yes' },
    { fingerprint: '' },
  ]) {
    assert.throws(() => mint(overrides), TypeError, JSON.stringify(overrides));
  }
});

test('two mints of the same review differ (a fresh nonce), and both verify', () => {
  const first = mint();
  const second = mint();
  assert.notEqual(first.reviewToken, second.reviewToken);
  assert.equal(verify(first.reviewToken).ok, true);
  assert.equal(verify(second.reviewToken).ok, true);
});

// ---------------------------------------------------------------------------
// 3. What the token reveals
// ---------------------------------------------------------------------------

test('the payload carries no household id and no fingerprint, only the selection, the expiry and a nonce', () => {
  const { reviewToken } = mint({ privateText: true });
  const payload = decodePayload(reviewToken);
  assert.deepEqual(Object.keys(payload).sort(), ['e', 'g', 'n', 'p', 's', 'v']);
  const decoded = Buffer.from(reviewToken.split('.')[0], 'base64url').toString('utf8');
  assert.ok(!decoded.includes(ALICE));
  assert.ok(!decoded.includes(FINGERPRINT));
  assert.ok(!reviewToken.includes(ALICE));
  assert.ok(!reviewToken.includes(FINGERPRINT));
  assert.equal(Buffer.from(payload.n, 'base64url').length, 16);
});

test('the module has no em dash and never logs', () => {
  const source = readFileSync(new URL('../lib/privacyToken.js', import.meta.url), 'utf8');
  assert.ok(!source.includes(EM_DASH));
  assert.ok(!/console\./.test(source));
});

test('the comparison is constant time (timingSafeEqual), never string equality on the MAC', () => {
  const source = readFileSync(new URL('../lib/privacyToken.js', import.meta.url), 'utf8');
  assert.match(source, /timingSafeEqual\(expected, received\)/);
});
