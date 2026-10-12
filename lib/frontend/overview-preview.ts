/** Shared design fixtures, never a fallback for unavailable live readings. */
export function previewOverviewScore(home: boolean, scenario: string) {
  const missing = scenario === 'no-data';
  const score = missing ? null : scenario === 'score-zero' ? 0 : ['contribution-zero', 'score-full'].includes(scenario) ? 100 : home ? 58 : 74;
  return { score, partial: scenario === 'partial', severity: missing ? 'no_data' : score === 0 ? 'severe' : home ? 'elevated' : 'moderate', asOf: 'Updated September 30, 2026' };
}
