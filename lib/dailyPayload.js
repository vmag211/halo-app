/**
 * The /api/daily-score response, built from readings (§11.6; punch list v3
 * items 3, 4, 9). Pure and unit-tested.
 *
 * Additive-only: every field the route returned before is still here with the
 * same name. New: severity on the composite, air.dominant_pollutant,
 * uv.peak_window, pollen.categories, mold.basis, retrieved_at, and
 * score.factor_scores (air, uv, pollen card scores; mold null, see
 * score.factor_score_exclusions). Cached rows get them too: they are computed
 * from the stored readings, so no column holds them.
 *
 * Missing stays missing. Mold used to display 'low' when NWS failed; it is now
 * null / no_data and listed in score.missing_inputs, so a total outage produces
 * no score (with a reason) instead of a near-perfect one.
 */
import { getAirRisk, getUvRisk, getPollenRisk, getMoldRisk, getDashboardScore } from './scoring.js';
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity, compositeSeverity } from './severity.js';
import { explain } from './explain.js';

// Legacy status words, kept for compatibility (the frontend now binds severity).
function getAirStatus(aqi) {
  if (aqi === null || aqi === undefined) return 'unknown';
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  return 'unhealthy';
}

function getUvStatus(uvIndex) {
  if (uvIndex === null || uvIndex === undefined) return 'unknown';
  if (uvIndex <= 2) return 'low';
  if (uvIndex <= 5) return 'moderate';
  if (uvIndex <= 7) return 'high';
  return 'very_high';
}

function getPollenStatus(pollen) {
  const values = [pollen.tree, pollen.grass, pollen.weed].filter((v) => v !== null && v !== undefined);
  if (values.length === 0) return 'none';
  const maxVal = Math.max(...values);
  if (maxVal <= 2) return 'low';
  if (maxVal <= 3) return 'moderate';
  return 'high';
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The composite, with missing inputs passed as null so they're excluded, not zeroed. */
export function buildDashboardScore({ aqi, uvIndex, pollen, moldRisk }) {
  const airRisk = getAirRisk(aqi);
  const uvRisk = getUvRisk(uvIndex);
  const pollenRiskValue = getPollenRisk(pollen.tree ?? null, pollen.grass ?? null, pollen.weed ?? null);
  const moldRiskValue = getMoldRisk(moldRisk);
  const composite = getDashboardScore({ airRisk, uvRisk, pollenRisk: pollenRiskValue, moldRisk: moldRiskValue });
  return {
    ...composite,
    is_measured: false,
    is_estimate: true,
    inputs: { air: airRisk, uv: uvRisk, pollen: pollenRiskValue, mold: moldRiskValue },
    factor_scores: {
      air: factorScore(airRisk),
      uv: factorScore(uvRisk),
      pollen: factorScore(pollenRiskValue),
      mold: null,
    },
    // Why a factor has no card score although it may have a reading. Mold is a
    // capped weather estimate (MOLD_RISK_MAX), so it is shown as an estimate.
    factor_score_exclusions: { mold: 'weather_estimate' },
  };
}

/**
 * A factor's card score: round(100 - its risk), 0 to 100, higher is better,
 * the composite's convention (Vibhav, 2026-10-21). Null when the input is
 * missing, never 100.
 */
export function factorScore(risk) {
  if (!finite(risk)) return null;
  return Math.round(100 - Math.min(100, Math.max(0, risk)));
}

/** Normalise a DB timestamp that may lack a zone (stored as UTC) to ISO-8601. */
export function toIsoUtc(ts) {
  if (!ts) return null;
  const s = String(ts);
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * @param {object} p
 * @param {number|null} p.aqi
 * @param {number|null} p.uvIndex
 * @param {{tree,grass,weed}} p.pollen
 * @param {{risk:string|null, basis:object|null}} p.mold
 * @param {string|null} [p.aqiSource]
 * @param {boolean|null} [p.aqiIsMeasured]
 * @param {string|null} [p.dominantPollutant]
 * @param {object|null} [p.uvPeakWindow]
 * @param {boolean} p.cached
 * @param {string} p.retrievedAt ISO time the readings were fetched
 * @param {object} [p.bands] household composition (wording only, §8.2)
 */
export function formatDailyPayload(p) {
  const pollen = p.pollen || { tree: null, grass: null, weed: null };
  const moldRisk = p.mold?.risk ?? null;

  const airSev = aqiSeverity(p.aqi);
  const uvSev = uvSeverity(p.uvIndex);
  const cats = [['tree', pollen.tree], ['grass', pollen.grass], ['weed', pollen.weed]].filter(([, v]) => finite(v));
  const dominant = cats.length ? cats.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  const pollenSev = pollenSeverity(dominant ? dominant[1] : null);
  const moldSev = moldSeverity(moldRisk);
  const bands = p.bands || {};

  const score = buildDashboardScore({ aqi: p.aqi, uvIndex: p.uvIndex, pollen, moldRisk });
  score.severity = compositeSeverity(score, { air: airSev, uv: uvSev, pollen: pollenSev, mold: moldSev });

  const category = (v) => ({ value: finite(v) ? v : null, severity: pollenSeverity(finite(v) ? v : null) });

  return {
    air: {
      aqi: p.aqi ?? null,
      status: getAirStatus(p.aqi),
      source: p.aqiSource ?? null,
      is_measured: p.aqiIsMeasured ?? null,
      // The pollutant that set the AQI: "PM2.5" · "PM10" · "O3", else null.
      dominant_pollutant: p.aqi === null || p.aqi === undefined ? null : p.dominantPollutant ?? null,
      severity: airSev,
      sentence: explain('air', airSev, bands),
    },
    uv: {
      index: p.uvIndex ?? null,
      status: getUvStatus(p.uvIndex),
      // Local "HH:MM" window where UV ≥ 3 today, or null if it never gets there.
      peak_window: p.uvPeakWindow ?? null,
      severity: uvSev,
      sentence: explain('uv', uvSev, bands),
    },
    pollen: {
      tree: pollen.tree ?? null,
      grass: pollen.grass ?? null,
      weed: pollen.weed ?? null,
      status: getPollenStatus(pollen),
      dominant: dominant ? dominant[0] : null,
      categories: { tree: category(pollen.tree), grass: category(pollen.grass), weed: category(pollen.weed) },
      severity: pollenSev,
      sentence: explain('pollen', pollenSev, bands),
    },
    mold: {
      risk: moldRisk,
      is_proxy: true,
      // The NWS values the estimate used; null when there was no estimate.
      basis: p.mold?.basis ?? null,
      severity: moldSev,
      sentence: explain('mold', moldSev, bands),
    },
    score,
    retrieved_at: p.retrievedAt ?? null,
    cached: p.cached === true,
  };
}
