/**
 * GET /api/luna/capabilities (B03 plan, Task 2c, Ruling L7).
 *
 * This is the route that makes the whole package honest. Luna answers and
 * cites; Luna does not act. Five of the ten registry operations are the tool
 * half and are deliberately not built, and this route has to say so in the
 * contract's own vocabulary without the UI appearing broken.
 *
 * THE TRAP, and it is the reason this file exists. `available: false` looks
 * like the obvious way to report "no tools". It is wrong. `available` is a
 * single boolean for the WHOLE assistant and it feeds `blocked`
 * (ProductionLunaConversation.tsx:36), which disables the Send button, every
 * starter prompt and every `choices` button, and makes `send()` and `act()`
 * return immediately. It would turn a deliberate scope decision into a dead
 * screen for the half we are shipping. The supported mechanism is
 * `available: true` with `tools: []`: an empty array is explicitly valid
 * (luna-service.ts:11,29), no component reads the field, and the proposal and
 * confirm controls render only inside a `message.proposal` block (`:93`), so
 * never emitting a proposal erases the action surface with no empty state and
 * no broken affordance. The rest is said in prose through `providerLabel` and
 * `retentionSummary`, which the client renders verbatim.
 *
 * `available: false` IS correct for one case and only one: the capability flag
 * is off, so Luna genuinely cannot answer. That case is a 503 here (see
 * lib/luna.js `lunaUnavailable`, the one degradation every Luna route shares),
 * which produces the same clean blocked state through the client's own error
 * path, so the flag-off answer never has to claim a working service.
 *
 * `assertLunaCapabilities` below transcribes `validLunaCapabilities`
 * (lib/frontend/production/luna-service.ts:29) on
 * `origin/codex/october15-review-refinement`. The client discards the whole
 * payload if it does not match, so every test asserts the whole contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const ROUTE = '/api/luna/capabilities';
const TABLES = haloTables('profiles', 'luna_conversations', 'luna_turns', 'luna_runs');

/** The flag that turns Luna on. Off unless a test sets it (BE-351, Ruling L5). */
const ON = { HALO_FEATURE_LUNA: 'on' };

const EM_DASH = String.fromCodePoint(0x2014);

function harness() {
  return createRouteHarness({
    tables: TABLES,
    seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id }, { id: bob.id }] }),
  });
}

const read = (h, who, { env = ON, url = ROUTE } = {}) => h.call(ROUTE, 'GET', { as: who, url, env });

// --- the client's validator, transcribed -----------------------------------

const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
/** `text` from luna-service.ts:13: a string within `max` and free of the control characters it names. */
const controlFree = (value) =>
  !Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
  });
const text = (value, max = 16000) => typeof value === 'string' && value.length <= max && controlFree(value);

/**
 * `validLunaCapabilities`, transcribed. All seven members are mandatory; no
 * field is optional. Kept as one function so every test asserts the whole
 * contract rather than the one field it happens to care about.
 */
function assertLunaCapabilities(body) {
  assert.ok(object(body), 'a capabilities answer is a plain object');
  assert.equal(typeof body.available, 'boolean');
  assert.ok(text(body.providerLabel, 300), 'providerLabel is text of at most 300 characters');
  assert.ok(text(body.retentionSummary, 2000), 'retentionSummary is text of at most 2000 characters');
  assert.equal(typeof body.publicRetrieval, 'boolean');
  assert.ok(object(body.context), 'context is a plain object');
  for (const key of ['tasks', 'home', 'projects']) {
    assert.equal(typeof body.context[key], 'boolean', `context.${key} is a boolean`);
  }
  assert.ok(Array.isArray(body.tools) && body.tools.length <= 100, 'tools is an array of at most 100');
  assert.ok(body.tools.every((tool) => text(tool, 200)), 'every tool name is text of at most 200 characters');
}

// ---------------------------------------------------------------------------
// The trap: how the tool half is reported absent
// ---------------------------------------------------------------------------

