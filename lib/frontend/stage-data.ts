import type { FactorKey, FactorReading, TrendPoint } from './factor-preview';
import type { DailyResponse, HomeResponse, ProfileResponse } from './types';
import type { HistoryResponse } from './stage-api';
import { dateLabel, finite, isoDate, nonnegative, record, rows, safeText, scoreNumber, severity, textList, timeLabel, timestamp } from './stage-values';

export interface StageOverview {
  score: number | null; severity: string; partial: boolean; missingInputs: string[];
  includedInputs: string[]; asOf: string; contributions: Partial<Record<FactorKey, number | null>>;
  contributionNote: string; notice?: string;
}
export interface StageData { readings: Record<FactorKey, FactorReading>; today: StageOverview; home: StageOverview }
const DAILY_KEYS = ['air', 'uv', 'pollen', 'mold'];
const HOME_KEYS = ['water', 'radon'];
const boundedPollen = (value: unknown) => { const n = nonnegative(value); return n !== null && n <= 5 ? n : null; };
const numberText = (value: number | null) => value === null ? 'No data' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const fieldText = (value: unknown) => safeText(value) || null;
const contributionNote = (contributions: StageOverview['contributions']) => Object.values(contributions).some(value => value !== null && value > 0)
  ? 'Percentages compare the available risk readings, not portions of your final score.'
  : 'Available risk inputs are zero, so there are no contributions to divide.';
function base(key: FactorKey, title: string, shortTitle: string): FactorReading {
  return { key, title, shortTitle, score: null, severity: 'no_data', reading: 'No data', unit: '', provenance: null, source: 'Source unavailable', asOf: 'Update time unavailable', sentence: 'This reading is not available yet.', detail: '', why: null, householdNote: null, trend: [], trendTitle: 'Recent readings', trendCaption: 'Only available readings are shown. Missing days remain gaps.', context: {}, details: {}, disclosures: [] };
}
function context(fields: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value)))) as Record<string, string | number>;
}
function overview(raw: unknown, asOf: unknown, expected: string[], unavailable: string[], forceMissing = false): StageOverview {
  const data = record(raw); const score = forceMissing ? null : scoreNumber(data.display_score);
  // Coverage and inclusion are different claims. An unscoreable water result
  // may be included arithmetically in a capped composite; keep the server's
  // accounting while disclosing that no standalone water score can be shown.
  const missingInputs = Array.isArray(data.missing_inputs) ? textList(data.missing_inputs).filter(key => expected.includes(key)) : unavailable;
  const includedInputs = forceMissing ? [] : textList(data.included_inputs).filter(key => expected.includes(key));
  return {
    score, severity: score === null ? 'no_data' : severity(data.severity),
    partial: score !== null && (data.is_partial === true || missingInputs.length > 0),
    missingInputs, includedInputs, asOf: timeLabel(asOf), contributions: {},
    contributionNote: 'Relative factor contributions are not provided with these readings.',
    ...(safeText(data.reason) ? { notice: safeText(data.reason) } : {}),
  };
}
/** Calendar gaps are explicit. The API has one latest record per local day;
 * charts never interpolate a missing observation or invent a modelled backfill. */
