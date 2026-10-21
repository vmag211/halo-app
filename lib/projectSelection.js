/**
 * Explore project ideas without a model (B16 plan, Rulings J1, J5, J7, J8).
 *
 * "Generation" is a deterministic, explainable selection from the curated
 * library (lib/data/exploreProjectLibrary.json, built by
 * scripts/build-project-library.mjs from the reviewed source-backed guides),
 * ranked by the household's dated evidence (lib/projectEvidence.js) and the
 * person's stated choices. Pure module: no database, no clock, no network.
 *
 * The same inputs always give the same ideas. Every reason is a fixed
 * server-authored sentence that names what HALO actually saw, never a health
 * or environmental benefit. The count asked for is a ceiling, not a quota: a
 * project that does not fit a stated choice is never added to fill the list,
 * and the answer says so (the contract's "Return fewer useful ideas").
 *
 * Transcribed from the client (do not "fix", the drift test in
 * test/projectSelection.test.mjs runs both over one corpus):
 *   validProjectConstraints    lib/frontend/production/explore-service.ts:14-16
 *   normalizeProjectConstraints, inferProjectConstraints
 *                              lib/frontend/explore-personalization.ts:40-66
 * The ranking follows that file's generateProjectSuggestions (:135-172), with
 * the preview's sample evidence replaced by the server's.
 */
import library from './data/exploreProjectLibrary.json' with { type: 'json' };

export const PROJECT_LIBRARY = library;
export const LIBRARY_GUIDES = Object.freeze(library.projects.map((project) => project.guide));
const BY_ID = new Map(library.projects.map((project) => [project.id, project]));

/** The library project with this id, or undefined. */
export const libraryProject = (id) => BY_ID.get(id);

const choices = {
  space: ['any', 'indoors', 'balcony', 'yard', 'community'],
  mode: ['any', 'solo', 'group'],
  time: ['any', 'quick', 'half-day', 'ongoing'],
  budget: ['any', 'reuse', 'low'],
};
export const COUNTS = Object.freeze([3, 5, 10, 11, 12, 13, 14, 15]);
export const DEFAULT_CONSTRAINTS = Object.freeze({ space: 'any', mode: 'any', time: 'any', budget: 'any', count: 12 });

// F: lib/frontend/production/explore-service.ts:8, 13-16
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const member = (value, values) => typeof value === 'string' && values.includes(value);
export function validProjectConstraints(value) {
  return object(value) && member(value.space,['any','indoors','balcony','yard','community']) && member(value.mode,['any','solo','group']) && member(value.time,['any','quick','half-day','ongoing']) && member(value.budget,['any','reuse','low']) && typeof value.count==='number'&&[3,5,10,11,12,13,14,15].includes(value.count);
}

// F: lib/frontend/explore-personalization.ts:40-66
export function normalizeProjectConstraints(value = {}) {
  const normalized = { ...DEFAULT_CONSTRAINTS };
  for (const key of ['space', 'mode', 'time', 'budget']) {
    const candidate = value[key];
    if (candidate && choices[key].includes(candidate)) Object.assign(normalized, { [key]: candidate });
  }
  if ([3, 5, 10, 11, 12, 13, 14, 15].includes(value.count ?? 0)) normalized.count = value.count;
  return normalized;
}
export function inferProjectConstraints(request, current = DEFAULT_CONSTRAINTS) {
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
  if (count) result.count = Number(count[1]);
  return result;
}

/** Fixed sentences, no U+2014 (AGENTS.md). */
export const SELECTION_COPY = Object.freeze({
  general: 'A practical option to explore, not a response to a measured problem at your home.',
  outdoorCurrent: 'Check current air, sun, pollen and weather before choosing outdoor work time.',
  outdoorStale: (date) => `HALO's latest outdoor readings for your home are from ${date}. Check current air, sun, pollen and weather before choosing outdoor work time.`,
  outdoorNone: 'HALO has no recent outdoor reading for your home. Check current air, sun, pollen and weather before choosing outdoor work time.',
  region: 'The source is North Carolina guidance. Recheck regional suitability before using it here.',
  owner: 'Owner permission and any property modification requirements must be confirmed.',
  none: 'No reviewed projects fit all of those choices. Broaden one preference to see other practical options.',
  noInterest: 'No reviewed projects match that interest yet. Try other words, or clear the request to see practical options.',
  fewer: (n) => `${n} reviewed ${n === 1 ? 'idea fits' : 'ideas fit'} these choices. HALO does not invent unsuitable projects to fill the list.`,
  full: 'Ideas use your HALO context, your choices and reviewed public guidance.',
});

