/**
 * National Weather Service active-alerts adapter for `forecast.read` (B10 Task 6;
 * plan ruling F7). It fills only the "Official notices" row (`warningStatus`).
 *
 * A new parser, deliberately not the cron's helper: `advisoriesFor` in
 * app/api/cron/daily/route.js turns any failure into `[]` (`.catch(() => [])`)
 * and `parseNwsAdvisories` keeps only flood and heat. Here a failed, timed-out
 * or unparseable lookup is a failure, never an empty list, so "no active
 * alerts" (`{ok: true, alerts: []}`) and "could not check" (`{ok: false}`)
 * stay distinct.
 *
 * Request: `https://api.weather.gov/alerts/active?point={lat},{lon}` (DS-042;
 * "Active alerts for a point", https://www.weather.gov/documentation/services-web-alerts),
 * with the point at 2 decimals (F3). NWS: "A User Agent is required to identify
 * your application", and its example is an application name and a contact
 * address in parentheses, `(myweatherapp.com, <contact address>)`
 * (https://www.weather.gov/documentation/services-web-api, retrieved
 * 2026-10-19). The contact comes from `NWS_CONTACT` (Vibhav, 2026-10-19,
 * superseding the plan's `NWS_USER_AGENT` default) and is never written in
 * source; without a usable contact no request is made and the row is
 * unavailable (`no_contact`).
 *
 * Parsing, per the API's own schema (https://api.weather.gov/openapi.json,
 * retrieved 2026-10-19): `status` is one of Actual, Exercise, System, Test,
 * Draft; `messageType` one of Alert, Update, Cancel, Ack, Error; `ends` is "The
 * expected end time of the subject event" (string or null) and `expires` "The
 * expiry time of the information of the alert message". Kept: every feature
 * with `status` Actual and `messageType` Alert or Update whose `ends ?? expires`
 * is not past, with the NWS `event` name as received. A feature whose kind
 * cannot be read, or a kept one without an id or event name, makes the whole
 * answer `invalid`: dropping it would show "no alerts" where one may be active.
 * A kept alert with neither time readable stays (NWS lists it as active), with
 * `ends: null`.
 *
 * Output (fixed by the plan for Task 7):
 *   {ok: true, fetchedAt, alerts: [{id, event, ends}]}   `ends` ISO UTC or null
 *   {ok: false, reason}   `no_contact`, `invalid`, or the helper's reason
 *                         (`timeout`, `http_<status>`, ...)
 *
 * Network access goes through an injected `getJson` (Task 3's
 * `lib/forecast/http.js` interface: `getJson(url, {timeoutMs, headers, maxBytes})`
 * resolving to `{ok: true, json, status}` or `{ok: false, reason}`).
 */

import { providerPoint } from './providerPoint.js';

export const NWS_ALERTS_ENDPOINT = 'https://api.weather.gov/alerts/active';
export const NWS_TIMEOUT_MS = 6_000;
export const NWS_MAX_BYTES = 2 * 1024 * 1024;

const KEPT_MESSAGE_TYPES = new Set(['Alert', 'Update']);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function clock(now) {
  if (typeof now === 'function') return now();
  if (typeof now === 'number') return now;
  return Date.now();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function instant(value) {
  if (typeof value !== 'string' || !DATE_TIME.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The contact for the User-Agent, or null when `NWS_CONTACT` is unset or not
 * usable: it must be printable ASCII with no spaces, parentheses or commas (it
 * goes inside `(HALO, contact)`), at most 254 characters, and not a reserved
 * example address such as the `.env.example` placeholder.
 */
export function nwsContact(env) {
  // Written as `env.NWS_CONTACT` (not `env?.`) so the sandbox drift scan in test/routeSandbox.test.mjs sees it.
  const raw = env && typeof env === 'object' ? env.NWS_CONTACT : undefined;
  if (typeof raw !== 'string') return null;
  const contact = raw.trim();
  if (contact.length < 3 || contact.length > 254) return null;
  if (!/^[\x21-\x7e]+$/.test(contact) || /[(),]/.test(contact)) return null;
  if (/(?:^|[@.])example\.(?:com|org|net)$/i.test(contact)) return null;
  return contact;
}

/** `(HALO, <contact>)`, the shape of the NWS example, or null without a contact. */
export function nwsUserAgent(env) {
  const contact = nwsContact(env);
  return contact ? `(HALO, ${contact})` : null;
}

/** The F7 alerts URL for a point (rounded to 2 decimals here, whatever the caller passed). */
export function alertsUrl(point) {
  const p = providerPoint(point);
  if (!p) throw new TypeError('alertsUrl: not a usable point');
  return `${NWS_ALERTS_ENDPOINT}?point=${p.lat},${p.lng}`;
}

/**
 * Active, actual alerts in an NWS alerts response, or `{ok: false, reason: 'invalid'}`.
 * @param {unknown} json
 * @param {{now?: (() => number) | number}} [options]
 */
export function parseActiveAlerts(json, { now } = {}) {
  const invalid = { ok: false, reason: 'invalid' };
  if (!isPlainObject(json) || !Array.isArray(json.features)) return invalid;
  const nowMs = clock(now);
  const alerts = [];
  const seen = new Set();
  for (const feature of json.features) {
    if (!isPlainObject(feature) || !isPlainObject(feature.properties)) return invalid;
    const p = feature.properties;
    if (typeof p.status !== 'string' || typeof p.messageType !== 'string') return invalid;
    if (p.status !== 'Actual' || !KEPT_MESSAGE_TYPES.has(p.messageType)) continue;
    const id = nonEmpty(p.id) ?? nonEmpty(feature.id);
    const event = nonEmpty(p.event);
    if (!id || !event) return invalid;
    const end = instant(p.ends) ?? instant(p.expires);
    if (end !== null && end <= nowMs) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    alerts.push({ id, event, ends: end === null ? null : new Date(end).toISOString() });
  }
  return { ok: true, alerts };
}

function failureReason(result) {
  const reason = result?.reason;
  return typeof reason === 'string' && /^[a-z0-9_]{1,40}$/.test(reason) ? reason : 'invalid';
}

/**
 * Looks up the alerts active now at a point. Resolves to the fixed adapter
 * shape; never throws.
 * @param {{lat:number, lng:number}} point
 * @param {{getJson: Function, env?: Record<string, string | undefined>, now?: (() => number) | number}} options
 */
export async function fetchActiveAlerts(point, { getJson, env = process.env, now } = /** @type {any} */ ({})) {
  if (typeof getJson !== 'function') return { ok: false, reason: 'invalid' };
  const userAgent = nwsUserAgent(env);
  if (!userAgent) return { ok: false, reason: 'no_contact' };
  if (!providerPoint(point)) return { ok: false, reason: 'invalid' };

  const fetchedAt = clock(now);
  let result;
  try {
    result = await getJson(alertsUrl(point), {
      timeoutMs: NWS_TIMEOUT_MS,
      maxBytes: NWS_MAX_BYTES,
      headers: { 'User-Agent': userAgent, Accept: 'application/geo+json' },
    });
  } catch {
    // The helper's contract is never to throw; if it does, the answer is a failure, not "no alerts".
    return { ok: false, reason: 'invalid' };
  }
  if (!result || typeof result !== 'object' || !result.ok) return { ok: false, reason: failureReason(result) };
  const parsed = parseActiveAlerts(result.json, { now });
  if (!parsed.ok) return parsed;
  return { ok: true, fetchedAt: new Date(fetchedAt).toISOString(), alerts: parsed.alerts };
}
