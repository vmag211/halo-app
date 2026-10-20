/**
 * Builds lib/data/ncOutreachContacts.json, the static official contact
 * directory behind POST /api/outreach/contacts (`contacts.resolve`; B17 plan,
 * docs/backend/plans/b17-outreach-preparation.md, Ruling O3).
 *
 *   node scripts/build-outreach-contacts.mjs --src <dir> --retrieved 2026-10-20
 *
 * `--src` holds the official pages downloaded by hand (names below, with the
 * URL each came from). They are untrusted data: read as text only, never
 * executed. Nothing is fetched here. The output header records every input's
 * URL, retrieval date and sha256, and every statewide entry's wording is
 * checked against a phrase that must occur in its page, so a reviewer can
 * match the output to the downloads.
 *
 * WHAT IS AND IS NOT TAKEN. Offices only, never a person: each county's local
 * health department row of the NC DHHS directory (website, phone), each
 * county's NC State Extension center link, and a handful of state offices.
 * An email is kept only when it is an organizational mailbox printed on the
 * official page (STATE_MAILBOXES); a staff member's own address is never
 * taken, and no address is ever constructed. A local health department whose
 * listed website is plain http keeps that website as `listedWebsite` only:
 * its contact page is the https NC DHHS directory, because the client accepts
 * https links only and HALO does not upgrade a link it has not checked.
 *
 * REVISIONS. A record unchanged from the output already on disk keeps its
 * revision; a changed one gets revision + 1; a new one starts at 1.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import counties from '../lib/data/ncCounties.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'lib/data/ncOutreachContacts.json';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, at, all) => (at % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), all[at + 1]]] : pairs), []),
);
for (const name of ['src', 'retrieved']) if (!args[name]) throw new Error(`--${name} is required`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.retrieved)) throw new Error('--retrieved is a YYYY-MM-DD date');
const RETRIEVED = args.retrieved;

const INPUTS = {
  lhd: { file: 'lhd.html', url: 'https://www.dph.ncdhhs.gov/contact/LHD' },
  extension: { file: 'extension.html', url: 'https://www.ces.ncsu.edu/local-county-center/' },
  drinkingWater: { file: 'dwr-dw.html', url: 'https://www.deq.nc.gov/about/divisions/water-resources/drinking-water' },
  airQuality: { file: 'daq.html', url: 'https://www.deq.nc.gov/about/divisions/air-quality' },
  oee: { file: 'oee.html', url: 'https://epi.dph.ncdhhs.gov/oee/' },
  wellWater: { file: 'wellwater.html', url: 'https://epi.dph.ncdhhs.gov/oee/programs/wellwater.html' },
  stateParks: { file: 'ncparks.html', url: 'https://www.ncparks.gov/' },
  legislators: { file: 'ncleg.html', url: 'https://www.ncleg.gov/FindYourLegislators' },
  house: { file: 'house.html', url: 'https://www.house.gov/representatives/find-your-representative' },
};
const bytes = {};
const provenance = {};
for (const [key, input] of Object.entries(INPUTS)) {
  bytes[key] = readFileSync(path.join(args.src, input.file));
  provenance[key] = { url: input.url, retrieved: RETRIEVED, sha256: createHash('sha256').update(bytes[key]).digest('hex'), bytes: bytes[key].length };
}
const html = (key) => bytes[key].toString('utf8');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (value) => value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name) => {
  if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  return ENTITIES[name.toLowerCase()] ?? match;
});
const pageText = (value) => decode(value.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const clean = (value) => decode(String(value ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function requireIn(key, phrase) {
  if (!pageText(html(key)).includes(phrase)) throw new Error(`${key}: expected phrase not found: "${phrase}"`);
}
function https(value, where) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${where}: not a plain https URL: ${value}`);
  return url.href;
}

// ------------------------------------------------------------ the counties

const COUNTY_IDS = new Map(counties.counties.map((c) => [c.name.replace(/ County$/, '').toLowerCase(), c.geoid]));
// The NC DHHS table spells Tyrrell County "Tyrell" (checked on the retrieval date).
const LHD_ALIASES = { tyrell: 'tyrrell' };

function healthDepartments() {
  const table = html('lhd').match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!table) throw new Error('lhd: the directory table was not found');
  const rows = [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => [...match[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]));
  const found = new Map();
  for (const [countyCell, addressCell, phoneCell] of rows) {
    const link = countyCell.match(/<a href="([^"]+)">([^<]+)<\/a>/);
    if (!link) throw new Error(`lhd: a row without a county link: ${countyCell}`);
    const raw = clean(link[2]).toLowerCase();
    const name = LHD_ALIASES[raw] ?? raw;
    const geoid = COUNTY_IDS.get(name);
    if (!geoid) throw new Error(`lhd: unknown county "${link[2]}"`);
    const phone = clean(phoneCell).match(/^\d{3}-\d{3}-\d{4}$/)?.[0];
    if (!phone) throw new Error(`lhd: ${name}: no phone in "${clean(phoneCell)}"`);
    const listed = new URL(decode(link[1])).href;
    found.set(geoid, { listedWebsite: listed, phone, office: clean(addressCell) });
  }
  if (found.size !== 100) throw new Error(`lhd: expected 100 counties, found ${found.size}`);
  return found;
}

function extensionCenters() {
  const found = new Map();
  for (const match of html('extension').matchAll(/href="(https:\/\/[a-z]+\.ces\.ncsu\.edu\/?)">([^<]+) County Center/g)) {
    const geoid = COUNTY_IDS.get(clean(match[2]).toLowerCase());
    if (!geoid) throw new Error(`extension: unknown county "${match[2]}"`);
    found.set(geoid, https(match[1], `extension ${match[2]}`));
  }
  if (found.size !== 100) throw new Error(`extension: expected 100 county centers, found ${found.size}`);
  return found;
}

// --------------------------------------------------------- statewide offices

/** Organizational mailboxes printed on the official page, with the page that prints them. */
const STATE_MAILBOXES = { stateParks: 'state.parks@ncparks.gov' };

