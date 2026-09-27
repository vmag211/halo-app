/**
 * Water-system geography: service-area centroid + population served (§13, §20).
 *
 * UCMR5 carries no coordinates or population, so they are joined by PWSID from
 * the same EPA/state Water System Boundaries FeatureServer that onboarding
 * already queries point-in-polygon. Here it is queried the other direction: by
 * PWSID, asking only for the attribute fields plus the polygon's centroid
 * (never the heavy polygon itself).
 *
 * The request/response handling is pure and unit-tested; `fetchWaterGeo` takes
 * an injectable fetch. `getWaterGeo` adds a 24-hour in-memory cache — service
 * areas and population counts change on the scale of years, and the map and
 * district routes would otherwise fan out to ArcGIS on every request.
 *
 * Failure is partial, never fatal: a batch that fails is simply missing from the
 * result, and callers keep lat/lng/population null for those systems (the same
 * honest "unknown" they had before this join existed).
 */

export const ARCGIS_WATER_BOUNDARIES =
  'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query';

export const POPULATION_SOURCE =
  'EPA Community Water System Service Area Boundaries (Population_Served_Count)';

// PWSIDs are a two-letter state code plus digits. Anything else is dropped
// before it reaches the where clause, so a malformed id can't alter the query.
const PWSID_RE = /^[A-Z]{2}[0-9]{5,9}$/;

export function validPwsids(pwsids) {
  return [...new Set((pwsids || []).filter((p) => typeof p === 'string' && PWSID_RE.test(p)))];
}

