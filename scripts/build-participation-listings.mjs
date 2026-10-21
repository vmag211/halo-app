#!/usr/bin/env node
/**
 * Builds Explore's "Get involved" listings (B18, migration 0032) from the
 * research files, as SQL a person runs by hand and a review page they read
 * first.
 *
 *   node scripts/build-participation-listings.mjs --from <dir>   build everything
 *   node scripts/build-participation-listings.mjs --check        exit 1 if the SQL is stale
 *
 * `--from` reads every *.json in <dir> (the research shape in the Explore
 * research brief: { researcher, checked, organizations: [{ org, profile,
 * evidence }], opportunities: [...] }). The files are untrusted data: parsed
 * as JSON, never executed. It validates every listing against what migration
 * 0032 and the frontend validators accept, then writes:
 *
 *   lib/data/participationListings.json              the merged listings, no evidence
 *   docs/backend/apply/apply-participation-listings.sql   new orgs and listings, UNVERIFIED
 *   docs/backend/apply/verify-participation-listings.sql  marks exactly those listings verified
 *   docs/backend/participation-listings-review.md     one entry per listing, with the evidence
 *
 * `--check` re-validates the data file (except that a scheduled start must be
 * in the future: a listing that has since started is simply no longer served)
 * and fails if either SQL file differs from what the data file generates, or
 * if the review page does not cover exactly the data file's listings. The
 * review page is written only by `--from`, because the evidence is not kept in
 * the data file.
 *
 * MERGING. Organizations are matched by name (after ORG_ALIASES), their
 * counties and causes united; listings by id. A listing id that appears twice
 * with the same page (and, for an opportunity, the same kind and times) keeps
 * the first file's copy, sorted by file name, with a warning; any other repeat
 * is an error. An organization already seeded by 0004 or 0012 (SEEDED_ORGS)
 * is never inserted again.
 *
 * Nothing here contacts a database or the network.
 * test/participationListings.test.mjs runs the generated SQL on PGlite.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeById } from '../lib/places.js';
import countyData from '../lib/data/ncCounties.json' with { type: 'json' };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_FILE = 'lib/data/participationListings.json';
export const APPLY_FILE = 'docs/backend/apply/apply-participation-listings.sql';
export const VERIFY_FILE = 'docs/backend/apply/verify-participation-listings.sql';
export const REVIEW_FILE = 'docs/backend/participation-listings-review.md';
/** The verify file's stand-in for the reviewer; 0032's participation_text_ok refuses any <...>. */
export const REVIEWER = '<reviewer>';

/** volunteer_orgs rows that migrations 0004 and 0012 already insert. */
export const SEEDED_ORGS = Object.freeze([
  'American Lung Association in North Carolina',
  'Cape Fear River Watch',
  'Catawba Lands Conservancy',
  'Catawba Riverkeeper Foundation',
  'Clean Water for North Carolina',
  'CleanAIRE NC',
  'NC Conservation Network',
  'North Carolina Environmental Justice Network',
  'North Carolina Radon Program (NCDHHS)',
  'Three Rivers Land Trust',
  'Toxic Free NC',
  'Winyah Rivers Alliance (Lumber Riverkeeper)',
  'Yadkin Riverkeeper',
]);
/** Names a research file may use for a seeded organization. */
export const ORG_ALIASES = Object.freeze({ 'Catawba Riverkeeper': 'Catawba Riverkeeper Foundation' });

export const INTERESTS = Object.freeze(['Cleanup', 'Trees & habitat', 'Gardening', 'Community learning']);
export const ARTWORK = Object.freeze(['tree', 'cleanup', 'garden']);
export const KINDS = Object.freeze(['scheduled', 'rolling']);
export const STATUSES = Object.freeze(['listed', 'cancelled', 'full', 'postponed']);
export const ADDRESS_KINDS = Object.freeze(['office', 'mailing', 'meeting', 'service-area']);
export const CAUSES = Object.freeze(['water', 'pfas', 'radon', 'air', 'wells', 'advocacy']);
const COUNTY_NAMES = new Set(countyData.counties.map((county) => county.name));

/** The column order of the YOUR_TODO.md 2.23 templates (0032). */
export const PROFILE_COLUMNS = Object.freeze([
  'id', 'org_id', 'title', 'organizer', 'interest', 'area', 'served_place_ids', 'mission', 'work', 'url', 'source_title',
  'extra_sources', 'address', 'address_kind', 'address_role', 'contact',
  'effort', 'age', 'cost', 'access', 'steps', 'bring', 'followup',
]);
export const OPPORTUNITY_COLUMNS = Object.freeze([
  'id', 'org_id', 'organizer', 'title', 'interest', 'artwork', 'kind', 'starts_at', 'ends_at', 'time_label',
  'venue_local_date', 'venue_timezone', 'venue_timezone_basis', 'status', 'area', 'served_place_ids',
  'venue', 'meeting_address', 'url', 'summary', 'work', 'duration', 'cost', 'age', 'access', 'bring', 'join_text', 'safety',
]);
const ORG_KEYS = ['name', 'description', 'counties', 'causes', 'url'];
const PROFILE_KEYS = PROFILE_COLUMNS.filter((column) => column !== 'org_id');
const OPPORTUNITY_KEYS = ['org_name', ...OPPORTUNITY_COLUMNS.filter((column) => column !== 'org_id'), 'evidence'];

