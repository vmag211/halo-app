/**
 * scripts/build-participation-listings.mjs: the research files to the
 * Explore "Get involved" SQL, on PGlite (0004, 0012 and 0032).
 *
 * The fixture (test/fixtures/participation-listings) is two research files:
 * two new organizations (one repeated, so their counties merge), two
 * profiles, one scheduled and one rolling opportunity. The generated apply
 * SQL runs twice, nothing is served before the verify SQL, the verify SQL
 * refuses its own <reviewer> placeholder, and once a reviewer's initials are
 * in it the real 0032 read functions serve every listing for every area it
 * names, in a shape the frontend's own validators accept
 * (lib/frontend/production/explore-service.ts, compiled from this tree by
 * test/helpers/frontendB18.mjs).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO_ROOT, applySql, createDb, listMigrations } from './db/pgliteHarness.mjs';
import {
  REVIEWER, SEEDED_ORGS, buildApplySql, buildData, buildReview, buildVerifySql, dataMarkers, parseLocalTime, readResearch,
  reviewMarkers, staleFiles,
} from '../scripts/build-participation-listings.mjs';
import { validOpportunity, validOrganizations } from './helpers/frontendB18.mjs';

const FIXTURE = path.join(REPO_ROOT, 'test/fixtures/participation-listings');
const BUILT_AT = Date.parse('2026-10-21T16:00:00Z');
const MIGRATION_0032 = listMigrations().find((migration) => migration.number === 32);
const pgArray = (values) => `{${values.map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
const EM_DASH = String.fromCharCode(0x2014);

const built = buildData(readResearch(FIXTURE), { now: BUILT_AT });
const { data } = built;
const clone = (value) => JSON.parse(JSON.stringify(value));
const fixtureFiles = () => readResearch(FIXTURE).map(clone);

/** buildData on the fixture after `change(files)`; returns the refusal message, or null. */
function refusal(change, { now = BUILT_AT } = {}) {
  const files = fixtureFiles();
  change(files);
  try {
    buildData(files, { now });
    return null;
  } catch (error) {
    return error.message;
  }
}
const scheduled = (files) => files[0].json.opportunities[0];
const rolling = (files) => files[1].json.opportunities[0];
const profile = (files) => files[0].json.organizations[0].profile;

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

test('the fixture builds: organizations merged by name, listings sorted by id, evidence only in the review page', () => {
  assert.deepEqual(built.warnings, []);
  assert.deepEqual(data.organizations.map((org) => [org.name, org.counties, org.causes, org.checked]), [
    ['Fixture Creek Alliance', ['Mecklenburg County', 'Union County'], ['advocacy', 'water'], '2026-10-21'],
    ['Fixture Garden Collective', ['statewide'], ['advocacy'], '2026-10-20'],
  ]);
  assert.equal(data.organizations[0].description, 'A test organization that cares for a creek in Mecklenburg County.', 'the first description is kept');
  assert.deepEqual(data.profiles.map((row) => [row.id, row.org_name, row.checked]), [
    ['fixture-creek-stewards', 'Fixture Creek Alliance', '2026-10-21'], ['fixture-garden-volunteers', 'Fixture Garden Collective', '2026-10-20'],
  ]);
  assert.deepEqual(data.opportunities.map((row) => [row.id, row.kind, row.url]), [
    ['fixture-creek-cleanup', 'scheduled', 'https://creek.example.org/events/fall-cleanup'],
    ['fixture-garden-workdays', 'rolling', 'https://garden.example.org/workdays'],
  ]);
  assert.ok(!JSON.stringify(data).includes('evidence'), 'no evidence in the data file');
  const review = buildReview(data, built.evidence);
  assert.deepEqual(reviewMarkers(review), dataMarkers(data));
  for (const quote of ['Saturday, November 7, 9 a.m. to noon', 'Raised beds at some gardens.', 'Workdays are held monthly', 'Serves Union County too.']) {
    assert.ok(review.includes(quote), quote);
  }
  for (const row of [...data.profiles, ...data.opportunities]) assert.ok(review.includes(`<${row.url}>`), row.id);
  assert.ok(!review.includes(EM_DASH));
});

