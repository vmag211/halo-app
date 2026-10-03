import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { setup } from './helpers/isolationKit.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { localDate } from './helpers/isolationSeed.mjs';

const { lastEndedSeason, seasonRange } = await import('../lib/journalRetro.js');

const findings = (ctx, who = 'bob', url = '/api/journal/findings') => ctx.h.call('/api/journal/findings', 'GET', { as: who, url });
const summary = (ctx, query = '', who = 'alice') => ctx.h.call('/api/journal/summary', 'GET', { as: who, url: `/api/journal/summary${query}` });

// -------------------------------------------------------------- findings

test('findings legacy request: a household with enough data gets the old ready body, with the request id header', async () => {
  const ctx = setup();
  const res = await findings(ctx, 'bob');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.deepEqual(Object.keys(body).sort(), ['disclaimer', 'findings', 'flaggedDays', 'ready', 'totalDays']);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false);
});

test('findings legacy request: a household without enough data still gets the not-ready counts', async () => {
  const ctx = setup();
  const res = await findings(ctx, 'alice');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['flaggedDays', 'needed', 'ready', 'totalDays']);
  assert.equal(body.ready, false);
  assert.match(res.headers.get('x-request-id'), UUID);
});

test('findings reads no input: query values, even malformed ones, change nothing', async () => {
  const ctx = setup();
  const plain = await (await findings(ctx, 'bob')).json();
  const noisy = await findings(ctx, 'bob', '/api/journal/findings?from=garbage&days=-1&id=nope');
  assert.equal(noisy.status, 200);
  assert.deepEqual(await noisy.json(), plain);
});

test('findings: auth and database failures use the envelope; the database text stays in the log', async (t) => {
  const logged = muteConsoleError(t);
  const none = createRouteHarness({ tables: {} });
  const unauth = await expectEnvelope(await none.call('/api/journal/findings', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(unauth.error, 'Sign-in required.');
  const echoed = await none.call('/api/journal/findings', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });

  const res = await none.call('/api/journal/findings', 'GET', { as: 'alice' }); // no tables: PGRST205
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|symptom_logs|daily_scores|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

// --------------------------------------------------------------- summary

test('summary legacy request: season and year give the old recap body, with the request id header', async () => {
  const ctx = setup();
  const res = await summary(ctx, '?season=spring&year=2025');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['factor', 'from', 'logged_days', 'season', 'statement', 'to', 'year']);
  assert.deepEqual([body.season, body.year, body.logged_days], ['spring', 2025, 2]);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false);
});

test('summary with no query is the most recently ended season; an empty season or year counts as not given', async () => {
  const ctx = setup();
  const fallback = lastEndedSeason(localDate());
  for (const query of ['', '?season=&year=', '?season=', '?year=']) {
    const body = await (await summary(ctx, query)).json();
    assert.deepEqual([body.season, body.year], [fallback.season, fallback.year], query);
  }
  assert.equal((await (await summary(ctx, `?year=${fallback.year}`)).json()).from, seasonRange(fallback.season, fallback.year).from);
});

test('summary accepts the season in any case and the year with surrounding spaces', async () => {
  const ctx = setup();
  const body = await (await summary(ctx, '?season=SPRING&year=%202025%20')).json();
  assert.deepEqual([body.season, body.year], ['spring', 2025]);
});

const REJECTED = [
  ['an unknown season', '?season=monsoon&year=2025', [['season', 'invalid_option']]],
  ['text for the year', '?season=spring&year=abc', [['year', 'invalid_integer']]],
  ['a fractional year', '?season=spring&year=2025.5', [['year', 'invalid_integer']]],
  ['a year before 2000', '?season=spring&year=1999', [['year', 'integer_out_of_range']]],
  ['a year after 2100', '?season=spring&year=2101', [['year', 'integer_out_of_range']]],
  ['a hex year', '?season=spring&year=0x7e9', [['year', 'invalid_integer']]],
  ['a bad season and a bad year', '?season=x&year=y', [['season', 'invalid_option'], ['year', 'invalid_integer']]],
];

for (const [label, query, expected] of REJECTED) {
  test(`summary with ${label} is a 400 with field errors and reads nothing`, async () => {
    const ctx = setup();
    const before = ctx.h.db.queryLog.length;
    const body = await expectEnvelope(await summary(ctx, query), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(ctx.h.db.queryLog.length, before, 'nothing was read');
  });
}

test('summary: auth and database failures use the envelope; the database text stays in the log', async (t) => {
  const logged = muteConsoleError(t);
  const none = createRouteHarness({ tables: {} });
  await expectEnvelope(await none.call('/api/journal/summary', 'GET', {}), { status: 401, code: 'auth_required' });
  const echoed = await none.call('/api/journal/summary', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });

  const res = await none.call('/api/journal/summary', 'GET', { as: 'alice', url: '/api/journal/summary?season=spring&year=2025' });
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|symptom_logs|daily_scores|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
});
