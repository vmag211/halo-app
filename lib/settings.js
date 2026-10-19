/**
 * The settings surface: `GET /api/settings` (`settings.read`) and
 * `PATCH /api/settings` (`settings.save`), plus the obligations the two legacy
 * writers of the same values carry (B04 plan, Task 2a, Rulings S1 to S8).
 *
 * The shape is fixed by the frontend, not by us. ProductionPreferences runs
 * `validSettingsSnapshot` (lib/frontend/production/preferences-service.ts on
 * origin/codex/october15-review-refinement) on every read and every receipt
 * and throws the whole payload away if one field is off, so `settingsSnapshot`
 * below produces exactly that type and nothing that type would refuse:
 *
 *   { revision, values: { home, notifications, quiet, luna, language },
 *     display, calendar, unresolvedOperations }
 *
 * Where each value lives (contract digest section 8.2):
 *   values.home.year, .water   profiles.home_year, profiles.water_source
 *   values.home.tenure         profiles.tenure (0021)
 *   values.notifications.*     notification_prefs, five booleans
 *   values.language            profiles.locale
 *   values.quiet.*, .luna.*,
 *   display.*, calendar.*,
 *   revision                   public.profile_preferences (0021)
 *   household (written only)   household_bands, seven booleans
 *
 * Three answers the stored data cannot give the client, and what is sent:
 *   - an unanswered tenure (null) is read from renter_mode, the person's
 *     answer to the older question: 'renter' when it is true, and otherwise
 *     'other', the client's "Other / Not sure" and its own default, never
 *     'owner' (Rulings S8 and S13);
 *   - an unanswered water source is 'other' too, for the same reason: the
 *     validator refuses null, and 'utility' would claim a measured public
 *     system the household never said it has;
 *   - an unanswered year is '', which the client reads as blank.
 * A group save writes a field only when the submitted value differs from what
 * the client was shown, so saving a panel never turns one of these stand-ins
 * into a stored answer the person did not give.
 *
 * The revision is a real column (Ruling S4), and the database owns it:
 *   - a save is one call to public.save_settings (0021, Ruling S11), which
 *     compares the revision with `If-Match` and writes every table the group
 *     touches in one transaction, so of two saves holding the same revision
 *     that change something exactly one applies, a save that fails applies
 *     nothing, and a save of the values already stored applies without
 *     advancing the revision (review finding C);
 *   - the same transaction settles the save's own ledger row as succeeded
 *     (Ruling S15), so a save whose answer is lost still reconciles as saved;
 *   - every other writer of a snapshot value (PUT /api/notifications,
 *     PUT /api/household, PATCH /api/profile, POST /api/onboard and
 *     PATCH /api/home-contexts/[id]) advances it through 0021's triggers, in
 *     the same transaction as its write (Ruling S12), so a settings save
 *     holding the old revision conflicts instead of reverting that change;
 *   - the same triggers keep tenure in step with renter_mode for every
 *     writer (Rulings S7 and S13).
 *
 * Pure module apart from the database helpers, which take the client as an
 * argument; nothing here reads the environment.
 */
import { NOTIFICATION_TYPES, normalizePrefs } from './alertInputs.js';
import { BAND_KEYS } from './household.js';
import { validateHomeYear } from './geocode.js';
import { listUnresolvedOperations } from './operations.js';

/** The `group` names the body type admits (SettingsWorkspace.tsx `SettingPanel`). */
export const SETTINGS_GROUPS = Object.freeze(['home', 'notifications', 'display', 'luna', 'privacy', 'about']);

/**
 * The groups that have something to save. privacy and about have no writable
 * slice (`slice` returns null for them in SettingsWorkspace.tsx:49), so nothing
 * on the client ever sends them, and a save of one would have nothing to apply.
 */
export const WRITABLE_GROUPS = Object.freeze(['home', 'notifications', 'display', 'luna']);

