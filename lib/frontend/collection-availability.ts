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