test('a repeat of the same listing keeps the first copy with a warning; the same id for a different page is refused', () => {
  const files = fixtureFiles();
  files[1].json.opportunities.push(clone(scheduled(files)));
  const again = buildData(files, { now: BUILT_AT });
  assert.deepEqual(again.data.opportunities.map((row) => row.id), ['fixture-creek-cleanup', 'fixture-garden-workdays']);
  assert.match(again.warnings.join('\n'), /fixture-creek-cleanup.*repeated in b-garden\.json/);
  assert.equal(again.evidence.opportunity.get('fixture-creek-cleanup').length, 2, 'both researchers\' evidence is shown');
  assert.match(refusal((f) => f[1].json.opportunities.push({ ...clone(scheduled(f)), url: 'https://creek.example.org/other' })),
    /opportunity "fixture-creek-cleanup": appears again in b-garden\.json/);
});

test('a seeded organization is referenced, never inserted again, including under its research alias', () => {
  const files = fixtureFiles();
  rolling(files).org_name = 'Catawba Riverkeeper';
  files[1].json.organizations.push({ org: { name: 'Yadkin Riverkeeper', description: 'Seeded already.', counties: ['statewide'], causes: ['water'], url: 'https://www.yadkinriverkeeper.org' } });
  const { data: seeded } = buildData(files, { now: BUILT_AT });
  assert.equal(seeded.opportunities.find((row) => row.id === 'fixture-garden-workdays').org_name, 'Catawba Riverkeeper Foundation');
  assert.deepEqual(seeded.organizations.map((org) => org.name), ['Fixture Creek Alliance', 'Fixture Garden Collective']);
});

