import {validActionDate,type PreviewAction} from './expanded-preview';
import {enteredResultRows,hasRecordedResult} from './home-test-preview';
import {actionCategory,dayAdd,emptyWeekMeta,weekStart,type WeekMeta} from './week-preview';
import {actionDisplayDay} from './week-timeline';
import {resolveWeekActivity,type WeekActivityCollections,type WeekActivityRoute} from './week-activity';
import {safePublicLink} from './explore-workspace';
import type {WeekRecord} from './week-records';

type Row=Record<string,unknown>;
const text=(value:unknown)=>typeof value==='string'?value.replace(/\u2014/g,',').trim():'';
const rows=(collections:WeekActivityCollections,key:string)=>(collections[key]??[]).filter((r):r is Row=>Boolean(r)&&typeof r==='object'&&!Array.isArray(r)).filter(r=>text(r.id)).filter((r,i,all)=>all.findIndex(other=>other.id===r.id)===i);
const usable=(date:string)=>Boolean(date)&&validActionDate(date);
const meta=(a:PreviewAction,metas:Record<string,WeekMeta>)=>({...emptyWeekMeta,...metas[a.key]});
export type AttentionItem={id:string;title:string;label:string;date:string;actionId?:string;record?:WeekRecord;route?:WeekActivityRoute};

/** Chosen plans and factual record states only, never an inferred safety deadline. */
export function homepageAttention(actions:PreviewAction[],metas:Record<string,WeekMeta>,records:WeekRecord[],collections:WeekActivityCollections,today:string,zone:string):AttentionItem[]{
  const result:AttentionItem[]=[];
  for(const a of actions){const m=meta(a,metas);if(a.state==='completed'||m.archived||m.paused)continue;const date=actionDisplayDay(a,m,zone);
    if(a.state==='waiting')result.push({id:`task:${a.id}`,title:a.title,label:'Waiting on something',date,actionId:a.id});
    else if(usable(date)&&date<today)result.push({id:`task:${a.id}`,title:a.title,label:'Earlier plan, choose what happens next',date,actionId:a.id});
  }
  for(const r of records.filter(r=>r.date<=today))result.push({id:r.id,title:r.title,label:r.kind==='test-result'?'Expected result, check your record':r.kind==='routine'?'Home-care date to review':'Chosen date to review',date:r.date,record:r});
  for(const r of rows(collections,'tests'))if(!r.archived&&enteredResultRows(r.rows).length&&r.review!=='user_confirmed')result.push({id:`report:${text(r.id)}`,title:text(r.title),label:hasRecordedResult(r.rows)?'Recorded report needs your review':'Result entry not finished',date:'',route:{tab:'home',destination:'tests',view:'detail',id:text(r.id)}});
  for(const r of rows(collections,'exploreOutcomes'))if(r.status==='Waiting for a response'&&!result.some(i=>i.actionId&&actions.find(a=>a.id===i.actionId)?.key===`explore:followthrough:${text(r.id)}`))result.push({id:`case:${text(r.id)}`,title:text(r.title),label:'Waiting for a response',date:text(r.followupDate),route:{tab:'act',destination:text(r.id).startsWith('note-case:')?'observations':'outreach',view:text(r.id).startsWith('note-case:')?'detail':'list',id:text(r.id).startsWith('note-case:')?text(r.id).slice(10):''}});
  return result.filter(i=>i.title).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.title.localeCompare(b.title));
}

export function weeklyHomepageRecap(actions:PreviewAction[],metas:Record<string,WeekMeta>,collections:WeekActivityCollections,day:string,nowDay=day){
  const start=weekStart(day),end=dayAdd(start,6);
  const completed=actions.filter((a,i)=>a.state==='completed'&&actions.findIndex(other=>other.id===a.id)===i&&usable(meta(a,metas).completedOn)&&meta(a,metas).completedOn>=start&&meta(a,metas).completedOn<=end&&meta(a,metas).completedOn<=nowDay);
  const participation=rows(collections,'exploreEngagements').filter(r=>['Participated','Follow-up','Closed'].includes(text(r.status))||Array.isArray(r.history)&&r.history.some(h=>h&&typeof h==='object'&&(h as Row).status==='Participated'));
  const dated=participation.filter(r=>usable(text(r.participatedOn))&&text(r.participatedOn)>=start&&text(r.participatedOn)<=end&&text(r.participatedOn)<=nowDay);
  const hasHours=(r:Row)=>text(r.hours)!==''&&Number.isFinite(Number(r.hours))&&Number(r.hours)>=0&&Number(r.hours)<=1000;
  return {start,end,completed,unknownCompletions:actions.filter(a=>a.state==='completed'&&!usable(meta(a,metas).completedOn)).length,home:completed.filter(a=>actionCategory(a)==='Home').length,steps:completed.filter(a=>/project:[^:]+:step:\d+$/.test(a.key)).length,
    participation:dated.length,hours:dated.filter(hasHours).reduce((total,r)=>total+Number(r.hours),0),unknownHours:dated.filter(r=>!hasHours(r)).length,
    undatedParticipation:participation.filter(r=>!usable(text(r.participatedOn))).length,
    days:Array.from({length:7},(_,i)=>{const date=dayAdd(start,i);return {date,count:completed.filter(a=>meta(a,metas).completedOn===date).length};})};
}

