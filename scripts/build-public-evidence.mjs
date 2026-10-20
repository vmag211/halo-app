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
import counties from '../lib/data/ncCounties.json' with { type: 'json' };

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
  wudc: { file: 'wudc.html', url: 'https://www.ncwater.org/WUDC/conservation-status' },
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

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(value) {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}
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
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
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
  const existing = existsSync(outFile) ? listOf(JSON.parse(readFileSync(outFile, 'utf8'))) : [];
  const before = new Map(existing.map((row) => [row.id, row]));
  const strip = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !['revision', 'version', 'previous'].includes(key))));
  return (row, key = 'revision') => {
    const old = before.get(row.id);
    if (!old) return { ...row, [key]: 1, ...('previous' in row ? { previous: row.previous } : {}) };
    if (strip(old) === strip(row)) return { ...row, [key]: old[key], ...('previous' in row ? { previous: old.previous } : {}) };
    const next = old[key] + 1;
    return { ...row, [key]: next, ...('previous' in row ? { previous: `Revision ${old[key]} was superseded when HALO's copy was refreshed on ${RETRIEVED}.` } : {}) };
  };
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
    const allFish = tokens.includes('All fish') || /\ball other fish\b/i.test(advisory);
    const base = {
      kind: 'Waterbody-specific', waterbody: id, status,
      date: `NC DHHS data service updated ${serviceUpdated}`,
      extent: clean(row.Site), pollutant, wording,
      condition: `Listed species: ${speciesLabel}.${speciesNote} Pollutants of concern: ${pollutant}. Confirm species, audience and extent in the official advisory. Separate advisories are read together; their limits are not added.`,
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
  const allSpecies = [...new Set(rules.map((rule) => rule.species))].filter((name) => name !== 'All fish').sort();
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

const DWR_STATUSES = new Set(['Not Restricted', 'Voluntary', 'Mandatory', 'Emergency', 'Rationing']);
function buildWater() {
  const fips = new Map(counties.counties.map((county) => [county.geoid, county.name]));
  if (fips.size !== 100) throw new Error('ncCounties.json: expected 100 counties');
  const raw = json('usdm');
  if (!Array.isArray(raw) || raw.length < 100 || raw.length > 5000) throw new Error('usdm: unexpected row count');
  const releases = [];
  for (const row of raw) {
    if (row.state !== 'NC' || !fips.has(row.fips) || row.statisticFormatID !== 2) throw new Error(`usdm: unexpected row ${row.fips}`);
    const date = String(row.mapDate).slice(0, 10);
    const validStart = String(row.validStart).slice(0, 10);
    const validEnd = String(row.validEnd).slice(0, 10);
    for (const value of [date, validStart, validEnd]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('usdm: bad date');
    const shares = Object.fromEntries(['none', 'd0', 'd1', 'd2', 'd3', 'd4'].map((key) => {
      const value = Number(row[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`usdm ${row.fips}: bad ${key}`);
      return [key, value];
    }));
    const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 100) > 0.5) throw new Error(`usdm ${row.fips} ${date}: categories sum to ${total}`);
    const county = fips.get(row.fips);
    if (clean(row.county) !== county) throw new Error(`usdm ${row.fips}: county name ${row.county} is not ${county}`);
    releases.push({
      id: `usdm-${row.fips}-${date}`, countyId: row.fips, date, ...shares,
      validStart, validEnd,
      status: `U.S. Drought Monitor map for ${date}, valid ${validStart} to ${validEnd}`,
      sourceUrl: 'https://droughtmonitor.unl.edu/CurrentMap/StateDroughtMonitor.aspx?NC',
      scope: `Share of ${county} area in each U.S. Drought Monitor category on the weekly map dated ${date} (categorical, not cumulative). A county area distribution, not a reading for one home or garden, and not a watering rule. Map produced by the National Drought Mitigation Center, USDA and NOAA.`,
    });
  }
  releases.sort((a, b) => a.countyId.localeCompare(b.countyId) || b.date.localeCompare(a.date));
  const countyRows = [...fips].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
  if (new Set(releases.map((r) => r.countyId)).size !== 100) throw new Error('usdm: not every county has a release');

  const html = text('wudc');
  const summary = Object.fromEntries([...html.matchAll(/class="status-([A-Z])">\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>([A-Za-z ]+)<\/div>/g)].map((m) => [m[3].trim(), Number(m[2])]));
  const totalMatch = /<div style="font-size:24px;">(\d+)<\/div>\s*<div[^>]*>Total Systems<\/div>/.exec(html);
  if (!totalMatch) throw new Error('wudc: no total');
  const notices = [];
  for (const [, body] of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(decode(m[1].replace(/<[^>]+>/g, ''))));
    if (cells.length === 0) continue;
    if (cells.length !== 6) throw new Error('wudc: a row without six cells');
    const [pwsid, system, county, status, reason, updated] = cells;
    if (!/^\d{2}-\d{2}-\d{3}$/.test(pwsid)) throw new Error(`wudc: bad PWSID ${pwsid}`);
    if (!/^[A-Za-z0-9 .,'&()/-]{1,80}$/.test(system) || !/^[A-Za-z ]{2,30}$/.test(county)) throw new Error(`wudc ${pwsid}: bad name`);
    if (!DWR_STATUSES.has(status)) throw new Error(`wudc ${pwsid}: unknown status ${status}`);
    if (!/^(?:[A-Za-z /-]{1,40})?$/.test(reason)) throw new Error(`wudc ${pwsid}: bad reason`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) throw new Error(`wudc ${pwsid}: bad date`);
    const id = `ncdwr-${pwsid}`;
    if (notices.some((notice) => notice.id === id)) throw new Error(`wudc: duplicate ${pwsid}`);
    notices.push({
      id, title: `${system} (${county} County)`, status, date: `Status last updated ${updated}`,
      instructions: 'The NC Division of Water Resources listing records this water system\'s conservation status only. Any restrictions, exemptions and dates are set out in the water system\'s own notice.',
      scope: `${system} public water system, PWSID ${pwsid}, as reported to the NC DEQ Division of Water Resources. Reason recorded: ${reason && reason !== 'N/A' ? reason : 'none given'}. It applies to that system's customers only, not to a county, a private well or a garden. Confirm your provider against a bill.`,
      sourceUrl: INPUTS.wudc.url,
    });
  }
  if (notices.length !== Number(totalMatch[1])) throw new Error(`wudc: ${notices.length} rows but the page totals ${totalMatch[1]}`);
  for (const [label, count] of Object.entries(summary)) {
    if (notices.filter((notice) => notice.status === label).length !== count) throw new Error(`wudc: ${label} count differs from the summary`);
  }
  notices.sort((a, b) => a.title.localeCompare(b.title));

  const outFile = path.join(ROOT, 'lib/data/ncWaterStewardship.json');
  const reviseReleases = reviser(outFile, (file) => file.releases);
  const reviseNotices = reviser(outFile, (file) => file.notices);
  write('lib/data/ncWaterStewardship.json', {
    source: {
      drought: { issuer: 'U.S. Drought Monitor: National Drought Mitigation Center (University of Nebraska-Lincoln), USDA and NOAA', input: provenance.usdm, statistic: 'Categorical percent of county area (statisticsType=2)' },
      utility: { issuer: 'NC Department of Environmental Quality, Division of Water Resources, Water Use Data Collection', input: provenance.wudc, summary, total: Number(totalMatch[1]) },
      licence: 'U.S. Drought Monitor maps and data are public; credit the National Drought Mitigation Center, USDA and NOAA. The NC DWR listing is public information of the State of North Carolina.',
    },
    version: `nc-water-${RETRIEVED}`,
    counties: countyRows,
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