const DAILY_TOPICS = ['air', 'uv', 'pollen', 'weather'];
const HABITAT = ['native-pollinator-space', 'balcony-pollinators', 'winter-habitat'];

/** Why a project is relevant to this household's evidence (the preview's contextMatch, server evidence). */
function contextMatch(id, evidence) {
  const ids = (...topics) => evidence.filter((item) => topics.includes(item.topic) && item.status === 'available').map((item) => item.id);
  const has = (topic, test = () => true) => evidence.some((item) => item.topic === topic && item.status !== undefined && test(item));
  if (id === 'air-cleaner-plan' && has('air', (item) => item.status === 'available' && !item.stale && item.unit === 'AQI' && item.pollutant === 'PM2.5' && Number.isFinite(item.numericValue) && item.numericValue > 100)) {
    return { boost: 36, reason: 'Your current outdoor fine-particle reading makes reviewing filtration equipment relevant. It does not measure indoor air or establish smoke.', evidenceIds: ids('air') };
  }
  if (id === 'soil-test-plan' && has('test')) {
    return { boost: 58, reason: 'A test report in Homeguard needs clarification. Start by matching the question to the right laboratory scope.', evidenceIds: evidence.filter((item) => ['test', 'garden'].includes(item.topic)).map((item) => item.id) };
  }
  if (id === 'moisture-check' && has('moisture')) {
    return { boost: 54, reason: 'You recorded an indoor moisture observation. This follows up on that record, not an outdoor forecast.', evidenceIds: evidence.filter((item) => item.topic === 'moisture').map((item) => item.id) };
  }
  if (id === 'filter-check' && has('filter')) {
    const known = evidence.some((item) => item.topic === 'filter' && item.status === 'available');
    return { boost: 50, reason: known ? 'Your home-care record can help you check the exact filter instructions.' : 'Your filter record is missing its exact model. Clarify its scope before choosing a routine.', evidenceIds: evidence.filter((item) => ['filter', 'water'].includes(item.topic)).map((item) => item.id) };
  }
  if (id === 'water-report-check' && has('water', (item) => item.status === 'available')) {
    return { boost: 45, reason: 'Your recorded water source leaves a useful water question. It is not a test of your tap.', evidenceIds: ids('water', 'lead') };
  }
  if (id === 'garden-water' && has('garden')) {
    const known = evidence.some((item) => item.topic === 'garden' && item.status === 'available');
    return { boost: 39, reason: known ? 'You have a garden-water context to check against actual plant needs.' : 'Your garden-water source is not recorded. Resolve that before setting a watering routine.', evidenceIds: evidence.filter((item) => item.topic === 'garden').map((item) => item.id) };
  }
  if (HABITAT.includes(id) && has('garden')) {
    return { boost: 20, reason: 'A garden is recorded in Homeguard. Check its permitted space and conditions before choosing plants or habitat care.', evidenceIds: evidence.filter((item) => item.topic === 'garden').map((item) => item.id) };
  }
  return { boost: 0, reason: SELECTION_COPY.general, evidenceIds: [] };
}

const isNorthCarolina = (state) => typeof state === 'string' && /^(north carolina|nc)$/i.test(state.trim());

/**
 * The idea set for one request.
 *
 *   input.evidence        ProjectEvidence[] (lib/projectEvidence.js)
 *   input.constraints     a valid ProjectConstraints
 *   input.request         the person's interest text (at most 500 characters)
 *   input.interpret       true: read choices out of the text and keep only
 *                         ideas the text asks for (the client's direct-interest
 *                         shortlist); false: the explicit choices win
 *   input.previousIdeaIds the ideas the person has just seen, ranked last
 *   input.generation      this set's number (1 for the first), which rotates
 *                         equally relevant general ideas
 *   input.state           the state the scope check compares with
 *   input.renter          true, false or null
 *
 * Returns `{ constraints, items, message }`.
 */