export type PreparationPlan={id:string;signature:string;title:string;date:string;action?:PreviewAction;route?:WeekActivityRoute;label:string;place:string;url:string|null;instructions:string[];checks:string[];status:string};
/** No forecast, registration or preparedness state is inferred from a plan. */
// The same words as the task Status control, never the raw stored key.
const actionStateLabels:Record<string,string>={saved:'Saved',waiting:'Waiting',completed:'Completed'};
export function preparationPlans(actions:PreviewAction[],metas:Record<string,WeekMeta>,collections:WeekActivityCollections,today:string,zone:string):PreparationPlan[]{
  const result:PreparationPlan[]=[];const end=dayAdd(today,13);
  for(const a of actions){const m=meta(a,metas),date=actionDisplayDay(a,m,zone);if(a.state==='completed'||m.archived||m.paused||!usable(date)||date<today||date>end||actionCategory(a)==='Personal')continue;
    const context=resolveWeekActivity(a,collections,actions);if(context.project?.status==='Paused')continue;const engagement=context.kind==='volunteering'?rows(collections,'exploreEngagements').find(r=>context.recordHref?.id===r.id):undefined;
    if(engagement&&['Participated','Follow-up','Closed'].includes(text(engagement.status)))continue;
    const place=engagement?text(engagement.place):'';
    const checks=context.kind==='volunteering'?['Review organizer instructions','Check the meeting point and access','Check registration and supplies']:context.kind==='project'?['Read this step and its safety notes','Gather materials and permissions','Choose a suitable place']:context.kind==='test'?['Review provider instructions','Check collection and delivery arrangements']:actionCategory(a)==='Outdoors'?['Check current official conditions','Review access and preparation']:['Review the original instructions','Gather what you need'];
    const instructions=(context.instructions??(context.preparation?[context.preparation]:[])).map(text);
    result.push({id:a.id,title:text(a.title),date,action:a,route:context.recordHref,label:context.label,place,url:engagement?safePublicLink(text(engagement.url)):context.sourceLinks?.[0]?.url??null,instructions,checks,status:engagement?text(engagement.status):actionStateLabels[a.state]??a.state,
      signature:JSON.stringify([a.id,a.revision,m.time,m.zone,date,engagement?.revision,place,instructions])});
  }
  for(const r of rows(collections,'exploreEngagements')){const date=text(r.date);if(!usable(date)||date<today||date>end||['Participated','Follow-up','Closed'].includes(text(r.status))||actions.some(a=>a.key===`explore:commitment:${text(r.id)}`))continue;
    result.push({id:`engagement:${text(r.id)}`,signature:JSON.stringify([r.id,r.revision,date,r.place,r.preparation]),title:text(r.title),date,route:{tab:'act',destination:'opportunities',view:'detail',id:text(r.id)},label:'Community',place:text(r.place),url:safePublicLink(text(r.url)),instructions:text(r.preparation)?[text(r.preparation)]:[],checks:['Review organizer instructions','Check the meeting point and access','Check registration and supplies'],status:text(r.status)});
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}

export function meetingMapLink(place:string){if(!place.trim()||place.length>160||/example|illustrative|confirm with/i.test(place))return null;return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.trim())}`;}
export function repeatPlanDates(action:PreviewAction,m:WeekMeta,today:string){
  if(m.recurrence==='none'||m.time||!usable(action.date))return [];
  if(m.recurrence==='after-completion'){if(action.state!=='completed'||!usable(m.completedOn))return [];return [dayAdd(m.completedOn,7)];}
  let date=action.date;while(date<=today)date=dayAdd(date,7);return [date,dayAdd(date,7),dayAdd(date,14)];
}