const STATEWIDE = [
  {
    id: 'nc-deq-public-water-supply',
    input: 'drinkingWater',
    phrase: 'It is the responsibility of the Public Water Supply Section to regulate public water systems within the state',
    name: 'Public Water Supply Section',
    role: 'State regulator of public water systems',
    organization: 'NC Department of Environmental Quality, Division of Water Resources',
    jurisdiction: 'Public water systems in North Carolina.',
    reason: 'This state office regulates public water systems and investigates complaints. It is not your utility: your utility\'s own contact is on your water bill or its annual water quality report.',
  },
  {
    id: 'nc-deq-air-quality',
    input: 'airQuality',
    phrase: 'The Division of Air Quality (DAQ) works with the state\'s residents to protect and improve outdoor, or ambient, air quality in North Carolina',
    name: 'Division of Air Quality',
    role: 'State outdoor air quality monitoring, permits and compliance',
    organization: 'NC Department of Environmental Quality',
    jurisdiction: 'Outdoor air quality in North Carolina.',
    reason: 'This state division monitors outdoor air and enforces air quality rules.',
  },
  {
    id: 'nc-dhhs-oee',
    input: 'oee',
    phrase: 'Occupational and Environmental Epidemiology (OEE) is the branch of public health that deals with environmental and occupational conditions and hazards that may pose a risk to human health',
    name: 'Occupational and Environmental Epidemiology Branch',
    role: 'State public health guidance on environmental hazards',
    organization: 'NC Department of Health and Human Services, Division of Public Health',
    jurisdiction: 'North Carolina.',
    reason: 'This state branch gives health-based guidance on environmental contaminants and evaluates suspected hazards in local communities.',
  },
  {
    id: 'nc-dhhs-private-wells',
    input: 'wellWater',
    phrase: 'As a private well owner, it is up to you to test your water to ensure it is safe to use',
    name: 'Private Well and Health Program',
    role: 'State guidance on private well testing',
    organization: 'NC Department of Health and Human Services, Division of Public Health',
    jurisdiction: 'Private wells in North Carolina.',
    reason: 'This state program publishes guidance for private well owners on testing their water.',
  },
  {
    id: 'nc-state-parks',
    input: 'stateParks',
    phrase: 'For general information, please call (919) 707-9300',
    email: STATE_MAILBOXES.stateParks,
    name: 'North Carolina State Parks',
    role: 'General information office',
    organization: 'NC Division of Parks and Recreation',
    jurisdiction: 'State parks in North Carolina.',
    reason: 'This office answers general questions about state parks. A city or county park has its own managing office.',
  },
  {
    id: 'ncga-find-your-legislators',
    input: 'legislators',
    phrase: 'Each resident of the state has one representative in each of those legislative bodies, determined by the district in which their residence falls',
    name: 'Find your state legislators',
    role: 'Official lookup of your state senator and state representative',
    organization: 'North Carolina General Assembly',
    jurisdiction: 'North Carolina legislative districts.',
    reason: 'Districts can split a county, so HALO does not guess yours. This official page finds your state legislators and your U.S. House district from your address.',
  },
  {
    id: 'us-house-find-your-representative',
    input: 'house',
    phrase: 'Find Your Representative Enter your zip code:',
    name: 'Find your U.S. Representative',
    role: 'Official lookup of your member of the U.S. House',
    organization: 'U.S. House of Representatives',
    jurisdiction: 'U.S. congressional districts.',
    reason: 'Districts can split a county, so HALO does not guess yours. This official page finds your representative from your ZIP code.',
  },
];

