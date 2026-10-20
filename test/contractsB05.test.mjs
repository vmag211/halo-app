/**
 * B05 discovery: the executable contract, and conformance of the REAL handlers
 * to it and to the frontend's own validators and parsers.
 *
 * The per-route suites prove each route right on its own terms. What none of
 * them proves is that the six operations agree:
 *
 *   - with the frontend, whose validators (validPlaces, validDiscoveryArea) and
 *     parsers (parseMapLayer, parseMapDistrict, parseMapComparisons) discard or
 *     refuse a whole payload on one wrong field, and whose compareEvidence
 *     decides what a comparison may claim;
 *   - with EACH OTHER. The Explore chooser takes a candidate from
 *     locations.search, saves it through explore.area.save and reads it back
 *     through explore.area.read, holding one revision across all three; the
 *     map's comparison sheet asks map.comparison for the ids map.layer gave it.
 *     A divergence between two of them is a defect even with every route's own
 *     suite green.
 *   - with the document, `docs/backend/contracts/b05.openapi.json`, which is
 *     what a reader will believe.
 *
 * The client code is IMPORTED from the real TypeScript modules by
 * test/helpers/frontendB05.mjs (one copy, shared with the per-route suites;
 * only MapComparison.tsx's row label is still a transcription). A validator
 * that always said yes would pass every body here, so `the six transcriptions
 * reject what the client rejects` (its name is kept from when they were copies)
 * shows each of them saying no.
 *
 * Structure, in order: the schemas against the fixtures, the contract's own
 * coverage, the transcriptions' self-checks, the fixtures against the
 * transcriptions, the real handlers against both, cross-route agreement, the
 * fixture hygiene scan, and the two directions of header documentation (last,
 * because they report on what ran before them).
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * database, and a fetch that rejects every host (or answers the ArcGIS boundary
 * service only, where a test says so). No real Supabase project, no provider,
 * no production URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import {
  c, compareEvidence, comparisonRows, compounds, parseMapComparisons, parseMapDistrict, parseMapLayer, rowLabel,
  validDiscoveryArea, validPlaces,
} from './helpers/frontendB05.mjs';
import { airPayload, districtPayload, facilitiesPayload, waterPayload } from '../lib/mapBuild.js';
import { ARCGIS_WATER_BOUNDARIES } from '../lib/waterGeo.js';

const { requestHash } = await import('@/lib/operations');

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b05.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b05', components: contract.components });
const operations = new Map(
  Object.entries(contract.paths).flatMap(([path, verbs]) =>
    Object.entries(verbs).map(([method, op]) => [op.operationId, { ...op, path, method: method.toUpperCase() }])),
);
const validators = new Map();
function compiled(ref) {
  if (!validators.has(ref)) validators.set(ref, ajv.compile({ $ref: `urn:halo:b05${ref}` }));
  return validators.get(ref);
}
/** The documented response for this operation and status, applied to a real or fixture body. */
function validate(operationId, status, body) {
  const op = operations.get(operationId);
  assert.ok(op, `unknown operation ${operationId}`);
  const response = op.responses[String(status)];
  assert.ok(response, `${operationId}: undocumented status ${status}`);
  const check = compiled(response.content['application/json'].schema.$ref);
  assert.equal(check(body), true, `${operationId} ${status}: ${ajv.errorsText(check.errors)}`);
}
/** The documented REQUEST body, applied to one a test is about to send. */
function validateRequest(operationId, body) {
  const ref = operations.get(operationId).requestBody?.content['application/json'].schema.$ref;
  assert.ok(ref, `${operationId} documents no request body`);
  const check = compiled(ref);
  assert.equal(check(body), true, `${operationId} request: ${ajv.errorsText(check.errors)}`);
}

const directory = new URL('../docs/backend/contracts/fixtures/b05/', import.meta.url);
const fixtures = await Promise.all(
  (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, directory), 'utf8')) })),
);

const EM_DASH = String.fromCharCode(0x2014);
/** Ruling D10 and AGENTS.md, on every B05 body: no top-level data key, no U+2014 literal or escaped. */
function assertBare(body, label) {
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), `${label}: an object body`);
  assert.equal(Object.hasOwn(body, 'data'), false, `${label}: no top-level data key (the client would unwrap it, runtime.ts:149-153)`);
  const text = JSON.stringify(body);
  assert.equal(text.includes(EM_DASH), false, `${label}: no U+2014`);
  assert.equal(text.includes('\\u2014'), false, `${label}: no escaped U+2014`);
}

for (const fixture of fixtures) {
  test(`B05 fixture: ${fixture.name}`, () => {
    validate(fixture.operationId, fixture.status, fixture.body);
    assertBare(fixture.body, fixture.name);
  });
}

// ---------------------------------------------------------------------------
// The contract's own coverage
// ---------------------------------------------------------------------------

const CONFLICT_REASONS = ['stale_revision', 'revision_exhausted', 'operation_mismatch', 'abandoned', 'attempt_failed'];
/** The public, cache-only reads (B05 Task 6, lib/publicAccess.js). */
const MAP_OPERATIONS = ['mapComparison', 'mapDistrict', 'mapLayer'];

