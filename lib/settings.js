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
 *   - an unanswered tenure (null) is 'other', the client's "Other / Not sure"
 *     and its own default, never 'owner' (Ruling S8);
 *   - an unanswered water source is 'other' too, for the same reason: the
 *     validator refuses null, and 'utility' would claim a measured public
 *     system the household never said it has;
 *   - an unanswered year is '', which the client reads as blank.
 * A group save writes a field only when the submitted value differs from what
 * the client was shown, so saving a panel never turns one of these stand-ins
 * into a stored answer the person did not give.
 *
 * The revision is a real column (Ruling S4), advanced by one statement that
 * compares it: `update ... set revision = expected + 1 where revision =
 * expected`. Exactly one of two saves holding the same revision gets a row
 * back; the other is a conflict. The legacy writers advance it too (Ruling
 * S5), so a change made through them makes a stale settings save conflict.
 *
 * Pure module apart from the database helpers, which take the client as an
 * argument; nothing here reads the environment.
 */
import { NOTIFICATION_TYPES, normalizePrefs } from './alertInputs.js';
import { BAND_KEYS } from './household.js';
import { validateHomeYear } from './geocode.js';
import { listUnresolvedOperations } from './operations.js';
import { isSettingsAlertsUnavailable } from './settingsAlerts.js';

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
        // Ruling S8: unanswered is 'other', never 'owner'.
        tenure: TENURE.includes(profile?.tenure) ? profile.tenure : 'other',
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
 * The household's preferences row, created with 0021's defaults when it has
 * none, so the revision a client is shown is always a stored one that a save
 * can compare against. A fresh row is already a valid snapshot (revision 1).
 * Errors are thrown as they come, so a missing 0021 reaches the route as
 * PGRST205 or 42P01.
 */
export async function ensurePreferences(supabase, profileId) {
  const read = () => supabase.from('profile_preferences').select('*').eq('profile_id', profileId).maybeSingle();
  const { data, error } = await read();
  if (error) throw error;
  if (data) return data;
  const { error: createError } = await supabase
    .from('profile_preferences')
    .upsert({ profile_id: profileId }, { onConflict: 'profile_id', ignoreDuplicates: true });
  if (createError) throw createError;
  const { data: created, error: againError } = await read();
  if (againError) throw againError;
  if (!created) throw new Error('settings: the preferences row could not be created');
  return created;
}

/** The profile columns the snapshot reads. Naming tenure is what proves 0021's column is there. */
export async function readSettingsProfile(supabase, profileId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('home_year, water_source, locale, tenure')
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
 * The full snapshot, for GET /api/settings and for every save receipt, so a
 * receipt is the same answer the next read would give.
 *
 * The revision is read FIRST. A legacy writer writes its values and then
 * advances the revision, so reading in this order can only ever pair newer
 * values with an older revision (which a later save then conflicts on, and the
 * client re-reads), never older values with a newer revision, which would let
 * a save based on stale values through.
 *
 * `unresolvedOperations` is the ledger's own list for the settings domain only
 * (Ruling S1: a lock, not a log). `excludeOperationId` leaves out the one id
 * whose receipt this snapshot is being built for: that operation is about to
 * be settled as succeeded with this very snapshot, and ProductionPreferences
 * parks `unresolvedOperations[0]` as unknown on hydrate, so listing a save in
 * its own success receipt would lock the surface it just saved.
 */
export async function readSettingsSnapshot(supabase, profileId, { excludeOperationId = null } = {}) {
  const state = await readSettingsState(supabase, profileId);
  const unresolved = await listUnresolvedOperations(supabase, { profileId, domains: ['settings'] });
  return settingsSnapshot({ ...state, unresolvedOperations: unresolved.filter((id) => id !== excludeOperationId) });
}

/** The stored rows a snapshot is built from, revision first (see readSettingsSnapshot). */
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
 * The profile_preferences columns a group save writes, in the same statement
 * that advances the revision. Only the groups whose values live in this table
 * have any; home writes nothing here but the revision.
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

/**
 * The compare-and-advance on the settings revision: one statement that writes
 * the group's preference columns and `revision = expected + 1` only where the
 * stored revision is still `expected`. Returns true when this call won.
 */
export async function advanceRevision(supabase, profileId, expected, columns) {
  const { data, error } = await supabase
    .from('profile_preferences')
    .update({ ...columns, revision: expected + 1, updated_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('revision', expected)
    .select('revision');
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

/**
 * Ruling S5: a legacy write to a value inside the settings snapshot advances
 * the settings revision, so a settings client holding the old revision
 * conflicts instead of overwriting the change it never saw.
 *
 * One read and one compare-and-set, no retry loop, and that is enough: the
 * caller's write has already happened, so if the compare misses, another
 * writer advanced the revision after it, which is all this needs. A household
 * with no preferences row has never been shown a revision (GET creates the row
 * before reporting one), so there is nothing to invalidate.
 */
export async function bumpSettingsRevision(supabase, profileId) {
  const { data, error } = await supabase
    .from('profile_preferences')
    .select('revision')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !Number.isSafeInteger(data.revision)) return;
  const { error: bumpError } = await supabase
    .from('profile_preferences')
    .update({ revision: data.revision + 1, updated_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('revision', data.revision);
  if (bumpError) throw bumpError;
}

/**
 * What PUT /api/notifications and PUT /api/household do after their own write
 * succeeded (Rulings S5 and S7).
 *
 * S7: the database no longer ties tenure to renter_mode, so a household save
 * that writes a renter_mode contradicting the stored tenure clears tenure to
 * null (unanswered, reported as 'other'). It is one conditional update scoped
 * to the owner: a renter_mode of true clears 'owner' and 'other', false clears
 * 'renter', and an agreeing or unanswered tenure is left exactly as it was.
 * null rather than a derived word, because false cannot tell owner from other.
 *
 * S5: then the settings revision advances.
 *
 * Neither may fail the legacy request, whose write has already been made and
 * is reported as made. Before 0021 there is no tenure and no revision to keep
 * in step, so that case is silent; anything else is logged.
 *
 * @param {{ renterMode?: boolean, requestId?: string }} [options] renterMode only when the request sent one
 */
export async function afterLegacySettingsWrite(supabase, profileId, { renterMode, requestId } = {}) {
  try {
    if (typeof renterMode === 'boolean') {
      const contradicting = renterMode ? ['owner', 'other'] : ['renter'];
      const { error } = await supabase
        .from('profiles')
        .update({ tenure: null })
        .eq('id', profileId)
        .in('tenure', contradicting);
      if (error) throw error;
    }
    await bumpSettingsRevision(supabase, profileId);
  } catch (error) {
    if (isSettingsAlertsUnavailable(error)) return;
    console.error(`Settings revision could not be advanced after a legacy write (request ${requestId}):`, error?.message ?? error);
  }
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
