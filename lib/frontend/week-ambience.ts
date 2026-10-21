/** Decorative original landscapes, never location, weather or environmental evidence. */
export const WEEK_SCENE_DWELL_MS = 30_000;
export const WEEK_SCENE_DISSOLVE_MS = 3_600;
export type WeekLandscape = {
  id: 'lake' | 'coast' | 'forest' | 'meadow' | 'cove';
  name: string;
  src: string;
  water: readonly (readonly [number, number])[];
  waterline: number;
};

export const weekLandscapes: readonly WeekLandscape[] = [
  { id: 'lake', name: 'Stillwater', src: '/preview-scenes/week-lake.webp', waterline: .508,
    water: [[.04,.515],[.96,.515],[.88,.76],[.84,1],[.16,1],[.12,.76]] },
  { id: 'coast', name: 'Tidal light', src: '/preview-scenes/week-coast.webp', waterline: .45,
    water: [[.45,.47],[.61,.47],[.77,.60],[.83,.80],[.80,1],[.25,1],[.18,.80],[.25,.60]] },
  { id: 'forest', name: 'Forest hush', src: '/preview-scenes/week-forest.webp', waterline: .51,
    water: [[.43,.53],[.58,.53],[.75,.63],[.84,.84],[.85,1],[.16,1],[.20,.84],[.28,.63]] },
  { id: 'meadow', name: 'Meadow light', src: '/preview-scenes/week-meadow.webp', waterline: .47,
    water: [[.18,.47],[.84,.47],[.82,.71],[.70,1],[.40,1],[.25,.75]] },
  { id: 'cove', name: 'Quiet cove', src: '/preview-scenes/week-cove.webp', waterline: .53,
    water: [[.02,.53],[.98,.53],[.98,1],[.02,1]] },
];

/** New app-owned strings stay in one catalogue, including nonvisual controls. */
export const weekAmbienceCopy = {
  controls: 'Landscape controls',
  pause: 'Pause landscape',
  resume: 'Resume landscape',
  next: 'Next landscape',
  changed: (name: string) => `${name} landscape selected.`,
  unavailable: 'This landscape could not load. Try the next one.',
} as const;

/** Same centered cover geometry for the static image and its water overlay. */
export function landscapeCrop(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  return { scale, x: (width - sourceWidth * scale) / 2, y: (height - sourceHeight * scale) / 2 };
}

/** Small wave displacement at a fixed geographic point, not a moving photograph. */
export function landscapeWave(y: number, height: number, seconds: number, strength = 1) {
  const depth = Math.max(0, Math.min(1, y / height));
  return strength * (.18 + depth * 1.15) * (
    Math.sin(y * .11 - seconds * 1.45) + .38 * Math.sin(y * .043 + seconds * .72)
  );
}
