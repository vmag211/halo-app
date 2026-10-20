/**
 * Migration 0032 on PGlite (B18 plan, docs/backend/plans/b18-participation-directory.md):
 * the two listing tables, their checks and guards, the three read
 * functions, the YOUR_TODO.md templates, the one-paste bundle and the
 * back-out, on the reconstructed baseline plus every migration
 * (test/db/pgliteHarness.mjs). Rows are written as the migration owner, the
 * SQL editor's role, the only writer there is. Each scenario runs in a
 * transaction that is rolled back; a statement expected to refuse runs in a
 * savepoint. The read functions take the clock as a parameter, so every
 * scenario uses one fixed instant.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, applySql, createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { BUNDLES, OUT_DIR, buildBundle, buildVerify } from '../scripts/build-apply-bundle.mjs';
import { ORG, ensureOrg, insertListing, opportunityRow, pgArray, profileRow } from './helpers/participationWorld.mjs';

const MIGRATION = listMigrations().find((migration) => migration.number === 32);
const BEFORE = MIGRATION.number - 1;
const BUNDLE = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0032.sql');
const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');
const NOW = new Date('2026-10-20T15:00:00Z');
const DAY = 86400000;
const MECKLENBURG = ['us-county:37119', 'us-state:NC'];

function docBlock(name) {
  const lines = TODO.split('\n');
  const at = lines.findIndex((line) => line.trim() === `<!-- ${name} -->`);
  assert.ok(at >= 0, `YOUR_TODO.md has no <!-- ${name} -->`);
  assert.equal(lines.filter((line) => line.trim() === `<!-- ${name} -->`).length, 1, `<!-- ${name} --> appears once`);
  const open = lines.findIndex((line, index) => index > at && line.trim() === '```sql');
  const close = lines.findIndex((line, index) => index > open && line.trim() === '```');
  return lines.slice(open + 1, close).join('\n');
}

let db;
before(async () => {
  db = await createDb();
  await ensureOrg(db);
});
after(async () => { await db?.close(); });

function scenario(fn) {
  return db.pg.transaction(async (tx) => {
    const result = await fn(tx);
    await tx.rollback();
    return result;
  });
}
async function attempt(tx, work) {
  await tx.exec('savepoint attempt');
  try {
    const out = await work();
    await tx.exec('release savepoint attempt');
    return { ok: true, out };
  } catch (error) {
    await tx.exec('rollback to savepoint attempt');
    return { ok: false, error };
  }
}
const opportunities = async (tx, places = MECKLENBURG, now = NOW) =>
  (await tx.query('select public.read_participation_opportunities($1::text[], $2::timestamptz) as r', [pgArray(places), now.toISOString()])).rows[0].r;
const opportunity = async (tx, id, now = NOW) =>
  (await tx.query('select public.read_participation_opportunity($1, $2::timestamptz) as r', [id, now.toISOString()])).rows[0].r;
const profiles = async (tx, places = MECKLENBURG, now = NOW) =>
  (await tx.query('select public.read_participation_profiles($1::text[], $2::timestamptz) as r', [pgArray(places), now.toISOString()])).rows[0].r;
const ids = (list) => list.map((item) => item.id);

// ---------------------------------------------------------------------------
// Applying, verifying and the bundle
// ---------------------------------------------------------------------------

test('0032 applies over every earlier migration, re-applies to the same schema, and its bundle and check pass twice', async () => {
  assert.ok(BUNDLE, 'no apply-0032.sql bundle in BUNDLES');
  assert.deepEqual([...BUNDLE.migrations], ['0032_participation_directory']);
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.bundleFile), 'utf8'), buildBundle(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.verifyFile), 'utf8'), buildVerify(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  const fresh = await createDb({ upTo: BEFORE });
  try {
    await fresh.applyMigration(MIGRATION);
    const once = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), once);
    for (let pass = 0; pass < 2; pass += 1) {
      await applySql(fresh.pg, 'the 0032 bundle', buildBundle(BUNDLE));
      const { rows: [row] } = await fresh.query(buildVerify(BUNDLE));
      assert.deepEqual({ ...row, checks_run: Number(row.checks_run) }, { all_migrations_ok: true, checks_run: 7, failing: 'none' });
    }
    // The check notices a browser grant.
    await fresh.exec('grant select on public.participation_opportunities to anon');
    const { rows: [broken] } = await fresh.query(buildVerify(BUNDLE));
    assert.equal(broken.failing, '0032.no_client_access');
  } finally {
    await fresh.close();
  }
});

test('0032 needs only 0004: it applies right after volunteer_orgs and serves a verified listing there', async () => {
  const fresh = await createDb({ upTo: 4 });
  try {
    await fresh.applyMigration(MIGRATION);
    await ensureOrg(fresh);
    await insertListing(fresh, 'participation_opportunities', opportunityRow({ now: NOW }));
    const { rows: [{ r }] } = await fresh.query('select public.read_participation_opportunities($1::text[], $2::timestamptz) as r', [pgArray(MECKLENBURG), NOW.toISOString()]);
    assert.deepEqual(ids(r), ['creek-cleanup']);
  } finally {
    await fresh.close();
  }
});

// ---------------------------------------------------------------------------
// Only verified rows
// ---------------------------------------------------------------------------

test('an unverified, a future-verified or a stale row is never served; a verified fresh one is, in the client shape', async () => {
  await scenario(async (tx) => {
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'unverified', now: NOW, verified: false }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'future-verified', now: NOW, verifiedDaysAgo: -1 }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'stale', now: NOW, verifiedDaysAgo: 30 }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'edge', now: NOW, verifiedDaysAgo: 29 }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'fresh', now: NOW, startsInDays: 3 }));
    await insertListing(tx, 'participation_profiles', profileRow({ id: 'unverified', now: NOW, verified: false }));
    await insertListing(tx, 'participation_profiles', profileRow({ id: 'stale-profile', now: NOW, verifiedDaysAgo: 182 }));
    await insertListing(tx, 'participation_profiles', profileRow({ id: 'fresh-profile', now: NOW, verifiedDaysAgo: 170 }));
    const served = await opportunities(tx);
    // 29 days ago at 15:00 is a verification date whose midnight is 29 days 15 hours back: outside the 29-day window.
    assert.deepEqual(ids(served), ['fresh']);
    assert.deepEqual(ids(await profiles(tx)), ['fresh-profile']);
    for (const id of ['unverified', 'future-verified']) assert.equal(await opportunity(tx, id), null, id);
    const item = served[0];
    assert.match(item.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(item.endsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(item.checkedAt, '2026-10-19');
    assert.equal(item.join, 'Register on the organizer page.');
    assert.deepEqual(item.scopes, []);
    assert.equal(item.revision, 1);
    for (const key of ['address', 'venueLocalDate', 'venueTimezone', 'venueTimezoneBasis', 'verified_by', 'verifiedBy', 'org_id']) assert.ok(!(key in item), key);
  });
});

test('the instants are UTC whatever the session time zone, and the verification date is the UTC day', async () => {
  await scenario(async (tx) => {
    await tx.exec("set local timezone = 'Pacific/Auckland'");
    await insertListing(tx, 'participation_opportunities', opportunityRow({
      now: NOW, starts_at: '2026-11-07 09:00 America/New_York', ends_at: '2026-11-07 12:00 America/New_York', verified_at: '2026-10-20 01:30+00',
    }));
    const [item] = await opportunities(tx);
    assert.equal(item.startsAt, '2026-11-07T14:00:00Z');
    assert.equal(item.endsAt, '2026-11-07T17:00:00Z');
    assert.equal(item.checkedAt, '2026-10-20');
  });
});

test('a search never serves a started, expired, cancelled, full or postponed listing; rolling stays while fresh; the detail serves them all once verified', async () => {
  await scenario(async (tx) => {
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'started', now: NOW, startsInDays: -0.01 }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'expired', now: NOW, startsInDays: -10, verifiedDaysAgo: 1 }));
    for (const status of ['cancelled', 'full', 'postponed']) await insertListing(tx, 'participation_opportunities', opportunityRow({ id: status, now: NOW, status }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'later', now: NOW, startsInDays: 9 }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'sooner', now: NOW, startsInDays: 2 }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'rolling-b', title: 'B program', now: NOW, kind: 'rolling', time_label: 'Any week' }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'rolling-a', title: 'A program', now: NOW, kind: 'rolling', time_label: 'Any week' }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'rolling-stale', now: NOW, kind: 'rolling', time_label: 'Any week', verifiedDaysAgo: 40 }));
    assert.deepEqual(ids(await opportunities(tx)), ['sooner', 'later', 'rolling-a', 'rolling-b']);
    const rolling = (await opportunities(tx)).find((item) => item.id === 'rolling-a');
    assert.equal(rolling.kind, 'rolling');
    assert.ok(!('startsAt' in rolling) && !('endsAt' in rolling));
    for (const id of ['started', 'expired', 'cancelled', 'full', 'postponed', 'rolling-stale']) {
      const item = await opportunity(tx, id);
      assert.equal(item?.id, id, `the detail serves the verified ${id} listing`);
    }
    assert.equal((await opportunity(tx, 'cancelled')).status, 'cancelled');
    // The same listing a moment after it starts has left the search.
    const later = new Date(NOW.getTime() + 2 * DAY + 60000);
    assert.deepEqual(ids(await opportunities(tx, MECKLENBURG, later)), ['later', 'rolling-a', 'rolling-b']);
  });
});

test('an area matches only the ids a listing serves: its own, its county or statewide; never by nearness', async () => {
  await scenario(async (tx) => {
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'mecklenburg', now: NOW }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'statewide', now: NOW, served_place_ids: ['us-state:NC'] }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'zip', now: NOW, served_place_ids: ['us-zcta:28208'] }));
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'wake', now: NOW, served_place_ids: ['us-county:37183'] }));
    assert.deepEqual(ids(await opportunities(tx, ['us-county:37119', 'us-state:NC'])).sort(), ['mecklenburg', 'statewide']);
    assert.deepEqual(ids(await opportunities(tx, ['us-zcta:28208', 'us-county:37119', 'us-state:NC'])).sort(), ['mecklenburg', 'statewide', 'zip']);
    // Union County borders Mecklenburg: nothing of Mecklenburg's is offered there.
    assert.deepEqual(ids(await opportunities(tx, ['us-county:37179', 'us-state:NC'])), ['statewide']);
    assert.deepEqual(await opportunities(tx, []), []);
  });
});

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

test('a content change without a new verified_at un-verifies the row; a re-verification keeps it served; every change raises the revision', async () => {
  await scenario(async (tx) => {
    await insertListing(tx, 'participation_opportunities', opportunityRow({ now: NOW }));
    await insertListing(tx, 'participation_profiles', profileRow({ now: NOW }));
    await tx.query("update public.participation_opportunities set summary = 'A different summary.' where id = 'creek-cleanup'");
    const { rows: [row] } = await tx.query("select verified_by, verified_at, revision from public.participation_opportunities where id = 'creek-cleanup'");
    assert.deepEqual(row, { verified_by: null, verified_at: null, revision: 2 });
    assert.deepEqual(await opportunities(tx), []);
    assert.equal(await opportunity(tx, 'creek-cleanup'), null);
    await tx.query("update public.participation_opportunities set status = 'cancelled', verified_by = 'VM', verified_at = $1 where id = 'creek-cleanup'", [NOW.toISOString()]);
    const item = await opportunity(tx, 'creek-cleanup');
    assert.equal(item.status, 'cancelled');
    assert.equal(item.revision, 3);
    assert.deepEqual(await opportunities(tx), [], 'a cancelled listing is detail only');
    // Re-stating the same verified_at is not a new verification.
    await tx.query("update public.participation_opportunities set status = 'listed', verified_at = verified_at where id = 'creek-cleanup'");
    assert.equal(await opportunity(tx, 'creek-cleanup'), null);
    await tx.query("update public.participation_profiles set steps = '[{\"title\": \"New\", \"text\": \"Changed step.\"}]'::jsonb where id = 'riverkeeper-cleanups'");
    assert.deepEqual(await profiles(tx), []);
    // A verification-only change keeps the content verified.
    await tx.query("update public.participation_profiles set verified_by = 'YB', verified_at = $1 where id = 'riverkeeper-cleanups'", [NOW.toISOString()]);
    assert.deepEqual(ids(await profiles(tx)), ['riverkeeper-cleanups']);
  });
});

test('malformed listings are refused by the database, each by its own check', async () => {
  const cases = [
    ['participation_opportunities', { interest: 'Water' }, /choice_check/],
    ['participation_opportunities', { artwork: 'photo' }, /choice_check/],
    ['participation_opportunities', { status: 'open' }, /choice_check/],
    ['participation_opportunities', { url: 'http://example.org/x' }, /links_check/],
    ['participation_opportunities', { url: 'https://user:pass@example.org/x' }, /links_check/],
    ['participation_opportunities', { summary: `Litter ${String.fromCharCode(0x2014)} and more.` }, /text_check/],
    ['participation_opportunities', { summary: '<what the event is>' }, /text_check/],
    ['participation_opportunities', { venue: 'Trail\u0007head' }, /text_check/],
    ['participation_opportunities', { venue: '   ' }, /text_check/],
    ['participation_opportunities', { work: [] }, /links_check/],
    ['participation_opportunities', { served_place_ids: ['charlotte'] }, /links_check/],
    ['participation_opportunities', { served_place_ids: ['us-county:45091'] }, /links_check/],
    ['participation_opportunities', { kind: 'rolling', starts_at: '2026-11-07T14:00:00Z', ends_at: '2026-11-07T17:00:00Z' }, /kind_check/],
    ['participation_opportunities', { kind: 'rolling', venue_local_date: '2026-11-07' }, /kind_check/],
    ['participation_opportunities', { starts_at: null }, /kind_check/],
    ['participation_opportunities', { ends_at: '2026-01-01T00:00:00Z' }, /kind_check/],
    ['participation_opportunities', { venue_timezone_basis: 'source' }, /zone_check/],
    ['participation_opportunities', { venue_timezone: 'EST', venue_timezone_basis: 'source' }, /venue_timezone is not an IANA zone/],
    ['participation_opportunities', { venue_timezone: 'Mars/Olympus', venue_timezone_basis: 'source' }, /venue_timezone is not an IANA zone/],
    ['participation_opportunities', { starts_at: '2026-11-07 23:30 America/New_York', ends_at: '2026-11-08 01:00 America/New_York', venue_timezone: 'America/New_York', venue_timezone_basis: 'source', venue_local_date: '2026-11-08' }, /venue_local_date is not the start date/],
    ['participation_opportunities', { verified_at: null }, /verified_check/],
    ['participation_opportunities', { id: 'Creek Cleanup' }, /id_check/],
    ['participation_opportunities', { org_id: '00000000-0000-4000-8000-000000000000' }, /foreign key|violates/],
    ['participation_profiles', { steps: [] }, /links_check/],
    ['participation_profiles', { steps: [{ title: 'Only a title' }] }, /links_check/],
    ['participation_profiles', { steps: [{ title: 'A', text: 'B', extra: 'C' }] }, /links_check/],
    ['participation_profiles', { extra_sources: [{ title: 'A', url: 'http://example.org' }] }, /links_check/],
    ['participation_profiles', { address: '1 Main Street' }, /address_check/],
    ['participation_profiles', { address: '1 Main Street', address_kind: 'home', address_role: 'Office.' }, /address_check/],
    ['participation_profiles', { interest: 'Advocacy' }, /interest_check/],
    ['participation_profiles', { verified_by: '<your name or initials>' }, /verified_check/],
  ];
  await scenario(async (tx) => {
    for (const [table, over, pattern] of cases) {
      const row = table === 'participation_profiles' ? profileRow({ now: NOW, ...over }) : opportunityRow({ now: NOW, ...over });
      const outcome = await attempt(tx, () => insertListing(tx, table, row));
      assert.equal(outcome.ok, false, `${table} ${JSON.stringify(over)} was accepted`);
      assert.match(`${outcome.error.message} ${outcome.error.detail ?? ''}`, pattern, `${table} ${JSON.stringify(over)}`);
    }
    // And the good ones: a source zone with its matching venue date, and an address with its role.
    const good = await attempt(tx, () => insertListing(tx, 'participation_opportunities', opportunityRow({
      now: NOW, starts_at: '2026-11-07 23:30 America/New_York', ends_at: '2026-11-08 01:00 America/New_York',
      venue_timezone: 'America/New_York', venue_timezone_basis: 'source', venue_local_date: '2026-11-07', meeting_address: '1 Creek Road, Charlotte, NC',
    })));
    assert.equal(good.ok, true, good.error?.message);
    const [item] = await opportunities(tx);
    assert.deepEqual([item.venueLocalDate, item.venueTimezone, item.venueTimezoneBasis, item.address], ['2026-11-07', 'America/New_York', 'source', '1 Creek Road, Charlotte, NC']);
    const office = await attempt(tx, () => insertListing(tx, 'participation_profiles', profileRow({
      now: NOW, address: '1 Main Street, Charlotte, NC', address_kind: 'office', address_role: 'Office address, not an event meeting point.',
      extra_sources: [{ title: 'Locations', url: 'https://example.org/locations' }],
    })));
    assert.equal(office.ok, true, office.error?.message);
    const [profile] = await profiles(tx);
    assert.equal(profile.addressRole, 'Office address, not an event meeting point.');
    assert.ok(!('address_kind' in profile) && !('addressKind' in profile));
    assert.deepEqual(profile.extraSources, [{ title: 'Locations', url: 'https://example.org/locations' }]);
  });
});

test('an organization with listings cannot be deleted out from under them', async () => {
  await scenario(async (tx) => {
    await insertListing(tx, 'participation_profiles', profileRow({ now: NOW }));
    const outcome = await attempt(tx, () => tx.query('delete from public.volunteer_orgs where name = $1', [ORG]));
    assert.equal(outcome.ok, false);
    assert.match(outcome.error.message, /foreign key/);
  });
});

test('neither browser role can read, write or call anything', async () => {
  const someone = 'a11ce000-0000-4000-8000-0000000018a1';
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['participation_profiles', 'participation_opportunities']) {
      await assert.rejects(db.asRole(role, someone, (tx) => tx.query(`select * from public.${table}`)), /permission denied/);
      await assert.rejects(db.asRole(role, someone, (tx) => tx.query(`delete from public.${table}`)), /permission denied/);
    }
    await assert.rejects(db.asRole(role, someone, (tx) => tx.query("select public.read_participation_opportunities('{}'::text[], now())")), /permission denied/);
    await assert.rejects(db.asRole(role, someone, (tx) => tx.query("select public.read_participation_opportunity('x', now())")), /permission denied/);
    await assert.rejects(db.asRole(role, someone, (tx) => tx.query("select public.read_participation_profiles('{}'::text[], now())")), /permission denied/);
  }
});

// ---------------------------------------------------------------------------
// The YOUR_TODO.md templates
// ---------------------------------------------------------------------------

/** A template with every <placeholder> filled as a person would, and the dates moved after NOW's real counterpart. */
function filled(block, id) {
  return block
    .replaceAll("'<listing id>'", `'${id}'`)
    .replaceAll("'<organization name>'", `'${ORG}'`)
    .replaceAll("'<place id>'", "'us-county:37119'")
    .replace(/https:\/\/<[^>]*>/g, 'https://example.org/listing')
    .replace(/<[^>]*>/g, 'Written from the official page.');
}

