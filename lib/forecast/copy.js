/**
 * Every server-authored string of `forecast.read` (B10 plan F23): coverage,
 * `warningStatus`, `weather`, `tradeoff`, `source` and the period version
 * label, in one frozen table, plus the WMO weather-code table and its severity
 * rank. lib/forecast/snapshot.js builds bodies only from these; a test scans
 * every emitted string for U+2014 and for the word "safe" (AGENTS.md; AC-012;
 * MP-332 "no safe or score").
 *
 * Rain (Vibhav, 2026-10-19, "fuller model"): the forecast is
 * `ncep_gfs_global` without `precipitation_probability`, so rain is the
 * model's AMOUNT in inches, a preceding-hour sum, and is never phrased as a
 * chance or a percentage.
 *
 * Provider text (reporting areas, pollutant names, NWS event names, gazetteer
 * labels) passes `presentable`, which replaces U+2014 with a comma and a space
 * (the gazetteer build's own rule, scripts/build-nc-places.mjs, "NO EM DASH")
 * and removes control characters. Presentation only: the values are otherwise
 * shown as received (AirNow guidelines, F6).
 */

const EM_DASH = /\s*\u2014\s*/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Provider or gazetteer text made fit to show: no U+2014, no control characters. */
export function presentable(text) {
  return String(text).replace(CONTROL, ' ').replace(EM_DASH, ', ').replace(/\s+/g, ' ').trim();
}

/**
 * WMO weather interpretation codes as Open-Meteo documents them
 * (https://open-meteo.com/en/docs, "WMO Weather interpretation codes (WW)",
 * retrieved 2026-10-19): 0 clear sky; 1, 2, 3 mainly clear, partly cloudy and
 * overcast; 45, 48 fog and depositing rime fog; 51, 53, 55 drizzle light,
 * moderate, dense; 56, 57 freezing drizzle light, dense; 61, 63, 65 rain
 * slight, moderate, heavy; 66, 67 freezing rain light, heavy; 71, 73, 75 snow
 * fall slight, moderate, heavy; 77 snow grains; 80, 81, 82 rain showers
 * slight, moderate, violent; 85, 86 snow showers slight, heavy; 95
 * thunderstorm slight or moderate; 96, 99 thunderstorm with slight and heavy
 * hail.
 *
 * `rank` is HALO's severity order for an outdoor period (F13, "most severe WMO
 * weather code by an explicit severity rank"), a product choice, lowest
 * first: sky cover, fog, drizzle, rain and rain showers by intensity, snow,
 * freezing precipitation (ice), thunderstorms. A code not in this table is
 * not described: its hour counts as lacking a weather code (never invent).
 */
const WMO_ROWS = [
  [0, { text: 'clear sky', rank: 0 }],
  [1, { text: 'mainly clear', rank: 1 }],
  [2, { text: 'partly cloudy', rank: 2 }],
  [3, { text: 'overcast', rank: 3 }],
  [45, { text: 'fog', rank: 4 }],
  [48, { text: 'depositing rime fog', rank: 5 }],
  [51, { text: 'light drizzle', rank: 6 }],
  [53, { text: 'moderate drizzle', rank: 7 }],
  [55, { text: 'dense drizzle', rank: 8 }],
  [61, { text: 'slight rain', rank: 9 }],
  [80, { text: 'slight rain showers', rank: 10 }],
  [63, { text: 'moderate rain', rank: 11 }],
  [81, { text: 'moderate rain showers', rank: 12 }],
  [65, { text: 'heavy rain', rank: 13 }],
  [82, { text: 'violent rain showers', rank: 14 }],
  [71, { text: 'slight snowfall', rank: 15 }],
  [77, { text: 'snow grains', rank: 16 }],
  [85, { text: 'slight snow showers', rank: 17 }],
  [73, { text: 'moderate snowfall', rank: 18 }],
  [75, { text: 'heavy snowfall', rank: 19 }],
  [86, { text: 'heavy snow showers', rank: 20 }],
  [56, { text: 'light freezing drizzle', rank: 21 }],
  [57, { text: 'dense freezing drizzle', rank: 22 }],
  [66, { text: 'light freezing rain', rank: 23 }],
  [67, { text: 'heavy freezing rain', rank: 24 }],
  [95, { text: 'thunderstorm', rank: 25 }],
  [96, { text: 'thunderstorm with slight hail', rank: 26 }],
  [99, { text: 'thunderstorm with heavy hail', rank: 27 }],
];
const WMO = new Map(WMO_ROWS.map(([code, entry]) => [code, Object.freeze(entry)]));

/** Every documented code, as frozen [code, {text, rank}] pairs, for tests. */
export const WMO_CODES = Object.freeze(WMO_ROWS.map(([code]) => Object.freeze([code, WMO.get(code)])));

