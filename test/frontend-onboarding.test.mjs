import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend, memoryStorage } from './frontend-test-loader.mjs';
const domain = await loadFrontend('onboarding');
const storage = await loadFrontend('storage');
const { copy } = await loadFrontend('copy');
const { createMockOnboardingApi, mockScenarios } = await loadFrontend('mock');
const success = (data) => ({ status: 'success', data });
const failure = { status: 'error', error: 'generic' };
const location = { county: 'Cabarrus County', state: 'NC', lat: 35.4, lng: -80.5, pwsid: 'NC0112010', water_source: 'utility' };
const completed = { onboarding_complete: true, profile: location };
const measured = (water = {}, radon = { zone: 3 }) => ({ water: { status: 'detects', pws_name: 'Town water', is_measured: true, coverage: 'complete', scored_contaminants: [{ contaminant: 'PFOS', is_enforceable: true, exceeds_limit: false }], ...water }, radon });
const row = (water, index = 1, place = location) => domain.getRevealRows(place, success(measured(water)), success({ air: { severity: 'good', aqi: 0 } }))[index];

test('all seven household values are boolean and unknown keys are discarded', () => {
  const empty = domain.emptyHousehold();
  assert.equal(Object.keys(empty).length, 7);
  assert.ok(Object.values(empty).every((value) => value === false));
  assert.deepEqual(domain.normalizeHousehold({ has_child: true, has_adult: 'true', address: 'secret' }), { ...empty, has_child: true });
});
test('address and optional year validation matches bounds, including current year', () => {
  assert.equal(domain.validateAddress(' 28025 '), '');
  assert.equal(domain.validateAddress(' 123 '), copy.address.required);
  assert.equal(domain.validateHomeYear('', 2026), '');
  assert.equal(domain.validateHomeYear('1700', 2026), '');
  assert.equal(domain.validateHomeYear('2026', 2026), '');
  for (const value of ['1699', '17a0', '198', '19.5', '1e03']) assert.equal(domain.validateHomeYear(value, 2026), copy.home.invalidYear);
  assert.equal(domain.validateHomeYear('2027', 2026), copy.home.futureYear);
  assert.equal(domain.parseHomeYear(''), null);
  assert.equal(domain.normalizeWaterAnswer('not_sure'), 'other');
  assert.equal(domain.normalizeWaterAnswer('made_up'), null);
});
test('completion never uses onboarded alone or malformed coordinates', () => {
  assert.equal(domain.isProfileComplete(completed), true);
  for (const profile of [null, {}, { onboarded: true, profile: location }, { onboarding_complete: true, profile: { ...location, water_source: null } }, { onboarding_complete: true, profile: { ...location, lat: NaN } }, { onboarding_complete: true, profile: { ...location, lng: 181 } }]) assert.equal(domain.isProfileComplete(profile), false);
});
test('severity is a closed server-selected vocabulary, never legacy status', () => {
  for (const unknown of ['unknown', 'low', 'Good', 'unhealthy', '', null, undefined, 0, 'constructor']) assert.equal(domain.normalizeSeverity(unknown), 'no_data');
  for (const level of Object.keys(copy.severity)) assert.equal(domain.normalizeSeverity(level), level);
  assert.equal(domain.getRevealRows(location, success({}), success({ air: { aqi: 32, status: 'good' } }))[3].result, 'No data');
  assert.equal(domain.getRevealRows(location, success({}), success({ air: { aqi: null, severity: 'good' } }))[3].result, 'No data');
  assert.equal(domain.getRevealRows(location, success({}), success({ air: { aqi: 0, severity: 'good' } }))[3].result, 'Good');
});
test('federal claim only uses explicit backend flags and highest server risk', () => {
  const water = { scored_contaminants: [
    { contaminant: 'Guidance chemical', is_enforceable: false, exceeds_limit: true, risk: 100 },
    { contaminant: 'PFOS', is_enforceable: true, exceeds_limit: true, risk: 80 },
    { contaminant: 'PFOA', is_enforceable: true, exceeds_limit: true, risk: 60 },
  ] };
  assert.equal(row(water).result, 'PFOS found above the limit');
  assert.equal(row({ scored_contaminants: [{ contaminant: 'HFPO-DA', is_enforceable: true, exceeds_limit: true }] }).result, 'GenX (HFPO-DA) found above the limit');
  assert.equal(row({ scored_contaminants: [{ contaminant: 'PFOS', value_ppt: 1000, limit_ppt: 4, is_enforceable: true }] }).result, 'No data');
  assert.equal(row({ scored_contaminants: [{ contaminant: 'PFOS', exceeds_limit: true }] }).result, 'No data');
  assert.equal(row({ scored_contaminants: [{ contaminant: 'PFOS', exceeds_limit: true, is_enforceable: false }] }).result, 'No data');
  assert.equal(row({ scored_contaminants: [null] }).result, 'No data');
});
test('measured below-limits result requires positive evidence, not missing fields', () => {
  assert.equal(row({}).result, copy.reveal.belowLimits);
  assert.equal(row({ scored_contaminants: [], coverage: 'no_detections' }).result, copy.reveal.belowLimits);
  assert.equal(row({ scored_contaminants: [], coverage: null }).result, copy.common.noData);
  assert.equal(row({ is_measured: false }).result, copy.reveal.unavailable);
  assert.equal(row({ scored_contaminants: [], coverage: 'excluded_only' }).result, copy.reveal.unregulated);
});
test('mixed contaminant flags cannot turn unknown enforceability into a below-limits claim', () => {
  const knownBelow = { contaminant: 'PFOA', is_enforceable: true, exceeds_limit: false };
  for (const unknown of [
    null,
    { contaminant: 'PFOS', exceeds_limit: true },
    { contaminant: 'PFOS', exceeds_limit: false },
    { contaminant: 'PFOS', is_enforceable: null, exceeds_limit: false },
    { contaminant: 'PFOS', is_enforceable: true },
    { is_enforceable: true, exceeds_limit: true },
  ]) {
    assert.equal(row({ scored_contaminants: [knownBelow, unknown] }).result, copy.common.noData);
  }
  assert.equal(row({ scored_contaminants: [knownBelow, { contaminant: 'Guidance chemical', is_enforceable: false, exceeds_limit: true }] }).result, copy.reveal.belowLimits);
});
test('private wells and springs never inherit measured public utility results', () => {
  assert.equal(row({}, 0, { ...location, water_source: 'well' }).result, copy.reveal.privateWell);
  assert.equal(row({}, 1, { ...location, water_source: 'well' }).result, copy.reveal.wellTesting);
  assert.equal(row({ status: 'private_well', source_type: 'spring' }, 0).result, copy.reveal.spring);
  assert.equal(row({ status: 'private_well', source_type: 'spring' }).result, copy.reveal.springTesting);
});
test('no utility, failed utility lookup, no results and unregulated remain distinct', () => {
  assert.equal(row({ status: 'no_pwsid_available' }).result, copy.reveal.noUtilityToCheck);
  assert.equal(row({ status: 'no_pwsid_available' }, 0).result, copy.reveal.noUtility);
  assert.equal(row({ status: 'no_pwsid_available' }, 0, { ...location, service_area_status: 'lookup_failed' }).result, copy.reveal.unavailable);
  assert.equal(row({ status: 'lookup_failed', pws_name: null }, 0).result, copy.reveal.foundSystem(location.pwsid));
  assert.equal(row({ status: 'lookup_failed' }).result, copy.reveal.unavailable);
  assert.equal(row({ status: 'no_data_yet' }).result, copy.reveal.noResults);
  assert.equal(row({ status: 'detected_unregulated' }).result, copy.reveal.unregulated);
});
test('outside state disclosure is not inferred from missing state, and outranks radon error', () => {
  assert.equal(row({ status: 'no_data_yet' }, 1, { ...location, state: 'SC' }).result, copy.reveal.outsideWater);
  assert.equal(row({ status: 'no_data_yet' }, 1, { ...location, state: null }).result, copy.reveal.noResults);
  assert.equal(domain.getRevealRows(location, success(measured({}, { out_of_state: true, error: 'internal text' })), failure)[2].result, copy.reveal.outsideRadon);
  assert.equal(domain.getRevealRows(location, success(measured({}, { zone: null })), failure)[2].result, copy.reveal.radonUnavailable);
});
test('partial and complete failures keep all four rows and no raw server copy', () => {
  const rows = domain.getRevealRows(null, failure, failure);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((item) => item.result === copy.reveal.unavailable && item.missing && !item.pending));
  const loading = domain.getRevealRows(null, { status: 'loading' }, { status: 'loading' });
  assert.ok(loading.every((item) => item.pending));
  const partial = domain.getRevealRows(location, failure, success({ air: { aqi: 32, severity: 'good' } }));
  assert.equal(partial[3].result, 'Good');
});
test('source strings and all catalog strings have no em dashes', () => {
  assert.equal(domain.displayText('Name \u2014 water'), 'Name, water');
  assert.equal(JSON.stringify(copy).includes('\u2014'), false);
  assert.equal(row({ pws_name: 'Concord\u2014City' }, 0).result, 'Concord, City');
});
test('completion flag is identity scoped, fail closed, and requires complete profile', () => {
  const disk = memoryStorage();
  storage.setCacheIdentity('one');
  disk.setItem('halo.onboarded', 'true');
  assert.equal(storage.hasCompletedOnboarding(disk), false);
  assert.equal(storage.markCompleted({ onboarded: true }, disk), false);
  assert.equal(storage.markCompleted(completed, disk), true);
  assert.equal(storage.hasCompletedOnboarding(disk), true);
  storage.setCacheIdentity('two');
  assert.equal(storage.hasCompletedOnboarding(disk), false);
});
test('reading cache strips sensitive fields and never invents server freshness', () => {
  const disk = memoryStorage();
  storage.setCacheIdentity('cache-test');
  storage.storeReading('daily', { air: { aqi: 0, address: 'secret street', access_token: 'secret token' }, retrieved_at: '2026-09-28T10:00:00Z', address: 'secret street', household: { has_child: true }, profile: { lat: 1 } }, disk);
  const cached = storage.readReading('daily', disk);
  assert.equal(cached.data.air.aqi, 0);
  assert.equal(cached.retrievedAt, '2026-09-28T10:00:00Z');
  assert.ok(!JSON.stringify([...disk.values]).includes('secret'));
  assert.ok(!JSON.stringify([...disk.values]).includes('has_child'));
  storage.storeReading('home', { water: null, radon: null }, disk);
  assert.equal(storage.readReading('home', disk).retrievedAt, null);
});
test('storage failures are harmless and clear never removes authentication', () => {
  const disk = memoryStorage();
  disk.setItem('sb-auth-token', 'keep');
  disk.setItem('halo.frontend.v1.any.daily', '{}');
  disk.setItem('halo.onboarded', 'true');
  storage.clearOnboardingStorage(disk);
  assert.equal(disk.getItem('sb-auth-token'), 'keep');
  assert.equal(disk.length, 1);
  const broken = { ...disk, getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.equal(storage.hasCompletedOnboarding(broken), false);
  assert.equal(storage.markCompleted(completed, broken), false);
  assert.doesNotThrow(() => storage.storeReading('daily', {}, broken));
});
test('mock scenarios are explicit and never call fetch or local storage', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Mock must not use network'); };
  try {
    for (const scenario of mockScenarios.filter((name) => !['captcha', 'signin', 'session-timeout', 'profile-error', 'address-not-found', 'rate-limited', 'address-error', 'timeout', 'household-error', 'home-save-error', 'air-error', 'home-error', 'all-error'].includes(name))) {
      const api = createMockOnboardingApi(scenario, { delayMs: 0 });
      await api.ensureSession();
      await api.submitAddress('28025');
      await api.saveHousehold(domain.emptyHousehold());
      const profile = await api.saveHome({ water_source: 'utility', home_year: null });
      assert.equal(domain.isProfileComplete(profile), true);
      assert.equal(domain.getRevealRows(profile.profile, success(await api.getHome()), success(await api.getDaily())).length, 4);
    }
  } finally { globalThis.fetch = previousFetch; }
});
test('mock failures recover on retry and abort prevents a write', async () => {
  const api = createMockOnboardingApi('address-not-found', { delayMs: 0 });
  await assert.rejects(api.submitAddress('28025'), { code: 'address_not_found' });
  await api.submitAddress('28025');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.saveHome({ water_source: 'well', home_year: null }, controller.signal), { code: 'aborted' });
  assert.equal((await api.getProfile()).onboarding_complete, false);
});
