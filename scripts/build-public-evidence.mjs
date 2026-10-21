/**
 * Builds the four static files behind the B12 public evidence reads
 * (docs/backend/plans/b12-public-evidence.md):
 *
 *   lib/data/ncFishAdvisories.json     GET /api/fish/advisories  (fish.read)
 *   lib/data/ncWaterStewardship.json   GET /api/water/notices    (water.read)
 *   lib/data/ncGrowerResources.json    GET /api/growers          (growers.search)
 *   lib/data/foodEvidenceStudies.json  GET /api/food/evidence    (food.search)
 *
 *   node scripts/build-public-evidence.mjs --src <dir> --retrieved 2026-10-20
 *
 * `--src` holds files downloaded by hand and read first (names below, with the
 * URL each came from). They are untrusted data: only read as JSON or text,
 * never executed, and every value that reaches an output is checked. Nothing
 * is fetched here. Each output header records every input's URL, retrieval
 * date and sha256, so a reviewer can match the output to the downloads.
 *
 * REVISIONS. Each record's content is compared with the same id in the output
 * already on disk: unchanged keeps its revision, changed gets revision + 1 and
 * a `previous` line naming the superseded revision, new starts at 1.
 *
 * WORDING. Advice text is copied exactly. Fish rules whose source text is cut
 * off, or that name another listed waterbody and not their own, are withheld
 * (status and wording say so) and link to the official advisory graphic. The
 * statewide mercury rules are assembled only from phrases that are checked to
 * occur in the downloaded NC DHHS page. No output string may contain U+2014.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  DROUGHT_ISSUER, DROUGHT_STATISTIC, UTILITY_ISSUER, WATER_LICENCE, WUDC_URL,
  clean, countyRows, createReviser, decode, parseConservationStatus, parseDroughtStatistics,
} from '../lib/publicWaterSources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, at, all) => (at % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), all[at + 1]]] : pairs), []),
);
for (const name of ['src', 'retrieved']) if (!args[name]) throw new Error(`--${name} is required`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.retrieved)) throw new Error('--retrieved is a YYYY-MM-DD date');
const RETRIEVED = args.retrieved;

const FISH_LAYER = 'https://services.arcgis.com/iFBq2AW9XO0jYYF7/arcgis/rest/services/FA_Lakes_Rivers_Points2/FeatureServer/32';
const INPUTS = {
  fishLayer: { file: 'fish-layer.json', url: `${FISH_LAYER}?f=json` },
  fishPoints: { file: 'fish-points.json', url: `${FISH_LAYER}/query?where=1%3D1&outFields=*&returnGeometry=false&orderByFields=OBJECTID&f=json` },
  fishPage: { file: 'fish-page.html', url: 'https://epi.dph.ncdhhs.gov/oee/fish/arcg.html' },
  safeFish: { file: 'safefish.html', url: 'https://epi.dph.ncdhhs.gov/oee/mercury/safefish.html' },
  usdm: { file: 'usdm-nc.json', url: 'https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=NC&startdate=9/22/2026&enddate=10/20/2026&statisticsType=2' },
  wudc: { file: 'wudc.html', url: WUDC_URL },
  extension: { file: 'extension.html', url: 'https://www.ces.ncsu.edu/local-county-center/' },
  soil: { file: 'ncda-soil.html', url: 'https://www.ncagr.gov/Divisions/Agronomic-Services/soil-testing' },
  labs: { file: 'deq-labs.html', url: 'https://www.deq.nc.gov/about/divisions/water-resources/drinking-water/drinking-water-laboratories' },
  fdaSeafood: { file: 'fda-seafood-2022.pdf', url: 'https://www.fda.gov/media/159570/download' },
  fdaTds: { file: 'fda-tds-supplement.pdf', url: 'https://www.fda.gov/media/159751/download' },
  fdaTdsMethods: { file: 'fda-tds-methods.pdf', url: 'https://www.fda.gov/media/159745/download' },
  fdaPfas: { file: 'fda-pfas-testing.html', url: 'https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure' },
};
const bytes = {};
const provenance = {};
for (const [key, input] of Object.entries(INPUTS)) {
  bytes[key] = readFileSync(path.join(args.src, input.file));
  provenance[key] = { url: input.url, retrieved: RETRIEVED, sha256: createHash('sha256').update(bytes[key]).digest('hex'), bytes: bytes[key].length };
}
const text = (key) => bytes[key].toString('utf8');
const json = (key) => JSON.parse(text(key));

// ------------------------------------------------------------------ helpers

/** Page text: block tags become spaces, inline tags vanish, whitespace collapses. */
function pageText(html) {
  return decode(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(p|li|ul|ol|div|h\d|br|tr|td|th|table|tbody|thead|section|main|header|footer)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}
const slug = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sentenceCase = (value) => { const v = clean(value).toLowerCase(); return v.charAt(0).toUpperCase() + v.slice(1); };
function requireIn(haystack, phrase, where) {
  if (!haystack.includes(phrase)) throw new Error(`${where}: expected phrase not found: "${phrase}"`);
  return phrase;
}
function noEmDash(value, where) {
  const found = JSON.stringify(value).includes(String.fromCharCode(0x2014));
  if (found) throw new Error(`${where}: an output string contains U+2014`);
}
function safeHttps(value, where) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${where}: not a plain https URL`);
  return value;
}

/** Carries revisions forward from the output already on disk (see REVISIONS above). */
function reviser(outFile, listOf) {
  return createReviser(existsSync(outFile) ? listOf(JSON.parse(readFileSync(outFile, 'utf8'))) : [], RETRIEVED);
}
function write(file, value) {
  noEmDash(value, file);
  writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 1)}\n`);
  console.log(`wrote ${file}`);
}

