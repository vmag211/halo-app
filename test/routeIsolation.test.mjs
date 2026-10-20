/**
 * Cross-identity route isolation, part 1: reads, identity from the token only,
 * scoped mutations and "exists but is not yours" looking like "does not exist".
 * Part 2 (push, account, providers, assistant, cron) is routeIsolationFlows.test.mjs.
 *
 * Two households (alice, bob) are seeded in every owned table with distinct
 * markers. Every call goes through ctx.call, which also audits that each query on
 * an owned table was scoped to the caller. Real route handlers run against the
 * in-memory fake; nothing here is a mock of the route under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { OWNED_TABLES } from './helpers/tables.mjs';
import { OTHER, quiet, setup, stable } from './helpers/isolationKit.mjs';
import { MISSING_ID, PREFS, PROFILE, BANDS, UTILITY, alertId, contextId, entryId, addDays } from './helpers/isolationSeed.mjs';
import { registerSaveHousehold } from './helpers/fakeSaveHousehold.mjs';
import { registerHomeContextRpcs } from './helpers/fakeHomeContext.mjs';

const { LEARN_CONTENT } = await import('@/lib/learnContent');

/**
 * Every route and method under app/api, and where this suite proves it keeps households apart.
 * routeIsolation = this file, flows = routeIsolationFlows.test.mjs. A route added without a line
 * here fails the inventory test below: add its isolation tests first.
 */
