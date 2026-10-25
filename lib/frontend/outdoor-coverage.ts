import type { ForecastPeriod } from './week-evidence-preview';

/**
 * How the forecast periods line up with a whole outdoor activity, not just the period it starts in.
 * A period's start and end are parsed the same way as the activity start, so a fixture's local wall
 * clock and a live forecast's offset instants each stay self-consistent.
 */
export type CoverageSpan = { start: number; end: number };
export type FactorSpan = { highest: number | null; unavailable: string[] };
export type ActivityCoverage = CoverageSpan & {
  periods: ForecastPeriod[];
  /** Parts of the activity no forecast period describes: between periods, after the last one, or past midnight. */
  gaps: CoverageSpan[];
  complete: boolean;
  air: FactorSpan; uv: FactorSpan;
  pollen: { categories: string[]; unavailable: string[] };
};

const numeric = (periods: ForecastPeriod[], pick: (period: ForecastPeriod) => number | null): FactorSpan => {
  const values = periods.map(pick).filter((value): value is number => value !== null);
  return { highest: values.length ? Math.max(...values) : null, unavailable: periods.filter(period => pick(period) === null).map(period => period.name) };
};

export function outdoorCoverage(periods: readonly ForecastPeriod[], startPeriod: string, minutes: number): ActivityCoverage | null {
  const first = periods.find(period => period.name === startPeriod);
  const start = first ? Date.parse(first.start) : NaN;
  if (!first || !Number.isFinite(start) || !Number.isFinite(minutes) || minutes <= 0) return null;
  const end = start + minutes * 60000;
  const overlapping = periods
    .filter(period => Date.parse(period.start) < end && Date.parse(period.end) > start)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const gaps: CoverageSpan[] = [];
  let cursor = start;
  for (const period of overlapping) {
    const from = Date.parse(period.start), to = Date.parse(period.end);
    if (from > cursor) gaps.push({ start: cursor, end: Math.min(from, end) });
    cursor = Math.max(cursor, to);
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  const pollen = overlapping.map(period => period.pollen).filter((value): value is string => value !== null);
  return {
    start, end, periods: overlapping, gaps, complete: gaps.length === 0,
    air: numeric(overlapping, period => period.air), uv: numeric(overlapping, period => period.uv),
    pollen: { categories: [...new Set(pollen)], unavailable: overlapping.filter(period => period.pollen === null).map(period => period.name) },
  };
}

const names = (list: string[]) => list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;

/**
 * Plain sentences for the review and the saved task. `label` formats an instant as a 12-hour clock
 * (with a day when it falls on another date). Unavailable values are named, never folded into a
 * lower or better-looking figure.
 */
export function describeCoverage(coverage: ActivityCoverage, label: (instant: number) => string) {
  const span = `${label(coverage.start)} to ${label(coverage.end)}`;
  const covered = names(coverage.periods.map(period => period.name.toLowerCase()));
  const headline = coverage.complete
    ? `Your activity runs ${span}. The ${covered} forecast${coverage.periods.length > 1 ? 's cover' : ' covers'} all of it.`
    : `Your activity runs ${span}. The forecast covers only part of it.`;
  const uncovered = coverage.gaps.map(gap => `${label(gap.start)} to ${label(gap.end)}`);
  const factor = (title: string, value: FactorSpan, unit: string) => value.highest === null
    ? `${title}: unavailable for this activity.`
    : `${title}: up to ${value.highest}${unit ? ` ${unit}` : ''}${value.unavailable.length ? `, unavailable for the ${names(value.unavailable.map(name => name.toLowerCase()))}` : ''}.`;
  const factors = [
    factor('Air', coverage.air, 'AQI'),
    factor('UV index', coverage.uv, ''),
    coverage.pollen.categories.length
      ? `Pollen, daily: ${coverage.pollen.categories.join(' or ')}${coverage.pollen.unavailable.length ? `, unavailable for the ${names(coverage.pollen.unavailable.map(name => name.toLowerCase()))}` : ''}.`
      : 'Pollen, daily: unavailable for this activity.',
  ];
  return { headline, uncovered, factors, uncoveredSentence: uncovered.length ? `No forecast covers ${names(uncovered)}. Check conditions again before that part.` : '' };
}

/** The saved outdoor plan a task belongs to; a forecast-check task points back to its plan. */
export function outdoorPlanKey(key: string): string | null {
  const match = /^(outdoors:[^:]+)(?::check-forecast)?$/.exec(key);
  return match ? match[1] : null;
}

/** The plan details Plan outdoors wrote into the task note. A note edited since then is not guessed at. */
export function outdoorPlanFromNote(note: string) {
  const match = /^([\s\S]*?)\. (Morning|Afternoon|Evening)\. Preparation checked: ([\s\S]*?)\. Watch: (requested, not activated|off)\. Household context: ([^.]*)\.(?: Forecast coverage[ (:][\s\S]*)?$/.exec(note.trim());
  if (!match) return null;
  return {
    place: match[1] === 'Place not specified' ? '' : match[1].slice(0, 100),
    period: match[2],
    preparation: match[3] === 'None' ? [] : match[3].split('; ').filter(Boolean),
    watch: match[4] !== 'off',
    group: match[5] === 'general' ? '' : match[5],
  };
}
