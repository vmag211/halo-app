/**
 * B03 Luna: the executable contract, and conformance of the REAL handlers to it
 * and to the frontend's own validators.
 *
 * This file is not a restatement of each route's own suite. Those prove that
 * each route is right on its own; four of them ran in parallel worktrees and
 * every one was green before anything was merged. What NONE of them can prove
 * is that the six routes agree:
 *
 *   - with the frontend's validators, which discard a whole payload rather than
 *     render part of it, so one wrong field loses the answer and the person's
 *     own question with it;
 *   - with EACH OTHER. The client validates the conversation returned by
 *     `messages`, by `runs/status`, by `runs/cancel`, by `conversations` and by
 *     `clear` with ONE function, and holds a single conversation pointer. A
 *     divergence between two of those five is a defect even with every route's
 *     own suite green, and nothing before this file looked for one.
 *   - with the document, `docs/backend/contracts/b03.openapi.json`, which is
 *     what a reader will believe.
 *
 * THE VALIDATORS BELOW ARE TRANSCRIBED, not summarised, from
 * `lib/frontend/production/luna-service.ts` on
 * `origin/codex/october15-review-refinement` (read with `git show`; the file is
 * not checked out here). They are BOOLEAN predicates rather than the assert
 * helpers the route suites use, for one reason: a transcription that always
 * said yes would pass every payload in this file, so the transcription itself
 * has to be shown to reject things. `the transcribed validators reject what the
 * client rejects` below does that, and it includes both directions of the one
 * rule that is easy to get backwards: `validLunaRun` requires the conversation
 * when, and only when, the status is `completed`.
 *
 * Structure, in order: the schemas against the fixtures, the contract's own
 * coverage, the transcribed validators and their self-checks, the real handlers
 * against both, cross-route agreement, and the two directions of header
 * documentation (which runs last, because it reports on what ran before it).
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * database, a fake retrieval RPC and a fake provider that throws on any
 * unexpected host. No real Supabase project, no real model, no production URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b03.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b03', components: contract.components });
const operations = new Map(
  Object.entries(contract.paths).flatMap(([path, verbs]) =>
    Object.entries(verbs).map(([method, op]) => [op.operationId, { ...op, path, method: method.toUpperCase() }])),
);
const validators = new Map();
function compiled(ref) {
  if (!validators.has(ref)) validators.set(ref, ajv.compile({ $ref: `urn:halo:b03${ref}` }));
  return validators.get(ref);
}
/** The documented response for this operation and status, applied to a real or fixture body. */
function validate(operationId, status, body) {
  const op = operations.get(operationId);
  assert.ok(op, `unknown operation ${operationId}`);
  const response = op.responses[String(status)];
  assert.ok(response, `${operationId}: undocumented status ${status}`);
  const check = compiled(response.content['application/json'].schema.$ref);
  assert.equal(check(body), true, `${operationId} ${status}: ${ajv.errorsText(check.errors)}`);
}
/** The documented REQUEST for this operation, applied to a body a test is about to send. */
function validateRequest(operationId, body) {
  const op = operations.get(operationId);
  const ref = op.requestBody?.content['application/json'].schema.$ref;
  assert.ok(ref, `${operationId} documents no request body`);
  const check = compiled(ref);
  assert.equal(check(body), true, `${operationId} request: ${ajv.errorsText(check.errors)}`);
}

const directory = new URL('../docs/backend/contracts/fixtures/b03/', import.meta.url);
const fixtures = await Promise.all(
  (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, directory), 'utf8')) })),
);

for (const fixture of fixtures) {
  test(`B03 fixture: ${fixture.name}`, () => validate(fixture.operationId, fixture.status, fixture.body));
}

test('B03 contract covers the six built operations, every documented status has a fixture, and the tool half is absent', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, 'b03-1');
  assert.equal(operations.size, 6);
  assert.deepEqual([...operations.keys()].sort(), [
    'lunaCapabilities', 'lunaClear', 'lunaConversation', 'lunaMessage', 'lunaRunCancel', 'lunaRunStatus',
  ]);
  // Luna answers and cites; Luna does not act. The four tool endpoints are not
  // built, so documenting them would be a claim this package cannot support.
  for (const path of ['/api/luna/proposals/edit', '/api/luna/proposals/cancel', '/api/luna/tools/confirm', '/api/luna/operations']) {
    assert.equal(path in contract.paths, false, `${path} is deliberately not built and must not be documented`);
  }
  for (const [id, op] of operations) {
    for (const status of Object.keys(op.responses)) {
      assert.ok(
        fixtures.some((item) => item.operationId === id && String(item.status) === status),
        `${id} is missing a ${status} fixture`,
      );
    }
    assert.ok(
      fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'auth_unavailable' && item.body.retryable === true),
      `${id} is missing the retryable auth-outage fixture`,
    );
    assert.ok(
      fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'feature_unavailable' && item.body.retryable === false),
      `${id} is missing the non-retryable feature-unavailable fixture`,
    );
  }
});

