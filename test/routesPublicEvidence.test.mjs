/**
 * The four B12 public evidence routes on the isolated harness
 * (docs/backend/plans/b12-public-evidence.md): GET /api/fish/advisories,
 * /api/water/notices, /api/growers and /api/food/evidence.
 *
 * Synthetic identities, a database that throws if touched, and a fetch that
 * rejects every host. What is proved: a session is required; the `resource`
 * discriminator and the food ids are validated before anything is read; the
 * limiter key, its fail-open fallback and its 429; a broken data file is a 503
 * and never an empty list; the cache headers; no table, RPC or fetch; two
 * households (and a smuggled home context or profile id) get identical bodies;
 * and the data files themselves keep the source rules (verbatim fish wording or
 * an explicit withholding, explicit statewide waterbody ids, provenance
 * headers, no U+2014).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouteHarness, muteConsoleError, LIMITER_UNAVAILABLE } from './helpers/routeHarness.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { haloTables } from './helpers/tables.mjs';

const { _setEvidenceFileForTest } = await import('@/lib/publicEvidence');
const { EVIDENCE_CACHE_CONTROL, EVIDENCE_ERROR_CACHE_CONTROL, EVIDENCE_LIMIT_KEY } = await import('@/lib/publicEvidenceRoute');

const EM_DASH = String.fromCharCode(0x2014);
const ROUTES = {
  fish: { path: '/api/fish/advisories', resource: 'fish-catalogue', file: 'ncFishAdvisories' },
  water: { path: '/api/water/notices', resource: 'water-stewardship', file: 'ncWaterStewardship' },
  growers: { path: '/api/growers', resource: 'grower-resources', file: 'ncGrowerResources' },
  food: { path: '/api/food/evidence', resource: 'food-evidence', file: 'foodEvidenceStudies' },
};
const dataFile = async (name) => JSON.parse(await readFile(new URL(`../lib/data/${name}.json`, import.meta.url), 'utf8'));

function harness(options = {}) {
  const h = createRouteHarness({
    tables: haloTables('profiles'),
    seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id }, { id: bob.id }] }),
    ...options,
  });
  h.touched = [];
  h.db.from = (name) => { h.touched.push(`from:${name}`); throw new Error('the database was read'); };
  h.db.rpc = async (name) => { h.touched.push(`rpc:${name}`); throw new Error('the database was called'); };
  return h;
}
const get = (h, path, query = '', { as = 'alice', headers } = {}) => h.call(path, 'GET', { as, url: `${path}${query}`, headers });
const nothingTouched = (h) => {
  assert.deepEqual(h.touched, [], 'no table and no RPC');
  assert.deepEqual(h.blockedFetches, [], 'no fetch');
};

test('each route answers its own resource with a bare 200, a request id and the success cache headers', async () => {
  const h = harness();
  for (const [name, route] of Object.entries(ROUTES)) {
    const res = await get(h, route.path, `?resource=${route.resource}`);
    assert.equal(res.status, 200, name);
    assert.match(res.headers.get('x-request-id'), UUID);
    assert.equal(res.headers.get('cache-control'), EVIDENCE_CACHE_CONTROL);
    assert.equal(res.headers.get('vary'), 'Authorization');
    const body = await res.json();
    assert.equal(Object.hasOwn(body, 'data'), false, `${name}: never wrapped in data`);
    assert.equal(JSON.stringify(body).includes(EM_DASH), false, `${name}: no em dash`);
  }
  nothingTouched(h);
});

test('fish, water and growers default to their one resource when the query names none; food requires it', async () => {
  const h = harness();
  for (const name of ['fish', 'water', 'growers']) assert.equal((await get(h, ROUTES[name].path)).status, 200, name);
  const body = await expectEnvelope(await get(h, ROUTES.food.path), { status: 400, code: 'validation_failed' });
  assert.equal(body.field_errors[0].field, 'resource');
  nothingTouched(h);
});

test('a resource of another route, or unknown, is a 400 naming the field, with no-store', async () => {
  const h = harness();
  const cases = [[ROUTES.fish.path, 'water-stewardship'], [ROUTES.water.path, 'fish-catalogue'], [ROUTES.growers.path, 'food-evidence'], [ROUTES.food.path, 'grower-resources'], [ROUTES.food.path, 'recalls']];
  for (const [path, resource] of cases) {
    const res = await get(h, path, `?resource=${resource}`);
    assert.equal(res.headers.get('cache-control'), EVIDENCE_ERROR_CACHE_CONTROL);
    const body = await expectEnvelope(res, { status: 400, code: 'validation_failed' });
    assert.deepEqual(body.field_errors.map((e) => e.field), ['resource'], `${path} ${resource}`);
    assert.equal(JSON.stringify(body).includes(resource), false, 'the refused value is not echoed');
  }
  nothingTouched(h);
});

test('published food evidence validates foodId and guideId and answers the strict catalogue match', async () => {
  const h = harness();
  const ok = await get(h, ROUTES.food.path, '?resource=published-food-evidence&foodId=tuna&guideId=seafood');
  assert.equal(ok.status, 200);
  const bundle = await ok.json();
  assert.equal(bundle.foodId, 'tuna');
  assert.deepEqual(bundle.studies.map((s) => s.id), ['fda-seafood-2022-tuna-pfos']);
  assert.deepEqual(bundle.indicators.map((i) => [i.contaminant, i.label, i.itemLevel, i.evidenceCount]), [['PFAS', 'Study available', 'Unknown', 1], ['Lead', 'Guidance available', 'Unknown', 0]]);

  const unknown = await (await get(h, ROUTES.food.path, '?resource=published-food-evidence&foodId=dragonfruit')).json();
  assert.equal(Object.hasOwn(unknown, 'foodId'), false, 'a food not in the catalogue has no identity');
  assert.deepEqual(unknown.studies, []);
  assert.ok(unknown.indicators.every((i) => i.label === 'Guidance available' && i.itemLevel === 'Unknown'));

  const none = await (await get(h, ROUTES.food.path, '?resource=published-food-evidence')).json();
  assert.deepEqual(none.studies, []);

  for (const bad of ['foodId=Tuna', 'foodId=tuna%20can', `foodId=${'a'.repeat(81)}`, 'guideId=sea_food', 'foodId=%3Cscript%3E']) {
    const body = await expectEnvelope(await get(h, ROUTES.food.path, `?resource=published-food-evidence&${bad}`), { status: 400, code: 'validation_failed' });
    assert.equal(body.field_errors.length, 1, bad);
  }
  nothingTouched(h);
});

test('the food-evidence list is studies only: four dated FDA studies and no invented notice', async () => {
  const h = harness();
  const rows = await (await get(h, ROUTES.food.path, '?resource=food-evidence')).json();
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.kind === 'Study' && row.version === 1 && row.url.startsWith('https://www.fda.gov/')));
  assert.deepEqual([...new Set(rows.map((row) => row.category))].sort(), ['Dairy', 'Produce', 'Seafood']);
  const milk = rows.find((row) => row.id === 'fda-tds-2018-2020-whole-milk-lead');
  assert.match(milk.finding, /not detected/);
  assert.match(milk.applicability, /Not detected does not mean zero/);
  nothingTouched(h);
});

test('no session is a 401 envelope and nothing is read', async () => {
  const h = harness();
  for (const route of Object.values(ROUTES)) {
    const res = await get(h, route.path, `?resource=${route.resource}`, { as: null });
    assert.equal(res.headers.get('cache-control'), EVIDENCE_ERROR_CACHE_CONTROL);
    await expectEnvelope(res, { status: 401, code: 'auth_required' });
  }
  const bad = await get(h, ROUTES.fish.path, '', { as: null, headers: { authorization: 'Bearer not-a-token' } });
  assert.equal(bad.status, 401, 'a bad bearer is never downgraded to an anonymous read');
  nothingTouched(h);
});

test('two households, a foreign home context and a profile id in the query all get the identical body', async () => {
  const h = harness();
  for (const route of Object.values(ROUTES)) {
    const alice = await (await get(h, route.path, `?resource=${route.resource}`)).text();
    const bob = await (await get(h, route.path, `?resource=${route.resource}`, { as: 'bob' })).text();
    const smuggled = await (await get(h, route.path, `?resource=${route.resource}&profile_id=${h.identities.alice.id}`, { as: 'bob', headers: { 'x-halo-home-context': 'home-of-alice' } })).text();
    assert.equal(alice, bob, route.path);
    assert.equal(alice, smuggled, route.path);
  }
  nothingTouched(h);
});

test('the limiter is keyed by the caller only, refuses with 429 and Retry-After, and fails open', async (t) => {
  const keys = [];
  const limited = harness({ rateLimit: (key) => { keys.push(key); return false; } });
  const res = await get(limited, ROUTES.fish.path, '?resource=fish-catalogue');
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(res.headers.get('cache-control'), EVIDENCE_ERROR_CACHE_CONTROL);
  await expectEnvelope(res, { status: 429, code: 'rate_limited' });
  assert.deepEqual(keys, [`${EVIDENCE_LIMIT_KEY}${limited.identities.alice.id}`]);

  const before = harness({ rateLimit: (key) => { keys.push(key); return true; } });
  keys.length = 0;
  assert.equal((await get(before, ROUTES.food.path, '?resource=nope')).status, 400);
  assert.deepEqual(keys, [`${EVIDENCE_LIMIT_KEY}${before.identities.alice.id}`], 'a refused query spends a token too');
  const shed = harness({ rateLimit: () => false });
  assert.equal((await get(shed, ROUTES.food.path, '?resource=nope')).status, 429, 'invalid queries are shed like any other');
  keys.length = 0;
  assert.equal((await get(before, ROUTES.food.path, '?resource=food-evidence', { as: null })).status, 401);
  assert.deepEqual(keys, [], 'no session spends no token');

  const logged = muteConsoleError(t);
  const outage = harness({ rateLimit: () => LIMITER_UNAVAILABLE });
  assert.equal((await get(outage, ROUTES.water.path)).status, 200, 'an Upstash outage lets the read through');
  assert.match(loggedText(logged), /public evidence limiter unavailable .*; allowing the call\./);
});

test('a broken data file is a 503, never an empty answer, and the log names the operation only', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  const broken = {
    fish: (file) => ({ ...file, rules: [{ ...file.rules[0], waterbody: 'statewide', waterbodyIds: ['nowhere'] }] }),
    water: (file) => ({ ...file, releases: [{ ...file.releases[0], d1: 140 }] }),
    growers: (file) => ({ ...file, resources: [{ ...file.resources[0], url: 'http://example.test/' }] }),
    food: (file) => ({ ...file, studies: [{ ...file.studies[0], scope: 'household-item' }] }),
  };
  try {
    for (const [name, route] of Object.entries(ROUTES)) {
      _setEvidenceFileForTest(name, broken[name](await dataFile(route.file)));
      const res = await get(h, route.path, `?resource=${route.resource}`);
      assert.equal(res.headers.get('cache-control'), EVIDENCE_ERROR_CACHE_CONTROL);
      await expectEnvelope(res, { status: 503, code: 'upstream_unavailable', retryable: true });
      _setEvidenceFileForTest(name, {});
      assert.equal((await get(h, route.path, `?resource=${route.resource}`)).status, 503, `${name}: an empty file too`);
      _setEvidenceFileForTest(name, null);
      assert.equal((await get(h, route.path, `?resource=${route.resource}`)).status, 200, `${name}: restored`);
    }
    _setEvidenceFileForTest('food', { ...(await dataFile('foodEvidenceStudies')), boundary: `Broken ${EM_DASH} text` });
    assert.equal((await get(h, ROUTES.food.path, '?resource=published-food-evidence&foodId=milk')).status, 503, 'an em dash in a file is refused, not served');
  } finally {
    for (const name of Object.keys(ROUTES)) _setEvidenceFileForTest(name, null);
  }
  const text = loggedText(logged);
  assert.match(text, /Public evidence unavailable \(fish\.read\)/);
  assert.equal(/tuna|milk|alice|bob|0000-4000/.test(text), false, 'no query value or identity in a log line');
  nothingTouched(h);
});

test('drought currency is computed from the release dates and the request date', async () => {
  const { waterStewardship } = await import('@/lib/publicEvidence');
  const file = await dataFile('ncWaterStewardship');
  const wake = (body) => body.releases.filter((r) => r.countyId === '37183').sort((a, b) => b.date.localeCompare(a.date));
  const newest = wake(file)[0];
  const during = wake(waterStewardship(new Date(`${newest.validEnd}T12:00:00Z`)));
  assert.match(during[0].status, /The current weekly map\.$/);
  assert.match(during[1].status, /An earlier weekly map\.$/);
  const later = wake(waterStewardship(new Date('2027-01-01T00:00:00Z')));
  assert.match(later[0].status, /A newer weekly map has likely been published since HALO's copy\. Check the source\.$/);
  assert.ok(later.slice(1).every((r) => r.status.endsWith('An earlier weekly map.')));
});

// ------------------------------------------------------------- the data files

test('every data file records its sources with retrieval date and sha256', async () => {
  const inputs = [
    ...Object.values((await dataFile('ncFishAdvisories')).source.inputs),
    (await dataFile('ncWaterStewardship')).source.drought.input,
    (await dataFile('ncWaterStewardship')).source.utility.input,
    ...Object.values((await dataFile('ncGrowerResources')).source.inputs),
    ...Object.values((await dataFile('foodEvidenceStudies')).source.inputs),
  ];
  assert.ok(inputs.length >= 13);
  for (const input of inputs) {
    assert.match(input.url, /^https:\/\//);
    assert.match(input.retrieved, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(input.sha256, /^[0-9a-f]{64}$/);
  }
});

test('fish wording is either the source text exactly or an explicit withholding, and statewide rules name their waters', async () => {
  const file = await dataFile('ncFishAdvisories');
  const ids = new Set(file.waterbodies.map((w) => w.id));
  const statuses = new Set(file.rules.map((r) => r.status));
  assert.ok(statuses.has('Review required: the source text is cut off'));
  for (const rule of file.rules) {
    if (rule.status.startsWith('Review required')) {
      assert.match(rule.wording, /^Recommendation withheld\./, rule.id);
      assert.match(rule.url, /^https:\/\/nc\.maps\.arcgis\.com\//, `${rule.id} links the official advisory`);
    } else {
      assert.match(rule.wording, /[.!?]$/, `${rule.id}: published wording is never cut off`);
    }
    if (rule.waterbody === 'statewide') {
      assert.ok(rule.waterbodyIds.length > 0 && rule.waterbodyIds.every((id) => ids.has(id)), rule.id);
    } else {
      assert.ok(ids.has(rule.waterbody), rule.id);
    }
    assert.ok(file.species.includes(rule.species), rule.id);
  }
  const walleye = file.rules.find((r) => r.id === 'nc-statewide-mercury--walleye-from-lake-fontana-and-lake-santeetlah-graham-and-swain-counties--walleye');
  assert.deepEqual(walleye.waterbodyIds, ['nc-fontana-lake', 'nc-lake-santeetlah'], 'walleye mercury is for the two named lakes only');
  const falls = file.rules.find((r) => r.id === 'nc-falls-reservoir--catfish');
  assert.equal(falls.status, 'Review required: the source text names another waterbody');
  const crabtree = file.rules.find((r) => r.id === 'nc-crabtree-creek--carp');
  assert.equal(crabtree.wording, 'Limit consumption of carp, catfish, and largemouth bass from Crabtree Creek to no more than one meal per month. High levels of PCBs have been found in carp, catfish, and largemouth bass from these waters.');
  assert.equal(JSON.stringify(file).includes(EM_DASH), false);
});
