import type { FactorKey } from './factor-preview';
export type PreviewAction = { id: string; key: string; title: string; reason: string; origin: string; date: string; state: 'saved' | 'completed' | 'waiting' };
export type ActionSeed = Pick<PreviewAction, 'key' | 'title' | 'reason' | 'origin'> & { date?: string };
export const followThrough: Record<FactorKey, { title: string; destination: string; label: string; layer?: string }> = {
  air: { title: 'Prepare for outdoor activity', destination: 'outdoors', label: 'Compare outdoor plans', layer: 'air' },
  uv: { title: 'Prepare sun protection', destination: 'outdoors', label: 'Plan time outdoors' },
  pollen: { title: 'Review pollen before going out', destination: 'outdoors', label: 'Plan around available forecasts' },
  mold: { title: 'Follow up on moisture at home', destination: 'maintenance', label: 'Moisture and maintenance' },
  pfas: { title: 'Review my water testing options', destination: 'tests', label: 'Tests and home records', layer: 'water' },
  radon: { title: 'Arrange a home radon test', destination: 'tests', label: 'Tests and home records', layer: 'radon' },
  lead: { title: 'Ask about my service line and testing', destination: 'tests', label: 'Tests and home records' },
};
export const destinations = {
  tests: { tab: 'home', title: 'Tests and records', description: 'Keep test preparation, sample collection and reported results together.', steps: ['Prepare a test with its purpose, home or site, sample medium and laboratory.', 'Record collection dates and track a result without inventing a pending value.', 'Keep reported units, qualifiers and files. Review corrections and follow-up.'], dependency: 'Owned test records, private uploads and reviewed result interpretation are being built.' },
  maintenance: { tab: 'home', title: 'Maintenance and moisture', description: 'Follow through on filters, home care and observations without losing the history.', steps: ['Choose an asset or record a moisture observation, with a date and measurement source.', 'Choose a routine based on instructions or your own interval.', 'Record what you did. A completed task does not certify that a hazard is resolved.'], dependency: 'Asset records, moisture observations and recurring action contracts are being built.' },
  food: { tab: 'home', title: 'Food and Garden', description: 'Evidence for the places you grow, the water you use and the food you ask about.', steps: ['Fish and waterways: source-specific species and audience advice.', 'My garden: soil, irrigation context and testing preparation.', 'Food information: applicable notices, with local findings separate from research.', 'Grower resources: sampling support, eligibility and official contacts.', 'Water stewardship: drought context, utility notices and optional usage records.'], dependency: 'Reviewed sources and location coverage are required. No local food safety score or invented PFAS measurements.' },
  summary: { tab: 'home', title: 'Household summary', description: 'Choose what to include before sharing anything about your home.', steps: ['Choose dates and sections, including either score and relevant factors.', 'Review source dates and explicitly include any private tests or household details.', 'Preview, print or share. Missing sections remain clearly identified.'], dependency: 'Record selection and private export contracts are not connected in this review.' },
  outdoors: { tab: 'plan', title: 'Plan time outdoors', description: 'Compare available forecast periods, with each factor kept visible.', steps: ['Choose activity, place, duration and date.', 'Review air, UV and pollen separately, with issue times and missing periods.', 'Save a preparation step or choose a follow-up. No time is labelled guaranteed safe.'], dependency: 'Comparable forecast intervals are being built. The existing UV window is not a combined outdoor forecast.' },
  journal: { tab: 'plan', title: 'Journal and Patterns', description: 'Optional check-ins belong with your week, not in a separate main tab.', steps: ['Log today or a remembered date. Felt fine is an explicit choice.', 'Edit your full entry, review recent days and retain drafts after an error.', 'Explore logged versus unlogged days and available environmental history. Patterns do not establish a cause.'], dependency: 'The dedicated Journal design and revised analysis contracts still need implementation and review.' },
  opportunities: { tab: 'act', title: 'Local opportunities', description: 'Find a useful way to take part, with the organizer and requirements visible.', steps: ['Filter by cause, date and region. Review access, cost and requirements.', 'Save an opportunity or open official registration.', 'Record participation yourself. Opening registration never counts as attending.'], dependency: 'Verified organizer records, revisions and participation contracts are being built.' },
  projects: { tab: 'act', title: 'Conservation projects', description: 'Turn a reviewed project into manageable steps.', steps: ['Review suitability, materials, permissions and instructions.', 'Save selected steps or the project, then schedule your work.', 'Record effort and follow-up without claiming unmeasured pollution removal.'], dependency: 'Reviewed project templates and shared parent/child actions are required.' },
  outreach: { tab: 'act', title: 'Evidence-based outreach', description: 'Prepare a clear question using evidence you can inspect.', steps: ['Choose a purpose, recipient and supporting records.', 'Edit independent drafts and review exactly what would be shared.', 'Copy, print or share yourself. HALO does not silently send a letter.'], dependency: 'Reviewed templates and source-linked draft contracts are required.' },
  observations: { tab: 'act', title: 'Field observations', description: 'Keep factual observations private until you decide what to share.', steps: ['Record what you observed and when, with optional place or photo.', 'Review location precision and photo metadata.', 'Open the appropriate official reporting channel. A handoff is not a confirmed submission.'], dependency: 'Private records, secure files and reviewed reporting destinations are required.' },
} as const;
export type ExpandedDestination = keyof typeof destinations;
export function isDestination(value: unknown): value is ExpandedDestination { return typeof value === 'string' && Object.hasOwn(destinations, value); }
export function validActionDate(value: string): boolean {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function actionDraftError(title: string, date: string): string | null {
  if (!title.trim() || title.trim().length > 160) return 'Enter a title between 1 and 160 characters.';
  if (!validActionDate(date)) return 'Choose a valid calendar date.';
  return null;
}
