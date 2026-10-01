import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend, memoryStorage } from './frontend-test-loader.mjs';
const { createLiveStageApi, parseAssistant, parseLearn } = await loadFrontend('stage-api');
const { setCacheIdentity } = await loadFrontend('storage');
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const validId = '12345678-1234-1234-1234-123456789012';
function setup(handler, options = {}) {
  let identity = 'household-one'; const calls = [];
  const auth = { async ensureAnonSession() {}, async getUserId() { return identity; }, async authedFetch(url, init) { calls.push({ url, init }); return handler(url, init); } };
  return { api: createLiveStageApi({ loadAuth: async () => auth, ...options }), calls, setIdentity(value) { identity = value; } };
}
const answer = { configured: true, answer: 'An answer [1].', grounded: true, uses_household_data: false, citations: [{ n: 1, label: 'EPA\u2014Radon', url: 'https://www.epa.gov/radon', retrieved: '2026-09-27' }], disclaimer: 'Not medical advice.' };

test('stage endpoints use exact contracts and keep all identity out of request bodies', async () => {
  const { api, calls } = setup((url, init) => {
    if (url === '/api/profile') return response({ onboarded: true, onboarding_complete: true, profile: { lat: 35, lng: -80, water_source: 'utility' } });
    if (url.startsWith('/api/history')) return response({ from: '2026-09-24', to: '2026-09-30', history: [] });
    if (url.startsWith('/api/learn')) return response({ topic: 'air', what_it_is: 'Outdoor air.', protect: [], sources: [], locale: 'en' });
    if (url.startsWith('/api/assistant?')) return response({ suggestions: ['What is AQI?'], disclaimer: 'Not medical advice.' });
    if (url === '/api/assistant') return response(answer);
    if (url === '/api/alerts' && init.method === 'POST') return response({ ok: true, updated: 0 });
    if (url === '/api/alerts') return response({ alerts: [{ id: validId, title: 'Air', message: 'Reading changed.', read: false, fired_at: '2026-09-30T12:00:00Z' }] });
    return response(url.includes('daily-score') ? { air: { aqi: 1 } } : { water: { status: 'private_well' } });
  });
  await api.ensureSession(); await api.loadProfile(); await api.getDaily(undefined, { fresh: true }); await api.getHome(); await api.getHistory(7);
  await api.getLearn('air', { value: 0, severity: 'good', profile_id: 'must-not-send' }); await api.getAssistant('today'); await api.askAssistant('  What does AQI mean?  ', 'today');
  assert.equal((await api.getAlerts()).unread, 1); assert.equal((await api.markAlerts({ id: validId })).updated, 0);
  assert.deepEqual(calls.map(call => call.url), ['/api/profile', '/api/daily-score?fresh=1', '/api/home-guard', '/api/history?days=7', '/api/learn?topic=air&value=0&severity=good', '/api/assistant?page=today', '/api/assistant', '/api/alerts', '/api/alerts']);
  assert.deepEqual(JSON.parse(calls[6].init.body), { question: 'What does AQI mean?', page: 'today' });
  assert.equal(JSON.stringify(calls).includes('profile_id'), false);
});

test('protected shared transport rejects changed identities before responses publish', async () => {
  let setupResult;
  setupResult = setup(() => { setupResult.setIdentity('household-two'); return response(answer); });
  await assert.rejects(setupResult.api.askAssistant('What is AQI?'), { code: 'session_changed' });
});

test('assistant slow deadline, cancellation, and status failures use safe error codes', async () => {
  const slow = setup(() => new Promise(resolve => setTimeout(() => resolve(response(answer)), 25)), { normalTimeoutMs: 2, assistantTimeoutMs: 1000 });
  assert.equal((await slow.api.askAssistant('What is AQI?')).grounded, true);
  const timeout = setup(() => new Promise(() => {}), { assistantTimeoutMs: 5 });
  await assert.rejects(timeout.api.askAssistant('What is AQI?'), { code: 'timeout' });
  const cancelled = setup(() => new Promise(() => {})); const controller = new AbortController();
  const pending = cancelled.api.askAssistant('What is AQI?', 'today', controller.signal); controller.abort();
  await assert.rejects(pending, { code: 'aborted' });
  for (const [status, code] of [[429, 'rate_limited'], [503, 'generic'], [500, 'generic']]) {
    const failure = setup(() => response({ error: 'private database details' }, status));
    await assert.rejects(failure.api.getAlerts(), error => error.code === code && error.message === code);
  }
});

test('assistant outcomes stay distinct and source URLs are validated', () => {
  assert.equal(parseAssistant({ ...answer, citations: [...answer.citations, { n: 2, label: 'Unsafe', url: 'javascript:alert(1)' }] }).citations.length, 1);
  assert.equal(parseAssistant(answer).citations[0].label, 'EPA, Radon');
  const declined = parseAssistant({ declined: true, message: 'I cannot diagnose.', disclaimer: 'Not medical advice.', citations: [] });
  assert.equal(declined.declined, true); assert.equal(declined.configured, null);
  for (const reason of ['no_source', 'unavailable']) assert.equal(parseAssistant({ answer: null, reason, message: 'Unavailable.', disclaimer: 'Not medical advice.', citations: [] }).reason, reason);
  assert.throws(() => parseAssistant({ ...answer, grounded: false }), { code: 'invalid_response' });
  assert.throws(() => parseAssistant({}), { code: 'invalid_response' });
});

test('Learn preserves missing context and actual content locale with safe sources', () => {
  const learned = parseLearn({ topic: 'pfas', locale: 'en', title: 'PFAS', what_it_is: 'Utility\u2014sample data.', why_yours: null, household_note: null, protect: ['Read the result.'], sources: [{ label: 'EPA', url: 'https://www.epa.gov/' }, { label: 'bad', url: 'data:text/html,hello' }] }, 'pfas');
  assert.equal(learned.why_yours, null); assert.equal(learned.household_note, null); assert.equal(learned.locale, 'en'); assert.equal(learned.sources.length, 1);
  assert.throws(() => parseLearn({ topic: 'air' }, 'pfas'), { code: 'invalid_response' });
});

test('malformed data and mutation inputs never masquerade as successful payloads', async () => {
  const bad = setup(() => response({}));
  for (const method of [() => bad.api.loadProfile(), () => bad.api.getDaily(), () => bad.api.getHome(), () => bad.api.getHistory(), () => bad.api.getAlerts(), () => bad.api.getAssistant()]) await assert.rejects(method(), { code: 'invalid_response' });
  const untouched = setup(() => response({ ok: true, updated: 1 }));
  await assert.rejects(untouched.api.askAssistant(''), { code: 'invalid_response' });
  await assert.rejects(untouched.api.askAssistant('x'.repeat(1001)), { code: 'invalid_response' });
  await assert.rejects(untouched.api.markAlerts({ id: 'not-a-uuid' }), { code: 'invalid_response' });
  assert.equal(untouched.calls.length, 0);
});

test('stage validation runs before environmental cache writes and preserves existing valid cache', async () => {
  const previousWindow = globalThis.window; const disk = memoryStorage(); globalThis.window = { localStorage: disk };
  try {
    setCacheIdentity('household-one');
    const good = setup(() => response({ air: { aqi: 42, severity: 'good' } }));
    await good.api.getDaily();
    const prior = [...disk.values];
    for (const payload of [{}, { air: [] }, { water: 'invalid' }]) {
      const bad = setup(() => response(payload));
      await assert.rejects('water' in payload ? bad.api.getHome() : bad.api.getDaily(), { code: 'invalid_response' });
      assert.deepEqual([...disk.values], prior);
    }
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});
