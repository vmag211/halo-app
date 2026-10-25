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
import HaloLoading from '@/components/ui/HaloLoading';
import {createProductionRuntime} from '@/lib/frontend/production/runtime';
import {nextHomeScope,observeHome,type HomeScope} from '@/lib/frontend/production/home-scope';
import {parseFeatureFlags,type FeatureFlags} from '@/lib/frontend/production/features';
import {createHomeAdapter,createActionAdapter} from '@/lib/frontend/production/adapters';
import {deliveredStagePath} from '@/lib/frontend/navigation';
import {legacyProductPath} from '@/lib/frontend/product-routes';
import {isFactorKey} from '@/lib/frontend/factor-preview';
import {homeMemberKeys,type HomeMemberKey} from '@/lib/frontend/home-household';
import type {PreviewRoute} from '@/lib/frontend/foundation-preview';
import '../stage/stage.css';

/** Production reuses the reviewed components, never the review state provider defaults. */
export default function ProductionApp({children}:{children:ReactNode}) {const pathname=usePathname();if(!deliveredStagePath(pathname))return <>{children}</>;return <StageSession><SessionBoundary>{children}</SessionBoundary></StageSession>;}
/** Which capabilities are on, read alongside the identity check. Any failure is unknown (null): every read is then sent as before. */
async function loadFeatureFlags():Promise<FeatureFlags|null>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
 try{const {supabase}=await import('@/lib/supabase');const {data}=await supabase.auth.getSession();if(!data.session)return null;
  const response=await fetch('/api/frontend/capabilities',{headers:{Accept:'application/json',Authorization:`Bearer ${data.session.access_token}`},cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
  return response.ok?parseFeatureFlags(await response.json()):null;
 }catch{return null;}finally{clearTimeout(timer);}
}
function SessionBoundary({children}:{children:ReactNode}){
 const session=useStageSession(),[identity,setIdentity]=useState<string|null>(null),[identityError,setIdentityError]=useState(false),[features,setFeatures]=useState<FeatureFlags|null|undefined>(undefined);
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
  queueMicrotask(()=>{if(active){setIdentity(null);setIdentityError(false);setFeatures(undefined);}});
  if(session.gate==='ready'){
   void loadFeatureFlags().then(value=>{if(active)setFeatures(value);});
   timer=setTimeout(()=>{if(active){active=false;setIdentityError(true);}},8000);
   void Promise.resolve().then(()=>session.api.getIdentity?.()).then(value=>{if(!active)return;clearTimeout(timer);if(value)setIdentity(value);else setIdentityError(true);}).catch(()=>{if(active){clearTimeout(timer);setIdentityError(true);}});
  }
  return()=>{active=false;clearTimeout(timer);};
 },[session.gate,session.api]);
 // E25: the home scope changes, and the app remounts, only on a genuine home transition, never on a re-read or an in-place home save.
 const [homeScope,setHomeScope]=useState<HomeScope|null>(null);
 const scope=identity?nextHomeScope(homeScope,identity,observeHome(session.profile)):homeScope;
 if(scope!==homeScope)setHomeScope(scope);
 if(session.gate==='error'||identityError)return <div className="halo-app halo-f-app"><main className="halo-f-main"><h1>Let’s reconnect</h1><p>Your account could not be loaded.</p><button className="hp-primary" onClick={()=>{setIdentityError(false);void session.restart();}}>Try again</button><Link href="/learn">Browse public information</Link></main></div>;
 if(session.gate==='loading'||!identity||!scope||features===undefined)return <div className="halo-app halo-f-app"><main className="halo-f-main"><HaloLoading layout="screen" label="Opening HALO" detail="Getting your workspace ready" /></main></div>;
 return <ConnectedApp key={`${identity}:${scope.epoch}`} identityId={identity} homeId={scope.id??null} homeRevision={scope.revision} scopeHome={scope.anchor} features={features}>{children}</ConnectedApp>;
}
function ConnectedApp({identityId,homeId,homeRevision,scopeHome,features,children}:{identityId:string;homeId:string|null;homeRevision:number|undefined;scopeHome:string;features:FeatureFlags|null;children:ReactNode}){
 const session=useStageSession(),pathname=legacyProductPath(usePathname()),router=useRouter(),params=useSearchParams();
 const legacy=params.get('learn')??params.get('risk');
 useEffect(()=>{const factor=legacy==='water'?'pfas':legacy;if(isFactorKey(factor)&&(pathname==='/home'?['pfas','radon','lead'].includes(factor):pathname==='/today'&&['air','uv','pollen','mold'].includes(factor)))router.replace(`/factors/${factor}#reading-overview`);},[legacy,pathname,router]);
 // The runtime follows the scope's current home (X-Halo-Home-Context, the history check, the projects key); the workspace session, which holds the drafts, keeps the scope's anchor until a transition remounts this.
 const connection=useMemo(()=>{const lifecycle={active:true,writeAllowed:true};return {setActive:(value:boolean)=>{lifecycle.active=value;},setWriteAllowed:(value:boolean)=>{lifecycle.writeAllowed=value;},runtime:createProductionRuntime({active:()=>lifecycle.active,writeAllowed:()=>lifecycle.writeAllowed,identityId,homeContextId:homeId,contextRevision:homeRevision,features,credential:async()=>{const {supabase}=await import('@/lib/supabase');const {data,error}=await supabase.auth.getSession();if(error||!data.session)return null;return {identityId:data.session.user.id,accessToken:data.session.access_token};}})};},[identityId,homeId,homeRevision,features]);
 useLayoutEffect(()=>{connection.setActive(true);return()=>{connection.setActive(false);};},[connection]);
 useLayoutEffect(()=>{connection.setWriteAllowed(!!session.profile&&!session.profileWarning&&!session.profilePending);},[connection,session.profile,session.profileWarning,session.profilePending]);
 const runtime=connection.runtime;
 const county=session.profile?.profile?.county,state=session.profile?.profile?.state,waterSource=session.profile?.profile?.water_source,contextRevision=homeRevision;
 const home=useMemo(()=>createHomeAdapter(runtime,{currentHomeId:homeId,homes:homeId?[{id:homeId,label:'Current home',state:'current',revision:contextRevision??1}]:[],areaLabel:[county,state].filter(Boolean).join(', '),waterSource:waterSource==='utility'?'utility':waterSource==='well'?'well':waterSource==='spring'?'spring':'unknown'},`${identityId}:${scopeHome}`),[runtime,homeId,contextRevision,county,state,waterSource,identityId,scopeHome]);
 const actions=useMemo(()=>createActionAdapter(runtime),[runtime]);
 const factor=pathname.startsWith('/factors/')?pathname.split('/')[2]:null;
 const member=pathname.startsWith('/household/')?pathname.split('/')[2]:null;
 const route:PreviewRoute=pathname.startsWith('/home')||member?'home':pathname==='/today'||pathname==='/family'||factor&&!['pfas','radon','lead'].includes(factor)?'today':factor?'home':pathname==='/act'?'act':pathname==='/settings'?'settings':'plan';
 const known=['/plan','/today','/home','/act','/settings','/family'].includes(pathname)||isFactorKey(factor)||homeMemberKeys.includes(member as HomeMemberKey);
 return <ProductionContext.Provider value={runtime}><HomeWorkspaceProvider service={home}><ExpandedPreviewProvider service={actions}><ProductionPreferences>{known?<div data-testid="production-product"><FoundationPreview initialScenario="shell" productionRoute={route} preferences={{expanded:true}} initialFactor={isFactorKey(factor)?factor:undefined} initialFamily={pathname==='/family'} initialMember={homeMemberKeys.includes(member as HomeMemberKey)?member as HomeMemberKey:undefined}/></div>:children}</ProductionPreferences></ExpandedPreviewProvider></HomeWorkspaceProvider></ProductionContext.Provider>;
}
