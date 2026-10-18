/**
 * GET /api/luna/capabilities (B03 plan, Task 2c, Ruling L7).
 *
 * This is the route that makes the whole package honest. Luna answers and
 * cites; Luna does not act. The registry holds ten operations, six built and
 * four not, and the four unbuilt ones are the tool half; the `proposal`
 * payload that drives their controls is a field this release never emits. This
 * route has to say that in the contract's own vocabulary without the UI
 * appearing broken.
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
 * `available: false` IS correct, and required, when Luna genuinely cannot
 * answer: the capability flag is off (Ruling L11) or no provider key is
 * configured (Ruling L13). Those are the opposite of the trap, because there
 * is nothing working to disable. A missing migration 0020 is a third fact and
 * a different answer, a non-retryable 503; the precedence between all three is
 * pinned by its own tests at the end of this file.
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
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const { featureDisabledReason } = await import('../lib/features.js');

const ROUTE = '/api/luna/capabilities';
const TABLES = haloTables('profiles', 'luna_conversations', 'luna_turns', 'luna_runs');

const EM_DASH = String.fromCodePoint(0x2014);
/** Recognisable, so a test can prove no part of it reaches a response. */
const MODEL_KEY = 'sk-test-luna-key-must-never-be-echoed';

/**
 * What a working deployment looks like: the capability flag on (BE-351,
 * Ruling L5) AND a provider key configured (Ruling L13). Both are needed, and
 * the sandbox scrubs every provider variable, so a test that wants an
 * available Luna has to say so.
 */
const ON = { HALO_FEATURE_LUNA: 'on', ASSISTANT_MODEL_KEY: MODEL_KEY };

/** The flag on, with no provider key: Luna is switched on but cannot answer. */
const ON_WITHOUT_KEY = { HALO_FEATURE_LUNA: 'on' };


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

test('no turn and no run is read to answer what the deployment can do, and its one query is scoped to the caller', async () => {
  const h = harness();
  await read(h, 'alice');
  const reads = h.db.queryLog.filter((entry) => entry.table === 'luna_turns' || entry.table === 'luna_runs');
  assert.deepEqual(reads, [], 'answering "what can Luna do" needs nobody\'s conversation');
  const writes = h.db.queryLog.filter((entry) => entry.operation !== 'select');
  assert.deepEqual(writes, [], 'a read route writes nothing');

  // The schema probe is the only statement this route makes, and it is scoped
  // to the caller on the query itself rather than only in route logic. Asserted
  // rather than described, because ROUTE_COVERAGE claims it: a probe that lost
  // its profile_id filter would ask about every household's rows to answer a
  // question that is about no household. What the query log records is the
  // table, the operation and the filters; `head: true` and the count mode are
  // NOT recorded, which is why no coverage line claims the probe reads no rows.
  const probes = h.db.queryLog.filter((entry) => entry.table === 'luna_conversations');
  assert.equal(probes.length, 1, 'one probe for the answer, not one per field in it');
  auditOwnerScope(probes, h.identities.alice.id, 'GET /api/luna/capabilities');
});

// ---------------------------------------------------------------------------
// The capability flag, and before migration 0020
// ---------------------------------------------------------------------------

test('with the capability off the answer reports it off, with the reason, and nothing else', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', { as: 'alice' });
  // RULING L11. The endpoint whose job is to REPORT availability reports it;
  // the endpoints that ACT refuse. So this one answers, and it answers 200.
  assert.equal(response.status, 200, 'reporting that Luna is off is not a refusal to report');
  const body = await response.json();
  assertLunaCapabilities(body);

  // `available: false` is right here, and only here. Ruling L7's prohibition
  // was about the case where Luna DOES answer and only the tool half is
  // absent: there, `blocked` would wrongly disable answering. When the whole
  // capability is off, disabling answering is accurate, not a dead screen.
  assert.equal(body.available, false);
  assert.equal(body.reason, featureDisabledReason('luna'), "the reason, in the words lib/features.js already has for it");
  // And the person actually reads it: the client renders the two verbatim
  // slots as one sentence pair and appends the period itself (`:90`), so this
  // pair composes exactly that reason. The assertion is what stops the halves
  // drifting from the helper.
  assert.equal(`${body.providerLabel}. ${body.retentionSummary}`, featureDisabledReason('luna'));
  assert.equal(body.reason.includes(EM_DASH), false, 'app-facing copy uses no em dash');

  // Nothing else. No tool, no context and no retrieval is claimed for a
  // capability that is off, and no conversation is read to say so.
  assert.deepEqual(body.tools, []);
  assert.deepEqual(body.context, { tasks: false, home: false, projects: false });
  assert.equal(body.publicRetrieval, false);
  assert.deepEqual(
    Object.keys(body).sort(),
    ['available', 'context', 'providerLabel', 'publicRetrieval', 'reason', 'retentionSummary', 'tools'],
    'the seven members the contract requires, plus the reason, and nothing more',
  );
  assert.deepEqual(h.db.queryLog, [], 'off means off: nothing is read while the capability is off');
});

test('the flag must be explicitly on, so a misspelling reports the capability off', async () => {
  const h = harness();
  for (const value of ['off', 'false', '1', 'yes', '', 'onn']) {
    const response = await h.call(ROUTE, 'GET', { as: 'alice', env: { HALO_FEATURE_LUNA: value } });
    assert.equal(response.status, 200, `HALO_FEATURE_LUNA=${JSON.stringify(value)}`);
    const body = await response.json();
    assertLunaCapabilities(body);
    assert.equal(body.available, false, `HALO_FEATURE_LUNA=${JSON.stringify(value)} is off`);
  }
});