export function selectProjects({ evidence = [], constraints, request = '', interpret = false, previousIdeaIds = [], generation = 1, state = null, renter = null }) {
  const fit = interpret ? inferProjectConstraints(request, constraints) : normalizeProjectConstraints(constraints);
  const text = request.toLocaleLowerCase('en');
  // A direct interest asks for a shortlist of what it names; an empty one asks for nothing in particular.
  const interestOnly = interpret && text.trim() !== '';
  const daily = evidence.filter((item) => DAILY_TOPICS.includes(item.topic));
  const dailyAvailable = daily.filter((item) => item.status === 'available');
  const dailyStale = dailyAvailable.length > 0 && dailyAvailable.every((item) => item.stale);
  const outdoorCheck = !dailyAvailable.length ? SELECTION_COPY.outdoorNone
    : dailyStale ? SELECTION_COPY.outdoorStale(dailyAvailable.map((item) => item.asOf).sort().at(-1)) : SELECTION_COPY.outdoorCurrent;
  const previous = new Set(previousIdeaIds);
  const rotation = Math.max(0, generation - 1) * 5;

  const candidates = library.projects.flatMap((project, index) => {
    const { guide, fit: family } = project;
    if (fit.space !== 'any' && !family.spaces.includes(fit.space)) return [];
    if (fit.mode === 'solo' && family.mode === 'group') return [];
    if (fit.mode === 'group' && family.mode === 'solo') return [];
    if (fit.time === 'quick' && family.start !== 'quick') return [];
    if (fit.time === 'half-day' && family.start !== 'half-day') return [];
    if (fit.time === 'ongoing' && !family.ongoing) return [];
    if (fit.budget === 'reuse' && family.budget !== 'reuse') return [];
    if (fit.budget === 'low' && family.budget === 'quote') return [];
    const match = contextMatch(project.id, evidence);
    const words = family.topic.filter((word) => new RegExp(`\\b${word}\\w*\\b`, 'i').test(text));
    const requestScore = words.length * 35;
    if (interestOnly && requestScore === 0) return [];
    const outdoor = !family.spaces.includes('indoors');
    const checks = [
      family.requires,
      ...(outdoor ? [outdoorCheck] : []),
      ...(guide.scope.includes('North Carolina') && !isNorthCarolina(state) ? [SELECTION_COPY.region] : []),
      ...(renter === true && family.spaces.length === 1 && family.spaces[0] === 'yard' ? [SELECTION_COPY.owner] : []),
    ].filter((value) => typeof value === 'string' && value);
    const item = {
      id: guide.id,
      title: guide.title,
      reason: requestScore ? `Matches your request for ${words[0]}. ${match.boost ? match.reason : 'Check the materials and suitability before starting.'}` : match.reason,
      tags: [
        family.start === 'quick' ? 'Small first step' : 'Build or planting session',
        family.mode === 'group' ? 'With a group' : family.mode === 'solo' ? 'On your own' : 'Solo or together',
        family.budget === 'reuse' ? 'Start with what you have' : family.budget === 'low' ? 'Check basic supplies' : 'Price materials first',
      ],
      evidenceIds: [...new Set([...match.evidenceIds, ...(outdoor ? daily.map((entry) => entry.id) : [])])],
      sourceIds: guide.sources.map((source) => source.id),
      fit: requestScore ? 'interest' : match.boost ? 'context' : 'general',
      needsCheck: checks,
    };
    const score = match.boost + requestScore + (fit.space !== 'any' ? 15 : 0) - (previous.has(guide.id) ? 180 : 0);
    return [{ item, score, group: family.group, index: (index + rotation) % library.projects.length }];
  });

  const selected = [];
  const counts = new Map();
  while (candidates.length && selected.length < fit.count) {
    // Avoid repeated cards of one kind while keeping explicit request relevance strongest.
    candidates.sort((a, b) => (b.score - (counts.get(b.group) ?? 0) * 16) - (a.score - (counts.get(a.group) ?? 0) * 16) || a.index - b.index);
    const next = candidates.shift();
    selected.push(next);
    counts.set(next.group, (counts.get(next.group) ?? 0) + 1);
  }
  const items = selected.map((entry) => entry.item);
  const message = !items.length ? (interestOnly ? SELECTION_COPY.noInterest : SELECTION_COPY.none)
    : items.length < fit.count ? SELECTION_COPY.fewer(items.length) : SELECTION_COPY.full;
  return { constraints: fit, items, message };
}