/** Query-string for one batch of PWSIDs. */
export function geoQueryParams(pwsids) {
  const ids = validPwsids(pwsids);
  return new URLSearchParams({
    where: `PWSID IN (${ids.map((p) => `'${p}'`).join(',')})`,
    outFields: 'PWSID,Population_Served_Count',
    returnGeometry: 'false',
    returnCentroid: 'true',
    outSR: '4326', // WGS84 lat/lng
    f: 'json',
  });
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * ArcGIS JSON → Map<pwsid, {lat, lng, population}>. A system can appear as
 * several polygons; the first one with a centroid supplies the point, and the
 * largest reported population wins (they normally agree).
 */
export function parseGeoResponse(json) {
  const out = new Map();
  for (const f of json?.features || []) {
    const pwsid = f?.attributes?.PWSID;
    if (typeof pwsid !== 'string') continue;
    const lat = num(f?.centroid?.y);
    const lng = num(f?.centroid?.x);
    const pop = num(f?.attributes?.Population_Served_Count);
    const prev = out.get(pwsid);
    if (!prev) {
      out.set(pwsid, { lat, lng, population: pop !== null && pop >= 0 ? pop : null });
      continue;
    }
    if (prev.lat === null && lat !== null) Object.assign(prev, { lat, lng });
    if (pop !== null && pop >= 0 && (prev.population === null || pop > prev.population)) prev.population = pop;
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Look up many PWSIDs, in batches, in parallel.
 * @returns {Promise<{geo: Map, requested: number, found: number, failedBatches: number}>}
 */
export async function fetchWaterGeo(pwsids, { fetchImpl = fetch, batchSize = 100, url = ARCGIS_WATER_BOUNDARIES } = {}) {
  const ids = validPwsids(pwsids);
  const geo = new Map();
  let failedBatches = 0;
  await Promise.all(
    chunk(ids, batchSize).map(async (batch) => {
      try {
        const res = await fetchImpl(`${url}?${geoQueryParams(batch)}`);
        if (!res.ok) throw new Error(`ArcGIS ${res.status}`);
        const json = await res.json();
        if (json?.error) throw new Error(json.error.message || 'ArcGIS error');
        for (const [k, v] of parseGeoResponse(json)) geo.set(k, v);
      } catch {
        failedBatches += 1;
      }
    }),
  );
  return { geo, requested: ids.length, found: geo.size, failedBatches };
}

/** Fill lat/lng/population on features that carry a `pwsid`; unknown stays null. */
export function withGeo(features, geo) {
  return (features || []).map((f) => {
    const g = geo?.get?.(f.pwsid);
    return {
      ...f,
      lat: g?.lat ?? null,
      lng: g?.lng ?? null,
      population: g?.population ?? null,
    };
  });
}

// --- Caching: memory (per instance, 24h) → shared store (Redis, 7d) → ArcGIS --
//
// The ArcGIS lookup for ~290 systems takes 15–25s (smaller batches get
// throttled and fail), which is too slow for a request path. So the result is
// kept in Upstash Redis (already provisioned for rate limiting), shared by every
// server instance, and the daily cron refreshes it with `force: true`. A user
// request only reaches ArcGIS if both caches miss — e.g. Redis is down.

const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORE_TTL_S = 7 * 24 * 60 * 60;
export const STORE_KEY = 'halo:water-geo:v1';

let memory = null; // { at, key, geo }

// A short fingerprint of the PWSID set, so a cached entry is only reused for
// the same set of systems.
function fingerprint(ids) {
  let h = 5381;
  const s = ids.join(',');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${ids.length}:${h.toString(36)}`;
}

let defaultStore; // undefined = not resolved yet; null = no Redis configured
async function resolveDefaultStore() {
  if (defaultStore !== undefined) return defaultStore;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    defaultStore = null;
    return null;
  }
  const { Redis } = await import('@upstash/redis');
  defaultStore = Redis.fromEnv();
  return defaultStore;
}

const summary = (geo, ids, source, failedBatches = 0) => ({
  geo,
  requested: ids.length,
  found: geo.size,
  failedBatches,
  source,
  cached: source !== 'arcgis',
});

/**
 * Cached lookup.
 * @param {string[]} pwsids
 * @param {{force?:boolean, now?:number, store?:{get:Function,set:Function}|null,
 *          fetchImpl?:Function, batchSize?:number}} [opts]
 *   `force` skips both caches and refreshes them (the daily cron's warm-up).
 *   `store` overrides the Redis client (null = no shared cache), for tests.
 * @returns {Promise<{geo:Map, requested:number, found:number, failedBatches:number,
 *          source:'memory'|'shared'|'arcgis', cached:boolean}>}
 */
export async function getWaterGeo(pwsids, opts = {}) {
  const { force = false } = opts;
  const now = opts.now ?? Date.now();
  const ids = validPwsids(pwsids).sort();
  const key = fingerprint(ids);

  if (!force && memory && memory.key === key && now - memory.at < MEMORY_TTL_MS) {
    return summary(memory.geo, ids, 'memory');
  }

  const store = opts.store !== undefined ? opts.store : await resolveDefaultStore().catch(() => null);

  if (!force && store) {
    try {
      const hit = await store.get(STORE_KEY);
      if (hit && hit.key === key && Array.isArray(hit.entries)) {
        const geo = new Map(hit.entries);
        memory = { at: now, key, geo };
        return summary(geo, ids, 'shared');
      }
    } catch {
      /* shared cache unavailable — fall through to ArcGIS */
    }
  }

  const result = await fetchWaterGeo(ids, opts);
  // A lookup with failed batches is never cached, so the next request retries
  // instead of pinning a partial result.
  if (result.failedBatches === 0) {
    memory = { at: now, key, geo: result.geo };
    if (store) {
      try {
        await store.set(STORE_KEY, { key, at: now, entries: [...result.geo] }, { ex: STORE_TTL_S });
      } catch {
        /* best effort */
      }
    }
  }
  return summary(result.geo, ids, 'arcgis', result.failedBatches);
}

/** Test hook. */
export function _resetWaterGeoCache() {
  memory = null;
}

/**
 * One system's centroid + population, for a single-utility response (HomeGuard,
 * the advocacy letter). Reads the caches without disturbing them: calling
 * getWaterGeo with one PWSID would replace the statewide cache entry with a
 * one-system entry. Falls back to a direct one-system query, uncached.
 * @returns {Promise<{lat,lng,population}|null>}
 */
export async function lookupWaterGeoOne(pwsid, opts = {}) {
  const [id] = validPwsids([pwsid]);
  if (!id) return null;
  if (memory?.geo?.has(id)) return memory.geo.get(id);
  const store = opts.store !== undefined ? opts.store : await resolveDefaultStore().catch(() => null);
  if (store) {
    try {
      const hit = await store.get(STORE_KEY);
      if (hit && Array.isArray(hit.entries)) {
        const found = hit.entries.find(([k]) => k === id);
        if (found) return found[1];
      }
    } catch {
      /* fall through */
    }
  }
  const r = await fetchWaterGeo([id], opts);
  return r.geo.get(id) ?? null;
}
