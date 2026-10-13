'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useStageSession} from '@/components/stage/StageSession';
import {useStageRuntime} from '@/components/foundation/StageRuntime';
import {isFactorKey} from '@/lib/frontend/factor-preview';
import type {LearnContent} from '@/lib/frontend/stage-api';
export default function ProductionLearnSheet({topic,kind,mapHref}:{topic?:string;kind:string;mapHref:string}){
 const session=useStageSession(),readings=useStageRuntime(),[data,setData]=useState<LearnContent|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 const key=isFactorKey(topic)?topic:'air';
 useEffect(()=>{if(kind!=='learn')return;let active=true;const controller=new AbortController();queueMicrotask(()=>{if(active){setData(null);setError(false);}});void session.api.getLearn(key,readings?.readings[key].context,controller.signal).then(value=>{if(active){setData(value);setError(value.unavailable===true);}},()=>{if(active)setError(true);});return()=>{active=false;controller.abort();};},[session.api,key,readings,attempt,kind]);
 if(kind==='map')return <div className="hc-flow"><h3>Explore the map</h3><p>Read source coverage and compare nearby environmental records.</p><Link className="hp-primary" href={mapHref}>Open full map</Link></div>;
 return <div className="hc-flow">{!data&&!error&&<p role="status">Loading explanation…</p>}{error&&<div role="status"><p>The current explanation is unavailable.</p><button className="hp-text" onClick={()=>setAttempt(value=>value+1)}>Try again</button></div>}{data&&<><h3>{data.title}</h3><p>{data.what_it_is}</p>{data.why_yours&&<p>{data.why_yours}</p>}{data.household_note&&<p>{data.household_note}</p>}<ul>{data.protect.map((text,index)=><li key={index}>{text}</li>)}</ul><details><summary>Sources</summary>{data.sources.map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>{source.retrieved&&<small> · {source.retrieved}</small>}</p>)}</details></>}<Link className="hp-text" href={`/factors/${key}`}>Open full factor details</Link></div>;
}