const ROUTE_COVERAGE = {
  'DELETE /api/account': 'flows: deletes the caller from every owned table (cascade), foreign ids and headers ignored, bob intact',
  'GET /api/alerts': 'isolation: read matrix, identity-from-token',
  'POST /api/alerts': 'isolation: foreign id for read, dismiss and undo looks like a missing id; all:true scoped',
  'POST /api/alerts/state': 'routesAlertsState: every statement on alerts and every ledger read is scoped to the caller on the query itself, another household\'s alert id in a selection is the identical 409 to an id that never existed and changes nothing of theirs, alone or beside the caller\'s own rows, and a body naming another profile is refused',
  'GET /api/assistant': 'isolation: read matrix (suggestions only)',
  'POST /api/assistant': 'flows: the model prompt carries only the caller\'s context and no journal notes',
  'GET /api/cron/daily': 'flows: secret required; bands, dedupe, prefs, season summary and provider requests per household',
  'POST /api/cron/daily': 'flows: shares the GET handler; secret required (checked here), run covered through GET',
  'GET /api/daily-score': 'isolation: read matrix, 403 for a foreign profile_id; flows: cache miss, own-row write, provider requests',
  'GET /api/district': 'isolation: read matrix; routesMapPublic: with no Authorization header the read is the stored view only, reads no profiles row and carries no household_county, and any Authorization header is checked as before',
  'GET /api/evidence': 'routesEvidence: the daily_maxima read is filtered by the caller\'s id and the caller\'s current home context on the query itself, and the home is read owner-scoped with no id from the request, so another household\'s maxima and an earlier home\'s are never in the answer (on the real 0025 tables too); a foreign X-Halo-Home-Context changes nothing; daily_scores is never read and nothing is written',
  'GET /api/health': 'isolation: read matrix (no household data)',
  'GET /api/history': 'isolation: read matrix, identity-from-token; routesHistoryContext: another household\'s home in ?context= is the identical 404, two households in every scope',
  'GET /api/home-contexts': 'isolation: read matrix, identity-from-token',
  'GET /api/home-contexts/[id]': 'isolation: another household\'s context id is the identical 404 to a missing one',
  'PATCH /api/home-contexts/[id]': 'isolation: another household\'s context id changes nothing and is the identical 404 to a missing one',
  'GET /api/home-guard': 'isolation: read matrix, identity-from-token',
  'GET /api/household': 'isolation: read matrix, identity-from-token',
  'PUT /api/household': 'isolation: only the caller\'s band and profile rows change, on the save_household and two-step paths',
  'GET /api/journal': 'isolation: read matrix, identity-from-token',
  'POST /api/journal': 'isolation: row owned by the caller even with another household\'s profile_id and id in the body',
  'DELETE /api/journal': 'isolation: foreign id deletes 0 and looks like a missing id; all=true scoped',
  'GET /api/journal/findings': 'isolation: read matrix (readiness would flip if rows pooled); historyContextReaders: an earlier home\'s readings are left out',
  'POST /api/journal/retrospective': 'isolation: read only, body profile_id ignored, only the caller\'s days',
  'GET /api/journal/summary': 'isolation: read matrix (day counts would pool)',
  'GET /api/account': 'routesAccountRead: the challenge and unresolved operations are read for the caller only; a profile_id in the query changes nothing; off by the flag nothing is read at all',
  'POST /api/account/commands': 'routesAccountCommands: every statement is scoped to the caller, another household\'s challenge id is the identical failure to a missing one, a body naming another profile is refused and a query naming one is ignored; a collision fails without merging and discloses nothing about the other identity',
  'POST /api/frontend/actions/commands': 'routesActionsCommit, routesActionsCommitDb: the read and commit functions are called with the verified caller\'s id only, so a delete naming another household\'s task id answers exactly as an id that never existed and leaves their task and version untouched, another household\'s operation id is the identical operation_mismatch and leaves their ledger row as it was, and a home-context header naming another household changes nothing; the ledger row is the caller\'s and holds ids, revisions and a reason code only; off by the flag nothing is read, claimed or written; before 0023 or 0017 the answer is feature_unavailable with no claim',
  'GET /api/frontend/actions': 'routesActionsLoad: the ledger statements are scoped to the caller on the query itself and the one read function is called with the verified caller\'s id only, so another household\'s tasks, preferences and pending operations never appear (on the real 0023 function too); a query or a home-context header naming another household changes nothing; off by the flag nothing is read, reaped or called at all, and before 0023 or 0017 the answer is feature_unavailable rather than an empty week',
  'GET /api/forecast': 'routesForecast: the one statement it makes is a select of the caller\'s own profiles row, filtered by the caller\'s id on the query itself, and only when no place is typed; a typed place reads no table; a foreign X-Halo-Home-Context changes nothing; nothing is written; the cache holds provider data under 2-decimal point keys only, so a second household asking for the same place gets the identical answer with no household-specific content',
  'GET /api/explore/area': 'routesExploreArea: reads only the caller\'s own explore_areas row (owner-scope audited), so another household\'s area is never visible; never reads the ledger, so no pendingOperation can name anyone\'s operation; a foreign X-Halo-Home-Context changes nothing',
  'PATCH /api/explore/area': 'routesExploreArea: every statement on explore_areas is scoped to or writes the caller (owner-scope audited) and the ledger claim and replay read are owner scoped, with the settle naming only the caller\'s own claimed id, so one household\'s save leaves the other\'s row untouched; a body naming another profile is refused, another household\'s Idempotency-Key is an operation_mismatch that leaves its ledger row as it was, and a foreign X-Halo-Home-Context changes nothing',
  'GET /api/learn': 'isolation: read matrix (household note from the caller\'s composition)',
  'GET /api/locations/search': 'routesLocationsSearch: reads no table and calls no RPC or provider (any database use throws), so two households get the identical answer and nothing in it is anyone\'s',
  // The six Luna lines, written in one voice by B03 task 3 after the three
  // parallel route tasks merged. Each says what its own suite proves, in this
  // order: whose rows the route may touch, what an identifier belonging to
  // another household does, what a smuggled identity does, and what the
  // flag-off and pre-migration states leave behind. They are deliberately
  // narrower than the routes' own guarantees, because a clause here is read as
  // "a test proves this": anything only the code promises is left out, and so
  // is anything the harness cannot observe. The query log records a table, an
  // operation and its filters and NOTHING else, so no line here may describe a
  // statement's count mode, its row cap or whether it returned rows; and a
  // query against an absent table is still logged before it errors, so "the
  // table is missing" never means "no statement was made".
  'GET /api/luna/capabilities': 'routesLunaCapabilities: the body is deployment configuration, so two households get the identical answer and a profileId in the query changes nothing; no turn and no run is read, nothing is written, and the one statement it does make is scoped to the caller on the query itself; off by the flag nothing is read at all',
  'GET /api/luna/conversations': 'routesLunaConversations: only the caller\'s own conversation, turns and runs are read, every statement scoped to the caller on the query itself; a query naming another household answers with the caller\'s own conversation and no word of theirs; off by the flag nothing is read or written, and with any of 0020\'s three tables absent the answer is feature_unavailable rather than an empty conversation',
  'POST /api/luna/conversations/clear': 'routesLunaConversations: another household\'s conversation id is the identical 409 conflict to an id that never existed and deletes nothing of theirs, a body naming another profile is refused and a query naming one is ignored, and clearing touches no row outside the caller\'s own Luna conversation; off by the flag no Luna table is read, nothing is deleted and no operation id is claimed; with any of 0020\'s three tables absent, no operation id is claimed and nothing is deleted',
  'GET /api/luna/runs/status': 'routesLunaRuns: the run lookup is scoped to the caller on the query itself, and another household\'s run id or clientMessageId is the identical failed run to an id that never existed, with no conversation attached; off by the flag, and before 0020, the answer is feature_unavailable rather than a run',
  'POST /api/luna/runs/cancel': 'routesLunaRuns: another household\'s run id settles nothing of theirs and is the identical failed run to a missing one; the ledger receipt is owned by the caller and holds the run id only, never conversation text; off by the flag nothing is read and nothing is written; before 0020 no operation id is claimed and no run is reported, and before 0017 the run is left exactly as it was',
  'POST /api/luna/messages': 'routesLunaMessages: the turn, the run and the conversation are written and read for the caller only, each scoped on the query itself, and no household table is read at all (Ruling L2); another household\'s conversation id is the identical 404 to a missing one, and their clientMessageId answers no run and starts none; a body naming another profile is refused and a query naming one is ignored; off by the flag nothing is read, and before 0020 nothing is written and no operation id is claimed',
  'GET /api/map': 'isolation: read matrix (no household data); routesMapPublic: with no Authorization header the read is cache-only (stored layer or warm geography), builds, stores and fetches nothing, and reads no household table',
  'GET /api/map/comparison': 'routesMapComparison: reads no household table (only map_layers and ucmr5_utilities), so two households get the identical answer and nothing in it is anyone\'s; routesMapPublic: with no Authorization header a visitor gets that same body',
  'GET /api/notifications': 'isolation: read matrix',
  'GET /api/operations': 'routesOperations: another household\'s operation id is the identical 404, recovery is not readable here, stale pending reads as unknown; a succeeded actions operation reads only the caller\'s own snapshot (B06 H18), and another household\'s is the identical 404 with nothing of theirs read',
  'PUT /api/notifications': 'isolation: only the caller\'s preferences change; smuggled profile_id rejected',
  'POST /api/onboard': 'isolation: 403 for a foreign profile_id; flows: move, backfill, lookup failure touch only the caller, with and without the 0016 function',
  'GET /api/privacy/status': 'routesPrivacyStatus: every ledger statement is scoped to the caller on the query itself and the receipt purge is called with the verified caller\'s id only, so another household\'s pending privacy operation is never listed and its settled receipts are never purged by this read (on the real 0024 function too); a query or a home-context header naming another household changes nothing; with no review key, before 0024 or before 0017 the answer is feature_unavailable with nothing written',
  'POST /api/recovery/request': 'routesRecoveryRequest: public and unauthenticated, so nothing in the request names whose account is touched; an Authorization header changes nothing, the answer is the same pending body for a linked and an unlinked address, and a stranger asking about an address touches no row of the household it resolves to; human verification is checked before the address is touched and its refusals are identical for an address that resolves and one that does not',
  'POST /api/recovery/status': 'routesRecoveryStatus: public and unauthenticated, so the client nonce is the only thing that resolves a challenge; an Authorization header changes nothing, another household\'s challenge is unreachable and its not-found answer is byte-identical to a wrong nonce and to no row at all, a link-intent row is invisible, and a status read creates and mutates nothing in either the challenge table or the ledger',
  'POST /api/privacy/export/inspect': 'routesPrivacyInspect: every statement on an owned table is scoped to the caller, bob\'s markers never reach alice\'s preview or the export it counts, a body naming another profile is refused, the home context header is ignored, a token minted for alice fails for bob, and no inspect writes an operations row',
  'POST /api/privacy/exports': 'routesPrivacyExport: every statement on an owned table is scoped to the caller and the fingerprint is the verified caller\'s, so bob\'s markers never reach alice\'s file; a home-context header is ignored; bob\'s review token is the 409 review_changed with no ledger row; the reconcile rebuild (GET /api/operations, routesOperations) reads only the caller\'s rows and another household\'s export id is the identical 404; without the review key or before 0024 the answer is feature_unavailable with no claim',
  'POST /api/privacy/clear': 'routesPrivacyClear, routesPrivacyClearDb: the fingerprint and the clear function are called with the verified caller\'s id only, so a query naming another household and a home-context header change nothing, every other statement is scoped to the caller on the query itself, and a clear leaves the other household byte-identical in every owned table (on the real 0024 function); another household\'s review token is the 409 review_changed and touches neither household, and another household\'s operation id is the identical operation_mismatch and leaves its ledger row as it was; without the review key or before 0024 or 0017 the answer is feature_unavailable with no claim',
  'GET /api/profile': 'isolation: read matrix, identity-from-token',
  'PATCH /api/profile': 'isolation: only the caller\'s profile and home change, id in the body ignored, with and without the 0016 functions',
  'POST /api/push/subscribe': 'flows: a foreign endpoint is not taken over and the answer matches a fresh success',
  'DELETE /api/push/subscribe': 'flows: a foreign endpoint is not removed and the answer matches a missing endpoint',
  'GET /api/settings': 'routesSettings: every statement is scoped to the caller on the query itself, each household reads only its own values and revision, a profile_id in the query changes nothing, and unresolvedOperations lists only the caller\'s own pending settings operations',
  'PATCH /api/settings': 'routesSettings: a save writes only the caller\'s rows and every statement is scoped to the caller, a body naming another profile is refused and a query naming one is ignored, another household\'s revision or operation id gains nothing, and the other household is byte for byte unchanged',
  'GET /api/sources': 'isolation: read matrix (newest reading is the caller\'s)',
  'GET /api/volunteer': 'isolation: read matrix (county from the caller\'s profile)',
  'GET /api/week/changes': 'routesWeekChanges: only the ledger is touched, every statement scoped to the caller on the query itself, and only the caller\'s own pending week-updates operations are listed (another household\'s, a settled one and another domain\'s are not); a query or home-context header naming another household changes nothing; before 0017 the answer is feature_unavailable rather than an empty list',
  'POST /api/week/changes/acknowledge': 'routesWeekChanges: no task table is read, so the caller\'s task id, another household\'s and one that never existed answer identically apart from the operation id; the ledger row is owned by the caller and holds a reason code only; a body naming another profile is refused with no row claimed; another household\'s operation id is the identical operation_mismatch and leaves their row as it was',
};

