/**
 * Where HALO's numbers come from (§16.4 Settings → About, §15.6 health card;
 * punch list v3 item 20). Pure.
 *
 * last_retrieved is when HALO last got data from that source for this
 * household (readings) or loaded the dataset (reference data). A source with no
 * known retrieval time reports null, never a guessed date.
 */
const iso = (t) => {
  if (!t) return null;
  const s = String(t);
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function latest(rows, pick) {
  let best = null;
  for (const r of rows || []) {
    if (!pick(r)) continue;
    const t = iso(r.created_at);
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

/**
 * @param {object} p
 * @param {Array<{created_at, aqi_source, uv_index, pollen_level, mold_risk}>} p.readings this household's recent daily_scores
 * @param {string|null} p.waterDataLoadedAt  newest ucmr5_utilities.created_at
 * @param {string|null} p.waterGeoAt        shared geography cache refresh time
 * @param {string|null} p.leadInventoryRetrieved
 * @param {string|null} p.learnRetrieved
 */
export function buildSources({ readings = [], waterDataLoadedAt = null, waterGeoAt = null, leadInventoryRetrieved = null, learnRetrieved = null }) {
  const hasPollen = (r) => {
    try {
      const p = JSON.parse(r.pollen_level || '{}');
      return [p.tree, p.grass, p.weed].some((v) => typeof v === 'number');
    } catch {
      return false;
    }
  };
  return {
    sources: [
      { name: 'AirNow (EPA)', provides: 'Measured air quality from monitoring stations', last_retrieved: latest(readings, (r) => r.aqi_source === 'airnow') },
      { name: 'Open-Meteo', provides: 'Modeled air quality where no monitor is nearby, UV index, and recent history', last_retrieved: latest(readings, (r) => r.aqi_source === 'open-meteo' || typeof r.uv_index === 'number') },
      { name: 'Google Pollen', provides: 'Tree, grass, and weed pollen levels', last_retrieved: latest(readings, hasPollen) },
      { name: 'National Weather Service', provides: 'Humidity and rain forecasts for the mold estimate; flood and heat advisories', last_retrieved: latest(readings, (r) => typeof r.mold_risk === 'string') },
      { name: 'EPA UCMR 5', provides: 'Drinking water test results for public water systems', last_retrieved: iso(waterDataLoadedAt) },
      { name: 'EPA Water System Service Area Boundaries', provides: 'Which utility serves an address; map locations and population served', last_retrieved: iso(waterGeoAt) },
      { name: 'EPA Map of Radon Zones', provides: 'County radon zones (North Carolina)', last_retrieved: null },
      { name: 'NC DEQ Lead Service Line Inventory', provides: "Your utility's reported lead and galvanized service lines", last_retrieved: iso(leadInventoryRetrieved) },
      { name: 'EPA, CDC, ATSDR, AirNow guidance', provides: 'The explanations and protective steps in Learn', last_retrieved: iso(learnRetrieved) },
      { name: 'Mapbox', provides: 'Turning your address into approximate coordinates (the address itself is not kept)', last_retrieved: null },
    ],
  };
}