/** The top-level body keys each group may carry, besides `group`, `values` and `operationId`. */
const GROUP_EXTRAS = Object.freeze({
  home: ['household'],
  notifications: [],
  display: ['display', 'calendar'],
  luna: [],
});
const BODY_KEYS = Object.freeze(['group', 'values', 'operationId', 'household', 'display', 'calendar']);

const WATER = Object.freeze(['utility', 'well', 'spring', 'other']);
const TENURE = Object.freeze(['owner', 'renter', 'other']);
const LANGUAGES = Object.freeze(['en', 'es']);
const APPEARANCE = Object.freeze(['system', 'light', 'dark']);
const PALETTES = Object.freeze(['ocean', 'forest', 'iris']);
const SCALES = Object.freeze(['100', '115', '130', '150']);
const MOTION = Object.freeze(['system', 'full', 'reduce']);
const LUNA_KEYS = Object.freeze(['tasks', 'home', 'projects']);

/** 24-hour HH:MM, the client's own pattern (preferences-service.ts:10). */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 0021's column check on both zones: a floor on the shape, not the client's test. */
const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]{0,39}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;

/**
 * A real IANA zone, asked of Intl exactly the way the client asks
 * (`new Intl.DateTimeFormat('en', {timeZone})` in preferences-service.ts), so
 * a zone accepted here is one the client will accept on the way back. It must
 * also pass 0021's shape check, because Intl accepts some values the column
 * refuses (an offset such as '+05:00'), and those would otherwise be a 500.
 */