const WHO = ['alice', 'bob'];
const upper = (who) => who.toUpperCase();
const NOTIFICATION_TYPES = ['air_quality_change', 'weather_advisory', 'new_water_results', 'radon_season', 'season_summary'];

/** Each read route: what the household's own response must contain, so "no leak" is never vacuous. */
const READS = [
  {
    name: 'GET /api/profile',
    route: '/api/profile',
    own: (who) => [PROFILE[who].county, PROFILE[who].pwsid, PROFILE[who].onboard_request_id, String(PROFILE[who].lat)],
    check: (body, who) => assert.deepEqual([body.household_set, body.profile.zip, body.household.has_toddler], [true, PROFILE[who].zip, who === 'bob']),
  },
  {
    name: 'GET /api/household',
    route: '/api/household',
    own: () => [],
    check: (body, who) => {
      assert.deepEqual(Object.entries(body.household).filter(([, on]) => on).map(([key]) => key).sort(), Object.keys(BANDS[who]).sort());
      assert.deepEqual([body.renter_mode, body.locale], [PROFILE[who].renter_mode, PROFILE[who].locale]);
    },
  },
  {
    name: 'GET /api/history',
    route: '/api/history?days=90',
    own: () => [],
    check: (body, who, ctx) => {
      const mine = ctx.rows.daily_scores.filter((row) => row.profile_id === ctx.id(who) && row.date >= addDays(ctx.today, -89));
      assert.deepEqual(body.history.map((day) => day.date), mine.map((row) => row.date).sort());
      assert.deepEqual(body.history.map((day) => day.values.aqi), [...mine].sort((a, b) => (a.date < b.date ? -1 : 1)).map((row) => row.aqi));
    },
  },
  {
    name: 'GET /api/home-contexts',
    route: '/api/home-contexts',
    own: (who) => [PROFILE[who].county, contextId(who, 1)],
    check: (body, who) => {
      assert.deepEqual([body.current_id, body.count, body.truncated], [contextId(who, 1), 1, false]);
      assert.deepEqual(body.items.map((item) => [item.id, item.location.county, item.water_source]), [[contextId(who, 1), PROFILE[who].county, PROFILE[who].water_source]]);
    },
  },
  {
    name: 'GET /api/journal',
    route: '/api/journal',
    own: (who) => [`${upper(who)}-NOTE-MARKER`, `${upper(who)}-COUGH-MARKER`],
    check: (body, who, ctx) => {
      const mine = ctx.rows.symptom_logs.filter((row) => row.profile_id === ctx.id(who) && row.entry_date >= addDays(ctx.today, -89));
      assert.deepEqual(body.entries.map((entry) => entry.id).sort(), mine.map((row) => row.id).sort());
      assert.ok(body.entries.every((entry) => entry.profile_id === ctx.id(who)));
    },
  },
  {
    name: 'GET /api/journal/findings',
    route: '/api/journal/findings',
    own: () => [],
    // bob has enough history to be "ready", alice does not: pooled rows would flip alice to ready.
    check: (body, who) => assert.deepEqual([body.ready, body.flaggedDays > 0], [who === 'bob', true]),
  },
  {
    name: 'GET /api/journal/summary',
    route: '/api/journal/summary?season=spring&year=2025',
    own: () => [],
    check: (body, who) => {
      assert.equal(body.logged_days, who === 'alice' ? 2 : 6);
      assert.ok(body.statement.startsWith(`This spring you logged ${body.logged_days} days.`), body.statement);
    },
  },
  {
    name: 'GET /api/alerts',
    route: '/api/alerts',
    own: (who) => [`${upper(who)}-ALERT-TITLE one`, `${upper(who)}-ALERT-MESSAGE two`],
    check: (body, who, ctx) => {
      assert.deepEqual(body.alerts.map((alert) => alert.id), [alertId(who, 1), alertId(who, 2)]); // the dismissed one is not listed
      assert.deepEqual([body.count, body.unread], [2, 1]);
      assert.ok(body.alerts.every((alert) => alert.profile_id === ctx.id(who)));
      assert.ok(!JSON.stringify(body.alerts).includes(`${upper(who)}-DISMISSED-MARKER`), 'the legacy list leaves the dismissed one out');
      // The contract inbox (B04 Task 2b) keeps the caller's dismissed alert,
      // because Undo re-selects it; it is the caller's own row, not a leak.
      assert.deepEqual(body.items.map((item) => [item.id, item.dismissed]), [[alertId(who, 1), false], [alertId(who, 2), false], [alertId(who, 3), true]]);
      assert.deepEqual(body.unresolvedOperations, [], 'the seeded operation is settled and in another domain');
    },
  },
  {
    name: 'GET /api/notifications',
    route: '/api/notifications',
    own: () => [],
    check: (body, who) => {
      const expected = Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, PREFS[who][type] ?? true]));
      assert.deepEqual(body.preferences, expected);
    },
  },
  {
    name: 'GET /api/home-guard',
    route: '/api/home-guard',
    own: (who) => [UTILITY[who].pws_name],
    check: (body, who) => assert.deepEqual([body.water.pws_name, body.radon.county], [UTILITY[who].pws_name, PROFILE[who].county]),
  },
  {
    name: 'GET /api/daily-score (cached reading)',
    route: '/api/daily-score',
    omitProfileId: true, // the one param this route answers with 403, see the next test
    own: (who) => [`${upper(who)}-POLLUTANT-MARKER`],
    check: (body, who) => assert.deepEqual([body.cached, body.air.aqi, body.air.source], [true, who === 'alice' ? 47 : 163, who === 'alice' ? 'airnow' : 'open-meteo']),
  },
  {
    name: 'GET /api/sources',
    route: '/api/sources',
    own: () => [],
    check: (body, who, ctx) => {
      const today = ctx.rows.daily_scores.find((row) => row.profile_id === ctx.id(who) && row.date === ctx.today);
      const meteo = body.sources.find((source) => source.name === 'Open-Meteo');
      assert.equal(meteo.last_retrieved, new Date(today.created_at).toISOString()); // bob's newer reading never counts for alice
    },
  },
  {
    name: 'GET /api/learn',
    route: '/api/learn?topic=pfas',
    own: () => [],
    check: (body, who) => assert.equal(body.household_note, LEARN_CONTENT.pfas.household[who === 'alice' ? 'has_pregnant' : 'has_toddler']),
  },
  {
    name: 'GET /api/volunteer',
    route: '/api/volunteer',
    own: (who) => [`${PROFILE[who].county} Water Watch`],
    check: (body, who) => assert.deepEqual([body.county, body.orgs.map((org) => org.name)], [PROFILE[who].county, [`${PROFILE[who].county} Water Watch`]]),
  },
  {
    name: 'GET /api/district',
    route: '/api/district',
    own: () => [],
    check: (body, who) => {
      assert.equal(body.household_county.county, PROFILE[who].county);
      assert.ok(!('county_rankings' in body), 'the statewide ranking stays server side');
      assert.equal(body.household_county.water_rank, who === 'alice' ? 12 : 41);
    },
  },
  { name: 'GET /api/assistant (suggestions)', route: '/api/assistant?page=today', own: () => [], check: (body) => assert.ok(body.suggestions.length > 0) },
  { name: 'GET /api/map', route: '/api/map?layer=water', own: () => [], check: (body) => assert.equal(body.prebuilt, true) },
  { name: 'GET /api/health', route: '/api/health', own: () => [], check: (body) => assert.ok(Array.isArray(body.checks)) },
];

