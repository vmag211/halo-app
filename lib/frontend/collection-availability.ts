/**
 * How a screen should present one owned collection's load state. A capability
 * that is switched off (503 feature_unavailable) is a settled answer: say it is
 * not available yet and offer no retry. Any other failure keeps the error and
 * its Try again.
 */
export type CollectionView = 'loading' | 'ready' | 'off' | 'error';
export function collectionView(status?: { status: string; featureUnavailable?: boolean }): CollectionView {
  if (!status || status.status === 'loading') return 'loading';
  if (status.status === 'ready') return 'ready';
  return status.featureUnavailable ? 'off' : 'error';
}
export const journalOffMessage = 'Check-ins are not available yet. Nothing has changed, and the rest of My Week still works.';
/** Homeguard's owned records (the `workspace` capability) answered "not available yet". */
export const homeWorkspaceOffMessage = 'Saving Homeguard records is not available yet. Nothing has changed, and the rest of Homeguard still works.';
export const homeSaveOffMessage = 'Saving Homeguard records is not available yet. Nothing was saved. Your draft is kept.';
/** Household summaries are prepared by the `summaries` capability. */
export const summariesOffMessage = 'Household summaries are not available yet. Nothing has changed, and your selections are kept.';
/** True when any of these collections settled as switched off. */
export function collectionsOff(states: Record<string, { status: string; featureUnavailable?: boolean } | undefined>, keys: string[]): boolean {
  return keys.some(key => collectionView(states[key]) === 'off');
}
