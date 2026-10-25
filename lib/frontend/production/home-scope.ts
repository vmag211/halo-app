/**
 * Which home the connected app is scoped to (ruling E25, YOUR_TODO Part 4 items 24 and 25).
 *
 * The app remounts, and so drops unsaved drafts, only on a genuine home transition: another
 * home id, a known home going away, a first home where there was none, or the same home's
 * revision rising with a different point. A first appearance of `home_context` that agrees
 * with what was known (the same id, or nothing known), an in-place attribute save (water
 * source, year built: the revision rises, the point stays) and a re-read that leaves the
 * field out (unknown, not "no home") keep the scope.
 */
import type {ProfileResponse} from '../types';

/** `id`: a home id, `null` (the profile says there is no current home), or `undefined` (not known). */
export type HomeObservation = { id: string | null | undefined; revision?: number; place?: string };
export type HomeScope = HomeObservation & {
  identity: string;
  /** Rises on each genuine transition; part of the app's key. */
  epoch: number;
  /** The home the scope opened with, `id:revision`; the runtime's scope key, fixed until the next transition. */
  anchor: string;
};

const own = (value: unknown, key: string) => !!value && typeof value === 'object' && Object.hasOwn(value, key);
const revisionOf = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
function placeOf(location: unknown) {
  if (!location || typeof location !== 'object') return undefined;
  const {lat, lng} = location as {lat?: unknown; lng?: unknown};
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : undefined;
}

/** What one profile answer says about the current home. A missing or malformed field is unknown. */
export function observeHome(profile: ProfileResponse | null | undefined): HomeObservation {
  if (own(profile, 'home_context')) {
    const home = profile!.home_context;
    if (home === null) return {id: null};
    if (home && typeof home.id === 'string' && home.id) return {id: home.id, revision: revisionOf(home.revision), place: placeOf(home.location)};
    return {id: undefined};
  }
  const legacy = profile?.profile;
  if (own(legacy, 'home_context_id')) {
    const id = legacy!.home_context_id;
    if (id === null) return {id: null};
    if (typeof id === 'string' && id) return {id, revision: revisionOf(legacy!.context_revision)};
  }
  return {id: undefined};
}

const anchorOf = (home: HomeObservation) => `${home.id ?? 'none'}:${home.revision ?? 0}`;

/** True only for a genuine home transition between what was known and what is now seen. */
export function homeTransition(previous: HomeObservation, next: HomeObservation): boolean {
  if (previous.id === undefined || next.id === undefined) return false;
  if (previous.id === null || next.id === null) return previous.id !== next.id;
  if (previous.id !== next.id) return true;
  return previous.place !== undefined && next.place !== undefined && previous.place !== next.place
    && (next.revision ?? 0) > (previous.revision ?? 0);
}

/**
 * The scope after one profile answer. Returns `previous` itself when nothing changed, so a
 * caller deriving it during render settles in one pass.
 */
export function nextHomeScope(previous: HomeScope | null, identity: string, observed: HomeObservation): HomeScope {
  if (!previous || previous.identity !== identity) return {identity, ...observed, epoch: 0, anchor: anchorOf(observed)};
  if (observed.id === undefined) return previous;
  // A stale read of the same home (a lower revision) changes nothing, so a late answer can neither lower the revision nor stage a false move.
  if (observed.id === previous.id && observed.revision !== undefined && previous.revision !== undefined && observed.revision < previous.revision) return previous;
  if (homeTransition(previous, observed)) return {identity, ...observed, epoch: previous.epoch + 1, anchor: anchorOf(observed)};
  const revision = observed.revision ?? previous.revision, place = observed.place ?? previous.place;
  if (observed.id === previous.id && revision === previous.revision && place === previous.place) return previous;
  return {...previous, id: observed.id, revision, place};
}