/** Every way a client might try to name someone else: query params and the headers proxies and gateways add. */
const identityJunk = (victimId, { omitProfileId = false } = {}) => ({
  query: new URLSearchParams({
    user_id: victimId, id: victimId, userId: victimId, owner_id: victimId, ...(omitProfileId ? {} : { profile_id: victimId }),
  }).toString(),
  headers: {
    'x-user-id': victimId, 'x-profile-id': victimId, 'x-forwarded-user': victimId, 'x-supabase-user-id': victimId, 'x-hasura-user-id': victimId,
  },
});
const withQuery = (route, query) => `${route}${route.includes('?') ? '&' : '?'}${query}`;

for (const read of READS) {
  test(`${read.name}: each household sees its own data and none of the other's, in any field`, async (t) => {
    quiet(t);
    const ctx = setup();
    for (const who of WHO) {
      const sentBefore = ctx.outbound.length;
      const res = await ctx.call(who, read.route.split('?')[0], 'GET', { url: read.route });
      assert.equal(res.status, 200, `${who}`);
      const body = await res.json();
      const text = JSON.stringify(body);

      ctx.assertNoLeak(who, text, `${read.name} as ${who}`, sentBefore);
      for (const marker of read.own(who)) assert.ok(text.includes(marker), `${who}'s own ${marker} is missing, so the check proves nothing`);
      read.check(body, who, ctx);
    }
  });

  test(`${read.name}: ids in the query, body-style params and x-user-id style headers never change whose rows are read`, async (t) => {
    quiet(t);
    const ctx = setup();
    for (const who of WHO) {
      const victim = ctx.id(OTHER[who]);
      const baseline = await (await ctx.call(who, read.route.split('?')[0], 'GET', { url: read.route })).json();
      const sentBefore = ctx.outbound.length;

      const { query, headers } = identityJunk(victim, { omitProfileId: read.omitProfileId });
      const res = await ctx.call(who, read.route.split('?')[0], 'GET', { url: withQuery(read.route, query), headers });
      assert.equal(res.status, 200);
      const body = await res.json();

      ctx.assertNoLeak(who, body, `${read.name} as ${who} with ${OTHER[who]}'s id supplied`, sentBefore);
      if (read.name !== 'GET /api/health') assert.deepEqual(stable(body), stable(baseline)); // identical to the call without the extras
    }
  });
}

