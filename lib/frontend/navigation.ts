import {legacyProductPath} from './product-routes';
/** Product ownership is separate from delivery. Planned routes are not live links. */
export const appTabs = [
  { key: 'plan', label: 'My Week', href: '/plan', delivered: true },
  { key: 'today', label: 'Today', href: '/today', delivered: true },
  { key: 'home', label: 'Homeguard', href: '/home', delivered: true },
  { key: 'act', label: 'Explore', href: '/act', delivered: true },
] as const;
export type AppTab = typeof appTabs[number]['key'];

export function routeOwner(path: string): AppTab | null {
  const pathname = legacyProductPath(path.split(/[?#]/)[0].replace(/\/$/, ''));
  if (/^\/(today|family|factors\/(air|uv|pollen|mold))$/.test(pathname)) return 'today';
  if (/^\/home(?:\/|$)/.test(pathname) || /^\/household\/(toddler|child|teen|adult|senior|pregnant|respiratory)$/.test(pathname) || /^\/factors\/(pfas|radon|lead)$/.test(pathname)) return 'home';
  if (/^\/(act|map)(?:\/|$)/.test(pathname)) return 'act';
  if (/^\/(plan|journal)(?:\/|$)/.test(pathname)) return 'plan';
  return null;
}

export function deliveredStagePath(path: string): boolean {
  path=legacyProductPath(path);
  return /^\/(plan|act|today|home|family|settings|learn|map|factors\/(air|uv|pollen|mold|pfas|radon|lead)|household\/(toddler|child|teen|adult|senior|pregnant|respiratory))$/.test(path);
}
