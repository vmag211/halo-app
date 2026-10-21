import type { PreviewAction } from './expanded-preview';
import { actionCategory } from './week-preview';

type View = { day?: string; filter: string; showFinished: boolean; search: string; displayDay: (action: PreviewAction) => string };

/**
 * Completed tasks are hidden unless a person includes them, so an empty day or
 * agenda must not claim there are no plans when finished work is only hidden.
 * Counts the hidden completed tasks a day (or, without a day, the agenda) holds.
 */
export function hiddenCompletedCount(actions: readonly PreviewAction[], view: View): number {
  if (view.showFinished || view.search.trim()) return 0;
  return actions.filter(action => action.state === 'completed' && action.date && (!view.day || view.displayDay(action) === view.day) && (view.filter === 'Everything' || actionCategory(action) === view.filter)).length;
}

export function emptyAgendaMessage(day: string | undefined, hiddenDone: number): string {
  if (hiddenDone) return day ? 'Everything planned for this day is done.' : 'Every dated task is done.';
  return day ? 'No plans for this day.' : 'No dated tasks yet.';
}
