/**
 * B12 conformance: the frontend's OWN consumption code over the REAL handlers,
 * asserting what the Food and Garden screens then show.
 *
 * The chain is the production one, end to end:
 *   createProductionRuntime (lib/frontend/production/runtime.ts)
 *   -> createHomeAdapter(...).readResource (adapters.ts:17,30)
 *   -> fetcher -> the real route handler on the harness
 *   -> useHomeResource's validate step (HomeResource.tsx, transcribed)
 *   -> the real validators (home-resources.ts)
 *   -> each screen's matching and filter lines (transcribed in
 *      test/helpers/frontendB12.mjs, with the drift test below).
 * The runtime, adapter and validators are the TypeScript itself, loaded by
 * test/frontend-test-loader.mjs, not copies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import * as fe from './helpers/frontendB12.mjs';

const { createProductionRuntime } = await loadFrontend('production/runtime');
const { createHomeAdapter } = await loadFrontend('production/adapters');
const validators = await loadFrontend('production/home-resources');
const frontendFood = await loadFrontend('food-evidence');
const { foodCatalogue } = await loadFrontend('food-catalogue');
const { _setEvidenceFileForTest } = await import('@/lib/publicEvidence');

const ORIGIN = 'http://halo.test';

function world({ as = 'alice', rateLimit } = {}) {
  const h = createRouteHarness({ tables: haloTables('profiles'), seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id }, { id: bob.id }] }), rateLimit });
  const me = h.identities[as];
  const sent = [];
  const fetcher = async (path, init) => {
    sent.push({ path, method: init.method, headers: { ...init.headers } });
    return h.call(new URL(path, ORIGIN).pathname, init.method, { url: path, headers: init.headers });
  };
  const runtime = createProductionRuntime({
    identityId: me.id, homeContextId: 'home-context-1',
    credential: async () => ({ identityId: me.id, accessToken: me.token }),
    fetcher,
  });
  const service = createHomeAdapter(runtime, { homeContextId: 'home-context-1' });
  return { h, me, sent, service };
}

const read = (w, resource, query, validator) => fe.homeResource(w.service, resource, query, validators[validator]);

// ------------------------------------------------------------------- drift

test('the transcribed screen lines still match the frontend, character for character', async () => {
  const mine = await readFile(new URL('./helpers/frontendB12.mjs', import.meta.url), 'utf8');
  for (const fragment of fe.FRAGMENTS) {
    const source = await readFile(new URL(`../${fragment.file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(fragment.text), `${fragment.file} no longer contains: ${fragment.text}`);
    assert.ok(mine.includes(fragment.text), `frontendB12.mjs no longer contains: ${fragment.text}`);
  }
});

test('the adapter still routes each resource to the operation and path the routes serve', async () => {
  const adapters = await readFile(new URL('../lib/frontend/production/adapters.ts', import.meta.url), 'utf8');
  assert.ok(adapters.includes("const resources:Record<string,string>={'fish-catalogue':'fish.read','food-evidence':'food.search','grower-resources':'growers.search','water-stewardship':'water.read','published-food-evidence':'food.search'};"));
  const runtime = await readFile(new URL('../lib/frontend/production/runtime.ts', import.meta.url), 'utf8');
  for (const line of ["'food.search': {path:'/api/food/evidence'},", "'fish.read': {path:'/api/fish/advisories'},", "'water.read': {path:'/api/water/notices'},", "'growers.search': {path:'/api/growers'},"]) assert.ok(runtime.includes(line), line);
});

test('the published food bundle equals the frontend\'s own evidenceForFood for every catalogue food', async () => {
  const w = world();
  const ids = [...foodCatalogue.map((food) => food.id), 'not-a-food', undefined];
  for (const foodId of ids) {
    const guideId = foodCatalogue.find((food) => food.id === foodId)?.guideId;
    const result = await read(w, 'published-food-evidence', { ...(foodId ? { foodId } : {}), ...(guideId ? { guideId } : {}) }, 'validPublishedFoodEvidence');
    assert.equal(result.status, 'ready', `${foodId}: ${result.error}`);
    assert.deepEqual(result.data, JSON.parse(JSON.stringify(frontendFood.evidenceForFood({ foodId, guideId }))), `${foodId}`);
  }
  const studies = JSON.parse(await readFile(new URL('../lib/data/foodEvidenceStudies.json', import.meta.url), 'utf8'));
  assert.deepEqual(studies.studies, JSON.parse(JSON.stringify(frontendFood.foodEvidenceRecords)), 'the data file is the reviewed frontend records');
  assert.equal(studies.revision, frontendFood.foodEvidenceRevision);
});

// ----------------------------------------------------------------- screens

test('the request the client sends: GET with the resource in the query, a bearer, and nothing private', async () => {
  const w = world();
  await read(w, 'fish-catalogue', {}, 'validFishCatalogue');
  await read(w, 'published-food-evidence', { foodId: 'tuna', guideId: 'seafood' }, 'validPublishedFoodEvidence');
  assert.deepEqual(w.sent.map((s) => [s.method, s.path]), [['GET', '/api/fish/advisories?resource=fish-catalogue'], ['GET', '/api/food/evidence?resource=published-food-evidence&foodId=tuna&guideId=seafood']]);
  assert.ok(w.sent.every((s) => s.headers.Authorization === `Bearer ${w.me.token}`));
  assert.deepEqual(w.h.blockedFetches, []);
});

test('fish: a cut-off advisory is shown withheld with the official link, never as partial advice', async () => {
  const w = world();
  const result = await read(w, 'fish-catalogue', {}, 'validFishCatalogue');
  assert.equal(result.status, 'ready', result.error);
  const screen = fe.fishScreen(result.data);
  const albemarle = screen.view({ query: 'albemarle', waterbody: 'nc-albemarle-sound', species: 'Carp', audience: 'unknown' });
  assert.deepEqual(albemarle.choices.map((c) => c.id), ['nc-albemarle-sound']);
  assert.equal(albemarle.matches.length, 1, 'the one site advisory, no statewide mercury rule for carp');
  const [rule] = albemarle.matches;
  assert.equal(rule.title, 'Albemarle Sound: catfish and carp');
  assert.equal(rule.status, 'Review required: the source text is cut off');
  assert.match(rule.wording, /^Recommendation withheld\./);
  assert.equal(rule.wording.includes('catfish a'), false, 'no fragment of the cut-off text');
  assert.match(rule.url, /^https:\/\/nc\.maps\.arcgis\.com\/sharing\/rest\/content\/items\/[0-9a-f]{32}\/data$/);
});

test('fish: a complete advisory is shown verbatim beside the statewide mercury rule, never merged', async () => {
  const w = world();
  const { data } = await read(w, 'fish-catalogue', {}, 'validFishCatalogue');
  const screen = fe.fishScreen(data);
  const { matches } = screen.view({ query: '', waterbody: 'nc-crabtree-creek', species: 'Largemouth bass', audience: 'unknown' });
  assert.deepEqual(matches.map((r) => r.kind), ['Waterbody-specific', 'Statewide']);
  assert.equal(matches[0].status, 'Published by NC DHHS');
  assert.equal(matches[0].wording, 'Limit consumption of carp, catfish, and largemouth bass from Crabtree Creek to no more than one meal per month. High levels of PCBs have been found in carp, catfish, and largemouth bass from these waters.');
  assert.equal(matches[1].wording, 'Women of childbearing age (15 to 44 years), pregnant women, nursing mothers and children under age 15: Do not eat fish from the HIGH in mercury list. All other people: Eat only 1 meal of fish per week from the HIGH in mercury list.');
  assert.match(matches[1].status, /sources differ/);
});

test('fish: an unlisted water gets only the statewide rules; an unidentified species gets nothing; the regional footnote is quoted', async () => {
  const w = world();
  const { data } = await read(w, 'fish-catalogue', {}, 'validFishCatalogue');
  const screen = fe.fishScreen(data);
  const other = screen.view({ query: 'other', waterbody: 'nc-other-waters', species: 'Bowfin', audience: 'unknown' });
  assert.deepEqual(other.choices.map((c) => c.id), ['nc-other-waters']);
  assert.deepEqual(other.matches.map((r) => r.id), ['nc-statewide-mercury--blackfish-bowfin--bowfin']);
  assert.match(other.matches[0].condition, /south and east of Interstate 85/);
  assert.deepEqual(screen.view({ query: '', waterbody: 'nc-other-waters', species: 'Walleye', audience: 'unknown' }).matches, [], 'walleye mercury applies to the two named lakes only');
  assert.equal(screen.view({ query: '', waterbody: 'nc-fontana-lake', species: 'Walleye', audience: 'unknown' }).matches.length, 2);
  assert.deepEqual(screen.view({ query: '', waterbody: 'nc-badin-lake', species: 'unknown', audience: 'unknown' }).matches, []);
  assert.deepEqual(screen.view({ query: '', waterbody: 'demo-willow-lake', species: 'Largemouth bass', audience: 'unknown' }).matches, [], 'the preview fixture ids are not in production');
});

test('fish: "do not eat any fish" waters and generic catfish match every relevant selection', async () => {
  const w = world();
  const { data } = await read(w, 'fish-catalogue', {}, 'validFishCatalogue');
  const screen = fe.fishScreen(data);
  for (const species of data.species) {
    const { matches } = screen.view({ query: '', waterbody: 'nc-little-brier-creek', species, audience: 'unknown' });
    const site = matches.find((r) => r.waterbody === 'nc-little-brier-creek');
    assert.ok(site, `Little Brier Creek has a rule for ${species}`);
    assert.match(site.wording, /^Do not eat fish from Little Brier Creek/);
  }
  const blue = screen.view({ query: '', waterbody: 'nc-high-rock-lake', species: 'Blue catfish', audience: 'unknown' }).matches;
  assert.ok(blue.some((r) => r.title === 'High Rock Lake: catfish'), 'a "catfish" advisory is shown for blue catfish');
  assert.ok(blue.some((r) => r.kind === 'Statewide'), 'with the statewide wild catfish rule');
});

test('fish: a withheld advisory matches every species at its water, since the cut text may name more', async () => {
  const w = world();
  const { data } = await read(w, 'fish-catalogue', {}, 'validFishCatalogue');
  const screen = fe.fishScreen(data);
  const withheld = [...new Set(data.rules.filter((r) => r.status.startsWith('Review required') && r.waterbody !== 'statewide').map((r) => r.waterbody))];
  assert.equal(withheld.length, 28, 'the 27 cut-off rows and Falls Reservoir');
  for (const waterbody of withheld) {
    for (const species of data.species) {
      const site = screen.view({ query: '', waterbody, species, audience: 'unknown' }).matches.filter((r) => r.waterbody === waterbody);
      assert.equal(site.length, 1, `${waterbody} has its withheld advisory for ${species}`);
      assert.match(site[0].wording, /^Recommendation withheld\./);
      assert.match(site[0].condition, /Shown for every species at this water/);
    }
  }
  const bluegill = screen.view({ query: '', waterbody: 'nc-albemarle-sound', species: 'Bluegill', audience: 'unknown' }).matches;
  assert.deepEqual(bluegill.map((r) => r.title), ['Albemarle Sound: catfish and carp'], 'an unlisted species sees the withheld advisory and its official link, not "No verified advisory"');
  const crabtree = screen.view({ query: '', waterbody: 'nc-neuse-river', species: 'Bluegill', audience: 'unknown' }).matches;
  assert.deepEqual(crabtree, [], 'a complete advisory still matches only the species it names');
});

test('water: a county\'s drought distribution and a utility status render as dated regional records', async () => {
  const w = world();
  const result = await read(w, 'water-stewardship', {}, 'validWaterStewardship');
  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.counties.length, 100);
  const wake = result.data.releases.filter((r) => r.countyId === '37183').sort((a, b) => b.date.localeCompare(a.date))[0];
  const screen = fe.waterScreen(result.data, { county: '37183', release: wake.id, notice: 'ncdwr-03-92-045' });
  assert.equal(screen.releases.length, 4, 'four weekly maps for Wake County');
  assert.equal(screen.release.id, wake.id);
  assert.deepEqual(screen.cells, ['none', 'd0', 'd1', 'd2', 'd3', 'd4'].map((key) => `${wake[key]}% of county area`));
  assert.match(screen.release.scope, /^Share of Wake County area/);
  assert.match(screen.release.scope, /not a reading for one home or garden/);
  assert.equal(screen.notice.title, 'Apex (Wake County)');
  assert.equal(screen.notice.status, 'Mandatory');
  assert.match(screen.notice.instructions, /water system's own notice/);
  const none = result.data.notices.find((n) => n.status === 'Not Restricted');
  assert.equal(/safe|all clear|no restrictions/i.test(`${none.instructions} ${none.scope}`), false, 'Not Restricted is never turned into an all-clear');
  assert.deepEqual(fe.waterScreen(result.data, { county: '', release: '', notice: '' }).releases, []);
});

test('growers: three official North Carolina resources, filterable by concern, with unknown costs kept unknown', async () => {
  const w = world();
  const result = await read(w, 'grower-resources', {}, 'validGrowerResources');
  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.length, 3);
  assert.deepEqual(fe.growerScreen(result.data, { concern: 'All', region: 'North Carolina' }).length, 3);
  assert.deepEqual(fe.growerScreen(result.data, { concern: 'Soil fertility', region: 'All' }).map((r) => r.id), ['ncda-soil-testing']);
  assert.equal(fe.growerScreen(result.data, { concern: 'All', region: 'National' }).length, 0, 'no national resource is presented as NC support');
  assert.match(result.data.find((r) => r.id === 'nc-extension-county-centers').cost, /^Unknown/);
});

test('food evidence: the study list filters by region, category and kind, and Notice is honestly empty', async () => {
  const w = world();
  const result = await read(w, 'food-evidence', {}, 'validFoodNotices');
  assert.equal(result.status, 'ready', result.error);
  assert.equal(fe.evidenceScreen(result.data, { region: 'All', category: 'All', kind: 'Notice' }).length, 0);
  assert.deepEqual(fe.evidenceScreen(result.data, { region: 'All', category: 'Seafood', kind: 'Study' }).map((r) => r.id), ['fda-seafood-2022-tuna-pfos', 'fda-seafood-2022-salmon-pfdoa']);
  assert.equal(fe.evidenceScreen(result.data, { region: 'All', category: 'All', kind: 'All' }, 'empty').length, 0);
});

test('failures reach the screen as the frontend\'s own messages, with no example fallback', async () => {
  const signedOut = world();
  const w = world();
  try {
    _setEvidenceFileForTest('fish', {});
    const broken = await read(w, 'fish-catalogue', {}, 'validFishCatalogue');
    assert.deepEqual([broken.status, broken.data, broken.error], ['error', null, 'This service is unavailable. Try again later.']);
  } finally {
    _setEvidenceFileForTest('fish', null);
  }
  const limited = world({ rateLimit: () => false });
  const refused = await read(limited, 'water-stewardship', {}, 'validWaterStewardship');
  assert.deepEqual([refused.status, refused.error], ['error', 'Please wait before trying again.']);
  const wrongValidator = await read(signedOut, 'grower-resources', {}, 'validFishCatalogue');
  assert.equal(wrongValidator.error, 'This information could not be verified. Try again.', 'a body the validator refuses shows the verification error');
});
