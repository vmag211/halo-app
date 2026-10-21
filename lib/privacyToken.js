/**
 * The privacy review token (B07 plan, Rulings P6 and P10).
 *
 * `privacy.inspect` mints one after showing the person what an export would
 * contain or a clear would remove; `privacy.export` and `privacy.clear`
 * accept it as the proof that this household reviewed exactly this selection
 * of these records a few minutes ago. It is stateless and stored nowhere:
 *
 *   token   = base64url(payload) + '.' + base64url(mac)
 *   payload = {v: 1, s: scope, g: groups sorted, p: privateText,
 *              e: expiry in epoch seconds, n: 16 random bytes}
 *   mac     = HMAC-SHA256(HALO_PRIVACY_REVIEW_KEY,
 *               JSON ['halo:privacy-review:v1', profileId, payload segment, fingerprint])
 *
 * The household and the record fingerprint are bound by the MAC and never
 * written into the token, so a token reveals neither, and one minted for one
 * household fails for another (HO-066). The fingerprint
 * (public.privacy_fingerprint, migration 0024) covers home_contexts, so the
 * home context is bound through it as Ruling P1 says; the request's
 * X-Halo-Home-Context header is ignored by every privacy route.
 *
 * The key is its own variable, never HALO_RECOVERY_TOKEN_KEY, so rotating one
 * does not void the other (digest 8.3). It has the same 32-character floor and
 * the same refusal to fall back to a default (lib/recovery.js restoreTokenKey).
 * Without a usable key privacy is unavailable: `privacyReviewKey()` is null,
 * `mintReviewToken` mints nothing, and `verifyReviewToken` answers
 * `{ok: false, reason: 'unavailable'}`; the routes answer 503 (P11).
 *
 * Nothing here logs. A token, a fingerprint or a key never belongs in a log.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { EXPORT_GROUPS, PRIVACY_SCOPES } from './privacyInventory.js';

/** Thirty two characters, the recovery key's floor (lib/recovery.js MIN_KEY_LENGTH). */
export const MIN_REVIEW_KEY_LENGTH = 32;

/** Ten minutes: long enough to read the preview and type DELETE (P10). */
export const REVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;

const TOKEN_VERSION = 1;
const MAC_DOMAIN = 'halo:privacy-review:v1';
const NONCE_BYTES = 16;
/** Far above any real token (about 200 characters), so a huge string is refused unparsed. */
const MAX_TOKEN_LENGTH = 1024;
const PAYLOAD_KEYS = ['e', 'g', 'n', 'p', 's', 'v'];
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The configured review key, or null. Server side only, never a `NEXT_PUBLIC_`
 * variable. Whitespace is trimmed, and a value shorter than 32 characters is
 * no key at all, which shuts the capability rather than signing with
 * something guessable. Length is not entropy: choosing a random key is an
 * operational requirement this cannot check.
 */
export function privacyReviewKey() {
  const value = process.env.HALO_PRIVACY_REVIEW_KEY;
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length >= MIN_REVIEW_KEY_LENGTH ? key : null;
}

const usableKey = (key) => typeof key === 'string' && key.length >= MIN_REVIEW_KEY_LENGTH;

const encode = (text) => Buffer.from(text, 'utf8').toString('base64url');

function mac(key, profileId, payloadSegment, fingerprint) {
  return createHmac('sha256', key)
    .update(JSON.stringify([MAC_DOMAIN, profileId, payloadSegment, fingerprint]))
    .digest('base64url');
}

/** Groups in one canonical order, so the same selection always signs the same way. */
const sortedGroups = (groups) => [...groups].sort();

function checkMintInput({ profileId, scope, groups, privateText, fingerprint }) {
  if (typeof profileId !== 'string' || !UUID.test(profileId)) throw new TypeError('privacyToken: profileId must be a UUID');
  if (!PRIVACY_SCOPES.includes(scope)) throw new TypeError('privacyToken: unknown scope');
  if (!Array.isArray(groups) || groups.some((group) => !EXPORT_GROUPS.includes(group)) || new Set(groups).size !== groups.length) {
    throw new TypeError('privacyToken: groups must be distinct export groups');
  }
  if (scope === 'export' && groups.length === 0) throw new TypeError('privacyToken: an export needs at least one group');
  if (typeof privateText !== 'boolean') throw new TypeError('privacyToken: privateText must be a boolean');
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) throw new TypeError('privacyToken: fingerprint is required');
}

const nowMs = (now) => (now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now());

/**
 * Mints a review token for this household's review of this selection.
 * Returns `{reviewToken, expiresAt}` (`expiresAt` an ISO instant at most ten
 * minutes after `now`, on a whole second), or null when `key` is not a usable
 * key, never a token signed with a default. Throws TypeError on input the
 * route should already have refused.
 *
 * @param {string|null} key from privacyReviewKey()
 * @param {{ profileId: string, scope: 'export'|'journal'|'all', groups: string[],
 *           privateText: boolean, fingerprint: string, now?: Date|number }} review
 */
