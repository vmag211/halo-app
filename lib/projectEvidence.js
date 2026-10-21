/**
 * The dated evidence Explore's project selection uses (B16 plan, Ruling J5).
 *
 * Server-side, keyed only on the verified session's household id. Each part is
 * best effort: a part that cannot be read is left out of the selection, never
 * turned into a healthy reading. A reading HALO does not have is an item with
 * `status: 'unknown'`, kept distinct from an available one (the contract's
 * "Keep unavailable evidence distinct from healthy readings").
 *
 * Every label, value and scope is a fixed server-authored phrase or a number,
 * a date or a category HALO stored. No text a person typed (a garden's name,
 * a note) is copied into the evidence, so an idea set never repeats one.
 *
 * Sources:
 *   home         the current home context (0016), else the profile: water
 *                source and building year
 *   today        the newest daily_scores row for the current home: air, UV,
 *                pollen and the outdoor mold estimate, each with its date
 *   workspace    with the `workspace` flag on and 0026 applied: gardens,
 *                indoor observations, PFAS filter records and test reports
 *                that need clarification (B11), for the current home
 *
 * Returns `ProjectEvidence[]` (lib/frontend/explore-personalization.ts:13-17),
 * at most MAX_EVIDENCE items.
 */
import { addDays } from './localDate.js';
import { readWorkspaceCollections } from './workspaceStore.js';

/** The client accepts at most 60 (explore-service.ts validProjectGeneration). */
export const MAX_EVIDENCE = 60;
const MAX_WORKSPACE_ITEMS = 40;

const WATER_SOURCES = Object.freeze({
  utility: 'Public water system',
  well: 'Private well',
  spring: 'Spring',
});

const day = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function airProvenance(source) {
  if (source === 'airnow') return 'Measured at a nearby monitor';
  if (typeof source === 'string' && source) return 'Modelled estimate';
  return 'Source not recorded';
}

/** The home part: water source and building year. `home` is the current context or null; `profile` the profile row. */
export function homeEvidence({ home, profile }) {
  const items = [];
  const asOf = day(home?.effective_from) ?? 'Recorded by you';
  const water = home?.water_source ?? profile?.water_source ?? null;
  if (WATER_SOURCES[water]) {
    items.push({ id: 'home:water-source', topic: 'water', label: 'Water source', value: WATER_SOURCES[water], scope: 'The water source you gave HALO, not a test of your tap', asOf, provenance: 'User-provided', stale: false, status: 'available' });
  } else {
    items.push({ id: 'home:water-source', topic: 'water', label: 'Water source', value: 'Not recorded', scope: 'HALO does not know where this home\'s water comes from', asOf, provenance: 'Not recorded', stale: false, status: 'unknown' });
  }
  const year = finite(home?.home_year ?? profile?.home_year ?? profile?.build_year ?? null);
  if (year !== null) {
    items.push({ id: 'home:building-year', topic: 'lead', label: 'Building-era context', value: `Built in ${year}`, scope: 'User-provided building year, not proof of lead plumbing or paint', asOf, provenance: 'User-provided', stale: false, status: 'available' });
  }
  return items;
}

function pollenValue(raw) {
  let pollen = {};
  try { pollen = JSON.parse(raw || '{}') || {}; } catch { pollen = {}; }
  const parts = ['tree', 'grass', 'weed']
    .filter((name) => pollen[name] !== null && pollen[name] !== undefined && pollen[name] !== '')
    .map((name) => `${name[0].toUpperCase()}${name.slice(1)} ${String(pollen[name]).slice(0, 20)}`);
  return parts.length ? parts.join(', ') : null;
}

/**
 * The today part, from the newest daily_scores row (or null). `today` is the
 * household's local date: a reading from an earlier day is `stale`.
 */
export function todayEvidence(row, today) {
  const date = day(row?.date);
  const stale = !date || date < today;
  const asOf = date ?? 'No reading';
  const item = (topic, label, value, scope, provenance, extra = {}) => (value === null
    ? { id: `today:${topic}:${date ?? 'none'}`, topic, label, value: 'No recent reading', scope: 'HALO has no reading for this', asOf, provenance: 'Not available', stale: true, status: 'unknown' }
    : { id: `today:${topic}:${date}`, topic, label, value, scope, asOf, provenance, stale, status: 'available', ...extra });
  const details = row?.details && typeof row.details === 'object' ? row.details : {};
  const aqi = finite(row?.aqi);
  const pollutant = typeof details.dominant_pollutant === 'string' ? details.dominant_pollutant.slice(0, 20) : undefined;
  const uv = finite(row?.uv_index);
  const pollen = row ? pollenValue(row.pollen_level) : null;
  const mold = typeof row?.mold_risk === 'string' && row.mold_risk ? row.mold_risk.slice(0, 40) : null;
  return [
    item('air', 'Outdoor air', aqi === null ? null : `${aqi} AQI`, 'Outdoor air near your home, not indoor air or smoke detection', airProvenance(row?.aqi_source),
      aqi === null ? {} : { numericValue: aqi, unit: 'AQI', ...(pollutant ? { pollutant } : {}) }),
    item('uv', 'Sunlight', uv === null ? null : `${uv} UV index`, 'Outdoor UV forecast for that day, not a work-time recommendation', 'Forecast'),
    item('pollen', 'Pollen forecast', pollen, 'Outdoor category forecast, not an allergy diagnosis', 'Forecast'),
    item('weather', 'Outdoor mold estimate', mold === null ? null : `${mold} outdoor mold risk`, 'Weather-based outdoor estimate, not an indoor humidity or mold measurement', 'Weather-based estimate'),
  ];
}