test('every field 0032 and the frontend validators need is checked, naming the listing', () => {
  const cases = [
    [(f) => { scheduled(f).title = `Fall ${EM_DASH} cleanup`; }, /"fixture-creek-cleanup": title has an em dash/],
    [(f) => { scheduled(f).summary = 'Bring <your gloves>.'; }, /"fixture-creek-cleanup": summary has a <\.\.\.> placeholder/],
    [(f) => { scheduled(f).url = 'http://creek.example.org/events'; }, /"fixture-creek-cleanup": url is not an https address/],
    [(f) => { scheduled(f).url = 'https://user:pw@creek.example.org/events'; }, /"fixture-creek-cleanup": url is not an https address/],
    [(f) => { scheduled(f).url = 'https://creek.example.org:8443/events'; }, /"fixture-creek-cleanup": url is not an https address/],
    [(f) => { scheduled(f).url = 'https://creek.example.org/events?utm_source=x'; }, /"fixture-creek-cleanup": url carries a tracking parameter/],
    [(f) => { profile(f).extra_sources[0].url = 'https://10.0.0.1/x'; }, /"fixture-creek-stewards": extra_sources\[0\]\.url is not an https address/],
    [(f) => { scheduled(f).served_place_ids = ['us-county:37999']; }, /"fixture-creek-cleanup": served_place_ids has "us-county:37999"/],
    [(f) => { profile(f).served_place_ids = ['us-state:SC']; }, /"fixture-creek-stewards": served_place_ids has "us-state:SC"/],
    [(f) => { scheduled(f).interest = 'Hiking'; }, /"fixture-creek-cleanup": interest "Hiking" is not one of/],
    [(f) => { scheduled(f).artwork = 'photo'; }, /"fixture-creek-cleanup": artwork "photo"/],
    [(f) => { scheduled(f).status = 'open'; }, /"fixture-creek-cleanup": status "open"/],
    [(f) => { scheduled(f).kind = 'once'; }, /"fixture-creek-cleanup": kind "once"/],
    [(f) => { scheduled(f).ends_at = '2099-11-07 08:00 America/New_York'; }, /"fixture-creek-cleanup": ends_at is not after starts_at/],
    [(f) => { scheduled(f).starts_at = '2099-11-07 9am America/New_York'; }, /"fixture-creek-cleanup": starts_at is not "YYYY-MM-DD HH:MM Zone"/],
    [(f) => { scheduled(f).starts_at = '2099-11-07 09:00 Eastern'; }, /"fixture-creek-cleanup": starts_at names Eastern/],
    [(f) => { scheduled(f).starts_at = '2027-03-14 02:30 America/New_York'; }, /"fixture-creek-cleanup": starts_at is a time that does not exist/],
    [(f) => { scheduled(f).venue_local_date = '2099-11-08'; }, /"fixture-creek-cleanup": venue_local_date is not the date of starts_at/],
    [(f) => { scheduled(f).venue_timezone = 'America/Chicago'; }, /"fixture-creek-cleanup": venue_timezone differs/],
    [(f) => { scheduled(f).venue_timezone = null; }, /"fixture-creek-cleanup": venue_timezone_basis needs a venue_timezone/],
    [(f) => { scheduled(f).starts_at = '2026-10-21 09:00 America/New_York'; scheduled(f).ends_at = '2026-10-21 10:00 America/New_York'; scheduled(f).venue_local_date = null; },
      /"fixture-creek-cleanup": starts_at 2026-10-21 09:00 America\/New_York is not after the build time/],
    [(f) => { rolling(f).starts_at = '2099-11-07 09:00 America/New_York'; }, /"fixture-garden-workdays": a rolling program has no starts_at/],
    [(f) => { scheduled(f).work = []; }, /"fixture-creek-cleanup": work must list 1 to 20 tasks/],
    [(f) => { scheduled(f).work = Array.from({ length: 21 }, (_, at) => `Task ${at}`); }, /work must list 1 to 20 tasks/],
    [(f) => { profile(f).steps = []; }, /"fixture-creek-stewards": steps must list 1 to 30 steps/],
    [(f) => { profile(f).steps = Array.from({ length: 31 }, (_, at) => ({ title: `Step ${at}`, text: 'Do it.' })); }, /steps must list 1 to 30 steps/],
    [(f) => { profile(f).steps[0].note = 'extra'; }, /"fixture-creek-stewards" steps\[0\]: has an unknown field "note"/],
    [(f) => { profile(f).title = 'x'.repeat(201); }, /"fixture-creek-stewards": title is longer than 200 characters/],
    [(f) => { scheduled(f).safety = 'x'.repeat(1001); }, /"fixture-creek-cleanup": safety is longer than 1000 characters/],
    [(f) => { profile(f).cost = '   '; }, /"fixture-creek-stewards": cost is blank/],
    [(f) => { profile(f).address_role = null; }, /"fixture-creek-stewards": address, address_kind and address_role are all set or all null/],
    [(f) => { profile(f).address_kind = 'home'; }, /"fixture-creek-stewards": address_kind "home"/],
    [(f) => { profile(f).id = 'Creek Stewards'; }, /"Creek Stewards": id is not a lowercase slug/],
    [(f) => { scheduled(f).summary = 'A cleanup near you.'; }, /"fixture-creek-cleanup": summary makes a distance or availability claim/],
    [(f) => { scheduled(f).org_name = 'Nobody Known'; }, /"fixture-creek-cleanup": org_name "Nobody Known" is not an organization/],
    [(f) => { delete scheduled(f).evidence; }, /"fixture-creek-cleanup": evidence is required/],
    [(f) => { scheduled(f).join = scheduled(f).join_text; delete scheduled(f).join_text; }, /opportunities\[0\]: has an unknown field "join"/],
    [(f) => { f[0].json.organizations[0].org.counties = ['Mecklenburg']; }, /"Fixture Creek Alliance": counties has "Mecklenburg"/],
    [(f) => { f[0].json.organizations[0].org.causes = ['trees']; }, /"Fixture Creek Alliance": cause "trees"/],
  ];
  for (const [change, expected] of cases) {
    const message = refusal(change);
    assert.ok(message, `not refused: ${expected}`);
    assert.match(message, expected);
  }
  assert.equal(refusal(() => {}), null);
});