test('B05 contract covers the six built operations, every documented status has a fixture, and the dropped and blocked ones are absent', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, 'b05-2');
  // One version for both unshipped changes (Task 6 review finding 3, Task 8 review N1).
  assert.match(contract.info.description, /Version b05-2 covers two changes.*public \(B05 Task 6\).*us-place and us-zcta \(B05 Task 8\)/);
  assert.deepEqual([...operations.keys()].sort(), [
    'exploreAreaRead', 'exploreAreaSave', 'locationsSearch', 'mapComparison', 'mapDistrict', 'mapLayer',
  ]);
  assert.deepEqual([...operations.values()].map((op) => op['x-halo-operation']).sort(), [
    'explore.area.read', 'explore.area.save', 'locations.search', 'map.comparison', 'map.district', 'map.layer',
  ], 'each names its frontend registry operation');
  // Dropped (community.read, map.brief) and blocked (organizations.search, the
  // summaries trio): documenting any of them would be a claim this package cannot support.
  for (const path of ['/api/community', '/api/map/brief', '/api/organizations/search', '/api/summaries', '/api/summaries/prepare']) {
    assert.equal(path in contract.paths, false, `${path} is not built and must not be documented`);
  }
  for (const [id, op] of operations) {
    for (const status of Object.keys(op.responses)) {
      assert.ok(fixtures.some((item) => item.operationId === id && String(item.status) === status), `${id} is missing a ${status} fixture`);
    }
    assert.ok(
      fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'auth_unavailable' && item.body.retryable === true),
      `${id} is missing the retryable auth-outage fixture`,
    );
    assert.ok(op.responses['401'] && op.responses['503'], `${id}: an Authorization header is checked, so 401 and the auth outage are documented`);
    // B05 Task 6: the three map operations are the public read; the other three are not.
    const isPublic = MAP_OPERATIONS.includes(id);
    assert.equal(Boolean(op.responses['429']), isPublic, `${id}: the visitor limiter's 429 is documented exactly on the public reads`);
    for (const [status, response] of Object.entries(op.responses)) {
      for (const name of ['Cache-Control', 'Vary']) {
        assert.equal(Boolean(response.headers?.[name]), isPublic, `${id} ${status}: ${name} is documented exactly on the public reads`);
      }
    }
    // Task 6 review, finding 1: the global bearer requirement is overridden exactly on the public
    // reads, where the empty requirement says no credential is needed and a bearer is still accepted.
    assert.deepEqual(op.security ?? contract.security, isPublic ? [{}, { bearerAuth: [] }] : [{ bearerAuth: [] }], `${id}: security`);
    if (isPublic) {
      assert.ok(op.responses['429'].headers['Retry-After'], `${id}: the 429 documents Retry-After`);
      assert.match(op.responses['200'].headers['X-Request-Id'].description, /never the caller's x-request-id/, `${id}: the shared answer's request id is documented`);
      assert.match(op.responses['200'].headers['Cache-Control'].description, /^public, max-age=0, s-maxage=600 on an anonymous answer/);
      assert.match(op.responses['401'].description, /no Authorization header at all is the anonymous read/);
    }
  }
  for (const name of ['mapDistrict-anonymous.json', 'mapLayer-anonymous-not-stored.json', 'mapDistrict-anonymous-not-stored.json']) {
    assert.ok(fixtures.some((item) => item.name === name), `the anonymous answer ${name} is fixtured`);
  }
  assert.equal('household_county' in fixtures.find((item) => item.name === 'mapDistrict-anonymous.json').body, false);
  for (const id of ['exploreAreaRead', 'exploreAreaSave']) {
    assert.ok(
      fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'feature_unavailable' && item.body.retryable === false),
      `${id} is missing the non-retryable feature-unavailable fixture (migration 0022)`,
    );
  }
  // Every 409 reason the save can give is documented, enumerated and fixtured.
  const conflict = contract.components.schemas.ConflictEnvelope;
  assert.deepEqual([...conflict.properties.reason.enum].sort(), [...CONFLICT_REASONS].sort());
  const described = operations.get('exploreAreaSave').responses['409'].description;
  for (const reason of CONFLICT_REASONS) {
    assert.ok(described.includes(reason), `the 409 description names ${reason}`);
    assert.ok(fixtures.some((item) => item.operationId === 'exploreAreaSave' && item.status === 409 && item.body.reason === reason), `a ${reason} fixture`);
  }
  // Both request headers of the save are documented, with the rule each carries.
  const headers = Object.fromEntries(operations.get('exploreAreaSave').parameters.filter((p) => p.in === 'header').map((p) => [p.name, p]));
  assert.equal(headers['Idempotency-Key']?.required, true);
  assert.equal(headers['Idempotency-Key'].schema.format, 'uuid');
  assert.equal(headers['If-Match']?.required, false);
  assert.match(headers['If-Match'].description, /same number as the body/);
  // The map water answer that is incomplete is fixtured as such.
  assert.ok(fixtures.some((item) => item.operationId === 'mapLayer' && item.body.meta?.availability === 'partial'));
  assert.ok(fixtures.some((item) => item.operationId === 'mapDistrict' && item.status === 503 && item.body.code === 'upstream_unavailable'));
  // No B05 schema has a top-level data property (Ruling D10).
  for (const [name, schema] of Object.entries(contract.components.schemas)) {
    assert.equal(Object.hasOwn(schema.properties ?? {}, 'data'), false, `${name} declares no data property`);
  }
  assert.equal(JSON.stringify(contract).includes(EM_DASH), false, 'no U+2014 anywhere in the document');
});

test('B05 schemas reject the drift that would cost somebody their answer, or tell them something false', () => {
  const area = compiled('#/components/schemas/DiscoveryArea');
  const wake = fixtures.find((item) => item.name === 'exploreAreaSave-success.json').body.place;
  assert.equal(area({ place: null, revision: 1 }), true);
  assert.equal(area({ place: null, revision: 0 }), false, 'revision 0 locks every save (ExploreDiscovery.tsx:60)');
  assert.equal(area({ place: wake, revision: '2' }), false);
  assert.equal(area({ place: wake, revision: 2, pendingOperation: { id: 'x', place: null } }), false, 'Ruling D7: never a pendingOperation');
  assert.equal(area({ data: { place: null, revision: 1 } }), false, 'Ruling D10: never wrapped');
  assert.equal(area({ place: { ...wake, label: 'a\u0001b' }, revision: 2 }), false);

  const conflict = compiled('#/components/schemas/ConflictEnvelope');
  const stale = fixtures.find((item) => item.name === 'exploreAreaSave-stale-revision.json').body;
  assert.equal(conflict(stale), true);
  const { revision, ...noRevision } = stale;
  assert.equal(revision > 1, true);
  assert.equal(conflict(noRevision), false, 'a stale revision carries the current one');
  assert.equal(conflict({ ...stale, reason: 'abandoned' }), false, 'a replay reason compared no revision, so it carries none');
  assert.equal(conflict({ ...stale, reason: 'run_open' }), false, 'a reason this route never gives');

  const record = compiled('#/components/schemas/ComparisonRecord');
  const water = fixtures.find((item) => item.name === 'mapComparison-water.json').body.records[0];
  assert.equal(record(water), true);
  assert.equal(record({ ...water, sourceName: 'Water monitoring release' }), false, 'no sourceName (Task 5 review N1)');
  assert.equal(record({ ...water, sourceVersion: 'ucmr5' }), false, 'Ruling D3: no source version is composed');
  assert.equal(record({ ...water, coverage: 'complete' }), false, 'Ruling D3: coverage is never complete');
  assert.equal(record({ ...water, values: [{ ...water.values[0], qualifier: 'reported' }] }), false, 'Ruling D3: no value is called reported');
  assert.equal(record({ ...water, values: [{ ...water.values[0], method: 'EPA 533' }] }), false, 'Ruling D3: no method is composed');

  const district = compiled('#/components/schemas/MapDistrict');
  const view = fixtures.find((item) => item.name === 'mapDistrict-success.json').body;
  assert.equal(district(view), true);
  assert.equal(district({ ...view, county_rankings: [] }), false, 'the statewide ranking stays server side');
  const { household_county: own, ...shared } = view;
  assert.ok(own, 'the signed-in fixture carries the household county');
  assert.equal(district(shared), false, 'a signed-in answer always carries household_county');
  const visitor = compiled('#/components/schemas/MapDistrictPublic');
  const answer = compiled('#/components/schemas/MapDistrictAnswer');
  assert.equal(visitor(shared), true);
  assert.equal(visitor(view), false, 'an anonymous answer never carries household_county (Task 6)');
  assert.equal(visitor({ ...shared, household_county: null }), false, 'not even as null, which would say "not ranked"');
  assert.equal(visitor({ ...shared, county_rankings: [] }), false);
  assert.deepEqual([answer(view), answer(shared), answer({ ...shared, county_rankings: [] })], [true, true, false]);
  const pfos = { ...view.by_contaminant.PFOS };
  delete pfos.over_population_unknown;
  assert.equal(district({ ...view, by_contaminant: { ...view.by_contaminant, PFOS: pfos } }), false, 'the 9.9 branch is not a valid view');

  const layer = compiled('#/components/schemas/MapLayer');
  const partial = fixtures.find((item) => item.name === 'mapLayer-water-partial.json').body;
  assert.equal(layer(partial), true);
  const { meta, ...unmarked } = partial;
  assert.equal(meta.availability, 'partial');
  assert.equal(layer(unmarked), false, 'an incomplete lookup is always marked for the client');
  assert.equal(layer({ ...partial, layer: 'district' }), false);
});

// ---------------------------------------------------------------------------
// The transcriptions say no
// ---------------------------------------------------------------------------

const WAKE = { id: 'us-county:37183', place: 'Wake County', state: 'NC', label: 'Wake County, NC', timezone: 'America/New_York' };
const NOW = new Date().toISOString();

test('the six transcriptions reject what the client rejects', () => {
  // validPlaces (explore-service.ts:67)
  assert.equal(validPlaces({ candidates: [] }), true);
  assert.equal(validPlaces({ candidates: [WAKE] }), true);
  for (const [value, why] of [
    [null, 'null'], [{}, 'no candidates'], [{ candidates: Array.from({ length: 21 }, () => WAKE) }, '21 candidates'],
    [{ candidates: [{ ...WAKE, id: '' }] }, 'an empty id'], [{ candidates: [{ ...WAKE, label: 'x'.repeat(301) }] }, '301 characters'],
    [{ candidates: [{ ...WAKE, timezone: undefined }] }, 'a missing field'], [{ candidates: [{ ...WAKE, place: 'a\u001bb' }] }, 'a control character'],
  ]) assert.equal(validPlaces(value), false, `validPlaces: ${why}`);

  // validDiscoveryArea (explore-service.ts:69)
  assert.equal(validDiscoveryArea({ place: null, revision: 1 }), true);
  assert.equal(validDiscoveryArea({ place: WAKE, revision: 2, pendingOperation: { id: 'p', place: null } }), true, 'the client tolerates what this release never sends');
  for (const [value, why] of [
    [{ place: null, revision: 0 }, 'revision 0'], [{ place: null, revision: '2' }, 'a string revision'], [{ place: null, revision: 1.5 }, 'a fraction'],
    [{ place: null }, 'no revision'], [{ place: { ...WAKE, id: '' }, revision: 2 }, 'a blank id'],
    [{ place: null, revision: 1, pendingOperation: null }, 'a null pendingOperation'], [[], 'an array'],
  ]) assert.equal(validDiscoveryArea(value), false, `validDiscoveryArea: ${why}`);

  // parseMapComparisons (map-service.ts:58-65)
  assert.throws(() => parseMapComparisons({}, []), /invalid_map_response/, 'a non-array');
  const item = { id: 'NC1', name: 'A', values: [{ analyte: 'PFOA', value: 1, qualifier: 'measured' }] };
  assert.deepEqual(parseMapComparisons([item, { ...item, id: 'NC2' }, { ...item, id: 7 }], ['NC1']).map((r) => r.id), ['NC1'], 'unrequested and non-string ids are dropped');
  const [parsed] = parseMapComparisons([item], ['NC1']);
  assert.equal(parsed.values[0].qualifier, 'unknown', 'an unknown qualifier is coerced');
  assert.equal(parsed.sourceName, 'Source not reported');
  assert.equal(parsed.coverage, 'unknown');

  // compareEvidence (map-comparison-preview.ts:77-96): an authored, fully provenanced pair aligns.
  const value = { analyte: 'PFOA', value: 1, unit: 'ppt', observedAt: '2024-08-20', period: '2024Q3', periodLabel: '2024 Q3', method: 'EPA 533', qualifier: 'reported' };
  const first = { id: 'A', status: 'available', kind: c.waterEvidence, scope: c.scopeWater, denominator: 'Annual average', sourceVersion: 'v1', coverage: 'complete', values: [value] };
  const second = { ...first, id: 'B' };
  const aligned = compareEvidence(first, second, value, value);
  assert.deepEqual(aligned, { compatible: true, reasons: [], warnings: [] });
  assert.equal(rowLabel(aligned), c.matched);
  assert.equal(rowLabel(compareEvidence(first, { ...second, coverage: 'partial' }, value, value)), c.limited);
  assert.deepEqual(compareEvidence(first, second, value, { ...value, method: null }).reasons, [c.reasons.method], 'exactly one reason per missing field');
  assert.deepEqual(compareEvidence({ ...first, sourceVersion: null }, second, value, value).reasons, [c.reasons.source]);
  assert.deepEqual(compareEvidence(first, second, value, { ...value, qualifier: 'unknown' }).reasons, [c.reasons.qualifier]);

  // parseMapLayer (map-service.ts:24-56)
  const water = { layer: 'water', features: [{ pwsid: 'NC1' }], assembled_at: NOW };
  assert.equal(parseMapLayer(water, 'water').partial, false);
  assert.throws(() => parseMapLayer(water, 'air'), /invalid_map_response/, 'the layer asked for');
  assert.throws(() => parseMapLayer({ layer: 'water', features: {} }, 'water'), /invalid_map_response/);
  assert.throws(() => parseMapLayer({ ...water, data: { layer: 'air' } }, 'water'), /invalid_map_response/, 'a data key replaces the body');
  assert.equal(parseMapLayer({ ...water, meta: { availability: 'partial' } }, 'water').partial, true, 'meta.availability partial marks the layer');
  assert.equal(parseMapLayer({ layer: 'water', features: [{ pwsid: 'NC1' }, { pwsid: 'NC1' }] }, 'water').partial, true, 'a duplicate is dropped');

  // parseMapDistrict (map-service.ts:82-96)
  const view = fixtures.find((f) => f.name === 'mapDistrict-success.json').body;
  assert.equal(parseMapDistrict(view).scope, 'NC-08');
  assert.throws(() => parseMapDistrict({ ...view, scope: 'NC-09' }), /invalid_map_response/);
  assert.throws(() => parseMapDistrict({ ...view, total_systems: 1.5 }), /invalid_map_response/, 'counts are integers');
  assert.throws(() => parseMapDistrict({ ...view, assembled_at: undefined }), /invalid_map_response/);
  const pfos = { ...view.by_contaminant.PFOS };
  delete pfos.over_population_unknown;
  assert.throws(() => parseMapDistrict({ ...view, by_contaminant: { ...view.by_contaminant, PFOS: pfos } }), /invalid_map_response/, 'the 9.9 branch');
});

/** What the client does with a 200 body of each operation: accept it, or refuse it. */
const CLIENT = Object.freeze({
  locationsSearch: (body) => validPlaces(body),
  exploreAreaRead: (body) => validDiscoveryArea(body),
  exploreAreaSave: (body) => validDiscoveryArea(body),
  mapLayer: (body) => { try { parseMapLayer(body, body.layer); return true; } catch { return false; } },
  mapDistrict: (body) => { try { parseMapDistrict(body); return true; } catch { return false; } },
  mapComparison: (body) => {
    try {
      const ids = Array.isArray(body.records) ? body.records.map((r) => r.id) : [];
      return parseMapComparisons(body.records, ids).length === ids.length;
    } catch { return false; }
  },
});

test('every success fixture is a payload the client accepts, and no error fixture could be mistaken for one', () => {
  let checked = 0;
  for (const fixture of fixtures) {
    const accepted = CLIENT[fixture.operationId](fixture.body);
    if (fixture.status !== 200) {
      assert.equal(accepted, false, `${fixture.name}: an error envelope must not pass as a payload`);
      continue;
    }
    checked += 1;
    assert.equal(accepted, true, `${fixture.name}: the client would refuse this fixture`);
    if (fixture.operationId === 'mapLayer') {
      const parsed = parseMapLayer(fixture.body, fixture.body.layer);
      assert.equal(parsed.partial, fixture.body.meta?.availability === 'partial', `${fixture.name}: partial exactly when marked`);
    }
  }
  assert.ok(checked >= 16, `every success fixture was checked, got ${checked}`);
});

// ---------------------------------------------------------------------------
// The harness: the real handlers
// ---------------------------------------------------------------------------

const REQUEST_ID = 'b05-conformance-0001';
const TABLES = haloTables('profiles', 'map_layers', 'ucmr5_utilities', 'operations', 'explore_areas');
const reading = (date, ppt) => [{ date, value_ppt: ppt }];
/** Two systems: one over the PFOS limit inside NC-08, one tested only in 2024Q1. */
const utilitiesFor = (prefix) => [
  { pwsid: `${prefix}01`, pws_name: 'Example Water A', status: 'Final', contaminants: { PFOS: reading('8/20/2024', 7.7), PFOA: reading('8/20/2024', 1.2), PFNA: reading('8/20/2024', 3), PFHxS: reading('8/20/2024', 4) } },
  { pwsid: `${prefix}02`, pws_name: 'Example Water B', status: 'Final', contaminants: { PFOA: reading('3/15/2024', 2.1) } },
];
const geoFor = (utilities) => new Map([[utilities[0].pwsid, { lat: 34.985, lng: -80.549, population: 34000 }]]);
const AIRNOW = [
  { FullAQSCode: '370000001', SiteName: 'Example Station A', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T10:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'Example Agency' },
  { FullAQSCode: '370000002', SiteName: 'Example Station B', Latitude: 35.41, Longitude: -80.58, UTC: '2026-10-18T10:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'Example Agency' },
];
const ECHO = async (url) => {
  const facilities = [{ RegistryID: '110000000001', FacName: 'Example Plant', FacLat: '34.985', FacLong: '-80.549', FacCounty: 'UNION', FacComplianceStatus: 'No Violation Identified', NPDESFlag: 'Y' }];
  return { ok: true, json: async () => (String(url).includes('.get_facilities?') ? { Results: { QueryID: 'q1', QueryRows: '1' } } : { Results: { Facilities: facilities } }) };
};
const stored = (layer, payload) => ({ layer, assembled_at: new Date().toISOString(), payload });
/** Every layer and the district view, stored, built by the real payload builders with injected sources. */
async function storedLayers(utilities) {
  const air = await airPayload({ fetchImpl: async () => ({ ok: true, json: async () => AIRNOW }), apiKey: 'test-key', now: new Date('2026-10-18T11:00:00Z') });
  return [
    stored('water', waterPayload(utilities, geoFor(utilities))),
    stored('district', districtPayload(utilities, geoFor(utilities))),
    stored('air', air),
    stored('facilities', await facilitiesPayload({ fetchImpl: ECHO })),
  ];
}

function harness({ tables = TABLES, layers = [], utilities = utilitiesFor('NC05000'), operations: ledger = [], fetch, rateLimit } = {}) {
  return createRouteHarness({
    tables,
    ...(fetch ? { fetch } : {}),
    ...(rateLimit ? { rateLimit } : {}),
    seed: ({ alice, bob }) => Object.fromEntries(Object.entries({
      profiles: [{ id: alice.id, county: 'Union County' }, { id: bob.id, county: 'Wake County' }],
      map_layers: layers,
      ucmr5_utilities: utilities,
      operations: ledger.map((row) => ({ ...row, profile_id: alice.id })),
    }).filter(([table]) => table in tables)),
  });
}

// Response headers: both directions, for the pairs exercised below (as B03).
const CHECKED_HEADERS = ['x-request-id', 'retry-after', 'cache-control', 'vary'];
const seenHeaders = new Map();
const documentedHeaders = (id, status) =>
  new Set(Object.keys(operations.get(id).responses[String(status)].headers ?? {}).map((name) => name.toLowerCase()));
function recordHeaders(id, res) {
  const key = `${id} ${res.status}`;
  const documented = documentedHeaders(id, res.status);
  if (!seenHeaders.has(key)) seenHeaders.set(key, new Set());
  for (const name of CHECKED_HEADERS) {
    if (res.headers.get(name) === null) continue;
    seenHeaders.get(key).add(name);
    assert.ok(documented.has(name), `${key}: the response sends ${name} but the contract does not document it`);
  }
}

// Request headers: every header a test sends beyond the transport ones must be
// a documented parameter of that operation, and every documented header
// parameter must be sent by some exercised request.
const TRANSPORT = new Set(['authorization', 'content-type', 'x-request-id', 'accept']);
const sentHeaders = new Map();
const documentedParams = (id) =>
  new Set((operations.get(id).parameters ?? []).filter((p) => p.in === 'header').map((p) => p.name.toLowerCase()));
function recordRequestHeaders(id, headers) {
  if (!sentHeaders.has(id)) sentHeaders.set(id, new Set());
  for (const name of Object.keys(headers).map((h) => h.toLowerCase())) {
    if (TRANSPORT.has(name)) continue;
    sentHeaders.get(id).add(name);
    assert.ok(documentedParams(id).has(name), `${id}: the request sends ${name} but the contract does not document it`);
  }
}

/** One call to a real handler, checked against the document, the request id, D10 and the em dash rule. */
async function call(h, id, { expected = 200, query = '', body, rawBody, as = 'alice', headers = {} } = {}) {
  const op = operations.get(id);
  const sent = { 'x-request-id': REQUEST_ID, ...headers };
  recordRequestHeaders(id, sent);
  const res = await h.call(op.path, op.method, { as, url: `${op.path}${query}`, body, rawBody, headers: sent });
  assert.equal(res.status, expected, `${id}${query}: expected ${expected}, got ${res.status}`);
  const anonymous = as === null && !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
  if (MAP_OPERATIONS.includes(id) && anonymous && res.status === 200) {
    // A shareable answer carries an id the server chose, never the caller's (Task 6 review, finding 4).
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `${id}: a fresh id on a shared answer`);
  } else {
    assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${id}: the request id is echoed`);
  }
  if (MAP_OPERATIONS.includes(id)) {
    // Task 6: only a successful answer to a request with no Authorization header may be shared.
    const expectedCache = anonymous && res.status === 200 ? 'public, max-age=0, s-maxage=600' : 'private, no-store';
    assert.equal(res.headers.get('cache-control'), expectedCache, `${id} ${res.status}: Cache-Control`);
    assert.equal(res.headers.get('vary'), 'Authorization', `${id} ${res.status}: Vary`);
  }
  recordHeaders(id, res);
  const json = await res.json();
  validate(id, res.status, json);
  assertBare(json, `${id} ${res.status}`);
  if (expected >= 400) {
    assert.equal(json.request_id, REQUEST_ID);
    assert.equal(/supabase|postgres|PGRST|arcgis|airnow|upstash|redis|bearer/i.test(JSON.stringify(json)), false, `${id} ${expected}: nothing proof-bearing in an error envelope`);
  } else {
    assert.equal(CLIENT[id](json), true, `${id}: the client would refuse this payload: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { body: json, res };
}

const uuid = (n) => `0b050000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (list) => `&ids=${encodeURIComponent(JSON.stringify(list))}`;
/** The save the client sends (runtime.ts:133-136), its body validated as documented. */
function save(h, place, revision, { key = uuid(1), ifMatch = String(revision), expected = 200, homeContext, as = 'alice' } = {}) {
  const body = { place, revision };
  validateRequest('exploreAreaSave', body);
  return call(h, 'exploreAreaSave', {
    as,
    body,
    expected,
    headers: {
      ...(key === null ? {} : { 'idempotency-key': key }),
      ...(ifMatch === null ? {} : { 'if-match': ifMatch }),
      ...(homeContext ? { 'x-halo-home-context': homeContext } : {}),
    },
  });
}
const outage = (h) => { h.forceAuthOutage(); return h; };
async function authOutage(h, id, options) {
  const { res, body } = await call(outage(h), id, { ...options, expected: 503 });
  assert.equal(body.code, 'auth_unavailable');
  assert.equal(res.headers.get('retry-after'), '2');
}

// ---------------------------------------------------------------------------
// Handler conformance: every state each route can answer with
// ---------------------------------------------------------------------------

test('B05 handler conformance: map.layer answers all four layers, quarter=latest, a quarter, and the partial water answer', async (t) => {
  muteConsoleError(t);
  const utilities = utilitiesFor('NC05100');
  const h = harness({ utilities, layers: await storedLayers(utilities) });
  const { body: water } = await call(h, 'mapLayer', { query: '?layer=water' });
  assert.equal(water.prebuilt, true);
  const { body: latest } = await call(h, 'mapLayer', { query: '?layer=water&quarter=latest' });
  assert.deepEqual(latest, water, 'Ruling D2: latest is the absence of a quarter');
  for (const layer of ['air', 'facilities']) {
    const { body } = await call(h, 'mapLayer', { query: `?layer=${layer}&quarter=latest` });
    assert.equal(parseMapLayer(body, layer).partial, false);
  }
  const { body: radon } = await call(h, 'mapLayer', { query: '?layer=radon' });
  assert.equal(parseMapLayer(radon, 'radon').radon.length, radon.features.length);
  assert.deepEqual(h.blockedFetches, [], 'stored layers and radon need no outbound call');

  // The geography lookup fails (every fetch is refused): the water answer is
  // given, marked partial for the client, and is not stored.
  const fresh = utilitiesFor('NC05101');
  const down = harness({ utilities: fresh });
  for (const query of ['?layer=water&quarter=latest', '?layer=water&quarter=2024Q3']) {
    const { body } = await call(down, 'mapLayer', { query });
    assert.equal(body.meta.availability, 'partial');
    assert.equal(body.geography_complete, false);
    assert.equal(parseMapLayer(body, 'water').partial, true, `${query}: the client is told the layer is incomplete`);
  }
  assert.ok(down.blockedFetches.some((url) => String(url).startsWith(ARCGIS_WATER_BOUNDARIES)), 'the lookup really was attempted');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(down.db.rows('map_layers'), [], 'an incomplete build is stored nowhere');

  // A healthy lookup: a quarter answer with coordinates, never stored, and with no prebuilt.
  const arcgis = async (url) => {
    if (!String(url).startsWith(`${ARCGIS_WATER_BOUNDARIES}?`)) throw new TypeError('unexpected host');
    return new Response(JSON.stringify({ features: [{ attributes: { PWSID: 'NC0510201', Population_Served_Count: 34000 }, centroid: { x: -80.549, y: 34.985 } }] }));
  };
  const up = harness({ utilities: utilitiesFor('NC05102'), fetch: arcgis });
  const { body: quarter } = await call(up, 'mapLayer', { query: '?layer=water&quarter=2024Q3' });
  assert.deepEqual([quarter.quarter, quarter.located, 'prebuilt' in quarter, 'meta' in quarter], ['2024Q3', 1, false, false]);

  await call(h, 'mapLayer', { query: '?layer=district', expected: 400 });
  await call(h, 'mapLayer', { query: '?layer=air&quarter=2024Q3', expected: 400 });
  await call(h, 'mapLayer', { query: '?layer=water&quarter=LATEST', expected: 400 });
  // Task 6: no Authorization header is the public read, the signed-in body;
  // any other header that is not a session is still the 401.
  for (const layer of ['water', 'radon', 'facilities', 'air']) {
    const { body: visitor } = await call(h, 'mapLayer', { query: `?layer=${layer}`, as: null });
    const { body: owner } = await call(h, 'mapLayer', { query: `?layer=${layer}` });
    assert.deepEqual(visitor, owner, `${layer}: the anonymous body is the signed-in body`);
  }
  await call(h, 'mapLayer', { query: '?layer=water', as: null, headers: { authorization: 'Bearer' }, expected: 401 });
  const { body: notStored } = await call(harness(), 'mapLayer', { query: '?layer=radon', as: null, expected: 503 });
  assert.deepEqual([notStored.code, notStored.layer], ['upstream_unavailable', 'radon']);
  await call(harness({ utilities: utilitiesFor('NC05103') }), 'mapLayer', { query: '?layer=water&quarter=2024Q3', as: null, expected: 503 });
  const { res: limited } = await call(harness({ rateLimit: () => false }), 'mapLayer', { query: '?layer=water', as: null, expected: 429 });
  assert.equal(limited.headers.get('retry-after'), '60');
  const { body: unavailable } = await call(harness(), 'mapLayer', { query: '?layer=facilities', expected: 503 });
  assert.deepEqual([unavailable.code, unavailable.layer], ['upstream_unavailable', 'facilities']);
  const broken = harness({ tables: haloTables('profiles', 'map_layers') });
  await call(broken, 'mapLayer', { query: '?layer=water&quarter=2024Q3', expected: 500 });
  await authOutage(harness(), 'mapLayer', { query: '?layer=water' });
});

test('B05 handler conformance: map.district answers a view the client parses, or a 503 when the geography is incomplete', async (t) => {
  muteConsoleError(t);
  const utilities = utilitiesFor('NC05200');
  const h = harness({ utilities, layers: await storedLayers(utilities) });
  const { body } = await call(h, 'mapDistrict');
  assert.equal(body.household_county.county, 'Union County', 'the caller\'s own county, from their profile');
  assert.equal('county_rankings' in body, false);
  const { body: bobs } = await call(h, 'mapDistrict', { as: 'bob' });
  assert.equal(bobs.household_county.county, 'Wake County');

  const down = harness({ utilities: utilitiesFor('NC05201') });
  const { body: incomplete } = await call(down, 'mapDistrict', { expected: 503 });
  assert.equal(incomplete.code, 'upstream_unavailable');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(down.db.rows('map_layers'), [], 'nothing stored');

  const { body: visitor } = await call(h, 'mapDistrict', { as: null });
  const { household_county: own, ...shared } = body;
  assert.ok(own);
  assert.deepEqual(visitor, shared, 'Task 6: the anonymous view is the shared view, with no household_county key');
  await call(h, 'mapDistrict', { as: null, headers: { authorization: 'Basic abc' }, expected: 401 });
  const fresh = harness({ utilities: utilitiesFor('NC05202') });
  const { body: notStored } = await call(fresh, 'mapDistrict', { as: null, expected: 503 });
  assert.equal(notStored.code, 'upstream_unavailable');
  assert.deepEqual([fresh.blockedFetches, fresh.db.queryLog.map((q) => q.table)], [[], ['map_layers']], 'no lookup and no profile');
  const { res: limited } = await call(harness({ rateLimit: () => false }), 'mapDistrict', { as: null, expected: 429 });
  assert.equal(limited.headers.get('retry-after'), '60');
  await call(harness({ tables: haloTables('map_layers', 'ucmr5_utilities'), layers: await storedLayers(utilities) }), 'mapDistrict', { expected: 500 });
  await authOutage(harness(), 'mapDistrict');
});

test('B05 handler conformance: locations.search answers counties, cities and ZIP codes, each as its fixture shows', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const fixtureBody = (name) => fixtures.find((item) => item.name === name).body;
  const { body } = await call(h, 'locationsSearch', { query: `?${new URLSearchParams({ query: 'Wake County', state: 'NC' })}` });
  assert.deepEqual(body, { candidates: [WAKE] });
  // The fixtures are the real answers to the queries they stand for, not hand-made look-alikes.
  for (const [query, name] of [['Wake', 'locationsSearch-success.json'], ['Charlotte', 'locationsSearch-city.json'], ['28208', 'locationsSearch-zip.json'], ['Atlantis', 'locationsSearch-empty.json']]) {
    const { body: found } = await call(h, 'locationsSearch', { query: `?${new URLSearchParams({ query, state: '' })}` });
    assert.deepEqual(found, fixtureBody(name), `${query}: ${name}`);
  }
  for (const [query, state] of [['Charlotte', 'SC'], ['28208', 'Virginia'], ['29707', '']]) {
    const { body: none } = await call(h, 'locationsSearch', { query: `?${new URLSearchParams({ query, state })}` });
    assert.deepEqual(none, { candidates: [] }, `${query} in "${state}": not North Carolina`);
  }
  for (const query of ['Ca', '282']) {
    const { body: many } = await call(h, 'locationsSearch', { query: `?query=${query}` });
    assert.equal(many.candidates.length, 20, `${query}: the documented cap is reached and validated`);
  }
  await call(h, 'locationsSearch', { query: '?query=', expected: 400 });
  await call(h, 'locationsSearch', { query: `?query=Wake&state=${'x'.repeat(41)}`, expected: 400 });
  await call(h, 'locationsSearch', { query: '?query=Wake', as: null, expected: 401 });
  assert.deepEqual(h.db.queryLog, [], 'no table is read');
  assert.deepEqual(h.blockedFetches, [], 'no provider is called');
  await authOutage(harness(), 'locationsSearch', { query: '?query=Wake' });
});

test('B05 handler conformance: explore.area.read answers revision 1 for a household that never saved, and never a pending operation', async (t) => {
  muteConsoleError(t);
  const h = harness({
    operations: [{ operation_id: uuid(50), domain: 'explore', kind: 'explore.area.save', status: 'pending', request_hash: 'x', created_at: NOW }],
  });
  const { body } = await call(h, 'exploreAreaRead', { headers: { 'x-halo-home-context': uuid(99) } });
  assert.deepEqual(body, { place: null, revision: 1 }, 'Rulings D6 and D7');
  await call(h, 'exploreAreaRead', { as: null, expected: 401 });
  const { body: missing } = await call(harness({ tables: haloTables('profiles', 'operations') }), 'exploreAreaRead', { expected: 503 });
  assert.deepEqual([missing.code, missing.retryable], ['feature_unavailable', false]);
  const broken = harness();
  const from = broken.db.from;
  broken.db.from = (name) => { if (name === 'explore_areas') throw Object.assign(new Error('contractsB05: boom'), { code: 'XX000' }); return from(name); };
  await call(broken, 'exploreAreaRead', { expected: 500 });
  await authOutage(harness(), 'exploreAreaRead');
});

test('B05 handler conformance: explore.area.save answers the area, and refuses with every documented 409 reason', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: saved } = await save(h, WAKE, 1);
  assert.deepEqual(saved, { place: WAKE, revision: 2 });
  const { body: replayed } = await save(h, WAKE, 1);
  assert.deepEqual(replayed, saved, 'the same key and body is the first outcome');
  const reasons = {};
  reasons.stale_revision = (await save(h, WAKE, 1, { key: uuid(2), expected: 409 })).body;
  assert.equal(reasons.stale_revision.revision, 2, 'and says which revision is current');
  reasons.operation_mismatch = (await save(h, null, 2, { key: uuid(1), expected: 409 })).body;
  const { body: cleared } = await save(h, null, 2, { key: uuid(3) });
  assert.deepEqual(cleared, { place: null, revision: 3 });

  const MAX = 2147483647;
  const full = harness();
  await full.db.from('explore_areas').insert({ profile_id: full.identities.alice.id, place_id: WAKE.id, place: WAKE.place, state: 'NC', label: WAKE.label, timezone: WAKE.timezone, revision: MAX });
  reasons.revision_exhausted = (await save(full, WAKE, MAX, { key: uuid(4), expected: 409 })).body;
  assert.equal(reasons.revision_exhausted.revision, MAX);

  const hash = requestHash({ place: WAKE, revision: 1 });
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const row = (extra) => ({ operation_id: uuid(5), domain: 'explore', kind: 'explore.area.save', request_hash: hash, ...extra });
  reasons.abandoned = (await save(harness({ operations: [row({ status: 'pending', created_at: ago(10 * 60_000) })] }), WAKE, 1, { key: uuid(5), expected: 409 })).body;
  reasons.attempt_failed = (await save(harness({ operations: [row({ status: 'failed', result: null, created_at: ago(5_000) })] }), WAKE, 1, { key: uuid(5), expected: 409 })).body;
  for (const reason of CONFLICT_REASONS) {
    assert.equal(reasons[reason].reason, reason, `${reason} is really produced by the handler`);
    assert.equal(reasons[reason].retryable, false);
  }
  const { body: inFlight } = await save(harness({ operations: [row({ status: 'pending', created_at: ago(1_000) })] }), WAKE, 1, { key: uuid(5), expected: 503 });
  assert.deepEqual([inFlight.code, inFlight.retryable], ['upstream_unavailable', true]);

  // Validation: each refusal is a 400 before the ledger is touched.
  const fresh = harness();
  await save(fresh, WAKE, 1, { ifMatch: '2', expected: 400 });
  await save(fresh, WAKE, 1, { key: null, expected: 400 });
  await save(fresh, WAKE, 1, { key: 'not-a-uuid', expected: 400 });
  await save(fresh, { id: 'us-county:45001' }, 1, { expected: 400 });
  await call(fresh, 'exploreAreaSave', { body: { place: WAKE, revision: 1, profile_id: 'x' }, headers: { 'idempotency-key': uuid(6) }, expected: 400 });
  await call(fresh, 'exploreAreaSave', { rawBody: '{', headers: { 'idempotency-key': uuid(7) }, expected: 400 });
  await call(fresh, 'exploreAreaSave', { rawBody: JSON.stringify({ padding: 'x'.repeat(5000) }), headers: { 'idempotency-key': uuid(8) }, expected: 413 });
  assert.deepEqual(fresh.db.rows('operations'), [], 'no operation id was claimed by a refused request');
  await save(fresh, WAKE, 1, { as: null, expected: 401 });

  const { body: missing } = await save(harness({ tables: haloTables('profiles', 'operations') }), WAKE, 1, { expected: 503 });
  assert.deepEqual([missing.code, missing.retryable], ['feature_unavailable', false]);
  const broken = harness();
  const from = broken.db.from;
  broken.db.from = (name) => {
    const builder = from(name);
    if (name === 'explore_areas') builder.insert = () => { throw Object.assign(new Error('contractsB05: boom'), { code: 'XX000' }); };
    return builder;
  };
  await save(broken, WAKE, 1, { expected: 500 });
  await authOutage(harness(), 'exploreAreaSave', { body: { place: WAKE, revision: 1 }, headers: { 'idempotency-key': uuid(9), 'if-match': '1' } });
});

