/**
 * In-memory stand-ins for what migration 0021 puts in the database for the
 * settings surface, on the fake Supabase:
 *
 *   installSettingsTriggers(h.db)   the triggers (Rulings S12, S13 and S15)
 *   registerSaveSettings(h.db)      public.save_settings (Rulings S11 and S15)
 *   installSettingsDb(h.db)         both
 *
 * The triggers. Every write to a value in the settings snapshot advances
 * profile_preferences.revision for that household, once per statement that
 * changed a stored value: the five profile columns (home_year, water_source,
 * locale, tenure, renter_mode), the five notification switches, the seven
 * household bands, and the preference columns themselves when the write did
 * not set the revision. A new notification or band row advances it only when
 * it differs from what no row reads as. And before a profile row is stored,
 * tenure is reconciled with renter_mode: a changed tenure answer sets
 * renter_mode from it; otherwise renter_mode true turns 'owner' or 'other'
 * into 'renter', and false turns 'renter' into null. When the ledger
 * (operations) is declared, a settled 'settings' row may not change its status
 * (HALO_OPERATION_SETTLED), as 0021's operations_settings_settled_guard says.
 *
 * save_settings follows the SQL function step by step: the value checks, this
 * operation's own pending ledger row (else HALO_OPERATION_NOT_PENDING), the
 * profile, the notification and band rows made if missing, the revision check
 * (a miss removes what was made and writes nothing), the group's preference
 * columns without the revision, then the home details through the
 * home-context functions registered on this fake (update_home_context_attributes
 * with a current home, transition_home_context when located without one, the
 * profile otherwise), the profile columns, the switches and the bands, then
 * the revision put back to expected + 1 if any of that moved it, and the
 * ledger row settled as succeeded with the receipt, all undone if anything
 * throws (db.atomically). It answers what the SQL answers. Its receipt's
 * snapshot is lib/settings.js settingsSnapshot; the SQL builds its own, and
 * test/settingsSaveDb.test.mjs pins the two together.
 *
 * test/settingsSaveDb.test.mjs runs the same writes through these and through
 * the real 0021 on PGlite and fails when they disagree. Only installed when
 * profile_preferences is declared, which is how a test says 0021 is applied.
 * Statements the stand-in for save_settings runs go through db.from, so they
 * appear in queryLog scoped to p_profile_id; what the triggers do does not.
 */
import { rpcError } from './fakeSupabase.mjs';

const { NOTIFICATION_TYPES } = await import('../../lib/alertInputs.js');
const { BAND_KEYS } = await import('../../lib/household.js');
const { roundCoord } = await import('../../lib/geocode.js');
const { settingsSnapshot } = await import('../../lib/settings.js');

export const SAVE_SETTINGS_ARGS = Object.freeze([
  'p_profile_id',
  'p_operation_id',
  'p_expected_revision',
  'p_preferences',
  'p_profile',
  'p_home',
  'p_notifications',
  'p_bands',
]);

/** The profile_preferences columns a save may set, and the ones the self trigger watches. */
export const PREFERENCE_COLUMNS = Object.freeze([
  'display_appearance', 'display_palette', 'display_ambient', 'display_scale', 'display_motion',
  'display_contrast', 'quiet_enabled', 'quiet_from', 'quiet_to', 'quiet_zone', 'calendar_zone',
  'calendar_streak', 'calendar_linked', 'luna_tasks', 'luna_home', 'luna_projects',
]);
const PROFILE_COLUMNS = Object.freeze(['home_year', 'water_source', 'locale', 'tenure', 'renter_mode']);

const declared = (db, name) => {
  try {
    db.rows(name);
    return true;
  } catch {
    return false;
  }
};
const same = (a, b) => (a ?? null) === (b ?? null);
const now = () => new Date().toISOString();

/** The households a committed write changed in `columns`, keyed by `key`; `inserted` decides for a new row. */
function changedOwners(previous, rows, key, columns, inserted) {
  const before = new Map(previous.map((row) => [row[key], row]));
  const owners = [];
  for (const row of rows) {
    const old = before.get(row[key]);
    if (old ? columns.some((column) => !same(old[column], row[column])) : inserted(row)) owners.push(row[key]);
  }
  return owners;
}

