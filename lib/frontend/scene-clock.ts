export type SceneTime = 'live' | 'dawn' | 'day' | 'dusk' | 'night';
export type MotionMode = 'system' | 'full' | 'reduce';
export type SceneClock = { phase: Exclude<SceneTime, 'live'>; daylight: number; warmth: number; progress: number; label: string };

/** Decorative local-clock lighting. This is not a sunrise forecast or location calculation. */
export function sceneClockAt(date: Date, override: SceneTime = 'live'): SceneClock {
  const hour = override === 'live' ? date.getHours() + date.getMinutes() / 60 : { dawn: 6.5, day: 12, dusk: 18.5, night: 23 }[override];
  const stops = [[0, 0, 0], [5, 0, .1], [6.5, .45, 1], [8, 1, .1], [16, 1, 0], [18.5, .35, 1], [20, 0, 0], [24, 0, 0]];
  const index = Math.min(stops.length - 2, Math.max(0, stops.findIndex((s, i) => i < stops.length - 1 && hour >= s[0] && hour < stops[i + 1][0])));
  const [start, end] = [stops[index], stops[index + 1]];
  const t = (hour - start[0]) / (end[0] - start[0]);
  const phase = hour >= 5 && hour < 8 ? 'dawn' : hour >= 8 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'dusk' : 'night';
  return { phase, daylight: start[1] + (end[1] - start[1]) * t, warmth: start[2] + (end[2] - start[2]) * t, progress: hour / 24, label: { dawn: 'First light', day: 'Daylight', dusk: 'Evening light', night: 'After dark' }[phase] };
}
