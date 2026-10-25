/** Presentation routes only. Backend tab keys, endpoints and record IDs stay stable. */
export const productPaths: Record<string, string> = {
  plan:'/app', today:'/app/today', home:'/app/homeguard', act:'/app/explore', settings:'/app/settings', journal:'/app/journal',
};
const destinations: Record<string, { path:string; owner:string; legacy:string }> = {
  tests:{path:'/app/homeguard/tests',owner:'home',legacy:'/home'},
  maintenance:{path:'/app/homeguard/maintenance',owner:'home',legacy:'/home'},
  food:{path:'/app/homeguard/food',owner:'home',legacy:'/home'},
  summary:{path:'/app/homeguard/summary',owner:'home',legacy:'/home'},
  journal:{path:'/app/journal',owner:'plan',legacy:'/plan'},
  patterns:{path:'/app/plan/patterns',owner:'plan',legacy:'/plan'},
  recap:{path:'/app/plan/recap',owner:'plan',legacy:'/plan'},
  outdoors:{path:'/app/plan/outdoors',owner:'plan',legacy:'/plan'},
  reminders:{path:'/app/plan/reminders',owner:'plan',legacy:'/plan'},
  opportunities:{path:'/app/explore/activities',owner:'act',legacy:'/act'},
  organizations:{path:'/app/explore/organizations',owner:'act',legacy:'/act'},
  projects:{path:'/app/explore/projects',owner:'act',legacy:'/act'},
  community:{path:'/app/explore/community',owner:'act',legacy:'/act'},
  observations:{path:'/app/explore/notes',owner:'act',legacy:'/act'},
  outreach:{path:'/app/explore/contact',owner:'act',legacy:'/act'},
};
const aliases: Record<string,string> = {
  '/app':'/plan','/app/plan':'/plan','/app/today':'/today','/app/homeguard':'/home','/app/explore':'/act','/app/settings':'/settings',
};
export function productRoute(path: string): {legacy:string;destination?:string} | null {
  const pathname=path.split(/[?#]/)[0].replace(/\/$/,'');
  if(aliases[pathname])return {legacy:aliases[pathname]};
  for(const [destination,entry] of Object.entries(destinations))if(entry.path===pathname)return {legacy:entry.legacy,destination};
  return null;
}
export function legacyProductPath(path:string):string {return productRoute(path)?.legacy??path;}
/** Journal, Patterns and Season are one Journal page (its views), reached from the sidebar's own Journal entry and from My Week. */
export const journalDestinations:readonly string[]=['journal','patterns','recap'];
export function isJournalDestination(destination?:string|null):boolean {return !!destination&&journalDestinations.includes(destination);}
/** A destination's page name where its key is not what the screen calls it. */
const destinationNames:Record<string,string>={recap:'Season',opportunities:'Get involved',observations:'Notes'};
/** The browser title of a destination page, the same words the screen uses. */
export function destinationTitle(destination:string):string {return destinationNames[destination]??destination[0].toUpperCase()+destination.slice(1);}
/** The app header of a destination page: Journal for its views, otherwise the owning tab's name (null). */
export function destinationHeader(destination?:string|null):string|null {return isJournalDestination(destination)?'Journal':null;}
export function productPath(tab:string):string {return productPaths[tab]??`/${tab}`;}
/** Existing feature links append their safe view/record parameters with &. */
export function productDestinationHref(tab:string,destination?:string):string {
  const entry=destination?destinations[destination]:undefined;
  if(entry&&entry.owner===tab)return `${entry.path}?view=main`;
  return `${productPath(tab)}?view=main${destination?`&destination=${encodeURIComponent(destination)}`:''}`;
}
