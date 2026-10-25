type Location = { lat: number; lng: number };
type View = Location & { zoom: number };
const mercatorY = (lat: number) => .5 - Math.log((1 + Math.sin(lat * Math.PI / 180)) / (1 - Math.sin(lat * Math.PI / 180))) / (4 * Math.PI);

/** Fit only available record coordinates, never an inferred service/exposure area. */
export function fitRecordView(points: readonly Location[], width: number, height: number): View | null {
  const valid = points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 33.6 && p.lat <= 36.8 && p.lng >= -84.6 && p.lng <= -75);
  if (!valid.length || width <= 0 || height <= 0) return null;
  const xs = valid.map(p => (p.lng + 180) / 360), ys = valid.map(p => mercatorY(p.lat));
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const zoom = Math.min(10, Math.max(5, Math.log2(Math.min(Math.max(80, width - 130) / (256 * Math.max(xmax - xmin, .0002)), Math.max(80, height - 150) / (256 * Math.max(ymax - ymin, .0002))))));
  return { lng: (xmin + xmax) / 2 * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - ymin - ymax))) * 180 / Math.PI, zoom };
}

export function distanceMiles(a: Location, b: Location) {
  const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlng = (b.lng - a.lng) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}

/** `keywords` holds a record's own supplied metadata (a facility's county, a station's agency). Search covers
 * name, ID, subtitle and those keywords only: no city or address lookup is implied. */
export type MapResult = { id: string; name: string; severity: string; reading: string; sub: string; lat: number | null; lng: number | null; keywords?: string };
export type MapResultOrder = 'name' | 'severity';
// Highest severity first; records with no data come last, never ranked as good.
const severityRank: Record<string, number> = { severe: 0, high: 1, elevated: 2, moderate: 3, good: 4 };
export function findMapRecords(records: readonly MapResult[], query: string, visibleIds: readonly string[] | null, home: Location | null, order: MapResultOrder = 'name') {
  const terms = query.trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  const visible = visibleIds && new Set(visibleIds);
  const rank = (p: MapResult) => severityRank[p.severity] ?? 5;
  return records.filter(p => (!visible || visible.has(p.id)) && terms.every(term => `${p.name} ${p.id} ${p.sub} ${p.keywords ?? ''}`.toLocaleLowerCase('en-US').includes(term)))
    .map(p => ({ ...p, distance: home && p.lat !== null && p.lng !== null ? distanceMiles(home, { lat: p.lat, lng: p.lng }) : null }))
    .sort((a, b) => home ? (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name) : order === 'severity' ? rank(a) - rank(b) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
}
