import type {PreviewAction} from './expanded-preview';
import {dayAdd,emptyWeekMeta,eventInstant,type WeekMeta} from './week-preview';

export function instantDay(instant:string,zone:string){try{const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));return `${p.find(x=>x.type==='year')?.value}-${p.find(x=>x.type==='month')?.value}-${p.find(x=>x.type==='day')?.value}`;}catch{return '';}}
export function actionDisplayDay(a:PreviewAction,m:WeekMeta,zone:string){const instant=m.time?eventInstant(a.date,m.time,m.zone):null;return instant?instantDay(instant,zone):a.date;}
export function clockLabel(instant:string,zone:string){return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(instant));}
export function dayBoundary(day:string,zone:string){const midnight=eventInstant(day,'00:00',zone);if(midnight)return midnight;const base=Date.parse(`${day}T12:00:00Z`);for(let n=base-36*3600000;n<=base+36*3600000;n+=3600000){if(instantDay(new Date(n).toISOString(),zone)!==day)continue;let lo=n-3600000,hi=n;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(instantDay(new Date(mid).toISOString(),zone)===day)hi=mid;else lo=mid;}return new Date(hi).toISOString();}return null;}
export type TimelineItem={action:PreviewAction;start:string;end:string;overlap:boolean;gapBefore:number;continues:boolean};
export function dayTimeline(actions:PreviewAction[],metas:Record<string,WeekMeta>,day:string,zone:string){
  const from=dayBoundary(day,zone),to=dayBoundary(dayAdd(day,1),zone);if(!from||!to)return [];
  const result:TimelineItem[]=[];
  for(const action of actions){const m={...emptyWeekMeta,...metas[action.key]};if(m.archived||m.paused||!m.time||!Number.isInteger(m.duration)||m.duration<15||m.duration>1440)continue;const start=eventInstant(action.date,m.time,m.zone);if(!start)continue;const end=new Date(Date.parse(start)+m.duration*60000).toISOString();if(start>=to||end<=from)continue;result.push({action,start,end,overlap:false,gapBefore:0,continues:start<from||end>to});}
  result.sort((a,b)=>a.start.localeCompare(b.start)||a.action.title.localeCompare(b.action.title));
  for(let i=0;i<result.length;i++){const item=result[i];item.overlap=result.some(other=>other!==item&&other.start<item.end&&other.end>item.start);if(i){const priorEnd=Math.max(...result.slice(0,i).map(x=>Date.parse(x.end)));item.gapBefore=Math.max(0,(Date.parse(item.start)-priorEnd)/60000);}}
  return result;
}
