'use client';
import {useEffect,useLayoutEffect,useMemo,useState,type ReactNode} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import StageSession,{useStageSession} from '@/components/stage/StageSession';
import FoundationPreview from '@/components/foundation/FoundationPreview';
import {HomeWorkspaceProvider} from '@/components/homeguard/HomeWorkspaceState';
import {ExpandedPreviewProvider} from '@/components/expanded/ExpandedPreviewState';
import {ProductionContext} from './ProductionContext';
import ProductionPreferences from './ProductionPreferences';
import {createProductionRuntime} from '@/lib/frontend/production/runtime';
import {createHomeAdapter,createActionAdapter} from '@/lib/frontend/production/adapters';
import {deliveredStagePath} from '@/lib/frontend/navigation';
import {isFactorKey} from '@/lib/frontend/factor-preview';
import {homeMemberKeys,type HomeMemberKey} from '@/lib/frontend/home-household';
import type {PreviewRoute} from '@/lib/frontend/foundation-preview';
import '../stage/stage.css';

/** Production reuses the reviewed components, never the review state provider defaults. */
export default function ProductionApp({children}:{children:ReactNode}) {const pathname=usePathname();if(!deliveredStagePath(pathname))return <>{children}</>;return <StageSession><SessionBoundary>{children}</SessionBoundary></StageSession>;}
function SessionBoundary({children}:{children:ReactNode}){
 const session=useStageSession(),[identity,setIdentity]=useState<string|null>(null),[identityError,setIdentityError]=useState(false);
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
  queueMicrotask(()=>{if(active){setIdentity(null);setIdentityError(false);}});
  if(session.gate==='ready'){
   timer=setTimeout(()=>{if(active){active=false;setIdentityError(true);}},8000);
   void Promise.resolve().then(()=>session.api.getIdentity?.()).then(value=>{if(!active)return;clearTimeout(timer);if(value)setIdentity(value);else setIdentityError(true);}).catch(()=>{if(active){clearTimeout(timer);setIdentityError(true);}});
  }
  return()=>{active=false;clearTimeout(timer);};
 },[session.gate,session.api]);
 if(session.gate==='error'||identityError)return <div className="halo-app halo-f-app"><main className="halo-f-main"><h1>Let’s reconnect</h1><p>Your account could not be loaded.</p><button className="hp-primary" onClick={()=>{setIdentityError(false);void session.restart();}}>Try again</button><Link href="/learn">Browse public information</Link></main></div>;
 if(session.gate==='loading'||!identity)return <div className="halo-app halo-f-app"><main aria-busy="true" className="halo-f-main"><p role="status">Opening HALO…</p></main></div>;
 return <ConnectedApp key={`${identity}:${session.profile?.home_context?.id??session.profile?.profile?.home_context_id??'none'}:${session.profile?.home_context?.revision??session.profile?.profile?.context_revision??0}`} identityId={identity!}>{children}</ConnectedApp>;
}
function ConnectedApp({identityId,children}:{identityId:string;children:ReactNode}){
 const session=useStageSession(),pathname=usePathname(),router=useRouter(),params=useSearchParams();
 const legacy=params.get('learn')??params.get('risk');
 useEffect(()=>{const factor=legacy==='water'?'pfas':legacy;if(isFactorKey(factor)&&(pathname==='/home'?['pfas','radon','lead'].includes(factor):pathname==='/today'&&['air','uv','pollen','mold'].includes(factor)))router.replace(`/factors/${factor}#reading-overview`);},[legacy,pathname,router]);
 const homeId=session.profile?.home_context?.id??session.profile?.profile?.home_context_id??null;
 const currentContextRevision=session.profile?.home_context?.revision??session.profile?.profile?.context_revision;
 const connection=useMemo(()=>{const lifecycle={active:true,writeAllowed:true};return {setActive:(value:boolean)=>{lifecycle.active=value;},setWriteAllowed:(value:boolean)=>{lifecycle.writeAllowed=value;},runtime:createProductionRuntime({active:()=>lifecycle.active,writeAllowed:()=>lifecycle.writeAllowed,identityId,homeContextId:homeId,contextRevision:currentContextRevision,credential:async()=>{const {supabase}=await import('@/lib/supabase');const {data,error}=await supabase.auth.getSession();if(error||!data.session)return null;return {identityId:data.session.user.id,accessToken:data.session.access_token};}})};},[identityId,homeId,currentContextRevision]);
 useLayoutEffect(()=>{connection.setActive(true);return()=>{connection.setActive(false);};},[connection]);
 useLayoutEffect(()=>{connection.setWriteAllowed(!!session.profile&&!session.profileWarning&&!session.profilePending);},[connection,session.profile,session.profileWarning,session.profilePending]);
 const runtime=connection.runtime;
 const county=session.profile?.profile?.county,state=session.profile?.profile?.state,waterSource=session.profile?.profile?.water_source,contextRevision=currentContextRevision;
 const home=useMemo(()=>createHomeAdapter(runtime,{currentHomeId:homeId,homes:homeId?[{id:homeId,label:'Current home',state:'current',revision:contextRevision??1}]:[],areaLabel:[county,state].filter(Boolean).join(', '),waterSource:waterSource==='utility'?'utility':waterSource==='well'?'well':waterSource==='spring'?'spring':'unknown'}),[runtime,homeId,contextRevision,county,state,waterSource]);
 const actions=useMemo(()=>createActionAdapter(runtime),[runtime]);
 const factor=pathname.startsWith('/factors/')?pathname.split('/')[2]:null;
 const member=pathname.startsWith('/household/')?pathname.split('/')[2]:null;
 const route:PreviewRoute=pathname.startsWith('/home')||member?'home':pathname==='/today'||pathname==='/family'||factor&&!['pfas','radon','lead'].includes(factor)?'today':factor?'home':pathname==='/act'?'act':pathname==='/settings'?'settings':'plan';
 const known=['/plan','/today','/home','/act','/settings','/family'].includes(pathname)||isFactorKey(factor)||homeMemberKeys.includes(member as HomeMemberKey);
 return <ProductionContext.Provider value={runtime}><HomeWorkspaceProvider service={home}><ExpandedPreviewProvider service={actions}><ProductionPreferences>{known?<div data-testid="production-product"><FoundationPreview initialScenario="shell" productionRoute={route} preferences={{expanded:true}} initialFactor={isFactorKey(factor)?factor:undefined} initialFamily={pathname==='/family'} initialMember={homeMemberKeys.includes(member as HomeMemberKey)?member as HomeMemberKey:undefined}/></div>:children}</ProductionPreferences></ExpandedPreviewProvider></HomeWorkspaceProvider></ProductionContext.Provider>;
}
