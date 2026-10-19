/**
 * In-memory stand-ins for what migration 0021 puts in the database for the
 * settings surface, on the fake Supabase:
 *
 *   installSettingsTriggers(h.db)   the triggers (Rulings S12 and S13)
 *   registerSaveSettings(h.db)      public.save_settings (Ruling S11)
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
 * into 'renter', and false turns 'renter' into null.
 *
 * save_settings follows the SQL function: the compare-and-set on the revision
 * with the group's preference columns, then the home details through the
 * home-context functions registered on this fake (update_home_context_attributes
 * with a current home, transition_home_context when located without one, the
 * profile otherwise), the profile columns, the switches and the bands, then
 * the revision put back to expected + 1, all undone if anything throws
 * (db.atomically). It answers what the SQL answers.
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

export const SAVE_SETTINGS_ARGS = Object.freeze([
  'p_profile_id',
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
}

/** A stored point transition_home_context takes as it is (app/api/profile/route.js isStoredPoint). */
const isStoredPoint = (profile) =>
  !!profile && [profile.lat, profile.lng].every((value) => Number.isFinite(value) && roundCoord(value) === value);

const present = (value) => value !== null && value !== undefined && Object.keys(value).length > 0;

export async function saveSettings(args, db) {
  const { p_profile_id: id, p_expected_revision: expected } = args;
  if (!id) throw rpcError('P0001', 'HALO_INVALID_INPUT', 'p_profile_id is required');
  if (!Number.isSafeInteger(expected) || expected < 1) throw rpcError('P0001', 'HALO_INVALID_INPUT', 'p_expected_revision must be a positive integer');
  const unknown = Object.keys(args.p_preferences ?? {}).filter((key) => !PREFERENCE_COLUMNS.includes(key));
  if (unknown.length) throw rpcError('P0001', 'HALO_INVALID_INPUT', `p_preferences has unknown keys: ${unknown.join(', ')}`);

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

  return db.atomically(async () => {
    if (!(await run(db.from('profiles').select('id').eq('id', id).maybeSingle()))) throw rpcError('P0001', 'HALO_PROFILE_NOT_FOUND');

    const won = await run(
      db.from('profile_preferences')
        .update({ ...(args.p_preferences ?? {}), revision: expected + 1, updated_at: now() })
        .eq('profile_id', id)
        .eq('revision', expected)
        .select('revision'),
    );
    if (won.length === 0) {
      const current = await run(db.from('profile_preferences').select('revision').eq('profile_id', id).maybeSingle());
      return { saved: false, revision: current?.revision ?? null };
    }

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
      await run(db.from('notification_prefs').upsert({ ...args.p_notifications, updated_at: now(), profile_id: id }, { onConflict: 'profile_id' }));
    }
    if (present(args.p_bands)) {
      await run(db.from('household_bands').upsert({ ...args.p_bands, updated_at: now(), profile_id: id }, { onConflict: 'profile_id' }));
    }
    // Exactly one advance for the whole save: the triggers moved it again in between.
    await run(db.from('profile_preferences').update({ revision: expected + 1 }).eq('profile_id', id));

    const preferences = await run(db.from('profile_preferences').select('*').eq('profile_id', id).single());
    const profile = await run(db.from('profiles').select('home_year, water_source, locale, tenure, renter_mode').eq('id', id).single());
    const notifications = await run(db.from('notification_prefs').select('*').eq('profile_id', id).maybeSingle());
    return { saved: true, revision: preferences.revision, preferences, profile, notifications: notifications ?? null };
  });
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