test('GET /api/daily-score and POST /api/onboard answer 403 to another household\'s profile_id and touch nothing', async (t) => {
  quiet(t);
  const ctx = setup();
  const bob = ctx.id('bob');
  const sentBefore = ctx.outbound.length;
  const queriesBefore = ctx.h.db.queryLog.length;

  const score = await ctx.call('alice', '/api/daily-score', 'GET', { url: `/api/daily-score?profile_id=${bob}` });
  assert.equal(score.status, 403);
  assert.equal((await score.json()).error, 'That profile does not belong to this session.');

  const onboard = await ctx.call('alice', '/api/onboard', 'POST', { body: { address: '1 Test Way', profile_id: bob, water_source: 'well' } });
  assert.equal(onboard.status, 403);
  assert.equal((await onboard.json()).error, 'That profile does not belong to this session.');

  assert.equal(ctx.outbound.length, sentBefore, 'no provider was called on behalf of the refused request');
  assert.deepEqual(ctx.h.db.queryLog.slice(queriesBefore).filter((query) => query.operation !== 'select'), [], 'nothing was written');
});

// ---- Mutations ----

const snapshot = (ctx, tables) => Object.fromEntries(tables.map((table) => [table, ctx.h.db.rows(table)]));
const bobsRows = (ctx, tables) => Object.fromEntries(tables.map((table) => [table, ctx.rowsOf(table, 'bob')]));
const OWNED = Object.keys(OWNED_TABLES);

