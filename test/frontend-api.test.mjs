import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend, memoryStorage } from './frontend-test-loader.mjs';
const { createLiveOnboardingApi, withDeadline } = await loadFrontend('api');
const { emptyHousehold } = await loadFrontend('onboarding');
const { setCacheIdentity } = await loadFrontend('storage');
const location = { county: 'Cabarrus County', state: 'NC', lat: 35.4, lng: -80.5, pwsid: 'NC0112010', water_source: 'utility' };
const complete = { onboarding_complete: true, profile: location };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function setup(handler, options = {}) {
  let identity = 'test-user';
  let sessions = 0;
  const calls = [];
  const auth = {
    async ensureAnonSession() { sessions++; }, async getUserId() { return identity; },
    async authedFetch(url, init) { calls.push({ url, init }); return handler(url, init); },
  };
  const api = createLiveOnboardingApi({ loadAuth: async () => auth, ...options });
  return { api, calls, changeIdentity(value) { identity = value; }, sessions: () => sessions };
}

test('live methods use exact routes, plain headers, canonical body and no identity parameters', async () => {
  const { api, calls } = setup((url) => response(url === '/api/onboard' ? location : url === '/api/profile' ? complete : {}));
  await api.ensureSession();
  await api.getProfile();
  await api.submitAddress(' 28025 ');
  await api.saveHousehold({ ...emptyHousehold(), has_child: true });
  await api.saveHome({ water_source: 'not_sure', home_year: null });
  await Promise.all([api.getDaily(), api.getHome()]);
  assert.deepEqual(calls.map((call) => call.url), ['/api/profile', '/api/onboard', '/api/household', '/api/profile', '/api/daily-score', '/api/home-guard']);
  assert.deepEqual(JSON.parse(calls[1].init.body), { address: '28025' });
  assert.deepEqual(JSON.parse(calls[2].init.body), { ...emptyHousehold(), has_child: true });
  assert.deepEqual(JSON.parse(calls[3].init.body), { water_source: 'other', home_year: null });
  assert.ok(calls.every((call) => !(call.init.headers instanceof Headers)));
  assert.ok(calls.every((call) => !JSON.stringify(call).includes('profile_id')));
});
test('daily readings are parameterless by default and explicitly fresh after address replacement', async () => {
  const { api, calls } = setup(() => response({ air: { aqi: 20 } }));
  await api.getDaily();
  await api.getDaily(undefined, { fresh: false });
  await api.getDaily(undefined, { fresh: true });
  assert.deepEqual(calls.map((call) => call.url), ['/api/daily-score', '/api/daily-score', '/api/daily-score?fresh=1']);
  assert.ok(calls.every((call) => call.init.body === undefined));
});
test('fresh daily readings retain the slow deadline and daily-specific error mapping', async () => {
  const { api } = setup(() => new Promise((resolve) => setTimeout(() => resolve(response({ air: { aqi: 20 } })), 20)), { normalTimeoutMs: 1, slowTimeoutMs: 1000 });
  assert.equal((await api.getDaily(undefined, { fresh: true })).air.aqi, 20);
  for (const [status, code] of [[400, 'no_location'], [429, 'rate_limited'], [503, 'generic']]) {
    const { api: failing, sessions } = setup(() => response({ error: 'private server details' }, status));
    await assert.rejects(failing.getDaily(undefined, { fresh: true }), { code });
    assert.equal(sessions(), 0);
  }
});
test('status mapping never shows raw backend error strings', async () => {
  for (const [endpoint, status, code] of [
    ['address', 404, 'address_not_found'], ['address', 400, 'address_required'], ['address', 429, 'rate_limited'],
    ['address', 500, 'generic'], ['address', 503, 'generic'], ['profile', 401, 'signin_failed'],
    ['daily', 400, 'no_location'], ['home', 400, 'no_county'], ['daily', 429, 'rate_limited'],
  ]) {
    const { api, sessions } = setup(() => response({ error: 'database PASSWORD=private internal message' }, status));
    const action = endpoint === 'address' ? () => api.submitAddress('28025') : endpoint === 'profile' ? () => api.getProfile() : endpoint === 'daily' ? () => api.getDaily() : () => api.getHome();
    await assert.rejects(action, (error) => error.code === code && error.message === code && !error.message.includes('PASSWORD'));
    assert.equal(sessions(), 0, 'adapter must not reset or mint sessions on 503');
  }
});
test('auth failures preserve captcha/sign-in codes and no import happens at factory construction', async () => {
  let imports = 0;
  const api = createLiveOnboardingApi({ loadAuth: async () => { imports++; throw Object.assign(Error('private'), { code: 'captcha_failed' }); } });
  assert.equal(imports, 0);
  await assert.rejects(api.ensureSession(), { code: 'captcha_failed' });
  assert.equal(imports, 1);
});
test('timeouts cover hung auth, and cancellation does not issue a request', async () => {
  const api = createLiveOnboardingApi({ loadAuth: () => new Promise(() => {}), normalTimeoutMs: 5 });
  await assert.rejects(api.getProfile(), { code: 'timeout' });
  const { api: abortApi, calls } = setup(() => response({}));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(abortApi.getHome(controller.signal), { code: 'aborted' });
  assert.equal(calls.length, 0);
  await assert.rejects(withDeadline(() => new Promise(() => {}), 5), { code: 'timeout' });
});
test('abort propagates to transport and does not become a generic error', async () => {
  let capturedSignal;
  const { api } = setup((_url, init) => { capturedSignal = init.signal; return new Promise(() => {}); });
  const controller = new AbortController();
  const pending = api.getDaily(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(pending, { code: 'aborted' });
  assert.equal(capturedSignal.aborted, true);
});
test('onboard timeout reconciles only a known new profile', async () => {
  let profileReads = 0;
  const { api } = setup((url) => {
    if (url === '/api/onboard') return new Promise(() => {});
    return response(++profileReads === 1 ? { onboarding_complete: false, profile: null } : { onboarded: true, profile: location });
  }, { normalTimeoutMs: 50, slowTimeoutMs: 5 });
  await api.getProfile();
  const recovered = await api.submitAddress('28025');
  assert.equal(recovered.recovered_after_timeout, true);
  assert.equal(recovered.service_area_status, null);
  assert.equal(recovered.lat, location.lat);
});
test('onboard timeout never accepts an existing location, even when coordinates change', async () => {
  for (const previous of [location, { ...location, lat: 35.7 }]) {
    let profileReads = 0;
    const { api } = setup((url) => url === '/api/onboard' ? new Promise(() => {}) : response({ profile: ++profileReads === 1 ? previous : location }), { normalTimeoutMs: 50, slowTimeoutMs: 5 });
    await api.getProfile();
    await assert.rejects(api.submitAddress('28025'), { code: 'timeout' });
  }
});
test('onboard timeout with unknown baseline checks profile but cannot assert this write succeeded', async () => {
  const { api, calls } = setup((url) => url === '/api/onboard' ? new Promise(() => {}) : response(complete), { normalTimeoutMs: 50, slowTimeoutMs: 5 });
  await assert.rejects(api.submitAddress('28025'), { code: 'timeout' });
  assert.deepEqual(calls.map((call) => call.url), ['/api/onboard', '/api/profile']);
});
test('identity changes after automatic auth recovery discard response instead of completing a different profile', async () => {
  let change;
  const setupResult = setup(() => { change('replacement-user'); return response(complete); });
  change = setupResult.changeIdentity;
  setCacheIdentity('test-user');
  await assert.rejects(setupResult.api.saveHome({ water_source: 'utility', home_year: null }), { code: 'session_changed' });
});
test('identity changes during response decoding cannot return or cache the old readings', async () => {
  const previousWindow = globalThis.window;
  const disk = memoryStorage();
  globalThis.window = { localStorage: disk };
  try {
    for (const method of ['getDaily', 'getHome']) {
      let decoded, started;
      const decoding = new Promise((resolve) => { started = resolve; });
      const body = new Promise((resolve) => { decoded = resolve; });
      const { api, changeIdentity } = setup(() => ({ ok: true, status: 200, json() { started(); return body; } }));
      setCacheIdentity('test-user');
      const pending = api[method]();
      await decoding;
      changeIdentity('replacement-user');
      decoded({ air: { aqi: 42 }, water: { pws_name: 'Previous household' } });
      await assert.rejects(pending, { code: 'session_changed' });
      assert.equal(disk.length, 0, 'old payload must not be persisted under either identity');
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
test('abort while decoding a response cannot populate the readings cache later', async () => {
  const previousWindow = globalThis.window;
  const disk = memoryStorage();
  globalThis.window = { localStorage: disk };
  try {
    let decoded, started;
    const decoding = new Promise((resolve) => { started = resolve; });
    const body = new Promise((resolve) => { decoded = resolve; });
    const { api } = setup(() => ({ ok: true, status: 200, json() { started(); return body; } }));
    setCacheIdentity('test-user');
    const controller = new AbortController();
    const pending = api.getDaily(controller.signal);
    await decoding;
    controller.abort();
    await assert.rejects(pending, { code: 'aborted' });
    decoded({ air: { aqi: 42 } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disk.length, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
test('malformed success responses and incomplete save cannot mark onboarding complete', async () => {
  for (const payload of [null, [], 'not-json-shape']) {
    const { api } = setup(() => response(payload));
    await assert.rejects(api.getProfile(), { code: 'invalid_response' });
  }
  const { api } = setup(() => response({ onboarded: true, onboarding_complete: false, profile: location }));
  await assert.rejects(api.saveHome({ water_source: 'utility', home_year: 2000 }), { code: 'no_location' });
});
test('bad input never reaches network and unknown household properties never leave frontend', async () => {
  const { api, calls } = setup(() => response({}));
  await assert.rejects(api.submitAddress('123'), { code: 'address_required' });
  await assert.rejects(api.saveHome({ water_source: 'invented', home_year: null }), { code: 'invalid_response' });
  await assert.rejects(api.saveHome({ water_source: 'well', home_year: 1600 }), { code: 'invalid_response' });
  assert.equal(calls.length, 0);
  await api.saveHousehold({ has_toddler: true, address: 'never send this' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { ...emptyHousehold(), has_toddler: true });
});
