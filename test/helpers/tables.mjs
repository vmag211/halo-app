/**
 * Table declarations for the route harness: every table the routes and libs
 * query, with the keys the fake needs to behave like Postgres.
 *
 *   createRouteHarness({ tables: HALO_TABLES })               // all of them
 *   createRouteHarness({ tables: haloTables('profiles') })    // only some; the rest answer PGRST205
 *
 * Declared per table: primaryKey, unique (composite keys, including partial
 * unique indexes), ownerColumn (the column that cascades from the auth user on
 * delete) and defaults (column defaults a route's insert relies on).
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
  alerts: {
    primaryKey: 'id',
    unique: [['profile_id', 'dedupe_key']], // partial unique index (0006): NULL keys never collide
    ownerColumn: 'profile_id',
    defaults: { id: uuid, fired_at: now, read: false, dismissed: false, created_at: now },
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
