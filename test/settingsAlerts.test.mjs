/**
 * The one way the settings and alerts surfaces degrade before migration 0021
 * is applied (B04 plan, Task 1).
 *
 * Both surfaces in this package need 0021: settings needs
 * public.profile_preferences and profiles.tenure, alerts needs the revision,
 * category and target columns. Four routes read them, written by two parallel
 * tasks, and if each invented its own answer they would disagree about what a
 * half-applied schema means. So there is one predicate and one response, the
 * way lib/operations.js does it for the ledger, lib/account.js for the
 * recovery schema and lib/luna.js for Luna's tables.
 *
 * A missing COLUMN counts as unavailable, not as something to work around.
 * Without profiles.tenure the settings snapshot cannot say whether the
 * household owns or rents, and guessing from renter_mode would report 'owner'
 * for an 'other'. Without alerts.revision there is no optimistic-concurrency
 * contract at all, so a patch could silently overwrite a newer change.
 * Answering "unavailable" is the only truthful option in both cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // module hooks first, so lib files load as ESM

const settingsAlerts = await import('../lib/settingsAlerts.js');

const REQUEST_ID = '11111111-2222-4333-8444-555555555555';

test('both surfaces degrade the same way until 0021 is applied, for a missing table or a missing column', () => {
  for (const code of ['PGRST205', '42P01', 'PGRST204', '42703']) {
    assert.equal(settingsAlerts.isSettingsAlertsUnavailable({ code }), true, code);
  }
  for (const error of [null, undefined, {}, { code: '23505' }, { code: '23514' }, { code: 'PGRST116' }, new Error('nope')]) {
    assert.equal(settingsAlerts.isSettingsAlertsUnavailable(error), false, JSON.stringify(error));
  }
});

test('the response is one non-retryable 503, so nothing invites a retry that cannot help', () => {
  const response = settingsAlerts.settingsAlertsUnavailable(REQUEST_ID);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), null, 'retrying cannot help, so nothing invites it');
  assert.equal(response.headers.get('X-Request-Id'), REQUEST_ID);
});

test('the unavailable body names the feature, carries no provider detail and no em dash', async () => {
  const body = await settingsAlerts.settingsAlertsUnavailable(REQUEST_ID).json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal(body.retryable, false);
  assert.ok(body.error && body.error.length > 0, 'there is a sentence to show');
  assert.equal(body.error.includes('—'), false, 'no em dash in app-facing copy');
  assert.equal(
    /supabase|postgres|pgrst|relation|column|profile_preferences|tenure/i.test(JSON.stringify(body)),
    false,
    'nothing about the database leaves',
  );
});

test('every caller gets the identical sentence, because one helper writes it', async () => {
  const first = await settingsAlerts.settingsAlertsUnavailable(REQUEST_ID).json();
  const second = await settingsAlerts.settingsAlertsUnavailable('99999999-8888-4777-8666-555555555555').json();
  assert.equal(first.error, second.error);
  assert.equal(first.message, second.message);
});
