import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';

/**
 * GET /api/health — reports whether each external data source is reachable
 * (§39.3). Not linked from the interface, but invaluable before a demonstration
 * and during development: it answers "is it us or them" in one request.
 *
 * Requires a session so it isn't an open endpoint. Reveals no household data.
 */

async function ping(name, url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 5000);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, headers: opts.headers });
    return { name, reachable: true, status: res.status, ok: res.ok, ms: Date.now() - started };
  } catch (err) {
    return { name, reachable: false, error: err.name === 'AbortError' ? 'timeout' : err.message, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  try {
    await requireUser(request);

    // A fixed NC point so no household data is involved.
    const lat = 35.4;
    const lng = -80.5;
    const checks = [
      ping('airnow', `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${process.env.AIRNOW_API_KEY}`),
      ping('open-meteo-air', `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi&timezone=UTC`),
      ping('open-meteo-uv', `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=uv_index&timezone=UTC`),
      ping('google-pollen', `https://pollen.googleapis.com/v1/forecast:lookup?key=${process.env.GOOGLE_POLLEN_API_KEY}&location.longitude=${lng}&location.latitude=${lat}&days=1`),
      ping('nws', `https://api.weather.gov/points/${lat},${lng}`, { headers: { 'User-Agent': 'HALO/1.0' } }),
      ping('mapbox-geocoding', `https://api.mapbox.com/geocoding/v5/mapbox.places/concord.json?access_token=${process.env.MAPBOX_TOKEN}`),
      ping('arcgis-water-boundaries', `https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query?geometryType=esriGeometryPoint&geometry=${lng},${lat}&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=PWSID&returnGeometry=false&f=json`),
    ];

    const results = await Promise.all(checks);

    // Supabase reachability via a light reference-table count.
    const sbStarted = Date.now();
    let supabase;
    try {
      const { error } = await supabaseAdmin.from('ucmr5_utilities').select('pwsid', { count: 'exact', head: true });
      supabase = { name: 'supabase', reachable: !error, ms: Date.now() - sbStarted, ...(error && { error: error.message }) };
    } catch (err) {
      supabase = { name: 'supabase', reachable: false, ms: Date.now() - sbStarted, error: err.message };
    }
    results.push(supabase);

    const allOk = results.every((r) => r.reachable);
    return NextResponse.json({ all_ok: allOk, checked_at: new Date().toISOString(), checks: results });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
