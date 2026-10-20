/**
 * What the two Explore screens do with the B18 directory, TRANSCRIBED from
 * components/expanded/ExploreOpportunities.tsx and ExploreDiscovery.tsx
 * (`VolunteeringFinder`): TypeScript and JSX to JavaScript, React state as
 * plain fields, nothing else changed. The runtime, the validators and
 * `opportunityState` are NOT transcribed: they are the real
 * lib/frontend/production/runtime.ts, explore-service.ts and
 * explore-opportunities.ts, compiled from this tree by
 * test/frontend-test-loader.mjs.
 *
 * - ExploreOpportunities.tsx `:51` the read, `:52` result, `:54-56` listings,
 *   matches and staleCoverage, `:64` the location label, `:65` the coverage
 *   sentence, `:66` the loading or error status, `:70` the empty heading,
 *   `:71` the next-page button;
 * - ExploreDiscovery.tsx `:74` the read, `:75` result, `:76` matches, `:79`
 *   the status line under the list and the next-page button.
 *
 * `useProductionResource` (components/production/ProductionContext.tsx:8-19)
 * is modelled as one request per read with its input JSON-round-tripped as
 * that hook does: `data` on success, `error` its `serviceMessage`.
 * `FRAGMENTS` lists text that must occur character for character in both the
 * frontend file named and this file; the drift test reads all three, so a
 * change to any of those lines fails it.
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const { serviceMessage } = await loadFrontend('production/runtime');
const { validOpportunityResults, validOrganizations, validOpportunity } = await loadFrontend('production/explore-service');
const { opportunityState } = await loadFrontend('explore-opportunities');

export { validOpportunityResults, validOrganizations, validOpportunity, opportunityState };

const blankArea = { place: '', state: '' };
const areaLabel = (area) => [area.place.trim(), area.state.trim()].filter(Boolean).join(', ');

async function resource(runtime, operation, input, enabled) {
  if (!runtime || !enabled) return { data: null, loading: false, error: null };
  const signature = JSON.stringify(input);
  try { return { data: await runtime.request(operation, JSON.parse(signature), { signal: new AbortController().signal }), loading: false, error: null }; }
  catch (error) { return { data: null, loading: false, error: serviceMessage(error) }; }
}

/** The "Get involved" list for `runtime`, as ExploreOpportunities renders it at `now`. */
export async function opportunitiesScreen(runtime, { area = blankArea, interest = 'All interests', search = '', timing = 'all', cursor = null, now = Date.now() } = {}) {
  const filters = { scope: 'auto', interest, search };
  const scope = 'examples';
  const live = await resource(runtime, 'opportunities.search', {area,interest:filters.interest,search:filters.search,timing,cursor}, Boolean(runtime));
  const result=validOpportunityResults(live.data)?live.data:null;
  const listings=runtime?result?.items??[]:[];
  const matches = now === null ? [] : runtime?listings.filter(item=>['upcoming','rolling'].includes(opportunityState(item,now))):[];
  const staleCoverage = now !== null && listings.some(item => (runtime||scope === 'examples' || item.scopes.includes(scope)) && opportunityState(item, now) === 'needs-check');
  const location = runtime?result?.areaLabel||areaLabel(area)||'Choose your area':'';
  const coverage = result?`Sources checked ${result.checkedAt}. ${result.complete?'This result set is complete.':'More listings may be available.'}`:'Source coverage is being checked.';
  const status = runtime&&Boolean(live.loading||live.error||live.data&&!result)?(live.loading?'Finding local opportunities':live.error||'The listing response was incomplete. Try refreshing.'):null;
  const empty = now !== null && !matches.length && !live.loading && !live.error ? (runtime&&result?.availability==='unavailable'?'Local listings unavailable':runtime&&result?.availability==='no_coverage'||!runtime&&scope === 'elsewhere' ? 'No reviewed local coverage' : staleCoverage ? 'Listing updates needed' : 'No matching upcoming listings') : null;
  const next = runtime&&result?.nextCursor ? result.nextCursor : null;
  return { live, result, listings, matches, staleCoverage, location, coverage, status, empty, next, shown: matches.map((item) => item.id) };
}

/** The organizations list for `runtime`, as VolunteeringFinder renders it. */
export async function organizationsScreen(runtime, { area = blankArea, interest = 'All interests', search = '', cursor = null } = {}) {
  const filters = { scope: 'auto', interest, search };
  const live = await resource(runtime, 'organizations.search', {area,interest:filters.interest,search:filters.search,cursor}, Boolean(runtime));
  const result=validOrganizations(live.data)?live.data:null;
  const matches = runtime?result?.items??[]:[];
  const line = live.loading?'Finding organizations...':live.error||live.data&&!result?(live.error||'Organization details were incomplete.'):!matches.length?'No matching organizations were returned. Try the official discovery routes.':null;
  const next = (result?.nextCursor&&result.nextCursor) || null;
  return { live, result, matches, line, next, shown: matches.map((item) => item.id) };
}

/** Text that must stay identical in the named frontend file and here. */
export const FRAGMENTS = Object.freeze({
  'components/expanded/ExploreOpportunities.tsx': [
    "('opportunities.search',{area,interest:filters.interest,search:filters.search,timing,cursor},Boolean(runtime))",
    'const result=validOpportunityResults(live.data)?live.data:null;',
    'const listings=runtime?result?.items??[]:',
    "runtime?listings.filter(item=>['upcoming','rolling'].includes(opportunityState(item,now))):",
    "const staleCoverage = now !== null && listings.some(item => (runtime||scope === 'examples' || item.scopes.includes(scope)) && opportunityState(item, now) === 'needs-check');",
    "runtime?result?.areaLabel||areaLabel(area)||'Choose your area':",
    "result?`Sources checked ${result.checkedAt}. ${result.complete?'This result set is complete.':'More listings may be available.'}`:'Source coverage is being checked.'",
    'runtime&&Boolean(live.loading||live.error||live.data&&!result)',
    "live.error||'The listing response was incomplete. Try refreshing.'",
    'now !== null && !matches.length && !live.loading && !live.error',
    "runtime&&result?.availability==='unavailable'?'Local listings unavailable':runtime&&result?.availability==='no_coverage'||!runtime&&scope === 'elsewhere' ? 'No reviewed local coverage' : staleCoverage ? 'Listing updates needed' : 'No matching upcoming listings'",
    'runtime&&result?.nextCursor',
  ],
  'components/expanded/ExploreDiscovery.tsx': [
    "('organizations.search',{area,interest:filters.interest,search:filters.search,cursor},Boolean(runtime))",
    'const result=validOrganizations(live.data)?live.data:null;',
    'const matches = runtime?result?.items??[]:',
    "live.loading?",
    "live.error||live.data&&!result?",
    "live.error||'Organization details were incomplete.'",
    'No matching organizations were returned. Try the official discovery routes.',
    'result?.nextCursor&&',
  ],
});
