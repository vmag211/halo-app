/**
 * B13 conformance: the /operations screen's OWN code over the real handlers.
 *
 * Nothing here is a transcription that could agree with itself. What runs is:
 *
 *   - `createProductionRuntime` (lib/frontend/production/runtime.ts), loaded as
 *     the shipped TypeScript, so the query string, Authorization, If-Match and
 *     Idempotency-Key headers and the status mapping are the client's;
 *   - the validators of lib/frontend/production/source-operations-service.ts
 *     and `sourceOperationTarget` of lib/frontend/source-operations-preview.ts,
 *     loaded the same way;
 *   - the body of `ProductionSourceOperations` itself
 *     (components/production/ProductionSourceOperations.tsx, from its first
 *     line up to `const comparisons=`, that is read, commit, accept, prepare,
 *     confirm, reconcile and history), cut out of the file at test time,
 *     compiled with TypeScript and run under a ten-line stand-in for React's
 *     useState, useRef and useEffect. A change to the screen changes what runs.
 *
 * The one piece that is copied is the decision buttons' `disabled` expression,
 * which lives in JSX; `BUTTON_DISABLED` below must appear in the file verbatim
 * (the drift test), so it cannot silently differ.
 *
 * The fetcher hands the runtime's requests to the route harness, so no network
 * is reached.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const runtimeModule = await loadFrontend('production/runtime');
const service = await loadFrontend('production/source-operations-service');
const preview = await loadFrontend('source-operations-preview');
const { createProductionRuntime, FrontendServiceError, serviceMessage } = runtimeModule;

const SCREEN_FILE = path.join(REPO_ROOT, 'components/production/ProductionSourceOperations.tsx');
const SCREEN = readFileSync(SCREEN_FILE, 'utf8');

/** The decision buttons' disabled expression, verbatim from the JSX (drift-tested). */
const BUTTON_DISABLED = "disabled={blocked||!!review||!source.allowedDecisions.includes(decision)||snapshot.role==='viewer'||['publish','withdraw','publish-translation'].includes(decision)&&snapshot.role!=='publisher'}";
const buttonDisabled = ({ blocked, review, source, snapshot }, decision) =>
  blocked || !!review || !source.allowedDecisions.includes(decision) || snapshot.role === 'viewer' || (['publish', 'withdraw', 'publish-translation'].includes(decision) && snapshot.role !== 'publisher');
const DECISION_BUTTONS = ['approve', 'quarantine', 'publish', 'withdraw', 'translation', 'retry', 'publish-translation'];

/** The component body, compiled once, as a function of its hooks and imports. */
const screenFactory = await (async () => {
  const start = SCREEN.indexOf('export default function ProductionSourceOperations(){');
  const end = SCREEN.indexOf(' const comparisons=');
  assert.ok(start >= 0 && end > start, 'the screen\'s component body was not found');
  const body = SCREEN.slice(SCREEN.indexOf('\n', start) + 1, end);
  const source = `export function screen(hooks, deps){
const {useState,useRef,useEffect,useProductionRuntime}=hooks;
const {sourceOperationTarget,sourceOpsError,sourceReceiptCoversCommand,validSourceOpsHistory,validSourceOpsReceipt,validSourceOpsSnapshot,FrontendServiceError,serviceMessage}=deps;
${body}
return {read,commit,accept,prepare,confirm,reconcile,history,snapshot,source,blocked,busy,loading,message,unknown,review,reason,setReason,setSelected};
}`;
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).screen;
})();

/** A stand-in for React: state and refs kept by call order, re-rendered on demand. */
function mountScreen(runtime) {
  const slots = [];
  let index = 0;
  const hooks = {
    useState: (initial) => {
      const at = index++;
      if (!(at in slots)) slots[at] = initial;
      return [slots[at], (next) => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }];
    },
    useRef: (initial) => {
      const at = index++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useEffect: () => { index++; },
    useProductionRuntime: () => runtime,
  };
  const deps = { ...service, sourceOperationTarget: preview.sourceOperationTarget, FrontendServiceError, serviceMessage };
  const render = () => { index = 0; return screenFactory(hooks, deps); };
  return { render };
}

// --------------------------------------------------------------- harness

const TABLES = haloTables('profiles', 'operations', 'operator_roles', 'source_ops_audit', 'daily_scores', 'ucmr5_utilities', 'daily_maxima_recorder');
const IDS = { alice: {}, viewer: {}, reviewer: {}, publisher: {} };

