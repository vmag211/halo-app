import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
/**
 * False in the server render and until hydration, then true. A server-rendered control that is enabled
 * before hydration takes input React never sees: a click does nothing and text typed into a draft is
 * merged with the template on hydration. Such controls stay disabled until this is true, as
 * ExploreOpportunities' filters already do with their clock.
 */
export function useHydrated() { return useSyncExternalStore(subscribe, () => true, () => false); }
