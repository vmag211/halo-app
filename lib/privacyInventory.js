/**
 * THE PRIVACY INVENTORY: one table that says, for every household-owned table,
 * what a privacy export contains and what each privacy clear does to it.
 *
 * B07 plan, Rulings P2, P5, P6 and P13 (docs/backend/plans/b07-privacy.md),
 * under Vibhav's decisions D-P1 (clear all removes everything but the login),
 * D-P2 (export is everything the household owns, through per-table column
 * allowlists, never internal fields), D-P4 (Clear Journal clears both journals
 * and every season summary built from them) and D-P5 (the person's own export
 * carries their email and the rounded home location).
 *
 * The export builder, the inspect preview, the fingerprint list and the clear
 * function's tests all read this one table, so export and clear cannot drift
 * apart. test/privacyInventory.test.mjs fails when a table that belongs to a
 * household (in OWNED_TABLES, or reaching auth.users through foreign keys in
 * the migrated schema) or a column of one is not placed here.
 *
 * Shape of one entry, keyed by table name (`auth.users` for the login):
 *
 *   owner        the column that holds the household's id (never exported)
 *   export       either { excluded: reason } (nothing of the table is exported,
 *                and the reason is written into the export's manifest), or:
 *     parts      what is exported, each part in one export group:
 *       group      one of EXPORT_GROUPS
 *       base       columns exported whatever the private-text choice
 *       private    columns exported only with private text (P5)
 *       where      optional row filter { column, equals | notEquals | in }. Two
 *                  parts of one table that export a column in common must have
 *                  provably disjoint filters, so no row is in both (the
 *                  structural test holds this; parts that split one row's
 *                  columns between groups, like the profile's, share none)
 *       baseKeys   optional { column: [keys] }: for a jsonb object column in the
 *                  base tier, the only keys exported without private text. Every
 *                  other key, an unknown one included, is private text
 *       rounded    optional columns rounded to 3 decimals at export (P5)
 *       countAs    optional: only the number of rows is exported, under this name
 *       countOnly  optional: only the number of rows, with `warning` in the manifest
 *     withheld   { column: reason } for every column never exported
 *     withheldAll  a reason covering every column (a table not yet audited)
 *     optional   { column: migration } for exported columns a lagging
 *                environment may lack: the migration that adds the column
 *   fingerprint  whether the review fingerprint covers the table (P6)
 *   clear        { journal, all }, each one of:
 *                  { action: 'delete' } (with `via` when a cascade does it)
 *                  { action: 'delete-filtered', where, reason, refuseWhen? }
 *                    where: one filter, or an array of filters that must all
 *                    hold. refuseWhen: { where, refusal }, rows whose presence
 *                    makes the clear refuse with that code, deleting nothing
 *                  { action: 'reset', columns }  (profiles only, P4)
 *                  { action: 'keep', reason }
 *
 * Column lists are allowlists: a column not named in a part is never read, and
 * the export code selects the named columns, never `*`, and never filters
 * columns with a pattern. The client's redaction regex is not used.
 *
 * Column names are pinned against the migrated PGlite schema by the structural
 * test. Where the plan's table differs from the schema, the schema wins and
 * the difference is noted at the entry (explore_areas, daily_scores).
 */

/** The six export groups, in the client's order (lib/frontend/settings-preview.ts:36). */
export const EXPORT_GROUPS = Object.freeze(['tasks', 'home', 'explore', 'journal', 'conversation', 'preferences']);

/** The three scopes a review can be opened for: an export, or one of the two clears. */
export const PRIVACY_SCOPES = Object.freeze(['export', 'journal', 'all']);

/** The two clears (P3). */
export const CLEAR_SCOPES = Object.freeze(['journal', 'all']);

/** What a clear can do to a table. */
export const CLEAR_ACTIONS = Object.freeze(['delete', 'delete-filtered', 'reset', 'keep']);

/** Groups with nothing to show without private text (settings-preview.ts:56-57). */
export const PRIVATE_ONLY_GROUPS = Object.freeze(['conversation']);

