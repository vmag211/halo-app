/** Review fixtures only. No authentication, API calls, household storage or health classification. */
export const foundationScenarios = [
  ['shell', 'App shell', 'Navigation and shared cards'],
  ['shell-home', 'App shell', 'Home header'],
  ['shell-map', 'App shell', 'Map header and wider canvas'],
  ['shell-journal', 'App shell', 'Journal header'],
  ['shell-act', 'App shell', 'Act header'],
  ['shell-settings', 'App shell', 'Settings and Back'],
  ['shell-no-alerts', 'App shell', 'No unread badge'],
  ['shell-badge-cap', 'App shell', 'Unread badge capped at 9+'],
  ['shell-no-assistant', 'App shell', 'Assistant switched off'],
  ['offline', 'Data states', 'Offline with stored readings'],
  ['offline-empty', 'Data states', 'Offline without stored readings'],
  ['loading', 'Data states', 'Loading skeletons'],
  ['error', 'Data states', 'Error and retry'],
  ['empty', 'Data states', 'Empty with action'],
  ['empty-no-action', 'Data states', 'Empty without action'],
  ['refreshing', 'Data states', 'Refreshing while retaining readings'],
  ['stale', 'Data states', 'Refresh failed with stored readings'],
  ['no-data', 'Scores and cards', 'Missing readings'],
  ['partial', 'Scores and cards', 'Incomplete score and hatched factor'],
  ['score-zero', 'Scores and cards', 'Real score of zero'],
  ['score-full', 'Scores and cards', 'Score of 100'],
  ['contribution-zero', 'Scores and cards', 'Zero total risk, bar hidden'],
  ['contribution-single', 'Scores and cards', 'One contributing factor'],
  ['contribution-sliver', 'Scores and cards', 'Small and zero-risk factors'],
  ['cards', 'Scores and cards', 'Static, tappable and expandable cards'],
  ['card-loading', 'Scores and cards', 'Expanded card loading'],
  ['card-no-data', 'Scores and cards', 'Expanded card with no data'],
  ['pills', 'Components', 'Severity, provenance and confidence'],
  ['callouts', 'Components', 'Info, caution, notice and error'],
  ['bars', 'Components', 'Risk and fixed-limit bars'],
  ['buttons', 'Components', 'Button variants and availability'],
  ['controls', 'Forms', 'Segments, chips, switches and accordions'],
  ['controls-failure', 'Forms', 'Optimistic toggle failure and reversion'],
  ['form', 'Forms', 'Fields and validation'],
  ['form-error', 'Forms', 'Failed save with values retained'],
  ['form-disabled', 'Forms', 'Controls waiting for profile'],
  ['long-text', 'Forms', 'Long values and Spanish expansion'],
  ['swipe', 'Feedback', 'Visible delete action and swipe'],
  ['toast', 'Feedback', 'Plain confirmation, eight seconds'],
  ['toast-undo', 'Feedback', 'Undo confirmation, eight seconds'],
  ['sheet-standard', 'Sheets', 'Standard sheet, 70%'],
  ['sheet-tall', 'Sheets', 'Tall sheet, 90%'],
  ['sheet-content', 'Sheets', 'Map detail, at most 50%'],
  ['sheet-loading', 'Sheets', 'Sheet loading'],
  ['sheet-error', 'Sheets', 'Sheet error and retry'],
  ['sheet-empty', 'Sheets', 'Sheet empty'],
  ['sheet-deep-link', 'Sheets', 'Pasted Learn link, safe close'],
  ['gate-loading', 'Entry and identity', 'Profile verification'],
  ['gate-incomplete', 'Entry and identity', 'Incomplete profile'],
  ['gate-error', 'Entry and identity', 'Profile error and retry'],
  ['gate-location', 'Entry and identity', 'Missing location'],
  ['not-found', 'Entry and identity', 'Unknown route'],
  ['identity', 'Entry and identity', 'Logo, typography and new token proposals'],
] as const;
export type FoundationScenario = typeof foundationScenarios[number][0];
export function isFoundationScenario(value: unknown): value is FoundationScenario {
  return typeof value === 'string' && foundationScenarios.some(([key]) => key === value);
}
export const previewTabs = ['today', 'home', 'map', 'journal', 'act'] as const;
export type PreviewTab = typeof previewTabs[number];
export type PreviewRoute = PreviewTab | 'settings';
export type PreviewSheet = 'learn' | 'alerts' | 'assistant' | 'map';
export const routeTitles: Record<PreviewRoute, string> = { today: 'Today', home: 'Your home', map: 'Map', journal: 'Journal', act: 'Act', settings: 'Settings' };
export const tabLabels: Record<PreviewTab, string> = { today: 'Today', home: 'Home', map: 'Map', journal: 'Journal', act: 'Act' };
export const sampleFactors = [
  { key: 'air', title: 'Air quality', summary: 'AQI 37', severity: 'good', share: 12, provenance: 'measured' },
  { key: 'uv', title: 'UV index', summary: '5.2', severity: 'moderate', share: 64, provenance: null },
  { key: 'pollen', title: 'Pollen', summary: 'Grass 3', severity: 'elevated', share: 24, provenance: null },
  { key: 'mold', title: 'Mold risk', summary: 'Estimate', severity: 'no_data', share: null, provenance: 'estimate' },
] as const;
