'use client';

import {useEffect,useId,useRef,type CSSProperties} from 'react';
import {AnimatedNumber,useSceneExperience} from './SceneExperience';
import {normalizeSegments,type ScoreSegment} from './SegmentedScore';

/** Score length and risk composition are separate quantities, never formula weights. */
export default function OverviewScoreOrbit({score,home,partial,segments}:{score:number|null;home:boolean;partial:boolean;segments:readonly ScoreSegment[]}) {
  const id=useId();
  const arc=useRef<SVGCircleElement>(null);
  const played=useRef<number|null>(null);
  const {enabled,ready}=useSceneExperience();
  const available=score!==null&&Number.isFinite(score);
  const progress=available?Math.max(0,Math.min(100,score)):0;
  const shares=normalizeSegments(segments);
  const explanation=shares.map(s=>`${s.label}: ${s.share===null?'unavailable':`${Number(s.percent.toFixed(1))}% of available risk inputs`}`).join('. ');
  useEffect(()=>{
    const node=arc.current;
    if(progress<=0)played.current=null;
    if(!ready||!enabled||!node||progress<=0||played.current===progress)return;
    const contrast=matchMedia('(forced-colors: active)');
    if(contrast.matches||document.hidden)return;
    let animation:Animation|undefined;
    const finish=()=>{animation?.cancel();};
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting)||document.hidden)return;
      observer.disconnect();played.current=progress;
      animation=node.animate([{strokeDasharray:'0 100'},{strokeDasharray:`${progress} ${100-progress}`}],{duration:1050,easing:'cubic-bezier(.22,1,.36,1)'});
    },{threshold:.3});
    const visibility=()=>{if(document.hidden)finish();};
    const forced=()=>{if(contrast.matches){observer.disconnect();finish();}};
    observer.observe(node);document.addEventListener('visibilitychange',visibility);contrast.addEventListener('change',forced);
    return()=>{observer.disconnect();finish();document.removeEventListener('visibilitychange',visibility);contrast.removeEventListener('change',forced);};
  },[progress,ready,enabled]);
  return <div className="halo-environment-score halo-score-orbit" data-empty={!available} data-partial={partial} role="img" aria-label={`${home?'Your home score':'Your personal score'}: ${available?`${score} out of 100`:'Not available'}${partial?'. Partial coverage':''}. Inner arc shows the score. Outer ring shows risk shares, not score points. ${explanation}`}>
    <svg viewBox="0 0 180 180" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b6fff0"/><stop offset=".55" stopColor="#64d7ce"/><stop offset="1" stopColor="#8acbe8"/></linearGradient></defs>
      <circle className="halo-score-orbit-shell" cx="90" cy="90" r="89"/>
      <circle className="halo-score-orbit-ticks" cx="90" cy="90" r="85" pathLength="100" strokeDasharray=".35 1.65"/>
      <circle className="halo-score-orbit-composition-track" cx="90" cy="90" r="78"/>
      {shares.filter(s=>s.percent>0).map(s=><circle key={s.key} className="halo-score-orbit-share" data-factor={s.key} data-share={s.percent} cx="90" cy="90" r="78" pathLength="100" stroke={s.color} strokeDasharray={`${s.percent} ${100-s.percent}`} strokeDashoffset={-s.offset} transform="rotate(-90 90 90)"/>)}
      <circle className="halo-score-orbit-track" cx="90" cy="90" r="68"/>
      {available&&progress>0&&<circle ref={arc} className="halo-score-orbit-value" cx="90" cy="90" r="68" pathLength="100" strokeDasharray={`${progress} ${100-progress}`} transform="rotate(-90 90 90)" style={{'--score-orbit-fill':`url(#${id})`} as CSSProperties}/>}
      <circle className="halo-score-orbit-inner" cx="90" cy="90" r="57"/>
    </svg>
    <div className="halo-score-orbit-number" aria-hidden="true"><strong>{available?<AnimatedNumber value={score}/>:'N/A'}</strong><span>{available?'out of 100':'No reading'}</span></div>
  </div>;
}