/**
 * Server-authored words the inventory carries into an export or a preview.
 * Plain sentences, no U+2014 (AGENTS.md; AC-012).
 */
export const INVENTORY_COPY = Object.freeze({
  conversationExcluded: 'Private text was not selected.',
  homeRisksWarning: 'Home risk records are counted but not exported, because their stored fields have not been checked yet.',
  weekJournalNotStored: 'Week journal check-ins are not stored on the server yet, so nothing is removed for them.',
});

/** In a clear's row filter, stands for the clear's own operation id, whose receipt survives (P4). */
export const OWN_OPERATION = '$operationId';

const OUTSIDE_JOURNAL ='Clear Journal removes only the journal (D-P4), and this table is not part of it.';
const SEASON_SUMMARY = Object.freeze({ column: 'type', equals: 'season_summary' });
const NOT_SEASON_SUMMARY = Object.freeze({ column: 'type', notEquals: 'season_summary' });

/** The My Week preferences that are free text a person typed or a place they chose (P2). */
const PRIVATE_ACTION_PREFERENCES = Object.freeze(['week:focus', 'outdoorPlan']);
/** The other four, which are choices from fixed lists, times and dates. */
const BASE_ACTION_PREFERENCES = Object.freeze([
  'food-interests',
  'week:availability',
  'week:season-dismissals',
  'week:review-preferences',
]);

/**
 * The keys of a task's WeekMeta (lib/frontend/week-preview.ts:3) exported
 * without private text: switches, dates, times, a duration, a time zone and
 * fixed choices. Every other key of `household_actions.meta` is private text,
 * a key the client adds later included.
 */
export const BASE_META_KEYS = Object.freeze([
  'paused', 'archived', 'completedOn', 'time', 'duration', 'estimateSet', 'zone', 'recurrence', 'reminder',
]);
/** The WeekMeta keys known to be private text: a typed note and the quoted history of changes (P2). */
export const PRIVATE_META_KEYS = Object.freeze(['note', 'history']);

/**
 * The profile row after clear all (P4): every column except `id` and
 * `created_at` returns to its default, so the household reads as not
 * onboarded (lat and lng null) and goes back through onboarding. The values
 * are each column's own default in the migrated schema, which the structural
 * test checks. The row itself survives because the clear's receipt cascades
 * from it (0017) and every owned table's foreign key points at it.
 */
export const PROFILE_RESET_COLUMNS = Object.freeze({
  address: null,
  lat: null,
  lng: null,
  zip: null,
  county: null,
  pwsid: null,
  build_year: null,
  water_source: null,
  home_year: null,
  renter_mode: false,
  locale: 'en',
  state: null,
  onboard_request_id: null,
  tenure: null,
});

/** The profile columns clear all keeps, each with its reason (P4). */
export const PROFILE_KEPT_COLUMNS = Object.freeze({
  id: 'The household id is the sign-in identity, which clear all keeps (D-P1).',
  created_at: 'When the household signed in for the first time, which belongs to the login that survives (D-P1).',
});

/**
 * Columns whose names look like a secret but are exported on purpose. Each is
 * `table.column` with its reason. The structural test fails for any exported
 * column named like a token, hash, key, credential or address that is not
 * here, and for any entry here that no longer names an exported column.
 */
export const SECRET_NAME_EXCEPTIONS = Object.freeze({
  'auth.users.email': 'D-P5: the person asked for their own email in their own export. It is the confirmed address only, never a pending change.',
  'household_actions.action_key': 'The stable name of a task (for example a seeded task key), chosen by the app, not a credential.',
  'household_action_preferences.pref_key': 'The name of a My Week preference from a fixed list of six, not a credential.',
  'daily_maxima.source_code': 'Which data source a daily maximum came from, one of three fixed names (0025 CHECK), not a credential.',
});

const freezeDeep = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freezeDeep(inner);
  }
  return value;
};

