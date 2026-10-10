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