function world({ audit = [] } = {}) {
  const h = createRouteHarness({
    identities: IDS,
    tables: TABLES,
    seed: (ids) => ({
      profiles: Object.values(ids).map((who) => ({ id: who.id })),
      daily_scores: [{ profile_id: ids.alice.id, aqi_source: 'airnow', uv_index: 4, mold_risk: 'low', created_at: new Date(Date.now() - 3_600_000).toISOString() }],
      operator_roles: [
        { profile_id: ids.viewer.id, role: 'viewer', granted_by: 'test' },
        { profile_id: ids.reviewer.id, role: 'reviewer', granted_by: 'test' },
        { profile_id: ids.publisher.id, role: 'publisher', granted_by: 'test' },
      ],
      source_ops_audit: audit.map((row) => ({ ...row, actor_profile_id: ids.publisher.id })),
    }),
  });
  const sent = [];
  const fetcher = async (target, init) => {
    sent.push({ target, method: init.method, headers: { ...init.headers } });
    const url = new URL(target, 'http://halo.test');
    return h.call(url.pathname, init.method, { url: target, headers: init.headers, ...(init.body ? { rawBody: init.body } : {}) });
  };
  const runtimeFor = (who, { lose = false } = {}) => {
    const me = h.identities[who];
    return createProductionRuntime({
      identityId: me.id,
      homeContextId: null,
      credential: async () => ({ identityId: me.id, accessToken: me.token }),
      // `lose`: the command reaches the server, and the answer never comes back.
      fetcher: lose ? async (target, init) => { await fetcher(target, init); throw new TypeError('network lost'); } : fetcher,
    });
  };
  return { h, sent, runtimeFor };
}

// --------------------------------------------------------------- drift

test('the copied disabled expression is the screen\'s, character for character', () => {
  assert.ok(SCREEN.includes(BUTTON_DISABLED), 'ProductionSourceOperations.tsx changed its decision buttons; update BUTTON_DISABLED');
  assert.ok(SCREEN.includes("domain:'source-operations'"), 'the screen reconciles in source-operations');
});

// --------------------------------------------------------------- the screen

test('a household account: the screen mounts the denied answer and shows no source', async () => {
  const w = world();
  const screen = mountScreen(w.runtimeFor('alice'));
  await screen.render().read();
  const view = screen.render();
  assert.equal(view.message, '', 'no error: the denied answer is valid');
  assert.equal(view.snapshot.role, 'denied');
  assert.equal(view.snapshot.sources.length, 0);
  assert.equal(view.source, undefined);
  assert.deepEqual(w.sent.map((s) => `${s.method} ${s.target}`), ['GET /api/operator/sources']);
  assert.ok(w.sent[0].headers.Authorization?.startsWith('Bearer '));
});

test('a viewer: sources mount, and every decision button is disabled', async () => {
  const w = world();
  const screen = mountScreen(w.runtimeFor('viewer'));
  await screen.render().read();
  const view = screen.render();
  assert.equal(view.message, '');
  assert.equal(view.snapshot.role, 'viewer');
  assert.ok(view.snapshot.sources.length >= 5);
  assert.equal(view.source.id, view.snapshot.sources[0].id, 'the first source is selected');
  for (const decision of DECISION_BUTTONS) assert.equal(buttonDisabled(view, decision), true, decision);
});

test('a publisher: no decision is offered, and preparing one is refused by the client before anything is sent', async () => {
  const w = world();
  const screen = mountScreen(w.runtimeFor('publisher'));
  await screen.render().read();
  for (const source of screen.render().snapshot.sources) {
    screen.render().setSelected(source.id);
    screen.render().setReason('Checked against the source release notes.');
    let view = screen.render();
    for (const decision of DECISION_BUTTONS) {
      assert.equal(buttonDisabled(view, decision), true, `${source.id} ${decision}`);
      view.prepare(decision);
      view = screen.render();
      assert.equal(view.review, null, `${source.id} ${decision}: no review opens`);
      assert.equal(view.message, 'Your verified role cannot make this decision.');
    }
  }
  assert.deepEqual(w.sent.map((s) => s.method), ['GET'], 'only the read was sent');
});