test('the templates refuse to run unedited, and filled in they add an unverified row that the verify step makes servable', async () => {
  await scenario(async (tx) => {
    for (const name of ['template-0032-profile', 'template-0032-opportunity']) {
      const outcome = await attempt(tx, () => tx.exec(docBlock(name)));
      assert.equal(outcome.ok, false, `${name} ran unedited`);
    }
    // The verify step unedited names no listing, so it changes nothing.
    await insertListing(tx, 'participation_opportunities', opportunityRow({ id: 'bystander', now: NOW, verified: false }));
    await tx.exec(docBlock('template-0032-verify'));
    assert.deepEqual((await tx.query("select verified_by from public.participation_opportunities where id = 'bystander'")).rows, [{ verified_by: null }]);
    await tx.exec(filled(docBlock('template-0032-profile'), 'template-profile'));
    // The opportunity template's example date is in the past by the time anyone reads it: read it on that day.
    await tx.exec(filled(docBlock('template-0032-opportunity'), 'template-event'));
    const onTheDay = new Date('2026-11-01T12:00:00Z');
    assert.deepEqual(await opportunities(tx, MECKLENBURG, onTheDay), [], 'unverified until step 2');
    assert.deepEqual(await profiles(tx, MECKLENBURG, onTheDay), []);
    await tx.query("update public.participation_opportunities set verified_by = 'VM', verified_at = $1 where id = 'template-event'", [onTheDay.toISOString()]);
    await tx.exec(filled(docBlock('template-0032-verify'), 'template-event').replace('participation_opportunities', 'participation_profiles').replace("'template-event'", "'template-profile'").replace('now()', `'${onTheDay.toISOString()}'`));
    const [event] = await opportunities(tx, MECKLENBURG, onTheDay);
    assert.equal(event.id, 'template-event');
    assert.equal(event.startsAt, '2026-11-07T14:00:00Z');
    assert.equal(event.venueLocalDate, '2026-11-07');
    assert.deepEqual(ids(await profiles(tx, MECKLENBURG, onTheDay)), ['template-profile']);
  });
});

// ---------------------------------------------------------------------------
// The back-out
// ---------------------------------------------------------------------------

test('the back-out removes exactly what 0032 adds, is safe twice, and 0032 applies again after it; the file and the doc agree', async () => {
  const fresh = await createDb({ upTo: BEFORE });
  try {
    const before = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    const applied = await runAudit(fresh);
    await ensureOrg(fresh);
    await insertListing(fresh, 'participation_opportunities', opportunityRow({ now: NOW }));
    const block = docBlock('backout-0032');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before, 'the schema is exactly what came before 0032 again');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before);
    const { rows } = await fresh.query('select count(*)::int as n from public.volunteer_orgs where name = $1', [ORG]);
    assert.equal(rows[0].n, 1, 'volunteer_orgs is not touched');
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), applied);
  } finally {
    await fresh.close();
  }
  const fileBlock = MIGRATION.sql.split('<!-- backout-0032 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0032').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});
