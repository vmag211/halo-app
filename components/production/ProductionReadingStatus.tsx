'use client';
import HaloLoading from '@/components/ui/HaloLoading';
import {useStageSession} from '@/components/stage/StageSession';
import {RefreshCw,WifiOff} from 'lucide-react';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {productRoute} from '@/lib/frontend/product-routes';
export default function ProductionReadingStatus({route}:{route:string}){
 const session=useStageSession();
 const deadline=useRef(0),[seconds,setSeconds]=useState(0);
 // My Week and the workspaces inside a tab are about tasks and records, not readings: the reading notice there is one quiet line.
 const pathname=usePathname()??'';
 const taskView=route==='plan'||Boolean(productRoute(pathname)?.destination);
 useEffect(()=>{if(session.daily.error==='rate_limited'||session.home.error==='rate_limited')deadline.current=Date.now()+300000;},[session.daily.error,session.home.error]);
 useEffect(()=>{let active=true;const update=()=>{if(active)setSeconds(Math.max(0,Math.ceil((deadline.current-Date.now())/1000)));};queueMicrotask(update);const timer=setInterval(update,1000);return()=>{active=false;clearInterval(timer);};},[]);
 const readings=route==='home'?[session.home]:route==='today'?[session.daily]:route==='plan'?[session.daily,session.home]:[];
 const loading=readings.some(reading=>reading.loading),failed=readings.some(reading=>reading.error),stored=readings.some(reading=>reading.cached&&reading.data);
 // A failed reading refresh is still named while the profile needs reconnecting, so stored readings never pass as current.
 if(session.profileWarning||session.profilePending)return <div className="halo-f-offline" role="status">{session.profilePending?<HaloLoading label="Checking your profile" />:<p>Reconnect your profile to make changes. Your drafts are kept.{failed&&!loading?' Some readings are unavailable. Previous readings keep their original dates.':''}</p>}{!session.profilePending&&<button className="halo-text-button" disabled={session.offline} onClick={()=>void session.refreshProfile()}>Reconnect</button>}</div>;
 if(session.offline)return <div className="halo-f-offline" role="status"><WifiOff size={18} aria-hidden="true"/><p>Offline. Available readings keep their original dates. Changes are not queued.</p></div>;
 if(!readings.length||route==='plan'&&!loading&&!failed&&!stored)return null;
 // My Week shows nothing here once readings settle, so its pending indicator floats instead of pushing the page down and back.
 const message=failed?(taskView?'Some readings unavailable. Others keep their original dates.':'Some readings are unavailable. Previous readings keep their original dates.'):(taskView?'Stored readings, shown with their original dates.':'Showing stored readings with their original dates.');
 return <div className="halo-stage-refresh" role="status" data-compact="true" data-floating={route==='plan'&&loading?'true':undefined}>{loading?<HaloLoading label="Updating environmental readings" />:(failed||stored)&&<p>{message}</p>}{!loading&&<button className="halo-text-button" disabled={seconds>0} aria-label={seconds>0?undefined:'Refresh readings'} onClick={()=>void session.refresh(true)}><RefreshCw size={15} aria-hidden="true"/>{seconds>0?`Try again in ${seconds}s`:taskView?'Refresh':'Refresh readings'}</button>}</div>;
}
