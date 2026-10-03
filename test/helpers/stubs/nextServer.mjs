/**
 * Minimal stand-in for `next/server`: the three names the routes use.
 *
 * NextResponse mirrors the real one where it matters to a handler: it is a
 * Response, and `NextResponse.json(body, init)` sets the JSON content type and
 * honours status and headers. `after(fn)` records the callback on the active
 * harness; the test runs it with `harness.runAfter()`.
 */
import { currentHarness } from './context.mjs';

export class NextResponse extends Response {
  static json(body, init) {
    const response = Response.json(body, init);
    return new NextResponse(response.body, response);
  }
}

export class NextRequest extends Request {
  get nextUrl() {
    return new URL(this.url);
  }
}

export function after(task) {
  currentHarness().afterQueue.push(task);
}
