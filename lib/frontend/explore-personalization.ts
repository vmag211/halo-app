import { projectGuides, type ProjectGuide } from './explore-project-guides';
import { factorReadings } from './factor-preview';

/** Generation is deterministic and visit-local. No model, retrieval, scoring or account call. */
export type ProjectConstraints = {
  space: 'any' | 'indoors' | 'balcony' | 'yard' | 'community';
  mode: 'any' | 'solo' | 'group';
  time: 'any' | 'quick' | 'half-day' | 'ongoing';
  budget: 'any' | 'reuse' | 'low';
  count: 3 | 5 | 10 | 11 | 12 | 13 | 14 | 15;
};
export const defaultProjectConstraints: ProjectConstraints = { space: 'any', mode: 'any', time: 'any', budget: 'any', count: 12 };
export type ProjectEvidence = {
  id: string; topic: 'air' | 'uv' | 'pollen' | 'weather' | 'water' | 'radon' | 'lead' | 'garden' | 'moisture' | 'filter' | 'test';
  label: string; value: string; scope: string; asOf: string; provenance: string; stale: boolean; status: 'available' | 'unknown';
  numericValue?: number; unit?: string; pollutant?: string;
};
export type ProjectEnvironmentContext = {
  key: string; isSample: true; state: string; county: string; renter: boolean | null; evidence: ProjectEvidence[];
  hasGarden: boolean; gardenWaterKnown: boolean; hasMoistureObservation: boolean; filterModelKnown: boolean;
  sourceStatus: 'reviewed-drafts' | 'unavailable';
  /** Rotate equally relevant general options only; never modify environmental evidence. */
  variation?: number;
  previousIdeaIds?: string[];
  interestOnly?: boolean;
  /** Explicit form choices win over constraints embedded in an older request. */
  requestConstraints?: 'interpret' | 'explicit';
};
export type ProjectSuggestion = {
  id: string; title: string; reason: string; tags: string[]; evidenceIds: string[]; sourceIds: string[];
  fit: 'context' | 'interest' | 'general'; needsCheck: string[];
};
export type ProjectGenerationState = {
  request: string; constraints: ProjectConstraints; items: ProjectSuggestion[]; contextKey: string; generation: number;
};
const choices = {
  space: ['any', 'indoors', 'balcony', 'yard', 'community'], mode: ['any', 'solo', 'group'],
  time: ['any', 'quick', 'half-day', 'ongoing'], budget: ['any', 'reuse', 'low'],
} as const;
export function normalizeProjectConstraints(value: Partial<ProjectConstraints> = {}): ProjectConstraints {
  const normalized = { ...defaultProjectConstraints };
  for (const key of ['space', 'mode', 'time', 'budget'] as const) {
    const candidate = value[key];
    if (candidate && (choices[key] as readonly string[]).includes(candidate)) Object.assign(normalized, { [key]: candidate });
  }
  if ([3, 5, 10, 11, 12, 13, 14, 15].includes(value.count ?? 0)) normalized.count = value.count!;
  return normalized;
}
export function inferProjectConstraints(request: string, current: ProjectConstraints = defaultProjectConstraints): ProjectConstraints {
  const result = normalizeProjectConstraints(current);
  const text = request.toLocaleLowerCase('en');
  if (/\b(indoors?|inside|no outdoor space)\b/.test(text)) result.space = 'indoors';
  else if (/\b(balcony|patio|small outdoor space)\b/.test(text)) result.space = 'balcony';
  else if (/\b(backyard|yard)\b/.test(text) && !/\b(no|without|do not have|don't have)\s+(a\s+)?(back)?yard\b/.test(text)) result.space = 'yard';
  else if (/\b(community|neighbou?rhood)\b/.test(text)) result.space = 'community';
  if (/\b(alone|solo|by myself|on my own)\b/.test(text)) result.mode = 'solo';
  else if (/\b(group|friends|together)\b/.test(text)) result.mode = 'group';
  if (/\b(reuse|no spend|no cost|free|existing materials)\b/.test(text)) result.budget = 'reuse';
  else if (/\b(low.cost|small budget|cheap|inexpensive)\b/.test(text)) result.budget = 'low';
  if (/\b(quick|short|20 minutes|half an hour)\b/.test(text)) result.time = 'quick';
  else if (/\b(half.day|afternoon|few hours)\b/.test(text)) result.time = 'half-day';
  else if (/\b(ongoing|long.term|regular)\b/.test(text)) result.time = 'ongoing';
  const count = text.match(/\b(3|5|10|11|12|13|14|15)\s+(?:project|idea)/);
  if (count) result.count = Number(count[1]) as ProjectConstraints['count'];
  return result;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function records(collections: Partial<Record<string, unknown[]>> | undefined, key: string) {
  return (collections && Object.hasOwn(collections, key) && Array.isArray(collections[key]) ? collections[key]! : []).map(object).filter(item => typeof item.id === 'string' && item.id.trim() && typeof item.title === 'string' && item.title.trim() && Number.isInteger(item.revision) && Number(item.revision) >= 0);
}
/** Only supplied preview collections are inspected. Notes and Journal are not silently included. */
export function getPreviewProjectContext(collections?: Partial<Record<string, unknown[]>>, householdFlags?: unknown, environmentAvailable = true): ProjectEnvironmentContext {
  const flags = object(householdFlags);
  const homeId = records(collections, 'homeTransitions').at(-1)?.id ?? 'sample-current-home';
  // Untagged legacy records belong to the initial home, never the newly selected home.
  const belongsToHome = (item: Record<string, unknown>) => (item.homeContextId ?? 'sample-current-home') === homeId;
  const gardens = records(collections, 'gardens').filter(belongsToHome);
  const observations = records(collections, 'observations').filter(belongsToHome);
  const assets = records(collections, 'assets').filter(item => belongsToHome(item) && item.status !== 'replaced' && item.factor === 'pfas');
  const contexts = new Set([homeId, ...gardens.map(item => item.id)]);
  const tests = records(collections, 'tests').filter(item => item.archived !== true && contexts.has(item.contextId ?? 'sample-current-home'));
  // A newly selected home has no matching public evidence contract in this preview.
  environmentAvailable = environmentAvailable && homeId === 'sample-current-home';
  const evidence: ProjectEvidence[] = environmentAvailable ? [
    { id: 'preview:today:air:2026-09-30', topic: 'air', label: 'Outdoor air', value: `${factorReadings.air.reading} AQI`, numericValue: factorReadings.air.details.air?.aqi, unit: 'AQI', pollutant: factorReadings.air.details.air?.pollutant, scope: 'Nearby outdoor monitor, not indoor air or smoke detection', asOf: factorReadings.air.asOf, provenance: factorReadings.air.provenance ?? 'Unspecified', stale: true, status: 'available' },
    { id: 'preview:today:uv:2026-09-30', topic: 'uv', label: 'Sunlight forecast', value: `${factorReadings.uv.reading} UV index`, scope: 'September 30 forecast and local 11am to 3pm UV 3+ window, not a current work-time recommendation', asOf: factorReadings.uv.asOf, provenance: 'Forecast', stale: true, status: 'available' },
    { id: 'preview:today:pollen:2026-09-30', topic: 'pollen', label: 'Pollen forecast', value: 'Grass index 3 of 5', scope: 'Outdoor category forecast, not an allergy diagnosis', asOf: factorReadings.pollen.asOf, provenance: 'Forecast', stale: true, status: 'available' },
    { id: 'preview:today:weather:2026-09-30', topic: 'weather', label: 'Outdoor moisture estimate', value: '76% forecast humidity; 55% chance of rain', scope: 'Outdoor weather, not an indoor humidity or mold measurement', asOf: factorReadings.mold.asOf, provenance: 'Weather-based estimate', stale: true, status: 'available' },
    { id: 'preview:home:utility:2025-03', topic: 'water', label: 'Utility water sample', value: `${factorReadings.pfas.reading} ppt PFOS`, scope: 'March 2025 public-system sample, not a test of this tap or garden water', asOf: factorReadings.pfas.asOf, provenance: 'Measured utility sample', stale: false, status: 'available' },
    { id: 'preview:home:radon-zone:2', topic: 'radon', label: 'County radon context', value: 'Iredell County, Zone 2', scope: 'County potential, not an indoor home concentration', asOf: factorReadings.radon.asOf, provenance: 'County estimate', stale: false, status: 'available' },
    { id: 'preview:home:building-era:1975', topic: 'lead', label: 'Building-era context', value: 'Built in 1975', scope: 'User-provided building year, not proof of lead plumbing or paint', asOf: factorReadings.lead.asOf, provenance: 'Estimate from user information', stale: false, status: 'available' },
  ] : [];
  const gardenWaterKnown = gardens.some(item => typeof item.irrigation === 'string' && item.irrigation.trim() !== '' && !/unknown|not supplied|not known/i.test(item.irrigation));
  for (const item of gardens) evidence.push({ id: `preview:garden:${item.id}:${item.revision}`, topic: 'garden', label: String(item.title ?? 'Garden site'), value: `${item.setup ?? 'Setup unknown'}; irrigation ${item.irrigation ?? 'Unknown'}`, scope: 'User-entered garden site, not confirmed soil or crop safety', asOf: 'Recorded by you', provenance: 'User-entered', stale: false, status: 'available' });
  for (const item of observations) evidence.push({ id: `preview:observation:${item.id}:${item.revision}`, topic: 'moisture', label: String(item.title ?? 'Indoor observation'), value: item.reading ? `${item.reading} ${item.unit ?? ''}` : String(item.kind ?? 'Observation'), scope: item.reading ? 'User-entered indoor reading with its stated instrument/source, not verified by HALO' : 'User observation, not an indoor mold measurement', asOf: String(item.observedAt ?? 'Date not supplied'), provenance: 'User-entered', stale: false, status: 'available' });
  for (const item of assets) evidence.push({ id: `preview:asset:${item.id}:${item.revision}`, topic: 'filter', label: String(item.title ?? 'Home care'), value: item.model ? String(item.model) : 'Exact product model not supplied', scope: 'User care record, not certification or a tap-water result', asOf: String(item.serviced ?? 'Date not supplied'), provenance: 'User-entered', stale: false, status: item.model ? 'available' : 'unknown' });
  for (const item of tests.filter(item => item.review === 'needs_clarification')) evidence.push({ id: `preview:test:${item.id}:${item.revision}`, topic: 'test', label: String(item.title ?? 'Test report'), value: String(item.reviewReason ?? 'Report needs clarification'), scope: 'Unclear user transcription, not interpreted environmental evidence', asOf: String(item.collectionStart ?? 'Date not supplied'), provenance: 'User-entered report', stale: false, status: 'unknown' });
  const key = evidence.map(item => `${item.id}:${item.status}`).join('|');
  return { key: `${homeId}|${environmentAvailable ? 'sample-environment' : 'environment-unavailable'}|${key}`, isSample: true, state: environmentAvailable ? 'North Carolina' : '', county: environmentAvailable ? 'Iredell' : '', renter: typeof flags.renter_mode === 'boolean' ? flags.renter_mode : null, evidence, hasGarden: gardens.length > 0, gardenWaterKnown, hasMoistureObservation: observations.length > 0, filterModelKnown: assets.some(item => typeof item.model === 'string' && item.model.trim()), sourceStatus: 'reviewed-drafts' };
}
type FamilyFit = { spaces: ProjectConstraints['space'][]; mode: 'solo' | 'group' | 'either'; start: 'quick' | 'half-day'; budget: 'reuse' | 'low' | 'quote'; topic: string[]; group: string; requires?: string };
const familyFit: Record<string, FamilyFit> = {
  'demo-habitat-project': { spaces: ['yard', 'community'], mode: 'either', start: 'half-day', budget: 'quote', topic: ['plant', 'native', 'pollinator', 'garden', 'flower'], group: 'habitat', requires: 'Confirm permitted ground space, plants and establishment care.' },
  'bee-house': { spaces: ['yard', 'balcony', 'community'], mode: 'either', start: 'half-day', budget: 'quote', topic: ['bee', 'build', 'habitat', 'pollinator'], group: 'build', requires: 'Adult tool supervision, suitable mounting and seasonal nest maintenance are required.' },
  'community-cleanup': { spaces: ['community'], mode: 'group', start: 'quick', budget: 'low', topic: ['cleanup', 'litter', 'community', 'friends'], group: 'community', requires: 'Confirm the actual local organizer, permitted route and disposal before inviting anyone.' },
  'solar-oven': { spaces: ['yard', 'balcony', 'community'], mode: 'either', start: 'half-day', budget: 'low', topic: ['solar', 'energy', 'experiment', 'build', 'fun'], group: 'learning', requires: 'A permitted sunny test space, suitable thermometer and adult supervision are required.' },
  'demo-water-project': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['water', 'report', 'testing', 'pfas', 'lead'], group: 'home' },
  'balcony-pollinators': { spaces: ['balcony', 'yard'], mode: 'solo', start: 'quick', budget: 'quote', topic: ['balcony', 'container', 'small', 'plant', 'pollinator'], group: 'habitat', requires: 'Confirm permission, container placement and load limits.' },
  'native-tree': { spaces: ['yard', 'community'], mode: 'either', start: 'half-day', budget: 'quote', topic: ['tree', 'native', 'habitat', 'plant'], group: 'habitat', requires: 'Confirm mature root/canopy space, utilities, permission and establishment care.' },
  'winter-habitat': { spaces: ['yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['winter', 'leaves', 'habitat', 'season', 'native'], group: 'habitat', requires: 'Keep paths, drains and local fire-clearance areas clear.' },
  'home-compost': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'either', start: 'quick', budget: 'quote', topic: ['compost', 'scraps', 'waste', 'worms'], group: 'waste', requires: 'Choose and maintain the method appropriate to your space; collection must be verified.' },
  'rain-garden-plan': { spaces: ['yard'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['rain', 'runoff', 'drainage', 'water', 'garden'], group: 'water', requires: 'This is a site-planning project, not permission to dig or alter drainage.' },
  'rain-barrel': { spaces: ['yard'], mode: 'either', start: 'quick', budget: 'quote', topic: ['rain', 'barrel', 'water', 'ornamental'], group: 'water', requires: 'Confirm collection rules, stable installation and non-edible ornamental use.' },
  'garden-water': { spaces: ['yard', 'balcony', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['watering', 'irrigation', 'water', 'garden'], group: 'water', requires: 'Resolve the actual garden-water source and applicable watering instructions.' },
  'home-leak-check': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['leak', 'water', 'toilet', 'maintenance'], group: 'home' },
  'soil-test-plan': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['soil', 'test', 'garden', 'lab'], group: 'learning' },
  'food-waste-week': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['food', 'waste', 'kitchen', 'scraps'], group: 'waste' },
  'community-garden': { spaces: ['community'], mode: 'group', start: 'quick', budget: 'low', topic: ['garden', 'community', 'volunteer', 'friends'], group: 'community', requires: 'Confirm an applicable program and actual role. The Mecklenburg example is not a nearby match for Iredell.' },
  'moisture-check': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['moisture', 'humidity', 'condensation', 'damp', 'mold'], group: 'home' },
  'filter-check': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', topic: ['filter', 'pfas', 'water', 'maintenance'], group: 'home' },
  'air-cleaner-plan': { spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'either', start: 'half-day', budget: 'quote', topic: ['air', 'particle', 'smoke', 'filter', 'build'], group: 'build', requires: 'Use the exact reviewed electrical/equipment requirements. No smoke or indoor condition is inferred.' },
};
function contextMatch(guide: ProjectGuide, context: ProjectEnvironmentContext): { boost: number; reason: string; evidenceIds: string[] } {
  const evidenceFor = (...topics: ProjectEvidence['topic'][]) => context.evidence.filter(item => topics.includes(item.topic)).map(item => item.id);
  if (guide.id === 'air-cleaner-plan' && context.evidence.some(item => item.topic === 'air' && item.status === 'available' && !item.stale && item.unit === 'AQI' && item.pollutant === 'PM2.5' && Number.isFinite(item.numericValue) && item.numericValue! > 100)) return { boost: 36, reason: 'The supplied current outdoor fine-particle reading makes reviewing filtration equipment relevant. It does not measure indoor air or establish smoke.', evidenceIds: evidenceFor('air') };
  if (guide.id === 'soil-test-plan' && context.evidence.some(item => item.topic === 'test')) return { boost: 58, reason: 'Your garden report needs clarification. Start by matching the question to the right laboratory scope.', evidenceIds: evidenceFor('test', 'garden') };
  if (guide.id === 'moisture-check' && context.hasMoistureObservation) return { boost: 54, reason: 'You recorded an indoor moisture observation. This follows up on that record, not the outdoor forecast.', evidenceIds: evidenceFor('moisture') };
  if (guide.id === 'filter-check' && context.evidence.some(item => item.topic === 'filter')) return { boost: 50, reason: context.filterModelKnown ? 'Your home-care record can help you check the exact filter instructions.' : 'Your filter record is missing its exact model. Clarify its scope before choosing a routine.', evidenceIds: evidenceFor('filter', 'water') };
  if (guide.id === 'demo-water-project' && context.evidence.some(item => item.topic === 'water' || item.topic === 'lead')) return { boost: 45, reason: 'Your utility sample and building-era estimate leave a useful water question. Neither is a test of your tap.', evidenceIds: evidenceFor('water', 'lead') };
  if (guide.id === 'garden-water' && context.hasGarden) return { boost: 39, reason: context.gardenWaterKnown ? 'You have a garden-water context to check against actual plant needs.' : 'Your garden-water source is unknown. Resolve that before setting a watering routine.', evidenceIds: evidenceFor('garden') };
  if (['demo-habitat-project', 'balcony-pollinators', 'winter-habitat'].includes(guide.id) && context.hasGarden) return { boost: 20, reason: 'A garden is recorded in Homeguard. Check its permitted space and conditions before choosing plants or habitat care.', evidenceIds: evidenceFor('garden') };
  return { boost: 0, reason: 'A practical option to explore, not a response to a measured problem at your home.', evidenceIds: [] };
}
/** Source-reviewed blueprints + deterministic relevance/diversity, never model health-risk ranking. */
export function generateProjectSuggestions(context: ProjectEnvironmentContext, constraints: ProjectConstraints = defaultProjectConstraints, request = ''): ProjectSuggestion[] {
  const fit = context.requestConstraints === 'explicit' ? normalizeProjectConstraints(constraints) : inferProjectConstraints(request, constraints);
  if (context.sourceStatus === 'unavailable') return [];
  const text = request.toLocaleLowerCase('en');
  const candidates = projectGuides.flatMap((guide, index) => {
    const family = familyFit[guide.id];
    if (!family || !guide.sources.length || !guide.steps.length) return [];
    if (fit.space !== 'any' && !family.spaces.includes(fit.space)) return [];
    if (fit.mode === 'solo' && family.mode === 'group') return [];
    if (fit.mode === 'group' && family.mode === 'solo') return [];
    if (fit.time === 'quick' && family.start !== 'quick') return [];
    if (fit.time === 'half-day' && family.start !== 'half-day') return [];
    if (fit.time === 'ongoing' && !['demo-habitat-project', 'bee-house', 'balcony-pollinators', 'native-tree', 'winter-habitat', 'home-compost', 'rain-barrel', 'garden-water'].includes(guide.id)) return [];
    if (fit.budget === 'reuse' && family.budget !== 'reuse') return [];
    if (fit.budget === 'low' && family.budget === 'quote') return [];
    const match = contextMatch(guide, context);
    const requestScore = family.topic.filter(word => new RegExp(`\\b${word}\\w*\\b`, 'i').test(text)).length * 35;
    if (context.interestOnly && requestScore === 0) return [];
    const outdoorWork = !family.spaces.includes('indoors');
    const dailyEvidence = outdoorWork ? context.evidence.filter(item => ['air', 'uv', 'pollen', 'weather'].includes(item.topic)) : [];
    const checks = [family.requires, ...(outdoorWork ? [dailyEvidence.some(item => item.stale) ? 'Today’s September 30 examples are outdated. Review current air, sun and pollen conditions before choosing outdoor work time.' : 'Review current air, sun, pollen and weather before choosing outdoor work time.'] : []), ...(guide.scope.includes('North Carolina') && !/^(north carolina|nc)$/i.test(context.state) ? ['The source is North Carolina guidance. Recheck regional suitability before using it here.'] : []), ...(context.renter === true && family.spaces.length === 1 && family.spaces[0] === 'yard' ? ['Owner permission and any property modification requirements must be confirmed.'] : [])].filter((value): value is string => !!value);
    const suggestion: ProjectSuggestion = {
      id: guide.id, title: guide.title, reason: requestScore ? `Matches your request for ${family.topic.find(word => new RegExp(`\\b${word}\\w*\\b`, 'i').test(text)) ?? 'a practical project'}. ${match.boost ? match.reason : 'Check the materials and suitability before starting.'}` : match.reason,
      tags: [family.start === 'quick' ? 'Small first step' : 'Build or planting session', family.mode === 'group' ? 'With a group' : family.mode === 'solo' ? 'On your own' : 'Solo or together', family.budget === 'reuse' ? 'Start with what you have' : family.budget === 'low' ? 'Check basic supplies' : 'Price materials first'],
      evidenceIds: [...new Set([...match.evidenceIds, ...dailyEvidence.map(item => item.id)])], sourceIds: guide.sources.map(source => source.id), fit: requestScore ? 'interest' : match.boost ? 'context' : 'general', needsCheck: checks,
    };
    const rotatedIndex = (index + Math.max(0, context.variation ?? 0) * 5) % projectGuides.length;
    const repetition = context.previousIdeaIds?.includes(guide.id) ? 180 : 0;
    return [{ suggestion, score: match.boost + requestScore + (fit.space !== 'any' ? 15 : 0) - repetition, group: family.group, index: rotatedIndex }];
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof candidates = [];
  const counts = new Map<string, number>();
  while (candidates.length && selected.length < fit.count) {
    // Avoid repeated gardening cards while keeping explicit request relevance strongest.
    candidates.sort((a, b) => (b.score - (counts.get(b.group) ?? 0) * 16) - (a.score - (counts.get(a.group) ?? 0) * 16) || a.index - b.index);
    const next = candidates.shift()!; selected.push(next); counts.set(next.group, (counts.get(next.group) ?? 0) + 1);
  }
  return selected.map(item => item.suggestion);
}
export function createProjectGeneration(context: ProjectEnvironmentContext, constraints: ProjectConstraints = defaultProjectConstraints, request = '', generation = 1, interpretRequestConstraints = true): ProjectGenerationState {
  const normalized = interpretRequestConstraints ? inferProjectConstraints(request, constraints) : normalizeProjectConstraints(constraints);
  const nextGeneration = Number.isInteger(generation) && generation > 0 ? generation : 1;
  return { request, constraints: normalized, items: generateProjectSuggestions({ ...context, variation: nextGeneration - 1, requestConstraints: interpretRequestConstraints ? 'interpret' : 'explicit' }, normalized, request), contextKey: context.key, generation: nextGeneration };
}
export function projectGenerationNotice(context: ProjectEnvironmentContext, state: ProjectGenerationState): string {
  if (context.sourceStatus === 'unavailable') return 'Project sources are unavailable. Keep your choices and retry; this is not a no-match result.';
  if (!state.items.length) return 'No reviewed projects fit all of those choices. Broaden one preference to see other practical options.';
  if (state.items.length < state.constraints.count) return `${state.items.length} reviewed ideas fit these choices. HALO does not invent unsuitable projects to fill the list.`;
  return 'Ideas use your HALO context, interests and reviewed guides.';
}
