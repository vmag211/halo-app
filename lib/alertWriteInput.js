/**
 * The bodies of the two inbox write routes.
 *
 * POST /api/alerts  { id?, dismissed?, all? }
 *   id         an alert id, a UUID (returned lower case, the form the database holds)
 *   dismissed  true to dismiss the alert, false to bring it back
 *   all        true to mark every unread alert read
 *   Which one happens, in this order, as it always has: `id` with a boolean
 *   `dismissed` dismisses (or restores) that alert; otherwise `all: true` marks every
 *   unread alert read (any `id` next to it is not used); otherwise `id` marks that
 *   alert read. Anything else is "provide an id, all:true, or id with dismissed".
 *   Each field that is present must be well formed: an id that is not a UUID (a
 *   number or a list used to be skipped as if it were not there), and a `dismissed`
 *   or `all` that is not a boolean (the string "true" used to fall through to the
 *   next action, so a dismiss quietly became "mark read"). `null` counts as not sent.
 *   Unknown keys are ignored.
 *
 * PUT /api/notifications  { preferences: { <type>: boolean, ... } }
 *   `preferences` must be an object (not a list), every key one of NOTIFICATION_TYPES
 *   and every value true or false. Types left out keep their stored value, and an
 *   empty object changes nothing, as before. Unknown keys outside `preferences` are
 *   ignored.
 *
 * Both return `{ ok: true, value }` or `{ ok: false, fieldErrors }` (pass fieldErrors
 * to validationError). Pure module.
 */

import { parseBoolean, parseUuid } from './validate.js';
import { NOTIFICATION_TYPES } from './alertInputs.js';

const sent = (value) => value !== undefined && value !== null;
const KEY_ECHO_MAX = 40;

/**
 * @param {object} body the parsed JSON object
 * @returns {{ ok: true, value: { kind: 'dismiss', id: string, dismissed: boolean } | { kind: 'read_all' } | { kind: 'read', id: string } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseAlertAction(body) {
  const fieldErrors = [];

  let id = null;
  if (sent(body.id)) {
    const parsed = parseUuid(body.id);
    if (parsed.ok) id = parsed.value;
    else fieldErrors.push({ field: 'id', code: parsed.code, message: 'That alert id is not valid.' });
  }
  let dismissed = null;
  if (sent(body.dismissed)) {
    const parsed = parseBoolean(body.dismissed);
    if (parsed.ok) dismissed = parsed.value;
    else fieldErrors.push({ field: 'dismissed', code: parsed.code, message: 'dismissed must be true or false.' });
  }
  let all = false;
  if (sent(body.all)) {
    const parsed = parseBoolean(body.all);
    if (parsed.ok) all = parsed.value;
    else fieldErrors.push({ field: 'all', code: parsed.code, message: 'all must be true or false.' });
  }
  if (fieldErrors.length > 0) return { ok: false, fieldErrors };

  if (id !== null && dismissed !== null) return { ok: true, value: { kind: 'dismiss', id, dismissed } };
  if (all) return { ok: true, value: { kind: 'read_all' } };
  if (id !== null) return { ok: true, value: { kind: 'read', id } };
  return {
    ok: false,
    fieldErrors: [{ field: 'body', code: 'action_required', message: 'Provide an id, all:true, or id with dismissed.' }],
  };
}

/**
 * @param {object} body the parsed JSON object
 * @returns {{ ok: true, value: Record<string, boolean> } | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseNotificationUpdate(body) {
  const incoming = body.preferences;
  if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return {
      ok: false,
      fieldErrors: [{ field: 'preferences', code: 'preferences_required', message: 'Send { preferences: { type: boolean } }.' }],
    };
  }

  const fieldErrors = [];
  const update = {};
  for (const [key, value] of Object.entries(incoming)) {
    const shown = Array.from(key).slice(0, KEY_ECHO_MAX).join('');
    if (!NOTIFICATION_TYPES.includes(key)) {
      fieldErrors.push({ field: `preferences.${shown}`, code: 'unknown_type', message: `Unknown notification type: ${shown}` });
    } else if (typeof value !== 'boolean') {
      fieldErrors.push({ field: `preferences.${key}`, code: 'invalid_boolean', message: `${key} must be true or false.` });
    } else {
      update[key] = value;
    }
  }
  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: update };
}
