'use client';
import type {ReactNode} from 'react';
import {Clock3,MoveRight} from 'lucide-react';
import type {PreviewAction} from '@/lib/frontend/expanded-preview';
import {emptyWeekMeta,eventInstant,type WeekMeta} from '@/lib/frontend/week-preview';
import {actionDisplayDay,clockLabel,dayTimeline} from '@/lib/frontend/week-timeline';
export default function WeekTimeline({actions,metas,date,zone,row,onMove}:{actions:PreviewAction[];metas:Record<string,WeekMeta>;date:string;zone:string;row:(a:PreviewAction)=>ReactNode;onMove:(a:PreviewAction)=>void}){
 const timed=dayTimeline(actions,metas,date,zone);const anytime=actions.filter(a=>{const m={...emptyWeekMeta,...metas[a.key]};return (!m.time||m.paused||!eventInstant(a.date,m.time,m.zone))&&actionDisplayDay(a,m,zone)===date;});
 return <div className="mw-timeline">{anytime.length>0&&<div className="mw-anytime">{timed.length>0&&<h4>Any time</h4>}{anytime.map(row)}</div>}{timed.length>0&&<div className="mw-time-track"><div className="mw-section-head"><h4>Your day, in order</h4><small>{zone.replace('America/','').replaceAll('_',' ')}</small></div>{timed.map(item=><div className="mw-time-entry" key={item.action.id}>{item.gapBefore>=15&&<p className="mw-time-gap">{item.gapBefore} min between scheduled plans</p>}<div className="mw-time-block"><time dateTime={item.start}>{clockLabel(item.start,zone)}</time><div>{row(item.action)}<div className="mw-time-caption"><span><Clock3 size={12}/>{clockLabel(item.end,zone)}{item.continues?' · Continues across days':''}</span><button className="mw-text" aria-label={`Reschedule ${item.action.title}`} onClick={()=>onMove(item.action)}><MoveRight size={14}/>Move</button></div>{item.overlap&&<small className="mw-time-conflict">Overlaps another HALO plan</small>}</div></div></div>)}</div>}</div>;
}
