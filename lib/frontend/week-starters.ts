import type { PreviewAction } from './expanded-preview';
import { dayAdd, dayLabel, emptyWeekMeta, weekStart, type WeekMeta } from './week-preview';

/**
 * Starter ideas for a household with no tasks yet. They are suggestions, never
 * saved records: nothing here is stored until a person adds one through the
 * normal actions.commit path, and each one links to a real HALO surface.
 */
export type WeekStarter = { id: string; title: string; origin: string; reason: string; link: { tab: string; destination?: string; label: string } };
export type DatedWeekStarter = WeekStarter & { key: string; date: string };

export const weekStarterIdeas: readonly WeekStarter[] = Object.freeze([
  { id: 'radon-zone', title: 'Check your home’s radon zone', origin: 'Homeguard', reason: 'Homeguard shows the published radon zone for your county. A zone is an area estimate, not a reading of your home.', link: { tab: 'home', label: 'Open Homeguard' } },
  { id: 'water-pfas', title: 'Look up your water system’s PFAS results', origin: 'Homeguard', reason: 'Homeguard lists the PFAS results your water system has published, with their sample dates. A private well needs its own test.', link: { tab: 'home', label: 'Open Homeguard' } },
  { id: 'outdoor-hour', title: 'Plan an outdoor hour on a low-UV day', origin: 'Outdoors', reason: 'Plan outdoors compares the morning, afternoon and evening forecast so you can choose a calmer time.', link: { tab: 'plan', destination: 'outdoors', label: 'Plan outdoors' } },
  { id: 'air-check', title: 'Check today’s air before time outside', origin: 'Today', reason: 'Today shows current air quality, UV and pollen with their sources and times.', link: { tab: 'today', label: 'Open Today' } },
]);

export const starterKey = (id: string) => `starter:${id}`;
export const starterForKey = (key: string) => weekStarterIdeas.find(idea => key === starterKey(idea.id));

/**
 * The ideas to show, each with a suggested day in the current week. Only a
 * household with no tasks at all sees them, and a dismissed idea stays gone.
 * Suggested days are fixed by the idea's place in the list, so dismissing one
 * never moves the others, and they never run past this week's Sunday.
 */
export function visibleWeekStarters(actions: readonly PreviewAction[], dismissed: readonly string[], today: string): DatedWeekStarter[] {
  if (actions.length) return [];
  const end = dayAdd(weekStart(today), 6);
  return weekStarterIdeas.flatMap((idea, index) => {
    if (dismissed.includes(idea.id)) return [];
    const day = dayAdd(today, index);
    return [{ ...idea, key: starterKey(idea.id), date: day > end ? end : day }];
  });
}

/** The ordinary add command a person's tap sends; the idea becomes a real task. */
export function starterAddCommand(starter: DatedWeekStarter, zone: string, today: string) {
  const meta: WeekMeta = { ...emptyWeekMeta, zone, history: [`${dayLabel(today)}: Added from a starter idea (saved).`] };
  return {
    seeds: [{ key: starter.key, title: starter.title, origin: starter.origin, reason: `${starter.reason} You added this from a starter idea.` }],
    date: starter.date,
    options: { metadata: { [starter.key]: meta }, expectedMetadata: { [starter.key]: 'null' }, initialStates: { [starter.key]: 'saved' as const } },
  };
}