test('answering is available and the tool half is an empty allowlist, not an unavailable assistant', async () => {
  const h = harness();
  const response = await read(h, 'alice');
  assert.equal(response.status, 200);
  const body = await response.json();
  assertLunaCapabilities(body);

  // THE TRAP. `available: false` is how a reader's instinct says "no tools",
  // and it feeds `blocked` (ProductionLunaConversation.tsx:36): the Send
  // button, every starter prompt and every `choices` button go dead, and
  // `send()` and `act()` return immediately. Reporting the deliberately
  // unbuilt tool half that way would disable the answering half we are
  // shipping. `tools: []` is the contract's own word for "no permitted tools"
  // and no component reads it, so the UI shows nothing broken.
  assert.notEqual(body.available, false, 'available: false would disable answering, sending and every starter prompt');
  assert.equal(body.available, true);
  assert.deepEqual(body.tools, [], 'the tool half is reported as an empty allowlist');
});

test('no household context is claimed, because Luna reads none in this package (Ruling L2)', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  assertLunaCapabilities(body);
  // The client renders this verbatim as "Tasks off, home records off, projects
  // off." (ProductionLunaConversation.tsx:90). Reporting any of them `true`
  // would claim Luna reads household data, and there is no path to it.
  assert.deepEqual(body.context, { tasks: false, home: false, projects: false });
});

test('publicRetrieval is false, so the client says live public-source lookup is not available', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  assertLunaCapabilities(body);
  // `false` renders the client's own sentence "Live public-source lookup is not
  // available." (`:90`). Luna answers from the indexed corpus, not from a live
  // fetch, so `true` would be a claim it cannot keep.
  assert.equal(body.publicRetrieval, false);
});

// ---------------------------------------------------------------------------
// The two free-text slots, which the client renders verbatim
// ---------------------------------------------------------------------------

test('the prose says Luna answers and cites but cannot act, which is what the contract cannot say in a field', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  assertLunaCapabilities(body);
  const prose = `${body.providerLabel}. ${body.retentionSummary}`;
  assert.match(prose, /cite/i, 'the answering half is described as cited');
  assert.match(prose, /cannot change anything in HALO/, 'the tool half is stated in words, not only as tools: []');
  // The static UI copy says "Notes are included only when you choose them" and
  // "Review every proposed change", and both will show even though neither is
  // true in this release. These two strings are the only slots that can offset
  // that, so they must.
  assert.match(prose, /not part of this conversation/, 'the excluded household records are named');
});

test('the prose states no retention period, because the period is undecided', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  const prose = `${body.providerLabel} ${body.retentionSummary}`;
  // Retention for a conversation turn is UNDECIDED (docs/backend/
  // privacy-and-retention.md, B03 blocker 2). A number here would invent an
  // approved period, and a person would read it as a promise.
  assert.doesNotMatch(
    prose,
    /\b\d+\s*(?:second|minute|hour|day|week|month|year)/i,
    'no numeric retention period may be stated',
  );
  assert.doesNotMatch(
    prose,
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|thirty|sixty|ninety)\s+(?:second|minute|hour|day|week|month|year)/i,
    'and not a spelled out one either',
  );
  assert.doesNotMatch(prose, /\bforever\b|\bindefinitely\b|\bpermanently\b/i, 'and no open ended promise either');
  // What IS true and is therefore said: the person can end it themselves.
  assert.match(body.retentionSummary, /until you clear this conversation or delete your account/);
});

test('the prose carries no em dash and fits the client\'s own limits', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  assertLunaCapabilities(body);
  for (const [field, value] of Object.entries({
    providerLabel: body.providerLabel,
    retentionSummary: body.retentionSummary,
  })) {
    assert.equal(value.includes(EM_DASH), false, `${field} uses no em dash in app-facing copy`);
    assert.ok(value.trim().length > 0, `${field} is not blank`);
  }
  // The client renders `${providerLabel}. ${retentionSummary}` (`:90`) and
  // appends the period itself, so a trailing one would read as "sources..".
  assert.doesNotMatch(body.providerLabel, /[.!?]$/, 'the client appends the period after providerLabel');
});

test('no provider, model or database detail reaches the answer', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  const whole = JSON.stringify(body).toLowerCase();
  for (const leak of ['openrouter', 'openai', 'gpt', 'supabase', 'postgres', 'assistant_corpus', 'embedding', 'api key']) {
    assert.equal(whole.includes(leak), false, `the answer names no ${leak}`);
  }
});