/** The workspace collections each export group holds (0026's CHECK, B11 plan). */
export const WORKSPACE_HOME_COLLECTIONS = Object.freeze([
  'tests', 'assets', 'observations', 'gardens', 'usage', 'pantryItems', 'foodQuestions', 'fishNotes', 'foodFollows', 'growerInquiries',
]);
export const WORKSPACE_EXPLORE_COLLECTIONS = Object.freeze(['exploreNotes', 'exploreOutcomes', 'exploreProjects', 'exploreEngagements']);

const keep = (reason) => ({ action: 'keep', reason });
const DELETE = { action: 'delete' };

export const PRIVACY_INVENTORY = freezeDeep({
  // The login. Only the confirmed email leaves the provider's table (D-P5).
  'auth.users': {
    owner: 'id',
    export: {
      parts: [{ group: 'preferences', base: ['email'], private: [] }],
      withheld: {
        is_anonymous: 'How the person signs in is login metadata, not a household record.',
        created_at: 'Login metadata kept by the provider.',
      },
      providerManaged: 'Every other column of the provider table (sessions, credentials, a pending email change) is never read.',
    },
    fingerprint: false,
    clear: {
      journal: keep('The sign-in identity is never part of a clear.'),
      all: keep('The sign-in identity is what clear all keeps (D-P1). This is not account deletion.'),
    },
  },

  // The household's answers and its home. Legacy exact location is never exported.
  profiles: {
    owner: 'id',
    export: {
      parts: [
        {
          group: 'home',
          base: ['lat', 'lng', 'county', 'state', 'pwsid', 'water_source', 'home_year', 'build_year', 'renter_mode', 'tenure'],
          private: [],
          rounded: ['lat', 'lng'],
        },
        { group: 'preferences', base: ['locale'], private: [] },
      ],
      withheld: {
        address: 'A legacy exact address. The export carries rounded location only (D-P5, AC-236).',
        zip: 'A legacy exact location field, never exported (D-P5, AC-236).',
        onboard_request_id: 'An internal idempotency id of the onboarding save.',
        created_at: PROFILE_KEPT_COLUMNS.created_at,
      },
      // Each exported column a lagging environment may lack, with the migration that adds it.
      optional: { renter_mode: 2, locale: 2, state: 9, tenure: 21 },
    },
    fingerprint: true,
    clear: {
      journal: keep(OUTSIDE_JOURNAL),
      all: { action: 'reset', columns: PROFILE_RESET_COLUMNS },
    },
  },

  home_contexts: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'home',
          base: [
            'sequence', 'origin', 'lat', 'lng', 'county', 'state', 'pwsid', 'service_area_status',
            'water_source', 'home_year', 'effective_from', 'effective_to', 'closed_reason',
          ],
          private: [],
          rounded: ['lat', 'lng'],
        },
      ],
      withheld: {
        id: 'An internal record id the person never sees.',
        revision: 'An internal concurrency counter.',
        match_method: 'Server state: how the utility match was made.',
        onboard_request_id: 'An internal idempotency id of the onboarding save.',
        backfill_state: 'Server state of the history backfill.',
        backfill_from: 'Server state of the history backfill.',
        backfill_to: 'Server state of the history backfill.',
        backfill_updated_at: 'Server state of the history backfill.',
        created_at: 'Server bookkeeping; effective_from and effective_to carry the stay.',
        updated_at: 'Server bookkeeping; effective_from and effective_to carry the stay.',
      },
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  household_bands: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'home',
          base: [],
          private: [
            'has_toddler', 'has_child', 'has_teen', 'has_adult', 'has_senior', 'has_pregnant', 'has_respiratory',
            'updated_at',
          ],
        },
      ],
      withheld: {},
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // The plan listed `state` here; daily_scores has no such column (0009 adds
  // `state` to profiles, 0009_daily_details_and_state.sql:18), so it is not.
  daily_scores: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'home',
          base: ['date', 'score', 'aqi', 'aqi_source', 'uv_index', 'pollen_level', 'mold_risk', 'created_at'],
          private: [],
        },
      ],
      withheld: {
        id: 'An internal record id the person never sees.',
        details: 'Provider payloads as received, not a household record (P2).',
        home_context_id: 'An internal link to a home context; the home group carries the stays.',
      },
    },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // 0025 (B08 plan, privacy inventory and Ruling E23): each day's recorded
  // Air and UV maximum at a home. Server-written, so not fingerprinted (P6).
  // Clear all deletes it explicitly by profile_id (0024, before
  // home_contexts) and counts it in the review; it is not cleared "via"
  // home_contexts. Both of its foreign keys cascade, so the home cascade is
  // only the fallback where that explicit delete does not run. An
  // environment without 0025 exports it under the missing-table rule (P11).
  daily_maxima: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'home',
          base: ['local_date', 'factor', 'value', 'unit', 'source_code', 'method_version'],
          private: [],
        },
      ],
      withheld: {
        home_context_id: 'An internal link to a home context; the home group carries the stays.',
        station_id: 'The monitoring station code is server detail (B08 plan, privacy inventory).',
        time_zone: 'Always America/New_York; local_date is already that local date.',
        hours_expected: 'Coverage counts are server detail (B08 plan, privacy inventory).',
        hours_observed: 'Coverage counts are server detail (B08 plan, privacy inventory).',
        missing_code: 'Recorder state; a day without a maximum is exported with a null value.',
        retrieved_at: 'When the server fetched the series, an audit time only (B08 Ruling E16).',
        created_at: 'Server bookkeeping; local_date is the day the value belongs to.',
        updated_at: 'Server bookkeeping; local_date is the day the value belongs to.',
      },
    },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // Predates the migrations; its deployed columns are unaudited (plan, Blocked; Open question 6).
  home_risks: {
    owner: 'profile_id',
    export: {
      parts: [{ group: 'home', base: [], private: [], countOnly: true, warning: INVENTORY_COPY.homeRisksWarning }],
      withheldAll: 'The deployed columns of this legacy table are unaudited, so no allowlist can be written yet.',
    },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // One table, two groups: season summaries are built from the journal (D-P4).
  alerts: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'home',
          where: NOT_SEASON_SUMMARY,
          base: ['type', 'severity', 'title', 'message', 'category', 'fired_at', 'read', 'dismissed'],
          private: [],
        },
        {
          group: 'journal',
          where: SEASON_SUMMARY,
          base: ['type', 'title', 'fired_at'],
          // Built from journal entries (lib/alertRules.js:108-116).
          private: ['message'],
        },
      ],
      withheld: {
        id: 'An internal record id the person never sees.',
        created_at: 'Server bookkeeping; fired_at says when the alert was sent.',
        dedupe_key: 'An internal key that stops one alert being sent twice.',
        revision: 'An internal concurrency counter.',
        target_tab: 'An app navigation target, not a household record.',
        target_destination: 'An app navigation target, not a household record.',
        target_learn: 'An app navigation target, not a household record.',
      },
      optional: { dismissed: 10, category: 21 },
    },
    fingerprint: false,
    clear: {
      journal: {
        action: 'delete-filtered',
        where: SEASON_SUMMARY,
        reason: 'Season summaries are built from journal entries, so they go with the journal (D-P4).',
      },
      all: DELETE,
    },
  },

  symptom_logs: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'journal',
          base: ['entry_date', 'retrospective', 'created_at', 'updated_at'],
          private: ['band', 'symptoms', 'severity', 'possibly_illness', 'note'],
        },
      ],
      withheld: { id: 'An internal record id the person never sees.' },
    },
    fingerprint: true,
    clear: { journal: DELETE, all: DELETE },
  },

  notification_prefs: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'preferences',
          base: ['air_quality_change', 'weather_advisory', 'new_water_results', 'radon_season', 'season_summary', 'updated_at'],
          private: [],
        },
      ],
      withheld: {},
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // Device credentials: only how many devices are registered (P2).
  push_subscriptions: {
    owner: 'profile_id',
    export: {
      parts: [{ group: 'preferences', base: [], private: [], countAs: 'deviceDelivery' }],
      withheld: {
        id: 'An internal record id the person never sees.',
        endpoint: 'A push delivery credential (privacy-and-retention.md, push_subscriptions).',
        p256dh: 'A push encryption key, a credential.',
        auth: 'A push authentication secret, a credential.',
        created_at: 'The export reports registered devices as a count only.',
      },
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  profile_preferences: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'preferences',
          base: [
            'display_appearance', 'display_palette', 'display_ambient', 'display_scale', 'display_motion',
            'display_contrast', 'quiet_enabled', 'quiet_from', 'quiet_to', 'quiet_zone', 'calendar_zone',
            'calendar_streak', 'calendar_linked', 'luna_tasks', 'luna_home', 'luna_projects', 'revision',
            'created_at', 'updated_at',
          ],
          private: [],
        },
      ],
      withheld: {},
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // The plan named a `name` column; 0022 calls it `place`
  // (0022_explore_areas.sql:77), the client's DiscoveryPlace field.
  explore_areas: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'explore',
          base: ['place_id', 'place', 'state', 'label', 'timezone', 'revision', 'updated_at'],
          private: [],
        },
      ],
      withheld: {},
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  household_actions: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'tasks',
          base: ['id', 'action_key', 'title', 'reason', 'origin', 'due_date', 'state', 'revision', 'meta', 'created_at', 'updated_at'],
          private: [],
          // An allowlist, not a denylist: 0023 stores the WeekMeta exactly as
          // sent, unknown keys included, so only the known non-private keys
          // are base and every other key (note, history, anything new) is
          // private text.
          baseKeys: { meta: BASE_META_KEYS },
        },
      ],
      withheld: {},
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  household_action_preferences: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'tasks',
          where: { column: 'pref_key', in: BASE_ACTION_PREFERENCES },
          base: ['pref_key', 'value', 'updated_at'],
          private: [],
        },
        {
          group: 'tasks',
          where: { column: 'pref_key', in: PRIVATE_ACTION_PREFERENCES },
          base: [],
          private: ['pref_key', 'value', 'updated_at'],
        },
      ],
      withheld: {},
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  household_action_state: {
    owner: 'profile_id',
    export: { excluded: 'An internal save counter that is never shown (B06 Ruling H10).' },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // 0026 (B11): the Homeguard workspace, one row per record. A record is
  // whatever the person typed into a test, a care schedule, a note or a
  // project, kept as one jsonb value, so the record itself is private text;
  // the collection name, id, revision and dates are not. The home collections
  // are in the home group and the Explore ones in the explore group. Clear all
  // deletes the rows through 0026's trigger on the clear's own settle (B11
  // Ruling W8), counted by workspace_privacy_counts; the fingerprint does not
  // cover them, because privacy_fingerprint's table list is 0024's. The week
  // journal is not stored (Ruling W2), so Clear Journal keeps this table.
  household_workspace_records: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'home',
          where: { column: 'collection', in: WORKSPACE_HOME_COLLECTIONS },
          base: ['collection', 'record_id', 'revision', 'created_at', 'updated_at'],
          private: ['record'],
        },
        {
          group: 'explore',
          where: { column: 'collection', in: WORKSPACE_EXPLORE_COLLECTIONS },
          base: ['collection', 'record_id', 'revision', 'created_at', 'updated_at'],
          private: ['record'],
        },
      ],
      withheld: {},
    },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // 0028 (B14): private photo attachments, one row per processed file. The
  // export lists what each file is, never its bytes (B14 Ruling A12): the
  // reviewed file name is private text; the collection, record id, type, size
  // and pixels are not. Tests and observations are in the home group, note
  // photos in the explore group. Clear all deletes the rows through 0028's
  // trigger on the clear's own settle (the 0026 pattern), counted by
  // attachment_privacy_counts, and the clear route then deletes the storage
  // objects (Ruling A9); the fingerprint does not cover the table, because
  // privacy_fingerprint's table list is 0024's. Clear Journal keeps it.
  household_attachments: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'home',
          where: { column: 'collection', in: ['tests', 'observations'] },
          base: ['collection', 'record_id', 'revision', 'mime', 'bytes', 'width', 'height', 'status', 'metadata_removed', 'linked', 'created_at', 'linked_at'],
          private: ['name'],
        },
        {
          group: 'explore',
          where: { column: 'collection', in: ['exploreNotes'] },
          base: ['collection', 'record_id', 'revision', 'mime', 'bytes', 'width', 'height', 'status', 'metadata_removed', 'linked', 'created_at', 'linked_at'],
          private: ['name'],
        },
      ],
      withheld: {
        attachment_id: 'An internal file id the person never sees.',
        operation_id: 'The internal id of the request that stored the file.',
        object_path: 'Where the file is kept in private storage; the file itself is never exported (B14 Ruling A12).',
      },
    },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // 0031 (B17): outreach drafts, a prepared copy of a question to a public
  // office, one row per recipient class and address. Nothing is ever sent.
  // What the person wrote, who it is addressed to, the note and source
  // snapshots and the area are private text (B17 Ruling O8); the recipient
  // class, topic, water context, revision and dates are not. Clear all
  // deletes the rows through 0031's trigger on the clear's own settle (the
  // 0026 pattern), counted by outreach_privacy_counts; the fingerprint does
  // not cover the table, because privacy_fingerprint's table list is 0024's.
  // Clear Journal keeps it.
  outreach_drafts: {
    owner: 'profile_id',
    export: {
      parts: [
        {
          group: 'explore',
          base: ['recipient', 'topic', 'water', 'revision', 'created_at', 'updated_at'],
          private: ['area', 'contact_name', 'to_address', 'subject', 'body', 'notes', 'public_context'],
        },
      ],
      withheld: {
        draft_id: 'An internal draft id the person never sees.',
        draft_key: 'An internal key that keeps one draft per recipient; the recipient and address are exported.',
        signature_hash: 'A digest of the screen\'s review signature, used only to recognise a repeat.',
        operation_id: 'The internal id of the request that last changed the draft.',
      },
    },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  // The conversation is exported only with private text (settings-preview.ts:56-57).
  luna_conversations: {
    owner: 'profile_id',
    export: {
      parts: [{ group: 'conversation', base: [], private: ['created_at', 'updated_at', 'revision'] }],
      withheld: { id: 'An internal record id the person never sees.' },
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: DELETE },
  },

  luna_turns: {
    owner: 'profile_id',
    export: {
      parts: [{ group: 'conversation', base: [], private: ['seq', 'role', 'body', 'sources', 'evidence', 'created_at'] }],
      withheld: {
        id: 'An internal record id the person never sees.',
        conversation_id: 'An internal link; a household has one conversation.',
      },
    },
    fingerprint: true,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: { action: 'delete', via: 'luna_conversations' } },
  },

  luna_runs: {
    owner: 'profile_id',
    export: {
      parts: [{ group: 'conversation', base: [], private: ['status', 'message', 'created_at', 'settled_at'] }],
      withheld: {
        id: 'An internal record id the person never sees.',
        conversation_id: 'An internal link; a household has one conversation.',
        turn_id: 'An internal link to the turn the run answered.',
        client_message_id: 'An internal idempotency id sent by the app.',
        updated_at: 'Server bookkeeping of a run in progress; settled_at says when it finished.',
      },
    },
    fingerprint: false,
    clear: { journal: keep(OUTSIDE_JOURNAL), all: { action: 'delete', via: 'luna_conversations' } },
  },

  operations: {
    owner: 'profile_id',
    export: { excluded: 'The request ledger is internal bookkeeping, not a household record (D-P2).' },
    fingerprint: false,
    clear: {
      journal: keep(OUTSIDE_JOURNAL),
      // Settled only, refuse on pending: exactly what 0024 does (step 4 refuses,
      // step 5 deletes `status <> 'pending' and operation_id <> own`) and what
      // privacy_counts counts for `operations`.
      all: {
        action: 'delete-filtered',
        where: [
          { column: 'status', notEquals: 'pending' },
          { column: 'operation_id', notEquals: OWN_OPERATION },
        ],
        refuseWhen: {
          where: [
            { column: 'status', equals: 'pending' },
            { column: 'operation_id', notEquals: OWN_OPERATION },
          ],
          refusal: 'HALO_BUSY',
        },
        reason: 'Settled rows only: every settled row goes except the clear\'s own receipt, which reconcile needs (P4). A pending row of any domain refuses the clear instead, with nothing deleted (P3).',
      },
    },
  },

  recovery_challenges: {
    owner: 'profile_id',
    export: { excluded: 'Account recovery proof material is never exported (D-P2).' },
    fingerprint: false,
    clear: {
      journal: keep(OUTSIDE_JOURNAL),
      all: keep('Proof material about the login, which clear all keeps (P4, Open question 2).'),
    },
  },
});

