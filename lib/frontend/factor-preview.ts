/** Editable design fixtures. Never use these numbers as a live scoring adapter. */
export const factorKeys = ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'] as const;
export type FactorKey = typeof factorKeys[number];
export type TrendPoint = { date: string; label: string; value: number | null };
export type FactorDetails = {
  air?: { aqi: number; pollutant: string; pollutantName: string; explanation: string };
  uv?: { peak_window: { start: string; end: string; max: number } | null };
  pollen?: { categories: { name: string; value: number | null; severity: string }[] };
  mold?: { humidity_pct: number | null; precip_pct: number | null };
  water?: { sampleDate: string; rows: { name: string; value_ppt: number; limit_ppt: number | null; severity: string; exceeds_limit: boolean }[]; lithium_ug_l: number | null };
  radon?: { zone: number; county: string };
  lead?: { home_year: number | null };
};
export type FactorReading = {
  key: FactorKey;
  title: string;
  shortTitle: string;
  score: number | null;
  severity: string;
  reading: string;
  unit: string;
  provenance: 'measured' | 'modeled' | 'estimate' | null;
  source: string;
  asOf: string;
  sentence: string;
  detail: string;
  why: string | null;
  householdNote: string | null;
  trend: TrendPoint[];
  trendTitle: string;
  trendCaption: string;
  context: Record<string, string | number>;
  details: FactorDetails;
};
import type { MotionMode, SceneTime } from './scene-clock';
export type PreviewPreferences = { appearance?: string; scale?: string; motion?: MotionMode; time?: SceneTime; contrast?: boolean };
export function readPreviewPreferences(params: Record<string, string | string[] | undefined>): PreviewPreferences {
  return {
    appearance: typeof params.appearance === 'string' && ['light', 'dark', 'system'].includes(params.appearance) ? params.appearance : 'system',
    scale: typeof params.scale === 'string' && ['100', '115', '130', '150'].includes(params.scale) ? params.scale : '100',
    motion: params.motion === 'true' || params.motion === 'reduce' ? 'reduce' : params.motion === 'full' ? 'full' : 'system',
    time: typeof params.time === 'string' && ['dawn', 'day', 'dusk', 'night'].includes(params.time) ? params.time as SceneTime : 'live',
    contrast: params.contrast === 'true',
  };
}
export function isFactorKey(value: unknown): value is FactorKey {
  return typeof value === 'string' && factorKeys.some(key => key === value);
}
export function factorColor(key: FactorKey) { return `var(--factor-${key})`; }
const week = (values: (number | null)[]): TrendPoint[] => values.map((value, i) => ({ date: `2026-09-${24 + i}`, label: ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'][i], value }));

export const factorReadings: Record<FactorKey, FactorReading> = {
  air: {
    key: 'air', title: 'Air quality', shortTitle: 'Air', score: 88, severity: 'good', reading: '37', unit: 'AQI', provenance: 'measured', source: 'AirNow', asOf: 'September 30, 2026, 10:00am',
    sentence: 'Air quality is good in this sample reading.', detail: 'AQI follows the single worst pollutant, not an average. The monitoring station describes outdoor air nearby, not the air inside your home.',
    why: 'The sample AQI is 37, measured at a nearby monitoring station. Fine particles are the dominant pollutant.', householdNote: null,
    trend: week([42, 55, 48, null, 31, 40, 37]), trendTitle: 'A week of outdoor air', trendCaption: 'The latest AQI is 37. Sunday has no reading, so the line stops at that gap.',
    context: { source: 'airnow', value: 37, severity: 'good', pollutant: 'PM2.5' },
    details: { air: { aqi: 37, pollutant: 'PM2.5', pollutantName: 'Fine particles', explanation: 'Smoke, traffic, and industry can produce fine particles that reach deep into the lungs.' } },
  },
  uv: {
    key: 'uv', title: 'UV index', shortTitle: 'UV', score: 64, severity: 'moderate', reading: '5.2', unit: 'UV index', provenance: null, source: 'Open-Meteo', asOf: 'September 30, 2026 forecast',
    sentence: 'Plan some shade into your afternoon.', detail: 'The UV index describes sunburn-causing radiation. Cloud cover alone does not tell you how much UV reaches the ground.',
    why: 'The sample UV index is 5.2. The forecast reaches UV 3 or higher from 11am to 3pm, with a daily maximum of 7.4.', householdNote: null,
    trend: week([4.1, 6.2, 5.8, 3.4, 4.8, 6.1, 5.2]), trendTitle: 'Your UV week', trendCaption: 'The sample index is lower than yesterday. Day-to-day values do not describe every hour of exposure.',
    context: { value: 5.2, severity: 'moderate', peak_start: '11:00', peak_end: '15:00' },
    details: { uv: { peak_window: { start: '11:00', end: '15:00', max: 7.4 } } },
  },
  pollen: {
    key: 'pollen', title: 'Pollen', shortTitle: 'Pollen', score: 56, severity: 'elevated', reading: '3', unit: 'Grass index', provenance: null, source: 'Google Pollen', asOf: 'September 30, 2026 forecast',
    sentence: 'Grass is the leading pollen category in this sample.', detail: 'Tree, grass, and weed pollen can move differently. Each category retains its own reading and severity, so the leading category does not hide the others.',
    why: 'Grass has the highest sample index at 3. Tree pollen is 1 and weed pollen is 2.', householdNote: null,
    trend: week([2, 2, 3, 4, 2, 3, 3]), trendTitle: 'The leading pollen each day', trendCaption: 'This line follows the highest category for each day. It is not a continuous count of one pollen species.',
    context: { value: 3, category: 'Grass', severity: 'elevated' },
    details: { pollen: { categories: [{ name: 'Tree', value: 1, severity: 'good' }, { name: 'Grass', value: 3, severity: 'elevated' }, { name: 'Weed', value: 2, severity: 'moderate' }] } },
  },
  mold: {
    key: 'mold', title: 'Mold conditions', shortTitle: 'Mold', score: 85, severity: 'moderate', reading: 'Estimate', unit: 'Weather based', provenance: 'estimate', source: 'Open-Meteo weather forecast', asOf: 'September 30, 2026 forecast',
    sentence: 'Moist weather makes it worth watching damp spaces.', detail: 'This is an estimate based on humidity and rainfall forecasts, not a sensor in your home. Outdoor forecast humidity is not a measurement of indoor humidity.',
    why: 'The sample forecast has 76% humidity and a 55% chance of rain. These describe conditions favorable to mold, not detected mold.', householdNote: null,
    trend: [], trendTitle: 'Conditions, not a mold count', trendCaption: 'HALO does not collect indoor mold measurements. A historical mold chart is not available for this view.',
    context: { risk: 'moderate', humidity: 76, precip: 55, severity: 'moderate' },
    details: { mold: { humidity_pct: 76, precip_pct: 55 } },
  },
  pfas: {
    key: 'pfas', title: 'PFAS in water', shortTitle: 'PFAS', score: 42, severity: 'high', reading: '8.3', unit: 'ppt PFOS', provenance: 'measured', source: 'EPA UCMR 5, sample utility', asOf: 'Sample collected March 2025',
    sentence: 'One sample compound is above its comparison limit.', detail: 'PFAS results come from public utility testing. They are not a test of your tap or a live reading of what you drank today. Parts per trillion is abbreviated ppt.',
    why: 'The sample utility result for PFOS is 8.3 ppt, about 2.1 times the supplied limit of 4.0 ppt.', householdNote: 'Sample household context: filtered water for drinking and formula matters especially when young children or pregnancy are part of the household.',
    trend: [
      { date: '2024-06-01', label: 'Jun 24', value: 9.2 }, { date: '2024-09-01', label: 'Sep 24', value: 8.8 },
      { date: '2024-12-01', label: 'Dec 24', value: 8.5 }, { date: '2025-03-01', label: 'Mar 25', value: 8.3 },
    ], trendTitle: 'PFOS across sample dates', trendCaption: 'These are separate utility samples. Connecting them shows the sequence, not a continuous water measurement.',
    context: { contaminant: 'PFOS', value: 8.3, limit: 4, severity: 'high' },
    details: { water: { sampleDate: 'March 2025', rows: [{ name: 'PFOS', value_ppt: 8.3, limit_ppt: 4, severity: 'high', exceeds_limit: true }, { name: 'PFOA', value_ppt: 2, limit_ppt: 4, severity: 'good', exceeds_limit: false }, { name: 'PFHxS', value_ppt: 1.2, limit_ppt: 10, severity: 'good', exceeds_limit: false }], lithium_ug_l: 25 } },
  },
  radon: {
    key: 'radon', title: 'Radon', shortTitle: 'Radon', score: 80, severity: 'moderate', reading: 'Zone 2', unit: 'County estimate', provenance: 'estimate', source: 'EPA county radon zones', asOf: 'County classification, not a current test',
    sentence: 'Your county is a starting point. Your home needs its own test.', detail: 'County zones estimate potential across an area. A home in a lower-potential zone can still have an elevated result. The background scenery is decorative, not a survey of your property.',
    why: 'The sample county, Iredell, is Zone 2. That is a county estimate and cannot determine the concentration inside a home.', householdNote: null,
    trend: [], trendTitle: 'A test gives you the missing number', trendCaption: 'No measured home radon series is available. Showing a daily trend here would imply measurements HALO does not have.',
    context: { county: 'Iredell', zone: 2, severity: 'moderate' },
    details: { radon: { zone: 2, county: 'Iredell' } },
  },
  lead: {
    key: 'lead', title: 'Lead in plumbing', shortTitle: 'Lead', score: null, severity: 'elevated', reading: '1975', unit: 'Home built', provenance: 'estimate', source: 'Home age provided during setup', asOf: 'A building-era estimate',
    sentence: 'Your home’s age suggests that a water test is worth considering.', detail: 'Age is a clue about possible plumbing materials, not proof that lead is present. Lead is shown separately and is not included in the Homeguard score.',
    why: 'This sample home was built in 1975. Older pipes, solder, or fixtures may affect water after it leaves the utility.', householdNote: null,
    trend: [], trendTitle: 'From building age to an actual answer', trendCaption: 'There is no measured lead reading or numeric lead score. A laboratory test would provide information that building age cannot.',
    context: { home_year: 1975, severity: 'elevated' },
    details: { lead: { home_year: 1975 } },
  },
};

export const personalFactorKeys: FactorKey[] = ['air', 'uv', 'pollen', 'mold'];
export const homeFactorKeys: FactorKey[] = ['pfas', 'radon', 'lead'];
// Relative sample contributions for Today only. The ring normalizes these four
// values to 100%. PFAS is exclusively a Homeguard factor.
export const previewRiskShares: Partial<Record<FactorKey, number>> = { air: 12, uv: 28, pollen: 14, mold: 8 };

/** Boundary for the future live adapter. No endpoint is called from a design preview.
 * Today uses the daily-score API's four factors, never Homeguard's PFAS result.
 * Display scores here remain illustrative fixtures, not a new scoring formula.
 * Never turn a null risk or an unscoreable water result into a score of 100.
 */
export const factorApiBindings = {
  air: { reading: '/api/daily-score', score: 'score.inputs.air (risk, not display score)', history: 'history[].values.aqi', learn: 'air' },
  uv: { reading: '/api/daily-score', score: 'score.inputs.uv (risk, not display score)', history: 'history[].values.uv_index', learn: 'uv' },
  pollen: { reading: '/api/daily-score', score: 'score.inputs.pollen (risk, not display score)', history: 'max of available history[].values.pollen.tree/grass/weed', learn: 'pollen' },
  mold: { reading: '/api/daily-score', score: 'score.inputs.mold (capped estimate)', history: null, learn: 'mold' },
  pfas: { reading: '/api/home-guard', score: 'breakdown water score, only when scoreable', history: 'water.contaminants per-compound samples with date_iso', learn: 'pfas' },
  radon: { reading: '/api/home-guard', score: 'breakdown radon score', history: null, learn: 'radon' },
  lead: { reading: '/api/home-guard', score: null, history: null, learn: 'lead' },
} as const;
