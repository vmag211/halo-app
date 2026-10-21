'use client';

import {useEffect, useState} from 'react';
import {ArrowRight, ChartNoAxesColumnIncreasing, HandHeart, House, Leaf, ListChecks, Sprout} from 'lucide-react';
import {BottomSheet} from '@/components/ui/Foundation';
import {countLabel,dayLabel} from '@/lib/frontend/week-preview';
import {dashboardKinds, effortLabel, type WeekDashboard} from '@/lib/frontend/week-dashboard';

const icons={Home:House,Projects:Sprout,Community:HandHeart,Outdoors:Leaf,Personal:ListChecks};
export default function WeekDashboardSummary({dashboard,filter,onFilter,onDay}:{dashboard:WeekDashboard;filter:string;onFilter:(kind:string)=>void;onDay:(day:string)=>void}){
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(!open)return;history.pushState({...history.state,haloWeekEffort:true},'',location.href);const back=()=>setOpen(false);window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[open]);
  const close=()=>{if(history.state?.haloWeekEffort)history.back();else setOpen(false);};
  const peak=Math.max(1,...dashboard.days.map(day=>day.minutes));
  return <div className="mw-board-summary">
    <div className="mw-board-totals" aria-label="Weekly plan overview"><span><strong>{dashboard.plans}</strong> planned</span><span><strong>{dashboard.completed}</strong> done</span><span><strong>{dashboard.records}</strong> {dashboard.records===1?"linked date":"linked dates"}</span></div>
    <nav className="mw-category-key" aria-label="Filter agenda by activity">{dashboardKinds.filter(kind=>Boolean(dashboard.kinds[kind])||filter===kind).map(kind=>{const Icon=icons[kind];return <button type="button" key={kind} data-kind={kind} aria-label={`${kind}, ${countLabel(dashboard.kinds[kind]??0,'item','items')} this week`} title={`${kind}: ${countLabel(dashboard.kinds[kind]??0,'item','items')}`} aria-pressed={filter===kind} onClick={()=>onFilter(filter===kind?'Everything':kind)}><Icon size={15} aria-hidden="true"/><span>{kind}</span></button>;})}</nav>
    <button type="button" className="mw-effort-open" onClick={()=>setOpen(true)}><ChartNoAxesColumnIncreasing size={18} aria-hidden="true"/><span>Plan effort</span><strong>{dashboard.minutes?`${effortLabel(dashboard.minutes)} planned`:dashboard.unknown?'Estimates not set':'No effort planned'}</strong><ArrowRight size={15} aria-hidden="true"/></button>
    {open&&<BottomSheet id="week-effort" title="Your week, at a glance" height="standard" onClose={close}>
      <div className="mw-effort-sheet">
        <p>Timed plans and your effort estimates. Not tracked time or free calendar space.</p>
        <div className="mw-effort-days">{dashboard.days.map(day=><button type="button" key={day.date}
          aria-label={`Open ${dayLabel(day.date)}, ${day.plans} ${day.plans===1?"plan":"plans"}, ${day.records} linked ${day.records===1?"date":"dates"}, ${effortLabel(day.minutes)} supplied effort${day.unknown?`, ${day.unknown} without ${day.unknown===1?"an estimate":"estimates"}`:""}`}
          onClick={()=>{onDay(day.date);close();}}>
          <span><strong>{dayLabel(day.date,{weekday:"short"})}</strong><small>{dayLabel(day.date,{month:"short",day:"numeric"})}</small></span>
          <span className="mw-effort-track" aria-hidden="true"><i style={{width:`${day.minutes/peak*100}%`}}/><span>{!day.minutes&&(day.unknown?"Estimate needed":"No supplied effort")}</span></span>
          <span><strong>{day.minutes?effortLabel(day.minutes):day.plans?"Not set":day.records?"Date only":"No plans"}</strong>
            <small>{day.plans} {day.plans===1?"plan":"plans"}{day.records?` · ${countLabel(day.records,"date","dates")}`:""}{day.unknown?` · ${day.unknown} ${day.unknown===1?"needs":"need"} an estimate`:""}</small>
          </span>
        </button>)}</div>
        {dashboard.unknown>0&&<p>{dashboard.unknown} planned {dashboard.unknown===1?"task still needs":"tasks still need"} an estimate. Default durations are not counted.</p>}
        <button type="button" className="mw-text" onClick={close}>Done</button>
      </div>
    </BottomSheet>}
  </div>;
}