test('a local time converts as Postgres does, and a repeated hour is refused', () => {
  assert.deepEqual(parseLocalTime('2099-11-07 09:00 America/New_York').instant, '2099-11-07T14:00:00Z');
  assert.deepEqual(parseLocalTime('2026-07-04 09:00 America/New_York').instant, '2026-07-04T13:00:00Z');
  assert.match(parseLocalTime('2026-11-01 01:30 America/New_York').error, /occurs twice/);
  assert.match(parseLocalTime('2026-02-30 09:00 America/New_York').error, /not a real date/);
});

test('the committed data file is valid and its SQL and review page are current (--check)', () => {
  assert.deepEqual(staleFiles(), [], 'run node scripts/build-participation-listings.mjs --from <research dir>');
});

// ---------------------------------------------------------------------------
// The generated SQL on Postgres
// ---------------------------------------------------------------------------

let db;
before(async () => {
  db = await createDb({ upTo: 12 });
  await db.applyMigration(MIGRATION_0032);
});
after(async () => { await db?.close(); });

const count = async (sql) => Number((await db.query(sql)).rows[0].n);
const read = async (fn, places, now) => (await db.asService((tx) => tx.query(`select public.${fn}($1::text[], $2::timestamptz) as r`, [pgArray(places), now.toISOString()]))).rows[0].r;
const detail = async (id, now) => (await db.asService((tx) => tx.query('select public.read_participation_opportunity($1, $2::timestamptz) as r', [id, now.toISOString()]))).rows[0].r;
const allPlaces = [...new Set([...data.profiles, ...data.opportunities].flatMap((row) => row.served_place_ids))];

test('SEEDED_ORGS is exactly the organizations 0004 and 0012 insert', async () => {
  const { rows } = await db.query('select name from public.volunteer_orgs order by name');
  assert.deepEqual(rows.map((row) => row.name).sort(), [...SEEDED_ORGS].sort());
});

