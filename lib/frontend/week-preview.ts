import { validActionDate, type PreviewAction } from './expanded-preview';

export type WeekMeta = { note: string; paused: boolean; archived: boolean; completedOn: string; time: string; duration: number; estimateSet?: boolean; zone: string; recurrence: 'none' | 'weekly' | 'after-completion'; reminder: boolean; history: string[] };
export const emptyWeekMeta: WeekMeta = { note:'', paused:false, archived:false, completedOn:'', time:'', duration:60, zone:'America/New_York', recurrence:'none', reminder:false, history:[] };
/** "1 task", "2 tasks": a count with the noun form that matches it. */
/** A readable time zone name ("Eastern Time"); the IANA id stays the stored value. */
export function zoneName(zone:string){if(zone==='UTC'||zone==='Etc/UTC')return 'UTC';try{return new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(new Date(0)).find(part=>part.type==='timeZoneName')?.value||zone;}catch{return zone;}}
/** A zone choice that stays distinct when places share a name: "Eastern Time (New York)". */
export function zoneOptionLabel(zone:string){const name=zoneName(zone),city=zone.includes('/')?zone.slice(zone.lastIndexOf('/')+1).replaceAll('_',' '):'';return city&&name!==zone?`${name} (${city})`:name;}
export const countLabel=(n:number,one:string,many:string)=>`${n} ${n===1?one:many}`;
export function dayAdd(day: string, amount: number) { const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10); }
export function weekStart(day: string) {return dayAdd(day,-((new Date(`${day}T12:00:00Z`).getUTCDay()+6)%7));}
export function calendarDays(day: string, month=false) {const first=month?`${day.slice(0,7)}-01`:day;const start=weekStart(first);return Array.from({length:month?42:7},(_,i)=>dayAdd(start,i));}
export function dayLabel(day:string, options:Intl.DateTimeFormatOptions={weekday:'short',month:'short',day:'numeric'}) {return new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));}
export function actionCategory(action: PreviewAction): 'Home'|'Community'|'Projects'|'Outdoors'|'Personal' {const text=`${action.origin} ${action.key}`.toLowerCase();return /outdoor/.test(text)?'Outdoors':/project/.test(text)?'Projects':/volunt|commitment|outreach|organization|community/.test(text)?'Community':/test|asset|routine|maintenance|garden|food|water|moisture|home/.test(text)?'Home':'Personal';}
/** Resolve wall-clock time explicitly. Reject nonexistent or ambiguous DST instants. */
export function eventInstant(day:string,time:string,zone:string): string|null {
  if (!day || !validActionDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  try {const target=`${day}T${time}`; const base=Date.parse(`${target}:00Z`);const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});const matches:string[]=[];
    for(let offset=-14*60;offset<=14*60;offset+=15){const instant=new Date(base+offset*60000);const p=fmt.formatToParts(instant);const get=(type:string)=>p.find(x=>x.type===type)?.value; if(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`===target) matches.push(instant.toISOString());}return matches.length===1?matches[0]:null;
  }catch{return null;}
}
const escapeICS=(s:string)=>s.replace(/\u2014/g,',').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
export function calendarExport(action:PreviewAction,meta:WeekMeta):string|null {
  if(!action.date||!validActionDate(action.date))return null;
  const compact=(s:string)=>s.replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  let dates=`DTSTART;VALUE=DATE:${compact(action.date)}\r\nDTEND;VALUE=DATE:${compact(dayAdd(action.date,1))}`;
  if(meta.time){const start=eventInstant(action.date,meta.time,meta.zone);if(!start||!Number.isInteger(meta.duration)||meta.duration<15||meta.duration>1440)return null;dates=`DTSTART:${compact(start)}\r\nDTEND:${compact(new Date(Date.parse(start)+meta.duration*60000).toISOString())}`;}
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//HALO//Personal calendar export//EN','BEGIN:VEVENT',`UID:${escapeICS(action.id)}@halo.invalid`,`DTSTAMP:${compact(new Date().toISOString())}`,dates,`SUMMARY:${escapeICS(action.title)}`,'END:VEVENT','END:VCALENDAR'];
  // RFC5545 folding is byte-based. Export deliberately omits private notes and source details.
  return lines.flatMap(line=>line.split('\r\n')).map(line=>{let out='',current='',bytes=0;for(const char of line){const n=new TextEncoder().encode(char).length;if(bytes+n>73){out+=current+'\r\n ';current='';bytes=1;}current+=char;bytes+=n;}return out+current;}).join('\r\n')+'\r\n';
}
export function actionStreak(days:string[],today:string){const done=new Set(days.filter(d=>d&&validActionDate(d)&&d<=today));let day=done.has(today)?today:dayAdd(today,-1),count=0;while(done.has(day)){count++;day=dayAdd(day,-1);}return count;}
export function nextOccurrence(date:string,completed:string,mode:WeekMeta['recurrence']) {if(mode==='none'||!date)return '';if(mode==='after-completion')return dayAdd(completed,7);let next=dayAdd(date,7);while(next<=completed)next=dayAdd(next,7);return next;}
export function downloadWeekFile(name:string,content:string,type:string){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
/** Re-exported for screens whose transcribed line numbers must not move. */
export { clockText } from './time-format';
