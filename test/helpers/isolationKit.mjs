/**
 * Shared setup for the cross-identity route tests: a harness with two seeded
 * households, a provider stub that records what leaves the app, and an audit
 * that every query a call ran on an owned table was scoped to the caller.
 *
 *   const ctx = setup();
 *   const res = await ctx.call('alice', '/api/journal', 'GET');   // audited
 *   ctx.assertNoLeak('alice', await res.json(), 'GET /api/journal');
 */
import assert from 'node:assert/strict';
import { createRouteHarness } from './routeHarness.mjs';
import { HALO_TABLES, OWNED_TABLES } from './tables.mjs';
import { seedHouseholds, markersOf, localDate } from './isolationSeed.mjs';

export { localDate };
export const OTHER = { alice: 'bob', bob: 'alice' };

/**
 * Every query on an owned table is filtered to the caller (reads, updates and
 * deletes) or writes rows owned by the caller (inserts and upserts). This holds
 * whatever data happens to be in the tables, so a forgotten owner filter fails
 * here even when no test seeded a row for it to leak.
 */
export function auditOwnerScope(queries, callerId, label = 'call') {
  for (const query of queries) {
    const ownerColumn = OWNED_TABLES[query.table];
    if (!ownerColumn) continue;
    if (query.operation === 'insert' || query.operation === 'upsert') {
      for (const row of query.rows) {
        assert.equal(row[ownerColumn], callerId, `${label}: ${query.operation} on ${query.table} wrote a row owned by someone else`);
      }
      continue;
    }
    const scoped = query.filters.some(
      (filter) => filter.type === 'cmp' && filter.op === 'eq' && filter.column === ownerColumn && filter.value === callerId,
    );
    assert.ok(scoped, `${label}: ${query.operation} on ${query.table} is not filtered by ${ownerColumn} = the caller`);
  }
}

/** Removes keys that legitimately differ between two calls (timestamps of assembly). */
export function stable(value) {
  return JSON.parse(JSON.stringify(value, (key, inner) => (key === 'assembled_at' ? undefined : inner)));
}

/** Silences console.error and console.warn for one test; returns both mocks. */
export function quiet(t) {
  return { error: t.mock.method(console, 'error', () => {}), warn: t.mock.method(console, 'warn', () => {}) };
}

/**
 * @param {object} [options]
 * @param {object} [options.seed] options for seedHouseholds (readingToday, now)
 * @param {object} [options.env] env values the routes see
 * @param {(request: {url: string, method: string, body: string|null}) => Response|null|undefined} [options.provider]
 *        answers outbound fetches; anything it does not answer gets a 503
 */
export function setup({ seed: seedOptions, env, provider } = {}) {
  const outbound = [];
  let rows;
  const h = createRouteHarness({
    tables: HALO_TABLES,
    seed: (identities) => (rows = seedHouseholds(identities, seedOptions)),
    env,
    fetch: async (url, init = {}) => {
      const entry = { url: String(url), method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : null };
      outbound.push(entry);
      return provider?.(entry) ?? new Response('{}', { status: 503 });
    },
  });
  const markers = { alice: markersOf('alice', h.identities.alice), bob: markersOf('bob', h.identities.bob) };

  /** h.call as `who`, then audit the queries that call ran. */
  const call = async (who, route, method = 'GET', options = {}) => {
    const queriesBefore = h.db.queryLog.length;
    const res = await h.call(route, method, { as: who, ...options });
    auditOwnerScope(h.db.queryLog.slice(queriesBefore), h.identities[who].id, `${who} ${method} ${route}`);
    return res;
  };

  /** The serialized `value` holds none of the other household's markers, and nothing left the app carrying them. */
  const assertNoLeak = (who, value, label, outboundFrom = 0) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const leaked = markers[OTHER[who]].filter((marker) => text.includes(marker));
    assert.deepEqual(leaked, [], `${label}: ${who}'s response contains ${OTHER[who]}'s data`);
    const sent = JSON.stringify(outbound.slice(outboundFrom));
    const sentLeak = markers[OTHER[who]].filter((marker) => sent.includes(marker));
    assert.deepEqual(sentLeak, [], `${label}: a provider request carried ${OTHER[who]}'s data`);
  };

  const rowsOf = (table, who) => h.db.rows(table).filter((row) => row[OWNED_TABLES[table]] === h.identities[who].id);

  return { h, rows, outbound, markers, call, assertNoLeak, rowsOf, id: (who) => h.identities[who].id, today: localDate() };
}