/** advance_settings_revision(): one advance per changed household that has a preferences row. */
function advance(tables, owners) {
  const preferences = tables('profile_preferences');
  if (!preferences || owners.length === 0) return;
  preferences.rows = preferences.rows.map((row) =>
    owners.includes(row.profile_id) ? { ...row, revision: row.revision + 1, updated_at: now() } : row,
  );
}

/** reconcile_profile_tenure(), on the planned rows of a profiles write. */
function reconcileTenure(previous, rows) {
  const before = new Map(previous.map((row) => [row.id, row]));
  for (const row of rows) {
    const old = before.get(row.id);
    if (old && same(old.tenure, row.tenure) && same(old.renter_mode, row.renter_mode)) continue;
    const answered = row.tenure != null && (!old || !same(old.tenure, row.tenure));
    if (answered) row.renter_mode = row.tenure === 'renter';
    else if (row.renter_mode === true && (row.tenure === 'owner' || row.tenure === 'other')) row.tenure = 'renter';
    else if (row.renter_mode === false && row.tenure === 'renter') row.tenure = null;
  }
}

export function installSettingsTriggers(db) {
  if (!declared(db, 'profile_preferences')) return;
  db.registerTrigger('profile_preferences', {
    after: (previous, rows, tables) => {
      const before = new Map(previous.map((row) => [row.profile_id, row]));
      advance(tables, changedOwners(previous, rows, 'profile_id', PREFERENCE_COLUMNS, () => false)
        .filter((owner) => before.get(owner)?.revision === rows.find((row) => row.profile_id === owner).revision));
    },
  });
  if (declared(db, 'profiles')) {
    db.registerTrigger('profiles', {
      before: reconcileTenure,
      after: (previous, rows, tables) => advance(tables, changedOwners(previous, rows, 'id', PROFILE_COLUMNS, () => false)),
    });
  }
  if (declared(db, 'notification_prefs')) {
    db.registerTrigger('notification_prefs', {
      after: (previous, rows, tables) =>
        advance(tables, changedOwners(previous, rows, 'profile_id', NOTIFICATION_TYPES, (row) => NOTIFICATION_TYPES.some((key) => row[key] === false))),
    });
  }
  if (declared(db, 'household_bands')) {
    db.registerTrigger('household_bands', {
      after: (previous, rows, tables) =>
        advance(tables, changedOwners(previous, rows, 'profile_id', BAND_KEYS, (row) => BAND_KEYS.some((key) => row[key] === true))),
    });
  }
  if (declared(db, 'operations')) db.registerTrigger('operations', { before: guardSettledSettings });
}

/** guard_settled_settings_operation(): a settled 'settings' row keeps its status (Ruling S15). */
function guardSettledSettings(previous, rows) {
  const before = new Map(previous.map((row) => [row.operation_id, row]));
  for (const row of rows) {
    const old = before.get(row.operation_id);
    if (old && old.domain === 'settings' && old.status !== 'pending' && row.status !== old.status) {
      throw rpcError('P0001', 'HALO_OPERATION_SETTLED', `operation ${old.operation_id} is already ${old.status}`);
    }
  }
}

/** A stored point transition_home_context takes as it is (app/api/profile/route.js isStoredPoint). */
const isStoredPoint = (profile) =>
  !!profile && [profile.lat, profile.lng].every((value) => Number.isFinite(value) && roundCoord(value) === value);

const present = (value) => value !== null && value !== undefined && Object.keys(value).length > 0;

/** The values each column allows (0021's checks), which save_settings checks itself (review finding B). */
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]{0,39}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;
const ALLOWED = Object.freeze({
  display_appearance: /^(system|light|dark)$/,
  display_palette: /^(ocean|forest|iris)$/,
  display_scale: /^(100|115|130|150)$/,
  display_motion: /^(system|full|reduce)$/,
  quiet_from: CLOCK,
  quiet_to: CLOCK,
  quiet_zone: ZONE,
  calendar_zone: ZONE,
});

