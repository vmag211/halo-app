/**
 * The B12 public evidence reads (docs/backend/plans/b12-public-evidence.md):
 * the five `readResource` resources of the Food and Garden workspace, served
 * from reviewed static files built by scripts/build-public-evidence.mjs.
 *
 *   fish-catalogue           GET /api/fish/advisories  fish.read
 *   water-stewardship        GET /api/water/notices    water.read
 *   grower-resources         GET /api/growers          growers.search
 *   food-evidence            GET /api/food/evidence    food.search
 *   published-food-evidence  GET /api/food/evidence    food.search
 *
 * Every answer is public information, the same for every household, built
 * without reading a table or calling a provider. Each projection first checks
 * its file's shape and returns null when it is broken, which the route answers
 * as 503 unavailable: a broken source is never served as an empty list
 * ("Source failures show load/retry states without example fallback", W:567).
 *
 * Water is the exception since B19: the weekly import stores newer copies of
 * its two sources (migration 0033), and the route passes the composed file in
 * (lib/publicWaterStore.js); with none stored, the bundled file is served.
 *
 * The bodies are what the frontend validators accept
 * (lib/frontend/production/home-resources.ts). Wording is the file's, which is
 * the source's: nothing here rewrites advice. The only text computed at
 * request time is the drought release's currency note, from its own validity
 * dates and the date of the request.
 */
import fishFile from './data/ncFishAdvisories.json' with { type: 'json' };
import waterFile from './data/ncWaterStewardship.json' with { type: 'json' };
import growerFile from './data/ncGrowerResources.json' with { type: 'json' };
import foodFile from './data/foodEvidenceStudies.json' with { type: 'json' };
import { composeWaterFile } from './publicWaterStore.js';

const files = { fish: fishFile, water: waterFile, growers: growerFile, food: foodFile };

/** Test seam: replace one data file (null restores it). */
export function _setEvidenceFileForTest(name, value) {
  files[name] = value === null ? { fish: fishFile, water: waterFile, growers: growerFile, food: foodFile }[name] : value;
}

const EM_DASH = String.fromCharCode(0x2014);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (row, keys) => isObject(row) && keys.every((key) => typeof row[key] === 'string' && row[key].length > 0 && !row[key].includes(EM_DASH));
const revision = (value) => Number.isSafeInteger(value) && value > 0;
const list = (value, max, predicate) => Array.isArray(value) && value.length <= max && value.every(predicate);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FOOD_ID = /^[a-z0-9-]{1,80}$/;
export function httpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- queries

/** Which resources each route answers, and the one it defaults to (none: required). */
export const ROUTE_RESOURCES = Object.freeze({
  'fish.read': { allowed: ['fish-catalogue'], fallback: 'fish-catalogue' },
  'water.read': { allowed: ['water-stewardship'], fallback: 'water-stewardship' },
  'growers.search': { allowed: ['grower-resources'], fallback: 'grower-resources' },
  'food.search': { allowed: ['food-evidence', 'published-food-evidence'], fallback: null },
});

/**
 * The query: `resource` (the adapter always sends it) and, for the published
 * food bundle, `foodId` and `guideId`. Anything else is ignored, never read
 * into the answer and never logged. Bounded: a value over 80 characters or
 * outside [a-z0-9-] is a 400 with a field error.
 */
export function parseEvidenceQuery(operation, searchParams) {
  const route = ROUTE_RESOURCES[operation];
  const fieldErrors = [];
  const raw = searchParams.get('resource');
  const resource = raw === null || raw === '' ? route.fallback : raw;
  if (!resource || !route.allowed.includes(resource)) {
    fieldErrors.push({ field: 'resource', code: resource ? 'invalid' : 'required', message: `resource must be one of: ${route.allowed.join(', ')}.` });
  }
  const value = { resource };
  if (resource === 'published-food-evidence') {
    for (const field of ['foodId', 'guideId']) {
      const given = searchParams.get(field);
      if (given === null || given === '') continue;
      if (!FOOD_ID.test(given)) fieldErrors.push({ field, code: 'invalid', message: `${field} must be up to 80 lowercase letters, digits or hyphens.` });
      else value[field] = given;
    }
  }
  return fieldErrors.length ? { ok: false, fieldErrors } : { ok: true, value };
}

// ------------------------------------------------------------------ fish

const FISH_RULE_KEYS = ['id', 'title', 'kind', 'waterbody', 'species', 'status', 'date', 'extent', 'pollutant', 'wording', 'condition', 'previous'];

