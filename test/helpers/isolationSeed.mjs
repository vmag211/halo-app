/**
 * Two households with distinct, searchable values in every owned table, for the
 * cross-identity route tests. Every string below that identifies a household
 * (county, note, title, endpoint, ...) is unique to it, so "does this response
 * contain the other household's marker" is a plain substring search of the
 * serialized body.
 *
 * Dates are relative to today (the household time zone, like the routes), so the
 * rolling windows the routes use (90 days, "today") always contain the seeds.
 */
import './routeLoader.mjs'; // registers the module hooks first, so lib files load as ESM without the typeless-package warning
const { localDate, addDays } = await import('../../lib/localDate.js');

export { localDate, addDays };

const PREFIX = { alice: 'a11ce000', bob: 'b0b00000' };
const hex12 = (n) => n.toString(16).padStart(12, '0');

/** Valid UUIDs (the journal and alert routes reject anything else) that identify one household's row. */
export const entryId = (who, n) => `${PREFIX[who]}-0000-4000-8000-${hex12(n)}`;
export const alertId = (who, n) => `${PREFIX[who]}-1111-4000-8000-${hex12(n)}`;
export const contextId = (who, n) => `${PREFIX[who]}-2222-4000-8000-${hex12(n)}`;
export const operationId = (who, n) => `${PREFIX[who]}-3333-4000-8000-${hex12(n)}`;
export const challengeId = (who, n) => `${PREFIX[who]}-4444-4000-8000-${hex12(n)}`;
export const lunaConversationId = (who) => `${PREFIX[who]}-5555-4000-8000-${hex12(1)}`;
export const lunaTurnId = (who, n) => `${PREFIX[who]}-6666-4000-8000-${hex12(n)}`;
export const lunaRunId = (who, n) => `${PREFIX[who]}-7777-4000-8000-${hex12(n)}`;
export const lunaProposalId = (who, n) => `${PREFIX[who]}-7878-4000-8000-${hex12(n)}`;
export const actionId = (who, n) => `${PREFIX[who]}-8888-4000-8000-${hex12(n)}`;
export const MISSING_ID = '99999999-9999-4999-8999-999999999999';

// On the Web Push hosts the subscribe route accepts (lib/pushInput.js), so a test can re-register them.
export const ENDPOINT = {
  alice: 'https://fcm.googleapis.com/fcm/send/alice-device',
  bob: 'https://updates.push.services.mozilla.com/wpush/v2/bob-device',
};

