'use client';
import {useMemo,type ReactNode} from 'react';
import {useSearchParams} from 'next/navigation';
import {ProductionContext,useProductionRuntime} from './ProductionContext';
import {createProductionRuntime,FrontendServiceError} from '@/lib/frontend/production/runtime';
import {HomeWorkspaceProvider} from '@/components/homeguard/HomeWorkspaceState';
import type {HomeWorkspaceService} from '@/lib/frontend/production/home-service';
import PublicBrowse from '@/components/expanded/PublicBrowse';
import MapPreview from '@/components/map-preview/MapPreview';
import ProductionApp from './ProductionApp';
import '@/components/expanded/interface-refinement.css';

/** Public browsing has no auth import, session creation or private collection reads. */
function PublicProvider({children}:{children:ReactNode}){
 const runtime=useMemo(()=>createProductionRuntime({identityId:null,homeContextId:null,publicAccess:true,credential:async()=>null}),[]);
 const workspace=useMemo<HomeWorkspaceService>(()=>({scopeKey:'public',context:{currentHomeId:null,homes:[]},async load(){return {records:[],availability:'empty',complete:true,pendingOperations:[]};},async execute(){throw new FrontendServiceError('permission','Set up your space before saving private records.');},async reconcile(){throw new FrontendServiceError('permission','Set up your space before checking private operations.');}}),[]);
 return <ProductionContext.Provider value={runtime}><HomeWorkspaceProvider service={workspace}>{children}</HomeWorkspaceProvider></ProductionContext.Provider>;
}
function MapSurface({publicAccess}:{publicAccess:boolean}){const runtime=useProductionRuntime();return runtime?<MapPreview runtime={runtime} publicAccess={publicAccess}/>:null;}
export function ProductionMapEntry(){
 const params=useSearchParams();
 return params.get('access')==='owned'?<ProductionApp><MapSurface publicAccess={false}/></ProductionApp>:<PublicProvider><MapSurface publicAccess/></PublicProvider>;
}
export function ProductionLearnEntry(){return <PublicProvider><div className="halo-app halo-f-app" data-refined="true" data-testid="public-product"><PublicBrowse production mapHref="/map"/></div></PublicProvider>;}
