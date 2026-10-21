import {notificationKinds,type SettingsValues} from '../settings-preview';
export type SettingsSnapshot={revision:number;values:SettingsValues;display:{appearance:'system'|'light'|'dark';palette?:'ocean'|'forest'|'iris';ambient:boolean;scale:string;motion:'system'|'full'|'reduce';contrast:boolean};calendar:{zone:string;streak:boolean;linked:boolean};unresolvedOperations:string[]};
export type SettingsReceipt={operationId:string;status:'succeeded'|'pending'|'unknown'|'failed'|'cancelled';snapshot?:SettingsSnapshot};
function zone(value:unknown){if(typeof value!=='string')return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}
const bool=(value:unknown)=>typeof value==='boolean';
export function validSettingsSnapshot(value:unknown):value is SettingsSnapshot{
 const v=value as SettingsSnapshot;if(!v||!Number.isSafeInteger(v.revision)||v.revision<1||!Array.isArray(v.unresolvedOperations)||v.unresolvedOperations.some(id=>typeof id!=='string'||!id)||!v.values?.home||!v.values.quiet||!v.values.notifications||!v.values.luna||!v.display||!v.calendar)return false;
 if(v.display.palette!==undefined&&!['ocean','forest','iris'].includes(v.display.palette))return false;
 const {home,quiet,notifications,luna,language}=v.values;
 return typeof home.year==='string'&&(!home.year||/^\d{4}$/.test(home.year))&&['utility','well','spring','other'].includes(home.water)&&['owner','renter','other'].includes(home.tenure)&&notificationKinds.every(key=>bool(notifications[key]))&&bool(quiet.enabled)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.from)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.to)&&zone(quiet.zone)&&['tasks','home','projects'].every(key=>bool(luna[key as keyof typeof luna]))&&['en','es'].includes(language)&&['system','light','dark'].includes(v.display.appearance)&&['100','115','130','150'].includes(v.display.scale)&&['system','full','reduce'].includes(v.display.motion)&&bool(v.display.contrast)&&bool(v.display.ambient)&&zone(v.calendar.zone)&&bool(v.calendar.streak)&&bool(v.calendar.linked);
}
