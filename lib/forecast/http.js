/**
 * The one way B10's forecast adapters reach a provider (plan F8; Task 3 of
 * docs/backend/plans/b10-forecast.md).
 *
 * API (for Tasks 4 to 6):
 *
 *   const r = await getJson(url, { fetchImpl, timeoutMs, headers, maxBytes });
 *
 *     url        the full request URL. It may carry a key in its query string
 *                (AirNow does), so it is NEVER echoed: not in `reason`, not in
 *                a log line, not in a thrown error (nothing is thrown).
 *     fetchImpl  the fetch to use. Defaults to the global fetch, so route tests
 *                reach the sandbox's per-call stub; adapter tests pass their own.
 *     timeoutMs  REQUIRED, a positive finite number of milliseconds (F8: 6000
 *                for a forecast, 3000 for Open-Meteo's metadata). It bounds the
 *                whole exchange, headers AND body, through
 *                `AbortSignal.timeout`. Without one no request is made at all
 *                and the answer is `{ok: false, reason: 'no_timeout'}`, so a
 *                provider call without a timeout cannot exist.
 *     headers    extra request headers (NWS needs its User-Agent). `accept:
 *                application/json` is sent unless the caller overrides it.
 *     maxBytes   the body cap, default 2 MB (F8). A declared Content-Length
 *                over it is refused before reading; otherwise the stream is
 *                counted as it arrives and abandoned once it passes the cap.
 *
 *   It resolves, never rejects, to exactly one of:
 *
 *     { ok: true,  json, status }  a 2xx whose body parsed as JSON. `json` is
 *                                  whatever parsed, `null` included: judging
 *                                  the shape is the adapter's job, and a
 *                                  `null` or shapeless body must become a
 *                                  failure there, never "nothing to report".
 *     { ok: false, reason }        `reason` is a fixed token, one of
 *                                  'timeout'      the timeout fired
 *                                  'network'      fetch rejected (DNS, reset)
 *                                  'http_<code>'  a non-2xx status, e.g. 'http_503'
 *                                  'too_large'    the body passed `maxBytes`
 *                                  'invalid'      the body was not JSON
 *                                  'no_timeout'   the caller gave no timeoutMs
 *
 * No retries (F8): a failure is reported at once and the cache remembers it
 * for a minute (lib/forecast/cache.js), which is the retry policy. Nothing
 * here logs; a caller that logs uses the `reason` token, never the URL.
 */

export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

const fail = (reason) => ({ ok: false, reason });

/** Rejects when `signal` aborts, so a stub that ignores the signal is still bounded. */
function whenAborted(signal) {
  const pending = new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  pending.catch(() => {}); // only ever observed through Promise.race
  return pending;
}

function quietCancel(body) {
  try {
    const cancelled = body?.cancel?.();
    if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(() => {});
  } catch {
    /* a body that cannot be cancelled is simply left */
  }
}

/** Reads the body as text, refusing once it passes `maxBytes`. Resolves to a string or null (too large). */
async function readCapped(res, maxBytes) {
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const text = await res.text();
    return Buffer.byteLength(text, 'utf8') > maxBytes ? null : text;
  }
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      quietCancel(reader);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * @param {string} url
 * @param {{fetchImpl?: Function, timeoutMs: number, headers?: Record<string, string>, maxBytes?: number}} options
 * @returns {Promise<{ok: true, json: any, status: number} | {ok: false, reason: string}>}
 */
export async function getJson(url, { fetchImpl = globalThis.fetch, timeoutMs, headers = {}, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return fail('no_timeout');
  const cap = typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
  const signal = AbortSignal.timeout(timeoutMs);
  const aborted = whenAborted(signal);

  let res;
  try {
    res = await Promise.race([fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', ...headers }, signal }), aborted]);
  } catch {
    // The error text is deliberately dropped: a fetch error can quote the host
    // or the whole URL, and the URL can carry a key.
    return fail(signal.aborted ? 'timeout' : 'network');
  }

  if (!res || typeof res.status !== 'number') return fail('network');
  if (res.status < 200 || res.status > 299) {
    quietCancel(res.body);
    return fail(`http_${res.status}`);
  }

  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    quietCancel(res.body);
    return fail('too_large');
  }

  let text;
  try {
    text = await Promise.race([readCapped(res, cap), aborted]);
  } catch {
    return fail(signal.aborted ? 'timeout' : 'network');
  }
  if (text === null) return fail('too_large');

  try {
    return { ok: true, json: JSON.parse(text), status: res.status };
  } catch {
    return fail('invalid');
  }
}
