import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError } from '@/lib/apiErrors';

/**
 * GET /api/health — reports whether each external data source is reachable
 * (§39.3). Not linked from the interface, but invaluable before a demonstration
 * and during development: it answers "is it us or them" in one request.
 *
 * Requires a session so it isn't an open endpoint. Reveals no household data.
 *
 * A check that fails reports a fixed word, never the failure's own text (which
 * can carry the request URL with its API key, or database wording): `timeout`,
 * `unreachable` or `query_failed`. The real error goes to the server log with
 * the request id.
 */

async function ping(name, url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 5000);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, headers: opts.headers });
    return { name, reachable: true, status: res.status, ok: res.ok, ms: Date.now() - started };
  } catch (err) {
    console.error(`Health check ${name} failed (request ${opts.requestId}):`, err);
    return { name, reachable: false, error: err.name === 'AbortError' ? 'timeout' : 'unreachable', ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    const probe = (name, url, opts = {}) => ping(name, url, { ...opts, requestId });

    // A fixed NC point so no household data is involved.
    const lat = 35.4;
    const lng = -80.5;
    const checks = [
      probe('airnow', `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${process.env.AIRNOW_API_KEY}`),
      probe('open-meteo-air', `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi&timezone=UTC`),
      probe('open-meteo-uv', `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=uv_index&timezone=UTC`),
      probe('google-pollen', `https://pollen.googleapis.com/v1/forecast:lookup?key=${process.env.GOOGLE_POLLEN_API_KEY}&location.longitude=${lng}&location.latitude=${lat}&days=1`),
      probe('nws', `https://api.weather.gov/points/${lat},${lng}`, { headers: { 'User-Agent': 'HALO/1.0' } }),
      probe('mapbox-geocoding', `https://api.mapbox.com/geocoding/v5/mapbox.places/concord.json?access_token=${process.env.MAPBOX_TOKEN}`),
      probe('arcgis-water-boundaries', `https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query?geometryType=esriGeometryPoint&geometry=${lng},${lat}&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=PWSID&returnGeometry=false&f=json`),
      // Upstash Redis backs every rate limiter and the shared water-geography
      // cache. Those all degrade silently when it is gone (limits stop applying,
      // the assistant's app-wide cap pauses it), so surface it here.
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? probe('upstash-redis', `${process.env.UPSTASH_REDIS_REST_URL}/ping`, {
            headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
          })
        : Promise.resolve({ name: 'upstash-redis', reachable: false, error: 'not configured', ms: 0 }),
    ];

    const results = await Promise.all(checks);

    // Supabase reachability via a light reference-table count.
    const sbStarted = Date.now();
    let supabase;
    try {
      const { error } = await supabaseAdmin.from('ucmr5_utilities').select('pwsid', { count: 'exact', head: true });
      if (error) console.error(`Health check supabase failed (request ${requestId}):`, error.message);
      supabase = { name: 'supabase', reachable: !error, ok: !error, ms: Date.now() - sbStarted, ...(error && { error: 'query_failed' }) };
    } catch (err) {
      console.error(`Health check supabase failed (request ${requestId}):`, err);
      supabase = { name: 'supabase', reachable: false, ok: false, ms: Date.now() - sbStarted, error: 'unreachable' };
    }
    results.push(supabase);

    // Reachable isn't enough: a bad API key answers 401 and is still reachable.
    const allOk = results.every((r) => r.reachable && r.ok === true);
    return NextResponse.json(
      { all_ok: allOk, checked_at: new Date().toISOString(), checks: results },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Health failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
