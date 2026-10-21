/**
 * What fetch actually receives from B10's `getJson` for a given `headers`
 * option, for the adapter tests (Tasks 4 and 6), until Task 3's
 * `lib/forecast/http.js` is in this tree.
 *
 * `wireHeaders` is a verbatim copy of the header handling in Task 3's
 * `getJson` (commit 3c0f5f1, `lib/forecast/http.js`):
 *
 *     sent = new Headers({ accept: 'application/json' });
 *     new Headers(headers ?? {}).forEach((value, name) => sent.set(name, value));
 *     ...
 *     fetchImpl(url, { method: 'GET', headers: Object.fromEntries(sent.entries()), signal })
 *
 * (a header fetch would refuse throws there and answers `bad_headers`). When
 * Task 3 merges, a reconciler can swap this copy for the real `getJson` driven
 * by a `fetchImpl` stub; the assertions on the wire headers stay the same.
 */

/** @param {Record<string, string> | Headers | undefined} headers */
export function wireHeaders(headers) {
  const sent = new Headers({ accept: 'application/json' });
  new Headers(headers ?? {}).forEach((value, name) => sent.set(name, value));
  return Object.fromEntries(sent.entries());
}
