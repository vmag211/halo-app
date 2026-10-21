/**
 * GET /api/frontend/capabilities on the in-memory harness: a signed-in read of
 * which person-facing capabilities are switched on, as booleans only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const ROUTE = '/api/frontend/capabilities';
const NAMES = ['attachments', 'luna', 'outreach', 'participation', 'projects', 'recovery', 'summaries', 'tasks', 'workspace'];

test('no session is a 401 and nothing is read', async () => {
  const h = createRouteHarness();
  await expectEnvelope(await h.call(ROUTE, 'GET'), { status: 401, code: 'auth_required', retryable: false });
  assert.equal(h.db.queryLog.length, 0);
});

test('every capability defaults to off, as booleans only, with no configuration disclosed', async () => {
  const h = createRouteHarness();
  const res = await h.call(ROUTE, 'GET', { as: 'alice' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['capabilities']);
  assert.deepEqual(Object.keys(body.capabilities).sort(), NAMES);
  for (const value of Object.values(body.capabilities)) assert.equal(value, false);
  assert.doesNotMatch(JSON.stringify(body), /HALO_FEATURE|publicImport/);
  assert.equal(h.db.queryLog.length, 0);
});

test('each flag is reported exactly as the server enforces it, with no implied dependencies', async () => {
  const h = createRouteHarness({ env: { HALO_FEATURE_TASKS: 'on', HALO_FEATURE_ATTACHMENTS: 'true', HALO_FEATURE_WORKSPACE: '1' } });
  const { capabilities } = await (await h.call(ROUTE, 'GET', { as: 'alice' })).json();
  assert.equal(capabilities.tasks, true);
  assert.equal(capabilities.attachments, true, 'the raw flag; the client applies the workspace dependency');
  assert.equal(capabilities.workspace, false, '"1" is not an enabled value');
});

test('the client skips only reads whose capability is known off, and parses only boolean maps', async () => {
  const { readSwitchedOff, parseFeatureFlags, featureReads } = await loadFrontend('production/features');
  const { productionOperations } = await loadFrontend('production/runtime');
  assert.equal(productionOperations['features.read'].path, ROUTE);
  for (const operation of Object.keys(featureReads)) {
    assert.ok(productionOperations[operation], `${operation} is a registered operation`);
    assert.equal(productionOperations[operation].method ?? 'GET', 'GET', `${operation} is a read`);
  }
  const off = parseFeatureFlags({ capabilities: { workspace: false, attachments: true, projects: true } });
  assert.equal(readSwitchedOff('workspace.load', off), true);
  assert.equal(readSwitchedOff('attachments.inspect', off), true, 'attachments also need workspace');
  assert.equal(readSwitchedOff('projects.current', off), false);
  assert.equal(readSwitchedOff('settings.read', off), false, 'reads with no capability are never skipped');
  assert.equal(readSwitchedOff('workspace.load', null), false, 'unknown flags send every read');
  assert.equal(readSwitchedOff('workspace.load', parseFeatureFlags({ capabilities: {} })), false, 'an unreported capability is unknown');
  for (const bad of [null, [], { capabilities: [] }, { capabilities: { workspace: 'false' } }, { data: { capabilities: {} } }]) assert.equal(parseFeatureFlags(bad), null);
});

test('the runtime settles a switched-off read without a request and leaves writes and unknown state alone', async () => {
  const { createProductionRuntime } = await loadFrontend('production/runtime');
  const { parseFeatureFlags } = await loadFrontend('production/features');
  const credential = async () => ({ identityId: 'owner-1', accessToken: 'test-token' });
  const sent = [];
  const fetcher = async (path) => { sent.push(path); return Response.json({ code: 'feature_unavailable', error: 'off', message: 'off', field_errors: [], retryable: false, request_id: 'r' }, { status: 503 }); };
  const off = createProductionRuntime({ identityId: 'owner-1', homeContextId: 'home-1', credential, fetcher, features: parseFeatureFlags({ capabilities: { workspace: false } }) });
  const error = await off.request('workspace.load', { collection: 'tests' }).catch((failure) => failure);
  assert.equal(error.code, 'unavailable');
  assert.equal(error.reason, 'feature_unavailable', 'the same settled answer as the server 503');
  assert.deepEqual(sent, []);
  await off.request('workspace.execute', { kind: 'write' }, { idempotencyKey: 'op-1' }).catch(() => {});
  assert.deepEqual(sent, ['/api/frontend/workspace/commands'], 'writes keep the server as their only authority');
  const unknown = createProductionRuntime({ identityId: 'owner-1', homeContextId: 'home-1', credential, fetcher, features: null });
  await unknown.request('workspace.load', { collection: 'tests' }).catch(() => {});
  assert.equal(sent.at(-1), '/api/frontend/workspace?collection=tests');
});

test('Homeguard shows the not-available-yet status, not an error with a retry, when its records are switched off', async () => {
  const { homeguardOffMessage } = await loadFrontend('collection-availability');
  assert.match(homeguardOffMessage, /not available yet/);
  assert.equal(homeguardOffMessage.includes(String.fromCharCode(0x2014)), false);
  const source = readFileSync(new URL('../components/homeguard/HomeguardWorkspace.tsx', import.meta.url), 'utf8');
  // The error-with-retry banner only takes a collection that is not switched off; the settled answer is a status.
  assert.match(source, /requiredCollections\.find\(key => state\.collectionStates\[key\]\?\.status === 'error' && !state\.collectionStates\[key\]\.featureUnavailable\)/);
  assert.match(source, /\{productionOff && <p className="hg-notice" role="status">\{homeguardOffMessage\}<\/p>\}/);
});

test('the Homeguard overview drops its retry when every failed collection is switched off', () => {
  const source = readFileSync(new URL('../components/expanded/HomeOverviewWorkspace.tsx', import.meta.url), 'utf8');
  // A switched-off group is settled (off), never an error; only real failures keep Try again.
  assert.match(source, /const error = !off && /);
  assert.match(source, /: !failing \? homeguardOffMessage :/);
  assert.match(source, /\{!loading && failing && <button className="how-action"/);
});