test('B03 schemas reject the drift that would cost somebody their answer', () => {
  const run = compiled('#/components/schemas/LunaRun');
  const conversation = fixtures.find((item) => item.name === 'lunaRunStatus-completed.json').body.conversation;
  // The one rule that loses an answer when it is broken.
  assert.equal(run({ id: 'r1', status: 'completed' }), false, 'a completed run without its conversation');
  assert.equal(run({ id: 'r1', status: 'queued' }), true, 'but a queued one needs none');
  assert.equal(run({ id: 'r1', status: 'done', conversation }), false, 'a status the client does not know');
  assert.equal(run({ id: '', status: 'queued' }), false, 'an empty run id');
  // Ruling L7 at the contract level: no proposal, no link list, no choice list.
  const message = compiled('#/components/schemas/LunaMessage');
  assert.equal(message({ id: 'm1', role: 'assistant', text: 'ok' }), true);
  assert.equal(
    message({ id: 'm1', role: 'assistant', text: 'ok', proposal: { id: 'p1', revision: 1 } }),
    false,
    'this release never attaches a proposal, so the contract forbids one',
  );
  assert.equal(message({ id: 'm1', role: 'user', text: 'q', evidence: [{ kind: 'fact', text: 'x', sourceIndexes: [0] }] }), false, 'evidence rides only on an answer');
  assert.equal(message({ id: 'm1', role: 'assistant', text: 'a', evidence: [{ kind: 'fact', text: 'x', sourceIndexes: [] }] }), false, 'a fact must cite a source');
  // A conversation a reload cannot use is not a conversation this backend sends.
  const conv = compiled('#/components/schemas/LunaConversationData');
  assert.equal(conv(conversation), true);
  for (const missing of ['pendingRequest', 'unresolvedOperations', 'revision']) {
    const bad = structuredClone(conversation);
    delete bad[missing];
    assert.equal(conv(bad), false, `${missing} is required: a reload recovers from it`);
  }
  assert.equal(conv({ ...conversation, revision: 0 }), false, 'revision 0 is rejected by the client');
  assert.equal(conv({ ...conversation, profile_id: 'owner' }), false, 'no owner marker may ride along');
  const source = { title: 'Agency', url: 'http://agency.example.test/x' };
  const insecure = structuredClone(conversation);
  insecure.messages[1].sources = [source];
  assert.equal(conv(insecure), false, 'a non-https source url sinks the whole conversation');
  // available:true means tools:[] in this contract version (Ruling L7).
  const caps = compiled('#/components/schemas/LunaCapabilities');
  const good = fixtures.find((item) => item.name === 'lunaCapabilities-available.json').body;
  assert.equal(caps(good), true);
  assert.equal(caps({ ...good, tools: ['luna.task.create'] }), false, 'a tool claimed while none is built');
  assert.equal(caps({ ...good, available: false }), false, 'an unavailable answer must say why');
  assert.equal(caps({ ...good, context: { tasks: false, home: false } }), false, 'all three context booleans are mandatory');
});

// ---------------------------------------------------------------------------
// The frontend's validators, transcribed. Every claim below is quoted from
// lib/frontend/production/luna-service.ts on
// origin/codex/october15-review-refinement, with the file:line the B03 contract
// digest cites. The client runs these on every payload and throws the whole
// thing away when one returns false.
// ---------------------------------------------------------------------------

/** `object` (luna-service.ts:12). */
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** `text` (luna-service.ts:13). Tab, LF and CR are permitted; the other control characters are not. */
const text = (value, max = 16000) =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

/** `parseCalendarDate` (date-input.ts:2-8), which `sourceInstant` calls. */
function parseCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** `sourceInstant` (luna-service.ts:14). */
const sourceInstant = (value) =>
  text(value, 100)
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
  && !!parseCalendarDate(value.slice(0, 10))
  && Number.isFinite(Date.parse(value));

/** `destinations` (luna-service.ts:15); the empty string is a member. */
const destinations = new Set(['', 'tests', 'maintenance', 'food', 'summary', 'journal', 'patterns', 'recap', 'outdoors', 'community', 'organizations', 'opportunities', 'projects', 'outreach', 'observations']);

