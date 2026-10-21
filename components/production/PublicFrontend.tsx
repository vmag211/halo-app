'use client';
import {useMemo,type CSSProperties,type ReactNode} from 'react';
import {useSearchParams} from 'next/navigation';
import {ProductionContext,useProductionRuntime} from './ProductionContext';
import {createProductionRuntime,FrontendServiceError} from '@/lib/frontend/production/runtime';
import {HomeWorkspaceProvider} from '@/components/homeguard/HomeWorkspaceState';
import type {HomeWorkspaceService} from '@/lib/frontend/production/home-service';
import PublicBrowse from '@/components/expanded/PublicBrowse';
import MapPreview from '@/components/map-preview/MapPreview';
import ProductionApp from './ProductionApp';
import {appearancePreference,colorPalette} from '@/lib/frontend/settings-preview';
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
export function ProductionLearnEntry(){
 const params=useSearchParams();
 const appearance=appearancePreference(params.get('appearance'));
 const palette=colorPalette(params.get('palette'));
 const scale=['100','115','130','150'].includes(params.get('scale')??'')?params.get('scale')!:'100';
 const contrast=params.get('contrast')==='true';
 return <PublicProvider><div className="halo-app halo-f-app halo-learn-shell" data-refined="true" data-testid="public-product" data-mode={appearance} data-palette={palette} data-contrast={contrast?'high':'normal'} data-text-scale={scale} style={{colorScheme:appearance==='system'?'light dark':appearance,'--halo-text-scale':Number(scale)/100} as CSSProperties}><PublicBrowse production mapHref="/map"/></div></PublicProvider>;
}