test('DELETE /api/journal: another household\'s entry id deletes nothing and looks exactly like an id that does not exist', async () => {
  const ctx = setup();
  const bobsEntry = entryId('bob', 1);
  const before = bobsRows(ctx, OWNED);

  const foreign = await ctx.call('alice', '/api/journal', 'DELETE', { url: `/api/journal?id=${bobsEntry}` });
  const missing = await ctx.call('alice', '/api/journal', 'DELETE', { url: `/api/journal?id=${MISSING_ID}` });
  assert.deepEqual([foreign.status, await foreign.json()], [200, { deleted: 0 }]);
  assert.deepEqual([missing.status, await missing.json()], [200, { deleted: 0 }]);
  assert.equal(foreign.headers.get('content-type'), missing.headers.get('content-type'));
  assert.deepEqual(bobsRows(ctx, OWNED), before);

  // the same id as bob's own delete does work: the row was there to be taken
  const own = await ctx.call('bob', '/api/journal', 'DELETE', { url: `/api/journal?id=${bobsEntry}` });
  assert.deepEqual(await own.json(), { deleted: 1 });
});

test('DELETE /api/journal?all=true removes only the caller\'s rows, and an id param next to it changes nothing', async () => {
  const ctx = setup();
  const aliceBefore = ctx.rowsOf('symptom_logs', 'alice').length;
  const bobBefore = ctx.rowsOf('symptom_logs', 'bob');
  assert.ok(aliceBefore > 0 && bobBefore.length > 0);

  const res = await ctx.call('alice', '/api/journal', 'DELETE', { url: `/api/journal?all=true&id=${entryId('bob', 1)}&profile_id=${ctx.id('bob')}` });
  assert.deepEqual(await res.json(), { deleted: aliceBefore });
  assert.deepEqual(ctx.rowsOf('symptom_logs', 'alice'), []);
  assert.deepEqual(ctx.rowsOf('symptom_logs', 'bob'), bobBefore);
});

test('POST /api/journal writes a row owned by the caller even when the body names the other household, its id and its entry', async () => {
  const ctx = setup();
  const bobsEntry = ctx.rows.symptom_logs.find((row) => row.id === entryId('bob', 1));
  const before = bobsRows(ctx, OWNED);

  const res = await ctx.call('alice', '/api/journal', 'POST', {
    body: {
      entry_date: bobsEntry.entry_date, band: bobsEntry.band, symptoms: ['alice-new-symptom'], severity: 'bad', note: 'alice wrote this',
      profile_id: ctx.id('bob'), user_id: ctx.id('bob'), id: bobsEntry.id,
    },
  });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.profile_id, ctx.id('alice'));
  assert.notEqual(entry.id, bobsEntry.id);
  assert.deepEqual(entry.symptoms, ['alice-new-symptom']);

  assert.deepEqual(bobsRows(ctx, OWNED), before, 'bob\'s rows are byte for byte what they were');
  assert.equal(ctx.h.db.rows('symptom_logs').filter((row) => row.entry_date === bobsEntry.entry_date && row.band === bobsEntry.band).length, 2);
});

test('POST /api/journal/retrospective is read only, ignores a profile_id in the body, and sums only the caller\'s days', async () => {
  const ctx = setup();
  const dates = ctx.rows.daily_scores.filter((row) => row.profile_id === ctx.id('bob') && row.date < ctx.today).slice(0, 3).map((row) => row.date);
  const before = snapshot(ctx, OWNED);

  const plain = await (await ctx.call('alice', '/api/journal/retrospective', 'POST', { body: { dates } })).json();
  const framed = await ctx.call('alice', '/api/journal/retrospective', 'POST', { body: { dates, profile_id: ctx.id('bob'), user_id: ctx.id('bob') } });
  assert.equal(framed.status, 200);
  const body = await framed.json();
  ctx.assertNoLeak('alice', body, 'POST /api/journal/retrospective');
  assert.deepEqual(body, plain);
  assert.deepEqual(snapshot(ctx, OWNED), before, 'the route wrote nothing');
});

for (const transactional of [false, true]) {
  test(`PUT /api/household changes only the caller's rows, whatever ids the body carries (${transactional ? 'save_household' : 'two-step write before 0015'})`, async (t) => {
    quiet(t); // the two-step path warns once that save_household is missing
    const ctx = setup();
    if (transactional) registerSaveHousehold(ctx.h.db);
    const before = bobsRows(ctx, OWNED);
    const res = await ctx.call('alice', '/api/household', 'PUT', {
      body: { has_toddler: true, has_senior: false, renter_mode: true, locale: 'es', profile_id: ctx.id('bob'), id: ctx.id('bob'), user_id: ctx.id('bob'), p_profile_id: ctx.id('bob') },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).transactional, transactional);

    const [band] = ctx.rowsOf('household_bands', 'alice');
    assert.deepEqual([band.has_toddler, band.has_senior, band.has_pregnant], [true, false, false]);
    const [profile] = ctx.rowsOf('profiles', 'alice');
    assert.deepEqual([profile.renter_mode, profile.locale], [true, 'es']);
    assert.deepEqual(bobsRows(ctx, OWNED), before);
    assert.equal(ctx.h.db.rows('household_bands').length, 2);
    assert.ok(ctx.h.db.rpcCalls.every((call) => call.args.p_profile_id === ctx.id('alice')), 'save_household only ever got the caller\'s id');
  });
}