function statewide() {
  return STATEWIDE.map(({ input, phrase, email = null, ...entry }) => {
    requireIn(input, phrase);
    if (email !== null && !html(input).includes(`mailto:${email}`)) throw new Error(`${entry.id}: ${email} is not printed on its page`);
    return { ...entry, email, url: https(INPUTS[input].url, entry.id), source: input };
  });
}

// ------------------------------------------------------------------ output

function reviser(listOf) {
  const file = path.join(ROOT, OUT);
  const before = new Map((existsSync(file) ? listOf(JSON.parse(readFileSync(file, 'utf8'))) : []).map((row) => [row.id, row]));
  const strip = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'revision')));
  return (row) => {
    const old = before.get(row.id);
    if (!old) return { ...row, revision: 1 };
    return { ...row, revision: strip(old) === strip(row) ? old.revision : old.revision + 1 };
  };
}

const health = healthDepartments();
const extension = extensionCenters();
const reviseState = reviser((file) => file.statewide);
const reviseCounty = reviser((file) => file.counties);

requireIn('lhd', 'Find Your Local Health Department');
const output = {
  source: {
    notes: 'Official public offices only, never a named person. Each page was downloaded on the retrieval date (HTTP 200) and hashed; each statewide entry was checked against a phrase in its page. An email appears only where the official page prints an organizational mailbox. These are contact pathways, not confirmation that an office serves a particular address.',
    inputs: provenance,
    licence: 'Public information published by the State of North Carolina, NC State University and the U.S. House of Representatives.',
  },
  version: `nc-outreach-${RETRIEVED}`,
  retrieved: RETRIEVED,
  directoryUrl: https(INPUTS.lhd.url, 'lhd'),
  statewide: statewide().map(reviseState),
  counties: counties.counties
    .map((c) => ({ id: c.geoid, title: c.name }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const department = health.get(c.id);
      const listedHttps = department.listedWebsite.startsWith('https://');
      return reviseCounty({
        id: c.id,
        title: c.title,
        health: {
          url: listedHttps ? department.listedWebsite : https(INPUTS.lhd.url, 'lhd'),
          listedWebsite: department.listedWebsite,
          phone: department.phone,
          office: department.office,
        },
        extension: { url: extension.get(c.id) },
      });
    }),
};
const text = JSON.stringify(output, null, 1);
if (text.includes(String.fromCharCode(0x2014))) throw new Error('an output string contains U+2014');
writeFileSync(path.join(ROOT, OUT), `${text}\n`);
console.log(`wrote ${OUT}: ${output.statewide.length} statewide offices, ${output.counties.length} counties`);