const PROFILE = {
  alice: {
    lat: 35.40881, lng: -80.57952, county: 'Cabarrus County', state: 'NC', zip: '28025', pwsid: 'NC9990001',
    water_source: 'utility', home_year: 1988, renter_mode: false, tenure: 'owner', locale: 'en',
    onboard_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  bob: {
    lat: 35.22712, lng: -80.84313, county: 'Mecklenburg County', state: 'NC', zip: '28202', pwsid: 'NC9990002',
    water_source: 'utility', home_year: 1962, renter_mode: true, tenure: 'renter', locale: 'es',
    onboard_request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
};

const BANDS = {
  alice: { has_pregnant: true, has_senior: true },
  bob: { has_toddler: true, has_respiratory: true },
};

const PREFS = {
  alice: { weather_advisory: false },
  bob: { air_quality_change: false, new_water_results: false, radon_season: false },
};

/**
 * The settings values migration 0021 keeps (display, quiet hours, calendar and
 * Luna's context switches) plus the settings aggregate revision, one row per
 * household so no cascade or isolation check on the table can pass vacuously.
 *
 * Every column here is an enum, a boolean, a zone name or a clock time, so
 * unlike the journal or an alert there is no free text that could carry a
 * readable marker. Each household's row therefore differs from the other's in
 * EVERY value instead, the same approach the hashed recovery columns take: that
 * is what a cascade or an isolation check needs. The values are deliberately
 * not added to `markersOf`, because a zone name or the word `dark` would match
 * responses that have nothing to do with either household.
 */
const SETTINGS = {
  alice: {
    revision: 4,
    display_appearance: 'light', display_palette: 'ocean', display_ambient: true,
    display_scale: '115', display_motion: 'reduce', display_contrast: true,
    quiet_enabled: true, quiet_from: '22:15', quiet_to: '07:45', quiet_zone: 'America/New_York',
    calendar_zone: 'America/New_York', calendar_streak: true, calendar_linked: false,
    luna_tasks: true, luna_home: false, luna_projects: false,
  },
  bob: {
    revision: 9,
    display_appearance: 'dark', display_palette: 'forest', display_ambient: false,
    display_scale: '150', display_motion: 'system', display_contrast: false,
    quiet_enabled: false, quiet_from: '20:30', quiet_to: '06:05', quiet_zone: 'America/Chicago',
    calendar_zone: 'America/Chicago', calendar_streak: false, calendar_linked: true,
    luna_tasks: false, luna_home: true, luna_projects: true,
  },
};

/**
 * Each household's saved discovery area (migration 0022), one row per
 * household so no cascade or isolation check on the table can pass vacuously.
 * The area is a county the household chose to explore, not its home, so each
 * one is deliberately a different county from that household's profile, and
 * the two differ from each other in every field and in the revision. Like
 * SETTINGS, these are not added to `markersOf`: a county name is shared public
 * text that unrelated responses (a district, a directory) can carry.
 */
const EXPLORE_AREA = {
  alice: {
    place_id: 'us-county:37159', place: 'Rowan County', state: 'NC',
    label: 'Rowan County, NC', timezone: 'America/New_York', revision: 3,
  },
  bob: {
    place_id: 'us-county:37071', place: 'Gaston County', state: 'NC',
    label: 'Gaston County, NC', timezone: 'America/New_York', revision: 7,
  },
};

/**
 * Each household's My Week (migration 0023): one task with planning details,
 * one task preference and the commit version, so no cascade or isolation
 * check on any of the three tables can pass vacuously. A task's title and its
 * meta's note are free text a person typed, so both carry readable markers and
 * are added to `markersOf`; the preference's focus sentence does too. The two
 * households differ in every value, the version included.
 */
const TASK = {
  alice: {
    action_key: 'alice-week:radon-test', title: 'ALICE-TASK-TITLE-MARKER', reason: 'Radon season starts soon',
    origin: 'week', due_date: '2026-11-02', state: 'saved', revision: 2,
    meta: {
      note: 'ALICE-TASK-NOTE-MARKER', paused: false, archived: false, completedOn: '', time: '09:30', duration: 45,
      zone: 'America/New_York', recurrence: 'none', reminder: true, history: ['Added', 'Moved to Monday'],
    },
  },
  bob: {
    action_key: 'bob-week:filter-change', title: 'BOB-TASK-TITLE-MARKER', reason: 'The filter is due',
    origin: 'explore', due_date: null, state: 'waiting', revision: 1,
    meta: {
      note: 'BOB-TASK-NOTE-MARKER', paused: true, archived: false, completedOn: '', time: '', duration: 120,
      zone: 'America/Chicago', recurrence: 'none', reminder: false, history: ['Added'],
    },
  },
};
const TASK_FOCUS = { alice: 'ALICE-WEEK-FOCUS-MARKER', bob: 'BOB-WEEK-FOCUS-MARKER' };
const TASK_VERSION = { alice: 3, bob: 8 };

const UTILITY = {
  alice: { pwsid: 'NC9990001', pws_name: 'ALICE WATER SYSTEM MARKER', ppt: 2.1, date: '3/15/2024' },
  bob: { pwsid: 'NC9990002', pws_name: 'BOB WATER SYSTEM MARKER', ppt: 7.7, date: '6/1/2024' },
};

/**
 * Hashes for the seeded recovery challenges. Migration 0018 accepts 64 lowercase
 * hex characters and nothing else, so these cannot be readable markers; each
 * household's digests start with its own nibbles instead and differ from each
 * other, which is what an isolation or cascade check needs.
 */
const HASH_MARKER = {
  alice: { email: 'a11ce'.padEnd(64, '0'), nonce: 'a11ce'.padEnd(64, '1') },
  bob: { email: 'b0b'.padEnd(64, '0'), nonce: 'b0b'.padEnd(64, '1') },
};

/** Free-text values that only one household has, plus the numbers and ids that locate it. */
export function markersOf(who, identity) {
  const upper = who.toUpperCase();
  const p = PROFILE[who];
  return [
    identity.id, p.county, p.zip, p.pwsid, p.onboard_request_id, String(p.lat), String(p.lng),
    `${upper}-NOTE-MARKER`, `${upper}-COUGH-MARKER`, `${upper}-WHEEZE-MARKER`,
    `${upper}-ALERT-TITLE`, `${upper}-ALERT-MESSAGE`, `${upper}-DISMISSED-MARKER`,
    UTILITY[who].pws_name, ENDPOINT[who], `${upper}-P256DH-MARKER`, `${upper}-AUTH-MARKER`,
    `${upper}-HOME-RISK-MARKER`, `${upper}-POLLUTANT-MARKER`, entryId(who, 1), alertId(who, 1), contextId(who, 1),
    `${upper}-LUNA-QUESTION-MARKER`, `${upper}-LUNA-ANSWER-MARKER`, lunaConversationId(who), lunaTurnId(who, 1), lunaRunId(who, 1),
    TASK[who].title, TASK[who].meta.note, TASK_FOCUS[who], actionId(who, 1),
  ];
}

/**
 * @param {object} identities from the harness ({ alice, bob })
 * @param {object} [options]
 * @param {boolean} [options.readingToday] give each household today's cached reading (default true)
 * @param {Date} [options.now]
 * @param {(rows: object, identities: object) => void} [options.adjust] edits the rows (table name -> array) before they are seeded
 */
export function seedHouseholds(identities, { readingToday = true, now = new Date(), adjust } = {}) {
  const today = localDate(now);
  const day = (n) => addDays(today, -n);
  const rows = { profiles: [], household_bands: [], notification_prefs: [], profile_preferences: [], explore_areas: [], household_actions: [], household_action_preferences: [], household_action_state: [], symptom_logs: [], alerts: [], push_subscriptions: [], daily_scores: [], home_risks: [], home_contexts: [], operations: [], recovery_challenges: [], luna_conversations: [], luna_turns: [], luna_runs: [], luna_proposals: [], daily_maxima: [], household_workspace_records: [], household_attachments: [], household_summaries: [], household_project_generations: [], outreach_drafts: [], ucmr5_utilities: [], volunteer_orgs: [], map_layers: [] };

  for (const who of ['alice', 'bob']) {
    const id = identities[who].id;
    const upper = who.toUpperCase();
    const isAlice = who === 'alice';

    rows.profiles.push({ id, ...PROFILE[who] });
    rows.household_bands.push({ profile_id: id, ...BANDS[who] });
    rows.notification_prefs.push({ profile_id: id, ...PREFS[who] });
    // Migration 0021: the settings values that live nowhere else, with a
    // revision each household has already advanced past 1.
    rows.profile_preferences.push({
      profile_id: id, ...SETTINGS[who],
      created_at: `${day(30)}T12:00:00Z`, updated_at: `${day(1)}T12:00:00Z`,
    });
    // Migration 0022: the discovery area each household has already saved
    // (and changed) at least once, so its revision is past the first save's 2.
    rows.explore_areas.push({ profile_id: id, ...EXPLORE_AREA[who], updated_at: `${day(2)}T12:00:00Z` });
    // Migration 0023: one task with its planning details, the week's focus
    // and the version a commit is checked against, past its first commit.
    rows.household_actions.push({
      id: actionId(who, 1), profile_id: id, ...TASK[who],
      created_at: `${day(3)}T12:00:00Z`, updated_at: `${day(1)}T12:00:00Z`,
    });
    rows.household_action_preferences.push({ profile_id: id, pref_key: 'week:focus', value: TASK_FOCUS[who], updated_at: `${day(1)}T12:00:00Z` });
    rows.household_action_state.push({ profile_id: id, version: TASK_VERSION[who], updated_at: `${day(1)}T12:00:00Z` });
    rows.home_risks.push({ profile_id: id, summary: `${upper}-HOME-RISK-MARKER` });
    // The current home (migration 0016), matching the profile.
    const { lat, lng, county, state, pwsid, water_source, home_year, onboard_request_id } = PROFILE[who];
    rows.home_contexts.push({
      id: contextId(who, 1), profile_id: id, sequence: 1, revision: 1, origin: 'onboard',
      lat, lng, county, state, pwsid, service_area_status: 'measured', water_source, home_year,
      match_method: 'mapbox_geocode_arcgis_point', onboard_request_id, backfill_state: 'complete',
      effective_from: `${day(30)}T12:00:00Z`, effective_to: null, closed_reason: null,
    });
    // Migration 0025: three recorded days at the current home, Air and UV.
    // Alice's home is measured (an AirNow station), bob's modeled, and each
    // household's values differ from the other's, so no cascade or isolation
    // check on the table can pass vacuously.
    for (let n = 1; n <= 3; n += 1) {
      const recorded = { profile_id: id, home_context_id: contextId(who, 1), local_date: day(n), method_version: 'daily-max-v1', time_zone: 'America/New_York', hours_expected: 24, hours_observed: 24, retrieved_at: `${day(n - 1)}T12:00:00Z` };
      rows.daily_maxima.push(
        { ...recorded, factor: 'air', value: isAlice ? 30 + n : 150 + n, unit: 'AQI', ...(isAlice ? { source_code: 'airnow_station', station_id: '370250004' } : { source_code: 'open_meteo_cams', station_id: null }), missing_code: null },
        { ...recorded, factor: 'uv', value: isAlice ? 3 : 9.5, unit: 'UV index', source_code: 'open_meteo_forecast', station_id: null, missing_code: null },
      );
    }
    // Migration 0026: a test and an Explore note each, marked per household.
    rows.household_workspace_records.push(
      { profile_id: id, collection: 'tests', record_id: `${who}-test-1`, revision: 1, record: { id: `${who}-test-1`, title: `${upper}-TEST-MARKER`, revision: 1 } },
      { profile_id: id, collection: 'exploreNotes', record_id: `${who}-note-1`, revision: 1, record: { id: `${who}-note-1`, title: `${upper}-NOTE-MARKER`, revision: 1 } },
    );
    // Migration 0028: one staged photo each, its name marked per household.
    const fileId = isAlice ? 'a77ac000-0000-4000-8000-0000000000a1' : 'a77ac000-0000-4000-8000-0000000000b2';
    rows.household_attachments.push({
      attachment_id: fileId, profile_id: id, operation_id: isAlice ? '0be7a000-0000-4000-8000-0000000000a1' : '0be7a000-0000-4000-8000-0000000000b2',
      collection: 'observations', record_id: `${who}-observation-1`, revision: 1, name: `${upper}-PHOTO-MARKER.jpg`, mime: 'image/jpeg',
      bytes: 100, width: 10, height: 10, status: 'ready', metadata_removed: true, object_path: `${id}/${fileId}`, linked: false, linked_at: null,
    });
    // Migration 0029: one saved summary each, its report marked per household.
    rows.household_summaries.push({
      summary_id: isAlice ? '5a3a0000-0000-4000-8000-0000000000a1' : '5a3a0000-0000-4000-8000-0000000000b2', profile_id: id,
      operation_id: isAlice ? '5a3a0e00-0000-4000-8000-0000000000a1' : '5a3a0e00-0000-4000-8000-0000000000b2', revision: 1, title: 'Household review',
      home_context_id: null, report: { title: 'Household review', generated: `${day(1)}T12:00:00.000Z`, introduction: [`${upper}-SUMMARY-MARKER`], sections: [] },
      selection: { purpose: 'Household review' }, manifest: [], omissions: [], created_at: `${day(1)}T12:00:00Z`,
    });
    // Migration 0030: one saved idea set each, its typed interest marked per household.
    rows.household_project_generations.push({
      profile_id: id, generation_id: isAlice ? '9e4e0000-0000-4000-8000-0000000000a1' : '9e4e0000-0000-4000-8000-0000000000b2',
      context_key: `${id}:none:0`, status: 'completed', created_at: `${day(1)}T12:00:00Z`,
      idea_set: { id: 'seed', status: 'completed', batch: { request: `${upper}-INTEREST-MARKER` } },
    });
    // Migration 0031: one outreach draft each, its body marked per household.
    const draftId = isAlice ? '0d4af700-0000-4000-8000-0000000000a1' : '0d4af700-0000-4000-8000-0000000000b2';
    rows.outreach_drafts.push({
      draft_id: draftId, profile_id: id, draft_key: `Local office|${who}@example.org`, recipient: 'Local office', topic: 'Drinking water',
      water: 'Utility', area: null, contact_name: '', to_address: `${who}@example.org`, subject: `${upper}-DRAFT-SUBJECT-MARKER`,
      body: `${upper}-DRAFT-BODY-MARKER`, notes: [], public_context: null, signature_hash: 'd'.repeat(64), revision: 1,
      operation_id: isAlice ? '0d4af700-0000-4000-8000-0000000000c1' : '0d4af700-0000-4000-8000-0000000000c2',
    });
    rows.push_subscriptions.push({ profile_id: id, endpoint: ENDPOINT[who], p256dh: `${upper}-P256DH-MARKER`, auth: `${upper}-AUTH-MARKER` });
    // One settled operation each (migration 0017), so the ledger is never
    // empty for either household and a cascade or isolation check on it cannot
    // pass vacuously.
    rows.operations.push({
      operation_id: operationId(who, 1), profile_id: id, domain: 'settings', kind: 'settings.save',
      status: 'succeeded', request_hash: `${upper}-REQUEST-HASH-MARKER`,
      result: { operationId: operationId(who, 1), status: 'succeeded', note: `${upper}-RECEIPT-MARKER` },
      created_at: `${day(1)}T12:00:00Z`, updated_at: `${day(1)}T12:00:00Z`,
    });
    // One live recovery challenge each (migration 0018), so a cascade or
    // isolation check on it cannot pass vacuously. Hashes only: the columns
    // accept nothing but 64 hex characters, so the marker is carried in the
    // digest's own leading bytes rather than in readable text.
    rows.recovery_challenges.push({
      id: challengeId(who, 1), profile_id: id,
      email_hash: HASH_MARKER[who].email, nonce_hash: HASH_MARKER[who].nonce,
      status: 'pending', attempts: 0,
      expires_at: `${day(-1)}T12:00:00Z`,
      created_at: `${day(1)}T12:00:00Z`, updated_at: `${day(1)}T12:00:00Z`,
    });
    // One answered Luna conversation each (migration 0020): the person's own
    // turn, Luna's cited answer and the settled run that produced it, so a
    // cascade or isolation check on any of the three cannot pass vacuously.
    // The question and the answer are free text, which is what makes these
    // the most sensitive rows in the seed.
    rows.luna_conversations.push({
      id: lunaConversationId(who), profile_id: id, revision: 3,
      created_at: `${day(2)}T12:00:00Z`, updated_at: `${day(1)}T12:00:00Z`,
    });
    rows.luna_turns.push(
      {
        id: lunaTurnId(who, 1), conversation_id: lunaConversationId(who), profile_id: id, seq: 1,
        role: 'user', body: `${upper}-LUNA-QUESTION-MARKER`, created_at: `${day(1)}T12:00:00Z`,
      },
      {
        id: lunaTurnId(who, 2), conversation_id: lunaConversationId(who), profile_id: id, seq: 2,
        role: 'assistant', body: `${upper}-LUNA-ANSWER-MARKER`,
        sources: [{ title: `${upper}-LUNA-SOURCE-MARKER`, url: `https://sources.example.test/${who}` }],
        evidence: [{ kind: 'fact', text: `${upper}-LUNA-ANSWER-MARKER`, sourceIndexes: [0] }],
        created_at: `${day(1)}T12:00:01Z`,
      },
    );
    rows.luna_runs.push({
      id: lunaRunId(who, 1), profile_id: id, conversation_id: lunaConversationId(who),
      turn_id: lunaTurnId(who, 1), client_message_id: lunaRunId(who, 9), status: 'completed',
      created_at: `${day(1)}T12:00:00Z`, updated_at: `${day(1)}T12:00:01Z`, settled_at: `${day(1)}T12:00:01Z`,
    });
    // One review Luna prepared under its answer (migration 0035, B20).
    rows.luna_proposals.push({
      id: lunaProposalId(who, 1), profile_id: id, conversation_id: lunaConversationId(who),
      turn_id: lunaTurnId(who, 2), kind: 'create', status: 'review', revision: 1,
      payload: { title: `${upper}-LUNA-PROPOSAL-MARKER`, date: '', time: '', estimate: null },
      expires_at: `${day(1)}T12:30:00Z`, created_at: `${day(1)}T12:00:01Z`, updated_at: `${day(1)}T12:00:01Z`,
    });
    rows.ucmr5_utilities.push({
      pwsid: UTILITY[who].pwsid,
      pws_name: UTILITY[who].pws_name,
      status: 'Final',
      contaminants: { PFOA: [{ date: UTILITY[who].date, value_ppt: UTILITY[who].ppt }] },
      created_at: '2026-01-15T00:00:00Z',
    });
    rows.volunteer_orgs.push({
      name: `${PROFILE[who].county} Water Watch`,
      counties: [PROFILE[who].county],
      causes: ['water'],
      url: `https://orgs.example.test/${who}`,
    });

    // Journal: alice logs a little, bob logs a lot (enough for findings to be "ready").
    const recent = isAlice ? 2 : 8;
    for (let n = 1; n <= recent; n += 1) {
      rows.symptom_logs.push({
        id: entryId(who, n), profile_id: id, entry_date: day(n), band: 'household',
        symptoms: [`${upper}-COUGH-MARKER`, `${upper}-WHEEZE-MARKER`], severity: 'mild',
        note: `${upper}-NOTE-MARKER ${n}`,
      });
    }
    const springLogged = isAlice ? 2 : 6;
    for (let n = 1; n <= springLogged; n += 1) {
      rows.symptom_logs.push({
        id: entryId(who, 100 + n), profile_id: id, entry_date: `2025-04-${String(n * 3).padStart(2, '0')}`, band: 'household',
        symptoms: [`${upper}-COUGH-MARKER`], severity: 'moderate', note: `${upper}-NOTE-MARKER spring ${n}`,
      });
    }

    // Daily readings: alice has 4 days, bob 20 (plus the spring days the summary reads).
    const days = isAlice ? 4 : 20;
    for (let n = 1; n <= days; n += 1) {
      rows.daily_scores.push({
        profile_id: id, date: day(n), score: isAlice ? 80 - n : 20 + n, aqi: isAlice ? 40 + n : 160 + n,
        uv_index: isAlice ? 2 : 9, pollen_level: JSON.stringify(isAlice ? { tree: 1, grass: 1, weed: 0 } : { tree: 4, grass: 4, weed: 3 }),
        mold_risk: isAlice ? 'low' : 'high', aqi_source: isAlice ? 'airnow' : 'open-meteo', created_at: `${day(n)}T12:00:00Z`,
      });
    }
    for (let n = 1; n <= springLogged; n += 1) {
      rows.daily_scores.push({
        profile_id: id, date: `2025-04-${String(n * 3).padStart(2, '0')}`, score: 50, aqi: isAlice ? 30 : 190,
        uv_index: 5, pollen_level: JSON.stringify(isAlice ? { tree: 1 } : { tree: 5, grass: 4 }),
        mold_risk: isAlice ? 'low' : 'high', aqi_source: 'airnow', created_at: `2025-04-${String(n * 3).padStart(2, '0')}T12:00:00Z`,
      });
    }
    if (readingToday) {
      // Within the route's one-hour cache window; bob's is five minutes newer than alice's.
      const stamp = new Date(now.getTime() - (isAlice ? 10 : 5) * 60 * 1000).toISOString();
      rows.daily_scores.push({
        profile_id: id, date: today, score: isAlice ? 77 : 23, aqi: isAlice ? 47 : 163,
        uv_index: isAlice ? 4 : 9, pollen_level: JSON.stringify(isAlice ? { tree: 1, grass: 2, weed: 0 } : { tree: 4, grass: 5, weed: 3 }),
        mold_risk: isAlice ? 'low' : 'high', aqi_source: isAlice ? 'airnow' : 'open-meteo', created_at: stamp,
        details: { dominant_pollutant: `${upper}-POLLUTANT-MARKER`, uv_peak_window: null, mold_basis: null },
      });
    }

    // Alerts: one unread, one read, one dismissed (dismissed ones must not be listed).
    rows.alerts.push(
      { id: alertId(who, 1), profile_id: id, type: 'air_quality_change', severity: 'elevated', title: `${upper}-ALERT-TITLE one`, message: `${upper}-ALERT-MESSAGE one`, dedupe_key: `${who}-one`, fired_at: `${day(1)}T10:00:00Z` },
      { id: alertId(who, 2), profile_id: id, type: 'weather_advisory', title: `${upper}-ALERT-TITLE two`, message: `${upper}-ALERT-MESSAGE two`, dedupe_key: `${who}-two`, read: true, fired_at: `${day(2)}T10:00:00Z` },
      { id: alertId(who, 3), profile_id: id, type: 'radon_season', title: `${upper}-DISMISSED-MARKER`, message: `${upper}-DISMISSED-MARKER`, dedupe_key: `${who}-three`, dismissed: true, fired_at: `${day(3)}T10:00:00Z` },
    );
  }

  // The pre-built NC-08 view the district route serves; the statewide ranking stays server side.
  rows.map_layers.push({
    layer: 'district',
    assembled_at: now.toISOString(),
    payload: {
      layer: 'district',
      ranked_counties: 100,
      county_rankings: [
        { county: PROFILE.alice.county, water_rank: 12, share_over: 0.2 },
        { county: PROFILE.bob.county, water_rank: 41, share_over: 0.5 },
      ],
      assembled_at: now.toISOString(),
    },
  });
  rows.map_layers.push({ layer: 'water', assembled_at: now.toISOString(), payload: { layer: 'water', count: 0, features: [], assembled_at: now.toISOString() } });

  adjust?.(rows, identities);
  return rows;
}

export { PROFILE, BANDS, PREFS, SETTINGS, EXPLORE_AREA, TASK, TASK_FOCUS, TASK_VERSION, UTILITY };