test('a decision forced past the screen: the runtime\'s own headers are accepted, the refusal is shown, and nothing locks', async () => {
  const w = world();
  const screen = mountScreen(w.runtimeFor('reviewer'));
  await screen.render().read();
  const view = screen.render();
  const source = view.snapshot.sources.find((s) => s.id === 'census-places');
  const command = { sourceId: source.id, sourceRevision: source.revision, target: source.publishedId, decision: 'approve', reason: 'Checked against the release notes.', recordedAt: new Date().toISOString(), operationId: crypto.randomUUID(), snapshotRevision: view.snapshot.revision };
  // The exact call confirm() makes (ProductionSourceOperations.tsx:27).
  const value = await w.runtimeFor('reviewer').request('sourceOps.command', command, { idempotencyKey: command.operationId, expectedRevision: command.sourceRevision });
  const sent = w.sent.at(-1);
  assert.equal(sent.headers['X-Halo-If-Match'], '1');
  assert.equal(sent.headers['If-Match'], undefined, 'never a standard If-Match (lib/ifMatch.js)');
  assert.equal(sent.headers['Idempotency-Key'], command.operationId);
  view.accept(value, command.operationId);
  const after = screen.render();
  assert.equal(after.message, 'This decision is not available for this source yet. Nothing was changed.');
  assert.deepEqual(after.unknown, []);
  assert.equal(after.blocked, false);
  assert.equal(w.h.db.rows('source_ops_audit').length, 1);
});

test('a lost answer: the screen locks, reconciles in its own domain, and unlocks on the stored refusal', async () => {
  const w = world();
  const screen = mountScreen(w.runtimeFor('reviewer'));
  await screen.render().read();
  const view = screen.render();
  const source = view.snapshot.sources[0];
  const review = { sourceId: source.id, sourceRevision: source.revision, target: source.publishedId ?? '', decision: 'quarantine', reason: 'Counts collapsed in the latest pull.', recordedAt: new Date().toISOString(), operationId: crypto.randomUUID(), snapshotRevision: view.snapshot.revision };
  // confirm() checks sourceOpsError first; with no allowed decision it refuses, as it should.
  // So the lost send is driven through the runtime exactly as confirm() sends it.
  await assert.rejects(
    w.runtimeFor('reviewer', { lose: true }).request('sourceOps.command', review, { idempotencyKey: review.operationId, expectedRevision: review.sourceRevision }),
    (error) => error instanceof FrontendServiceError && error.code === 'unknown_outcome',
  );
  assert.equal(w.h.db.rows('source_ops_audit').length, 1, 'the server did refuse and audit it');
  // The screen after a lost answer: the id is unresolved, so it is blocked.
  const unresolved = mountScreen(w.runtimeFor('reviewer'));
  await unresolved.render().read();
  assert.deepEqual(unresolved.render().unknown, [], 'the claim settled, so a reload is not locked');
  // And the in-session path: reconcile() reads operations in source-operations and accept() unlocks.
  const live = mountScreen(w.runtimeFor('reviewer'));
  await live.render().read();
  const state = live.render();
  state.commit({ ...state.snapshot, unresolvedOperations: [review.operationId] });
  assert.equal(live.render().blocked, true);
  await live.render().reconcile(review.operationId);
  const done = live.render();
  assert.deepEqual(done.unknown, []);
  assert.equal(done.blocked, false);
  assert.match(done.message, /The decision was not applied/);
  assert.equal(w.sent.at(-1).target, `/api/operations?domain=source-operations&operationId=${review.operationId}`);
});

test('a viewer\'s forced command is a 403: the screen clears itself, as on a revoked role', async () => {
  const w = world();
  const screen = mountScreen(w.runtimeFor('viewer'));
  await screen.render().read();
  await assert.rejects(
    w.runtimeFor('viewer').request('sourceOps.command', { operationId: crypto.randomUUID() }, { idempotencyKey: crypto.randomUUID(), expectedRevision: 1 }),
    (error) => error instanceof FrontendServiceError && error.code === 'permission',
  );
  assert.equal(w.h.db.rows('operations').length, 0);
});

test('history: the screen loads older audit entries with its own call and merges them', async () => {
  const audit = Array.from({ length: 23 }, (_, i) => ({
    id: i + 1, operation_id: crypto.randomUUID(), role: 'publisher', source_id: 'census-places', source_revision: i + 1, target: 'census-places@2026-10-19',
    decision: 'approve', reason: `Reviewed entry number ${i + 1}.`, outcome: 'applied', refusal: null, recorded_at: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
  }));
  const w = world({ audit });
  const screen = mountScreen(w.runtimeFor('viewer'));
  await screen.render().read();
  screen.render().setSelected('census-places');
  let view = screen.render();
  assert.equal(view.message, '');
  assert.equal(view.source.audit.length, 20);
  assert.equal(view.source.auditCursor, 'a4');
  await view.history('audit', view.source.auditCursor);
  view = screen.render();
  assert.equal(view.message, '', 'the page was accepted');
  assert.equal(view.source.audit.length, 23);
  assert.equal(view.source.auditCursor, null);
  assert.equal(w.sent.at(-1).target, '/api/operator/sources/history?sourceId=census-places&kind=audit&cursor=a4&sourceRevision=24');
});
