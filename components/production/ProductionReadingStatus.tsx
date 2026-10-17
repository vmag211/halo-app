'use client';
import HaloLoading from '@/components/ui/HaloLoading';
import {useStageSession} from '@/components/stage/StageSession';
import {RefreshCw,WifiOff} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
export default function ProductionReadingStatus({route}:{route:string}){
 const session=useStageSession();
 const deadline=useRef(0),[seconds,setSeconds]=useState(0);
 useEffect(()=>{if(session.daily.error==='rate_limited'||session.home.error==='rate_limited')deadline.current=Date.now()+300000;},[session.daily.error,session.home.error]);
 useEffect(()=>{let active=true;const update=()=>{if(active)setSeconds(Math.max(0,Math.ceil((deadline.current-Date.now())/1000)));};queueMicrotask(update);const timer=setInterval(update,1000);return()=>{active=false;clearInterval(timer);};},[]);
 const readings=route==='home'?[session.home]:route==='today'?[session.daily]:route==='plan'?[session.daily,session.home]:[];
 const loading=readings.some(reading=>reading.loading),failed=readings.some(reading=>reading.error),stored=readings.some(reading=>reading.cached&&reading.data);
 if(session.profileWarning||session.profilePending)return <div className="halo-f-offline" role="status">{session.profilePending?<HaloLoading label="Checking your profile" />:<p>Reconnect your profile to make changes. Your drafts are kept.</p>}{!session.profilePending&&<button className="halo-text-button" disabled={session.offline} onClick={()=>void session.refreshProfile()}>Reconnect</button>}</div>;
 if(session.offline)return <div className="halo-f-offline" role="status"><WifiOff size={18} aria-hidden="true"/><p>Offline. Available readings keep their original dates. Changes are not queued.</p></div>;
 if(!readings.length||route==='plan'&&!loading&&!failed&&!stored)return null;
 return <div className="halo-stage-refresh" role="status">{loading?<HaloLoading label="Updating environmental readings" />:(failed||stored)&&<p>{failed?'Some readings are unavailable. Previous readings keep their original dates.':'Showing stored readings with their original dates.'}</p>}{!loading&&<button className="halo-text-button" disabled={seconds>0} onClick={()=>void session.refresh(true)}><RefreshCw size={15} aria-hidden="true"/>{seconds>0?`Try again in ${seconds}s`:'Refresh readings'}</button>}</div>;
}
