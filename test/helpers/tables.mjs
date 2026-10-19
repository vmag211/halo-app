/**
 * Table declarations for the route harness: every table the routes and libs
 * query, with the keys the fake needs to behave like Postgres.
 *
 *   createRouteHarness({ tables: HALO_TABLES })               // all of them
 *   createRouteHarness({ tables: haloTables('profiles') })    // only some; the rest answer PGRST205
 *
 * Declared per table: primaryKey, unique (composite keys, including partial
 * unique indexes whose predicate is only "<key column> is not null", which
 * behave like a plain unique key because NULLs never collide), partialUnique
 * (other partial unique indexes: name, columns and the "<column> is [not]
 * null" predicate), ownerColumn (the column that cascades from the auth user
 * on delete) and defaults (column defaults a route's insert relies on).
 *
 * These mirror supabase/migrations/*.sql. test/haloTables.test.mjs parses the
 * migrations and fails when a key, a unique constraint or an ON DELETE CASCADE
 * here stops matching them, and when a table the code queries is missing.
 *
 * profiles, daily_scores, home_risks and ucmr5_utilities predate the migrations
 * (0001 only adds policies and cascades to them), so their keys are
 * reconstructed from the code that reads and writes them and are NOT verified
 * against the deployed database: `id` on daily_scores and home_risks is an
 * assumption (no route reads it), and there is deliberately no unique key on
 * daily_scores (the history route collapses several rows per date itself).
 */
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
/** Stands in for luna_turns.seq, which migration 0020 fills from one identity sequence. */
let turnSeq = 0;
const nextSeq = () => (turnSeq += 1);