export function fishCatalogue() {
  const file = files.fish;
  if (!isObject(file) || !httpsUrl(file.sourceUrl) || typeof file.version !== 'string') return null;
  const ids = new Set(Array.isArray(file.waterbodies) ? file.waterbodies.map((row) => row?.id) : []);
  const ok = list(file.waterbodies, 500, (row) => strings(row, ['id', 'title', 'extent', 'jurisdiction']))
    && ids.size === file.waterbodies.length
    && list(file.audiences, 50, (row) => strings(row, ['id', 'title']))
    && file.audiences.some((row) => row.id === 'unknown')
    && list(file.species, 500, (item) => typeof item === 'string' && item.length > 0)
    && list(file.rules, 5000, (row) => strings(row, FISH_RULE_KEYS) && revision(row.revision) && httpsUrl(row.url)
      && (row.waterbody === 'statewide'
        ? list(row.waterbodyIds, 500, (id) => ids.has(id)) && row.waterbodyIds.length > 0
        : ids.has(row.waterbody))
      && file.species.includes(row.species))
    && new Set(file.rules.map((row) => row.id)).size === file.rules.length;
  if (!ok) return null;
  return {
    waterbodies: file.waterbodies,
    audiences: file.audiences,
    species: file.species,
    rules: file.rules,
    sourceUrl: file.sourceUrl,
    version: file.version,
  };
}

// ----------------------------------------------------------------- water

const SHARES = ['none', 'd0', 'd1', 'd2', 'd3', 'd4'];

/** The release's currency, from its own validity and the request date (UTC). */
function currency(release, newestDate, today) {
  // Only the newest map can be current: an older map whose week the clock still sits in (a server
  // clock behind the copy) is an earlier map, so no county ever shows two current maps.
  if (release.date < newestDate) return 'An earlier weekly map.';
  if (release.validEnd >= today) return 'The current weekly map.';
  return 'A newer weekly map has likely been published since HALO\'s copy. Check the source.';
}

const COPY_ORIGINS = ['scheduled', 'bundled'];
const validCopy = (copy) => isObject(copy) && COPY_ORIGINS.includes(copy.origin) && DATE.test(copy.retrieved) && DATE.test(copy.sourceDate);

/**
 * `water-stewardship`. `file` is what lib/publicWaterStore.js composed from the
 * stored copies (B19); by default the bundled file alone. `copies` states, for
 * each source, whether the rows are the weekly import's or the bundled copy,
 * the date HALO retrieved them and the source's own newest date. A file
 * without those dates is broken, like any other shape failure.
 */
export function waterStewardship(now = new Date(), file = composeWaterFile(files.water)) {
  if (!isObject(file) || typeof file.version !== 'string') return null;
  if (!isObject(file.copies) || !validCopy(file.copies.drought) || !validCopy(file.copies.utility)) return null;
  const countyIds = new Set(Array.isArray(file.counties) ? file.counties.map((row) => row?.id) : []);
  const ok = list(file.counties, 200, (row) => strings(row, ['id', 'title']))
    && list(file.releases, 5000, (row) => strings(row, ['id', 'countyId', 'date', 'status', 'scope', 'validStart', 'validEnd'])
      && countyIds.has(row.countyId) && DATE.test(row.date) && DATE.test(row.validEnd) && revision(row.revision) && httpsUrl(row.sourceUrl)
      && SHARES.every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 100))
    && list(file.notices, 2000, (row) => strings(row, ['id', 'title', 'status', 'date', 'instructions', 'scope']) && revision(row.revision) && httpsUrl(row.sourceUrl));
  if (!ok) return null;
  const today = now.toISOString().slice(0, 10);
  const newest = new Map();
  for (const row of file.releases) if (!newest.has(row.countyId) || newest.get(row.countyId) < row.date) newest.set(row.countyId, row.date);
  return {
    counties: file.counties,
    releases: file.releases.map((row) => ({ ...row, status: `${row.status}. ${currency(row, newest.get(row.countyId), today)}` })),
    notices: file.notices,
    version: file.version,
    copies: {
      drought: { origin: file.copies.drought.origin, retrieved: file.copies.drought.retrieved, sourceDate: file.copies.drought.sourceDate },
      utility: { origin: file.copies.utility.origin, retrieved: file.copies.utility.retrieved, sourceDate: file.copies.utility.sourceDate },
    },
  };
}

// --------------------------------------------------------------- growers

export function growerResources() {
  const file = files.growers;
  if (!isObject(file)) return null;
  const ok = list(file.resources, 200, (row) => strings(row, ['id', 'title', 'concern', 'region', 'matrix', 'scope', 'qualifications', 'cost', 'deadline'])
    && list(row.documents, 50, (item) => typeof item === 'string' && item.length > 0) && httpsUrl(row.url) && revision(row.revision));
  return ok ? file.resources : null;
}

