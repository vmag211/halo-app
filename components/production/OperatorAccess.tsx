'use client';
import {useEffect,useMemo,useState} from 'react';
import {createProductionRuntime} from '@/lib/frontend/production/runtime';
import {ProductionContext} from './ProductionContext';
import ProductionSourceOperations from './ProductionSourceOperations';
import '../expanded/source-operations-review.css';

/** Existing operator session only. Visiting this route never signs up or upgrades a household account. */
export default function OperatorAccess(){
 const [identity,setIdentity]=useState<string|null>(null),[loading,setLoading]=useState(true),[timedOut,setTimedOut]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true,pending=true;let unsubscribe:(()=>void)|undefined;
  const timer=setTimeout(()=>{if(active&&pending){pending=false;setIdentity(null);setTimedOut(true);setLoading(false);}},8000);
  void import('@/lib/supabase').then(async({supabase})=>{
   if(!active||!pending)return;
   const {data,error}=await supabase.auth.getSession();
   if(!active||!pending)return;
   pending=false;clearTimeout(timer);setIdentity(error?null:data.session?.user.id??null);setLoading(false);
   const subscription=supabase.auth.onAuthStateChange((_event,session)=>{if(active)setIdentity(session?.user.id??null);});
   unsubscribe=()=>subscription.data.subscription.unsubscribe();if(!active)unsubscribe();
  }).catch(()=>{if(active&&pending){pending=false;clearTimeout(timer);setIdentity(null);setLoading(false);}});
  return()=>{active=false;pending=false;clearTimeout(timer);unsubscribe?.();};
 },[attempt]);
 return <main className="source-ops-review" style={{boxSizing:'border-box',width:'min(900px, calc(100% - 32px))',maxWidth:'none',margin:'2rem auto',padding:'1rem'}}>{loading?<p role="status">Checking your session...</p>:identity?<OperatorSession key={identity} identity={identity}/>:<><h1>Source operations</h1>{timedOut?<p role="alert">The session check took too long. Retry when your connection is ready.</p>:<p>A verified operator session is required. Sign in through your organization’s configured access, then retry.</p>}<button type="button" onClick={()=>{setTimedOut(false);setLoading(true);setAttempt(value=>value+1);}}>Retry access</button></>}</main>;
}
function OperatorSession({identity}:{identity:string}){
 const connection=useMemo(()=>{const lifecycle={active:true};return {setActive:(value:boolean)=>{lifecycle.active=value;},runtime:createProductionRuntime({identityId:identity,homeContextId:null,active:()=>lifecycle.active,credential:async()=>{const {supabase}=await import('@/lib/supabase');const {data,error}=await supabase.auth.getSession();return error||!data.session?null:{identityId:data.session.user.id,accessToken:data.session.access_token};}})};},[identity]);
 useEffect(()=>{connection.setActive(true);return()=>{connection.setActive(false);};},[connection]);
 return <ProductionContext.Provider value={connection.runtime}><ProductionSourceOperations/></ProductionContext.Provider>;
}