export const HALO_TABLES = {
  // auth.users -> profiles (0001) cascades; profiles.id is the owner id.
  profiles: {
    primaryKey: 'id',
    ownerColumn: 'id',
    defaults: { renter_mode: false, locale: 'en' },
  },
  daily_scores: {
    primaryKey: 'id',
    ownerColumn: 'profile_id',
    defaults: { id: uuid, created_at: now },
  },
  home_risks: {
    primaryKey: 'id',
    ownerColumn: 'profile_id',
    defaults: { id: uuid },
  },
  household_bands: {
    primaryKey: 'profile_id',
    ownerColumn: 'profile_id',
    defaults: {
      has_toddler: false,
      has_child: false,
      has_teen: false,
      has_adult: false,
      has_senior: false,
      has_pregnant: false,
      has_respiratory: false,
      updated_at: now,
    },
  },
  symptom_logs: {
    primaryKey: 'id',
    unique: [['profile_id', 'entry_date', 'band']],
    ownerColumn: 'profile_id',
    defaults: {
      id: uuid,
      band: 'household',
      symptoms: () => [],
      retrospective: false,
      possibly_illness: false,
      created_at: now,
      updated_at: now,
    },
  },
  // 0021 adds `revision` (not null, default 1, the whole optimistic-concurrency
  // contract for alerts.update), and the nullable `category`, `target_tab`,
  // `target_destination` and `target_learn`. Only `revision` has a default: a
  // null category or target means the producer named none, and the route
  // supplies one for the row's kind.
  alerts: {
    primaryKey: 'id',
    unique: [['profile_id', 'dedupe_key']], // partial unique index (0006): NULL keys never collide
    ownerColumn: 'profile_id',
    defaults: { id: uuid, fired_at: now, read: false, dismissed: false, revision: 1, created_at: now },
  },
  notification_prefs: {
    primaryKey: 'profile_id',
    ownerColumn: 'profile_id',
    defaults: {
      air_quality_change: true,
      weather_advisory: true,
      new_water_results: true,
      radon_season: true,
      season_summary: true,
      updated_at: now,
    },
  },
  push_subscriptions: {
    primaryKey: 'id',
    unique: [['endpoint']],
    ownerColumn: 'profile_id',
    defaults: { id: uuid, created_at: now },
  },
  home_contexts: {
    primaryKey: 'id',
    unique: [['profile_id', 'sequence'], ['profile_id', 'id']],
    // 0016: at most one current context per household; closed ones never collide.
    partialUnique: [{ name: 'home_contexts_one_current', columns: ['profile_id'], where: 'effective_to is null' }],
    ownerColumn: 'profile_id',
    defaults: {
      id: uuid,
      revision: 1,
      backfill_state: 'not_started',
      effective_from: now,
      created_at: now,
      updated_at: now,
    },
  },

  // 0017: the idempotency ledger. operation_id is the client's Idempotency-Key,
  // so it has no default. profile_id is null only for the unauthenticated
  // 'recovery' domain; every other domain is owner scoped and cascades.
  operations: {
    primaryKey: 'operation_id',
    ownerColumn: 'profile_id',
    defaults: { status: 'pending', created_at: now, updated_at: now },
  },

  // 0018: one attempt to prove ownership of a linked email. Only hashes are
  // stored, and the row belongs to the identity being recovered, so it cascades
  // like any other owned table. The restore token is single use: consumed_at
  // records when it was spent.
  // 0019: `intent` says which operation wrote the row, 'link' (signed in,
  // POST /api/account/commands) or 'recover' (not signed in,
  // POST /api/recovery/request). It defaults to 'link' in the migration too, so
  // a row written without one keeps the meaning it had before the column.
  recovery_challenges: {
    primaryKey: 'id',
    ownerColumn: 'profile_id',
    defaults: { id: uuid, status: 'pending', attempts: 0, intent: 'link', created_at: now, updated_at: now },
  },

  // 0020: Luna's conversation storage. A household holds exactly one
  // conversation (the unique key on profile_id), its turns are ordered by the
  // identity column `seq`, and a run is one attempt to answer one turn. The
  // composite keys (id, profile_id) and the composite foreign keys that point
  // at them are what stop a turn or a run from being attached to another
  // household's conversation; the fake does not model foreign keys, so the
  // unique keys are what it enforces here.
  luna_conversations: {
    primaryKey: 'id',
    unique: [['profile_id'], ['id', 'profile_id']],
    ownerColumn: 'profile_id',
    defaults: { id: uuid, revision: 1, created_at: now, updated_at: now },
  },
  luna_turns: {
    primaryKey: 'id',
    unique: [['conversation_id', 'seq']],
    ownerColumn: 'profile_id',
    // `seq` is `generated by default as identity` in 0020: one sequence for
    // the table, so positions rise and two concurrent appends cannot collide.
    defaults: { id: uuid, seq: nextSeq, created_at: now },
  },
  luna_runs: {
    primaryKey: 'id',
    unique: [['turn_id'], ['profile_id', 'client_message_id']],
    ownerColumn: 'profile_id',
    defaults: { id: uuid, status: 'queued', created_at: now, updated_at: now },
  },

  // 0021: the settings values that have nowhere else to live (display, quiet
  // hours, calendar, Luna's context switches) plus the settings aggregate
  // `revision`, one row per household. Every default below is the migration's
  // own, because a route reads the row straight back as a snapshot the client
  // must accept: `revision` starts at 1, the display values are the contract's
  // neutral ones, the quiet times are well formed even while quiet hours are
  // off (the client's validator requires that), and Luna's three switches are
  // off. `display_palette` has no default on purpose: null means the response
  // omits the key, which the client accepts, while `palette: null` it rejects.
  profile_preferences: {
    primaryKey: 'profile_id',
    ownerColumn: 'profile_id',
    defaults: {
      revision: 1,
      display_appearance: 'system',
      display_ambient: false,
      display_scale: '100',
      display_motion: 'system',
      display_contrast: false,
      quiet_enabled: false,
      quiet_from: '21:00',
      quiet_to: '08:00',
      quiet_zone: 'America/New_York',
      calendar_zone: 'America/New_York',
      calendar_streak: false,
      calendar_linked: false,
      luna_tasks: false,
      luna_home: false,
      luna_projects: false,
      created_at: now,
      updated_at: now,
    },
  },

  // 0022: a household's saved discovery area, one row per household (Ruling
  // D5). `revision` has no default on purpose: there is no row until the first
  // save, which writes 2, because 1 is the never-saved state a missing row
  // reads as (Ruling D6). The five place columns have no default either, since
  // null together is a cleared area. The primary key is what makes two first
  // saves collide, which the fake reproduces as a 23505.
  explore_areas: {
    primaryKey: 'profile_id',
    ownerColumn: 'profile_id',
    defaults: { updated_at: now },
  },

  // Reference and system tables: no owner, nothing cascades.
  ucmr5_utilities: { primaryKey: 'pwsid' },
  water_snapshots: { primaryKey: 'pwsid', defaults: { updated_at: now } },
  map_layers: { primaryKey: 'layer' },
  learn_content: { primaryKey: ['topic', 'locale'] },
  volunteer_orgs: { primaryKey: 'id', unique: [['name']], defaults: { id: uuid } },
  assistant_corpus: { primaryKey: 'id', defaults: { id: uuid } },
};

/** The declarations for just these tables (throws on a name that is not declared). */
export function haloTables(...names) {
  return Object.fromEntries(
    names.map((name) => {
      if (!HALO_TABLES[name]) throw new Error(`haloTables: no declaration for "${name}"`);
      return [name, HALO_TABLES[name]];
    }),
  );
}

/** Tables whose rows belong to one household, with the column that holds the owner id. */
export const OWNED_TABLES = Object.fromEntries(
  Object.entries(HALO_TABLES)
    .filter(([, declaration]) => declaration.ownerColumn)
    .map(([name, declaration]) => [name, declaration.ownerColumn]),
);