/** `safeSourceUrl` (explore-service.ts:11). */
function safeSourceUrl(value) {
  if (!text(value, 3000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** `validLunaEvidence` (luna-service.ts:16-18), against the message's OWN source count. */
const validLunaEvidence = (value, sourceCount) =>
  Array.isArray(value) && value.length > 0 && value.length <= 20
  && value.every((block) =>
    object(block)
    && ['fact', 'interpretation', 'next-step'].includes(String(block.kind))
    && text(block.text, 3000) && !!block.text.trim()
    && Array.isArray(block.sourceIndexes) && block.sourceIndexes.length <= 30
    && new Set(block.sourceIndexes).size === block.sourceIndexes.length
    && block.sourceIndexes.every((index) => Number.isInteger(index) && index >= 0 && index < sourceCount)
    && (block.kind !== 'fact' || block.sourceIndexes.length > 0)
    && (block.scope === undefined || text(block.scope, 500))
    && (block.observedAt === undefined || sourceInstant(block.observedAt)));

/** `validLunaNavigation` (luna-service.ts:19). No route in this package emits a link. */
const validLunaNavigation = (value) =>
  object(value) && text(value.label, 160)
  && ['today', 'home', 'act', 'plan', 'settings', 'map'].includes(String(value.tab))
  && (value.destination === undefined || destinations.has(String(value.destination)))
  && (value.record === undefined || (text(value.record, 200) && /^[A-Za-z0-9:_-]+$/.test(value.record)))
  && (value.view === undefined || ['list', 'detail', 'new', 'edit'].includes(String(value.view)));

/** `validLunaProposal` (luna-service.ts:20). No route in this package emits a proposal (Ruling L7). */
const validLunaProposal = (value) =>
  object(value) && text(value.id, 200) && !!value.id
  && Number.isInteger(value.revision) && Number(value.revision) > 0
  && text(value.title, 500) && text(value.summary, 3000)
  && typeof value.destructive === 'boolean'
  && text(value.expiresAt, 100) && Number.isFinite(Date.parse(value.expiresAt))
  && ['review', 'applied', 'cancelled'].includes(String(value.status))
  && Array.isArray(value.changes) && value.changes.length <= 100
  && value.changes.every((change) => object(change) && text(change.label, 300) && text(change.before, 3000) && text(change.after, 3000))
  && (value.fields === undefined
    || (Array.isArray(value.fields) && value.fields.length <= 20
      && value.fields.every((field) => object(field) && text(field.name, 100) && /^[a-zA-Z][\w.:-]*$/.test(field.name)
        && text(field.label, 300) && ['text', 'date'].includes(String(field.kind)) && text(field.value, 3000))));

/** `validLunaConversation` (luna-service.ts:21-27), clause for clause. */
function validLunaConversation(value) {
  if (!object(value)) return false;
  if (Array.isArray(value.messages) && value.messages.some((message) => object(message) && message.evidence !== undefined
    && (message.role !== 'assistant' || !validLunaEvidence(message.evidence, Array.isArray(message.sources) ? message.sources.length : 0)))) return false;
  if (value.pendingRequest !== undefined && value.pendingRequest !== null
    && (!object(value.pendingRequest) || !text(value.pendingRequest.id, 200) || !value.pendingRequest.id
      || !text(value.pendingRequest.text, 1000)
      || (value.pendingRequest.runId !== undefined && !text(value.pendingRequest.runId, 200)))) return false;
  if (value.unresolvedOperations !== undefined
    && (!object(value.unresolvedOperations) || Object.keys(value.unresolvedOperations).length > 100
      || Object.entries(value.unresolvedOperations).some(([key, id]) => !key || key.length > 200 || !text(id, 200) || !id))) return false;
  return object(value) && text(value.id, 200) && !!value.id
    && Number.isInteger(value.revision) && Number(value.revision) > 0
    && Array.isArray(value.messages) && value.messages.length <= 500
    && new Set(value.messages.map((item) => (object(item) ? item.id : null))).size === value.messages.length
    && value.messages.every((message) => object(message) && text(message.id, 200) && !!message.id
      && ['user', 'assistant'].includes(String(message.role)) && text(message.text)
      && (message.sources === undefined
        || (Array.isArray(message.sources) && message.sources.length <= 30
          && message.sources.every((source) => object(source) && text(source.title, 500) && safeSourceUrl(source.url))))
      && (message.links === undefined
        || (Array.isArray(message.links) && message.links.length <= 20 && message.links.every(validLunaNavigation)))
      && (message.choices === undefined
        || (Array.isArray(message.choices) && message.choices.length <= 20 && message.choices.every((choice) => text(choice, 1000))))
      && (message.proposal === undefined || validLunaProposal(message.proposal)));
}

/** `validLunaRun` (luna-service.ts:28). The conversation is required when, and only when, completed. */
const validLunaRun = (value) =>
  object(value) && text(value.id, 200) && !!value.id
  && ['queued', 'generating', 'completed', 'failed', 'cancelled'].includes(String(value.status))
  && (value.message === undefined || text(value.message, 1000))
  && (value.conversation === undefined ? value.status !== 'completed' : validLunaConversation(value.conversation));

/** `validLunaCapabilities` (luna-service.ts:29). All seven members are mandatory. */
const validLunaCapabilities = (value) =>
  object(value) && typeof value.available === 'boolean'
  && text(value.providerLabel, 300) && text(value.retentionSummary, 2000)
  && typeof value.publicRetrieval === 'boolean'
  && object(value.context) && ['tasks', 'home', 'projects'].every((key) => typeof value.context[key] === 'boolean')
  && Array.isArray(value.tools) && value.tools.length <= 100 && value.tools.every((tool) => text(tool, 200));

/** `validLunaOperation` (luna-service.ts:31). Nothing in this package answers one; see the ledger test. */
const validLunaOperation = (value) =>
  object(value) && text(value.id, 200) && !!value.id
  && ['succeeded', 'failed', 'unknown', 'pending', 'cancelled'].includes(String(value.status))
  && (value.conversation === undefined || validLunaConversation(value.conversation))
  && (value.message === undefined || text(value.message, 1000));

const EM_DASH = '—';
/** Everything a Luna response must satisfy beyond its own validator. */
function acceptable(valid, body, label) {
  assert.equal(valid(body), true, `${label}: the client would discard this payload: ${JSON.stringify(body)}`);
  assert.equal(JSON.stringify(body).includes(EM_DASH), false, `${label}: no app-facing em dash (AGENTS.md)`);
}

test('the transcribed validators reject what the client rejects, in both directions', () => {
  const message = { id: 'm1', role: 'user', text: 'What is radon?' };
  const base = { id: 'c1', revision: 1, messages: [message], pendingRequest: null, unresolvedOperations: {} };
  assert.equal(validLunaConversation(base), true);

  // `validLunaRun`'s required-by-status rule, BOTH ways round. Getting either
  // backwards is silent in the route's own suite and costs a person an answer.
  assert.equal(validLunaRun({ id: 'r1', status: 'completed' }), false, 'a completed run MUST carry its conversation');
  assert.equal(validLunaRun({ id: 'r1', status: 'completed', conversation: base }), true);
  assert.equal(validLunaRun({ id: 'r1', status: 'queued' }), true, 'and a queued one need not');
  assert.equal(validLunaRun({ id: 'r1', status: 'queued', conversation: base }), true, 'but may, and that is accepted');
  assert.equal(validLunaRun({ id: 'r1', status: 'queued', conversation: { ...base, revision: 0 } }), false, 'a conversation that IS present must still validate');
  assert.equal(validLunaRun({ id: '', status: 'queued' }), false);
  assert.equal(validLunaRun({ id: 'r1', status: 'pending' }), false, 'a run has no pending status');
  assert.equal(validLunaRun({ id: 'r1', status: 'failed', message: 'x'.repeat(1001) }), false);

  // The conversation clauses that a backend is most likely to break.
  assert.equal(validLunaConversation({ ...base, revision: 0 }), false, 'revision must be above 0');
  assert.equal(validLunaConversation({ ...base, revision: 1.5 }), false);
  assert.equal(validLunaConversation({ ...base, id: '' }), false);
  assert.equal(validLunaConversation({ ...base, messages: [message, message] }), false, 'duplicate message ids');
  assert.equal(validLunaConversation({ ...base, messages: [{ ...message, role: 'system' }] }), false);
  assert.equal(validLunaConversation({ ...base, messages: [{ ...message, text: 'a\u0007b' }] }), false, 'a control character');
  assert.equal(validLunaConversation({ ...base, messages: [{ ...message, text: 'line\nbreak\tand\rreturn' }] }), true, 'but not tab, LF or CR');
  assert.equal(validLunaConversation({ ...base, pendingRequest: { id: 'p', text: 'x'.repeat(1001) } }), false);
  assert.equal(validLunaConversation({ ...base, pendingRequest: { id: '', text: 'q' } }), false);

  // Sources and evidence: the indexes point into the message's own sources.
  const sourced = (sources, evidence) => validLunaConversation({
    ...base,
    messages: [{ id: 'a1', role: 'assistant', text: 'answer', sources, evidence }],
  });
  const source = { title: 'Agency', url: 'https://agency.example.test/radon' };
  assert.equal(sourced([source], [{ kind: 'fact', text: 'what it says', sourceIndexes: [0] }]), true);
  assert.equal(sourced([source], [{ kind: 'fact', text: 'what it says', sourceIndexes: [1] }]), false, 'an index past the sources');
  assert.equal(sourced([source], [{ kind: 'fact', text: 'what it says', sourceIndexes: [] }]), false, 'a fact citing nothing');
  assert.equal(sourced([source], [{ kind: 'next-step', text: 'test first', sourceIndexes: [] }]), true, 'a next-step may cite nothing');
  assert.equal(sourced([source], []), false, 'an empty evidence list is rejected');
  assert.equal(sourced([{ title: 'Agency', url: 'http://agency.example.test' }], undefined), false, 'http');
  assert.equal(sourced([{ title: 'Agency', url: 'javascript:alert(1)' }], undefined), false, 'a javascript url');
  assert.equal(sourced([{ title: 'Agency', url: 'https://user:pw@agency.example.test/x' }], undefined), false, 'embedded credentials');
  assert.equal(sourced([source], [{ kind: 'fact', text: 'x', sourceIndexes: [0], observedAt: '2026-10-15' }]), false, 'a date is not an instant');
  assert.equal(sourced([source], [{ kind: 'fact', text: 'x', sourceIndexes: [0], observedAt: '2026-10-15T12:00:00Z' }]), true);

  // Capabilities: all seven, and the extra `reason` the backend adds is tolerated.
  const caps = { available: true, providerLabel: 'L', retentionSummary: 'R', publicRetrieval: false, context: { tasks: false, home: false, projects: false }, tools: [] };
  assert.equal(validLunaCapabilities(caps), true);
  assert.equal(validLunaCapabilities({ ...caps, reason: 'off' }), true, 'the validator is a conjunction of positive checks, so an eighth field is tolerated');
  for (const key of ['available', 'providerLabel', 'retentionSummary', 'publicRetrieval', 'context', 'tools']) {
    const bad = { ...caps };
    delete bad[key];
    assert.equal(validLunaCapabilities(bad), false, `${key} is mandatory`);
  }
  assert.equal(validLunaCapabilities({ ...caps, context: { tasks: false, home: false } }), false);
  assert.equal(validLunaCapabilities({ ...caps, tools: ['x'.repeat(201)] }), false);

  // The navigation and proposal clauses, which nothing here emits but the
  // transcription still has to be faithful about.
  assert.equal(validLunaNavigation({ label: 'Open my tests', tab: 'home', destination: 'tests' }), true);
  assert.equal(validLunaNavigation({ label: 'Nowhere', tab: 'inbox' }), false);
  assert.equal(validLunaNavigation({ label: 'x', tab: 'home', destination: 'nowhere' }), false);
  assert.equal(validLunaProposal({ id: 'p1', revision: 1, title: 't', summary: 's', destructive: false, expiresAt: '2026-10-19T00:00:00Z', status: 'review', changes: [] }), true);
  assert.equal(validLunaProposal({ id: 'p1', revision: 0, title: 't', summary: 's', destructive: false, expiresAt: '2026-10-19T00:00:00Z', status: 'review', changes: [] }), false);
  assert.equal(validLunaOperation({ id: 'o1', status: 'unknown' }), true);
  assert.equal(validLunaOperation({ operationId: 'o1', status: 'succeeded' }), false, 'the receipt id must be `id`');
});

// ---------------------------------------------------------------------------
// The harness: the real handlers, on an in-memory database and a fake provider
// ---------------------------------------------------------------------------

const TABLES = haloTables('profiles', 'operations', 'luna_conversations', 'luna_turns', 'luna_runs');
const REQUEST_ID = 'b03-conformance-0001';

/** A deployment that can answer: the flag on, a model key, and both model ids named (Ruling L1). */
const ON = Object.freeze({
  HALO_FEATURE_LUNA: 'on',
  ASSISTANT_MODEL_KEY: 'synthetic-contract-key',
  ASSISTANT_EMBED_MODEL: 'synthetic-embed-model',
  ASSISTANT_CHAT_MODEL: 'synthetic-chat-model',
});

const EMBED_URL = 'https://api.openai.com/v1/embeddings';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const EMBED_DIM = 1536;
const uuid = (n) => `0b030000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const QUESTION = 'What does the agency say about radon in a basement?';

/** The provider, faked. Any other host throws, so a route reaching one breaks a test. */
function provider(answer = 'Radon collects in the lowest level of a home [1].') {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    calls.push(url);
    if (url === EMBED_URL) return Response.json({ data: [{ embedding: new Array(EMBED_DIM).fill(0.01) }] });
    if (url === CHAT_URL) return Response.json({ choices: [{ message: { content: answer } }] });
    throw new Error(`contractsB03: unexpected fetch to ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function harness({ tables = TABLES, rateLimit, answer } = {}) {
  const fetchImpl = provider(answer);
  const h = createRouteHarness({
    tables,
    rateLimit,
    fetch: fetchImpl,
    seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id }, { id: bob.id }] }),
  });
  h.db.registerRpc('match_assistant_corpus', () => [{
    id: 'p1',
    source_label: 'Radon and your home',
    source_url: 'https://agency.example.test/radon',
    retrieved: '2026-01-01',
    passage: 'Radon collects in the lowest level of a home. Test before anything else.',
    similarity: 0.92,
  }]);
  h.provider = fetchImpl;
  return h;
}

