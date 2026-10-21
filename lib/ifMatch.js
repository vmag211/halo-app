/**
 * The expected-revision precondition a client sends with a save.
 *
 * The production client sends it as `X-Halo-If-Match`, not `If-Match`. Vercel's
 * edge evaluates a standard `If-Match` itself against the function's 2xx
 * answer and replaces that answer with its own 412 (an "An error occurred"
 * body), after the function has already run and committed. The client then
 * reads a successful save as a conflict and drops its operation. A custom
 * header is passed through untouched.
 *
 * Routes read both, the custom header first, so a standard `If-Match` from any
 * other caller (tests, scripts, a non-Vercel host) still means the same thing,
 * and a route that refuses a precondition refuses either spelling.
 */
export const IF_MATCH_HEADER = 'X-Halo-If-Match';

/** @param {Request} request @returns {string|null} */
export function readIfMatch(request) {
  return request.headers.get(IF_MATCH_HEADER) ?? request.headers.get('if-match');
}
