/**
 * A household world for the B11 workspace suites: the real route handlers on
 * the isolated route harness, with migration 0026's REAL functions
 * (read_household_workspace, commit_household_workspace) and the REAL 0017
 * ledger (test/db/pgliteLedger.mjs) on a PGlite database, called as the
 * service role as PostgREST would call them.
 *
 * The CLIENT is the frontend's own code, compiled from this tree by
 * test/frontend-test-loader.mjs, not a transcription: `createProductionRuntime`
 * (lib/frontend/production/runtime.ts, its status mapping and unwrap) and
 * `createHomeAdapter` (lib/frontend/production/adapters.ts), whose fetcher is
 * the route harness. What the screen then does with an answer is
 * `homeWorkspace` (test/helpers/frontendB11.mjs), the provider's decisions
 * transcribed from components/homeguard/HomeWorkspaceState.tsx.
 *
 * Every world has two fresh households, alice and bob, each with a current
 * home context in PGlite. `onCommit(args, call)` wraps the commit function so
 * a test can call through and then lose the response.
 */
import { createRouteHarness, rpcError } from './routeHarness.mjs';
import { haloTables } from './tables.mjs';
import { pgliteLedger } from '../db/pgliteLedger.mjs';
import { OWNED_ROW } from '../db/ownedRows.mjs';
import { loadFrontend } from '../frontend-test-loader.mjs';
import { homeWorkspace } from './frontendB11.mjs';

const { createProductionRuntime } = await loadFrontend('production/runtime');
const { createHomeAdapter } = await loadFrontend('production/adapters');

export const ON = Object.freeze({ HALO_FEATURE_WORKSPACE: 'on' });
export const LOAD = '/api/frontend/workspace';
export const COMMANDS = '/api/frontend/workspace/commands';
export const OPERATIONS = '/api/operations';

const asRpcError = (error) => rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);

let worlds = 0;