// The two headers this contract documents. Conformance checks both directions,
// for the operation and status pairs the tests below actually exercise: a
// header that is sent must be documented, and a documented header must really
// be sent by one of them.
const CHECKED_HEADERS = ['x-request-id', 'retry-after'];
const seenHeaders = new Map();
const documentedHeaders = (id, status) =>
  new Set(Object.keys(operations.get(id).responses[String(status)].headers ?? {}).map((name) => name.toLowerCase()));

function recordHeaders(id, res) {
  const key = `${id} ${res.status}`;
  const documented = documentedHeaders(id, res.status);
  if (!seenHeaders.has(key)) seenHeaders.set(key, new Set());
  for (const name of CHECKED_HEADERS) {
    if (res.headers.get(name) === null) continue;
    seenHeaders.get(key).add(name);
    assert.ok(documented.has(name), `${key}: the response sends ${name} but the contract does not document it`);
  }
}

/**
 * One call to a real handler, checked against the document on the way back.
 *
 * Every response goes through the documented schema for its status, and the
 * `x-request-id` the caller sent is asserted to come back, because the client
 * correlates its own logs with it and an error body also carries it.
 */
async function call(h, id, { expected = 200, env = ON, ...overrides } = {}) {
  const op = operations.get(id);
  const res = await h.call(op.path, op.method, {
    as: 'alice',
    env,
    ...overrides,
    headers: { 'x-request-id': REQUEST_ID, ...overrides.headers },
  });
  assert.equal(res.status, expected, `${id}: expected ${expected}, got ${res.status}`);
  assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${id}: the request id is echoed`);
  recordHeaders(id, res);
  const body = await res.json();
  validate(id, res.status, body);
  if (expected >= 400) {
    assert.equal(body.request_id, REQUEST_ID);
    assert.equal(
      /supabase|postgres|PGRST|openai|openrouter|upstash|redis|bearer/i.test(JSON.stringify(body)),
      false,
      `${id} ${expected}: nothing proof-bearing in an error envelope`,
    );
  }
  return { body, res };
}

/** The body the production component sends (ProductionLunaConversation.tsx:50), validated as documented. */
function messageBody({ id = uuid(1), conversationId = null, text: question = QUESTION, page = 'Homeguard', noteContext = [] } = {}) {
  const body = { clientMessageId: id, conversationId, text: question, page, noteContext };
  validateRequest('lunaMessage', body);
  return body;
}

const ask = (h, body, options = {}) =>
  call(h, 'lunaMessage', { body, headers: { 'idempotency-key': body.clientMessageId }, ...options });
const readConversation = (h, options = {}) =>
  call(h, 'lunaConversation', { url: '/api/luna/conversations?current=true', ...options });
const runStatus = (h, id, options = {}) =>
  call(h, 'lunaRunStatus', { url: `/api/luna/runs/status?id=${encodeURIComponent(id)}`, ...options });

function cancelBody(id) {
  const body = { id };
  validateRequest('lunaRunCancel', body);
  return body;
}
const stop = (h, id, { key = `cancel:${uuid(1)}`, ...options } = {}) =>
  call(h, 'lunaRunCancel', { body: cancelBody(id), headers: { 'idempotency-key': key }, ...options });

function clearBody(id, revision) {
  const body = { id, revision };
  validateRequest('lunaClear', body);
  return body;
}
const clear = (h, id, revision, { key = uuid(90), ...options } = {}) =>
  call(h, 'lunaClear', {
    body: clearBody(id, revision),
    headers: { 'idempotency-key': key, 'if-match': String(revision) },
    ...options,
  });

// ---------------------------------------------------------------------------
// Handler conformance: every state each route can answer with
// ---------------------------------------------------------------------------

test('B03 handler conformance: capabilities answers the three facts, each in its own shape', async (t) => {
  muteConsoleError(t);
  const h = harness();

  const { body: on } = await call(h, 'lunaCapabilities');
  acceptable(validLunaCapabilities, on, 'capabilities, on');
  assert.equal(on.available, true);
  assert.deepEqual(on.tools, [], 'Ruling L7: the contract\'s own way to say no permitted tool');
  assert.equal('reason' in on, false);

  // Ruling L11: the endpoint whose job is to report availability reports it.
  // On its own harness, because "nothing is read" is a claim about the whole
  // query log and the call above has already read the schema probe.
  const quiet = harness();
  const { body: off } = await call(quiet, 'lunaCapabilities', { env: {} });
  acceptable(validLunaCapabilities, off, 'capabilities, flag off');
  assert.equal(off.available, false);
  assert.ok(off.reason, 'and says why');
  assert.deepEqual(quiet.db.queryLog, [], 'off means off: nothing is read at all');

  // Ruling L13: on, but with nothing to answer with.
  const { body: keyless } = await call(h, 'lunaCapabilities', { env: { HALO_FEATURE_LUNA: 'on' } });
  acceptable(validLunaCapabilities, keyless, 'capabilities, no provider key');
  assert.equal(keyless.available, false);

  await call(h, 'lunaCapabilities', { as: null, expected: 401 });
  h.forceAuthOutage();
  const { body: down, res } = await call(h, 'lunaCapabilities', { expected: 503 });
  assert.equal(down.code, 'auth_unavailable');
  assert.equal(res.headers.get('retry-after'), '2');
});

test('B03 handler conformance: the conversation read answers either a conversation or the absence of one', async (t) => {
  muteConsoleError(t);
  const h = harness();

  // Ruling L10: this read writes nothing, so a new household gets the absent
  // shape rather than a freshly minted conversation.
  const { body: absent } = await readConversation(h);
  assert.deepEqual(absent, { conversation: null });
  assert.equal(
    validLunaConversation(absent),
    false,
    'and that is deliberately NOT a valid conversation: there is no valid empty one, and the client sends conversationId:null to mean start one',
  );
  assert.deepEqual(h.db.rows('luna_conversations'), [], 'nothing was created by reading');

  await ask(h, messageBody());
  const { body: present } = await readConversation(h);
  acceptable(validLunaConversation, present, 'conversation read');
  assert.deepEqual(present.messages.map((m) => [m.role, m.text]), [['user', QUESTION]]);
  assert.equal(present.pendingRequest.text, QUESTION, 'a reload parks the question again from here');
  assert.deepEqual(present.unresolvedOperations, {}, 'always empty: this release emits no proposal');

  await readConversation(h, { as: null, expected: 401 });
  h.forceAuthOutage();
  const { res } = await readConversation(h, { expected: 503 });
  assert.equal(res.headers.get('retry-after'), '2');
});

test('B03 handler conformance: a message answers a run that already carries the person\'s own turn', async (t) => {
  muteConsoleError(t);
  const h = harness();

  const { body: queued } = await ask(h, messageBody());
  acceptable(validLunaRun, queued, 'messages, queued');
  assert.equal(queued.status, 'queued');
  // Ruling L12. `runs/status` omits the conversation while a run is queued, so
  // if this route omitted it too the person would see no trace of their own
  // question for the whole wait.
  assert.ok(queued.conversation, 'the conversation is attached whatever the status');
  assert.deepEqual(queued.conversation.messages.map((m) => m.role), ['user']);

  // A refusal needs no model, so it is a completed run on the first answer.
  const { body: refused } = await ask(h, messageBody({ id: uuid(2), text: 'Do I have asthma?' }));
  acceptable(validLunaRun, refused, 'messages, refusal');
  assert.equal(refused.status, 'completed');
  assert.ok(refused.conversation, 'a completed run MUST carry its conversation');

  await ask(h, messageBody({ id: uuid(3) }), { as: null, expected: 401 });
  await call(h, 'lunaMessage', {
    body: { clientMessageId: uuid(4), conversationId: null, text: '', page: 'Homeguard', noteContext: [] },
    headers: { 'idempotency-key': uuid(4) },
    expected: 400,
  });
  await call(h, 'lunaMessage', { rawBody: '{', headers: { 'idempotency-key': uuid(5) }, expected: 400 });
  await call(h, 'lunaMessage', { rawBody: JSON.stringify({ padding: 'x'.repeat(40_000) }), expected: 413 });
  await ask(h, messageBody({ id: uuid(6), conversationId: uuid(600) }), { expected: 404 });
  // One clientMessageId, a different question: a client bug or an attack.
  await ask(h, messageBody({ id: uuid(1), text: 'Something else entirely' }), { expected: 409 });
  // The capability off, and a deployment with no model to answer with.
  await ask(h, messageBody({ id: uuid(7) }), { env: {}, expected: 503 });
  await ask(h, messageBody({ id: uuid(8) }), { env: { HALO_FEATURE_LUNA: 'on' }, expected: 503 });

  h.forceAuthOutage();
  const { res } = await ask(h, messageBody({ id: uuid(9) }), { expected: 503 });
  assert.equal(res.headers.get('retry-after'), '2');
});

test('B03 handler conformance: a budget that ran out is a 429, and a failure deep inside is the 500 envelope', async (t) => {
  muteConsoleError(t);
  const limited = harness({ rateLimit: () => false });
  const { body } = await ask(limited, messageBody(), { expected: 429 });
  assert.equal(body.retryable, true);
  assert.deepEqual(limited.db.rows('luna_runs'), [], 'a refused question creates no run');

  // The only 500 the harness can provoke honestly: an unexpected failure deep
  // inside the handler, which must still answer in the documented envelope.
  const broken = harness({ rateLimit: () => { throw new Error('contractsB03: the limiter blew up'); } });
  const { body: internal } = await ask(broken, messageBody(), { expected: 500 });
  assert.equal(internal.code, 'internal_error');
  assert.equal(internal.retryable, true);
});

test('B03 handler conformance: runs/status reports every state, and an id with no run is a failed run', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: queued } = await ask(h, messageBody());

  const { body: polled } = await runStatus(h, queued.id);
  acceptable(validLunaRun, polled, 'runs/status, queued');
  assert.equal(polled.status, 'queued');
  assert.equal('conversation' in polled, false, 'a transcript that has not changed is not re-sent every second');

  // The client may poll with its own message id before a run id is known, and
  // the answer always carries the canonical run id.
  const { body: byClientId } = await runStatus(h, uuid(1));
  assert.equal(byClientId.id, queued.id, 'LunaRun.id is the canonical run id, whichever key was asked with');

  await h.runAfter({ fetch: h.provider, env: ON });
  const { body: done } = await runStatus(h, queued.id);
  acceptable(validLunaRun, done, 'runs/status, completed');
  assert.equal(done.status, 'completed');
  assert.ok(done.conversation);
  const answer = done.conversation.messages.at(-1);
  assert.equal(answer.role, 'assistant');
  assert.equal(answer.text.includes('[1]'), false, 'the inline markers are removed: the client prints text verbatim');
  assert.ok(answer.sources.length && answer.evidence.length, 'and the answer is cited');

  // An id this household has no run for: failed, never a 404, because the
  // client stops polling only on a terminal status.
  const { body: unknown } = await runStatus(h, uuid(700));
  acceptable(validLunaRun, unknown, 'runs/status, unknown id');
  assert.equal(unknown.status, 'failed');
  assert.ok(unknown.message, 'and the sentence says the question is kept');

  await runStatus(h, 'x'.repeat(201), { expected: 400 });
  await runStatus(h, queued.id, { as: null, expected: 401 });
  await runStatus(h, queued.id, { env: {}, expected: 503 });
  h.forceAuthOutage();
  const { res } = await runStatus(h, queued.id, { expected: 503 });
  assert.equal(res.headers.get('retry-after'), '2');
});

test('B03 handler conformance: runs/cancel answers a terminal run, and replays its first outcome', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: queued } = await ask(h, messageBody());

  const { body: stopped } = await stop(h, queued.id);
  acceptable(validLunaRun, stopped, 'runs/cancel');
  assert.ok(['cancelled', 'completed', 'failed'].includes(stopped.status), 'anything else is reported as unconfirmed');
  assert.ok(stopped.conversation, 'a terminal run carries the kept question back');

  const { body: replayed } = await stop(h, queued.id);
  assert.deepEqual(replayed, stopped, 'the same key is the same attempt, with the same answer');

  const { body: unknown } = await stop(h, uuid(701), { key: `cancel:${uuid(2)}` });
  assert.equal(unknown.status, 'failed', 'an id with no run, never a 404');

  await stop(h, queued.id, { key: null, headers: {}, expected: 400 });
  await call(h, 'lunaRunCancel', { rawBody: '{', headers: { 'idempotency-key': `cancel:${uuid(3)}` }, expected: 400 });
  await call(h, 'lunaRunCancel', {
    rawBody: JSON.stringify({ padding: 'x'.repeat(4000) }),
    headers: { 'idempotency-key': `cancel:${uuid(4)}` },
    expected: 413,
  });
  // One key, a different run: a conflict, never the first run's outcome.
  await stop(h, uuid(702), { key: `cancel:${uuid(1)}`, expected: 409 });
  await stop(h, queued.id, { as: null, expected: 401 });
  await stop(h, queued.id, { env: {}, expected: 503 });
  h.forceAuthOutage();
  const { res } = await stop(h, queued.id, { key: `cancel:${uuid(5)}`, expected: 503 });
  assert.equal(res.headers.get('retry-after'), '2');
});

test('B03 handler conformance: clear answers the receipt the client will accept, and refuses in every documented way', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: queued } = await ask(h, messageBody());
  const conversationId = queued.conversation.id;

  // A run is still working, so clearing would strand it.
  const open = await clear(h, conversationId, queued.conversation.revision, { key: uuid(91), expected: 409 });
  assert.equal(open.body.reason, 'run_open');

  await h.runAfter({ fetch: h.provider, env: ON });
  const { body: before } = await readConversation(h);
  const { body: cleared } = await clear(h, conversationId, before.revision);
  acceptable(validLunaConversation, cleared, 'clear receipt');
  // ProductionLunaClear.ts:19 throws away a receipt that has messages, or the
  // same id with a revision that did not advance.
  assert.deepEqual(cleared.messages, []);
  assert.equal(cleared.id, conversationId, 'the id is kept, so a live session is not stranded');
  assert.ok(cleared.revision > before.revision, 'and the revision strictly advances');

  const { body: replayed } = await clear(h, conversationId, before.revision);
  assert.deepEqual(replayed, cleared, 'a replay answers the first outcome and does not clear twice');

  const stale = await clear(h, conversationId, before.revision, { key: uuid(92), expected: 409 });
  assert.equal(stale.body.reason, 'stale_revision');
  assert.equal(stale.body.revision, cleared.revision, 'and says what to reload from');

  const foreign = await clear(h, uuid(800), 1, { key: uuid(93), expected: 409 });
  assert.equal(foreign.body.reason, 'unknown_conversation');

  // One operation id, different input.
  const mismatch = await clear(h, conversationId, cleared.revision, { key: uuid(92), expected: 409 });
  assert.equal(mismatch.body.reason, 'operation_mismatch');

  await call(h, 'lunaClear', {
    body: { id: conversationId, revision: 0 },
    headers: { 'idempotency-key': uuid(94) },
    expected: 400,
  });
  await call(h, 'lunaClear', { rawBody: '{', headers: { 'idempotency-key': uuid(95) }, expected: 400 });
  await call(h, 'lunaClear', { rawBody: JSON.stringify({ padding: 'x'.repeat(2000) }), expected: 413 });
  await clear(h, conversationId, cleared.revision, { key: uuid(96), as: null, expected: 401 });
  await clear(h, conversationId, cleared.revision, { key: uuid(97), env: {}, expected: 503 });
  h.forceAuthOutage();
  const { res } = await clear(h, conversationId, cleared.revision, { key: uuid(98), expected: 503 });
  assert.equal(res.headers.get('retry-after'), '2');
});

test('B03 handler conformance: an attempt that never settled is an unconfirmed outcome, not a second clear', async (t) => {
  muteConsoleError(t);
  const h = harness();
  await ask(h, messageBody());
  await h.runAfter({ fetch: h.provider, env: ON });
  const { body: conversation } = await readConversation(h);

  // A ledger row claimed by an attempt that died before settling. A 5xx on a
  // mutation is this client's own designed path for "the outcome is not
  // confirmed, go and check" (runtime.ts:144,156).
  h.db.seed('operations', [{
    operation_id: uuid(99),
    profile_id: h.identities.alice.id,
    domain: 'luna',
    kind: 'luna.clear',
    status: 'pending',
    input_fingerprint: 'unsettled',
    created_at: new Date().toISOString(),
  }]);
  const { body } = await clear(h, conversation.id, conversation.revision, { key: uuid(99), expected: 503 });
  assert.equal(body.code, 'upstream_unavailable');
  assert.equal(body.retryable, true, 'unlike the missing-migration 503: that earlier attempt will settle');
  assert.equal(h.db.rows('luna_turns').length, conversation.messages.length, 'and nothing was cleared to find out which');
});

test('B03 handler conformance: before migration 0020 every Luna route reports the feature unavailable', async (t) => {
  muteConsoleError(t);
  const h = harness({ tables: haloTables('profiles', 'operations') });
  const expectations = [
    ['lunaCapabilities', () => call(h, 'lunaCapabilities', { expected: 503 })],
    ['lunaConversation', () => readConversation(h, { expected: 503 })],
    ['lunaMessage', () => ask(h, messageBody(), { expected: 503 })],
    ['lunaRunStatus', () => runStatus(h, uuid(1), { expected: 503 })],
    ['lunaRunCancel', () => stop(h, uuid(1), { expected: 503 })],
    ['lunaClear', () => clear(h, uuid(800), 1, { expected: 503 })],
  ];
  for (const [id, run] of expectations) {
    const { body, res } = await run();
    assert.equal(body.code, 'feature_unavailable', `${id}: a deployment fault is reported as one`);
    assert.equal(body.retryable, false, `${id}: retrying cannot apply a migration`);
    assert.equal(res.headers.get('retry-after'), null, `${id}: and nothing suggests waiting`);
  }
  assert.deepEqual(h.db.rows('operations'), [], 'no operation id is claimed for a request this deployment cannot serve');
});

// ---------------------------------------------------------------------------
// Cross-route agreement, which is what nothing before this file checked
// ---------------------------------------------------------------------------

test('every route that returns a conversation returns the IDENTICAL conversation, because the client validates all of them with one function', async (t) => {
  muteConsoleError(t);
  const h = harness();

  // While a run is open: the POST's conversation and the read's must agree, or
  // the client's adoption rule (same id, greater revision) sees two histories.
  const { body: queued } = await ask(h, messageBody());
  const { body: whileOpen } = await readConversation(h);
  assert.deepEqual(whileOpen, queued.conversation, 'POST /messages and GET /conversations, with a run in flight');

  // Once it is answered: the read, the poll and a cancel of the settled run.
  await h.runAfter({ fetch: h.provider, env: ON });
  const { body: afterAnswer } = await readConversation(h);
  const { body: polled } = await runStatus(h, queued.id);
  assert.deepEqual(polled.conversation, afterAnswer, 'GET /runs/status and GET /conversations');
  const { body: stopped } = await stop(h, queued.id);
  assert.deepEqual(stopped.conversation, afterAnswer, 'POST /runs/cancel and GET /conversations');

  // And after a clear, the receipt is the same object the read answers with.
  const { body: cleared } = await clear(h, afterAnswer.id, afterAnswer.revision);
  const { body: reread } = await readConversation(h);
  assert.deepEqual(cleared, reread, 'POST /conversations/clear and GET /conversations');

  // One key set across all five, so a client cannot find a field on one route
  // and not another.
  const keys = (value) => Object.keys(value).sort();
  const expected = ['id', 'messages', 'pendingRequest', 'revision', 'unresolvedOperations'];
  for (const [label, value] of [
    ['messages', queued.conversation], ['conversations', afterAnswer], ['runs/status', polled.conversation],
    ['runs/cancel', stopped.conversation], ['clear', cleared],
  ]) {
    assert.deepEqual(keys(value), expected, `${label} returns the same five members`);
    acceptable(validLunaConversation, value, `${label} conversation`);
  }
});

test('the two run routes answer the same run with the same shape, and apply the same conversation rule', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: queued } = await ask(h, messageBody());

  // Non-terminal: neither route may report work in progress with a transcript
  // attached, and the client treats a non-terminal cancel as unconfirmed.
  const { body: polled } = await runStatus(h, queued.id);
  assert.equal('conversation' in polled, false);

  // Terminal: the cancel settles it, and then both routes answer identically
  // for the same id. This is the assertion that would catch the two routes
  // drifting apart, which is why the five-line shape they share was left
  // duplicated rather than hoisted.
  const { body: stopped } = await stop(h, queued.id);
  const { body: after } = await runStatus(h, queued.id);
  assert.deepEqual(after, stopped, 'runs/status and runs/cancel agree on a settled run, field for field');

  // And an id with no run gets the same answer from both.
  const missing = uuid(703);
  const { body: statusUnknown } = await runStatus(h, missing);
  const { body: cancelUnknown } = await stop(h, missing, { key: `cancel:${uuid(6)}` });
  assert.deepEqual(statusUnknown, cancelUnknown, 'and on an id neither of them has a run for');
  assert.equal(statusUnknown.status, 'failed');
});

test('the Luna ledger replays receipts that carry no question and no answer, and no Luna route answers a LunaOperation', async (t) => {
  muteConsoleError(t);
  const h = harness();
  const { body: queued } = await ask(h, messageBody());
  await h.runAfter({ fetch: h.provider, env: ON });
  const { body: conversation } = await readConversation(h);
  await stop(h, queued.id, { key: `cancel:${uuid(1)}` });
  await clear(h, conversation.id, conversation.revision);

  // 0017:41-42 and BE-313: `result` is a receipt, not record content. A Luna
  // conversation is the most sensitive free text in this package, and
  // GET /api/operations?domain=luna replays whatever is stored, so what is
  // stored has to be safe to replay.
  const receipts = h.db.rows('operations').filter((row) => row.domain === 'luna');
  assert.equal(receipts.length, 3, 'one per mutation: the message, the cancel and the clear');
  for (const row of receipts) {
    const serialized = JSON.stringify(row.result ?? null);
    assert.equal(serialized.includes(QUESTION), false, `${row.kind}: the question is content, not a receipt`);
    assert.equal(serialized.includes('Radon collects'), false, `${row.kind}: nor is the answer`);
    assert.equal(row.profile_id, h.identities.alice.id, 'and the receipt is owned by the caller');
  }
  const clearReceipt = receipts.find((row) => row.kind === 'luna.clear').result;
  assert.deepEqual(clearReceipt.conversation.messages, [], 'the one receipt that holds a conversation holds an empty one');

  // `luna.operation` is GET /api/luna/operations, which this package does not
  // build. The B02 ledger route is a different registry entry and a different
  // shape, and the client never asks it for a Luna receipt.
  assert.equal('/api/luna/operations' in contract.paths, false);
  assert.equal(
    validLunaOperation({ ...clearReceipt, operationId: receipts[0].operation_id, status: 'succeeded' }),
    false,
    'a stored Luna receipt is not a LunaOperation: it has no `id`',
  );
});

test('no B03 fixture carries a secret, a token, a real address or anything proof-bearing', () => {
  const forbidden = [
    /sk-[A-Za-z0-9]/, /Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/,
    /api[_-]?key/i, /secret/i, /password/i, /authorization/i,
    /supabase|upstash|openrouter|openai|mapbox/i,
    /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/,
    /\b\d{3}-\d{2}-\d{4}\b/,
  ];
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture.body);
    for (const pattern of forbidden) {
      assert.equal(pattern.test(serialized), false, `${fixture.name} matches ${pattern}`);
    }
    assert.equal(serialized.includes(EM_DASH), false, `${fixture.name}: no app-facing em dash`);
    // Every url in a fixture is a reserved example host, so nothing points at a
    // real source and no fixture can be mistaken for evidence of one.
    for (const url of serialized.match(/https:\/\/[^"]+/g) ?? []) {
      assert.match(url, /^https:\/\/[a-z0-9.-]*example\.test(\/|$)/, `${fixture.name}: ${url} is not a reserved example host`);
    }
  }
});

// Runs last: tests in one file run in order, so by now every exercised pair has
// been recorded. Only pairs the tests above reached are compared, so a status
// the harness cannot provoke is never claimed as checked.
test('B03 contract headers: every documented header is really sent, for the pairs these tests exercise', () => {
  assert.ok(seenHeaders.size > 0, 'no conformance responses were recorded');
  for (const [key, seen] of seenHeaders) {
    const [id, status] = key.split(' ');
    for (const name of documentedHeaders(id, status)) {
      if (CHECKED_HEADERS.includes(name)) {
        assert.ok(seen.has(name), `${key}: the contract documents ${name} but no exercised response sent it`);
      }
    }
  }
});
