import {validActionDate,type PreviewAction,type ActionRevision} from './expanded-preview';
import {actionCategory,dayAdd,emptyWeekMeta,weekStart,type WeekMeta} from './week-preview';
export type LunaWeekPlan={date:string;budget:number|null;items:{id:string;revision:number;key:string;title:string;previousDate:string;date:string;minutes:number}[];unknown:number;commitments:number;metadataSignature:string;explanation:string};
export function isLunaWeekRequest(request:string){return /\b(week|weekend)\b/i.test(request)&&/\b(plan|organize|arrange|fit|schedule|available|have|review)\b/i.test(request)&&!/^open\b/i.test(request);}
export function weekMetaSignature(items:{key:string}[],metas:Record<string,WeekMeta>){return JSON.stringify(items.map(i=>{const m=metas[i.key];return [i.key,m?.time??'',m?.zone??'',m?.duration??null,Boolean(m?.estimateSet),Boolean(m?.paused),Boolean(m?.archived)];}));}
/** Bounded scheduling study. No private notes, forecast assumptions or invented effort. */
export function prepareLunaWeekPlan(request:string,actions:PreviewAction[],metas:Record<string,WeekMeta>,anchor:string):LunaWeekPlan{
  const found=request.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i);const budget=found?Math.round(Number(found[1])*(/^h/i.test(found[2])?60:1)):/\b(an?|one) hour\b/i.test(request)?60:null;
  const explicit=request.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[];const weekend=dayAdd(weekStart(anchor),5);const date=explicit.length?explicit.length===1&&validActionDate(explicit[0])?explicit[0]:'':/weekend/i.test(request)?weekend<anchor?dayAdd(weekend,1):weekend:'';
  const active=actions.filter(a=>a.state==='saved'&&!metas[a.key]?.paused&&!metas[a.key]?.archived);
  const candidates=active.filter(a=>!a.date&&!metas[a.key]?.time&&(!/projects?/i.test(request)||actionCategory(a)==='Projects'));
  const known=candidates.filter(a=>{const m=metas[a.key];return m&&(m.estimateSet||m.time)&&Number.isInteger(m.duration)&&m.duration>=15&&m.duration<=1440;});
  let used=0;const items: LunaWeekPlan['items']=[];
  for(const a of known){const minutes=metas[a.key].duration;if(budget!==null&&(budget<15||budget>10080||used+minutes>budget))continue;if(items.length===12)break;items.push({id:a.id,revision:a.revision??1,key:a.key,title:a.title,previousDate:a.date,date,minutes});used+=minutes;}
  const commitments=actions.filter(a=>a.date&&a.state!=='completed'&&!metas[a.key]?.archived&&!metas[a.key]?.paused&&a.date>=weekStart(anchor)&&a.date<=dayAdd(weekStart(anchor),6)).length;
  return {date,budget,items,unknown:candidates.length-known.length,commitments,metadataSignature:weekMetaSignature(items,metas),explanation:items.length?'Only unscheduled tasks with your supplied effort estimates. Existing dated commitments stay unchanged.':'No unscheduled tasks with supplied effort estimates fit yet. Add estimates in task details, or use the weekly review to plan manually.'};
}
export function lunaWeekChanges(plan:LunaWeekPlan):ActionRevision[]|null{if(!plan.items.length||plan.items.some(i=>!i.date||!validActionDate(i.date)))return null;return plan.items.map(i=>({id:i.id,revision:i.revision,patch:{title:i.title,date:i.date,state:'saved'}}));}