/** The documented description and severity rank of a WMO code, or null for any other value. */
export function wmoCode(code) {
  return WMO.get(code) ?? null;
}

/** AirNow's six category names, lowest first (DS-033). Anything else is not a category. */
export const AIRNOW_CATEGORIES = Object.freeze(['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous']);

/** Display names for AirNow `ParameterName` values; any other name is shown as received. */
const POLLUTANT_NAMES = Object.freeze({ O3: 'ozone', OZONE: 'ozone', 'PM2.5': 'PM2.5', PM10: 'PM10', NO2: 'nitrogen dioxide', CO: 'carbon monoxide', SO2: 'sulfur dioxide' });

export function pollutantName(parameter) {
  const name = presentable(parameter);
  return Object.hasOwn(POLLUTANT_NAMES, name) ? POLLUTANT_NAMES[name] : name;
}

const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const sentence = (parts) => parts.filter(Boolean).join(' ');

/**
 * Task 2's reason for five digits that are not an NC ZCTA (lib/forecast/place.js,
 * UNMATCHED_REASONS.zip). Only this reason changes the explanation; Task 2's other
 * reason repeats what the general sentence already says, and no reason text is
 * ever shown, so nothing the person typed can be echoed.
 */
export const UNMATCHED_ZIP_REASON = 'not a North Carolina ZIP code';

/** The frontend's own fallback for Official notices (WeekOutdoors.tsx:46), used whenever NWS did not answer. */
export const WARNINGS_UNAVAILABLE = 'Warnings unavailable. Check the official site.';

