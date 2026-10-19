import type {PreviewAction} from './expanded-preview';
import {validActionDate} from './expanded-preview';
import {actionCategory, dayAdd, emptyWeekMeta, eventInstant, weekStart, type WeekMeta} from './week-preview';
import {actionDisplayDay, dayBoundary} from './week-timeline';
import type {WeekRecord} from './week-records';

export const dashboardKinds = ['Home','Projects','Community','Outdoors','Personal'] as const;
export type DashboardKind = typeof dashboardKinds[number];
export type DashboardDay = {date:string; plans:number; records:number; minutes:number; unknown:number; completed:number; kinds:Partial<Record<DashboardKind,number>>};
export type WeekDashboard = {days:DashboardDay[]; plans:number; records:number; minutes:number; unknown:number; completed:number; kinds:Partial<Record<DashboardKind,number>>};

/** Read-only owned-plan projection. Planned effort is neither tracked time nor free calendar capacity. */
export function weekDashboard(actions:PreviewAction[], metas:Record<string,WeekMeta>, records:WeekRecord[], anchor:string, zone:string):WeekDashboard {
  const result:WeekDashboard = {days:[],plans:0,records:0,minutes:0,unknown:0,completed:0,kinds:{}};
  if(!anchor || !validActionDate(anchor)) return result;
  const start=weekStart(anchor), end=dayAdd(start,6);
  result.days=Array.from({length:7},(_,index)=>({date:dayAdd(start,index),plans:0,records:0,minutes:0,unknown:0,completed:0,kinds:{}}));
  const boundaries=result.days.map(day=>[dayBoundary(day.date,zone),dayBoundary(dayAdd(day.date,1),zone)] as const);
  const seen=new Set<string>();
  for(const action of actions){
    if(seen.has(action.id)) continue; seen.add(action.id);
    const meta={...emptyWeekMeta,...metas[action.key]};
    if(meta.archived) continue;
    if(action.state==='completed'){
      const done=result.days.find(day=>day.date===meta.completedOn);
      if(done){done.completed++;result.completed++;} continue;
    }
    if(meta.paused || !action.date || !validActionDate(action.date)) continue;
    const label=actionCategory(action); const kind:DashboardKind=dashboardKinds.includes(label as DashboardKind)?label as DashboardKind:'Personal';
    const display=actionDisplayDay(action,meta,zone);
    const durationValid=Number.isInteger(meta.duration)&&meta.duration>=15&&meta.duration<=1440;
    const instant=meta.time&&durationValid?eventInstant(action.date,meta.time,meta.zone):null;
    let found=false, unknown=false;
    for(let index=0;index<result.days.length;index++){
      const day=result.days[index]; const [from,to]=boundaries[index];
      let minutes=0;
      const timedOverlap=instant&&from&&to&&Date.parse(instant)<Date.parse(to)&&Date.parse(instant)+meta.duration*60000>Date.parse(from);
      if(instant){if(!timedOverlap) continue; minutes=Math.max(0,(Math.min(Date.parse(instant)+meta.duration*60000,Date.parse(to!))-Math.max(Date.parse(instant),Date.parse(from!)))/60000);}
      else {if(day.date!==display) continue; if(!meta.time&&meta.estimateSet&&durationValid) minutes=meta.duration; else {day.unknown++;unknown=true;}}
      found=true;day.plans++;day.minutes+=minutes;day.kinds[kind]=(day.kinds[kind]??0)+1;
    }
    if(found){result.plans++;result.kinds[kind]=(result.kinds[kind]??0)+1;if(unknown)result.unknown++;}
  }
  const seenRecords=new Set<string>();
  for(const record of records){
    if(seenRecords.has(record.id)||!validActionDate(record.date)||record.date<start||record.date>end)continue;
    seenRecords.add(record.id); const day=result.days.find(day=>day.date===record.date)!;
    day.records++; result.records++; day.kinds[record.category]=(day.kinds[record.category]??0)+1; result.kinds[record.category]=(result.kinds[record.category]??0)+1;
  }
  result.minutes=result.days.reduce((total,day)=>total+day.minutes,0);
  return result;
}

export function effortLabel(minutes:number){const rounded=Math.round(minutes);const hours=Math.floor(rounded/60),rest=rounded%60;return hours?`${hours}h${rest?` ${rest}m`:''}`:`${rounded}m`;}