for (const withFunctions of [false, true]) {
  test(`PATCH /api/profile changes only the caller's profile and home, whatever id the body carries (${withFunctions ? 'through the home context' : 'before 0016\'s functions'})`, async (t) => {
    quiet(t); // without the functions the route warns once that they are missing
    const ctx = setup();
    if (withFunctions) registerHomeContextRpcs(ctx.h.db);
    const before = bobsRows(ctx, OWNED);
    const res = await ctx.call('alice', '/api/profile', 'PATCH', {
      body: {
        water_source: 'well', home_year: 1950, id: ctx.id('bob'), profile_id: ctx.id('bob'), county: 'Injected County', pwsid: 'NC0000000',
        p_profile_id: ctx.id('bob'), p_context_id: contextId('bob', 1),
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    ctx.assertNoLeak('alice', body, 'PATCH /api/profile');
    const [profile] = ctx.rowsOf('profiles', 'alice');
    assert.deepEqual([profile.water_source, profile.home_year], ['well', 1950]);
    assert.deepEqual([profile.county, profile.pwsid], [PROFILE.alice.county, PROFILE.alice.pwsid]); // only the two documented fields are accepted
    const [home] = ctx.rowsOf('home_contexts', 'alice');
    assert.deepEqual([home.revision, home.water_source, home.home_year], withFunctions ? [2, 'well', 1950] : [1, PROFILE.alice.water_source, PROFILE.alice.home_year]);
    assert.equal(body.home_context?.id, withFunctions ? contextId('alice', 1) : undefined);
    assert.deepEqual(bobsRows(ctx, OWNED), before);
    assert.equal(ctx.h.db.rows('profiles').length, 2);
    assert.ok(ctx.h.db.rpcCalls.length > 0 && ctx.h.db.rpcCalls.every((call) => call.args.p_profile_id === ctx.id('alice') && call.args.p_context_id === contextId('alice', 1)));
  });
}

test('GET and PATCH /api/home-contexts/[id]: another household\'s context is the identical 404 to a missing one, and nothing changes', async () => {
  const ctx = setup();
  registerHomeContextRpcs(ctx.h.db);
  const route = '/api/home-contexts/[id]';
  const at = (id) => ({ url: `/api/home-contexts/${id}`, params: { id } });
  const comparable = async (res) => {
    const body = await res.json();
    delete body.request_id;
    return { status: res.status, body, headers: [...res.headers.entries()].filter(([name]) => name !== 'x-request-id') };
  };
  const before = snapshot(ctx, OWNED);
  for (const who of WHO) {
    const victim = contextId(OTHER[who], 1);
    const foreignRead = await ctx.call(who, route, 'GET', at(victim));
    const missingRead = await ctx.call(who, route, 'GET', at(MISSING_ID));
    const foreignWrite = await ctx.call(who, route, 'PATCH', { ...at(victim), body: { expected_revision: 1, water_source: 'well' } });
    const missingWrite = await ctx.call(who, route, 'PATCH', { ...at(MISSING_ID), body: { expected_revision: 1, water_source: 'well' } });
    assert.equal(foreignRead.status, 404);
    const expected = await comparable(missingRead);
    for (const res of [foreignRead, foreignWrite, missingWrite]) {
      const seen = await comparable(res);
      assert.deepEqual(seen, expected, `${who}: a foreign id is indistinguishable from a missing one`);
      ctx.assertNoLeak(who, seen.body, `${who} on ${OTHER[who]}'s home`);
    }
  }
  assert.deepEqual(snapshot(ctx, OWNED), before, 'no household\'s rows changed');
  assert.ok(ctx.h.db.rpcCalls.every((call) => [ctx.id('alice'), ctx.id('bob')].includes(call.args.p_profile_id)));

  // the owner's own call does find and change it: the rows were there
  const own = await ctx.call('bob', route, 'PATCH', { ...at(contextId('bob', 1)), body: { expected_revision: 1, water_source: 'well' } });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).context.revision, 2);
});

test('PUT /api/notifications changes only the caller\'s preferences; a profile_id or an unknown key cannot redirect it', async () => {
  const ctx = setup();
  const before = bobsRows(ctx, OWNED);

  const ok = await ctx.call('alice', '/api/notifications', 'PUT', { body: { preferences: { season_summary: false }, profile_id: ctx.id('bob') } });
  assert.equal(ok.status, 200);
  assert.deepEqual([ctx.rowsOf('notification_prefs', 'alice')[0].season_summary, ctx.rowsOf('notification_prefs', 'alice')[0].weather_advisory], [false, false]);
  assert.deepEqual(bobsRows(ctx, OWNED), before);

  const smuggled = await ctx.call('alice', '/api/notifications', 'PUT', { body: { preferences: { profile_id: ctx.id('bob'), air_quality_change: true } } });
  assert.equal(smuggled.status, 400);
  assert.deepEqual(bobsRows(ctx, OWNED), before);
});

test('POST /api/alerts: marking, dismissing and un-dismissing another household\'s alert changes nothing and looks like a missing id', async () => {
  const ctx = setup();
  const before = bobsRows(ctx, OWNED);
  const cases = [
    { name: 'mark read', body: (id) => ({ id }) },
    { name: 'dismiss', body: (id) => ({ id, dismissed: true }) },
    { name: 'undo dismiss', body: (id) => ({ id, dismissed: false }) },
  ];
  for (const { name, body } of cases) {
    const foreign = await ctx.call('alice', '/api/alerts', 'POST', { body: body(alertId('bob', 1)) });
    const missing = await ctx.call('alice', '/api/alerts', 'POST', { body: body(MISSING_ID) });
    assert.equal(foreign.status, missing.status, name);
    assert.deepEqual(await foreign.json(), await missing.json(), name);
    assert.deepEqual(bobsRows(ctx, OWNED), before, `${name} must leave bob's rows alone`);
  }
  // and the same body from the owner does change the row
  const own = await ctx.call('bob', '/api/alerts', 'POST', { body: { id: alertId('bob', 1) } });
  assert.deepEqual(await own.json(), { ok: true, updated: 1 });
});

test('POST /api/alerts {all:true} marks only the caller\'s alerts read, and a body id or profile_id does not widen it', async () => {
  const ctx = setup();
  const before = bobsRows(ctx, OWNED);
  const unread = ctx.rowsOf('alerts', 'alice').filter((alert) => alert.read === false).length;
  assert.ok(unread > 0 && bobsRows(ctx, OWNED).alerts.some((alert) => alert.read === false), 'both households have something to mark');

  const res = await ctx.call('alice', '/api/alerts', 'POST', { body: { all: true, profile_id: ctx.id('bob'), id: alertId('bob', 1) } });
  assert.deepEqual(await res.json(), { ok: true, updated: unread });
  assert.ok(ctx.rowsOf('alerts', 'alice').every((alert) => alert.read === true));
  assert.deepEqual(bobsRows(ctx, OWNED), before);
});

test('a request with a junk or foreign-looking token never reaches household data', async () => {
  const ctx = setup();
  const before = snapshot(ctx, OWNED);
  const attempts = [
    { authorization: `Bearer ${ctx.id('bob')}` }, // an id is not a credential
    { authorization: 'Bearer test-token:mallory' },
    { authorization: `Bearer ${ctx.h.identities.bob.token}x` },
  ];
  for (const headers of attempts) {
    for (const [route, method] of [['/api/profile', 'GET'], ['/api/journal', 'GET'], ['/api/alerts', 'GET'], ['/api/journal', 'DELETE']]) {
      const res = await ctx.h.call(route, method, { headers, url: `${route}?all=true&user_id=${ctx.id('bob')}` });
      assert.equal(res.status, 401, `${method} ${route}`);
      ctx.assertNoLeak('alice', await res.json(), `${method} ${route} with ${headers.authorization}`);
    }
  }
  assert.deepEqual(ctx.h.db.queryLog, [], 'a rejected token is answered before any table is queried');
  assert.deepEqual(snapshot(ctx, OWNED), before);
});

test('the owner-scope audit itself rejects an unscoped read, a foreign write and a delete with no owner filter', async () => {
  const { auditOwnerScope } = await import('./helpers/isolationKit.mjs');
  const alice = 'u-alice';
  const scoped = { type: 'cmp', op: 'eq', column: 'profile_id', value: alice };

  auditOwnerScope([{ table: 'alerts', operation: 'select', filters: [scoped], rows: [] }, { table: 'ucmr5_utilities', operation: 'select', filters: [], rows: [] }], alice);
  auditOwnerScope([{ table: 'alerts', operation: 'upsert', filters: [], rows: [{ profile_id: alice }] }], alice);
  assert.throws(() => auditOwnerScope([{ table: 'alerts', operation: 'select', filters: [], rows: [] }], alice), /not filtered by profile_id/);
  assert.throws(() => auditOwnerScope([{ table: 'alerts', operation: 'delete', filters: [{ ...scoped, value: 'u-bob' }], rows: [] }], alice), /not filtered by profile_id/);
  assert.throws(() => auditOwnerScope([{ table: 'alerts', operation: 'delete', filters: [{ ...scoped, op: 'neq' }], rows: [] }], alice), /not filtered/);
  assert.throws(() => auditOwnerScope([{ table: 'push_subscriptions', operation: 'upsert', filters: [], rows: [{ profile_id: 'u-bob' }] }], alice), /owned by someone else/);
  assert.throws(() => auditOwnerScope([{ table: 'profiles', operation: 'update', filters: [scoped], rows: [] }], alice), /not filtered by id/);
});

// ---- Completeness: the suite cannot quietly fall behind the app ----

test('every route and method under app/api has isolation coverage listed in ROUTE_COVERAGE, and nothing stale is listed', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.js') {
        const route = `/${path.relative(path.join(REPO_ROOT, 'app'), path.dirname(full)).split(path.sep).join('/')}`;
        for (const match of readFileSync(full, 'utf8').matchAll(/^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gm)) {
          found.push(`${match[1]} ${route}`);
        }
      }
    }
  };
  walk(path.join(REPO_ROOT, 'app/api'));
  assert.ok(found.length >= 30, `expected the app's routes, found ${found.length}`);
  assert.deepEqual(found.sort(), Object.keys(ROUTE_COVERAGE).sort());
});

test('the seed gives both households rows in every owned table, so no check is vacuous', () => {
  const ctx = setup();
  for (const table of Object.keys(OWNED_TABLES)) {
    for (const who of WHO) assert.ok(ctx.rowsOf(table, who).length > 0, `${table} has no rows for ${who}`);
  }
});