export const COPY = Object.freeze({
  // ---- places (F1, F15, F16)
  homeLabel: 'your home area',
  typedLabel: 'the place you typed',
  pointBasis: 'Census internal point',
  coveragePrefix: (label, basis) => `For ${label}${basis ? ` (${basis})` : ''}:`,

  // ---- source (F16)
  providers: Object.freeze({ openMeteo: 'Open-Meteo', airNow: 'EPA AirNow', nws: 'the National Weather Service' }),
  source: (providers, label) => `${list(providers)}, for ${label}`,
  sourceEmpty: (label) => `No forecast was made for ${label}.`,

  // ---- empty snapshots (F21): why no forecast was made
  emptyLead: 'No forecast was made.',
  emptyWhy: Object.freeze({
    no_home: 'No home location is saved. Finish setup, or type a North Carolina city, county or ZIP code.',
    unmatched: 'This place did not match a North Carolina county, city, town or ZIP code. Type a city, county or ZIP code.',
    unmatchedZip: 'This ZIP code is not a North Carolina ZIP code. Type a North Carolina city, county or ZIP code.',
    ambiguous: (labels) => `This matches more than one North Carolina place: ${list(labels)}. Add the county or a ZIP code.`,
    outside: 'This names a place outside North Carolina. HALO forecasts typed places in North Carolina only; your saved home area works anywhere.',
  }),

  // ---- weather string (F14)
  temperature: (lowF, highF, lowC, highC) => `${lowF === highF ? `${lowF}` : `${lowF} to ${highF}`} °F (${lowC === highC ? `${lowC}` : `${lowC} to ${highC}`} °C)`,
  sky: (text, varies) => (varies ? `${text} at times` : text),
  feelsLike: (f) => `feels like up to ${f} °F`,
  feelsLikeUnavailable: 'feels-like temperature unavailable',
  rainNone: 'no rain in the model',
  rainTrace: 'model rain under 0.01 in',
  rainAmount: (inches) => `model rain ${inches} in`,
  rainUnavailable: 'model rain unavailable',
  wind: (mph) => `wind up to ${mph} mph`,
  windUnavailable: 'wind unavailable',
  weather: (parts) => parts.join(', '),

  // ---- tradeoff (F14): comparisons with the other periods present, then air
  compare: Object.freeze({
    uv: Object.freeze({ low: 'Lowest UV of these periods.', lowTie: 'Joint lowest UV of these periods.', high: 'Highest UV of these periods.', highTie: 'Joint highest UV of these periods.' }),
    feels: Object.freeze({ low: 'Coolest feels-like temperature of these periods.', lowTie: 'Joint coolest feels-like temperature of these periods.', high: 'Warmest feels-like temperature of these periods.', highTie: 'Joint warmest feels-like temperature of these periods.' }),
    rain: Object.freeze({ low: 'Least model rain of these periods.', lowTie: 'Joint least model rain of these periods.', high: 'Most model rain of these periods.', highTie: 'Joint most model rain of these periods.' }),
  }),
  onlyPeriod: 'No other period of this date is left to compare.',
  noDifference: 'UV, feels-like temperature and model rain do not separate these periods.',
  tradeoffAir: Object.freeze({
    forecast: (readings) => `Air is a daily AirNow forecast, the same for every period: ${list(readings)}.`,
    none: 'No air forecast for this date.',
    notChecked: 'Air was not checked for this date.',
  }),

  // ---- one AirNow reading, as received (F6)
  airReading: (pollutant, category, aqi) => {
    if (category && aqi !== null) return `${pollutant} ${category} (AQI ${aqi})`;
    if (category) return `${pollutant} ${category} (category only, no AQI number issued)`;
    if (aqi !== null) return `${pollutant} AQI ${aqi} (no category issued)`;
    return `${pollutant} not issued (no category or AQI number)`;
  },
  airArea: (areas) => `the ${list(areas)} reporting area${areas.length > 1 ? 's' : ''}`,
  /**
   * The period's "Air, daily" cell (Open question 5): the worst category AirNow
   * issued for the date, with its number only when one pollutant alone set it,
   * and the pollutant(s) that set it. Category names are AirNow's, as received.
   */
  airDaily: ({ category, aqi, pollutants, actionDay }) => `${category}${aqi !== null ? ` (AQI ${aqi})` : ''}, ${list(pollutants)}${actionDay ? ', air quality action day' : ''}`,

  // ---- coverage (F15), each after the place prefix
  coverage: Object.freeze({
    weather: ({ run, zone, horizonStart, horizonEnd, interpolatedFrom, stale }) => sentence([
      `Open-Meteo GFS Global model forecast, run ${run}, hourly values summarised by period (Morning 8:00 AM to 12:00 PM, Afternoon 12:00 PM to 5:00 PM, Evening 5:00 PM to 9:00 PM, ${zone} time), for ${horizonStart} through ${horizonEnd}.`,
      stale ? 'A newer model run is not yet confirmed, so this is the last confirmed run. Refresh shortly for the newer run.' : '',
      'Rain is the model\'s amount in inches, not a chance of rain.',
      interpolatedFrom ? `From ${interpolatedFrom}, Open-Meteo interpolates hourly values from 3-hourly model steps.` : '',
      'Weather data by Open-Meteo.com (CC BY 4.0).',
    ]),
    uv: ({ horizonEnd }) => `Open-Meteo GFS model UV index, the highest hourly value in each period, through ${horizonEnd}. Modelled, not measured. A period missing any hourly UV value shows Unavailable.`,
    airForecast: ({ area, issued, date, readings, actionDay, dates }) => sentence([
      `EPA AirNow forecast for ${area}, issued ${issued}, for ${date} as a whole day: ${list(readings)}.`,
      'This is the forecast for the reporting area, not your exact location.',
      actionDay ? 'An air quality action day is declared.' : '',
      `AirNow forecast dates for this area: ${list(dates)}.`,
      'The daily forecast is shown as received and is not split into periods.',
      'Forecast by the state or local air agency, via the EPA AirNow program.',
    ]),
    airNotIssued: ({ area, date, dates }) => sentence([
      `EPA AirNow issued no air forecast for ${date} for ${area}.`,
      dates.length ? `AirNow forecast dates for this area: ${list(dates)}.` : '',
      'Check AirNow before going.',
    ]),
    airNoArea: 'EPA AirNow has no air forecast for this area. Check AirNow before going.',
    airFailed: 'Air was not checked. The EPA AirNow forecast could not be reached. Check AirNow before going.',
    airBudget: 'Air was not checked. HALO\'s hourly limit for AirNow requests was reached. Check AirNow before going.',
    airNotConnected: 'Air was not checked. HALO\'s AirNow forecast connection is not set up. Check AirNow before going.',
    pollen: 'Unavailable. HALO has no free pollen forecast for this area.',
  }),

  // ---- warningStatus (F7)
  warningsNone: (asOf) => `No National Weather Service alerts are active for this area as of ${asOf}. Check the official site before going.`,
  warningsActive: (asOf, events) => `Active National Weather Service alerts as of ${asOf}: ${list(events)}. Check the official site.`,
  warningsUnavailable: WARNINGS_UNAVAILABLE,

  // ---- period version label (F19)
  periodVersion: (run, airIssued) => (airIssued ? `Open-Meteo GFS run ${run}; AirNow ${airIssued}` : `Open-Meteo GFS run ${run}`),

  // ---- error envelopes of GET /api/forecast (F21, Task 8). Date and place
  // field errors use lib/validate.js's shared sentences.
  errors: Object.freeze({
    unavailable: 'Forecasts are unavailable right now. Try again shortly.',
    rateLimited: 'Too many forecast requests from this household. Try again in a few minutes.',
    placeUnreadable: 'Type a North Carolina city, county or ZIP code.',
  }),
});