// ---------------------------------------------------------------------------
// Field checks: each mirrors a 0032 CHECK or a frontend validator
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const EM_DASH = String.fromCharCode(0x2014);
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const PLACEHOLDER = /<[^>]*>/;
/** Claims there is no column for (BRIEF.md, 0032 section 3). */
const CLAIMS = /\bnear you\b|\bspots? (?:left|remaining)\b|\bmiles? away\b/i;
/** participation_url_ok, exactly. */
const URL_SHAPE = /^https:\/\/([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}([/?#][!-~]*)?$/;
const TRACKING = /[?&](utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid)=/i;
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZONE_SHAPE = /^([A-Za-z]+(\/[A-Za-z0-9_+-]+)+|UTC)$/;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) (\S+)$/;

const codePoints = (value) => [...value].length;
export const validDay = (value) => typeof value === 'string' && DAY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function zoneOk(zone) {
  if (typeof zone !== 'string' || !ZONE_SHAPE.test(zone) || zone.length > 100) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(); return true; } catch { return false; }
}
function wallClock(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}`, ms: Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) };
}

/**
 * '2026-11-07 09:00 America/New_York' as { instant (UTC ISO), day, zone }, or
 * { error }. A wall time a clock change skips or repeats is refused, so the
 * instant never depends on how a database resolves it.
 */
export function parseLocalTime(value) {
  const match = typeof value === 'string' ? LOCAL_TIME.exec(value) : null;
  if (!match) return { error: 'is not "YYYY-MM-DD HH:MM Zone"' };
  const [, y, mo, d, h, mi, zone] = match;
  if (!zoneOk(zone)) return { error: `names ${zone}, which is not an IANA time zone` };
  if (!validDay(`${y}-${mo}-${d}`) || +h > 23 || +mi > 59) return { error: 'is not a real date and time' };
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const fits = new Set([wall - DAY_MS / 2, wall + DAY_MS / 2]
    .map((probe) => wall - (wallClock(probe, zone).ms - probe))
    .filter((ms) => wallClock(ms, zone).day === `${y}-${mo}-${d}` && wallClock(ms, zone).time === `${h}:${mi}:00`));
  if (fits.size !== 1) return { error: `is a time that ${fits.size ? 'occurs twice' : 'does not exist'} in ${zone} (a clock change)` };
  const ms = [...fits][0];
  return { instant: new Date(ms).toISOString().replace('.000Z', 'Z'), ms, day: `${y}-${mo}-${d}`, zone };
}

class Problems {
  constructor() { this.list = []; this.warnings = []; }
  add(where, message) { this.list.push(`${where}: ${message}`); }
  warn(where, message) { this.warnings.push(`${where}: ${message}`); }
  throwIfAny() {
    if (this.list.length) throw new Error(`participation listings refused (${this.list.length}):\n  ${this.list.join('\n  ')}`);
  }
}

function text(problems, where, field, value, max, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (!nullable) problems.add(where, `${field} is required`);
    return;
  }
  if (typeof value !== 'string') return problems.add(where, `${field} is not a string`);
  if (!value.trim()) problems.add(where, `${field} is blank`);
  if (codePoints(value) > max) problems.add(where, `${field} is longer than ${max} characters`);
  if (CONTROL.test(value)) problems.add(where, `${field} has a control character`);
  if (value.includes(EM_DASH)) problems.add(where, `${field} has an em dash`);
  if (PLACEHOLDER.test(value)) problems.add(where, `${field} has a <...> placeholder or tag`);
  if (CLAIMS.test(value)) problems.add(where, `${field} makes a distance or availability claim`);
}
function url(problems, where, field, value) {
  if (typeof value !== 'string') return problems.add(where, `${field} is required`);
  let parsed = null;
  try { parsed = new URL(value); } catch { /* reported below */ }
  if (value.length > 2000 || !URL_SHAPE.test(value) || !parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    problems.add(where, `${field} is not an https address with a host name and no user name, port or unprintable character`);
  }
  if (TRACKING.test(value)) problems.add(where, `${field} carries a tracking parameter`);
}
function places(problems, where, value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) return problems.add(where, 'served_place_ids must list 1 to 200 areas');
  for (const id of value) {
    if (id !== 'us-state:NC' && !(typeof id === 'string' && /^us-(county|place|zcta):\d+$/.test(id) && placeById(id))) {
      problems.add(where, `served_place_ids has ${JSON.stringify(id)}, which is not us-state:NC or an id in lib/places.js`);
    }
  }
  if (new Set(value).size !== value.length) problems.add(where, 'served_place_ids repeats an area');
}
function choice(problems, where, field, value, values) {
  if (!values.includes(value)) problems.add(where, `${field} ${JSON.stringify(value)} is not one of ${values.join(', ')}`);
}
function keys(problems, where, object, allowed, required = allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return problems.add(where, 'is not an object');
  for (const key of Object.keys(object)) if (!allowed.includes(key)) problems.add(where, `has an unknown field ${JSON.stringify(key)}`);
  for (const key of required) if (!(key in object)) problems.add(where, `is missing ${key}`);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const canonicalOrg = (name) => (typeof name === 'string' ? ORG_ALIASES[name.trim()] ?? name.trim() : name);

/** An organization row (volunteer_orgs, 0004 and 0012 columns). */
export function checkOrg(problems, org) {
  const where = `organization ${JSON.stringify(org?.name ?? '?')}`;
  text(problems, where, 'name', org.name, 200);
  text(problems, where, 'description', org.description, 1000);
  url(problems, where, 'url', org.url);
  if (!Array.isArray(org.counties) || !org.counties.length) problems.add(where, 'counties must list at least one county or "statewide"');
  else for (const county of org.counties) if (county !== 'statewide' && !COUNTY_NAMES.has(county)) problems.add(where, `counties has ${JSON.stringify(county)}, which is not an NC county name ("Wake County") or "statewide"`);
  if (!Array.isArray(org.causes) || !org.causes.length) problems.add(where, 'causes must list at least one cause');
  else for (const cause of org.causes) choice(problems, where, 'cause', cause, CAUSES);
  if (!validDay(org.checked)) problems.add(where, 'checked is not a YYYY-MM-DD date');
}

/** A participation_profiles row, as 0032's CHECK constraints and validOrganizations see it. */
export function checkProfile(problems, row) {
  const where = `profile ${JSON.stringify(row?.id ?? '?')}`;
  if (typeof row.id !== 'string' || !ID.test(row.id)) problems.add(where, 'id is not a lowercase slug of letters, digits and hyphens (at most 80)');
  text(problems, where, 'org_name', row.org_name, 200);
  for (const [field, max] of [['title', 200], ['organizer', 200], ['area', 300], ['mission', 2000], ['work', 2000], ['source_title', 200],
    ['effort', 1000], ['age', 500], ['cost', 500], ['access', 1000], ['bring', 1000], ['followup', 1000]]) text(problems, where, field, row[field], max);
  choice(problems, where, 'interest', row.interest, INTERESTS);
  places(problems, where, row.served_place_ids);
  url(problems, where, 'url', row.url);
  if (!Array.isArray(row.extra_sources) || row.extra_sources.length > 20) problems.add(where, 'extra_sources must list 0 to 20 pages');
  else row.extra_sources.forEach((source, at) => {
    keys(problems, `${where} extra_sources[${at}]`, source, ['title', 'url']);
    text(problems, where, `extra_sources[${at}].title`, source?.title, 200);
    url(problems, where, `extra_sources[${at}].url`, source?.url);
  });
  const address = [row.address, row.address_kind, row.address_role];
  if (address.some((value) => value !== null) && address.some((value) => value === null)) problems.add(where, 'address, address_kind and address_role are all set or all null');
  if (row.address !== null) {
    text(problems, where, 'address', row.address, 300);
    choice(problems, where, 'address_kind', row.address_kind, ADDRESS_KINDS);
    text(problems, where, 'address_role', row.address_role, 500);
  }
  text(problems, where, 'contact', row.contact, 300, { nullable: true });
  if (!Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 30) problems.add(where, 'steps must list 1 to 30 steps');
  else row.steps.forEach((step, at) => {
    keys(problems, `${where} steps[${at}]`, step, ['title', 'text']);
    text(problems, where, `steps[${at}].title`, step?.title, 200);
    text(problems, where, `steps[${at}].text`, step?.text, 1000);
  });
  if (!validDay(row.checked)) problems.add(where, 'checked is not a YYYY-MM-DD date');
}

/**
 * A participation_opportunities row, as 0032's CHECK constraints and zone
 * trigger and validOpportunity see it. `now` (ms) refuses a scheduled listing
 * that has already started; null skips that one check.
 */
export function checkOpportunity(problems, row, now) {
  const where = `opportunity ${JSON.stringify(row?.id ?? '?')}`;
  if (typeof row.id !== 'string' || !ID.test(row.id)) problems.add(where, 'id is not a lowercase slug of letters, digits and hyphens (at most 80)');
  text(problems, where, 'org_name', row.org_name, 200);
  for (const [field, max] of [['organizer', 200], ['title', 200], ['time_label', 200], ['area', 300], ['venue', 300], ['summary', 2000],
    ['duration', 200], ['cost', 500], ['age', 500], ['access', 1000], ['bring', 1000], ['join_text', 1000], ['safety', 1000]]) text(problems, where, field, row[field], max);
  text(problems, where, 'meeting_address', row.meeting_address, 300, { nullable: true });
  choice(problems, where, 'interest', row.interest, INTERESTS);
  choice(problems, where, 'artwork', row.artwork, ARTWORK);
  choice(problems, where, 'kind', row.kind, KINDS);
  choice(problems, where, 'status', row.status, STATUSES);
  places(problems, where, row.served_place_ids);
  url(problems, where, 'url', row.url);
  if (!Array.isArray(row.work) || row.work.length < 1 || row.work.length > 20) problems.add(where, 'work must list 1 to 20 tasks');
  else row.work.forEach((task, at) => text(problems, where, `work[${at}]`, task, 500));
  if (row.venue_timezone !== null && !zoneOk(row.venue_timezone)) problems.add(where, 'venue_timezone is not an IANA time zone');
  if (row.venue_timezone_basis !== null) {
    choice(problems, where, 'venue_timezone_basis', row.venue_timezone_basis, ['source', 'inferred']);
    if (row.venue_timezone === null) problems.add(where, 'venue_timezone_basis needs a venue_timezone');
  }
  if (row.venue_local_date !== null && !validDay(row.venue_local_date)) problems.add(where, 'venue_local_date is not a YYYY-MM-DD date');
  if (row.kind === 'rolling') {
    for (const field of ['starts_at', 'ends_at', 'venue_local_date']) if (row[field] !== null) problems.add(where, `a rolling program has no ${field}`);
  } else if (row.kind === 'scheduled') {
    const start = parseLocalTime(row.starts_at);
    const end = parseLocalTime(row.ends_at);
    if (start.error) problems.add(where, `starts_at ${start.error}`);
    if (end.error) problems.add(where, `ends_at ${end.error}`);
    if (!start.error && !end.error) {
      if (end.ms <= start.ms) problems.add(where, 'ends_at is not after starts_at');
      if (now !== null && start.ms <= now) problems.add(where, `starts_at ${row.starts_at} is not after the build time`);
      if (row.venue_timezone !== null && row.venue_timezone !== start.zone) problems.add(where, 'venue_timezone differs from the zone of starts_at');
      if (row.venue_local_date !== null && validDay(row.venue_local_date) && zoneOk(row.venue_timezone ?? start.zone)
          && wallClock(start.ms, row.venue_timezone ?? start.zone).day !== row.venue_local_date) {
        problems.add(where, 'venue_local_date is not the date of starts_at in the venue zone');
      }
    }
  }
  if (!validDay(row.checked)) problems.add(where, 'checked is not a YYYY-MM-DD date');
}

// ---------------------------------------------------------------------------
// Research files to the data file
// ---------------------------------------------------------------------------

/** Every *.json in `dir`, by file name: [{ file, json }]. */
export function readResearch(dir) {
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((file) => {
    try {
      return { file, json: JSON.parse(readFileSync(path.join(dir, file), 'utf8').replace(BOM, '')) };
    } catch (error) {
      throw new Error(`${file}: not valid JSON (${error.message})`);
    }
  });
}

const sameListing = (a, b, fields) => fields.every((field) => JSON.stringify(a[field]) === JSON.stringify(b[field]));
const orUndefinedNull = (value) => (value === undefined ? null : value);

/**
 * Merges research files into { data, evidence, warnings }. `now` (ms) is the
 * build time; a scheduled listing must start after it. Throws one error
 * naming every refused listing.
 */
export function buildData(files, { now = Date.now() } = {}) {
  const problems = new Problems();
  const orgs = new Map();
  const profiles = new Map();
  const opportunities = new Map();
  const evidence = { org: new Map(), profile: new Map(), opportunity: new Map() };
  const note = (map, id, entry) => map.set(id, [...(map.get(id) ?? []), entry]);

  for (const { file, json } of files) {
    keys(problems, file, json, ['researcher', 'checked', 'organizations', 'opportunities'], ['checked']);
    const checked = json?.checked;
    if (!validDay(checked)) problems.add(file, 'checked is not a YYYY-MM-DD date');
    else if (Date.parse(`${checked}T00:00:00Z`) > now) problems.add(file, `checked ${checked} is after the build date`);
    const researcher = typeof json?.researcher === 'string' && json.researcher.trim() ? json.researcher.trim() : file;

    for (const [at, entry] of (Array.isArray(json?.organizations) ? json.organizations : []).entries()) {
      const where = `${file} organizations[${at}]`;
      keys(problems, where, entry, ['org', 'profile', 'evidence'], ['org']);
      keys(problems, `${where}.org`, entry?.org, ORG_KEYS);
      if (!entry?.org) continue;
      const name = canonicalOrg(entry.org.name);
      if (typeof name !== 'string') { problems.add(where, 'org.name is required'); continue; }
      if (!SEEDED_ORGS.includes(name)) {
        const org = { name, description: entry.org.description, counties: entry.org.counties, causes: entry.org.causes, url: entry.org.url, checked };
        const seen = orgs.get(name);
        if (!seen) orgs.set(name, org);
        else {
          if (seen.url !== org.url) problems.warn(`organization ${JSON.stringify(name)}`, `${file} gives ${org.url}; keeping ${seen.url}`);
          seen.counties = [...new Set([...(seen.counties ?? []), ...(Array.isArray(org.counties) ? org.counties : [])])].sort();
          seen.causes = [...new Set([...(seen.causes ?? []), ...(Array.isArray(org.causes) ? org.causes : [])])].sort();
        }
      }
      const quote = { researcher, file, text: entry.evidence };
      if (entry.profile === undefined || entry.profile === null) {
        if (entry.evidence) note(evidence.org, name, quote);
        continue;
      }
      keys(problems, `${where}.profile`, entry.profile, PROFILE_KEYS, PROFILE_KEYS.filter((key) => !['extra_sources', 'address', 'address_kind', 'address_role', 'contact'].includes(key)));
      const raw = entry.profile;
      const row = { id: raw.id, org_name: name };
      for (const key of PROFILE_KEYS.slice(1)) row[key] = orUndefinedNull(raw[key]);
      row.extra_sources = raw.extra_sources ?? [];
      if (Array.isArray(row.served_place_ids)) row.served_place_ids = [...new Set(row.served_place_ids)];
      row.checked = checked;
      if (typeof entry.evidence !== 'string' || !entry.evidence.trim()) problems.add(`profile ${JSON.stringify(row.id)}`, 'evidence is required');
      const seen = profiles.get(row.id);
      if (seen && !sameListing(seen, row, ['url', 'org_name'])) problems.add(`profile ${JSON.stringify(row.id)}`, `appears again in ${file} for a different page or organization`);
      else if (seen) problems.warn(`profile ${JSON.stringify(row.id)}`, `repeated in ${file}; keeping the first copy`);
      else profiles.set(row.id, row);
      note(evidence.profile, row.id, quote);
    }

    for (const [at, raw] of (Array.isArray(json?.opportunities) ? json.opportunities : []).entries()) {
      const where = `${file} opportunities[${at}]`;
      keys(problems, where, raw, OPPORTUNITY_KEYS, OPPORTUNITY_KEYS.filter((key) => !['meeting_address', 'venue_local_date', 'venue_timezone', 'venue_timezone_basis', 'starts_at', 'ends_at'].includes(key)));
      if (!raw || typeof raw !== 'object') continue;
      const row = { id: raw.id, org_name: canonicalOrg(raw.org_name) };
      for (const key of OPPORTUNITY_COLUMNS.slice(2)) row[key] = orUndefinedNull(raw[key]);
      if (Array.isArray(row.served_place_ids)) row.served_place_ids = [...new Set(row.served_place_ids)];
      row.checked = checked;
      if (typeof raw.evidence !== 'string' || !raw.evidence.trim()) problems.add(`opportunity ${JSON.stringify(row.id)}`, 'evidence is required');
      const seen = opportunities.get(row.id);
      if (seen && !sameListing(seen, row, ['url', 'org_name', 'kind', 'starts_at', 'ends_at'])) problems.add(`opportunity ${JSON.stringify(row.id)}`, `appears again in ${file} with a different page, organization or time`);
      else if (seen) problems.warn(`opportunity ${JSON.stringify(row.id)}`, `repeated in ${file}; keeping the first copy`);
      else opportunities.set(row.id, row);
      note(evidence.opportunity, row.id, { researcher, file, text: raw.evidence });
    }
  }

  const data = {
    about: 'Explore "Get involved" listings researched from official pages. Generated by scripts/build-participation-listings.mjs; '
      + 'do not edit by hand. Nothing here is served until a person runs docs/backend/apply/verify-participation-listings.sql.',
    organizations: [...orgs.values()].map((org) => ({ ...org, counties: [...org.counties ?? []].sort(), causes: [...org.causes ?? []].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en')),
    profiles: [...profiles.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    opportunities: [...opportunities.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')),
  };
  checkData(data, { now, problems });
  return { data, evidence, warnings: problems.warnings };
}

/** Validates a data file's content; `now` null skips the future-start check. */
export function checkData(data, { now = null, problems = new Problems() } = {}) {
  keys(problems, 'data file', data, ['about', 'organizations', 'profiles', 'opportunities']);
  const orgNames = new Set(SEEDED_ORGS);
  for (const org of data.organizations ?? []) {
    keys(problems, `organization ${JSON.stringify(org?.name ?? '?')}`, org, [...ORG_KEYS, 'checked']);
    checkOrg(problems, org);
    if (orgNames.has(org.name)) problems.add(`organization ${JSON.stringify(org.name)}`, 'is listed twice or is already seeded by 0004 or 0012');
    orgNames.add(org.name);
  }
  const ids = { profile: new Set(), opportunity: new Set() };
  for (const [kind, rows, check, columns] of [
    ['profile', data.profiles ?? [], checkProfile, PROFILE_KEYS],
    ['opportunity', data.opportunities ?? [], (p, row) => checkOpportunity(p, row, now), OPPORTUNITY_COLUMNS.filter((column) => column !== 'org_id')],
  ]) {
    for (const row of rows) {
      keys(problems, `${kind} ${JSON.stringify(row?.id ?? '?')}`, row, ['org_name', ...columns, 'checked']);
      check(problems, row);
      if (!orgNames.has(row.org_name)) problems.add(`${kind} ${JSON.stringify(row.id)}`, `org_name ${JSON.stringify(row.org_name)} is not an organization in the research files or seeded by 0004 or 0012`);
      if (ids[kind].has(row.id)) problems.add(`${kind} ${JSON.stringify(row.id)}`, 'id is used twice');
      ids[kind].add(row.id);
    }
  }
  problems.throwIfAny();
  return data;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** A SQL string literal (standard_conforming_strings is set on in each file). */
export const sqlText = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const sqlArray = (values) => `array[${values.map(sqlText).join(', ')}]::text[]`;
const sqlJson = (value) => `${sqlText(JSON.stringify(value))}::jsonb`;
const orgId = (name) => `(select id from public.volunteer_orgs where name = ${sqlText(name)})`;
const sqlIds = (rows) => rows.map((row) => `   ${sqlText(row.id)}`).join(',\n');

function profileValues(row) {
  return PROFILE_COLUMNS.map((column) => {
    if (column === 'org_id') return orgId(row.org_name);
    if (column === 'served_place_ids') return sqlArray(row[column]);
    if (column === 'steps' || column === 'extra_sources') return sqlJson(row[column]);
    return sqlText(row[column]);
  });
}
function opportunityValues(row) {
  return OPPORTUNITY_COLUMNS.map((column) => {
    if (column === 'org_id') return orgId(row.org_name);
    if (column === 'served_place_ids' || column === 'work') return sqlArray(row[column]);
    if ((column === 'starts_at' || column === 'ends_at') && row[column] !== null) return `${sqlText(row[column])}::timestamptz`;
    if (column === 'venue_local_date' && row[column] !== null) return `${sqlText(row[column])}::date`;
    return sqlText(row[column]);
  });
}
function insert(table, columns, values, conflict) {
  return [
    `insert into public.${table}`,
    `  (${columns.join(', ')})`,
    'values (',
    values.map((value) => `  ${value}`).join(',\n'),
    `)`,
    `on conflict (${conflict}) do nothing;`,
    '',
  ].join('\n');
}

export function buildApplySql(data) {
  const { organizations, profiles, opportunities } = data;
  const parts = [
    '-- HALO: add the researched Explore "Get involved" listings, UNVERIFIED.',
    `-- Generated by scripts/build-participation-listings.mjs from ${DATA_FILE}; do not edit by hand.`,
    `-- ${organizations.length} new organizations, ${profiles.length} organization profiles, ${opportunities.length} opportunities.`,
    '--',
    '-- Run in the Supabase SQL editor AFTER 0032 (the participation directory) is applied; it also',
    '-- needs 0004 and 0012 (volunteer_orgs and its link_checked column), which production has.',
    '--',
    '-- NOTHING IN THE TWO LISTING TABLES IS SERVED BY THIS FILE. Every listing goes in with',
    '-- verified_by and verified_at null, and 0032 serves only verified rows. Read',
    `-- ${REVIEW_FILE}, check each listing against its official page, then run`,
    `-- ${VERIFY_FILE}.`,
    '--',
    '-- The new organizations are different: volunteer_orgs is public, so each one shows in the older',
    '-- GET /api/volunteer directory as soon as this runs, with last_verified null ("not yet verified").',
    '-- link_checked is the date the researcher read the organization\'s page.',
    '--',
    '-- One transaction: if any statement fails nothing is changed (run `rollback;` if the editor says',
    '-- the transaction is aborted), then send the error text. Safe to run twice: every insert is',
    '-- `on conflict do nothing`, so an organization (by name) or listing (by id) already present is left',
    '-- exactly as it is, even if this file now says something different. Correct such a row by hand.',
    '',
    'begin;',
    '',
    'set local standard_conforming_strings = on;',
    '',
  ];
  parts.push('-- ---------------------------------------------------------------------------', `-- Organizations (${organizations.length}); the seeded ones from 0004 and 0012 are not repeated`, '-- ---------------------------------------------------------------------------', '');
  for (const org of organizations) {
    parts.push(insert('volunteer_orgs', ['name', 'description', 'counties', 'causes', 'url', 'link_checked'],
      [sqlText(org.name), sqlText(org.description), sqlArray(org.counties), sqlArray(org.causes), sqlText(org.url), `${sqlText(org.checked)}::date`], 'name'));
  }
  parts.push('-- ---------------------------------------------------------------------------', `-- Organization profiles (${profiles.length}), unverified`, '-- ---------------------------------------------------------------------------', '');
  for (const row of profiles) parts.push(`-- ${row.id}: ${row.url} (checked ${row.checked})`, insert('participation_profiles', PROFILE_COLUMNS, profileValues(row), 'id'));
  parts.push('-- ---------------------------------------------------------------------------', `-- Opportunities (${opportunities.length}), unverified`, '-- ---------------------------------------------------------------------------', '');
  for (const row of opportunities) parts.push(`-- ${row.id}: ${row.url} (checked ${row.checked})`, insert('participation_opportunities', OPPORTUNITY_COLUMNS, opportunityValues(row), 'id'));
  parts.push('commit;', '');
  return parts.join('\n');
}

export function buildVerifySql(data) {
  const { profiles, opportunities } = data;
  const update = (table, rows) => (rows.length
    ? [
      `update public.${table}`,
      `   set verified_by = ${sqlText(REVIEWER)}, verified_at = now()`,
      ' where id in (',
      sqlIds(rows),
      ' );',
      '',
    ]
    : [`-- No ${table} to verify.`, '']);
  const count = (table, rows) => (rows.length
    ? `(select count(*) from public.${table} where verified_at is not null and id in (${rows.map((row) => sqlText(row.id)).join(', ')}))`
    : '0');
  return [
    '-- HALO: mark the researched Explore "Get involved" listings verified. Only now are they served.',
    `-- Generated by scripts/build-participation-listings.mjs from ${DATA_FILE}; do not edit by hand.`,
    `-- ${profiles.length} organization profiles, ${opportunities.length} opportunities: exactly the ids in the data file.`,
    '--',
    `-- Run AFTER ${APPLY_FILE}, and only after you have opened`,
    `-- ${REVIEW_FILE} and checked every listing against its official page.`,
    '-- Withdraw (or correct) anything that does not match first; this verifies every id below.',
    '--',
    `-- BEFORE RUNNING: replace both ${REVIEWER} below with your own name or initials. As written the`,
    '-- database refuses it (0032\'s participation_*_verified_check calls participation_text_ok, which',
    '-- refuses any <...>), so the whole transaction fails and nothing is verified: this file cannot be',
    '-- run unread. If the editor then says the transaction is aborted, run `rollback;`.',
    '--',
    '-- Freshness: an opportunity is served for 29 days after its verification and a profile for 180;',
    '-- re-check the pages and run this again to renew. A scheduled listing leaves the lists by itself',
    '-- when it starts. Any later change to a listing without a new verified_at un-verifies it.',
    '',
    'begin;',
    '',
    ...update('participation_profiles', profiles),
    ...update('participation_opportunities', opportunities),
    'commit;',
    '',
    '-- Expect each verified count to equal its expected count.',
    `select ${count('participation_profiles', profiles)} as profiles_verified, ${profiles.length} as profiles_expected,`,
    `       ${count('participation_opportunities', opportunities)} as opportunities_verified, ${opportunities.length} as opportunities_expected;`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The review page
// ---------------------------------------------------------------------------

const md = (value) => String(value).split(EM_DASH).join('[em dash]').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]#|])/g, '\\$1');
const placeLabel = (id) => (id === 'us-state:NC' ? 'North Carolina, statewide' : placeById(id)?.label ?? id);
const areas = (row) => `${md(row.area)} (${row.served_place_ids.map((id) => `${md(placeLabel(id))} \`${id}\``).join(', ')})`;
const link = (title, href) => `[${md(title)}](<${href}>)`;
function quotes(entries = []) {
  if (!entries.length) return ['', '_No evidence quote was supplied._'];
  return entries.flatMap((entry) => [
    '',
    `Evidence (${md(entry.researcher)}, ${md(entry.file)}):`,
    '',
    ...String(entry.text ?? '').split(/\r?\n/).filter((line) => line.trim()).map((line) => `> ${md(line.trim())}`),
  ]);
}

export function buildReview(data, evidence) {
  const out = [
    '# Participation listings: review before verifying',
    '',
    `Generated by \`scripts/build-participation-listings.mjs\` from the research files; do not edit by hand. The data is \`${DATA_FILE}\`.`,
    '',
    `${data.organizations.length} new organizations, ${data.profiles.length} organization profiles and ${data.opportunities.length} opportunities. `
      + `\`${APPLY_FILE}\` adds the listings unverified, so nothing is served yet. For each entry below, open the official page, `
      + 'confirm the title, organizer, area, dates and times, cost, age and access say what the page says, and tick the box. '
      + `Withdraw or correct anything that does not match, then run \`${VERIFY_FILE}\` with your name or initials in place of \`${REVIEWER}\`.`,
    '',
    'Evidence quotes are what the researcher copied from the page. They are not served.',
    '',
    `## Organizations to add (${data.organizations.length})`,
    '',
    'These go into `volunteer_orgs`, which the older Explore directory shows as soon as the apply file runs (as "not yet verified").',
  ];
  for (const org of data.organizations) {
    out.push('', `<!-- listing:org:${org.name.replace(/-->/g, '')} -->`, `### ${md(org.name)}`, '', '- [ ] Checked against the official page',
      `- Website: <${org.url}>`, `- Description: ${md(org.description)}`, `- Counties: ${md(org.counties.join(', '))}`,
      `- Causes: ${md(org.causes.join(', '))}`, `- Researched: ${org.checked}`, ...quotes(evidence?.org?.get(org.name)));
  }
  out.push('', `## Ways to take part, organization profiles (${data.profiles.length})`);
  for (const row of data.profiles) {
    out.push('', `<!-- listing:profile:${row.id} -->`, `### ${md(row.title)}`, '', '- [ ] Checked against the official page',
      `- Id: \`${row.id}\``, `- Organizer: ${md(row.organizer)} (volunteer_orgs: ${md(row.org_name)})`, `- Interest: ${md(row.interest)}`,
      `- Area: ${areas(row)}`, `- Official page: ${link(row.source_title, row.url)}`);
    for (const source of row.extra_sources) out.push(`- Further page: ${link(source.title, source.url)}`);
    if (row.address !== null) out.push(`- Address (${row.address_kind}): ${md(row.address)}. ${md(row.address_role)}`);
    if (row.contact !== null) out.push(`- Contact: ${md(row.contact)}`);
    out.push(`- Effort: ${md(row.effort)}`, `- Age: ${md(row.age)}`, `- Cost: ${md(row.cost)}`, `- Access: ${md(row.access)}`,
      `- Steps: ${row.steps.length}`, `- Researched: ${row.checked}`, ...quotes(evidence?.profile?.get(row.id)));
  }
  out.push('', `## Opportunities (${data.opportunities.length})`);
  for (const row of data.opportunities) {
    const when = row.kind === 'scheduled'
      ? `scheduled, ${md(row.time_label)} (starts ${row.starts_at}, ends ${row.ends_at}${row.venue_local_date ? `, venue date ${row.venue_local_date}` : ''})`
      : `rolling program, ${md(row.time_label)}`;
    out.push('', `<!-- listing:opportunity:${row.id} -->`, `### ${md(row.title)}`, '', '- [ ] Checked against the official page',
      `- Id: \`${row.id}\``, `- Organizer: ${md(row.organizer)} (volunteer_orgs: ${md(row.org_name)})`,
      `- Interest: ${md(row.interest)}, status ${row.status}`, `- When: ${when}`, `- Area: ${areas(row)}`,
      `- Venue: ${md(row.venue)}${row.meeting_address ? `, ${md(row.meeting_address)}` : ''}`, `- Official page: <${row.url}>`,
      `- Cost: ${md(row.cost)}`, `- Age: ${md(row.age)}`, `- Access: ${md(row.access)}`, `- Next step: ${md(row.join_text)}`,
      `- Researched: ${row.checked}`, ...quotes(evidence?.opportunity?.get(row.id)));
  }
  out.push('');
  return out.join('\n');
}

