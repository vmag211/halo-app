/**
 * The B18 participation directory's test world: listing rows as a person
 * would write them (migration 0032), inserted on PGlite as the migration
 * owner (the SQL editor's role), and the three routes on the isolated route
 * harness with 0032's REAL read functions registered as the service role
 * would call them through PostgREST.
 *
 * The CLIENT is the frontend's own runtime (lib/frontend/production/runtime.ts,
 * compiled from this tree), with the route harness as its fetcher. What the
 * screens then do is test/helpers/frontendB18.mjs.
 *
 * Every call runs with global fetch blocked (test/helpers/sandbox.mjs).
 */
import { createRouteHarness, rpcError } from './routeHarness.mjs';
import { loadFrontend } from '../frontend-test-loader.mjs';

const { createProductionRuntime } = await loadFrontend('production/runtime');

export const ON = Object.freeze({ HALO_FEATURE_PARTICIPATION: 'on' });
export const ORG = 'B18 Test Riverkeeper';
const DAY = 86400000;

/** A Postgres array literal for a text[] parameter. */
export const pgArray = (values) => `{${values.map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

const CASTS = Object.freeze({
  org_id: 'uuid', starts_at: 'timestamptz', ends_at: 'timestamptz', venue_local_date: 'date', verified_at: 'timestamptz',
  served_place_ids: 'text[]', steps: 'jsonb', extra_sources: 'jsonb',
});
const castFor = (column, v) => (column === 'work' && Array.isArray(v) ? 'text[]' : CASTS[column]);
const value = (column, v) => {
  if (v === null || v === undefined) return null;
  if (column === 'steps' || column === 'extra_sources') return JSON.stringify(v);
  if (Array.isArray(v)) return pgArray(v);
  if (v instanceof Date) return v.toISOString();
  return v;
};

/** Inserts one listing row with `query` (a PGlite db or transaction); `org_id` defaults to the test organization. */
export async function insertListing(query, table, row) {
  const full = { ...row };
  const columns = Object.keys(full);
  const placeholders = columns.map((column, at) => (column === 'org_id' && full.org_id === ORG
    ? `(select id from public.volunteer_orgs where name = $${at + 1})`
    : `$${at + 1}${castFor(column, full[column]) ? `::${castFor(column, full[column])}` : ''}`));
  await query.query(`insert into public.${table} (${columns.join(', ')}) values (${placeholders.join(', ')})`, columns.map((column) => value(column, full[column])));
}

export async function ensureOrg(db) {
  await db.query(`insert into public.volunteer_orgs (name, description, counties, causes, url) values ($1, 'A test organization.', '{statewide}', '{water}', 'https://example.org')
                  on conflict (name) do nothing`, [ORG]);
}

/** An organization profile as a person writes it, verified `verifiedDaysAgo` before `now`. */
export function profileRow({ id = 'riverkeeper-cleanups', now = new Date(), verifiedDaysAgo = 1, verified = true, ...over } = {}) {
  return {
    id, org_id: ORG, title: 'Help care for local waterways', organizer: 'Test Riverkeeper', interest: 'Cleanup',
    area: 'Mecklenburg County', served_place_ids: ['us-county:37119'],
    mission: 'A nonprofit working on water stewardship.', work: 'Public cleanups and trained community science roles.',
    url: 'https://example.org/volunteer', source_title: 'Volunteer page', extra_sources: [],
    address: null, address_kind: null, address_role: null, contact: null,
    effort: 'One cleanup, or a recurring role.', age: 'Not stated on the official page.', cost: 'Free.',
    access: 'Not stated on the official page.', steps: [{ title: 'Choose a cleanup', text: 'Use the organizer page to pick a date.' }],
    bring: 'Water and closed shoes.', followup: 'Record what you did.',
    verified_by: verified ? 'VM' : null, verified_at: verified ? new Date(now.getTime() - verifiedDaysAgo * DAY) : null,
    ...over,
  };
}

/** A scheduled opportunity starting `startsInDays` after `now`, three hours long, verified `verifiedDaysAgo` before. */
export function opportunityRow({ id = 'creek-cleanup', now = new Date(), startsInDays = 7, verifiedDaysAgo = 1, verified = true, kind = 'scheduled', ...over } = {}) {
  const start = new Date(Math.floor((now.getTime() + startsInDays * DAY) / 60000) * 60000);
  return {
    id, org_id: ORG, organizer: 'Test Riverkeeper', title: 'Creek cleanup', interest: 'Cleanup', artwork: 'cleanup', kind,
    starts_at: kind === 'scheduled' ? start : null, ends_at: kind === 'scheduled' ? new Date(start.getTime() + 3 * 3600000) : null,
    time_label: 'Saturday morning, 9:00 to 12:00', venue_local_date: null, venue_timezone: null, venue_timezone_basis: null,
    status: 'listed', area: 'Mecklenburg County', served_place_ids: ['us-county:37119'],
    venue: 'Creek greenway trailhead', meeting_address: null, url: 'https://example.org/events/creek',
    summary: 'Pick up litter along the creek banks.', work: ['Pick up litter', 'Sort recycling'], duration: 'Three hours',
    cost: 'Free.', age: 'Not stated on the official page.', access: 'Not stated on the official page.',
    bring: 'Water and closed shoes.', join_text: 'Register on the organizer page.', safety: 'Stay out of the water.',
    verified_by: verified ? 'VM' : null, verified_at: verified ? new Date(now.getTime() - verifiedDaysAgo * DAY) : null,
    ...over,
  };
}

/** Each 0032 read function the routes call, its parameters in order and their casts. */
const FUNCTIONS = Object.freeze({
  read_participation_opportunities: [['p_place_ids', 'text[]'], ['p_now', 'timestamptz']],
  read_participation_opportunity: [['p_id', 'text'], ['p_now', 'timestamptz']],
  read_participation_profiles: [['p_place_ids', 'text[]'], ['p_now', 'timestamptz']],
});

/**
 * The routes over PGlite. `migrated: false` registers nothing (PostgREST's
 * PGRST202, as before 0032); `wrap[name](args, call)` can replace a call.
 */
export function createWorld(db, { env = ON, migrated = true, wrap = {}, rateLimit } = {}) {
  const h = createRouteHarness({ env, rateLimit, identities: { alice: {}, bob: {} } });
  const calls = [];
  if (migrated) {
    for (const [name, params] of Object.entries(FUNCTIONS)) {
      const call = async (args) => {
        calls.push({ name, args });
        const sql = `select public.${name}(${params.map(([, type], at) => `$${at + 1}::${type}`).join(', ')}) as result`;
        const values = params.map(([param, type]) => (type === 'text[]' ? pgArray(args[param] ?? []) : args[param] ?? null));
        try {
          return await db.asService(async (tx) => (await tx.query(sql, values)).rows[0].result);
        } catch (error) {
          throw rpcError(error?.code ?? '', error?.message ?? String(error));
        }
      };
      h.db.registerRpc(name, (args) => (wrap[name] ? wrap[name](args, () => call(args)) : call(args)), { args: params.map(([param]) => param) });
    }
  }

  /** The frontend's own runtime for `who`. */
  function runtime(who = 'alice', { headers = {} } = {}) {
    const fetcher = async (path, init) => {
      const url = new URL(path, 'http://halo.test');
      return h.call(url.pathname, init.method, { as: who, url: `${url.pathname}${url.search}`, headers: { ...init.headers, ...headers } });
    };
    return createProductionRuntime({
      identityId: h.identities[who].id, homeContextId: null, contextRevision: 1,
      credential: async () => ({ identityId: h.identities[who].id, accessToken: h.identities[who].token }), fetcher,
    });
  }
  /** A raw GET. */
  const get = (path, query = '', { as = 'alice', headers = {}, env: callEnv } = {}) => h.call(path, 'GET', { as, url: `${path}${query}`, headers, env: callEnv });
  return { h, calls, runtime, get };
}