test('B05 handler conformance: map.comparison answers records the client parses, every pair "Not comparable" for the documented reasons', async (t) => {
  muteConsoleError(t);
  const utilities = utilitiesFor('NC05300');
  const h = harness({ utilities, layers: await storedLayers(utilities) });
  const water = (await call(h, 'mapComparison', { query: `?layer=water&quarter=latest${ids(utilities.map((u) => u.pwsid))}` })).body.records;
  const air = (await call(h, 'mapComparison', { query: `?layer=air&quarter=latest${ids(AIRNOW.map((s) => s.FullAQSCode))}` })).body.records;
  assert.deepEqual([water.length, air.length], [2, 2]);
  for (const [records, compoundList] of [[water, compounds.map(([key]) => key)], [air, ['overall']]]) {
    const parsed = parseMapComparisons(records, records.map((r) => r.id));
    for (const first of parsed) {
      for (const second of parsed) {
        for (const compound of compoundList) {
          for (const row of comparisonRows(first, second, compound)) {
            assert.equal(row.compatible, false, `${first.id}/${second.id}/${compound}`);
            for (const reason of [c.reasons.method, c.reasons.source, c.reasons.qualifier]) assert.ok(row.reasons.includes(reason));
            assert.ok(row.warnings.includes(c.incomplete));
            assert.equal(rowLabel(row), c.unavailable, 'never "Aligned evidence" or "Limited comparison" (HO-047, AC-123)');
          }
        }
      }
    }
  }
  const { body: radon } = await call(h, 'mapComparison', { query: `?layer=radon&quarter=latest${ids(['Union County'])}` });
  assert.deepEqual(radon, { records: [] });
  assert.deepEqual(h.blockedFetches, [], 'no outbound call');
  await call(h, 'mapComparison', { query: `?layer=water&quarter=latest${ids([])}`, expected: 400 });
  await call(h, 'mapComparison', { query: `?layer=air&quarter=2024Q3${ids(['370000001'])}`, expected: 400 });
  await call(h, 'mapComparison', { query: `?quarter=latest${ids(['370000001'])}`, expected: 400 });
  const { body: visitor } = await call(h, 'mapComparison', { query: `?layer=water&quarter=latest${ids(utilities.map((u) => u.pwsid))}`, as: null });
  assert.deepEqual(visitor.records, water, 'Task 6: the anonymous records are the signed-in records');
  await call(h, 'mapComparison', { query: `?layer=water${ids(['NC0530001'])}`, as: null, headers: { authorization: 'Bearer test-token:nobody' }, expected: 401 });
  await call(harness(), 'mapComparison', { query: `?layer=air&quarter=latest${ids(['370000001'])}`, as: null, expected: 503 });
  const { res: limited } = await call(harness({ rateLimit: () => false }), 'mapComparison', { query: `?layer=water${ids(['NC0530001'])}`, as: null, expected: 429 });
  assert.equal(limited.headers.get('retry-after'), '60');
  const { body: noAir } = await call(harness(), 'mapComparison', { query: `?layer=air&quarter=latest${ids(['370000001'])}`, expected: 503 });
  assert.equal(noAir.code, 'upstream_unavailable');
  await authOutage(harness(), 'mapComparison', { query: `?layer=water${ids(['NC0530001'])}` });
});