/**
 * Records the app has that no server table holds yet (P13). The week journal
 * is a workspace collection with no backend storage, so Clear Journal has
 * nothing of it to remove and says so.
 */
export const UNSTORED_RECORDS = freezeDeep({
  weekJournal: {
    group: 'journal',
    storage: 'none',
    note: INVENTORY_COPY.weekJournalNotStored,
    clear: { journal: 'delete', all: 'delete' },
  },
});

/**
 * The tables the review fingerprint covers, in its fixed order (P6). Only
 * tables a person's own actions write: a background refresh between review
 * and confirm must not refuse a clear the person asked for.
 */
export const FINGERPRINT_TABLES = Object.freeze([
  'profiles',
  'home_contexts',
  'household_bands',
  'symptom_logs',
  'notification_prefs',
  'push_subscriptions',
  'profile_preferences',
  'explore_areas',
  'household_actions',
  'household_action_preferences',
  'luna_conversations',
  'luna_turns',
]);

const partsOf = (table) => PRIVACY_INVENTORY[table]?.export?.parts ?? [];

function assertGroups(groups) {
  if (!Array.isArray(groups)) throw new TypeError('privacyInventory: groups must be an array');
  const seen = new Set();
  for (const group of groups) {
    if (!EXPORT_GROUPS.includes(group)) throw new TypeError(`privacyInventory: unknown export group "${group}"`);
    if (seen.has(group)) throw new TypeError(`privacyInventory: duplicate export group "${group}"`);
    seen.add(group);
  }
  return seen;
}