test('the capability is on but no provider key is configured, so availability is not claimed', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', { as: 'alice', env: ON_WITHOUT_KEY });
  // RULING L13. Without a key Luna cannot answer anything at all, and cannot
  // even fall back to cited passages: `answerFromCorpus` calls
  // `embedQuestion` with the key BEFORE retrieval happens, so retrieval never
  // runs. Claiming `available: true` here would hand the person a Send button
  // and fail every question they typed into it.
  assert.equal(response.status, 200, 'this is a reportable state, not a deployment fault');
  const body = await response.json();
  assertLunaCapabilities(body);
  assert.equal(body.available, false);
  assert.equal(body.reason, featureDisabledReason('luna'), 'one honest sentence covers both off states');
  assert.deepEqual(body.tools, []);
  assert.deepEqual(body.context, { tasks: false, home: false, projects: false });
  assert.equal(body.publicRetrieval, false);
});

test('an unconfigured deployment is reported to the person, not to the operator', async () => {
  const h = harness();
  const body = await (await h.call(ROUTE, 'GET', { as: 'alice', env: ON_WITHOUT_KEY })).json();
  // The prose a person reads, not the whole payload: the contract's own field
  // is named `providerLabel`, so searching the JSON for "provider" would match
  // the schema rather than the copy. The reader is not the operator, so nothing
  // here names a variable, a vendor or a step they cannot take.
  const prose = [body.providerLabel, body.retentionSummary, body.reason].join(' ').toLowerCase();
  for (const detail of ['assistant_model_key', 'openai_api_key', 'api key', 'configur', 'provider', 'variable']) {
    assert.equal(prose.includes(detail), false, `the copy does not mention ${detail}`);
  }
  assert.equal(prose.includes(EM_DASH), false, 'app-facing copy uses no em dash');
});

test('no part of the provider key reaches the response, however it was configured', async () => {
  const h = harness();
  for (const [env, available] of [
    [{ HALO_FEATURE_LUNA: 'on', ASSISTANT_MODEL_KEY: MODEL_KEY }, true],
    [{ HALO_FEATURE_LUNA: 'on', OPENAI_API_KEY: MODEL_KEY }, true],
    // The off answer is also composed while a real key exists, which is the
    // only state where the off body could carry one.
    [{ ASSISTANT_MODEL_KEY: MODEL_KEY }, false],
  ]) {
    const body = await (await h.call(ROUTE, 'GET', { as: 'alice', env })).json();
    assertLunaCapabilities(body);
    assert.equal(body.available, available, 'either variable counts as configured, as the legacy route reads it');
    const whole = JSON.stringify(body);
    assert.equal(whole.includes(MODEL_KEY), false, 'the key itself is never echoed');
    assert.equal(whole.includes(MODEL_KEY.slice(0, 8)), false, 'and no fragment of it either');
  }
});

test('a key that is present but empty is not a configured provider', async () => {
  const h = harness();
  for (const env of [
    { HALO_FEATURE_LUNA: 'on', ASSISTANT_MODEL_KEY: '' },
    { HALO_FEATURE_LUNA: 'on', ASSISTANT_MODEL_KEY: '   ' },
    { HALO_FEATURE_LUNA: 'on', OPENAI_API_KEY: '' },
  ]) {
    const body = await (await h.call(ROUTE, 'GET', { as: 'alice', env })).json();
    assert.equal(body.available, false, `${JSON.stringify(env)} cannot answer a question`);
  }
});

test('the provider is checked for presence only: no network call is made to prove it works', async () => {
  const h = harness();
  const body = await (await h.call(ROUTE, 'GET', { as: 'alice', env: ON })).json();
  assert.equal(body.available, true);
  // Reporting what the deployment can do must not spend a request on the
  // provider, and must not fail because the provider is briefly down. The
  // harness records any attempt and the default fetch rejects.
  assert.deepEqual(h.blockedFetches, [], 'no provider call is made to answer this route');
});

// ---------------------------------------------------------------------------
// The three facts, in order
// ---------------------------------------------------------------------------

/**
 * Three distinct facts can make Luna unusable, and they do not answer alike:
 *
 *   1. the capability flag is off     -> 200, available: false, the reason
 *   2. migration 0020 is not applied  -> 503 feature_unavailable
 *   3. the flag is on, no provider    -> 200, available: false, the reason
 *
 * The handler evaluates 1 before 2, because a capability that is off must read
 * nothing at all, and discovering fact 2 requires a read. Among the facts that
 * can coexist with the flag ON, 2 outranks 3: a 200 must never paper over a
 * deployment fault.
 */
test('a missing schema outranks a missing provider key, because a 503 is not a reportable state', async (t) => {
  muteConsoleError(t);
  const h = createRouteHarness({
    tables: haloTables('profiles'), // no Luna tables
    seed: ({ alice }) => ({ profiles: [{ id: alice.id }] }),
  });
  const body = await expectEnvelope(await h.call(ROUTE, 'GET', { as: 'alice', env: ON_WITHOUT_KEY }), {
    status: 503,
    code: 'feature_unavailable',
    retryable: false,
  });
  assert.ok(!('available' in body), 'the schema fault is reported, not softened into available: false');
});

test('the flag outranks both, and settles the answer before anything is read', async (t) => {
  muteConsoleError(t);
  const h = createRouteHarness({
    tables: haloTables('profiles'), // no Luna tables either
    seed: ({ alice }) => ({ profiles: [{ id: alice.id }] }),
  });
  const response = await h.call(ROUTE, 'GET', { as: 'alice' }); // no flag, no key
  assert.equal(response.status, 200, 'a switched off capability is reported, not diagnosed');
  const body = await response.json();
  assert.equal(body.available, false);
  assert.equal(body.reason, featureDisabledReason('luna'));
  assert.deepEqual(h.db.queryLog, [], 'off means off: the schema is not even probed');
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
