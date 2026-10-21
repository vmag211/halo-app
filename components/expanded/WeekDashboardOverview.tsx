'use client';

import Link from 'next/link';
import {ArrowUpRight, Check, Flame, House, Sunrise} from 'lucide-react';
import {useStageRuntime} from '@/components/foundation/StageRuntime';
import {AnimatedNumber} from '@/components/foundation/SceneExperience';
import {previewOverviewScore} from '@/lib/frontend/overview-preview';
import {actionStreak, calendarDays, countLabel, dayLabel, emptyWeekMeta, type WeekMeta} from '@/lib/frontend/week-preview';
import type {PreviewAction} from '@/lib/frontend/expanded-preview';

type Props={href:(tab:string,destination?:string)=>string;scenario:string;actions:PreviewAction[];metas:Record<string,WeekMeta>;date:string;today:string;streak:boolean;onStreak:(value:boolean)=>void};
export default function WeekDashboardOverview({href,scenario,actions,metas,date,today,streak,onStreak}:Props){
  const runtime=useStageRuntime();
  const completed=actions.filter(a=>a.state==='completed').map(a=>({...emptyWeekMeta,...metas[a.key]}).completedOn);
  const days=calendarDays(date);
  const unavailable=['card-no-data','empty','offline-empty','loading','error'].includes(scenario);
  return <section className="mw-overview" aria-label="Your HALO overview">
    <header><span>Around you</span><small>Scores, higher is better</small></header>
    <div className="mw-score-pair">{(['today','home'] as const).map(tab=>{
      // A mounted live provider is authoritative, including null. No fixture fallback.
      const value=runtime?runtime[tab]:previewOverviewScore(tab==='home',unavailable?'no-data':scenario);
      const Icon=tab==='home'?House:Sunrise;
      return <Link href={href(tab)} key={tab} className="mw-score-glance" aria-label={`Open ${tab==='home'?'Homeguard':'Today'}, ${value.score===null?'score unavailable':`${value.score} out of 100`}${value.partial?', partial score':''}`}>
        <div className="mw-mini-gauge" aria-hidden="true"><svg viewBox="0 0 80 64"><path className="mw-gauge-track" pathLength="100" d="M 12 51 A 32 32 0 1 1 68 51"/>{value.score!==null&&<path className="mw-gauge-value" pathLength="100" strokeDasharray={`${value.score} 100`} d="M 12 51 A 32 32 0 1 1 68 51"/>}</svg><strong>{value.score===null?'N/A':<AnimatedNumber value={value.score}/>}</strong></div>
        <span><b><Icon size={14} aria-hidden="true"/>{tab==='home'?'Homeguard':'Today'}</b><small>{value.score===null?'No score':value.partial?'Partial score':'View readings'}</small></span><ArrowUpRight size={14} aria-hidden="true"/>
        <span className="halo-sr-only">{value.asOf}. Scores do not change when tasks are completed.</span>
      </Link>;
    })}</div>
    {(streak||completed.some(Boolean))&&<div className="mw-action-rhythm" aria-label="Action rhythm">
      <div className="mw-rhythm-title"><span><Flame size={15} aria-hidden="true"/>{streak?`${actionStreak(completed,today)} day${actionStreak(completed,today)===1?'':'s'} of follow-through`:'This week’s follow-through'}</span><button type="button" aria-pressed={streak} onClick={()=>onStreak(!streak)}>{streak?'Hide streak':'Show streak'}</button></div>
      <div className="mw-rhythm-days">{days.map(day=>{const count=completed.filter(d=>d===day).length;return <span key={day} data-complete={count>0} data-today={day===today} aria-label={`${dayLabel(day)}, ${countLabel(count,'completed action','completed actions')}`}><small>{dayLabel(day,{weekday:'narrow'})}</small><i aria-hidden="true">{count>0&&<Check size={12}/>}</i></span>;})}</div>
      <small className="mw-rhythm-caption">Completed actions. Check-ins do not count.</small>
    </div>}
  </section>;
}

export function WeekToolVisual({outdoors=false}:{outdoors?:boolean}){
  return <svg className="mw-tool-art" viewBox="0 0 120 80" fill="none" aria-hidden="true">{outdoors?<><path d="M-8 52C17 17 39 16 52 35s30 37 77 10M-8 66C24 29 41 30 56 45s36 30 76 13M-8 36C14 0 44 2 61 23s41 27 70 4"/><path className="mw-tool-art-focus" d="M4 73c25-9 10-29 33-37s36 13 66-28" strokeDasharray="3 5"/><path d="M78 67V36m0 0-10 17h20L78 36ZM97 72V51m0 0-7 12h14l-7-12Z"/></>:<><path d="M27 70V16l29-6 29 6v54l-29-6-29 6ZM56 10v54M34 27l15-3m-15 14 15-3m-15 14 15-3m14-22 15 3m-15 8 15 3m-15 8 15 3"/><path className="mw-tool-art-focus" d="m82 47 17-21 5 4-17 21-7 4 2-8Z"/><path d="M18 70V23m74 37v16H31"/></>}</svg>;
}

export function DashboardWelcomeArt(){return <svg className="mw-welcome-art" viewBox="0 0 100 70" fill="none" aria-hidden="true"><path d="M-5 57c18-23 27-11 41-18s25-1 43-13 21-8 30-6M-5 64c20-18 31-10 49-19s32-5 56-13"/><path d="M24 26a12 12 0 0 1 24 0m-12-20V2M15 13l-4-4m46 4 4-4M4 26h5m54 0h5M75 65V42m0 7c-12 0-13-9-11-14 9 1 12 5 11 14Zm0 7c12-1 16-7 14-14-9 1-15 6-14 14Z"/></svg>;}