/** The workspace part, from the four collections' rows for the current home (`homeId`, or null). */
export function workspaceEvidence(collections, homeId) {
  const owned = (row) => homeId === null || row?.homeContextId === homeId;
  const gardens = (collections.gardens ?? []).filter(owned);
  const observations = (collections.observations ?? []).filter(owned);
  const assets = (collections.assets ?? []).filter((row) => owned(row) && row.status !== 'replaced' && row.factor === 'pfas');
  const contexts = new Set([homeId, ...gardens.map((row) => row.id)].filter(Boolean));
  const tests = (collections.tests ?? []).filter((row) => row.archived !== true && row.review === 'needs_clarification' && (homeId === null || contexts.has(row.contextId)));
  const known = (value) => typeof value === 'string' && value.trim() !== '' && !/unknown|not supplied|not known/i.test(value);
  const items = [
    ...gardens.map((row) => ({ id: `workspace:gardens:${row.id}:${row.revision}`, topic: 'garden', label: 'Garden site in Homeguard', value: known(row.irrigation) ? 'Watering source recorded' : 'Watering source not recorded', scope: 'Your garden record, not confirmed soil or crop conditions', asOf: 'Recorded by you', provenance: 'User-entered', stale: false, status: known(row.irrigation) ? 'available' : 'unknown' })),
    ...observations.map((row) => ({ id: `workspace:observations:${row.id}:${row.revision}`, topic: 'moisture', label: 'Indoor observation in Homeguard', value: row.reading ? 'A reading you recorded' : 'An observation you recorded', scope: row.reading ? 'Your indoor reading with its stated instrument, not verified by HALO' : 'Your observation, not an indoor mold measurement', asOf: day(row.observedAt) ?? 'Date not recorded', provenance: 'User-entered', stale: false, status: 'available' })),
    ...assets.map((row) => ({ id: `workspace:assets:${row.id}:${row.revision}`, topic: 'filter', label: 'Water filter in Homeguard', value: known(row.model) ? 'Product model recorded' : 'Product model not recorded', scope: 'Your care record, not certification or a tap-water result', asOf: day(row.serviced) ?? day(row.installed) ?? 'Date not recorded', provenance: 'User-entered', stale: false, status: known(row.model) ? 'available' : 'unknown' })),
    ...tests.map((row) => ({ id: `workspace:tests:${row.id}:${row.revision}`, topic: 'test', label: 'Test report in Homeguard', value: 'Report needs clarification', scope: 'An unclear report you recorded, not interpreted environmental evidence', asOf: day(row.collectionStart) ?? 'Date not recorded', provenance: 'User-entered report', stale: false, status: 'unknown' })),
  ];
  return items.slice(0, MAX_WORKSPACE_ITEMS);
}

const WORKSPACE_PARTS = ['gardens', 'observations', 'assets', 'tests'];

/**
 * Everything, read best effort. `db` is the service-role client; `home` the
 * current home context or null; `workspace` whether the workspace flag is on.
 * Returns `{ evidence, state, renter }`. `log(part, error)` hears each part
 * that could not be read (the route logs the code only).
 */
export async function gatherProjectEvidence(db, { profileId, home, today, workspace, log = () => {} }) {
  let profile = null;
  try {
    const { data, error } = await db.from('profiles').select('state, water_source, home_year, build_year, renter_mode').eq('id', profileId).maybeSingle();
    if (error) throw error;
    profile = data ?? null;
  } catch (error) {
    log('profile', error);
  }

  let reading = null;
  try {
    const { data, error } = await db
      .from('daily_scores')
      .select('date, aqi, aqi_source, uv_index, pollen_level, mold_risk, details, home_context_id')
      .eq('profile_id', profileId)
      .gte('date', addDays(today, -6))
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    // Readings from an earlier home never describe this one.
    reading = (data ?? []).find((row) => !home || row.home_context_id == null || row.home_context_id === home.id) ?? null;
  } catch (error) {
    log('today', error);
  }

  let rows = {};
  if (workspace) {
    try {
      rows = await readWorkspaceCollections(db, profileId, WORKSPACE_PARTS);
    } catch (error) {
      log('workspace', error);
    }
  }

  const evidence = [...todayEvidence(reading, today), ...homeEvidence({ home, profile }), ...workspaceEvidence(rows, home?.id ?? null)].slice(0, MAX_EVIDENCE);
  return {
    evidence,
    state: home?.state ?? profile?.state ?? null,
    renter: typeof profile?.renter_mode === 'boolean' ? profile.renter_mode : null,
  };
}
