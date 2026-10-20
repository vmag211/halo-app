/**
 * B12 edge cases found by trying to break the public evidence reads
 * (docs/backend/plans/b12-public-evidence.md): odd query strings, data files
 * that are broken in every way a build slip could break them (the route must
 * answer 503 or a body the frontend validator accepts, never a 500 and never a
 * body the screen would reject), fish matching against every selection a user
 * can make, wording that is not the source's, drought currency at its
 * boundaries, and HALO's own voice never saying a food or water is safe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import * as fe from './helpers/frontendB12.mjs';

const validators = await loadFrontend('production/home-resources');
const { _setEvidenceFileForTest, waterStewardship, parseEvidenceQuery } = await import('@/lib/publicEvidence');

const EM_DASH = String.fromCharCode(0x2014);
const ROUTES = {
  fish: { path: '/api/fish/advisories', resource: 'fish-catalogue', file: 'ncFishAdvisories', validator: 'validFishCatalogue' },
  water: { path: '/api/water/notices', resource: 'water-stewardship', file: 'ncWaterStewardship', validator: 'validWaterStewardship' },
  growers: { path: '/api/growers', resource: 'grower-resources', file: 'ncGrowerResources', validator: 'validGrowerResources' },
  food: { path: '/api/food/evidence', resource: 'food-evidence', file: 'foodEvidenceStudies', validator: 'validFoodNotices' },
};
const dataFile = async (name) => JSON.parse(await readFile(new URL(`../lib/data/${name}.json`, import.meta.url), 'utf8'));

function harness() {
  const h = createRouteHarness({ tables: haloTables('profiles'), seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id }, { id: bob.id }] }) });
  h.touched = [];
  h.db.from = (name) => { h.touched.push(`from:${name}`); throw new Error('the database was read'); };
  h.db.rpc = async (name) => { h.touched.push(`rpc:${name}`); throw new Error('the database was called'); };
  return h;
}
const get = (h, path, query = '') => h.call(path, 'GET', { as: 'alice', url: `${path}${query}` });
const searchParams = (query) => new URLSearchParams(query);

// ------------------------------------------------------------------- queries

test('query edges: duplicates, case, empties, trailing newline, unicode and prototype names', () => {
  const food = (query) => parseEvidenceQuery('food.search', searchParams(query));
  assert.deepEqual(food('resource=published-food-evidence&resource=nope'), { ok: true, value: { resource: 'published-food-evidence' } }, 'the first value decides');
  assert.equal(food('resource=nope&resource=published-food-evidence').ok, false, 'a refused first value is not rescued by a later one');
  assert.equal(food('resource=Published-Food-Evidence').ok, false, 'resource is case-sensitive');
  assert.equal(food('resource=').ok, false, 'food has no default resource');
  assert.equal(parseEvidenceQuery('fish.read', searchParams('resource=')).ok, true, 'fish defaults when the value is empty');
  assert.equal(parseEvidenceQuery('fish.read', searchParams('resource=FISH-CATALOGUE')).ok, false);

  const published = (extra) => food(`resource=published-food-evidence&${extra}`);
  assert.deepEqual(published('foodId=&guideId=').value, { resource: 'published-food-evidence' }, 'empty ids are absent, not invalid');
  assert.deepEqual(published('foodId=tuna&foodId=Bad').value, { resource: 'published-food-evidence', foodId: 'tuna' }, 'the first food id decides');
  assert.equal(published('foodId=Bad&foodId=tuna').ok, false);
  for (const bad of ['tuna%0A', '%0Atuna', 'tuna%00', 'tuna%20', '%E2%80%94', 'th%C3%A9', '%EF%BC%B4una', 'tuna%2Fx', 'tuna%3Bdrop', 'TUNA', `${'a'.repeat(81)}`]) {
    assert.equal(published(`foodId=${bad}`).ok, false, `foodId=${bad}`);
    assert.equal(published(`guideId=${bad}`).ok, false, `guideId=${bad}`);
  }
  for (const odd of ['constructor', 'tostring', 'hasownproperty', 'a', 'a'.repeat(80), '0-9-a']) {
    assert.deepEqual(published(`foodId=${odd}`).value, { resource: 'published-food-evidence', foodId: odd }, odd);
  }
  assert.equal(published('foodId=__proto__').ok, false, 'underscores are outside [a-z0-9-]');
  assert.equal(published('foodId[]=tuna').ok, true, 'an array-style key is a different key and is ignored');
  assert.equal(Object.hasOwn(published('foodId[]=tuna').value, 'foodId'), false);
  // ids are only read for the published bundle: junk beside another resource changes nothing.
  assert.deepEqual(food('resource=food-evidence&foodId=NOT%20VALID&guideId=%E2%80%94').value, { resource: 'food-evidence' });
  assert.deepEqual(parseEvidenceQuery('fish.read', searchParams('foodId=NOT%20VALID')).value, { resource: 'fish-catalogue' });
});

test('query edges on the real routes: junk, a very long query and prototype ids never change the answer or fail', async () => {
  const h = harness();
  const plain = await (await get(h, ROUTES.fish.path, '?resource=fish-catalogue')).text();
  const noisy = `?resource=fish-catalogue&${'x'.repeat(60000)}=${'y'.repeat(60000)}&__proto__=1&constructor[prototype]=2&waterbody=nc-albemarle-sound`;
  const res = await get(h, ROUTES.fish.path, noisy);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), plain, 'unknown parameters are ignored');

  const pf = '/api/food/evidence?resource=published-food-evidence';
  assert.equal((await get(h, ROUTES.food.path, '?resource=published-food-evidence&foodId=__proto__')).status, 400);
  const proto = await (await get(h, ROUTES.food.path, '?resource=published-food-evidence&foodId=constructor')).json();
  assert.equal(Object.hasOwn(proto, 'foodId'), false, 'a prototype name is not a catalogue food');
  assert.deepEqual(proto.studies, []);
  const dup = await get(h, ROUTES.food.path, `?resource=published-food-evidence&foodId=tuna&foodId=BAD`);
  assert.equal((await dup.json()).foodId, 'tuna');
  const upper = await get(h, ROUTES.food.path, '?resource=PUBLISHED-FOOD-EVIDENCE');
  assert.equal(upper.status, 400);
  assert.equal(pf.length > 0, true);
  assert.deepEqual(h.touched, []);
});

test('only GET is exported by the four routes (any other method is Next.js 405, never a read)', async () => {
  for (const file of ['fish/advisories', 'water/notices', 'growers', 'food/evidence']) {
    const source = await readFile(new URL(`../app/api/${file}/route.js`, import.meta.url), 'utf8');
    const exported = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((match) => match[1]);
    assert.deepEqual(exported, ['GET'], file);
  }
});

// -------------------------------------------------------- broken data files

const BAD_VALUES = [null, undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, '', ' ', 'x', `a ${EM_DASH} b`, true, [], {}, [null], 'http://insecure.test/', 'javascript:alert(1)'];

function mutations(file) {
  const out = [];
  out.push(['whole file', file === null ? null : []], ['whole file', 'text'], ['whole file', 7], ['whole file', null]);
  for (const key of Object.keys(file)) {
    for (const bad of BAD_VALUES) out.push([`${key} = ${JSON.stringify(bad) ?? 'undefined'}`, { ...file, [key]: bad }]);
    const value = file[key];
    if (Array.isArray(value) && value.length && typeof value[0] === 'object') {
      const element = value[0];
      for (const field of Object.keys(element)) {
        for (const bad of BAD_VALUES) {
          out.push([`${key}[0].${field} = ${JSON.stringify(bad) ?? 'undefined'}`, { ...file, [key]: [{ ...element, [field]: bad }, ...value.slice(1)] }]);
        }
        out.push([`${key}[0] without ${field}`, { ...file, [key]: [Object.fromEntries(Object.entries(element).filter(([name]) => name !== field)), ...value.slice(1)] }]);
      }
      out.push([`${key}[0] duplicated`, { ...file, [key]: [element, element, ...value.slice(1)] }]);
      out.push([`${key}[0] is null`, { ...file, [key]: [null, ...value.slice(1)] }]);
    }
  }
  return out;
}

test('every way a data file can be broken is a 503, or a body the frontend validator accepts: never a 500, never a body the screen rejects', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const counts = { served: 0, refused: 0 };
  const problems = [];
  try {
    for (const [name, route] of Object.entries(ROUTES)) {
      const original = await dataFile(route.file);
      const validate = validators[route.validator];
      const resources = name === 'food' ? [route.resource, 'published-food-evidence'] : [route.resource];
      for (const [label, mutated] of mutations(original)) {
        _setEvidenceFileForTest(name, mutated);
        for (const resource of resources) {
          let res;
          try {
            res = await get(h, route.path, `?resource=${resource}&foodId=tuna`);
          } catch (error) {
            problems.push(`${name}/${resource} ${label}: handler threw ${error.message}`);
            continue;
          }
          if (res.status === 503) { counts.refused += 1; continue; }
          if (res.status !== 200) { problems.push(`${name}/${resource} ${label}: status ${res.status}`); continue; }
          counts.served += 1;
          const body = await res.json();
          const accepted = resource === 'published-food-evidence' ? validators.validPublishedFoodEvidence(body) : validate(body);
          if (!accepted) problems.push(`${name}/${resource} ${label}: served a body the validator rejects`);
          if (JSON.stringify(body).includes(EM_DASH)) problems.push(`${name}/${resource} ${label}: served an em dash`);
        }
      }
      _setEvidenceFileForTest(name, null);
    }
  } finally {
    for (const name of Object.keys(ROUTES)) _setEvidenceFileForTest(name, null);
  }
  assert.deepEqual(problems.slice(0, 20), []);
  assert.ok(counts.refused > 500 && counts.served > 100, JSON.stringify(counts));
});

// ------------------------------------------------------------------- fish

const fishFile = await dataFile('ncFishAdvisories');
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const siteRules = fishFile.rules.filter((rule) => rule.waterbody !== 'statewide');
const published = siteRules.filter((rule) => rule.status === 'Published by NC DHHS');
const withheld = siteRules.filter((rule) => rule.status.startsWith('Review required'));
const CATFISH_FAMILY = ['Blue catfish', 'Channel catfish', 'Flathead catfish'];

test('fish: the species list has no near-duplicates, and every rule id is its water and species', () => {
  const normal = fishFile.species.map((name) => name.toLowerCase().replace(/[^a-z]/g, ''));
  assert.equal(new Set(normal).size, normal.length, 'two spellings of one species would split a match');
  assert.ok(fishFile.species.every((name) => name === name.trim() && /^[A-Z][a-z ]+$/.test(name)), 'sentence case, no stray characters');
  for (const rule of siteRules) assert.equal(rule.id, `${rule.waterbody}--${slug(rule.species)}`);
  assert.ok(fishFile.species.includes('Bluegill') && !fishFile.species.some((name) => /blue gill|stripped/i.test(name)), 'the two source misspellings are corrected for matching');
});

test('fish: every species a site advisory lists is matchable at its water, and the catfish group matches both ways', () => {
  const byWater = Map.groupBy(siteRules, (rule) => rule.waterbody);
  for (const [water, rules] of byWater) {
    const species = new Set(rules.map((rule) => rule.species));
    const label = /^Listed species: (.*?)\. (?:The species field|Shown for every species|Pollutants of concern)/.exec(rules[0].condition)[1];
    const tokens = label.replace(/^and\s+/i, '').split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i).map((token) => token.trim()).filter(Boolean);
    for (const token of tokens) {
      const wanted = /^all$/i.test(token) ? 'All fish' : token.replace(/blue gill/i, 'Bluegill').replace(/stripped/i, 'Striped');
      assert.ok([...species].some((name) => name.toLowerCase() === wanted.toLowerCase()), `${water}: listed species "${token}" has no rule`);
    }
    if (tokens.some((token) => /^catfish$/i.test(token))) for (const name of CATFISH_FAMILY) assert.ok(species.has(name), `${water}: catfish advisory missing for ${name}`);
    if (CATFISH_FAMILY.some((name) => species.has(name))) assert.ok(species.has('Catfish'), `${water}: a named catfish needs the generic group too`);
    // One source row has one wording: every species rule of a water carries the same text and link.
    assert.equal(new Set(rules.map((rule) => rule.wording)).size, 1, water);
    assert.equal(new Set(rules.map((rule) => rule.url)).size, 1, water);
  }
});

test('fish: an advisory that covers all fish reaches every species a user can choose, and "do not eat" never misses', () => {
  const everyone = fishFile.species.filter((name) => name !== 'All fish');
  const allFishWaters = [...new Set(siteRules.filter((rule) => rule.species === 'All fish').map((rule) => rule.waterbody))];
  assert.ok(allFishWaters.includes('nc-little-brier-creek') && allFishWaters.includes('nc-brier-creek'));
  const allOther = published.filter((rule) => /\ball other fish\b/i.test(rule.wording)).map((rule) => rule.waterbody);
  assert.deepEqual([...new Set(allOther)].sort(), ['nc-rocky-branch', 'nc-walnut-creek']);
  for (const water of new Set([...allFishWaters, ...allOther, 'nc-lake-crabtree'])) {
    const species = new Set(siteRules.filter((rule) => rule.waterbody === water).map((rule) => rule.species));
    for (const name of everyone) assert.ok(species.has(name), `${water} has no rule for ${name}`);
  }
  const screen = fe.fishScreen(fishFile);
  for (const water of fishFile.waterbodies) {
    for (const species of fishFile.species) {
      const matches = screen.matchFishRules(water.id, species);
      // The frontend can only show a rule whose species equals the selection, so a published
      // "do not eat" site advisory must have been emitted for the selected species.
      const doNotEat = published.filter((rule) => rule.waterbody === water.id && /\b(do not eat|should not eat)\b/i.test(rule.wording));
      for (const rule of doNotEat) {
        const coversAll = rule.wording.startsWith('Do not eat fish from');
        if (coversAll && species !== 'All fish') assert.ok(matches.some((match) => match.id === `${rule.waterbody}--${slug(species)}`), `${water.id} / ${species}`);
      }
    }
  }
});

test('fish: a withheld rule never carries a fragment of the source, and a published rule is not a truncation at the service limit', () => {
  assert.ok(withheld.length >= 25 && published.length >= 50);
  for (const rule of withheld) {
    assert.match(rule.wording, /^Recommendation withheld\. [^]*Open the official advisory/);
    assert.equal(/\b(do not eat|limit consumption|one meal|meal per|eat only|should not eat)\b/i.test(rule.wording), false, `${rule.id}: advice text leaked into a withheld rule`);
    assert.equal(rule.wording.length < 260, true);
    assert.match(rule.url, /^https:\/\/nc\.maps\.arcgis\.com\/sharing\/rest\/content\/items\/[0-9a-f]{32}\/data$/, `${rule.id}: the link is the official graphic`);
    assert.match(rule.status, /^Review required: /);
  }
  for (const rule of published) {
    assert.ok(rule.wording.length < 240, `${rule.id}: ${rule.wording.length} characters is near the 254 cut-off of the source field`);
    assert.match(rule.wording, /^[A-Z]/);
    assert.match(rule.wording, /[.!?]$/);
    assert.equal(rule.wording, rule.wording.trim());
    assert.equal(/\s{2,}|[\r\n\t]/.test(rule.wording), false, `${rule.id}: whitespace was normalised, not copied`);
  }
});

test('fish: statewide mercury rules apply to every water including "other waters", walleye only to its two lakes, and the audience wording is the page\'s', () => {
  const statewide = fishFile.rules.filter((rule) => rule.waterbody === 'statewide');
  const ids = fishFile.waterbodies.map((item) => item.id);
  assert.ok(ids.includes('nc-other-waters'));
  for (const rule of statewide) {
    if (rule.species === 'Walleye') assert.deepEqual(rule.waterbodyIds, ['nc-fontana-lake', 'nc-lake-santeetlah']);
    else assert.deepEqual([...rule.waterbodyIds].sort(), [...ids].sort(), rule.id);
    assert.equal(rule.pollutant, 'Mercury');
    assert.match(rule.wording, /^Women of childbearing age \(15 to 44 years\), pregnant women, nursing mothers and children under age 15: Do not eat fish from the HIGH in mercury list\. All other people: Eat only 1 meal of fish per week from the HIGH in mercury list\.$/);
    assert.match(rule.condition, /statewide mercury chart as an image/, 'the two NC DHHS sources are said to differ');
  }
  assert.deepEqual([...new Set(statewide.map((rule) => rule.species))].sort(), ['Black crappie', 'Blue catfish', 'Bowfin', 'Catfish', 'Chain pickerel', 'Channel catfish', 'Flathead catfish', 'Largemouth bass', 'Walleye', 'Warmouth', 'Yellow perch']);
  // Every site water also answers the statewide rule for a species that has no site rule (no silent gap).
  const screen = fe.fishScreen(fishFile);
  for (const water of fishFile.waterbodies) {
    const bass = screen.matchFishRules(water.id, 'Largemouth bass');
    assert.ok(bass.some((rule) => rule.kind === 'Statewide'), `${water.id}: statewide largemouth bass mercury`);
  }
});

test('fish: a selection with no rule is an empty list the screen words as "no verified advisory", never a stand-in rule', () => {
  const screen = fe.fishScreen(fishFile);
  assert.deepEqual(screen.matchFishRules('nc-neuse-river', 'Walleye'), [], 'the Neuse advisory lists carp and catfish only');
  assert.deepEqual(screen.matchFishRules('nc-other-waters', 'All fish'), []);
  assert.deepEqual(screen.matchFishRules('nc-other-waters', 'Blue crab'), []);
  assert.deepEqual(screen.matchFishRules('', 'Carp'), []);
  assert.deepEqual(screen.matchFishRules('nc-neuse-river', ''), []);
});

// ------------------------------------------------------------------ drought

test('drought currency at its boundaries: validity ends at the end of its UTC day, one map is current, and a clock before the data cannot call two maps current', async () => {
  const file = await dataFile('ncWaterStewardship');
  const wake = (now) => waterStewardship(now).releases.filter((row) => row.countyId === '37183').sort((a, b) => b.date.localeCompare(a.date)).map((row) => /(The current weekly map\.|An earlier weekly map\.|A newer weekly map .*)$/.exec(row.status)[1]);
  assert.deepEqual(wake(new Date('2026-10-19T23:59:59.999Z')), ['The current weekly map.', 'An earlier weekly map.', 'An earlier weekly map.', 'An earlier weekly map.']);
  assert.equal(wake(new Date('2026-10-20T00:00:00.000Z'))[0], 'A newer weekly map has likely been published since HALO\'s copy. Check the source.');
  assert.equal(wake(new Date('2026-10-13T00:00:00.000Z'))[0], 'The current weekly map.', 'the first day of the newest map');
  assert.deepEqual(wake(new Date('2026-10-14T00:00:00Z')).filter((status) => status === 'The current weekly map.').length, 1, 'never two current maps');
  // A server clock behind the copy (map 2026-10-13 already in the file, now inside the older week).
  assert.deepEqual(wake(new Date('2026-10-08T12:00:00Z')).filter((status) => status === 'The current weekly map.').length, 1, 'a clock behind the data still names one map');
  assert.deepEqual(wake(new Date('2026-10-08T12:00:00Z')), ['The current weekly map.', 'An earlier weekly map.', 'An earlier weekly map.', 'An earlier weekly map.'], 'the newest copy is the one current map');
  assert.equal(wake(new Date('2030-01-01T00:00:00Z'))[0].startsWith('A newer weekly map'), true);
  // Statuses keep the source status first and never end up without a currency note.
  for (const row of waterStewardship(new Date('2026-10-15T00:00:00Z')).releases) assert.match(row.status, /^U\.S\. Drought Monitor map for \d{4}-\d{2}-\d{2}, valid \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\. (The current weekly map|An earlier weekly map|A newer weekly map)/);
  assert.ok(file.releases.every((row) => row.validStart <= row.date && row.date <= row.validEnd));
});

test('drought: each county has four distinct weekly maps whose categories add to about 100 percent, and every notice keeps the state\'s own status', async () => {
  const file = await dataFile('ncWaterStewardship');
  const byCounty = Map.groupBy(file.releases, (row) => row.countyId);
  assert.equal(byCounty.size, 100);
  for (const [county, rows] of byCounty) {
    assert.equal(new Set(rows.map((row) => row.date)).size, rows.length, `${county}: one map per date`);
    for (const row of rows) {
      const total = ['none', 'd0', 'd1', 'd2', 'd3', 'd4'].reduce((sum, key) => sum + row[key], 0);
      assert.ok(Math.abs(total - 100) < 0.5, `${row.id}: categories add to ${total}`);
    }
  }
  assert.equal(new Set(file.notices.map((row) => row.id)).size, file.notices.length);
  assert.ok(file.notices.every((row) => ['Not Restricted', 'Voluntary', 'Mandatory'].includes(row.status)));
});

// ----------------------------------------------------------------- HALO voice

test('HALO never says a food, fish or water is safe in its own voice; only source quotations and negations do', async () => {
  const sources = { fish: fishFile, water: await dataFile('ncWaterStewardship'), growers: await dataFile('ncGrowerResources'), food: await dataFile('foodEvidenceStudies') };
  const hits = [];
  const walk = (value, where, ownVoice) => {
    if (typeof value === 'string') {
      if (/\b(safe|safely|safer|safest|harmless|no risk|risk[- ]free|all clear|all-clear|fine to eat|okay to|ok to)\b/i.test(value) && ownVoice) hits.push(`${where}: ${value}`);
    } else if (Array.isArray(value)) value.forEach((item, at) => walk(item, `${where}[${at}]`, ownVoice));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, `${where}.${key}`, ownVoice && key !== 'source');
  };
  // Fish: a published site rule's `wording` is the source's own sentence; everything else is HALO's.
  for (const rule of fishFile.rules) {
    const quoted = rule.waterbody !== 'statewide' && rule.status === 'Published by NC DHHS';
    walk(Object.fromEntries(Object.entries(rule).filter(([key]) => !(quoted && key === 'wording'))), rule.id, true);
  }
  walk({ ...sources.fish, rules: [] }, 'fish', true);
  walk(sources.water, 'water', true);
  walk(sources.growers, 'growers', true);
  // Food: HALO's limitation sentences may only negate ("do not establish that ... is safe or unsafe", "not a food safety limit").
  const negations = /do not establish that a particular item is safe or unsafe\.|not a food safety limit|are not food safety limits/gi;
  for (const study of sources.food.studies) {
    for (const [key, value] of Object.entries(study)) if (typeof value === 'string' && /\bsafe/i.test(value.replace(negations, ''))) hits.push(`${study.id}.${key}: ${value}`);
  }
  assert.deepEqual(hits, []);
  // The one source sentence that says "not safe to eat" is attributed: published status, source link, no HALO paraphrase.
  const littleBrier = fishFile.rules.find((rule) => rule.id === 'nc-little-brier-creek--largemouth-bass');
  assert.match(littleBrier.wording, /not safe to eat/);
  assert.equal(littleBrier.status, 'Published by NC DHHS');
  assert.match(littleBrier.url, /^https:\/\/nc\.maps\.arcgis\.com\//);
  assert.equal(JSON.stringify(sources.water.notices.filter((row) => row.status === 'Not Restricted')).match(/safe|clear|no restrictions/gi), null, '"Not Restricted" is never restated as an all-clear');
});

test('published food evidence: every catalogue food works through the route and an unknown food claims nothing', async () => {
  const h = harness();
  const { foodCatalogue } = await loadFrontend('food-catalogue');
  for (const food of foodCatalogue) {
    const res = await get(h, ROUTES.food.path, `?resource=published-food-evidence&foodId=${food.id}&guideId=${food.guideId}`);
    assert.equal(res.status, 200, food.id);
    const body = await res.json();
    assert.equal(body.foodId, food.id);
    assert.equal(validators.validPublishedFoodEvidence(body), true, food.id);
    assert.ok(body.indicators.every((item) => item.itemLevel === 'Unknown'));
    assert.ok(body.studies.every((study) => study.foodIds.includes(food.id)), 'only studies of this very food');
  }
});