// ------------------------------------------------------------------ food

function foodStudies() {
  const file = files.food;
  if (!isObject(file) || !strings(file, ['reviewedAt', 'revision', 'boundary']) || !list(file.catalogue, 1000, (row) => strings(row, ['id', 'guideId']))) return null;
  const ok = list(file.studies, 500, (row) => strings(row, ['id', 'title', 'analyte', 'finding', 'scopeDetail', 'limitation', 'nextStep'])
    && row.scope === 'food-study' && ['PFAS', 'Lead'].includes(row.contaminant)
    && list(row.foodIds, 50, (id) => typeof id === 'string')
    && strings(row.source, ['title', 'locator', 'publishedAt', 'sampledAt', 'reviewedAt']) && httpsUrl(row.source.url) && httpsUrl(row.source.methodologyUrl)
    && strings(row.sample, ['region', 'method', 'basis'])
    && list(row.metrics, 20, (metric) => strings(metric, ['label', 'value', 'unit'])));
  return ok ? file : null;
}

const CATEGORY = { produce: 'Produce', seafood: 'Seafood', dairy: 'Dairy', meat: 'Meat', pantry: 'Pantry' };

/**
 * `food-evidence`: the dated records the evidence screen lists. Only studies:
 * food notices (openFDA enforcement reports) are blocked until their
 * acquisition review, so no `Notice` row is ever invented.
 */
export function foodNotices() {
  const file = foodStudies();
  if (!file) return null;
  return file.studies.map((study) => {
    const guideId = file.catalogue.find((food) => food.id === study.foodIds[0])?.guideId;
    return {
      id: study.id,
      title: study.title,
      kind: 'Study',
      region: 'United States (national FDA study)',
      category: CATEGORY[guideId] ?? 'Food',
      status: 'Published study, historical samples',
      version: 1,
      issued: study.source.publishedAt,
      sampleDate: study.source.sampledAt,
      scope: study.scopeDetail,
      finding: study.finding,
      applicability: study.limitation,
      instruction: study.nextStep,
      previous: `Reviewed by HALO on ${study.source.reviewedAt}. No superseded version recorded.`,
      url: study.source.url,
      // The screen names the study's own contaminant and publication in its source link.
      contaminant: study.contaminant,
      sourceTitle: study.source.title,
    };
  });
}

/**
 * `published-food-evidence`: the bundle for one catalogue food, by the same
 * rule as the frontend's evidenceForFood (lib/frontend/food-evidence.ts):
 * strict catalogue identity, never a fuzzy match; an unknown food has no
 * studies and both indicators say "Guidance available"; itemLevel is always
 * Unknown. guideId is accepted and validated but chooses nothing, as there.
 */
export function publishedFoodEvidence({ foodId } = {}) {
  const file = foodStudies();
  if (!file) return null;
  const food = foodId ? file.catalogue.find((item) => item.id === foodId) : undefined;
  const studies = food ? file.studies.filter((study) => study.foodIds.includes(food.id)) : [];
  return {
    ...(food ? { foodId: food.id } : {}),
    studies,
    indicators: ['PFAS', 'Lead'].map((contaminant) => {
      const evidenceCount = studies.filter((study) => study.contaminant === contaminant).length;
      return { contaminant, label: evidenceCount ? 'Study available' : 'Guidance available', itemLevel: 'Unknown', evidenceCount };
    }),
    boundary: file.boundary,
    reviewedAt: file.reviewedAt,
    revision: file.revision,
  };
}

function answerFor({ resource, foodId }, now, water) {
  switch (resource) {
    case 'fish-catalogue': return fishCatalogue();
    case 'water-stewardship': return water === undefined ? waterStewardship(now) : waterStewardship(now, water);
    case 'grower-resources': return growerResources();
    case 'food-evidence': return foodNotices();
    case 'published-food-evidence': return publishedFoodEvidence({ foodId });
    default: return null;
  }
}

/** The bundled water file as water.read would serve it with no stored copy (lib/publicWaterStore.js). */
export function bundledWaterFile() {
  return files.water;
}

/**
 * The answer for a parsed query, or null when its source file is broken. A last check over the
 * whole body refuses any U+2014, including in fields no projection reads (a version, a link).
 * `water` is the composed water file (B19); without it the bundled file is used.
 */
export function readEvidence(query, { now = new Date(), water } = {}) {
  const body = answerFor(query, now, water);
  return body !== null && JSON.stringify(body).includes(EM_DASH) ? null : body;
}