/**
 * The groups an operation of this scope covers, in EXPORT_GROUPS order: the
 * selected groups for an export (at least one), the journal for Clear
 * Journal, and all six for clear all. A clear ignores the selection, which may
 * be empty (trap P-3). Throws on an unknown scope or group, or a duplicate.
 */
export function groupsFor(scope, groups = []) {
  if (!PRIVACY_SCOPES.includes(scope)) throw new TypeError(`privacyInventory: unknown scope "${scope}"`);
  const selected = assertGroups(groups);
  if (scope === 'journal') return ['journal'];
  if (scope === 'all') return [...EXPORT_GROUPS];
  if (selected.size === 0) throw new TypeError('privacyInventory: an export needs at least one group');
  return EXPORT_GROUPS.filter((group) => selected.has(group));
}

/** The tables with something in any of these groups, in inventory order. */
export function tablesFor(groups) {
  const selected = assertGroups(groups);
  return Object.keys(PRIVACY_INVENTORY).filter((table) => partsOf(table).some((part) => selected.has(part.group)));
}

/**
 * The columns an export reads from `table`, in declared order without
 * repeats: the base tier, plus the private tier when `privateText` is true.
 * With `group`, only that group's parts. An excluded or count-only table, or
 * an unknown one, has none.
 */
export function columnsFor(table, privateText, group) {
  const columns = [];
  for (const part of partsOf(table)) {
    if (group !== undefined && part.group !== group) continue;
    for (const column of privateText ? [...part.base, ...part.private] : part.base) {
      if (!columns.includes(column)) columns.push(column);
    }
  }
  return columns;
}

