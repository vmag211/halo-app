import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, quiet, stable } from './helpers/isolationKit.mjs';
import { PROFILE, UTILITY } from './helpers/isolationSeed.mjs';
import { OWNED_TABLES } from './helpers/tables.mjs';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const guard = (ctx, query = '', headers) => ctx.call('alice', '/api/home-guard', 'GET', { url: `/api/home-guard${query}`, headers });
const noCounty = { adjust: (rows, { alice }) => Object.assign(rows.profiles.find((p) => p.id === alice.id), { county: null }) };

test('legacy request: the stored home answers with every old field and a request id header', async (t) => {
  quiet(t);
  const ctx = setup();
  const res = await guard(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['action_plan', 'assembled_at', 'breakdown', 'lead', 'radon', 'score', 'success', 'water']);
  assert.equal(body.success, true);
  assert.equal(body.water.pws_name, UTILITY.alice.pws_name);
  assert.equal(body.radon.county, PROFILE.alice.county);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('legacy overrides (what lib/api.js getHomeGuard sends) still work and win over the stored answers', async (t) => {
  quiet(t);
  const ctx = setup();
  const query = `?county=${encodeURIComponent(PROFILE.bob.county)}&pwsid=${PROFILE.bob.pwsid}&water_source=${encodeURIComponent('City utility')}&home_year=1962`;
  const body = await (await guard(ctx, query)).json();
  assert.equal(body.radon.county, PROFILE.bob.county);
  assert.equal(body.water.pws_name, UTILITY.bob.pws_name);
  assert.notEqual(body.lead.level, (await (await guard(ctx)).json()).lead.level, 'the 1962 home year changed the lead estimate (alice\'s stored year is 1988)');

  const well = await (await guard(ctx, '?water_source=Well')).json();
  assert.equal(well.water.status, 'private_well');
  assert.equal(well.score.score, null);
});

test('blank and legacy placeholder overrides keep their old meaning', async (t) => {
  const { warn } = quiet(t);
  const ctx = setup();
  for (const query of ['?pwsid=null', '?pwsid=undefined', '?pwsid=']) {
    assert.equal((await (await guard(ctx, query)).json()).water.status, 'no_pwsid_available', query);
  }
  assert.equal((await (await guard(ctx, '?home_year=')).json()).lead.basis, 'unknown_year', 'a blank year replaces the stored one');
  const odd = await guard(ctx, '?water_source=banana');
  assert.equal(odd.status, 200, 'the normaliser keeps unrecognised text as "other" on purpose');
  assert.ok(warn.mock.callCount() > 0, 'and says so in the log');
});

const REJECTED = [
  ['a county over 100 characters', `county=${'c'.repeat(101)}`, [['county', 'text_too_long']]],
  ['a pwsid over 20 characters', `pwsid=${'N'.repeat(21)}`, [['pwsid', 'text_too_long']]],
  ['a pwsid that is not a water system id', 'pwsid=ABC', [['pwsid', 'invalid_pwsid']]],
  ['a lower case pwsid', 'pwsid=nc9990001', [['pwsid', 'invalid_pwsid']]],
  ['a pwsid carrying a filter expression', "pwsid=NC1'%20OR%20'1'='1", [['pwsid', 'invalid_pwsid']]],
  ['a water_source over 40 characters', `water_source=${'w'.repeat(41)}`, [['water_source', 'text_too_long']]],
  ['a home_year that is text', 'home_year=abc', [['home_year', 'invalid_home_year']]],
  ['a home_year with text after the number', 'home_year=1988abc', [['home_year', 'invalid_home_year']]],
  ['a home_year before 1700', 'home_year=1699', [['home_year', 'invalid_home_year']]],
  ['a home_year in the future', 'home_year=2999', [['home_year', 'invalid_home_year']]],
  ['a fractional home_year', 'home_year=1988.5', [['home_year', 'invalid_home_year']]],
  ['a state that is not two letters', 'state=North%20Carolina', [['state', 'invalid_state']]],
  ['an empty state', 'state=', [['state', 'invalid_state']]],
  ['several at once', 'home_year=x&state=Narnia&pwsid=zz&county=' + 'c'.repeat(101), [['county', 'text_too_long'], ['pwsid', 'invalid_pwsid'], ['state', 'invalid_state'], ['home_year', 'invalid_home_year']]],
];

for (const [label, query, expected] of REJECTED) {
  test(`${label} is a 400 with field errors, reads nothing and asks no provider`, async () => {
    const ctx = setup();
    const before = ctx.h.db.queryLog.length;
    const body = await expectEnvelope(await guard(ctx, `?${query}`), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(ctx.h.db.queryLog.length, before, 'nothing was read');
    assert.equal(ctx.outbound.length, 0);
  });
}

test('no county on file and none given keeps the old 400 sentence, in the envelope; an empty county override does too', async () => {
  const bare = setup({ seed: noCounty });
  const body = await expectEnvelope(await guard(bare), { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.error, 'No county on file. Finish onboarding, or pass the county parameter.');
  assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['county', 'county_required']]);

  const blank = await expectEnvelope(await guard(setup(), '?county='), { status: 400, code: 'validation_failed' });
  assert.equal(blank.field_errors[0].code, 'county_required');
});

test('a client request id is echoed; a missing session is a 401 envelope', async () => {
  const ctx = setup();
  const res = await guard(ctx, '?state=x', { 'x-request-id': 'client-trace-0001' });
  assert.equal((await expectEnvelope(res, { status: 400, code: 'validation_failed' })).request_id, 'client-trace-0001');
  const none = await expectEnvelope(await ctx.h.call('/api/home-guard', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const broken = createRouteHarness({ tables: haloTables('household_bands') }); // profiles missing: PGRST205
  const res = await broken.call('/api/home-guard', 'GET', { as: 'alice' });
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|profiles|PGRST|Could not read/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not read profile'));
});

test('overrides naming another household\'s place or id never read its private rows: the answer is the same as if that household did not exist', async (t) => {
  quiet(t);
  const bobsPlace = `?county=${encodeURIComponent(PROFILE.bob.county)}&pwsid=${PROFILE.bob.pwsid}&state=NC&profile_id=BOB&user_id=BOB&id=BOB`;
  const withBob = setup();
  const query = bobsPlace.replaceAll('BOB', withBob.id('bob'));
  const res = await guard(withBob, query); // ctx.call also audits that every owned-table query is filtered to alice
  assert.equal(res.status, 200);
  const body = await res.json();

  const alone = setup({
    seed: { adjust: (rows, { bob }) => { for (const [table, column] of Object.entries(OWNED_TABLES)) rows[table] = (rows[table] ?? []).filter((row) => row[column] !== bob.id); } },
  });
  assert.equal(alone.h.db.rows('profiles').some((row) => row.id === alone.id('bob')), false, 'the control household really has no bob');
  const control = await (await guard(alone, query)).json();
  assert.deepEqual(stable(body), stable(control), 'bob\'s rows changed nothing alice was told');

  const tables = new Set(withBob.h.db.queryLog.map((q) => q.table));
  assert.deepEqual([...tables].sort(), ['household_bands', 'profiles', 'ucmr5_utilities'].sort().filter((name) => tables.has(name)));
  assert.ok(!tables.has('symptom_logs') && !tables.has('daily_scores') && !tables.has('push_subscriptions') && !tables.has('home_risks'));
  const text = JSON.stringify(body);
  const bob = PROFILE.bob;
  for (const privateValue of [withBob.id('bob'), bob.zip, String(bob.lat), String(bob.lng), bob.onboard_request_id, 'BOB-HOME-RISK-MARKER']) {
    assert.ok(!text.includes(privateValue), `bob's ${privateValue} is not in alice's answer`);
  }
  assert.equal(body.water.pws_name, UTILITY.bob.pws_name, 'the water system named is public EPA reference data, as requested');
});