function dailyTrend(history: HistoryResponse | null | undefined, key: 'air' | 'uv' | 'pollen'): TrendPoint[] {
  if (!history) return [];
  const from = isoDate(history.from); const to = isoDate(history.to);
  if (!from || !to || from > to) return [];
  const byDate = new Map(rows(history.history).map(row => [isoDate(row.date), row]));
  const points: TrendPoint[] = [];
  let time = Date.parse(`${from}T12:00:00Z`); const end = Date.parse(`${to}T12:00:00Z`);
  for (let count = 0; time <= end && count < 365; time += 86400000, count++) {
    const date = new Date(time).toISOString().slice(0, 10);
    const values = record(byDate.get(date)?.values);
    const pollen = record(values.pollen);
    const available = [pollen.tree, pollen.grass, pollen.weed].map(boundedPollen).filter((value): value is number => value !== null);
    const value = key === 'air' ? nonnegative(values.aqi) : key === 'uv' ? nonnegative(values.uv_index) : available.length ? Math.max(...available) : null;
    points.push({ date, label: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(time)), value });
  }
  return points;
}
function sampleTrend(raw: unknown): TrendPoint[] {
  const dated = rows(raw).flatMap(row => { const date = isoDate(row.date_iso); const value = nonnegative(row.value_ppt); return date && value !== null ? [{ date, label: dateLabel(date), value }] : []; });
  const byDate = new Map<string, TrendPoint>();
  for (const point of dated) { const previous = byDate.get(point.date); if (!previous || point.value > (previous.value ?? -1)) byDate.set(point.date, point); }
  return byDate.size < 2 ? [] : [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
/** Map actual route payloads into the approved presentation. No fixtures,
 * guessed readings, risk inversion, or frontend severity thresholds enter here. */
export function buildStageData(daily: DailyResponse | null, home: HomeResponse | null, profile: ProfileResponse | null, history?: HistoryResponse | null): StageData {
  const dailyData = record(daily); const homeData = record(home); const location = record(profile?.profile);
  const air = record(dailyData.air); const uv = record(dailyData.uv); const pollen = record(dailyData.pollen); const mold = record(dailyData.mold);
  const water = record(homeData.water); const radon = record(homeData.radon); const lead = record(homeData.lead);
  const breakdown = rows(homeData.breakdown);
  const waterBox = breakdown.find(row => row.key === 'water') ?? {};
  const radonBox = breakdown.find(row => row.key === 'radon') ?? {};
  const dailyAsOf = timeLabel(dailyData.retrieved_at);
  const readings: Record<FactorKey, FactorReading> = {
    air: base('air', 'Air quality', 'Air'), uv: base('uv', 'UV index', 'UV'), pollen: base('pollen', 'Pollen', 'Pollen'), mold: base('mold', 'Mold conditions', 'Mold'),
    pfas: base('pfas', 'PFAS in water', 'PFAS'), radon: base('radon', 'Radon', 'Radon'), lead: base('lead', 'Lead in plumbing', 'Lead'),
  };

  const aqi = nonnegative(air.aqi); const pollutant = safeText(air.dominant_pollutant);
  const airSource = air.source === 'airnow' ? 'AirNow' : air.source === 'open-meteo' ? 'Open-Meteo' : 'Source unavailable';
  const airSeverity = aqi === null ? 'no_data' : severity(air.severity);
  const pollutants: Record<string, [string, string]> = {
    'PM2.5': ['Fine particles', 'The AQI reflects the pollutant with the highest index.'],
    PM10: ['Coarse particles', 'The AQI reflects the pollutant with the highest index.'],
    O3: ['Ozone', 'The AQI reflects the pollutant with the highest index.'],
  };
  readings.air = { ...readings.air, reading: aqi === null ? 'No data' : String(Math.round(aqi)), unit: 'AQI', severity: airSeverity, asOf: dailyAsOf, source: airSource,
    provenance: aqi === null ? null : air.is_measured === true ? 'measured' : air.is_measured === false ? 'modeled' : null,
    sentence: aqi === null ? readings.air.sentence : safeText(air.sentence) || 'Your outdoor air reading is available.', detail: 'This describes outdoor air in your area, not the air inside your home.',
    context: context({ value: aqi, severity: aqi === null ? null : airSeverity, source: fieldText(air.source), pollutant: pollutant || null }),
    trend: dailyTrend(history, 'air'), trendTitle: 'A week of outdoor air',
    details: aqi === null ? {} : { air: { aqi, pollutant, pollutantName: pollutants[pollutant]?.[0] ?? (pollutant || 'Dominant pollutant unavailable'), explanation: pollutants[pollutant]?.[1] ?? 'A dominant pollutant is shown only when the source supplies it.' } },
    disclosures: ['A separate air score is not supplied with this reading.', ...(aqi !== null && air.is_measured === false ? ['This is a modeled estimate.'] : [])],
  };

  const uvIndex = nonnegative(uv.index); const uvSeverity = uvIndex === null ? 'no_data' : severity(uv.severity);
  const peak = record(uv.peak_window); const peakMax = nonnegative(peak.max);
  const isClock = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const peakWindow = isClock(peak.start) && isClock(peak.end) && peakMax !== null ? { start: peak.start, end: peak.end, max: peakMax } : null;
  readings.uv = { ...readings.uv, reading: uvIndex === null ? 'No data' : uvIndex.toFixed(1), unit: 'UV index', severity: uvSeverity, asOf: dailyAsOf, source: 'UV forecast',
    sentence: uvIndex === null ? readings.uv.sentence : safeText(uv.sentence) || 'Your UV forecast is available.', detail: 'The UV index describes outdoor ultraviolet radiation. This reading does not measure individual exposure.',
    context: context({ value: uvIndex, severity: uvIndex === null ? null : uvSeverity, peak_start: peakWindow?.start, peak_end: peakWindow?.end }),
    trend: dailyTrend(history, 'uv'), trendTitle: 'Your UV week', details: { uv: { peak_window: peakWindow } },
    disclosures: ['A separate UV score and the current provider name are not supplied with this reading.'],
  };

  const categories = record(pollen.categories);
  const pollenRows = (['tree', 'grass', 'weed'] as const).map(key => { const category = record(categories[key]); const value = boundedPollen(category.value ?? pollen[key]); return { name: key[0].toUpperCase() + key.slice(1), value, severity: value === null ? 'no_data' : severity(category.severity) }; });
  const dominantIndex = ['tree', 'grass', 'weed'].indexOf(String(pollen.dominant));
  const dominant = dominantIndex >= 0 ? pollenRows[dominantIndex] : null;
  const hasPollen = pollenRows.some(row => row.value !== null);
  readings.pollen = { ...readings.pollen, reading: dominant ? numberText(dominant.value) : hasPollen ? 'See categories' : 'No data', unit: dominant ? `${dominant.name} index` : 'Pollen index',
    severity: hasPollen ? severity(pollen.severity) : 'no_data', asOf: dailyAsOf, source: 'Google Pollen', sentence: hasPollen ? safeText(pollen.sentence) || 'Your pollen category readings are available.' : readings.pollen.sentence,
    detail: 'Tree, grass, and weed retain their own readings. The leading category does not describe every type of pollen.',
    context: context({ value: dominant?.value, severity: hasPollen ? severity(pollen.severity) : null, category: dominant?.name }),
    trend: dailyTrend(history, 'pollen'), trendTitle: 'The leading pollen each day', details: { pollen: { categories: pollenRows } },
    disclosures: ['A separate pollen score is not supplied with this reading.'],
  };

  const moldRisk = ['low', 'moderate', 'high'].includes(String(mold.risk)) ? String(mold.risk) : null;
  const moldBasis = record(mold.basis); const humidity = scoreNumber(moldBasis.humidity_pct); const precip = scoreNumber(moldBasis.precip_pct);
  readings.mold = { ...readings.mold, reading: moldRisk ? 'Estimate' : 'No data', unit: 'Weather estimate', severity: moldRisk ? severity(mold.severity) : 'no_data',
    provenance: moldRisk ? 'estimate' : null, asOf: dailyAsOf, source: 'National Weather Service', sentence: moldRisk ? safeText(mold.sentence) || 'Outdoor weather conditions inform this estimate.' : readings.mold.sentence,
    detail: 'This estimate uses outdoor humidity and rain forecasts. It is not a measurement of mold or humidity inside your home.',
    context: context({ risk: moldRisk, severity: moldRisk ? severity(mold.severity) : null, humidity, precip }),
    trendTitle: 'Conditions, not a mold count', trendCaption: 'No measured indoor mold series is available.', details: { mold: { humidity_pct: humidity, precip_pct: precip } },
    disclosures: ['A separate mold score is not supplied with this estimate.'],
  };

  const privateSource = water.status === 'private_well' || ['well', 'spring'].includes(String(location.water_source));
  const coverage = safeText(water.coverage);
  const waterMeasured = water.is_measured === true && !privateSource;
  const scoreable = waterMeasured && ['complete', 'no_detections', 'excluded_only', 'partial'].includes(coverage);
  const scored = waterMeasured ? rows(water.scored_contaminants).filter(row => nonnegative(row.value_ppt) !== null && safeText(row.contaminant)) : [];
  const enforceable = scored.filter(row => row.is_enforceable === true);
  const pool = enforceable.length ? enforceable : scored;
  const primary = pool.reduce<Record<string, unknown> | null>((top, row) => top === null || (finite(row.risk) ?? -1) > (finite(top.risk) ?? -1) ? row : top, null);
  const compound = safeText(primary?.contaminant); const concentration = nonnegative(primary?.value_ppt);
  const waterSeverity = scoreable ? severity(waterBox.severity) : 'no_data';
  const sampleDate = isoDate(primary?.date_iso) ?? isoDate(water.latest_sample_iso);
  const utility = safeText(water.pws_name);
  const permittedMessage = ['private_well', 'detected_unregulated'].includes(String(water.status)) ? fieldText(water.message) : null;
  const waterStatusCopy: Record<string, string> = {
    lookup_failed: 'Water results could not be loaded. Try again shortly.',
    no_data_yet: 'Published testing results are not available for this utility yet.',
    no_pwsid_available: 'No water utility is matched to this home. Confirm your water source in Settings.',
  };
  const waterDisclosures = [
    'Utility samples are not a test of your tap.',
    ...(privateSource ? ['No measured water result is available for this private supply.'] : []),
    ...(coverage === 'unscoreable' ? ['Detected compounds have no supplied limit or benchmark. No water score is shown.'] : []),
    ...(coverage === 'partial' ? ['Some detected compounds cannot be scored.'] : []),
    ...(coverage === 'excluded_only' ? ['Detections are reported separately and excluded from the score.'] : []),
    ...(water.includes_guidance === true ? ['Some comparisons use nonbinding health benchmarks, not enforceable federal limits.'] : []),
    ...[permittedMessage, water.regulatory_notice].map(fieldText).filter((value): value is string => value !== null),
  ];
  const excluded = rows(water.excluded_from_score); const lithium = excluded.find(row => safeText(row.contaminant).toLowerCase() === 'lithium');
  const lithiumPpt = nonnegative(lithium?.value_ppt);
  readings.pfas = { ...readings.pfas, score: scoreable ? scoreNumber(waterBox.score) : null, severity: waterSeverity,
    reading: waterMeasured && concentration !== null ? numberText(concentration) : privateSource ? 'Not tested' : waterMeasured && coverage === 'no_detections' ? 'No detections' : 'No data',
    unit: compound ? `ppt ${compound}` : 'Utility testing', provenance: waterMeasured ? 'measured' : null, source: utility ? `EPA UCMR 5, ${utility}` : 'EPA UCMR 5',
    asOf: sampleDate ? `Sample collected ${dateLabel(sampleDate)}` : 'Sample date unavailable',
    sentence: permittedMessage ?? waterStatusCopy[String(water.status)] ?? (primary ? `${compound} is shown against its supplied ${primary.is_enforceable === true ? 'federal limit' : primary.is_enforceable === false ? 'health benchmark' : 'comparison value'}.` : privateSource ? 'A testing plan can help you find out what is in this water.' : 'Water results appear when utility testing is available.'),
    detail: 'PFAS results come from utility sampling. Sample dates describe the testing record, not current conditions at your tap.',
    // The present Learn route hard-codes "federal limit". Withhold numeric
    // benchmark context until its contract can distinguish that comparison.
    context: primary?.is_enforceable === true ? context({ contaminant: compound, value: concentration, limit: nonnegative(primary.limit_ppt), severity: waterSeverity }) : {},
    trend: primary && waterMeasured ? sampleTrend(record(water.contaminants)[compound]) : [],
    trendTitle: compound ? `${compound} across sample dates` : 'Utility sample history', trendCaption: 'These are separate utility samples, not continuous water measurements.',
    details: { water: {
      sampleDate: dateLabel(sampleDate),
      rows: privateSource ? [] : scored.map(row => ({ name: safeText(row.contaminant), value_ppt: nonnegative(row.value_ppt)!, limit_ppt: nonnegative(row.limit_ppt), severity: severity(row.severity), exceeds_limit: row.exceeds_limit === true, ...(typeof row.is_enforceable === 'boolean' ? { is_enforceable: row.is_enforceable } : {}), basis: safeText(row.basis), source: safeText(row.source), date_iso: isoDate(row.date_iso), proposed_for_rescission: row.proposed_for_rescission === true })),
      lithium_ug_l: privateSource || lithiumPpt === null ? null : lithiumPpt / 1000,
      coverage, status: safeText(water.status), is_measured: waterMeasured, includes_guidance: water.includes_guidance === true, confidence: safeText(waterBox.confidence),
      detected_unregulated: waterMeasured ? textList(water.detected_unregulated).map(name => {
        const latest = rows(water.detected_unregulated_latest).find(row => row.contaminant === name);
        return { name, value_ppt: nonnegative(latest?.value_ppt), date_iso: isoDate(latest?.date_iso) };
      }) : [],
    } },
    disclosures: waterDisclosures,
  };

  const zone = finite(radon.zone); const hasZone = [1, 2, 3].includes(zone ?? 0) && !radon.error && radon.out_of_state !== true;
  const county = safeText(radon.county, safeText(location.county));
  readings.radon = { ...readings.radon, score: hasZone ? scoreNumber(radonBox.score) : null, reading: hasZone ? `Zone ${zone}` : 'No data', unit: 'County estimate', severity: hasZone ? severity(radon.severity ?? radonBox.severity) : 'no_data',
    provenance: hasZone ? 'estimate' : null, source: 'EPA county radon zones', asOf: 'County classification, not a current home test',
    sentence: hasZone ? `${county || 'Your county'} is in EPA Zone ${zone}. Your home needs its own test.` : radon.out_of_state === true ? 'This radon dataset covers North Carolina. A local home test can provide a result for your address.' : 'A county radon classification is not available for this home.',
    detail: 'County zones describe an area. They do not determine radon concentration inside your home.', context: hasZone ? context({ county, zone, severity: severity(radon.severity ?? radonBox.severity) }) : {},
    trendTitle: 'A home test gives you the missing number', trendCaption: 'No measured home radon series is available.', details: hasZone ? { radon: { zone: zone!, county } } : {},
    disclosures: [privateSource ? 'Radon is shown separately. No combined home score is calculated for untested private water.' : 'This is an area estimate, not a measurement of your home.'],
  };

  const yearRaw = finite(location.home_year); const homeYear = yearRaw !== null && Number.isInteger(yearRaw) && yearRaw >= 1700 && yearRaw <= new Date().getFullYear() + 1 ? yearRaw : null;
  const hasLead = !privateSource && Object.keys(lead).length > 0;
  const privateLeadTest = privateSource && rows(record(water.test_plan).tests).some(test => test.id === 'lead_copper');
  readings.lead = { ...readings.lead, score: null, severity: hasLead ? severity(lead.level) : 'no_data', reading: hasLead && homeYear !== null ? String(homeYear) : 'No data', unit: 'Home built',
    provenance: hasLead && lead.is_estimate === true ? 'estimate' : null, source: 'Home age provided during setup', asOf: 'A building-era estimate',
    sentence: hasLead ? safeText(lead.sentence ?? lead.text, 'No measured lead result is available for this home.') : privateLeadTest ? 'Lead is included in the private water testing plan.' : privateSource ? 'No measured tap lead result is available for this home.' : 'Add the home year to see the available building-era guidance.',
    detail: 'Building age is a clue about plumbing materials, not proof of lead. Lead does not contribute to the Homeguard score.', context: hasLead ? context({ home_year: homeYear, severity: severity(lead.level) }) : {},
    trendTitle: 'From building age to an actual answer', trendCaption: 'No measured tap lead result or numeric lead score is available.', details: { lead: { home_year: homeYear } },
    disclosures: ['Lead is shown separately and is never included in the home score.'],
  };

  const missingDaily = [aqi === null ? 'air' : null, uvIndex === null ? 'uv' : null, !hasPollen ? 'pollen' : null, !moldRisk ? 'mold' : null].filter((key): key is string => key !== null);
  const missingHome = [!scoreable ? 'water' : null, !hasZone ? 'radon' : null].filter((key): key is string => key !== null);
  const todayOverview = overview(dailyData.score, dailyData.retrieved_at, DAILY_KEYS, missingDaily);
  // The approved specification uses relative shares of the returned risk inputs
  // for ring geometry. These are not weights in the composite scoring formula.
  const riskInputs = record(record(dailyData.score).inputs);
  for (const key of DAILY_KEYS) {
    const risk = scoreNumber(riskInputs[key]);
    if (todayOverview.includedInputs.includes(key) && risk !== null && !missingDaily.includes(key)) todayOverview.contributions[key as FactorKey] = risk;
  }
  if (Object.keys(todayOverview.contributions).length) todayOverview.contributionNote = contributionNote(todayOverview.contributions);
  const homeOverview = overview(homeData.score, homeData.assembled_at ?? homeData.retrieved_at, HOME_KEYS, missingHome, privateSource);
  const homeScore = record(homeData.score);
  if (homeScore.capped !== true && /\bcapped\b|\bceiling\b|\bcap\b/i.test(homeOverview.notice ?? '')) homeOverview.notice = 'Some detected compounds cannot be evaluated against a supplied limit or benchmark. This score reflects what could be evaluated.';
  if (!privateSource) {
    const waterRisk = scoreNumber(homeScore.water_risk); const radonRisk = scoreNumber(homeScore.radon_risk);
    if (scoreable && waterSeverity !== 'no_data' && homeOverview.includedInputs.includes('water') && waterRisk !== null) homeOverview.contributions.pfas = waterRisk;
    if (hasZone && readings.radon.severity !== 'no_data' && homeOverview.includedInputs.includes('radon') && radonRisk !== null) homeOverview.contributions.radon = radonRisk;
    if (Object.keys(homeOverview.contributions).length) homeOverview.contributionNote = contributionNote(homeOverview.contributions);
  }
  const scoreNotices = [homeOverview.notice, homeScore.capped === true ? 'The home score is capped because some detections cannot be evaluated.' : null, homeScore.includes_guidance === true ? 'The home score includes nonbinding health benchmarks.' : null, privateSource ? 'No combined home score is available without measured private water results.' : null].filter((value): value is string => !!value);
  if (scoreNotices.length) homeOverview.notice = scoreNotices.join(' ');
  // Keep absent timestamps absent through the formatted fallback. Never use the
  // browser clock as a source retrieval time.
  if (!timestamp(dailyData.retrieved_at)) todayOverview.asOf = 'Update time unavailable';
  return { readings, today: todayOverview, home: homeOverview };
}