/**
 * What an export of these groups reads, one entry per inventory part that
 * yields anything: `{table, group, columns, where, rounded, baseKeys, countAs,
 * countOnly, warning, optional}`. `baseKeys` lists, per jsonb column, the only
 * keys kept when `privateText` is false (empty with private text, when every
 * key is kept). A part whose
 * columns are all private, and private text was not selected, is left out.
 * A group in PRIVATE_ONLY_GROUPS therefore yields nothing without private
 * text, because its parts have no base tier (the structural test holds every
 * such part to that); the export writes
 * `{excluded: INVENTORY_COPY.conversationExcluded}` for it.
 */
export function exportParts(groups, privateText) {
  const selected = assertGroups(groups);
  if (typeof privateText !== 'boolean') throw new TypeError('privacyInventory: privateText must be a boolean');
  const out = [];
  for (const [table, entry] of Object.entries(PRIVACY_INVENTORY)) {
    for (const part of entry.export.parts ?? []) {
      if (!selected.has(part.group)) continue;
      const counted = Boolean(part.countAs || part.countOnly);
      const columns = privateText ? [...part.base, ...part.private] : [...part.base];
      if (!counted && columns.length === 0) continue;
      const baseKeys = {};
      if (!privateText) for (const [column, keys] of Object.entries(part.baseKeys ?? {})) baseKeys[column] = [...keys];
      out.push({
        table,
        group: part.group,
        columns,
        where: part.where ?? null,
        rounded: [...(part.rounded ?? [])],
        baseKeys,
        countAs: part.countAs ?? null,
        countOnly: Boolean(part.countOnly),
        warning: part.warning ?? null,
        optional: Object.keys(entry.export.optional ?? {}).filter((column) => columns.includes(column)),
      });
    }
  }
  return out;
}

