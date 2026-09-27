/**
 * Which county and whether NC-08 a point falls in (punch list v3 item 19).
 *
 * The water-system boundary data has no county field, and NC-08 splits three
 * counties (Cabarrus, Mecklenburg, Robeson), so a county list can't decide
 * district membership. Each system's service-area centroid is tested against
 * the Census Bureau's boundaries instead (lib/data, simplified to ~100–200 m):
 * the 119th-Congress NC-08 polygon and North Carolina's 100 counties.
 *
 * Pure module.
 */
import district from './data/nc08District.json' with { type: 'json' };
import counties from './data/ncCounties.json' with { type: 'json' };

export const BOUNDARY_SOURCES = { district: district.source, counties: counties.source, retrieved: district.retrieved };
export const NC_COUNTY_COUNT = counties.counties.length;

// Ray casting on one ring of [lng, lat] points.
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A polygon is an outer ring followed by holes.
function inPolygon(lng, lat, rings) {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(lng, lat, rings[k])) return false;
  return true;
}

export function pointInGeometry(lat, lng, geometry) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !geometry) return false;
  if (geometry.type === 'Polygon') return inPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => inPolygon(lng, lat, poly));
  return false;
}

/** Whether a point is inside NC-08 (119th Congress). */
export function inNc08(lat, lng) {
  return pointInGeometry(lat, lng, district.nc08.geometry);
}

/** The NC county containing a point ("Cabarrus County"), or null. */
export function countyForPoint(lat, lng) {
  for (const c of counties.counties) if (pointInGeometry(lat, lng, c.geometry)) return c.name;
  return null;
}

/** Every NC county name, sorted. */
export function allCounties() {
  return counties.counties.map((c) => c.name).sort();
}
