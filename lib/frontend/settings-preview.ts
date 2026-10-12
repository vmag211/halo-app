/** Isolated settings/notification models. No auth, transport, persistent storage or delivery. */
export const notificationKinds = ['air_quality_change','weather_advisory','new_water_results','radon_season','season_summary'] as const;
export type NotificationKind = typeof notificationKinds[number];
export type SettingsValues = {
  home: { year:string; water:'utility'|'well'|'spring'|'other'; tenure:'owner'|'renter'|'other' };
  notifications: Record<NotificationKind,boolean>;
  quiet: { enabled:boolean; from:string; to:string; zone:string };
  luna: { tasks:boolean; home:boolean; projects:boolean };
  language:'en'|'es';
};
export const initialSettings:SettingsValues = {
  home:{year:'',water:'utility',tenure:'other'},
  notifications:{air_quality_change:true,weather_advisory:true,new_water_results:true,radon_season:true,season_summary:true},
  quiet:{enabled:false,from:'21:00',to:'08:00',zone:'America/New_York'},
  luna:{tasks:true,home:false,projects:true},language:'en',
};
export const displayZones=['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','Pacific/Honolulu','UTC'];
/** Rebase a retained form without replacing fields the user never edited. */
export function mergeUnedited<T>(draft:T,baseline:T,fresh:T):T {
  if(draft&&baseline&&fresh&&typeof draft==='object'&&typeof baseline==='object'&&typeof fresh==='object'&&!Array.isArray(draft))return Object.fromEntries(Object.keys(fresh).map(key=>[key,mergeUnedited((draft as Record<string,unknown>)[key],(baseline as Record<string,unknown>)[key],(fresh as Record<string,unknown>)[key])])) as T;
  return JSON.stringify(draft)===JSON.stringify(baseline)?fresh:draft;
}
export type PrivateRecord = {id:string;revision:number;[key:string]:unknown};
export type PrivateCollections=Record<string,{id:string;revision:number}[]>;
export function recordFingerprint(collections:PrivateCollections,scope:'journal'|'all') {
  return JSON.stringify(Object.entries(collections).filter(([key])=>scope==='all'||key==='weekJournal').sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>[key,rows.map(r=>[r.id,r.revision]).sort(([a],[b])=>String(a).localeCompare(String(b)))]));
}
export function actionFingerprint(actions:{id:string;revision?:number}[]) {
  return JSON.stringify(actions.map(a=>[a.id,a.revision??1]).sort(([a],[b])=>String(a).localeCompare(String(b))));
}
export const exportGroups=['tasks','home','explore','journal','conversation','preferences'] as const;
export type ExportGroup=typeof exportGroups[number];
const privateKeys=/^(note|notes|privateNote|preparation|body|messages|draft|symptoms|severity|illness|band|bands|household|has_\w+|description|goal|ownResult|email|recipient|sender|contact|observation|concern|message|outcome|followUp|reference)$/i;
const locationKeys=/^(address|street|lat|lng|latitude|longitude|coordinates|exactLocation|geometry|attachments|files|fileUrl|downloadUrl|location|locationLabel|place|area)$/i;
function redact(value:unknown,privateText:boolean):unknown {
  if(Array.isArray(value))return value.map(item=>redact(item,privateText));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!locationKeys.test(key)&&(privateText||!privateKeys.test(key))).map(([key,v])=>[key,redact(v,privateText)]));
  return value;
}
export function selectedPrivateExport({collections,actions,drafts,groups,privateText}:{collections:PrivateCollections;actions:unknown[];drafts:Record<string,unknown>;groups:ExportGroup[];privateText:boolean}) {
  const output:Record<string,unknown>={format:'halo-private-export-v1',origin:'isolated-wireframe',authoritative:false,exactLocation:'excluded',privateText};
  for(const group of [...new Set(groups)]) {
    if(group==='tasks')output.tasks=redact(actions,privateText);
    if(group==='home'||group==='explore')output[group]=redact(Object.fromEntries(Object.entries(collections).filter(([key])=>group==='explore'?key.startsWith('explore'):!key.startsWith('explore')&&key!=='weekJournal')),privateText);
    if(group==='journal')output.journal=redact(collections.weekJournal??[],privateText);
    // A conversation has no meaningful non-private transcript. Export only on explicit opt-in.
    if(group==='conversation')output.conversation=privateText?redact(drafts['luna:conversation']??{},true):{excluded:'Private text was not selected.'};
    if(group==='preferences')output.preferences=redact(drafts['settings:values']??initialSettings,false);
  }
  return output;
}
export type AlertItem={id:string;revision:number;title:string;body:string;category:'Home'|'Your week'|'Conditions';date:string;read:boolean;dismissed:boolean;target:{tab:'home'|'plan'|'today';destination?:string;learn?:string};source?:{title:string;url:string};kind:NotificationKind|'app'};
export function alertSeed(count=3):AlertItem[] {
  const base:AlertItem[]=[
    {id:'notice-recap',revision:1,title:'Your autumn, in perspective',body:'Open your seasonal review to see recorded check-ins and completed actions. An ongoing season is partial. Missing readings do not mean clear conditions.',category:'Your week',date:'2026-10-12',read:false,dismissed:false,target:{tab:'plan',destination:'recap'},kind:'season_summary'},
    {id:'notice-radon',revision:1,title:'A home test gives you the fuller picture',body:'County radon information does not measure your home. Review test preparation, record collection, and keep the original laboratory result together.',category:'Home',date:'2026-10-11',read:false,dismissed:false,target:{tab:'home',destination:'tests'},source:{title:'EPA: Test your home for radon',url:'https://www.epa.gov/radon'},kind:'radon_season'},
    {id:'notice-workspace',revision:1,title:'Your home records, in one place',body:'Tests, home care, gardens and selected summaries stay connected in your home workspace. Saving a record does not automatically add a calendar task.',category:'Home',date:'2026-10-10',read:false,dismissed:false,target:{tab:'home'},kind:'app'},
  ];
  return Array.from({length:count},(_,i)=>({...base[i%3],id:`${base[i%3].id}:${i}`,read:false}));
}
export function changeAlert(items:AlertItem[],id:string,revision:number,patch:Partial<Pick<AlertItem,'read'|'dismissed'>>):AlertItem[]|null {
  if(!items.some(item=>item.id===id&&item.revision===revision))return null;
  return items.map(item=>item.id===id?{...item,...patch,revision:revision+1}:item);
}