export async function createWorld(db, { env = ON, onCommit, onRead } = {}) {
  worlds += 1;
  const prefix = (0xb1100000 + worlds).toString(16);
  const alice = `${prefix}-0000-4000-8000-00000000000a`;
  const bob = `${prefix}-0000-4000-8000-00000000000b`;
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${alice}', true), ('${bob}', true);`);
  const home = { alice: crypto.randomUUID(), bob: crypto.randomUUID() };
  for (const [who, owner] of [['alice', alice], ['bob', bob]]) {
    const row = { ...OWNED_ROW.home_contexts(owner, 0), id: home[who] };
    const columns = Object.keys(row);
    await db.query(
      `insert into public.home_contexts (${columns.map((c) => `"${c}"`).join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row).map((value) => (value && typeof value === 'object' ? JSON.stringify(value) : value)),
    );
  }

  const h = createRouteHarness({
    tables: haloTables('profiles'),
    env,
    identities: { alice: { id: alice }, bob: { id: bob } },
    seed: { profiles: [{ id: alice }, { id: bob }] },
  });
  const fakeFrom = h.db.from;
  h.db.from = (name) => (name === 'operations' ? pgliteLedger(db, name, h.db.queryLog) : fakeFrom(name));

  const read = async (args) => {
    try {
      return await db.asService(async (tx) => (await tx.query('select public.read_household_workspace($1, $2::text[]) as result', [args.p_profile_id, args.p_collections])).rows[0].result);
    } catch (error) {
      throw asRpcError(error);
    }
  };
  const commit = async (args) => {
    try {
      return await db.asService(async (tx) => (await tx.query(
        'select public.commit_household_workspace($1, $2, $3::jsonb) as result',
        [args.p_profile_id, args.p_operation_id, JSON.stringify(args.p_writes)],
      )).rows[0].result, { commit: true });
    } catch (error) {
      throw asRpcError(error);
    }
  };
  h.db.registerRpc('read_household_workspace', (args) => (onRead ? onRead(args, () => read(args)) : read(args)), { args: ['p_profile_id', 'p_collections'] });
  h.db.registerRpc('commit_household_workspace', (args) => (onCommit ? onCommit(args, () => commit(args)) : commit(args)), {
    args: ['p_profile_id', 'p_operation_id', 'p_writes'],
  });

  const ids = { alice, bob };

  /** The frontend's own runtime, fetching through the route harness. `lose(path, init)` drops an answer after the server gave it. */
  function runtime(who = 'alice', { lose = () => false, env: callEnv } = {}) {
    const fetcher = async (path, init) => {
      const url = new URL(path, 'http://halo.test');
      const response = await h.call(url.pathname, init.method, {
        as: who, url: `${url.pathname}${url.search}`, headers: init.headers, rawBody: init.body, env: callEnv,
      });
      if (lose(url.pathname, init)) throw new TypeError('fetch failed');
      return response;
    };
    return createProductionRuntime({
      identityId: ids[who],
      homeContextId: home[who],
      contextRevision: 1,
      credential: async () => ({ identityId: ids[who], accessToken: h.identities[who].token }),
      fetcher,
    });
  }

  const world = {
    h, db, ids, home,
    /** The client's own adapter for `who`. */
    adapter(who = 'alice', options = {}) {
      return createHomeAdapter(runtime(who, options), { currentHomeId: home[who], homes: [{ id: home[who], label: 'Current home', state: 'current', revision: 1 }] });
    },
    /** The Homeguard provider as production runs it, on the client's own adapter. */
    workspace(who = 'alice', options = {}) {
      return homeWorkspace(world.adapter(who, options));
    },
    load: (collection, { as = 'alice', headers = {}, env: callEnv } = {}) =>
      h.call(LOAD, 'GET', { as, url: `${LOAD}?collection=${encodeURIComponent(collection)}`, headers, env: callEnv }),
    command(body, { as = 'alice', key = body?.operationId, headers = {}, raw, env: callEnv } = {}) {
      return h.call(COMMANDS, 'POST', {
        as,
        rawBody: raw ?? JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(key === null || key === undefined ? {} : { 'idempotency-key': key }), ...headers },
        env: callEnv,
      });
    },
    reconcile: (operationId, { as = 'alice', domain = 'workspace', env: callEnv } = {}) =>
      h.call(OPERATIONS, 'GET', { as, url: `${OPERATIONS}?operationId=${operationId}&domain=${domain}`, env: callEnv }),
    /** The household's stored rows, as 0026 holds them. */
    async rows(who = 'alice', collection = null) {
      const owner = ids[who] ?? who;
      return (await db.query(
        `select collection, record_id, revision, record from public.household_workspace_records
          where profile_id = $1 and ($2::text is null or collection = $2) order by collection, created_at, record_id`, [owner, collection])).rows;
    },
    async ledgerRow(operationId) {
      return (await db.query('select operation_id::text, profile_id::text, domain, kind, status, result from public.operations where operation_id = $1', [operationId])).rows[0] ?? null;
    },
    async ledgerText() {
      return JSON.stringify((await db.query('select result from public.operations where profile_id in ($1, $2)', [alice, bob])).rows.map((row) => row.result));
    },
  };
  return world;
}

/** A command body with a fresh operation id. */
export const body = (command) => ({ operationId: crypto.randomUUID(), ...command });

/** A minimal valid record for each stored collection, as the client's own row check accepts it. */
export function sampleRecord(collection, { id = `${collection}-${crypto.randomUUID()}`, title = 'A record', homeContextId = null, ...over } = {}) {
  const base = { id, title, revision: 0 };
  const home = homeContextId ? { homeContextId } : {};
  const records = {
    tests: { ...base, purpose: 'Check the kitchen tap', contextId: homeContextId ?? 'missing-context', medium: 'water', provider: '', sampleLabel: '', method: '', reviewReason: '', kind: 'water', status: 'draft', plannedDate: '', collectionStart: '', collectionEnd: '', expectedDate: '', rows: [], review: 'not_received', archived: false, history: [] },
    assets: { ...base, ...home, model: 'Filter', instructions: '', testId: '', factor: 'pfas', basis: 'user', policy: 'calendar', unit: 'months', interval: 6, status: 'active', installed: '', serviced: '', nextDue: '', calendarAnchor: '', endDate: '', lastCompleted: '', snoozedUntil: '', history: [] },
    observations: { ...base, ...home, timezone: 'America/New_York', room: 'Basement', reading: '', unit: '', source: '', note: '', photoName: '', assetId: '', testId: '', kind: 'dampness', observedAt: '2026-10-10T12:00:00Z', photoData: '' },
    gardens: { ...base, ...home, setup: 'Raised bed', county: 'Wake', irrigation: 'rain', soil: '', concern: '', questions: '', householdSourceConfirmed: false, testIds: [], history: [] },
    usage: { ...base, ...home, site: '', meter: '', quantity: '10', unit: 'gal', source: '', note: '', kind: 'interval', basis: 'measured', start: '2026-10-01', end: '2026-10-02', reset: false, history: [] },
    pantryItems: { ...base, ...home, guideId: 'rice', question: '', createdAt: '2026-10-10T12:00:00Z', updatedAt: '2026-10-10T12:00:00Z', guideRevision: '1', origin: 'store' },
    foodQuestions: { ...base, evidenceId: 'notice-1', question: 'Is my lot included?', reportId: '', note: '' },
    fishNotes: { ...base, timezone: 'America/New_York', waterbody: 'Jordan Lake', species: 'Catfish', quantity: '1', unit: 'meal', note: '', advisoryId: 'nc-1', date: '2026-10-01', kind: 'catch', advisoryRevision: 1 },
    foodFollows: { ...base, targetId: 'fish-1', kind: 'fish', sourceRevision: 1, following: true, saved: true },
    growerInquiries: { ...base, resourceId: 'ext-1', siteId: '', testId: '', questions: '', state: 'draft', reference: '', response: '', checklist: [], contactDate: '', followUpDate: '' },
    exploreNotes: { ...base, kind: 'Observation', timezone: 'America/New_York', place: '', description: 'Foam on the creek', reference: '', observedAt: '2026-10-10T12:00:00Z', status: 'draft' },
    exploreOutcomes: { ...base, goal: 'Report it', result: '', reference: '', nextStep: '', date: '2026-10-10', followupDate: '', status: 'Open', history: [] },
    exploreProjects: { ...base, goal: 'Rain garden', outcome: '', guideId: 'g1', guideVersion: 'v1', reviewDate: '', status: 'Active', stepNotes: {}, history: [], guide: { id: 'g1', version: 'v1', title: 'Rain garden', description: 'd', purpose: 'p', effort: 'e', cost: 'c', scope: 's', suitability: 's', completion: 'c', followup: 'f', cause: 'Water', scene: 'garden', icon: 'plant', materials: [], constraints: ['yard'], sources: [{ id: 's1', title: 'Guide', publisher: 'NCSU', checked: '2026-10-01', url: 'https://example.org/guide' }], steps: [{ id: 'step-1', title: 'Dig', instructions: ['Dig a basin.'], checkpoint: '', sourceIds: ['s1'] }] } },
    exploreEngagements: { ...base, organizer: 'Riverkeeper', cause: 'Water', url: '', place: '', hours: '', preparation: '', outcome: '', reference: '', date: '', statusDate: '', followupDate: '', status: 'Considering', history: [] },
  };
  if (!records[collection]) throw new Error(`sampleRecord: no sample for ${collection}`);
  return { ...records[collection], ...over };
}