export function mintReviewToken(key, { profileId, scope, groups, privateText, fingerprint, now } = {}) {
  if (!usableKey(key)) return null;
  checkMintInput({ profileId, scope, groups, privateText, fingerprint });
  const expirySeconds = Math.floor((nowMs(now) + REVIEW_TOKEN_TTL_MS) / 1000);
  const payload = {
    v: TOKEN_VERSION,
    s: scope,
    g: sortedGroups(groups),
    p: privateText,
    e: expirySeconds,
    n: randomBytes(NONCE_BYTES).toString('base64url'),
  };
  const segment = encode(JSON.stringify(payload));
  return {
    reviewToken: `${segment}.${mac(key, profileId, segment, fingerprint)}`,
    expiresAt: new Date(expirySeconds * 1000).toISOString(),
  };
}

/** The payload of a well formed token, or null. Checks shape only, never the MAC. */
function parsePayload(segment) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = Object.keys(payload).sort();
  if (keys.length !== PAYLOAD_KEYS.length || keys.some((name, index) => name !== PAYLOAD_KEYS[index])) return null;
  const { v, s, g, p, e, n } = payload;
  if (v !== TOKEN_VERSION || !PRIVACY_SCOPES.includes(s) || typeof p !== 'boolean' || !Number.isSafeInteger(e) || e <= 0) return null;
  if (typeof n !== 'string' || Buffer.from(n, 'base64url').length !== NONCE_BYTES) return null;
  if (!Array.isArray(g) || g.some((group) => !EXPORT_GROUPS.includes(group)) || new Set(g).size !== g.length) return null;
  // A token is minted with its groups sorted; any other order was not minted here.
  if (g.some((group, index) => group !== sortedGroups(g)[index])) return null;
  if (s === 'export' && g.length === 0) return null;
  return payload;
}

/** The payload and the two segments of a well formed token, or null. Shape only, never the MAC. */
function splitToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !BASE64URL.test(parts[0]) || !BASE64URL.test(parts[1])) return null;
  const payload = parsePayload(parts[0]);
  return payload ? { payload, segment: parts[0], given: parts[1] } : null;
}

/**
 * The selection a token CLAIMS, `{scope, groups, privateText}`, or null when
 * it is not a token this code mints. UNTRUSTED until verifyReviewToken holds:
 * nothing here checks the MAC, the household or the expiry, so anyone can
 * write a token that reads as any selection. It exists for exactly one use:
 * an export route must recompute the fingerprint over the tables of the
 * token's groups (privacyInventory's fingerprintTables('export', groups))
 * before it can verify, and the request body carries only the token. So:
 *
 *   const claimed = readReviewSelection(token);           // null: 400 malformed
 *   const tables = fingerprintTables(claimed.scope, claimed.groups);
 *   const fingerprint = await privacyFingerprint(supabase, { profileId, tables });
 *   const verified = verifyReviewToken(key, token, { profileId, fingerprint });
 *   // act on verified.groups and verified.privateText, never on `claimed`
 *
 * A forged selection gains nothing: the fingerprint it leads to is bound by
 * the MAC, so verification fails unless that household minted exactly that
 * selection. This is the same parser verifyReviewToken uses, so the two
 * cannot drift.
 *
 * @param {unknown} token as the client sent it
 * @returns {{ scope: 'export'|'journal'|'all', groups: string[], privateText: boolean } | null}
 */
export function readReviewSelection(token) {
  const parsed = splitToken(token);
  if (!parsed) return null;
  const { s, g, p } = parsed.payload;
  return { scope: s, groups: [...g], privateText: p };
}

/**
 * Whether `token` is a review this household opened, for these records, that
 * has not expired. Returns `{ok: true, scope, groups, privateText}` or
 * `{ok: false, reason}`, where reason is:
 *
 *   'unavailable'  no usable key (privacy is off, P11)
 *   'malformed'    not a token this code mints (the route's 400)
 *   'mismatch'     the MAC does not hold for this household and fingerprint:
 *                  another household's token, records changed since review,
 *                  a different key, or tampering (the route's 409)
 *   'expired'      authentic but past its ten minutes (the route's 409)
 *
 * The MAC is checked before the expiry, so only an authentic token can be
 * told it expired. The comparison is constant time.
 *
 * @param {string|null} key from privacyReviewKey()
 * @param {unknown} token as the client sent it
 * @param {{ profileId: string, fingerprint: string, now?: Date|number }} current
 *   the verified caller and the fingerprint recomputed now
 */
export function verifyReviewToken(key, token, { profileId, fingerprint, now } = {}) {
  if (!usableKey(key)) return { ok: false, reason: 'unavailable' };
  const parsed = splitToken(token);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const { payload, segment, given } = parsed;
  if (typeof profileId !== 'string' || typeof fingerprint !== 'string' || fingerprint.length === 0) {
    return { ok: false, reason: 'mismatch' };
  }
  const expected = Buffer.from(mac(key, profileId, segment, fingerprint), 'utf8');
  const received = Buffer.from(given, 'utf8');
  // Different lengths leak only the length, a constant for a real MAC.
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: 'mismatch' };
  if (nowMs(now) >= payload.e * 1000) return { ok: false, reason: 'expired' };
  return { ok: true, scope: payload.s, groups: [...payload.g], privateText: payload.p };
}