/** Rounds a coordinate to 3 decimals (about 100 m), as P5 requires at export. */
export const roundCoordinate = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value);

/**
 * One stored row as an export part emits it: only the part's columns (a
 * column the row lacks is left out, for a lagging environment), coordinates
 * rounded, and, for a jsonb column `baseKeys` names, only those keys. A value
 * there that is not an object (0023's CHECK forbids one) is left out whole,
 * since none of it is known to be base; null stays null. Never adds anything
 * the row does not hold.
 */
export function projectRow(part, row) {
  const out = {};
  for (const column of part.columns) {
    if (!Object.hasOwn(row, column)) continue;
    let value = row[column];
    if (part.rounded.includes(column)) value = roundCoordinate(value);
    const allowed = part.baseKeys[column];
    if (allowed && value !== null) {
      if (typeof value !== 'object' || Array.isArray(value)) continue;
      value = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)));
    }
    out[column] = value;
  }
  return out;
}

/**
 * The tables the review fingerprint binds for this scope, in FINGERPRINT_TABLES
 * order (P6): `symptom_logs` for Clear Journal, every listed table for clear
 * all, and the listed tables of the selected groups for an export.
 */
export function fingerprintTables(scope, groups = []) {
  const covered = groupsFor(scope, groups);
  if (scope === 'journal') return ['symptom_logs'];
  if (scope === 'all') return [...FINGERPRINT_TABLES];
  const tables = new Set(tablesFor(covered));
  return FINGERPRINT_TABLES.filter((table) => tables.has(table));
}

/** What the clear of `scope` does to `table`, or null for a table the inventory does not hold. */
export function clearActionFor(table, scope) {
  if (!CLEAR_SCOPES.includes(scope)) throw new TypeError(`privacyInventory: unknown clear scope "${scope}"`);
  return PRIVACY_INVENTORY[table]?.clear?.[scope] ?? null;
}