export async function saveSettings(args, db) {
  const { p_profile_id: id, p_operation_id: operationId, p_expected_revision: expected } = args;
  const prefs = args.p_preferences ?? {};
  if (!id) throw rpcError('P0001', 'HALO_INVALID_INPUT', 'p_profile_id is required');
  if (!operationId) throw rpcError('P0001', 'HALO_INVALID_INPUT', 'p_operation_id is required');
  if (!Number.isSafeInteger(expected) || expected < 1) throw rpcError('P0001', 'HALO_INVALID_INPUT', 'p_expected_revision must be a positive integer');
  const unknown = Object.keys(prefs).filter((key) => !PREFERENCE_COLUMNS.includes(key));
  if (unknown.length) throw rpcError('P0001', 'HALO_INVALID_INPUT', `p_preferences has unknown keys: ${unknown.join(', ')}`);
  const refused = Object.keys(ALLOWED).filter((key) => typeof prefs[key] === 'string' && !ALLOWED[key].test(prefs[key])).sort();
  if (refused.length) throw rpcError('P0001', 'HALO_INVALID_INPUT', `p_preferences has a value its column does not allow: ${refused.join(', ')}`);
  const profileValues = args.p_profile ?? {};
  if ((Object.hasOwn(profileValues, 'tenure') && !['owner', 'renter', 'other'].includes(profileValues.tenure))
    || (Object.hasOwn(profileValues, 'locale') && !['en', 'es'].includes(profileValues.locale))) {
    throw rpcError('P0001', 'HALO_INVALID_INPUT', 'p_profile.tenure must be owner, renter or other, and p_profile.locale en or es');
  }

  const run = async (query) => {
    const { data, error } = await query;
    if (error) throw rpcError(error.code, error.message, error.details ?? null);
    return data;
  };
  const call = async (name, params) => {
    const { data, error } = await db.rpc(name, params);
    if (error) throw rpcError(error.code, error.message, error.details ?? null);
    return data;
  };
  const pending = (query) => query.eq('operation_id', operationId).eq('profile_id', id).eq('domain', 'settings').eq('status', 'pending');

  // The SQL holds the household's preferences row from its revision check to
  // its commit, so a second save of the same household waits, then reads the
  // revision the first one left. One chain per household on this fake models it.
  return householdLock(db, id, () => db.atomically(async () => {
    // 1. This operation's own ledger row, still pending (Ruling S15).
    if (!(await run(pending(db.from('operations').select('operation_id')).maybeSingle()))) {
      throw rpcError('P0001', 'HALO_OPERATION_NOT_PENDING');
    }
    // 2. The profile.
    if (!(await run(db.from('profiles').select('id').eq('id', id).maybeSingle()))) throw rpcError('P0001', 'HALO_PROFILE_NOT_FOUND');
    // 3. The notification and band rows exist (review finding A). All defaults, so no trigger advances anything.
    const made = {};
    for (const table of ['notification_prefs', 'household_bands']) {
      made[table] = (await run(db.from(table).upsert({ profile_id: id }, { onConflict: 'profile_id', ignoreDuplicates: true }).select('profile_id'))).length > 0;
    }
    // 4. The revision check. A miss writes nothing: the rows step 3 made go again.
    const stored = await run(db.from('profile_preferences').select('*').eq('profile_id', id).maybeSingle());
    if (!stored || stored.revision !== expected) {
      for (const table of ['notification_prefs', 'household_bands']) {
        if (made[table]) await run(db.from(table).delete().eq('profile_id', id));
      }
      return { saved: false, revision: stored?.revision ?? null };
    }
    const quiet = (key) => (Object.hasOwn(prefs, key) ? prefs[key] : stored[key]);
    if (quiet('quiet_enabled') && quiet('quiet_from') === quiet('quiet_to')) {
      throw rpcError('P0001', 'HALO_INVALID_INPUT', 'quiet hours that are on need different start and end times');
    }

    // 5. The group's columns, without the revision: the trigger advances it if a value changed (finding C).
    await run(db.from('profile_preferences').update({ ...prefs, updated_at: now() }).eq('profile_id', id));

    // 6. The other tables.
    if (args.p_home) {
      const home = await run(db.from('home_contexts').select('id, revision').eq('profile_id', id).is('effective_to', null).maybeSingle());
      if (home) {
        await call('update_home_context_attributes', {
          p_profile_id: id, p_context_id: home.id, p_expected_revision: home.revision, p_attributes: args.p_home,
        });
      } else {
        const located = await run(db.from('profiles').select('lat, lng, county, state, pwsid, water_source, home_year').eq('id', id).maybeSingle());
        if (isStoredPoint(located)) {
          await call('transition_home_context', {
            p_profile_id: id,
            p_location: { lat: located.lat, lng: located.lng, county: located.county ?? null, state: located.state ?? null },
            p_attributes: {
              pwsid: located.pwsid ?? null,
              water_source: Object.hasOwn(args.p_home, 'water_source') ? args.p_home.water_source : located.water_source ?? null,
              home_year: Object.hasOwn(args.p_home, 'home_year') ? args.p_home.home_year : located.home_year ?? null,
            },
            p_request_id: null,
          });
        } else {
          await run(db.from('profiles').update(args.p_home).eq('id', id));
        }
      }
    }
    if (present(args.p_profile)) await run(db.from('profiles').update(args.p_profile).eq('id', id));
    if (present(args.p_notifications)) {
      await run(db.from('notification_prefs').update({ ...args.p_notifications, updated_at: now() }).eq('profile_id', id));
    }
    if (present(args.p_bands)) {
      await run(db.from('household_bands').update({ ...args.p_bands, updated_at: now() }).eq('profile_id', id));
    }

    // 7. One advance for a save that changed something, none for one that did not.
    const moved = (await run(db.from('profile_preferences').select('revision').eq('profile_id', id).single())).revision;
    const changed = moved !== expected;
    if (changed) await run(db.from('profile_preferences').update({ revision: expected + 1 }).eq('profile_id', id));

    const preferences = await run(db.from('profile_preferences').select('*').eq('profile_id', id).single());
    const profile = await run(db.from('profiles').select('home_year, water_source, locale, tenure, renter_mode').eq('id', id).single());
    const notifications = await run(db.from('notification_prefs').select('*').eq('profile_id', id).maybeSingle());

    // 8. Settle the operation's own row with the receipt the route stores (Rulings S14 and S15).
    const receipt = {
      operationId,
      status: 'succeeded',
      snapshot: settingsSnapshot({ preferences, profile, notifications, unresolvedOperations: [] }),
    };
    const settled = await run(pending(db.from('operations').update({ status: 'succeeded', result: receipt, updated_at: now() })).select('operation_id'));
    if (settled.length !== 1) throw rpcError('P0001', 'HALO_OPERATION_NOT_PENDING');

    return { saved: true, changed, revision: preferences.revision, preferences, profile, notifications: notifications ?? null };
  }));
}

const locks = new WeakMap();
/** Runs `fn` after every earlier call for this household on this fake has finished, as a row lock does. */
function householdLock(db, id, fn) {
  if (!locks.has(db)) locks.set(db, new Map());
  const chains = locks.get(db);
  const run = (chains.get(id) ?? Promise.resolve()).then(fn);
  chains.set(id, run.catch(() => {}));
  return run;
}

/** Registers the stand-in as rpc('save_settings'). */
export function registerSaveSettings(db) {
  db.registerRpc('save_settings', saveSettings, { args: [...SAVE_SETTINGS_ARGS] });
}

/** 0021 applied: the triggers and save_settings. */
export function installSettingsDb(db) {
  installSettingsTriggers(db);
  if (declared(db, 'profile_preferences')) registerSaveSettings(db);
}
