import { validActionDate, type PreviewAction } from './expanded-preview';
import { effectiveTestStatus, hasRecordedResult } from './home-test-preview';
import { dayAdd, weekStart } from './week-preview';

export type WeekRecord = {
  id: string; title: string; date: string; kind: 'test-plan'|'test-result'|'routine'|'project'|'activity'|'followup';
  category: 'Home'|'Projects'|'Community'; annotation: string;
  destination: 'tests'|'maintenance'|'projects'|'opportunities'|'community'|'outreach'|'observations';
  recordId: string; view: string;
};
type Row=Record<string,unknown>;
const text=(value:unknown)=>typeof value==='string'?value.replace(/\u2014/g,',').trim():'';
const valid=(date:string)=>Boolean(date)&&validActionDate(date);
const rows=(collections:Record<string,unknown[]|undefined>,key:string)=> (collections[key]??[]).filter((v):v is Row=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)).filter(v=>text(v.id)&&text(v.title));

/** Read only supplied owned collections. No fixture fallback or inferred deadlines. */
export function datedWeekRecords(collections:Record<string,unknown[]|undefined>,actions:PreviewAction[]=[]):WeekRecord[]{
  const result:WeekRecord[]=[];
  function push(row:Row,date:string,kind:WeekRecord['kind'],category:WeekRecord['category'],annotation:string,destination:WeekRecord['destination'],view='detail',canonical=''){
    if(!valid(date)||canonical&&actions.some(a=>a.key===canonical&&a.date===date))return;
    const recordId=text(row.id);result.push({id:`record:${kind}:${recordId}`,title:text(row.title),date,kind,category,annotation,destination,recordId,view});
  }
  for(const row of rows(collections,'tests')){if(row.archived===true)continue;
    if(['draft','arranged'].includes(effectiveTestStatus(row)))push(row,text(row.plannedDate),'test-plan','Home','Proposed test date, not a completed sample','tests','detail',`home:${text(row.id)}`);
    if(['sampled','awaiting','arranged'].includes(effectiveTestStatus(row))&&!hasRecordedResult(row.rows))push(row,text(row.expectedDate),'test-result','Home','Expected result date, not a laboratory delivery guarantee','tests','detail',`home:${text(row.id)}`);
  }
  for(const row of rows(collections,'assets')){if(row.status!=='active')continue;const date=text(row.snoozedUntil)||text(row.nextDue);if(text(row.endDate)&&date>text(row.endDate))continue;push(row,date,'routine','Home',row.snoozedUntil?'User-snoozed routine date':'Routine date from your home-care record','maintenance','detail',`home:${text(row.id)}`);}
  for(const row of rows(collections,'exploreProjects')){if(row.status==='Paused')continue;push(row,text(row.reviewDate),'project','Projects','Chosen project review date','projects','detail');}
  for(const row of rows(collections,'exploreEngagements')){if(row.status==='Closed')continue;
    push(row,text(row.date),'activity','Community',`Activity plan (${text(row.status)||'Considering'}), not organizer registration`,'opportunities','detail',`explore:commitment:${text(row.id)}`);
    push(row,text(row.followupDate),'followup','Community','Chosen participation check-back date','opportunities','detail',`explore:commitment:${text(row.id)}:followup`);
  }
  for(const row of rows(collections,'exploreOutcomes')){if(['Closed without a result','Result recorded'].includes(text(row.status)))continue;const id=text(row.id);const destination=id.startsWith('note-case:')?'observations':id.startsWith('project-review:')?'projects':id.startsWith('outreach')?'outreach':'community';push(row,text(row.followupDate),'followup',destination==='projects'?'Projects':'Community','Chosen question or case check-back date',destination,destination==='community'||destination==='outreach'?'list':'detail',`explore:followthrough:${id}`);}
  return result.sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}

export type WeeklyReviewPreferences={enabled:boolean;weekday:number;time:string;zone:string};
export function nextWeeklyReview(today:string,weekday:number){if(!valid(today)||!Number.isInteger(weekday)||weekday<0||weekday>6)return '';const current=new Date(`${today}T12:00:00Z`).getUTCDay();return dayAdd(today,(weekday-current+7)%7);}
export function weeklyReviewKey(day:string){return `week-review:${weekStart(day)}`;}