// ---------------------------------------------------------------------------
// Cross-route agreement
// ---------------------------------------------------------------------------

test('a locations.search candidate saved through PATCH and read through GET is the same object on all three surfaces, and each revision is the next If-Match', async (t) => {
  muteConsoleError(t);
  const h = harness();
  let { body: area } = await call(h, 'exploreAreaRead');
  let key = 100;
  for (const query of ['Wake', 'Mecklenburg County', 'new-hanover', 'Robeson Co.', 'Charlotte', '28208', 'Fairview (Union County)', "spivey's corner"]) {
    const { body: found } = await call(h, 'locationsSearch', { query: `?${new URLSearchParams({ query, state: 'NC' })}` });
    const candidate = found.candidates[0];
    assert.ok(candidate, `${query}: a candidate`);
    // The client sends the candidate it was given, at the revision it holds, as both body and If-Match.
    const { body: saved } = await save(h, candidate, area.revision, { key: uuid((key += 1)), homeContext: uuid(999) });
    assert.deepEqual(saved.place, candidate, `${query}: the save returns the search's own object`);
    assert.equal(saved.revision, area.revision + 1, `${query}: the revision the save was sent with was accepted`);
    const { body: reread } = await call(h, 'exploreAreaRead');
    assert.deepEqual(reread, saved, `${query}: the read is the save's own answer`);
    assert.deepEqual(reread.place, candidate, `${query}: and the search's own object`);
    assert.deepEqual(Object.keys(reread.place).sort(), Object.keys(candidate).sort());
    area = reread;
  }
  // The returned revision is accepted as the next If-Match; the one before it is not.
  await save(h, null, area.revision - 1, { key: uuid((key += 1)), expected: 409 });
  const { body: cleared } = await save(h, null, area.revision, { key: uuid((key += 1)) });
  assert.deepEqual(cleared, { place: null, revision: area.revision + 1 });
  assert.deepEqual((await call(h, 'exploreAreaRead')).body, cleared);
  assert.deepEqual(h.blockedFetches, []);
});

