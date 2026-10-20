/**
 * The screen code the B12 public evidence reads are judged by, TRANSCRIBED,
 * not summarised, from this tree: TypeScript to JavaScript with the type
 * annotations removed and nothing else changed. The adapter, runtime and
 * validators are NOT transcribed: test/contractsB12.test.mjs loads the real
 * TypeScript (lib/frontend/production/adapters.ts, runtime.ts,
 * home-resources.ts) through test/frontend-test-loader.mjs. Only the lines
 * inside React components, which cannot be imported, are copied here:
 *
 * - `components/homeguard/FoodFish.tsx:23` (matchFishRules, production mode),
 *   `:48` (matches) and `:49` (choices);
 * - `components/homeguard/FoodGrower.tsx:19` (the concern and region filter);
 * - `components/homeguard/FoodWater.tsx:47-49` (releases, release, notice) and
 *   the `% of county area` cell of `:52`;
 * - `components/homeguard/FoodEvidence.tsx:31` (the filters).
 *
 * `FRAGMENTS` lists text that must occur character for character both in the
 * frontend file and in this file; the drift test in contractsB12 reads both at
 * test time, so a change to any of those lines fails it.
 */

// FoodFish.tsx:21-23, with `mode` passed in; `catalogue` is result.data.
export function fishScreen(catalogue, mode = 'production') {
  const { waterbodies: fishWaterbodies, audiences: fishAudiences, rules: fishRules } = catalogue;
  const matchFishRules = (waterbody, species) => !fishWaterbodies.some(item => item.id === waterbody) || species === 'unknown' ? [] : fishRules.filter(rule => rule.species === species && (rule.waterbody === waterbody || rule.waterbody === 'statewide' && (mode === 'preview' || rule.waterbodyIds?.includes(waterbody))));
  // FoodFish.tsx:48-50
  const view = (selection, scenario = 'ready') => {
    const matches = scenario === 'empty' ? [] : matchFishRules(selection.waterbody, selection.species);
    const choices = fishWaterbodies.filter(item => `${item.title} ${item.jurisdiction}`.toLowerCase().includes(selection.query.toLowerCase()));
    const waterbody = fishWaterbodies.find(item => item.id === selection.waterbody);
    return { matches, choices, waterbody };
  };
  return { matchFishRules, view, fishAudiences };
}

// FoodGrower.tsx:19
export function growerScreen(growerResources, filters) {
  const resources = growerResources.filter(item => (filters.concern === 'All' || item.concern === filters.concern) && (filters.region === 'All' || item.region === filters.region));
  return resources;
}

// FoodWater.tsx:47-49 and the cell text of :52.
export function waterScreen(data, selection) {
  const releases = data?.releases.filter(item => item.countyId === selection.county) ?? [];
  const release = releases.find(item => item.id === selection.release);
  const notice = data?.notices.find(item => item.id === selection.notice);
  const cells = release ? ['none', 'd0', 'd1', 'd2', 'd3', 'd4'].map(key => `${release[key]}% of county area`) : [];
  return { releases, release, notice, cells };
}

// FoodEvidence.tsx:31
export function evidenceScreen(foodEvidence, filters, scenario = 'ready') {
  const matches = scenario === 'empty' ? [] : foodEvidence.filter(item => (filters.region === 'All' || item.region === filters.region) && (filters.category === 'All' || item.category === filters.category) && (filters.kind === 'All' || item.kind === filters.kind));
  return matches;
}

// HomeResource.tsx:14-24 (useHomeResource's production effect), as one awaited read.
export async function homeResource(service, resource, query, validate) {
  const signature = JSON.stringify(query);
  const controller = new AbortController();
  try {
    if (!service?.readResource) throw new Error('This information is not available yet. Try again later.');
    const value = await service.readResource(resource, JSON.parse(signature), controller.signal);
    if (!validate(value)) throw new Error('This information could not be verified. Try again.');
    return { signature, data: value, status: 'ready', error: '' };
  } catch (error) {
    return { signature, data: null, status: 'error', error: error instanceof Error ? error.message.replaceAll('\u2014', ',') : 'This information could not load. Try again.' };
  }
}

export const FRAGMENTS = [
  { file: 'components/homeguard/HomeResource.tsx', text: "if (!service?.readResource) throw new Error('This information is not available yet. Try again later.');" },
  { file: 'components/homeguard/HomeResource.tsx', text: 'service.readResource(resource, JSON.parse(signature)' },
  { file: 'components/homeguard/HomeResource.tsx', text: "error.message.replaceAll('\\u2014', ',') : 'This information could not load. Try again.'" },
  { file: 'components/homeguard/FoodFish.tsx', text: "=> !fishWaterbodies.some(item => item.id === waterbody) || species === 'unknown' ? [] : fishRules.filter(rule => rule.species === species && (rule.waterbody === waterbody || rule.waterbody === 'statewide' && (mode === 'preview' || rule.waterbodyIds?.includes(waterbody))));" },
  { file: 'components/homeguard/FoodFish.tsx', text: "const matches = scenario === 'empty' ? [] : matchFishRules(selection.waterbody, selection.species);" },
  { file: 'components/homeguard/FoodFish.tsx', text: 'const choices = fishWaterbodies.filter(item => `${item.title} ${item.jurisdiction}`.toLowerCase().includes(selection.query.toLowerCase()));' },
  { file: 'components/homeguard/FoodFish.tsx', text: 'const { waterbodies: fishWaterbodies, audiences: fishAudiences, rules: fishRules } = catalogue;' },
  { file: 'components/homeguard/FoodGrower.tsx', text: "const resources = growerResources.filter(item => (filters.concern === 'All' || item.concern === filters.concern) && (filters.region === 'All' || item.region === filters.region));" },
  { file: 'components/homeguard/FoodWater.tsx', text: 'const releases = data?.releases.filter(item => item.countyId === selection.county) ?? [];' },
  { file: 'components/homeguard/FoodWater.tsx', text: 'const release = releases.find(item => item.id === selection.release);' },
  { file: 'components/homeguard/FoodWater.tsx', text: 'const notice = data?.notices.find(item => item.id === selection.notice);' },
  { file: 'components/homeguard/FoodWater.tsx', text: '% of county area' },
  { file: 'components/homeguard/FoodEvidence.tsx', text: "const matches = scenario === 'empty' ? [] : foodEvidence.filter(item => (filters.region === 'All' || item.region === filters.region) && (filters.category === 'All' || item.category === filters.category) && (filters.kind === 'All' || item.kind === filters.kind));" },
  { file: 'components/homeguard/HomeResource.tsx', text: "if (!validate(value)) throw new Error('This information could not be verified. Try again.');" },
];
