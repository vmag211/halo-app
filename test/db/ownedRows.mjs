/**
 * One valid row for every household-owned table, owned by `owner`, for the
 * PGlite tests that need a row in each: test/rlsIsolation.test.mjs (what a
 * signed-in browser can reach) and test/privacyClearDb.test.mjs (what a
 * privacy clear removes and keeps). Moved here from rlsIsolation unchanged
 * (B07 plan, Task 1), so a new owned table gets one factory and both suites
 * use it: rlsIsolation fails when a table in OWNED_TABLES has none.
 *
 * `n` varies the unique keys: seeds use 0, attempts and extra rows use 1, 2.
 */
import { createHash } from 'node:crypto';

/** A uuid derived from the owner's, so 0020's parent and child rows can be written without passing ids around. */
export const lunaId = (owner, suffix) => `${owner.slice(0, 24)}${'0'.repeat(12 - suffix.length)}${suffix}`;

/**
 * The id of a household's n-th seeded home context, derived from the owner's
 * like lunaId, so 0025's daily maxima can name their home without passing ids
 * around (test/privacyClearDb.test.mjs used the same values before this).
 */
export const homeContextId = (owner, n) => lunaId(owner, `c${n}0${n}`);

/** A valid row for each owned table, owned by `owner`; `n` varies unique keys (seeds use 0, attempts use 1). */
export const OWNED_ROW = {
  profiles: (owner) => ({ id: owner, county: 'Test County' }),
  daily_scores: (owner, n) => ({ profile_id: owner, date: `2026-09-1${n}`, aqi: 40 }),
  home_risks: (owner) => ({ profile_id: owner }),
  household_bands: (owner) => ({ profile_id: owner, has_child: true }),
  symptom_logs: (owner, n) => ({ profile_id: owner, entry_date: `2026-09-1${n}`, symptoms: ['cough'] }),
  alerts: (owner, n) => ({ profile_id: owner, type: 'air_quality', title: 'Air', message: 'Test alert', dedupe_key: `test-${n}` }),
  notification_prefs: (owner) => ({ profile_id: owner }),
  push_subscriptions: (owner, n) => ({
    profile_id: owner,
    endpoint: `https://fcm.googleapis.com/fcm/send/${owner}-${n}`,
    p256dh: 'test-p256dh',
    auth: 'test-auth',
  }),
  // Seeds are sequence 1 (current); an attempt is sequence 2, closed, so it never meets the one-current index.
  home_contexts: (owner, n) => ({
    id: homeContextId(owner, n),
    profile_id: owner,
    sequence: n + 1,
    origin: n === 0 ? 'onboard' : 'move',
    lat: 35.409,
    lng: -80.58,
    ...(n === 0 ? {} : { effective_to: '2026-09-15T00:00:00Z', closed_reason: 'moved' }),
  }),
  // 0017: operation_id has no default, so every sample supplies its own key.
  operations: (owner) => ({
    operation_id: crypto.randomUUID(),
    profile_id: owner,
    domain: 'actions',
    kind: 'actions.commit',
    status: 'pending',
  }),
  // 0020: one conversation per household, its turns ordered by seq, and one
  // run per turn. The ids are derived from the owner so the child rows can
  // point at the parent without the seed having to pass ids around, and the
  // composite foreign keys in 0020 refuse any other pairing.
  luna_conversations: (owner) => ({ id: lunaId(owner, 'c0de'), profile_id: owner }),
  luna_turns: (owner, n) => ({
    id: lunaId(owner, `ab0${n}`),
    conversation_id: lunaId(owner, 'c0de'),
    profile_id: owner,
    seq: n + 1,
    role: 'user',
    body: `Test question ${n}`,
  }),
  luna_runs: (owner, n) => ({
    profile_id: owner,
    conversation_id: lunaId(owner, 'c0de'),
    turn_id: lunaId(owner, `ab0${n}`),
    client_message_id: lunaId(owner, `cd0${n}`),
  }),
  // 0021: every other column has a default that is already a valid snapshot
  // value, so the owner is the whole row.
  profile_preferences: (owner) => ({ profile_id: owner }),
  // 0022: revision has no default and starts at 2 (1 is the never-saved state,
  // which has no row), and the five place columns are set together.
  explore_areas: (owner) => ({
    profile_id: owner,
    place_id: 'us-county:37159',
    place: 'Rowan County',
    state: 'NC',
    label: 'Rowan County, NC',
    timezone: 'America/New_York',
    revision: 2,
  }),
  // 0023: a task key is unique per household, so `n` varies it; a preference
  // key is one of six, so `n` picks another; the version starts at 1.
  household_actions: (owner, n) => ({ profile_id: owner, action_key: `test-task-${n}`, title: 'Test task', reason: 'Test', origin: 'test', state: 'saved' }),
  household_action_preferences: (owner, n) => ({ profile_id: owner, pref_key: n === 0 ? 'week:focus' : 'food-interests', value: n === 0 ? '"Test focus"' : '["fish"]' }),
  household_action_state: (owner) => ({ profile_id: owner, version: 1 }),
  // 0025: a recorded Air maximum at the household's current home (sequence
  // 1), modeled, from a full day. `n` varies the date, which is in the key.
  daily_maxima: (owner, n) => ({
    profile_id: owner,
    home_context_id: homeContextId(owner, 0),
    local_date: `2026-09-1${n}`,
    factor: 'air',
    value: 40 + n,
    unit: 'AQI',
    source_code: 'open_meteo_cams',
    method_version: 'daily-max-v1',
    time_zone: 'America/New_York',
    hours_expected: 24,
    hours_observed: 24,
    retrieved_at: '2026-09-20T12:00:00Z',
  }),
  // 0026: a workspace record; `n` varies the record id, which is in the key.
  household_workspace_records: (owner, n) => ({
    profile_id: owner,
    collection: n % 2 === 0 ? 'tests' : 'exploreNotes',
    record_id: `test-record-${n}`,
    revision: 1,
    record: { id: `test-record-${n}`, title: 'Test record', revision: 1 },
  }),
  // 0028: a staged private file (never linked, so no workspace write deletes
  // it); `n` varies the server ids, the object path follows them.
  household_attachments: (owner, n) => {
    // Derived from the owner and n, so two households never share an id.
    const hex = (salt) => createHash('sha256').update(`${salt}:${owner}:${n}`).digest('hex');
    const uuid = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const attachmentId = uuid(hex('attachment'));
    return {
      attachment_id: attachmentId,
      profile_id: owner,
      operation_id: uuid(hex('operation')),
      collection: n % 2 === 0 ? 'observations' : 'exploreNotes',
      record_id: `test-attachment-record-${n}`,
      name: 'Test photo.jpg',
      mime: 'image/jpeg',
      bytes: 100 + n,
      width: 10,
      height: 10,
      object_path: `${owner}/${attachmentId}`,
    };
  },
  // 0029: a saved summary; `n` varies the server ids, derived from the owner.
  household_summaries: (owner, n) => {
    const hex = (salt) => createHash('sha256').update(`${salt}:${owner}:${n}`).digest('hex');
    const uuid = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    return {
      summary_id: uuid(hex('summary')),
      profile_id: owner,
      operation_id: uuid(hex('summary-operation')),
      revision: 1,
      title: 'Household review',
      home_context_id: null,
      report: { title: 'Household review', generated: '2026-10-20T12:00:00.000Z', introduction: ['Purpose: Household review.'], sections: [] },
      selection: { purpose: 'Household review', start: '2026-01-01', end: '2026-12-31' },
      manifest: [],
      omissions: ['Private notes were not included.'],
    };
  },
  // 0018: hashes only, and the columns accept nothing but 64 hex characters.
  recovery_challenges: (owner, n) => ({
    profile_id: owner,
    email_hash: `${n}`.repeat(1).padEnd(64, 'a'),
    nonce_hash: `${n}`.repeat(1).padEnd(64, 'b'),
    expires_at: '2026-10-18T00:00:00Z',
  }),
};
