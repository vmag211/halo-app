/** Display-only cartography. These kernels count records, not concentration. */
export const heatStops = [[183, 217, 223], [112, 184, 189], [214, 204, 147], [217, 155, 97], [185, 86, 89]];
export function recordDensity(sources: readonly (readonly [number, number])[], width: number, height: number, radius: number, step = 4) {
  const cols = Math.ceil(width / step), rows = Math.ceil(height / step);
  const field = new Float32Array(cols * rows);
  if (!Number.isFinite(radius) || radius <= 0) return { field, cols, rows };
  // Visit only each kernel's support, rather than every record at every pixel.
  // Offscreen records still contribute when their support intersects the view.
  for (const [sx, sy] of sources) {
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
    const left = Math.max(0, Math.ceil((sx - radius) / step)), right = Math.min(cols - 1, Math.floor((sx + radius) / step));
    const top = Math.max(0, Math.ceil((sy - radius) / step)), bottom = Math.min(rows - 1, Math.floor((sy + radius) / step));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const d2 = ((x * step - sx) ** 2 + (y * step - sy) ** 2) / radius ** 2;
      if (d2 < 1) field[y * cols + x] += (1 - d2) ** 2;
    }
  }
  return { field, cols, rows };
}
export function densityRGBA(density: number) {
  if (!Number.isFinite(density) || density < .025) return [0, 0, 0, 0];
  // Fixed domain: two overlapping unit kernels reach the ramp's final stop.
  const value = Math.min(density / 2, 1) * 4, i = Math.min(3, Math.floor(value)), fraction = value - i;
  return [...heatStops[i].map((c, channel) => Math.round(c + (heatStops[i + 1][channel] - c) * fraction)), Math.round(Math.min(.58, density * .7) * 255)];
}

/** Illustrative record-count contours, not AQI interpolation or transport.
 * Stable seeds anchor irregular lobes to records. Phase is decorative, not time.
 */
export function contourRecordDensity(sources: readonly { x: number; y: number; seed: number }[], width: number, height: number, radius: number, phase = 0, step = 4) {
  const cols = Math.ceil(width / step), rows = Math.ceil(height / step);
  const field = new Float32Array(cols * rows);
  if (!Number.isFinite(radius) || radius <= 0) return { field, cols, rows };
  for (const { x: sx, y: sy, seed } of sources) {
    if (![sx, sy, seed].every(Number.isFinite)) continue;
    const left = Math.max(0, Math.ceil((sx - radius) / step)), right = Math.min(cols - 1, Math.floor((sx + radius) / step));
    const top = Math.max(0, Math.ceil((sy - radius) / step)), bottom = Math.min(rows - 1, Math.floor((sy + radius) / step));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const dx = (x * step - sx) / radius, dy = (y * step - sy) / radius;
      const angle = Math.atan2(dy, dx);
      // Bounded .57 to .97 of maximum support, including the small motion.
      const envelope = .77 + .1 * Math.sin(angle * 3 + seed) + .06 * Math.cos(angle * 5 - seed) + .04 * Math.sin(angle * 2 + seed + phase);
      const distance = (dx * dx + dy * dy) / (envelope * envelope);
      if (distance < 1) field[y * cols + x] += (1 - distance) ** 2;
    }
  }
  return { field, cols, rows };
}
export function geographicContourSeed(lng: number, lat: number) { return lng * 7.31 + lat * 11.73; }
