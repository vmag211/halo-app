// E25 (YOUR_TODO.md Part 4 items 24 and 25): the connected app remounts, and drops drafts, only
// on a genuine home transition. lib/frontend/production/home-scope.ts, run for real, wired as
// ProductionApp.tsx wires it: the real runtime takes the scope's id and current revision, and the
// real home adapter's scopeKey (which keys HomeWorkspaceSession, the drafts) takes its anchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { observeHome, nextHomeScope, homeTransition } = await loadFrontend('production/home-scope');
const { createProductionRuntime } = await loadFrontend('production/runtime');
const { createHomeAdapter } = await loadFrontend('production/adapters');

const ME = 'identity-1';
const HOME = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';
const at = (lat, lng) => ({ lat, lng, county: 'Cabarrus County', state: 'NC' });
const profile = (home) => ({ onboarded: true, profile: { county: 'Cabarrus County', state: 'NC', lat: 35.4, lng: -80.58 }, ...(home === undefined ? {} : { home_context: home }) });
const context = (id, revision, location = at(35.4, -80.58)) => ({ id, revision, location, current: true });
/** Every profile in turn, as SessionBoundary sees them: the scopes, and the app key after each. */
function run(...profiles) {
  let scope = null;
  return profiles.map((p) => { scope = nextHomeScope(scope, ME, observeHome(p)); return { scope, key: `${ME}:${scope.epoch}` }; });
}
const runtime = (scope) => createProductionRuntime({ identityId: ME, homeContextId: scope.id ?? null, contextRevision: scope.revision, credential: async () => null });
/** The workspace session's key: HomeWorkspaceProvider remounts (and drops drafts) when it changes. */
const session = (scope) => createHomeAdapter(runtime(scope), { currentHomeId: scope.id ?? null, homes: [] }, `${ME}:${scope.anchor}`).scopeKey;

test('observeHome: null is no home, a missing or malformed field is unknown, the legacy fields are read', () => {
  assert.deepEqual(observeHome(profile(null)), { id: null });
  assert.deepEqual(observeHome(profile(undefined)), { id: undefined });
  assert.deepEqual(observeHome(null), { id: undefined });
  assert.deepEqual(observeHome(profile({ revision: 2 })), { id: undefined });
  assert.deepEqual(observeHome(profile(context(HOME, 3))), { id: HOME, revision: 3, place: '35.4,-80.58' });
  assert.deepEqual(observeHome({ profile: { home_context_id: HOME, context_revision: 2 } }), { id: HOME, revision: 2 });
  assert.deepEqual(observeHome({ profile: { home_context_id: null } }), { id: null });
});

test('item 24: an in-place home save (the revision rises, the point stays) keeps the app and the workspace session', () => {
  const [first, saved] = run(profile(context(HOME, 3)), profile(context(HOME, 4)));
  assert.equal(saved.key, first.key, 'no remount');
  assert.equal(session(saved.scope), session(first.scope), 'HomeWorkspaceSession keeps its drafts');
  assert.equal(session(first.scope), runtime(first.scope).scopeKey, 'a fresh mount\'s session key is the runtime\'s');
  assert.equal(runtime(saved.scope).scopeKey, `${ME}:${HOME}:4`, 'the runtime follows the current revision, as projects J10 requires');
  assert.equal(runtime(saved.scope).homeContextId, HOME);
});

test('item 25: a re-read that omits home_context keeps the last known home, and the next good read does not remount', () => {
  const [first, omitted, back] = run(profile(context(HOME, 3)), profile(undefined), profile(context(HOME, 3)));
  assert.equal(omitted.scope, first.scope, 'the same scope object: nothing changed');
  assert.equal(omitted.scope.id, HOME, 'never treated as "no home"');
  assert.equal(back.key, first.key);
  assert.equal(runtime(omitted.scope).homeContextId, HOME);
  assert.equal(runtime(omitted.scope).scopeKey, runtime(first.scope).scopeKey, 'not none:0');
});

test('a first appearance of home_context that agrees with what was known does not remount, and the runtime takes the id', () => {
  const [unknown, appeared] = run(profile(undefined), profile(context(HOME, 3)));
  assert.equal(unknown.scope.id, undefined);
  assert.equal(appeared.key, unknown.key, 'unknown before: adopted without a remount');
  assert.equal(runtime(appeared.scope).homeContextId, HOME, 'X-Halo-Home-Context and the history check get the id');
  assert.equal(session(appeared.scope), session(unknown.scope), 'drafts kept');
  const [legacy, same] = run({ profile: { home_context_id: HOME, context_revision: 3 } }, profile(context(HOME, 3)));
  assert.equal(same.key, legacy.key, 'the same id the legacy field gave');
  assert.equal(same.scope.place, '35.4,-80.58');
});

test('a genuine transition remounts: another id, a home going away, a first home where there was none, the same id at another point', () => {
  const moved = run(profile(context(HOME, 3)), profile(context(NEXT, 1)));
  assert.notEqual(moved[1].key, moved[0].key);
  assert.equal(moved[1].scope.id, NEXT);
  assert.equal(runtime(moved[1].scope).scopeKey, `${ME}:${NEXT}:1`, 'a fresh scope: resources re-read for the new home');
  assert.equal(session(moved[1].scope), `${ME}:${NEXT}:1`, 'and a fresh workspace session');
  const cleared = run(profile(context(HOME, 3)), profile(null));
  assert.notEqual(cleared[1].key, cleared[0].key);
  const first = run(profile(null), profile(context(HOME, 1)));
  assert.notEqual(first[1].key, first[0].key);
  const relocated = run(profile(context(HOME, 3)), profile(context(HOME, 4, at(35.9, -79.0))));
  assert.notEqual(relocated[1].key, relocated[0].key);
  assert.equal(homeTransition({ id: HOME, revision: 3, place: '1,1' }, { id: HOME, revision: 3, place: '2,2' }), false, 'a different point at the same revision is not a save, so not a move');
});

test('a stale read of the same home (a lower revision) is ignored: no lowered revision, no false move after it', () => {
  const [fresh, stale, again] = run(profile(context(HOME, 5)), profile(context(HOME, 3, at(35.9, -79.0))), profile(context(HOME, 5)));
  assert.equal(stale.scope, fresh.scope);
  assert.equal(again.scope, fresh.scope);
  assert.equal(again.key, fresh.key);
});

test('after a move, an omitted re-read keeps the new home, and a new identity starts its own scope', () => {
  const [, moved, omitted] = run(profile(context(HOME, 3)), profile(context(NEXT, 1)), profile(undefined));
  assert.equal(omitted.scope, moved.scope);
  const other = nextHomeScope(moved.scope, 'identity-2', observeHome(profile(context(HOME, 3))));
  assert.equal(other.identity, 'identity-2');
  assert.equal(other.epoch, 0);
});

test('the home adapter\'s scopeKey defaults to the runtime\'s for callers that pass none', () => {
  const r = createProductionRuntime({ identityId: ME, homeContextId: HOME, contextRevision: 3, credential: async () => null });
  assert.equal(createHomeAdapter(r, { currentHomeId: HOME, homes: [] }).scopeKey, `${ME}:${HOME}:3`);
});