test('map.comparison finds a record for every id map.layer gave the client, for water and air', async (t) => {
  muteConsoleError(t);
  const utilities = utilitiesFor('NC05400');
  const h = harness({ utilities, layers: await storedLayers(utilities) });
  for (const layer of ['water', 'air']) {
    const { body } = await call(h, 'mapLayer', { query: `?layer=${layer}` });
    const parsed = parseMapLayer(body, layer);
    const layerIds = (layer === 'water' ? parsed.water.map((f) => f.pwsid) : parsed.air.map((s) => s.id)).sort();
    const { body: compared } = await call(h, 'mapComparison', { query: `?layer=${layer}&quarter=latest${ids(layerIds)}` });
    assert.deepEqual(compared.records.map((r) => r.id).sort(), layerIds, `${layer}: the ids agree across the two routes`);
    const names = new Map(compared.records.map((r) => [r.id, r.name]));
    for (const feature of layer === 'water' ? parsed.water : parsed.air) assert.equal(names.get(feature.pwsid ?? feature.id), feature.name, `${layer}: and so do the names`);
  }
});

// ---------------------------------------------------------------------------
// Fixture hygiene
// ---------------------------------------------------------------------------

test('no B05 fixture carries a secret, a token, a real address or a source it should not', () => {
  const forbidden = [
    /sk-[A-Za-z0-9]/, /Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/,
    /api[_-]?key/i, /secret/i, /password/i, /authorization/i,
    /supabase|upstash|openrouter|openai|mapbox/i,
    /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/,
    /\b\d{3}-\d{2}-\d{4}\b/,
  ];
  // Ruling D3 fixes the comparison's background links to the two public program
  // pages; no other url appears in a B05 body.
  const allowed = new Set(['https://www.epa.gov/dwucmr', 'https://www.airnow.gov/']);
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture.body);
    for (const pattern of forbidden) assert.equal(pattern.test(serialized), false, `${fixture.name} matches ${pattern}`);
    for (const url of serialized.match(/https?:\/\/[^"]+/g) ?? []) assert.ok(allowed.has(url), `${fixture.name}: ${url}`);
    assert.ok(['b05-contract-0001', undefined].includes(fixture.body.request_id), `${fixture.name}: a synthetic request id`);
  }
});

// ---------------------------------------------------------------------------
// Header documentation, both ways. Runs last: tests in one file run in order.
// ---------------------------------------------------------------------------

test('B05 contract headers: every documented response header is really sent, for the pairs these tests exercise', () => {
  assert.ok(seenHeaders.size > 0, 'no conformance responses were recorded');
  for (const [key, seen] of seenHeaders) {
    const [id, status] = key.split(' ');
    for (const name of documentedHeaders(id, status)) {
      if (CHECKED_HEADERS.includes(name)) assert.ok(seen.has(name), `${key}: the contract documents ${name} but no exercised response sent it`);
    }
  }
});

test('B05 contract headers: every documented request header (Idempotency-Key, If-Match, X-Halo-Home-Context) was sent by an exercised request', () => {
  for (const id of operations.keys()) {
    for (const name of documentedParams(id)) {
      assert.ok(sentHeaders.get(id)?.has(name), `${id}: the contract documents the ${name} header but no exercised request sent it`);
    }
  }
  assert.deepEqual([...documentedParams('exploreAreaSave')].sort(), ['idempotency-key', 'if-match', 'x-halo-home-context']);
});