// --------------------------------------------------------------------- fish

const FIRST_REVISION_NOTE = 'No earlier version recorded by HALO.';
const GENERIC_WATER_WORDS = new Set(['lake', 'river', 'reservoir', 'creek', 'sound', 'branch', 'system']);
const CATFISH_FAMILY = ['Blue catfish', 'Channel catfish', 'Flathead catfish'];
/** Spelling fixes for matching only; the advisory wording keeps the source spelling. */
const SPECIES_SPELLING = { 'Blue gill': 'Bluegill', 'Stripped bass': 'Striped bass', All: 'All fish' };

function speciesTokens(label) {
  return clean(label).replace(/^and\s+/i, '')
    .split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i)
    .map((token) => sentenceCase(token)).filter(Boolean)
    .map((token) => SPECIES_SPELLING[token] ?? token);
}

function buildFish() {
  const layer = json('fishLayer');
  const lastEdit = layer?.editingInfo?.lastEditDate;
  if (!Number.isFinite(lastEdit)) throw new Error('fish layer: no editingInfo.lastEditDate');
  const serviceUpdated = new Date(lastEdit).toISOString().slice(0, 10);
  const rows = json('fishPoints').features?.map((feature) => feature.attributes);
  if (!Array.isArray(rows) || rows.length < 20 || rows.length > 200) throw new Error('fish points: unexpected row count');
  requireIn(pageText(text('fishPage')), 'North Carolina Fish Consumption Advisories', 'fish page');

  const waterbodies = [];
  const sites = [];
  for (const row of rows) {
    const title = clean(row.Wtr_Bdy);
    const countyList = clean(row.County).split(',').map(clean).filter(Boolean);
    if (!title || !countyList.length || !/^[A-Za-z0-9 .'()-]{2,60}$/.test(title)) throw new Error(`fish row ${row.OBJECTID}: bad waterbody`);
    const id = `nc-${slug(title)}`;
    if (waterbodies.some((item) => item.id === id)) throw new Error(`fish: duplicate waterbody ${id}`);
    waterbodies.push({
      id, title,
      extent: `${clean(row.Site)}. ${clean(row.Enclosed)}. The marker on the NC DHHS map is not the advisory boundary.`,
      jurisdiction: `${countyList.join(', ')} ${countyList.length > 1 ? 'counties' : 'County'}, NC`,
    });
    sites.push({ row, id, title });
  }
  const titles = waterbodies.map((item) => item.title);
  waterbodies.push({
    id: 'nc-other-waters', title: 'Other North Carolina waters',
    extent: 'Any North Carolina water body without a site-specific advisory in this list. Only the statewide mercury advice is matched here. It does not mean the water was tested.',
    jurisdiction: 'North Carolina',
  });

  const rules = [];
  const allSpeciesRules = [];
  for (const { row, id, title } of sites) {
    const advisory = clean(row.Advisry);
    const pollutant = clean(row.Polltnt);
    let speciesLabel = clean(row.Fsh_Spc);
    let speciesNote = '';
    if (!speciesLabel) {
      const named = /have been found in ([^.]+)\./.exec(advisory);
      if (!named) throw new Error(`fish ${title}: no species field and none named in the text`);
      speciesLabel = named[1];
      speciesNote = ' The species field of this record is empty, so the species are the ones its text names.';
    }
    const complete = /[.!?]$/.test(advisory);
    const otherWater = titles.find((other) => other !== title && advisory.includes(other));
    const distinctive = title.toLowerCase().split(/\s+/).filter((word) => !GENERIC_WATER_WORDS.has(word) && !/^\d+$/.test(word));
    const ownNamed = distinctive.every((word) => advisory.toLowerCase().includes(word));
    const contradiction = otherWater && !ownNamed;
    const url = safeHttps(clean(row.FAURL), `fish ${title}`);
    const status = contradiction ? 'Review required: the source text names another waterbody'
      : complete ? 'Published by NC DHHS' : 'Review required: the source text is cut off';
    const wording = contradiction
      ? `Recommendation withheld. The NC DHHS record for ${title} carries text about ${otherWater}, so HALO cannot tell which advice applies here. Open the official advisory for ${title}.`
      : complete ? advisory
        : 'Recommendation withheld. The NC DHHS data service stores this advisory\'s text cut off mid-sentence, so HALO does not show part of it. Open the official advisory for the complete advice.';
    const tokens = speciesTokens(speciesLabel);
    // A withheld row (cut off or contradictory) matches every species at its water: the cut text
    // may name more species than the species field does (coordinator ruling, 2026-10-20).
    const allFish = tokens.includes('All fish') || /\ball other fish\b/i.test(advisory) || status.startsWith('Review required');
    const base = {
      kind: 'Waterbody-specific', waterbody: id, status,
      date: `NC DHHS data service updated ${serviceUpdated}`,
      extent: clean(row.Site), pollutant, wording,
      condition: `Listed species: ${speciesLabel}.${speciesNote}${status.startsWith('Review required') ? ' Shown for every species at this water, because the complete advisory may name more species than this record lists.' : ''} Pollutants of concern: ${pollutant}. Confirm species, audience and extent in the official advisory. Separate advisories are read together; their limits are not added.`,
      previous: FIRST_REVISION_NOTE, url,
      title: `${title}: ${speciesLabel}`,
    };
    const matchSpecies = new Set(tokens);
    for (const token of tokens) {
      if (token === 'Catfish') CATFISH_FAMILY.forEach((name) => matchSpecies.add(name));
      if (CATFISH_FAMILY.includes(token)) matchSpecies.add('Catfish');
    }
    for (const species of matchSpecies) rules.push({ ...base, id: `${id}--${slug(species)}`, species });
    if (allFish) allSpeciesRules.push({ base, id, listed: matchSpecies });
  }

  // Statewide mercury, from the NC DHHS text page. Every phrase is checked against the page.
  const page = pageText(text('safeFish'));
  const where = 'safefish page';
  const sensitive = requireIn(page, 'Women of childbearing age (15 to 44 years), pregnant women, nursing mothers and children under age 15:', where);
  const sensitiveHigh = requireIn(page, 'Do not eat fish from the HIGH in mercury list.', where);
  const others = requireIn(page, 'All other people', where);
  const othersHigh = requireIn(page, 'Eat only 1 meal of fish per week from the HIGH in mercury list.', where);
  const footI85 = requireIn(page, '*High mercury levels have been found in blackfish (bowfin), catfish, jack fish (chain pickerel), warmouth, and yellow perch caught south and east of Interstate 85.', where);
  const footI95 = requireIn(page, '***High mercury levels have been found in black crappie caught south and east of Interstate 95.', where);
  const wording = `${sensitive} ${sensitiveHigh} ${others}: ${othersHigh}`;
  const everyWater = waterbodies.map((item) => item.id);
  const byTitle = (name) => { const found = waterbodies.find((item) => item.title === name); if (!found) throw new Error(`statewide: no waterbody titled ${name}`); return found.id; };
  const statewide = [
    { label: 'Largemouth bass (statewide)', species: ['Largemouth bass'], note: '' },
    { label: 'Blackfish (bowfin)*', species: ['Bowfin'], note: footI85 },
    { label: 'Catfish (caught wild)*', species: ['Catfish', ...CATFISH_FAMILY], note: footI85 },
    { label: 'Jack fish (chain pickerel)*', species: ['Chain pickerel'], note: footI85 },
    { label: 'Warmouth*', species: ['Warmouth'], note: footI85 },
    { label: 'Yellow perch*', species: ['Yellow perch'], note: footI85 },
    { label: 'Black crappie***', species: ['Black crappie'], note: footI95 },
    { label: 'Walleye from Lake Fontana and Lake Santeetlah (Graham and Swain counties)', species: ['Walleye'], note: '', waters: [byTitle('Fontana Lake'), byTitle('Lake Santeetlah')] },
  ];
  for (const entry of statewide) {
    requireIn(page, entry.label, where);
    const display = entry.label.replace(/\*+$/, '');
    for (const species of entry.species) {
      rules.push({
        id: `nc-statewide-mercury--${slug(display)}--${slug(species)}`,
        title: `Statewide mercury: ${display}`,
        kind: entry.waters ? 'Statewide list, named lakes only' : 'Statewide',
        waterbody: 'statewide', waterbodyIds: entry.waters ?? everyWater, species,
        status: 'Published by NC DHHS; its two statewide sources differ in wording',
        date: `NC DHHS page undated; HALO copy retrieved ${RETRIEVED}`,
        extent: entry.waters ? 'Fontana Lake and Lake Santeetlah only, as the page names them.' : 'All North Carolina waters, as the NC DHHS statewide mercury list states.',
        pollutant: 'Mercury',
        wording,
        condition: `NC DHHS lists "${display}" as HIGH in mercury.${entry.note ? ` The page notes: "${entry.note}"` : ''} NC DHHS also publishes a statewide mercury chart as an image on its fish advisory site, and its audience and species wording differ from this page. Read both, and any site-specific advisory, together.`,
        previous: FIRST_REVISION_NOTE,
        url: INPUTS.safeFish.url,
      });
    }
  }
  const allSpecies = [...new Set([...rules.map((rule) => rule.species), 'All fish'])].sort();
  for (const { base, id, listed } of allSpeciesRules) {
    for (const species of allSpecies) if (!listed.has(species)) rules.push({ ...base, id: `${id}--${slug(species)}`, species });
  }
  const species = [...new Set(rules.map((rule) => rule.species))].sort();

  const outFile = path.join(ROOT, 'lib/data/ncFishAdvisories.json');
  const revise = reviser(outFile, (file) => file.rules);
  const revised = rules.map((rule) => revise(rule));
  for (const rule of revised) {
    if (rule.waterbody === 'statewide' && !rule.waterbodyIds.every((wid) => everyWater.includes(wid))) throw new Error(`${rule.id}: unknown waterbody id`);
  }
  write('lib/data/ncFishAdvisories.json', {
    source: {
      issuer: 'North Carolina Department of Health and Human Services, Division of Public Health, Occupational and Environmental Epidemiology Branch',
      inputs: { fishLayer: provenance.fishLayer, fishPoints: provenance.fishPoints, fishPage: provenance.fishPage, safeFish: provenance.safeFish },
      serviceUpdated,
      notes: 'Site advisories: one row per waterbody from the NC DHHS feature service; text exactly as stored, withheld when cut off or naming another water. Statewide mercury: verbatim phrases of the safefish page. Species split for matching; source labels kept in titles.',
      licence: 'Public information published by the State of North Carolina.',
    },
    version: `nc-fish-${RETRIEVED}`,
    sourceUrl: INPUTS.fishPage.url,
    waterbodies,
    audiences: [
      { id: 'unknown', title: 'I am not sure which source category applies' },
      { id: 'nc-dhhs-sensitive', title: 'Women of childbearing age (15 to 44 years), pregnant women, nursing mothers and children under age 15 (NC DHHS statewide mercury page)' },
      { id: 'nc-dhhs-other', title: 'All other people (NC DHHS statewide mercury page)' },
    ],
    species,
    rules: revised,
  });
  return { rows: rows.length, rules: revised.length, withheld: sites.filter(({ row }) => !/[.!?]$/.test(clean(row.Advisry))).length };
}

// -------------------------------------------------------------------- water

// The parsers and their strict checks live in lib/publicWaterSources.js, shared with the weekly
// import (B19, lib/publicWaterImport.js), so a hand build and a scheduled one read a download the
// same way.
function buildWater() {
  const { releases } = parseDroughtStatistics(json('usdm'));
  const { notices, summary, total } = parseConservationStatus(text('wudc'));
  const outFile = path.join(ROOT, 'lib/data/ncWaterStewardship.json');
  const existing = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
  const reviseReleases = createReviser(existing.releases, RETRIEVED);
  const reviseNotices = createReviser(existing.notices, RETRIEVED);
  write('lib/data/ncWaterStewardship.json', {
    source: {
      drought: { issuer: DROUGHT_ISSUER, input: provenance.usdm, statistic: DROUGHT_STATISTIC },
      utility: { issuer: UTILITY_ISSUER, input: provenance.wudc, summary, total },
      licence: WATER_LICENCE,
    },
    version: `nc-water-${RETRIEVED}`,
    counties: countyRows(),
    releases: releases.map((row) => reviseReleases(row)),
    notices: notices.map((row) => reviseNotices(row)),
  });
  return { releases: releases.length, notices: notices.length };
}

// ------------------------------------------------------------------ growers

function buildGrowers() {
  const extension = pageText(text('extension'));
  const soil = pageText(text('soil'));
  const labs = pageText(text('labs'));
  requireIn(extension, 'Our County Centers', 'extension page');
  const feeNotice = requireIn(soil, 'Effective March 2, 2026, sample fees for NC Growers will follow', 'soil page');
  const certified = requireIn(labs, 'Drinking water analyses must be performed by a laboratory certified by the North Carolina State Laboratory of Public Health.', 'labs page');
  const scopeNote = requireIn(labs, 'Laboratories are certified to conduct a certain number of tests but may not be certified to conduct every test required of a water system.', 'labs page');
  const resources = [
    {
      id: 'nc-extension-county-centers', title: 'Find a county Extension contact', concern: 'Questions and site context', region: 'North Carolina',
      matrix: 'Site questions and referral',
      scope: 'NC State Extension lists a center for each county. A contact-discovery pathway: service availability and individual expertise need confirming with the center.',
      documents: ['Write the question you want answered', 'Describe the site and irrigation source if known', 'List any existing test report and its date'],
      qualifications: 'Confirm appointment availability and qualifications with the county center.',
      cost: 'Unknown. Ask the county center.', deadline: 'No deadline verified.',
      url: INPUTS.extension.url,
    },
    {
      id: 'ncda-soil-testing', title: 'NCDA&CS routine soil testing', concern: 'Soil fertility', region: 'North Carolina',
      matrix: 'Soil, fertility service',
      scope: 'Routine soil fertility testing by the NC Department of Agriculture and Consumer Services Agronomic Division. It is not a general contaminant screen or a crop-safety certificate.',
      documents: ['Confirm that fertility is your testing purpose', 'Read the current sampling and submission instructions on the NCDA&CS page', 'Record your site label and intended question'],
      qualifications: 'Contaminant analytes and methods are not established by a fertility test listing.',
      cost: `NCDA&CS states: "${feeNotice} this schedule." The amount is not copied here; check the current NC grower fee schedule.`,
      deadline: 'Current seasonal timing not verified. Check the NCDA&CS page.',
      url: INPUTS.soil.url,
    },
    {
      id: 'nc-deq-drinking-water-labs', title: 'Certified drinking-water laboratories', concern: 'Water testing', region: 'North Carolina',
      matrix: 'Drinking water; exact analyte and method to confirm',
      scope: `NC DEQ: "${certified}" A laboratory list is a starting point, not a booking.`,
      documents: ['Name the water source and the requested analyte', 'Ask the laboratory to confirm method and certification scope', 'Obtain the laboratory\'s containers, handling and delivery instructions'],
      qualifications: `NC DEQ notes: "${scopeNote}" No laboratory has been selected or verified here.`,
      cost: 'Quote needed from the selected laboratory.', deadline: 'Ask about hold time and delivery before collecting.',
      url: INPUTS.labs.url,
    },
  ];
  const outFile = path.join(ROOT, 'lib/data/ncGrowerResources.json');
  const revise = reviser(outFile, (file) => file.resources);
  write('lib/data/ncGrowerResources.json', {
    source: {
      notes: 'Editorially maintained list of official North Carolina resources. Each page was fetched on the retrieval date (HTTP 200) and hashed; quoted text was checked against it. These links are not submission services, appointments, eligibility approvals or price quotes.',
      inputs: { extension: provenance.extension, soil: provenance.soil, labs: provenance.labs },
      dropped: 'USDA NRCS conservation activity pages (national, and the page refused the build host on the retrieval date).',
    },
    version: `nc-growers-${RETRIEVED}`,
    resources: resources.map((row) => revise(row)),
  });
  return { resources: resources.length };
}

// --------------------------------------------------------------------- food

/** Loads a frontend TypeScript module the way test/frontend-test-loader.mjs does. */
const compiled = new Map();
function moduleUrl(filename) {
  if (compiled.has(filename)) return compiled.get(filename);
  let source = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_m, before, relative, after) => `${before}${moduleUrl(path.resolve(path.dirname(filename), `${relative}.ts`))}${after}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  compiled.set(filename, url);
  return url;
}

async function buildFood() {
  const evidence = await import(moduleUrl(path.join(ROOT, 'lib/frontend/food-evidence.ts')));
  const catalogue = await import(moduleUrl(path.join(ROOT, 'lib/frontend/food-catalogue.ts')));
  requireIn(pageText(text('fdaPfas')), 'Testing Food for PFAS and Assessing Dietary Exposure', 'FDA PFAS page');
  for (const key of ['fdaSeafood', 'fdaTds', 'fdaTdsMethods']) if (bytes[key].subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${key}: not a PDF`);
  const records = JSON.parse(JSON.stringify(evidence.foodEvidenceRecords));
  const bundle = evidence.evidenceForFood({});
  const catalogueIds = catalogue.foodCatalogue.map((food) => food.id);
  for (const record of records) {
    for (const id of record.foodIds) if (!catalogueIds.includes(id)) console.log(`note: ${record.id} names ${id}, which is not a catalogue id`);
    for (const url of [record.source.url, record.source.methodologyUrl]) safeHttps(url, record.id);
  }
  write('lib/data/foodEvidenceStudies.json', {
    source: {
      notes: 'The reviewed FDA study findings from lib/frontend/food-evidence.ts, copied exactly (a drift test compares them). The FDA files they cite were downloaded and hashed on the retrieval date; their tables were reviewed by the frontend on the reviewedAt date.',
      inputs: { fdaSeafood: provenance.fdaSeafood, fdaTds: provenance.fdaTds, fdaTdsMethods: provenance.fdaTdsMethods, fdaPfas: provenance.fdaPfas },
      blocked: 'Food notices (openFDA enforcement reports) are not included until their acquisition review (HALO_BACKEND_WIRING_CURRENT.md, food notices).',
    },
    reviewedAt: evidence.foodEvidenceReviewedAt,
    revision: evidence.foodEvidenceRevision,
    boundary: bundle.boundary,
    catalogue: catalogue.foodCatalogue.map((food) => ({ id: food.id, guideId: food.guideId })),
    studies: records,
  });
  return { studies: records.length, catalogue: catalogueIds.length };
}

const only = args.only ? new Set(args.only.split(',')) : null;
const want = (name) => !only || only.has(name);
const report = {};
if (want('fish')) report.fish = buildFish();
if (want('water')) report.water = buildWater();
if (want('growers')) report.growers = buildGrowers();
if (want('food')) report.food = await buildFood();
console.log(JSON.stringify(report));