// ---------------------------------------------------------------------------
// Identity, and the same answer for every household
// ---------------------------------------------------------------------------

test('identity comes only from the verified token', async () => {
  const h = harness();
  await expectEnvelope(await h.call(ROUTE, 'GET', { as: null, env: ON }), {
    status: 401,
    code: 'auth_required',
  });
  await expectEnvelope(await h.call(ROUTE, 'GET', { headers: { authorization: 'Bearer nope' }, env: ON }), {
    status: 401,
    code: 'auth_required',
  });
});

test('a profile_id in the query changes nothing, and two households get the identical answer', async () => {
  const h = harness();
  const mine = await (await read(h, 'alice')).json();
  const smuggled = await (await read(h, 'alice', { url: `${ROUTE}?profileId=${h.identities.bob.id}` })).json();
  const theirs = await (await read(h, 'bob')).json();
  assertLunaCapabilities(mine);
  assertLunaCapabilities(smuggled);
  assertLunaCapabilities(theirs);
  // Capabilities is deployment configuration, not household data: nothing in
  // it can differ per household, so nothing in it can leak one to another.
  assert.deepEqual(smuggled, mine, 'a foreign profile id in the query is ignored');
  assert.deepEqual(theirs, mine);
});

test('no conversation, turn or run is read to answer what the deployment can do', async () => {
  const h = harness();
  await read(h, 'alice');
  const reads = h.db.queryLog.filter((entry) => entry.table === 'luna_turns' || entry.table === 'luna_runs');
  assert.deepEqual(reads, [], 'answering "what can Luna do" needs nobody\'s conversation');
  const writes = h.db.queryLog.filter((entry) => entry.operation !== 'select');
  assert.deepEqual(writes, [], 'a read route writes nothing');
});

// ---------------------------------------------------------------------------
// The capability flag, and before migration 0020
// ---------------------------------------------------------------------------

test('with the capability off the route refuses, reads nothing and writes nothing', async () => {
  const h = harness();
  const body = await expectEnvelope(await h.call(ROUTE, 'GET', { as: 'alice' }), {
    status: 503,
    code: 'feature_unavailable',
    retryable: false,
  });
  // Not a capabilities answer at all: no `available` to be misread as a
  // working service, and nothing that invites a retry that cannot help.
  assert.ok(!('available' in body), 'an off capability is not answered with a capability snapshot');
  assert.equal(body.message.includes(EM_DASH), false, 'app-facing copy uses no em dash');
  assert.deepEqual(h.db.queryLog, [], 'off means off: nothing is read while the capability is off');
});

test('the flag must be explicitly on, so a misspelling fails closed', async () => {
  const h = harness();
  for (const value of ['off', 'false', '1', 'yes', '', 'onn']) {
    const response = await h.call(ROUTE, 'GET', { as: 'alice', env: { HALO_FEATURE_LUNA: value } });
    assert.equal(response.status, 503, `HALO_FEATURE_LUNA=${JSON.stringify(value)} is off`);
  }
});

test('before migration 0020 the route reports the feature unavailable, never a working service', async (t) => {
  muteConsoleError(t);
  const h = createRouteHarness({
    tables: haloTables('profiles'), // no Luna tables
    seed: ({ alice }) => ({ profiles: [{ id: alice.id }] }),
  });
  const body = await expectEnvelope(await h.call(ROUTE, 'GET', { as: 'alice', env: ON }), {
    status: 503,
    code: 'feature_unavailable',
    retryable: false,
  });
  // `available: true` with a missing schema would be a lie the person pays
  // for: every question they sent would fail after they typed it.
  assert.ok(!('available' in body), 'a missing schema must not be answered with available: true');
  assert.ok(!('tools' in body));
});

test('a partially applied 0020 is unavailable too, not a working service', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const failed = withoutColumn(h.db, 'luna_conversations', 'profile_id', '42703');
  try {
    const body = await expectEnvelope(await h.call(ROUTE, 'GET', { as: 'alice', env: ON }), {
      status: 503,
      code: 'feature_unavailable',
      retryable: false,
    });
    assert.ok(!('available' in body));
    assert.ok(failed.length > 0, 'the probe really did hit the missing column');
  } finally {
    failed.restore();
  }
});
