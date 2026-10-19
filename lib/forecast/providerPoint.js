/**
 * The point B10 sends to a forecast provider (plan ruling F3): latitude and
 * longitude as strings with exactly 2 decimals (about 1.1 km), or null when the
 * input is not a usable coordinate. Shared by the Open-Meteo and NWS adapters,
 * which round again whatever the caller passed, so no adapter can send more
 * precision than F3 allows. Task 2's `roundForProvider` rounds the same way; the
 * two can be folded together when both have merged.
 */

function coordinate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

/** @param {{lat:number|string, lng:number|string} | null | undefined} point */
export function providerPoint(point) {
  const lat = coordinate(point?.lat);
  const lng = coordinate(point?.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: lat.toFixed(2), lng: lng.toFixed(2) };
}