test('apply twice, nothing served, the placeholder refused, then every listing served for every area it names', async () => {
  const apply = buildApplySql(data);
  const verify = buildVerifySql(data);
  const ids = (list) => list.map((item) => item.id);

  for (let pass = 0; pass < 2; pass += 1) await applySql(db.pg, `the apply SQL, pass ${pass + 1}`, apply);
  assert.equal(await count('select count(*) as n from public.volunteer_orgs'), SEEDED_ORGS.length + data.organizations.length);
  const { rows: orgs } = await db.query("select name, counties, causes, url, link_checked::text as checked, last_verified from public.volunteer_orgs where name like 'Fixture %' order by name");
  assert.deepEqual(orgs, data.organizations.map((org) => ({ name: org.name, counties: org.counties, causes: org.causes, url: org.url, checked: org.checked, last_verified: null })));
  for (const table of ['participation_profiles', 'participation_opportunities']) {
    assert.equal(await count(`select count(*) as n from public.${table} where verified_by is null and verified_at is null and revision = 1`), 2, table);
    assert.equal(await count(`select count(*) as n from public.${table}`), 2, table);
  }

  const now = () => new Date(Date.now() + 1000);
  assert.deepEqual(await read('read_participation_profiles', allPlaces, now()), []);
  assert.deepEqual(await read('read_participation_opportunities', allPlaces, now()), []);
  for (const row of data.opportunities) assert.equal(await detail(row.id, now()), null, row.id);

  // As written, the verify SQL cannot run: the check refuses <reviewer> and the transaction fails whole.
  assert.ok(verify.split(`'${REVIEWER}'`).length - 1 === 2, 'one placeholder per table');
  await assert.rejects(applySql(db.pg, 'the verify SQL as written', verify), /\[23514\].*participation_profiles_verified_check/);
  await db.exec('rollback');
  assert.equal(await count('select count(*) as n from public.participation_opportunities where verified_at is not null'), 0);

  const signed = verify.split(REVIEWER).join('QA');
  await applySql(db.pg, 'the verify SQL', signed);
  const { rows: [counts] } = await db.query(signed.slice(signed.indexOf('select (select count')));
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])),
    { profiles_verified: 2, profiles_expected: 2, opportunities_verified: 2, opportunities_expected: 2 });

  // Re-running the apply SQL never touches (or un-verifies) a row already there.
  await applySql(db.pg, 'the apply SQL, pass 3', apply);
  assert.equal(await count("select count(*) as n from public.participation_opportunities where verified_by = 'QA' and revision = 2"), 2);

  for (const row of data.profiles) {
    for (const place of row.served_place_ids) {
      const served = await read('read_participation_profiles', [place], now());
      assert.ok(ids(served).includes(row.id), `${row.id} for ${place}`);
      const item = served.find((entry) => entry.id === row.id);
      assert.ok(validOrganizations({ items: [item], complete: true, nextCursor: null }), `${row.id}: the frontend validator`);
      const expected = {
        title: row.title, organizer: row.organizer, interest: row.interest, area: row.area, mission: row.mission, work: row.work, url: row.url,
        sourceTitle: row.source_title, effort: row.effort, age: row.age, cost: row.cost, access: row.access, steps: row.steps, bring: row.bring,
        followup: row.followup, ...(row.extra_sources.length ? { extraSources: row.extra_sources } : {}),
        ...(row.address !== null ? { address: row.address, addressRole: row.address_role } : {}), ...(row.contact !== null ? { contact: row.contact } : {}),
      };
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(item[key], value, `${row.id}.${key}`);
    }
  }
  for (const row of data.opportunities) {
    for (const place of row.served_place_ids) {
      const served = await read('read_participation_opportunities', [place], now());
      assert.ok(ids(served).includes(row.id), `${row.id} for ${place}`);
      const item = served.find((entry) => entry.id === row.id);
      assert.ok(validOpportunity(item), `${row.id}: the frontend validator`);
      const expected = {
        organizer: row.organizer, title: row.title, interest: row.interest, artwork: row.artwork, kind: row.kind, timeLabel: row.time_label,
        status: row.status, area: row.area, venue: row.venue, url: row.url, summary: row.summary, work: row.work, duration: row.duration,
        cost: row.cost, age: row.age, access: row.access, bring: row.bring, join: row.join_text, safety: row.safety,
        ...(row.kind === 'scheduled' ? { startsAt: parseLocalTime(row.starts_at).instant, endsAt: parseLocalTime(row.ends_at).instant } : {}),
        ...(row.venue_local_date !== null ? { venueLocalDate: row.venue_local_date } : {}),
        ...(row.venue_timezone !== null ? { venueTimezone: row.venue_timezone, venueTimezoneBasis: row.venue_timezone_basis } : {}),
        ...(row.meeting_address !== null ? { address: row.meeting_address } : {}),
      };
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(item[key], value, `${row.id}.${key}`);
      if (row.kind === 'rolling') for (const key of ['startsAt', 'endsAt', 'venueLocalDate']) assert.ok(!(key in item), `${row.id}.${key}`);
      assert.ok(validOpportunity(await detail(row.id, now())), `${row.id}: the detail read`);
    }
  }
  // An area no listing names gets nothing.
  assert.deepEqual(await read('read_participation_opportunities', ['us-county:37001'], now()), []);
});