export function isTimeZone(value) {
  if (typeof value !== 'string' || !ZONE_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const MESSAGES = Object.freeze({
  option: (allowed) => `Choose one of: ${allowed.join(', ')}.`,
  boolean: 'Use true or false.',
  object: 'Send this as an object.',
  year: 'Enter a four-digit past or current year, or leave it blank.',
  clock: 'Use a 24-hour time such as 21:00.',
  quietWindow: 'Choose valid, different start and end times.',
  zone: 'Choose a time zone from the list.',
  group: 'Choose which settings to save.',
  nothingToSave: 'There is nothing to save in this section.',
  unknown: (key) => `${key} cannot be saved with this section.`,
});

/**
 * The body of PATCH /api/settings, checked before anything is read or written.
 *
 * `values` always carries every group (SettingsWorkspace.tsx:88), but only the
 * named group's slice is read: the rest is the snapshot the client last
 * hydrated, and writing it back would overwrite another group with stale
 * values. A key the group may not carry is refused rather than ignored.
 *
 * @param {object} body the parsed JSON object
 * @param {Date} [now] only for tests; the latest accepted year is this year
 * @returns {{ ok: true, value: { group: string, patch: object } } | { ok: false, fieldErrors: object[] }}
 */
export function parseSettingsSave(body, now = new Date()) {
  const fieldErrors = [];
  const fail = (field, code, message) => {
    fieldErrors.push({ field, code, message });
    return undefined;
  };

  if (!SETTINGS_GROUPS.includes(body.group)) {
    fail('group', 'invalid_option', MESSAGES.group);
    return { ok: false, fieldErrors };
  }
  const group = body.group;
  if (!WRITABLE_GROUPS.includes(group)) {
    fail('group', 'nothing_to_save', MESSAGES.nothingToSave);
    return { ok: false, fieldErrors };
  }

  for (const key of Object.keys(body).sort()) {
    if (!BODY_KEYS.includes(key) || (!['group', 'values', 'operationId'].includes(key) && !GROUP_EXTRAS[group].includes(key))) {
      fail(key, 'unknown_field', MESSAGES.unknown(Array.from(key).slice(0, 40).join('')));
    }
  }
  if (fieldErrors.length > 0) return { ok: false, fieldErrors };

  const values = body.values;
  if (!isObject(values)) {
    fail('values', 'invalid_object', MESSAGES.object);
    return { ok: false, fieldErrors };
  }

  const pick = (value, allowed, field) => (typeof value === 'string' && allowed.includes(value) ? value : fail(field, 'invalid_option', MESSAGES.option(allowed)));
  const flag = (value, field) => (typeof value === 'boolean' ? value : fail(field, 'invalid_boolean', MESSAGES.boolean));
  const object = (value, field) => (isObject(value) ? value : fail(field, 'invalid_object', MESSAGES.object));
  const zone = (value, field) => (isTimeZone(value) ? value : fail(field, 'invalid_zone', MESSAGES.zone));

  const patch = {};
  if (group === 'home') {
    const home = object(values.home, 'values.home');
    if (home) {
      let year;
      if (home.year === '') year = null;
      else if (typeof home.year !== 'string' || !/^\d{4}$/.test(home.year)) fail('values.home.year', 'invalid_year', MESSAGES.year);
      else {
        // The server's own rule for a build year (lib/geocode.js validateHomeYear), which is
        // narrower than the client's (from 1700, not 1000). Digest C8 records the difference.
        const checked = validateHomeYear(home.year, now);
        if (checked.ok) year = checked.value;
        else fail('values.home.year', 'invalid_year', checked.error);
      }
      const water = pick(home.water, WATER, 'values.home.water');
      const tenure = pick(home.tenure, TENURE, 'values.home.tenure');
      patch.home = { year, water, tenure };
    }
    if (body.household !== undefined) {
      const household = object(body.household, 'household');
      if (household) {
        patch.household = {};
        for (const key of Object.keys(household).sort()) {
          if (!BAND_KEYS.includes(key)) fail(`household.${Array.from(key).slice(0, 40).join('')}`, 'unknown_field', MESSAGES.unknown(key.slice(0, 40)));
        }
        for (const key of BAND_KEYS) patch.household[key] = flag(household[key], `household.${key}`);
      }
    }
  } else if (group === 'notifications') {
    const notifications = object(values.notifications, 'values.notifications');
    if (notifications) {
      patch.notifications = {};
      for (const key of NOTIFICATION_TYPES) patch.notifications[key] = flag(notifications[key], `values.notifications.${key}`);
    }
    const quiet = object(values.quiet, 'values.quiet');
    if (quiet) {
      const enabled = flag(quiet.enabled, 'values.quiet.enabled');
      // Well formed even while switched off: the client's response validator and 0021's
      // column check both require it, so a remembered draft must still be a real time.
      const from = typeof quiet.from === 'string' && CLOCK.test(quiet.from) ? quiet.from : fail('values.quiet.from', 'invalid_time', MESSAGES.clock);
      const to = typeof quiet.to === 'string' && CLOCK.test(quiet.to) ? quiet.to : fail('values.quiet.to', 'invalid_time', MESSAGES.clock);
      // 0021's quiet_window check: a window from a time to itself is not a window. The client
      // refuses it too (SettingsWorkspace.tsx:84); without this the check would answer a 500.
      if (enabled === true && from !== undefined && from === to) fail('values.quiet.to', 'quiet_window', MESSAGES.quietWindow);
      patch.quiet = { enabled, from, to, zone: zone(quiet.zone, 'values.quiet.zone') };
    }
  } else if (group === 'luna') {
    const luna = object(values.luna, 'values.luna');
    if (luna) {
      patch.luna = {};
      for (const key of LUNA_KEYS) patch.luna[key] = flag(luna[key], `values.luna.${key}`);
    }
  } else {
    patch.language = pick(values.language, LANGUAGES, 'values.language');
    const display = object(body.display, 'display');
    if (display) {
      patch.display = {
        appearance: pick(display.appearance, APPEARANCE, 'display.appearance'),
        ambient: flag(display.ambient, 'display.ambient'),
        scale: pick(display.scale, SCALES, 'display.scale'),
        motion: pick(display.motion, MOTION, 'display.motion'),
        contrast: flag(display.contrast, 'display.contrast'),
      };
      // Optional, as in the snapshot: left out means "keep the stored one". The client
      // rejects `palette: null` on the way back, so null is refused on the way in too.
      if (display.palette !== undefined) patch.display.palette = pick(display.palette, PALETTES, 'display.palette');
    }
    const calendar = object(body.calendar, 'calendar');
    if (calendar) {
      patch.calendar = {
        zone: zone(calendar.zone, 'calendar.zone'),
        streak: flag(calendar.streak, 'calendar.streak'),
        linked: flag(calendar.linked, 'calendar.linked'),
      };
    }
  }

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { group, patch } };
}

/**
 * The three-state tenure as the client reads it. An answer is sent as it is.
 * Unanswered (null) is read from renter_mode: true is the person's own answer
 * that they rent, so 'renter'; false cannot tell an owner from an other, so
 * 'other', never 'owner' (Rulings S8 and S13).
 */
export function tenureOf(profile) {
  if (TENURE.includes(profile?.tenure)) return profile.tenure;
  return profile?.renter_mode === true ? 'renter' : 'other';
}

/** The year as the client reads it: '' or four digits. */
function yearText(value) {
  return Number.isInteger(value) && value >= 1000 && value <= 9999 ? String(value) : '';
}

/**
 * The snapshot the client validates, from the stored rows. Every field the
 * validator requires is always present, and `display.palette` is left out
 * rather than sent as null when none is stored.
 */
export function settingsSnapshot({ preferences, profile, notifications, unresolvedOperations }) {
  const p = preferences;
  const display = {
    appearance: p.display_appearance,
    ambient: p.display_ambient,
    scale: p.display_scale,
    motion: p.display_motion,
    contrast: p.display_contrast,
  };
  if (PALETTES.includes(p.display_palette)) display.palette = p.display_palette;
  return {
    revision: p.revision,
    values: {
      home: {
        year: yearText(profile?.home_year),
        water: WATER.includes(profile?.water_source) ? profile.water_source : 'other',
        tenure: tenureOf(profile),
      },
      notifications: normalizePrefs(notifications),
      quiet: { enabled: p.quiet_enabled, from: p.quiet_from, to: p.quiet_to, zone: p.quiet_zone },
      luna: { tasks: p.luna_tasks, home: p.luna_home, projects: p.luna_projects },
      language: profile?.locale === 'es' ? 'es' : 'en',
    },
    display,
    calendar: { zone: p.calendar_zone, streak: p.calendar_streak, linked: p.calendar_linked },
    unresolvedOperations,
  };
}

/**
 * A household with no profiles row (review N1 of Task 2a). Sign-up makes the
 * row (0001's handle_new_user), so this is practically unreachable, but where
 * it happens the settings surface has nothing to read or write: the
 * preferences row's foreign key refuses it (23503), and so would the ledger's
 * when a save claimed its operation. The route answers it as a 404, decided
 * before anything is claimed or written, rather than a 500.
 */
export class SettingsProfileMissingError extends Error {
  constructor() {
    super('settings: this household has no profile row');
    this.name = 'SettingsProfileMissingError';
  }
}

/** True for a missing profile row (SettingsProfileMissingError). */
export function isSettingsProfileMissing(error) {
  return error instanceof SettingsProfileMissingError;
}

/**
 * The household's preferences row, created with 0021's defaults when it has
 * none, so the revision a client is shown is always a stored one that a save
 * can compare against. A fresh row is already a valid snapshot (revision 1).
 * Errors are thrown as they come, so a missing 0021 reaches the route as
 * PGRST205 or 42P01, except that the row's foreign key refusing it (23503, the
 * table's one foreign key) is SettingsProfileMissingError.
 */
export async function ensurePreferences(supabase, profileId) {
  const read = () => supabase.from('profile_preferences').select('*').eq('profile_id', profileId).maybeSingle();
  const { data, error } = await read();
  if (error) throw error;
  if (data) return data;
  const { error: createError } = await supabase
    .from('profile_preferences')
    .upsert({ profile_id: profileId }, { onConflict: 'profile_id', ignoreDuplicates: true });
  if (createError?.code === '23503') throw new SettingsProfileMissingError();
  if (createError) throw createError;
  const { data: created, error: againError } = await read();
  if (againError) throw againError;
  if (!created) throw new Error('settings: the preferences row could not be created');
  return created;
}

/**
 * The profile columns the snapshot reads: renter_mode because an unanswered
 * tenure is read from it (Ruling S13). Naming tenure is what proves 0021's
 * column is there.
 */
export async function readSettingsProfile(supabase, profileId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('home_year, water_source, locale, tenure, renter_mode')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function readNotificationRow(supabase, profileId) {
  const { data, error } = await supabase.from('notification_prefs').select('*').eq('profile_id', profileId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * `unresolvedOperations`: the ledger's own list for the settings domain only
 * (Ruling S1: a lock, not a log). `excludeOperationId` leaves out the one id
 * whose receipt is being built: that operation is about to be settled as
 * succeeded with that receipt, and ProductionPreferences parks
 * `unresolvedOperations[0]` as unknown on hydrate, so listing a save in its
 * own success receipt would lock the surface it just saved.
 */
export async function unresolvedSettingsOperations(supabase, profileId, { excludeOperationId = null } = {}) {
  const unresolved = await listUnresolvedOperations(supabase, { profileId, domains: ['settings'] });
  return unresolved.filter((id) => id !== excludeOperationId);
}

/** The full snapshot, for GET /api/settings. A save's receipt is built from what save_settings returns. */
export async function readSettingsSnapshot(supabase, profileId) {
  const state = await readSettingsState(supabase, profileId);
  return settingsSnapshot({ ...state, unresolvedOperations: await unresolvedSettingsOperations(supabase, profileId) });
}

/**
 * The stored rows a snapshot is built from, in separate statements, and the
 * revision FIRST. Every writer of a snapshot value advances the revision in
 * the same transaction as its write (0021's triggers, Ruling S12), so a write
 * that commits between two of these reads is seen in the later ones but not in
 * the revision. Reading in this order can therefore only ever pair newer
 * values with an older revision, which a save at that revision then conflicts
 * on (the client re-reads), never older values with a newer revision, which
 * would let a save based on values the person never saw through as a silent
 * revert. test/routesSettings.test.mjs pins the order.
 */
export async function readSettingsState(supabase, profileId) {
  const preferences = await ensurePreferences(supabase, profileId);
  const profile = await readSettingsProfile(supabase, profileId);
  const notifications = await readNotificationRow(supabase, profileId);
  return { preferences, profile, notifications };
}

/** The current household bands, for deciding whether a home save changes them. */
export async function readBands(supabase, profileId) {
  const { data, error } = await supabase.from('household_bands').select('*').eq('profile_id', profileId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * The profile_preferences columns a group save writes, passed to save_settings
 * as p_preferences and written in the same statement as the compare-and-set on
 * the revision. Only the groups whose values live in this table have any; home
 * writes nothing here but the revision.
 */
export function preferenceColumns(group, patch, stored) {
  if (group === 'notifications') {
    return { quiet_enabled: patch.quiet.enabled, quiet_from: patch.quiet.from, quiet_to: patch.quiet.to, quiet_zone: patch.quiet.zone };
  }
  if (group === 'luna') {
    return { luna_tasks: patch.luna.tasks, luna_home: patch.luna.home, luna_projects: patch.luna.projects };
  }
  if (group === 'display') {
    return {
      display_appearance: patch.display.appearance,
      display_ambient: patch.display.ambient,
      display_scale: patch.display.scale,
      display_motion: patch.display.motion,
      display_contrast: patch.display.contrast,
      display_palette: patch.display.palette ?? stored.display_palette ?? null,
      calendar_zone: patch.calendar.zone,
      calendar_streak: patch.calendar.streak,
      calendar_linked: patch.calendar.linked,
    };
  }
  return {};
}

/** save_settings (0021): its parameter names, which PostgREST matches a call by. */
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

/**
 * "save_settings is not there": PostgREST's PGRST202 or Postgres's 42883. It
 * ships in 0021 with the tables, so this is 0021 not (fully) applied.
 */
export function isSaveSettingsMissing(error) {
  return !!error && (error.code === 'PGRST202' || error.code === '42883');
}

/**
 * The one database call a save makes (Ruling S11): public.save_settings
 * compares the revision with `expectedRevision` and writes the group's
 * preference columns and every change in `changes` (changedFields below) in
 * one transaction, so either all of it is applied or none of it is. The same
 * transaction settles `operationId`'s ledger row as succeeded (Ruling S15), so
 * the save is applied if and only if its operation reads as succeeded, and it
 * refuses with HALO_OPERATION_NOT_PENDING, writing nothing, when that row is
 * no longer pending (the reaper settled it first).
 *
 * Returns { saved: false, revision } when the revision has moved (nothing was
 * written), or { saved: true, changed, revision, preferences, profile,
 * notifications }: whether a stored value changed, and the committed rows the
 * receipt is built from, so nothing is read after the commit. The revision
 * advances by exactly one for a save that changed something and not at all
 * for one that did not (review finding C). Throws the database's error as it
 * came, a refusal of the 0016 home functions included, and an Error for an
 * answer of any other shape.
 */
export async function saveSettings(supabase, { profileId, operationId, expectedRevision, preferences, changes }) {
  const { data, error } = await supabase.rpc('save_settings', {
    p_profile_id: profileId,
    p_operation_id: operationId,
    p_expected_revision: expectedRevision,
    p_preferences: preferences,
    p_profile: changes.profile ?? null,
    p_home: changes.homeDetails ?? null,
    p_notifications: changes.notifications ?? null,
    p_bands: changes.bands ?? null,
  });
  if (error) throw error;
  if (data?.saved === false) {
    return { saved: false, revision: Number.isSafeInteger(data.revision) ? data.revision : null };
  }
  // One advance for a save that changed something, none for one that did not
  // (Ruling S12, finding C), and the rows a snapshot needs.
  if (
    data?.saved === true &&
    typeof data.changed === 'boolean' &&
    data.revision === expectedRevision + (data.changed ? 1 : 0) &&
    isObject(data.preferences) &&
    data.preferences.revision === data.revision &&
    isObject(data.profile) &&
    (data.notifications === null || isObject(data.notifications))
  ) {
    return {
      saved: true,
      changed: data.changed,
      revision: data.revision,
      preferences: data.preferences,
      profile: data.profile,
      notifications: data.notifications,
    };
  }
  throw new Error('settings: save_settings answered with something that is not a saved settings state');
}

/** The submitted values of one group that differ from what the client was shown, per external table. */
export function changedFields(group, patch, shown, bands) {
  const changes = {};
  if (group === 'home') {
    const profile = {};
    const home = {};
    if ((patch.home.year === null ? '' : String(patch.home.year)) !== shown.values.home.year) home.home_year = patch.home.year;
    if (patch.home.water !== shown.values.home.water) home.water_source = patch.home.water;
    // Ruling S7: tenure and renter_mode are written in one statement, always together.
    if (patch.home.tenure !== shown.values.home.tenure) {
      profile.tenure = patch.home.tenure;
      profile.renter_mode = patch.home.tenure === 'renter';
    }
    if (Object.keys(home).length > 0) changes.homeDetails = home;
    if (Object.keys(profile).length > 0) changes.profile = profile;
    if (patch.household) {
      const current = Object.fromEntries(BAND_KEYS.map((key) => [key, bands?.[key] === true]));
      if (BAND_KEYS.some((key) => patch.household[key] !== current[key])) changes.bands = patch.household;
    }
  } else if (group === 'notifications') {
    const notifications = {};
    for (const key of NOTIFICATION_TYPES) {
      if (patch.notifications[key] !== shown.values.notifications[key]) notifications[key] = patch.notifications[key];
    }
    if (Object.keys(notifications).length > 0) changes.notifications = notifications;
  } else if (group === 'display') {
    if (patch.language !== shown.values.language) changes.profile = { locale: patch.language };
  }
  return changes;
}