/** The listing markers a review page holds, as 'profile:id' and 'opportunity:id'. */
export const reviewMarkers = (markdown) => [...markdown.matchAll(/^<!-- listing:(profile|opportunity):([a-z0-9-]+) -->$/gm)].map((m) => `${m[1]}:${m[2]}`).sort();
export const dataMarkers = (data) => [...data.profiles.map((row) => `profile:${row.id}`), ...data.opportunities.map((row) => `opportunity:${row.id}`)].sort();

export const dataJson = (data) => `${JSON.stringify(data, null, 2)}\n`;

/** The two SQL files the data file generates, keyed by repository path. */
export const generatedSql = (data) => ({ [APPLY_FILE]: buildApplySql(data), [VERIFY_FILE]: buildVerifySql(data) });

/** What --check reports: [] when the committed files are current. */
export function staleFiles(root = ROOT) {
  const data = checkData(JSON.parse(readFileSync(path.join(root, DATA_FILE), 'utf8')));
  const stale = Object.entries(generatedSql(data))
    .filter(([file, sql]) => !existsSync(path.join(root, file)) || readFileSync(path.join(root, file), 'utf8') !== sql)
    .map(([file]) => file);
  const review = path.join(root, REVIEW_FILE);
  if (!existsSync(review) || JSON.stringify(reviewMarkers(readFileSync(review, 'utf8'))) !== JSON.stringify(dataMarkers(data))) stale.push(REVIEW_FILE);
  return stale;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--check')) {
      const stale = staleFiles();
      if (stale.length) {
        console.error(`stale: ${stale.join(', ')}; run node scripts/build-participation-listings.mjs --from <research dir>`);
        process.exit(1);
      }
      console.log('participation listings: data file valid, SQL and review page current');
    } else {
      const from = args[args.indexOf('--from') + 1];
      if (!args.includes('--from') || !from) throw new Error('usage: --from <dir of research JSON> | --check');
      const files = readResearch(path.resolve(from));
      if (!files.length) console.warn(`warning: no .json files in ${from}; writing an empty listing set`);
      const { data, evidence, warnings } = buildData(files);
      for (const warning of warnings) console.warn(`warning: ${warning}`);
      const out = { [DATA_FILE]: dataJson(data), ...generatedSql(data), [REVIEW_FILE]: buildReview(data, evidence) };
      for (const [file, content] of Object.entries(out)) {
        mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
        writeFileSync(path.join(ROOT, file), content);
      }
      console.log(`${files.length} research files: ${data.organizations.length} new organizations, ${data.profiles.length} profiles, ${data.opportunities.length} opportunities`);
      console.log(`wrote ${Object.keys(out).join(', ')}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
