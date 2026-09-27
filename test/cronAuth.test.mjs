import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCronAuthorized, presentedSecrets } from '../lib/cronAuth.js';

const URL_BASE = 'https://halo.test/api/cron/daily';
const h = (obj = {}) => new Headers(obj);

test('accepts the Vercel Cron form: Authorization: Bearer <secret>', () => {
  assert.equal(isCronAuthorized(h({ authorization: 'Bearer s3cret' }), URL_BASE, 's3cret'), true);
});

test('accepts x-cron-secret header and ?secret= query', () => {
  assert.equal(isCronAuthorized(h({ 'x-cron-secret': 's3cret' }), URL_BASE, 's3cret'), true);
  assert.equal(isCronAuthorized(h(), `${URL_BASE}?secret=s3cret`, 's3cret'), true);
});

test('rejects a wrong secret in every form', () => {
  assert.equal(isCronAuthorized(h({ authorization: 'Bearer nope' }), URL_BASE, 's3cret'), false);
  assert.equal(isCronAuthorized(h({ 'x-cron-secret': 'nope' }), URL_BASE, 's3cret'), false);
  assert.equal(isCronAuthorized(h(), `${URL_BASE}?secret=nope`, 's3cret'), false);
});

test('rejects a missing secret', () => {
  assert.equal(isCronAuthorized(h(), URL_BASE, 's3cret'), false);
});

test('fails closed when CRON_SECRET is not configured', () => {
  assert.equal(isCronAuthorized(h({ authorization: 'Bearer anything' }), URL_BASE, undefined), false);
  assert.equal(isCronAuthorized(h({ authorization: 'Bearer ' }), URL_BASE, ''), false);
});

test('a non-Bearer Authorization header is not treated as the secret', () => {
  assert.deepEqual(presentedSecrets(h({ authorization: 'Basic s3cret' }), URL_BASE), []);
  assert.equal(isCronAuthorized(h({ authorization: 'Basic s3cret' }), URL_BASE, 's3cret'), false);
});

test('length-mismatched secrets are rejected without throwing', () => {
  assert.equal(isCronAuthorized(h({ 'x-cron-secret': 's3' }), URL_BASE, 's3cret'), false);
});

test('an unrelated Bearer token does not shadow a valid ?secret= or header', () => {
  const userJwt = { authorization: 'Bearer eyJhbGciOi.user.session' };
  assert.equal(isCronAuthorized(h(userJwt), `${URL_BASE}?secret=s3cret`, 's3cret'), true);
  assert.equal(isCronAuthorized(h({ ...userJwt, 'x-cron-secret': 's3cret' }), URL_BASE, 's3cret'), true);
  assert.equal(isCronAuthorized(h(userJwt), `${URL_BASE}?secret=wrong`, 's3cret'), false);
});
