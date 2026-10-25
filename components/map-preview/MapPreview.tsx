'use client';

import {colorPalette} from '@/lib/frontend/settings-preview';
import LiveDistrictPanel from './LiveDistrictPanel';
import LiveMapComparison from './LiveMapComparison';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronUp, Droplets, Factory, Info, List, LocateFixed, Minus, Mountain, Plus, RotateCcw, Settings, Wind, WifiOff, Search, Scan, Undo2, Tags } from 'lucide-react';
import AppNavigation from '@/components/ui/AppNavigation';
import { BottomSheet, Callout } from '@/components/ui/Foundation';
import HaloLoading from '@/components/ui/HaloLoading';
import Button from '@/components/ui/Button';
import SeverityPill from '@/components/ui/SeverityPill';
import { SceneProvider, useSceneExperience } from '@/components/foundation/SceneExperience';
import InterfaceMotion from '@/components/expanded/InterfaceMotion';
import ExpandedLunaPreview from '@/components/expanded/ExpandedLunaPreview';
import { useRouter } from 'next/navigation';
import LunaMark from '@/components/foundation/LunaMark';
import MapRecordToExplore from '@/components/expanded/MapRecordToExplore';
import { useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import MapCanvas, { type MapPoint, type MapView } from './MapCanvas';
import MapResults from './MapResults';
import MapComparison from './MapComparison';
import MapSystemFollow from './MapSystemFollow';
import { comparisonCases, comparisonRecords, type ComparisonCase } from '@/lib/frontend/map-comparison-preview';
import { mapComparisonCopy as comparisonCopy } from '@/lib/frontend/copy/map-comparison';
import MapSymbol from './MapSymbol';
import { fitRecordView, type MapResult } from '@/lib/frontend/map-tools';
import { DistrictPanel } from './DistrictPanel';
import { AreaBrief, MapInsightCard, MapKey } from './MapInsights';
import { radonPoints as reviewRadonPoints } from '@/lib/frontend/map-radon-fixture';
import { airStations as reviewAirStations, assembledAt as reviewAssembledAt, compoundKey, compounds, exceedsLimit, facilities as reviewFacilities, mapLayers, mapScenarios, milesFromHome as reviewMilesFromHome, quarterLabel, quarters as reviewQuarters, readingDate, readMapQuery, sampleHome as reviewHome, waterFeatures, waterSeverity, waterMapReading, compoundReadingText, readingResult, waterSampleDate, observationTime, type Compound, type MapLayer, type MapScenario, type WaterFeature } from '@/lib/frontend/map-preview';
import { emptyMapSnapshot, mapDistance, parseMapLayer, mergeMapPages, type MapLayerSnapshot, type MapHome, type MapStation, type MapFacility, type MapCounty } from '@/lib/frontend/map-service';
import '@/components/foundation/refinement.css';
import './map-preview.css';
import '@/components/expanded/interface-refinement.css';

type Sheet = { kind: 'feature'; id: string } | { kind: 'compare'; id: string; second?: string } | { kind: 'district' | 'legend' | 'results' | 'assistant' | 'about' | 'brief' } | { kind: 'learn'; topic: 'pfas' | 'radon'; id: string } | null;
const defaultView: MapView = { lng:-80.40, lat:35.15, zoom:8 };
let session: { layer: MapLayer; compound: Compound; quarter: string; view: MapView } | undefined;
const layerIcons = { water:Droplets, radon:Mountain, facilities:Factory, air:Wind };

export type MapRequestRuntime={scopeKey:string;request<T>(operation:string,input?:unknown,options?:{signal?:AbortSignal}):Promise<T>};
export default function MapPreview({runtime,publicAccess=false}:{runtime?:MapRequestRuntime;publicAccess?:boolean}={}) {
  const workspace=useHomeWorkspace();
  const homeChanged=Boolean(workspace.collections.homeTransitions?.length);
  const savedAppearance=workspace.drafts['halo-appearance'];
  const [queryPalette,setQueryPalette]=useState<ReturnType<typeof colorPalette>>('ocean');
  const palette=colorPalette(workspace.drafts['halo-palette']??queryPalette);
  const savedDisplay=workspace.drafts['halo-display'] as {scale?:string;motion?:string;contrast?:boolean}|undefined;
  const appliedAppearance=useRef<unknown>(undefined);
  const [scenario,setScenario] = useState<MapScenario>('ready');
  const [comparisonCase,setComparisonCase] = useState<ComparisonCase>('ready');
  const [publicMode,setPublicMode] = useState(false);
  const [appearance,setAppearance] = useState('system');
  const [scale,setScale] = useState('100');
  const [motion,setMotion] = useState(false);
  const [contrast,setContrast] = useState(false);
  const [initialized,setInitialized] = useState(false);
  // Developer review (?review=tools) is retained through app navigation, including the way back from the map.
  const [reviewTools,setReviewTools] = useState(false);
  useEffect(()=>{
    const p = new URLSearchParams(location.search);
    // Browser-only preview URL is read once after hydration; no server state is involved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueryPalette(colorPalette(p.get('palette')));
    if (!runtime&&mapScenarios.some(s=>s[0] === p.get('mapScenario'))) setScenario(p.get('mapScenario') as MapScenario);
    if (!runtime&&comparisonCases.some(s=>s[0] === p.get('comparisonCase'))) setComparisonCase(p.get('comparisonCase') as ComparisonCase);
    setPublicMode(runtime?publicAccess:p.get('access')==='public');
    if (['system','light','dark'].includes(p.get('appearance') ?? '')) setAppearance(p.get('appearance')!);
    if (['100','115','130','150'].includes(p.get('scale') ?? '')) setScale(p.get('scale')!);
    setMotion(p.get('motion') === 'reduce'); setContrast(p.get('contrast') === 'true'); setReviewTools(p.get('review') === 'tools'); setInitialized(true);
  },[runtime,publicAccess]);
  useEffect(()=>{
    if(!initialized)return;
    // Synchronize the shared, explicitly saved display preference with this specialist preview.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if(savedAppearance==='system'||savedAppearance==='light'||savedAppearance==='dark')setAppearance(savedAppearance);
    else if(appliedAppearance.current!==undefined)setAppearance('system');
    if(runtime&&savedDisplay){if(['100','115','130','150'].includes(savedDisplay.scale??''))setScale(savedDisplay.scale!);setMotion(savedDisplay.motion==='reduce');setContrast(savedDisplay.contrast===true);}
    appliedAppearance.current=savedAppearance;
  },[savedAppearance,savedDisplay,initialized,runtime]);
  useEffect(()=>{if (!initialized||runtime) return; const url=new URL(location.href); url.searchParams.set('appearance',appearance); url.searchParams.set('palette',palette); url.searchParams.set('scale',scale); url.searchParams.set('motion',motion?'reduce':'system'); url.searchParams.set('contrast',String(contrast)); url.searchParams.set('mapScenario',scenario); history.replaceState(history.state,'',url);},[appearance,palette,scale,motion,contrast,scenario,initialized,runtime]);
  useEffect(()=>{if(!initialized)return;const url=new URL(location.href);if(comparisonCase==='ready')url.searchParams.delete('comparisonCase');else url.searchParams.set('comparisonCase',comparisonCase);history.replaceState(history.state,'',url);},[comparisonCase,initialized]);
  function changeScenario(next:MapScenario) { const url=new URL(location.href); ['system','panel','learn','mapSheet','compare'].forEach(k=>url.searchParams.delete(k)); history.replaceState({...history.state,_haloMapSheet:false},'',url); setScenario(next); }
  return <div className="halo-f-review halo-map-review" data-mode={appearance}>
    {!runtime&&<details className="halo-f-review-tools halo-map-review-tools"><summary>Map design review · Not approved</summary>
      <p>Interactive wireframe with sample observations and a fictional household. No live API, location permission, or account writes. Census boundaries are real. This design remains editable and is not frozen.</p>
      <label>Review state<select aria-label="Review state" value={scenario} onChange={e=>changeScenario(e.target.value as MapScenario)}>{mapScenarios.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Comparison evidence<select value={comparisonCase} onChange={e=>setComparisonCase(e.target.value as ComparisonCase)}>{comparisonCases.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <div className="halo-f-tool-grid"><label>Appearance<select value={appearance} onChange={e=>setAppearance(e.target.value)}><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Text size<select value={scale} onChange={e=>setScale(e.target.value)}>{['100','115','130','150'].map(n=><option key={n} value={n}>{n}%</option>)}</select></label></div>
      <div className="halo-f-tool-grid"><label className="halo-f-tool-check"><input type="checkbox" checked={motion} onChange={e=>setMotion(e.target.checked)}/>Reduce motion</label><label className="halo-f-tool-check"><input type="checkbox" checked={contrast} onChange={e=>setContrast(e.target.checked)}/>Higher contrast</label></div>
      <p>The atlas previews map behavior without paid tiles or a token. The production Mapbox renderer and offline storage will be connected only after design approval. Sample values do not describe these communities.</p>
    </details>}
    <SceneProvider mode={motion?'reduce':'system'} time="live">{initialized&&<MapExperience key={runtime?runtime.scopeKey:`${scenario}:${homeChanged}`} runtime={runtime} scenario={scenario} comparisonCase={comparisonCase} resetComparisonCase={()=>setComparisonCase('ready')} publicMode={publicMode} homeChanged={homeChanged} appearance={appearance} palette={palette} scale={Number(scale)/100} motion={motion} contrast={contrast} reviewTools={reviewTools}/>}</SceneProvider>
  </div>;
}

function MapExperience({runtime,scenario,comparisonCase,resetComparisonCase,publicMode,homeChanged,appearance,palette,scale,motion,contrast,reviewTools=false}:{runtime?:MapRequestRuntime;scenario:MapScenario;comparisonCase:ComparisonCase;resetComparisonCase:()=>void;publicMode:boolean;homeChanged:boolean;appearance:string;palette:ReturnType<typeof colorPalette>;scale:number;motion:boolean;contrast:boolean;reviewTools?:boolean}) {
  const experience=useSceneExperience();
  const router = useRouter();
  const restoredSession=useRef(runtime||publicMode||homeChanged?undefined:session);
  const [previewLayer,setPreviewLayer]=useHomeDraft<MapLayer>('explore:map-layer','water');
  const [layer,setLayer]=useState<MapLayer>('water'); const [compound,setCompound]=useState<Compound>('overall');
  const [quarter,setQuarter]=useState('latest'); const [draftQuarter,setDraftQuarter]=useState('latest');
  const [pendingQuarter,setPendingQuarter]=useState<string|null>(null); const [view,setView]=useState<MapView>(defaultView);
  const [sheet,setSheet]=useState<Sheet>(null); const [searchFirst,setSearchFirst]=useState(false); const [ready,setReady]=useState(false); const [resolved,setResolved]=useState(false);
  const [liveMap,setLiveMap]=useState<MapLayerSnapshot|null>(null);
  const [liveLoading,setLiveLoading]=useState(Boolean(runtime));
  const [liveError,setLiveError]=useState(false);
  const [liveAttempt,setLiveAttempt]=useState(0);
  const [moreLoading,setMoreLoading]=useState(false),[moreError,setMoreError]=useState(false);
  const moreRequest=useRef<AbortController|null>(null);
  const runtimeRef=useRef(runtime);
  useEffect(()=>{runtimeRef.current=runtime;},[runtime]);
  useEffect(()=>{
    if(!runtimeRef.current)return;
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted){setLiveLoading(true);setLiveError(false);setMoreLoading(false);setMoreError(false);}});
    void runtimeRef.current.request('map.layer',{layer,...(quarter!=='latest'?{quarter}:{})},{signal:controller.signal}).then(value=>{
      if(controller.signal.aborted)return;setLiveMap(parseMapLayer(value,layer,publicMode));setLiveLoading(false);
    }).catch(()=>{if(!controller.signal.aborted){setLiveLoading(false);setLiveError(true);}});
    return()=>{controller.abort();moreRequest.current?.abort();};
  },[runtime?.scopeKey,layer,quarter,publicMode,liveAttempt]);
  async function loadMore(){
    if(!runtime||!liveMap?.nextCursor||moreLoading)return;
    const controller=new AbortController();moreRequest.current=controller;setMoreLoading(true);setMoreError(false);
    try{const value=await runtime.request('map.layer',{layer,quarter,cursor:liveMap.nextCursor},{signal:controller.signal});if(controller.signal.aborted)return;const merged=mergeMapPages(liveMap,parseMapLayer(value,layer,publicMode));setLiveMap(merged);}catch{if(!controller.signal.aborted)setMoreError(true);}finally{if(!controller.signal.aborted){setMoreLoading(false);moreRequest.current=null;}}
  }
  const liveData=runtime?(liveMap?.layer===layer?liveMap:emptyMapSnapshot(layer)):null;
  const airStations:readonly MapStation[]=liveData?liveData.air:reviewAirStations;
  const facilities:readonly MapFacility[]=liveData?liveData.facilities:reviewFacilities;
  const radonPoints:MapPoint[]=liveData?liveData.radon.flatMap(p=>{
    // Static reviewed county centers are geography only. Zones and severity
    // always come from this response, never the bundled review observation.
    const center=reviewRadonPoints.find(county=>county.id===p.id||county.name===p.name);
    const lat=p.lat??center?.lat,lng=p.lng??center?.lng;
    return lat===undefined||lng===undefined?[]:[{...p,lat,lng}];
  }):reviewRadonPoints;
  const sampleHome:MapHome=liveData?.ownHome??(runtime?{lat:0,lng:0,county:'',pwsid:null,score:null}:reviewHome);
  const assembledAt=liveData?liveData.assembledAt:reviewAssembledAt;
  const quarters=liveData?liveData.quarters:reviewQuarters;
  const milesFromHome=(lat:number|null,lng:number|null)=>runtime?mapDistance(liveData?.ownHome??null,lat,lng):lat===null||lng===null?null:reviewMilesFromHome(lat,lng);
  const [filtersInitialized,setFiltersInitialized]=useState(false);
  useEffect(()=>{if(!publicMode&&filtersInitialized&&previewLayer!==layer)setPreviewLayer(layer);},[publicMode,layer,filtersInitialized,previewLayer,setPreviewLayer]);
  const [rendererFailed,setRendererFailed]=useState(false); const [visibleCount,setVisibleCount]=useState<number|null>(null);
  const [visibleIds,setVisibleIds]=useState<string[]>([]); const [patterns,setPatterns]=useState(true);
  const [patternMotion,setPatternMotion]=useState(true);
  const [labels,setLabels]=useState(true); const [previousView,setPreviousView]=useState<MapView|null>(null);
  const [focusedId,setFocusedId]=useState<string|null>(null);
  const [layerLoading,setLayerLoading]=useState(false); const [notice,setNotice]=useState(''); const [filter,setFilter]=useState('');
  const timers=useRef<ReturnType<typeof setTimeout>[]>([]); const quarterTimer=useRef<ReturnType<typeof setTimeout>|null>(null); const keyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const draggingQuarter=useRef(false);
  const ownsSheet=useRef(false); const sheetRef=useRef<Sheet>(null); const mapFocus=useRef<HTMLDivElement>(null);
  const focusMapOnClose=useRef(false);
  const liveRef=useRef({layer,compound,quarter,view});
  useEffect(()=>{liveRef.current={layer,compound,quarter,view}; if(!runtime&&!publicMode&&!homeChanged)session=liveRef.current;},[layer,compound,quarter,view,publicMode,homeChanged,runtime]);
  useEffect(()=>{sheetRef.current=sheet;},[sheet]);
  useEffect(()=>{
    if(sheet||!focusMapOnClose.current)return;
    focusMapOnClose.current=false;
    const frame=requestAnimationFrame(()=>{
      mapFocus.current?.querySelector<HTMLElement>('[role="application"]')?.focus({preventScroll:true});
      mapFocus.current?.scrollIntoView({block:'center',behavior:'auto'});
    });
    return()=>cancelAnimationFrame(frame);
  },[sheet]);
  const current=resolved?'ready':scenario;
  const offline=current==='offline'||current==='offline-empty';
  const hasHome=!publicMode&&(runtime?Boolean(liveData?.ownHome):!homeChanged&&!['no-location','outside-nc'].includes(current));
  const noSaved=offline&&(current==='offline-empty'||layer!=='water');
  const layerFailed=(current==='layer-error' && layer==='water')||noSaved;
  const blocked=layerFailed||current==='session-required'||Boolean(runtime&&liveError);
  const loading=['loading','slow'].includes(current)||layerLoading||Boolean(runtime&&liveLoading);
  const mapFailed=current==='map-unavailable'||rendererFailed;
  const quarterEmpty=current==='quarter-empty' && quarter!=='latest';
  const water=(liveData?liveData.water:waterFeatures(quarterEmpty?'latest':quarter)).filter(()=>!quarterEmpty);
  const visibleWater=current==='long-text'?water.map((w,i)=>i? w:{...w,name:'Meadow and Eastern Piedmont Regional Community Drinking Water Authority'}):water;
  const points:MapPoint[]= layer==='water'?visibleWater.filter(w=>w.lat!==null&&w.lng!==null).map(w=>({id:w.pwsid,name:w.name,lat:w.lat!,lng:w.lng!,severity:waterSeverity(w,compound),reading:waterMapReading(w,compound),population:w.population,isOwn:hasHome&&w.pwsid===sampleHome.pwsid,flagged:compound==='overall'?Object.values(w.contaminants).some(exceedsLimit):compound==='hazard'?!!w.hazard_index?.exceeds:exceedsLimit(w.contaminants[compoundKey[compound]])})) : layer==='facilities'?facilities.flatMap(f=>f.lat===null||f.lng===null?[]:[{...f,lat:f.lat,lng:f.lng,name:f.name.replace(/\s*\(sample\)$/i,''),flagged:['violation','significant_violation'].includes(f.compliance_status)}]) : layer==='air'?airStations.flatMap(a=>a.lat===null||a.lng===null?[]:[{...a,lat:a.lat,lng:a.lng,name:a.name.replace(/\s*\(sample\)$/i,''),reading:a.aqi===null?'No AQI reported':`${a.aqi} AQI`}]) : radonPoints;
  const featureIds=new Set([...points.map(p=>p.id),...visibleWater.map(w=>w.pwsid),...airStations.map(p=>p.id),...facilities.map(p=>p.id),...(liveData?.radon??[]).map(p=>p.id),...(hasHome?['home']:[])]);

  const openFromUrl=useCallback(()=>{
    const p=new URLSearchParams(location.search); const next=readMapQuery(p);
    const selectedQuarter=runtime&&/^\d{4}Q[1-4]$/.test(p.get('quarter')??'')?p.get('quarter')!:next.quarter;
    setLayer(next.layer); setCompound(next.compound); setQuarter(selectedQuarter); setDraftQuarter(selectedQuarter);
    setPatterns(p.get('presentation')!=='locations');
    if(p.get('mapSheet')==='compare') setSheet({kind:'compare',id:p.get('system')??'',second:p.get('compare')??undefined});
    else if(p.get('panel')==='district') setSheet({kind:'district'});
    else if(p.get('learn')==='pfas'||p.get('learn')==='radon') setSheet({kind:'learn',topic:p.get('learn') as 'pfas'|'radon',id:p.get('system')??''});
    else if(p.has('system')) setSheet({kind:'feature',id:p.get('system')!});
    else if(['legend','results','assistant','about','brief'].includes(p.get('mapSheet')??'')) setSheet({kind:publicMode&&p.get('mapSheet')==='assistant'?'about':p.get('mapSheet') as 'legend'|'results'|'assistant'|'about'|'brief'});
    else setSheet(null);
    ownsSheet.current=!!history.state?._haloMapSheet;
  },[publicMode,runtime]);
  useEffect(()=>{
    const p=new URLSearchParams(location.search);
    const pendingTimers=timers.current;
    if(restoredSession.current&&!['layer','contaminant','quarter','system','panel'].some(k=>p.has(k))) {
      // Restore browser-session memory after mounting the isolated preview.
      const saved=restoredSession.current; setLayer(saved.layer);setCompound(saved.compound);setQuarter(saved.quarter);setDraftQuarter(saved.quarter);setView(saved.view);
      const url=new URL(location.href);url.searchParams.set('layer',saved.layer); if(saved.compound!=='overall')url.searchParams.set('contaminant',saved.compound);if(saved.quarter!=='latest')url.searchParams.set('quarter',saved.quarter);history.replaceState(history.state,'',url);
    } else openFromUrl();
    setFiltersInitialized(true);
    if(!hasHome)setView({lng:-79.9,lat:35.05,zoom:7});
    window.addEventListener('popstate',openFromUrl);
    return ()=>{window.removeEventListener('popstate',openFromUrl);pendingTimers.forEach(clearTimeout);if(quarterTimer.current)clearTimeout(quarterTimer.current);if(keyTimer.current)clearTimeout(keyTimer.current);};
  // Scenario remount intentionally snapshots session state only once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    // An invalid pasted selection must also be removed from the external URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if(sheet?.kind==='feature'&&!loading&&!blocked&&!featureIds.has(sheet.id)){setSheet(null);const url=new URL(location.href);url.searchParams.delete('system');history.replaceState({...history.state,_haloMapSheet:false},'',url);ownsSheet.current=false;}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sheet,layer,quarter,loading,blocked,liveMap]);
  function urlForFilters(nextLayer=layer,nextCompound=compound,nextQuarter=quarter) {
    const url=new URL(location.href);url.searchParams.set('layer',nextLayer); ['contaminant','quarter'].forEach(k=>url.searchParams.delete(k));
    if(nextLayer==='water'){if(nextCompound!=='overall')url.searchParams.set('contaminant',nextCompound);if(nextQuarter!=='latest')url.searchParams.set('quarter',nextQuarter);}return url;
  }
  function openSheet(next:NonNullable<Sheet>) {
    const url=urlForFilters();['system','panel','learn','mapSheet','compare'].forEach(k=>url.searchParams.delete(k));
    if(next.kind==='feature')url.searchParams.set('system',next.id);
    else if(next.kind==='district')url.searchParams.set('panel','district');
    else if(next.kind==='learn'){url.searchParams.set('learn',next.topic);url.searchParams.set('system',next.id);}
    else if(next.kind==='compare'){url.searchParams.set('mapSheet','compare');url.searchParams.set('system',next.id);if(next.second)url.searchParams.set('compare',next.second);}
    else url.searchParams.set('mapSheet',next.kind);
    if(sheetRef.current)history.replaceState({...history.state,_haloMapSheet:ownsSheet.current},'',url);
    else{history.pushState({...history.state,_haloMapSheet:true},'',url);ownsSheet.current=true;}
    setSheet(next);setFilter('');
  }
  function closeSheet(){ if(ownsSheet.current)history.back();else{const url=new URL(location.href);['system','panel','learn','mapSheet','compare'].forEach(k=>url.searchParams.delete(k));history.replaceState(history.state,'',url);setSheet(null);} }
  function setMapLayer(next:MapLayer){if(quarterTimer.current)clearTimeout(quarterTimer.current);if(keyTimer.current)clearTimeout(keyTimer.current);setPendingQuarter(null);setDraftQuarter('latest');setFocusedId(null);setLayer(next);setCompound('overall');setQuarter('latest');setNotice('');history.replaceState(history.state,'',urlForFilters(next,'overall','latest'));setLayerLoading(true);timers.current.push(setTimeout(()=>setLayerLoading(false),300));}
  function setMapCompound(next:Compound){setCompound(next);history.replaceState(history.state,'',urlForFilters(layer,next));}
  function loadQuarter(next:string){if(next===quarter&&!pendingQuarter)return;if(quarterTimer.current)clearTimeout(quarterTimer.current);if(keyTimer.current)clearTimeout(keyTimer.current);if(runtime){setDraftQuarter(next);setQuarter(next);setFocusedId(null);history.replaceState(history.state,'',urlForFilters('water',liveRef.current.compound,next));return;}if(offline && next!=='latest' && next!=='2025Q4'){setDraftQuarter(quarter);setNotice('This quarter is not saved. Reconnect to load it.');return;}
    setDraftQuarter(next);setPendingQuarter(next);setNotice('');quarterTimer.current=setTimeout(()=>{
      if(current==='quarter-error'){setPendingQuarter(null);setDraftQuarter(quarter);setNotice('That quarter could not load. Previous readings are still shown.');return;}
      setQuarter(next);setFocusedId(null);setPendingQuarter(null);history.replaceState(history.state,'',urlForFilters('water',liveRef.current.compound,next));
    },650);
  }
  function retry(){if(runtime){setLiveAttempt(value=>value+1);setRendererFailed(false);return;}setLayerLoading(true);setNotice('');timers.current.push(setTimeout(()=>{setRendererFailed(false);setResolved(true);setLayerLoading(false);},650));}
  function changeView(next:MapView){setView({...next,zoom:Math.max(5,Math.min(12,next.zoom))});}
  function rememberView(){setPreviousView({...view});}
  function navigateView(next:MapView){rememberView();changeView(next);}
  function fitLayer(){
    const rect=mapFocus.current?.getBoundingClientRect();
    // Radon is a polygon layer. Fit the real NC atlas extent, not just centroids.
    const locations=layer==='radon'?[{lng:-84.3218,lat:33.7529},{lng:-75.4001,lat:36.5881}]:points;
    const next=fitRecordView(locations,rect?.width??375,rect?.height??420);
    if(next){navigateView(next);setNotice('Fitted the available mapped locations. Unlocated records remain in the list.');}
    else setNotice('No mapped locations are available to fit. Use the list instead.');
  }
  function focusRecord(id:string){
    const point=id==='home'&&hasHome?sampleHome:points.find(p=>p.id===id);
    if(!point){setNotice('This record has no mapped location. Its readings remain available in the list.');return;}
    navigateView({lng:point.lng,lat:point.lat,zoom:layer==='radon'?8:10});setFocusedId(id);focusMapOnClose.current=true;closeSheet();
    setNotice(`Focused on ${id==='home'?'your approximate home':points.find(p=>p.id===id)?.name}. Use Previous view to return.`);
  }
  const factorHref=(factor:string)=>runtime?`/factors/${factor}`:`/foundation/preview/factor/${factor}?edition=expanded&appearance=${appearance}&scale=${Math.round(scale*100)}&motion=${motion?'reduce':'system'}&contrast=${contrast}${reviewTools?'&review=tools':''}`;
  const foundationHref=(tab:string)=>runtime?publicMode?(tab==='act'?'/learn':`/onboarding?entry=1&next=${encodeURIComponent(`/${tab}`)}`):`/${tab}?mapReturn=1`:`/foundation/preview${publicMode?'/expanded/':''}?edition=expanded&tab=${tab}&appearance=${appearance}&scale=${Math.round(scale*100)}&motion=${motion?'reduce':'system'}&contrast=${contrast}${publicMode?'&access=public':''}${reviewTools?'&review=tools':''}`;
  const counts=compound==='overall'?`${water.filter(w=>Object.values(w.contaminants).some(exceedsLimit)).length} of ${water.length} systems exceed a supplied limit` : compound==='hazard'?`${water.filter(w=>w.hazard_index?.exceeds).length} systems exceed the supplied hazard index` : `${water.filter(w=>exceedsLimit(w.contaminants[compoundKey[compound]])).length} of ${water.filter(w=>w.contaminants[compoundKey[compound]]?.value_ppt!==undefined).length} recorded systems exceed the ${compounds.find(c=>c[0]===compound)?.[1]} limit`;
  const districtVariant= offline||current==='district-error'?'error':current==='district-geography'?'geography-error':current==='district-zero'?'zero':current==='population-missing'?'population-missing':current==='population-partial'?'population-partial':current==='comparison-missing'?'comparison-missing':'full';
  const activeWater=sheet && 'id' in sheet ? visibleWater.find(w=>w.pwsid===sheet.id):undefined;
  const selectedTitle=sheet?.kind==='compare'?comparisonCopy.title:sheet?.kind==='feature' ? sheet.id==='home'?'Your home':activeWater?.name??[...points,...airStations,...facilities,...(liveData?.radon??[])].find(p=>p.id===sheet.id)?.name??'Location details' : sheet?.kind==='district'?'The NC-08 picture':sheet?.kind==='legend'?'Understanding the map':sheet?.kind==='results'?'Locations and readings':sheet?.kind==='learn'?(sheet.topic==='pfas'?'Understanding water results':'Understanding radon zones'):'About this map';
  const banner=!runtime&&hasHome&&current!=='unranked'&&current!=='district-error' ? layer==='water'?'Union County ranks 34th of 96 ranked counties':layer==='radon'?`Union County is Zone ${radonPoints.find(p=>p.id==='Union County')?.zone??3}`:layer==='air'?`Nearest monitor: ${Math.min(...airStations.map(a=>Number(milesFromHome(a.lat,a.lng)))).toFixed(1)} miles`:`${facilities.filter(f=>Number(milesFromHome(f.lat,f.lng))<=10&&(f.open_violations??0)>0).length} facilities within 10 miles report open programs in violation`:null;
  // The source's own note sits with the layer count it qualifies, not loose above the map tools.
  const sourceNote=liveData?.sourceNote?<span className="halo-map-source-note">{liveData.sourceNote}</span>:null;
  const countN=layer==='water'?water.length:layer==='air'?airStations.length:layer==='facilities'?facilities.length:liveData?.radon.length??points.length;
  const inView=blocked||loading||current==='empty'?[]:points.filter(p=>visibleIds.includes(p.id));
  const results:MapResult[]=layer==='water'?visibleWater.map(w=>({id:w.pwsid,name:w.name,severity:waterSeverity(w,compound),reading:`${waterMapReading(w,compound)} · ${readingDate(waterSampleDate(w,compound))}`,sub:w.lat===null||w.lng===null?'No mapped location':w.pwsid===sampleHome.pwsid&&hasHome?'Your water system':'Service-area center',lat:w.lat,lng:w.lng})):layer==='air'?airStations.map(p=>({id:p.id,name:p.name,severity:p.severity,reading:`${p.aqi??'Unknown'} AQI · ${observationTime(p.last_reading_at)}`,sub:p.lat===null||p.lng===null?'No mapped location':'Monitoring station',lat:p.lat,lng:p.lng,keywords:p.agency})):layer==='facilities'?facilities.map(p=>({id:p.id,name:p.name,severity:p.severity,reading:`Last inspection: ${readingDate(p.last_inspection)}`,sub:p.lat===null||p.lng===null?'No mapped location':'Selected facility',lat:p.lat,lng:p.lng,keywords:p.county})):(liveData?.radon??radonPoints).map(p=>({id:p.id,name:p.name,severity:p.severity,reading:'Regional potential, not a home reading',sub:`Zone ${p.zone??'unknown'}`,lat:p.lat,lng:p.lng}));
  return <div className="halo-app halo-f-app halo-map-app" data-testid="map-product" data-refined="true" data-palette={palette} data-wide="true" data-motion={motion?'reduce':'system'} data-animate={experience.enabled} data-contrast={contrast?'high':'normal'} data-text-scale={scale*100} style={{'--halo-text-scale':scale} as CSSProperties}>
    <InterfaceMotion />
    <header className="halo-map-header"><div className="halo-map-header-left"><Link className="halo-f-icon" aria-label={publicMode?comparisonCopy.publicBack:'Back to Explore'} href={runtime&&publicMode?'/learn':foundationHref(publicMode?'plan':'act')} prefetch={false}><ArrowLeft size={21}/></Link>{!sheet&&!publicMode&&<button className="halo-map-luna" aria-label="Open Luna" onClick={()=>openSheet({kind:'assistant'})}><LunaMark size={25}/></button>}</div><div><h1>Map</h1><p>{publicMode?comparisonCopy.publicMap:'Within Explore'}</p></div><div className="halo-map-header-tools"><button className="halo-f-icon" aria-label="About this map" onClick={()=>openSheet({kind:'about'})}><Info size={21}/></button><Link href={foundationHref('settings')} className="halo-f-icon" aria-label="Settings" prefetch={false}><Settings size={21}/></Link></div></header>
    {offline&&<div className="halo-map-offline" role="status"><WifiOff size={16}/><span>{noSaved?'This layer is not saved on this device.':'Showing saved map data from Oct 1, 2026.'}</span>{<button onClick={retry}>Try again</button>}</div>}
    <main aria-label="Environmental map" className="halo-map-main">
      {liveData?.partial&&<Callout tone="notice"><p>This layer is incomplete. Counts describe only returned records.</p></Callout>}
      {mapFailed?<div className="halo-map-fallback"><Callout tone="notice"><p>The map couldn’t load on this device. The district summary is still available.</p></Callout><Button variant="secondary" onClick={()=>openSheet({kind:'results'})}>{comparisonCopy.browse}</Button>{runtime?<LiveDistrictPanel runtime={runtime}/>:<DistrictPanel variant={districtVariant} onRetry={retry}/>}<Button variant="secondary" onClick={retry}>Try the map again</Button></div>:
      <div className="halo-map-stage" data-layer={layer} data-timeline={layer==='water'&&current!=='single-quarter'}>
        <div className="halo-map-top">
          <div className="halo-map-layers" role="radiogroup" aria-label="Map layer">{mapLayers.map((key,index)=>{const Icon=layerIcons[key];return <button key={key} role="radio" aria-checked={layer===key} tabIndex={layer===key?0:-1} onClick={()=>setMapLayer(key)} onKeyDown={e=>{const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(direction){e.preventDefault();const n=(index+direction+4)%4;setMapLayer(mapLayers[n]);e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[n].focus();}}}><Icon size={18}/><span>{key[0].toUpperCase()+key.slice(1)}</span></button>;})}</div>
          {layer==='water'?<><label className="halo-map-compound"><Droplets size={17}/><span className="halo-sr">Water comparison</span><select aria-label="Water comparison" value={compound} disabled={loading} onChange={e=>setMapCompound(e.target.value as Compound)}>{compounds.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{['pfhxs','pfna','genx','hazard'].includes(compound)&&<button aria-label="Standard change information" onClick={()=>openSheet({kind:'legend'})}><Info size={18}/></button>}</label><p className="halo-map-count" aria-live="polite">{blocked?'Water data unavailable':loading?'Loading water data…':counts+'.'}<span>{quarter==='latest'?'Statewide records':`Samples from ${quarterLabel(quarter)}`} · Not a tap test</span>{sourceNote}</p></>:<p className="halo-map-count" aria-live="polite">{blocked?'Layer data unavailable':loading?'Loading layer data…':`${countN} ${layer==='air'?'stations':layer==='radon'?'counties':'facilities'} in this layer`}<span>{layer==='facilities'?'Selected facilities in NC-08':layer==='air'?'Latest available hourly observations':'County potential, not home measurements'}</span>{sourceNote}</p>}
        </div>
        <div className="halo-map-utility" role="group" aria-label="Map tools">
          <button className="halo-map-find" onClick={()=>{setSearchFirst(true);openSheet({kind:'results'});}}><Search size={18}/><span>Search by name</span></button>
          <button disabled={blocked||loading||current==='empty'||quarterEmpty||!ready} onClick={fitLayer}><Scan size={18}/><span>Fit layer</span></button>
          <button aria-label="Previous view" disabled={!previousView} onClick={()=>{if(previousView){changeView(previousView);setPreviousView(null);setFocusedId(null);setNotice('Returned to the previous map view.');}}}><Undo2 size={18}/><span className="halo-map-utility-word">Previous view</span></button>
          <button aria-label="Show map labels" aria-pressed={labels} onClick={()=>setLabels(value=>!value)}><Tags size={18}/><span className="halo-map-utility-word">Labels</span></button>
        </div>
        <div className="halo-map-viewport" data-testid="map-viewport">
        <div className="halo-map-right-controls">{hasHome&&<button aria-label="Locate your home" onClick={()=>{navigateView({lng:sampleHome.lng,lat:sampleHome.lat,zoom:8});setNotice('Centered on your approximate home.');}}><LocateFixed size={20}/></button>}<button aria-label="Zoom in" disabled={view.zoom>=12} onClick={()=>navigateView({...view,zoom:view.zoom+1})}><Plus size={20}/></button><button aria-label="Zoom out" disabled={view.zoom<=5} onClick={()=>navigateView({...view,zoom:view.zoom-1})}><Minus size={20}/></button></div>
        <div className="halo-map-left-controls"><div className="halo-map-presentation" role="group" aria-label="Map presentation">{[true,false].map(value=><button key={String(value)} aria-pressed={patterns===value} onClick={()=>{setPatterns(value);const url=new URL(location.href);url.searchParams.set('presentation',value?'patterns':'locations');history.replaceState(history.state,'',url);}}>{value?'Patterns':'Locations'}</button>)}</div><button onClick={()=>openSheet({kind:'results'})}><List size={17}/>List</button></div>
        <div ref={mapFocus} className="halo-map-canvas-host"><MapCanvas layer={layer} points={blocked||loading||current==='empty'||quarterEmpty?[]:points} selectedId={sheet?.kind==='feature'?sheet.id:focusedId} home={hasHome?sampleHome:null} view={view} patterns={patterns} labels={labels} animatePatterns={patternMotion&&experience.motion} onNavigationStart={rememberView} onViewChange={changeView} onSelect={id=>openSheet({kind:'feature',id})} onReady={setReady} onUnavailable={()=>setRendererFailed(true)} onVisibleCountChange={setVisibleCount} onVisibleIdsChange={setVisibleIds} forceEmpty={current==='empty'}/></div>
        {(loading||!ready)&&!blocked&&<div className="halo-map-state"><HaloLoading label="Loading map data." />{current==='slow'&&<p>This source is taking longer. Your location stays in view.</p>}{['loading','slow'].includes(current)&&<button onClick={retry}>Try again</button>}</div>}
        {blocked&&<div className="halo-map-state" role="alert"><Info size={25}/><strong>{current==='session-required'?'Verify your session to load map data.':'This layer’s data couldn’t load.'}</strong><p>{noSaved?'Reconnect to load this layer. Saved water data remains available.':'Other layers and the district summary are still available.'}</p>{!offline&&<Button variant="secondary" onClick={retry}>Try again</Button>}</div>}
        {(current==='empty'||quarterEmpty||visibleCount===0)&&ready&&!loading&&!blocked&&<div className="halo-map-state"><strong>{quarterEmpty?'No samples in this quarter.':'No data for this layer in the area you’re viewing.'}</strong><p>{quarterEmpty?'This does not mean there were no contaminants.':'Try zooming out.'}</p><button onClick={()=>{if(quarterEmpty)loadQuarter('latest');else{setResolved(true);changeView({...defaultView,zoom:6});}}}>{quarterEmpty?'Return to Latest':'Zoom out'}</button></div>}
        </div>
        <div className="halo-map-inline-key"><MapKey layer={layer} patterns={patterns} onOpen={()=>openSheet({kind:'legend'})}/></div>
        {patterns&&layer!=='radon'&&<div className="halo-map-contour-note"><span>Illustrative record contours. Not a moving pollution or weather forecast.</span><button aria-pressed={!patternMotion||!experience.motion} disabled={!experience.motion} title={!experience.motion?'Paused by your motion settings':undefined} onClick={()=>setPatternMotion(value=>!value)}>{!experience.motion?'Texture paused':patternMotion?'Pause texture':'Resume texture'}</button></div>}
        <div className="halo-map-bottom">
          {notice&&<p className="halo-map-notice" role="status">{notice}{current==='quarter-error'&&<button onClick={retry}>Try again</button>}</p>}
          {!blocked&&<MapInsightCard points={inView} layer={layer} loading={loading||!ready} onOpen={()=>openSheet({kind:'brief'})}/>}
          {layer==='water'&&current!=='single-quarter'&&quarters.length>0&&<section className="halo-map-timeline" aria-label="Water sample timeline"><div><span>{pendingQuarter?`Loading ${quarterLabel(pendingQuarter)}…`:quarter==='latest'?'Latest available samples':`Samples from ${quarterLabel(quarter)}`}</span><button disabled={quarter==='latest'&&!pendingQuarter} onClick={()=>loadQuarter('latest')} aria-label="Return to latest samples"><RotateCcw size={15}/></button></div><input aria-label="Water sample quarter" type="range" min="0" max={Math.max(0,quarters.length)} value={draftQuarter==='latest'?quarters.length:quarters.indexOf(draftQuarter)} aria-valuetext={quarterLabel(draftQuarter)} disabled={loading||blocked} onPointerDown={()=>{draggingQuarter.current=true;}} onChange={e=>{const q=quarters[Number(e.target.value)]??'latest';setDraftQuarter(q);if(keyTimer.current)clearTimeout(keyTimer.current);if(!draggingQuarter.current)keyTimer.current=setTimeout(()=>loadQuarter(q),250);}} onPointerUp={e=>{draggingQuarter.current=false;loadQuarter(quarters[Number(e.currentTarget.value)]??'latest');}} onPointerCancel={()=>{draggingQuarter.current=false;setDraftQuarter(quarter);}}/><div className="halo-map-ticks"><span>{quarterLabel(quarters[0])}</span><span>{quarters[4]?quarterLabel(quarters[4]):''}</span><span>{quarters[8]?quarterLabel(quarters[8]):''}</span><span>Latest</span></div></section>}
          <button className="halo-map-district-handle" onClick={()=>openSheet({kind:'district'})} onTouchStart={e=>{e.currentTarget.dataset.start=String(e.touches[0].clientY);}} onTouchEnd={e=>{if(Number(e.currentTarget.dataset.start)-e.changedTouches[0].clientY>30)openSheet({kind:'district'});}}><span/><strong>See the full NC-08 picture</strong><ChevronUp size={18}/></button>
        </div>
      </div>}
    </main>
    <AppNavigation active="act" href={foundationHref} />
    {sheet?.kind==='assistant'?<ExpandedLunaPreview context={`${layer[0].toUpperCase()+layer.slice(1)} map`} onClose={closeSheet} offline={offline} environmentAvailable={!blocked&&hasHome} go={(tab,destination,view='list',id)=>{
      const url=new URL(location.href); ['mapSheet','learn','system','panel','compare'].forEach(key=>url.searchParams.delete(key)); history.replaceState({...history.state,_haloMapSheet:false},'',url); ownsSheet.current=false; setSheet(null);
      if(tab==='map'){if(destination&&['water','air','radon','facilities'].includes(destination))setMapLayer(destination as MapLayer);return;}
      if(!['today','home','act','plan','settings'].includes(tab))return;
      const next=new URL(foundationHref(tab),location.origin);if(destination)next.searchParams.set('destination',destination);if(view!=='list')next.searchParams.set(tab==='home'?'homeView':'exploreView',view);if(id)next.searchParams.set(tab==='home'?'record':'exploreRecord',id);router.push(next.pathname+next.search);
    }}/>:sheet&&<BottomSheet id="halo-map-sheet" title={sheet.kind==='brief'?'Your area at a glance':selectedTitle} height={sheet.kind==='feature'?'content':'standard'} onClose={closeSheet}>
      {sheet.kind==='brief'&&(blocked||loading?<p>{loading?'Loading this layer’s area brief.':'Load this layer to see its area brief.'}</p>:<AreaBrief points={inView} allPoints={points} layer={layer} compound={compound} quarter={quarter} water={water} ownSystemId={sampleHome.pwsid} hasHome={hasHome} banner={banner} onSelect={id=>openSheet({kind:'feature',id})}/>)}
      {sheet.kind==='district'&&runtime?<LiveDistrictPanel runtime={runtime}/>:sheet.kind==='district'&&<>{offline&&<Callout tone="notice"><p>No district summary is saved. Reconnect to load it.</p></Callout>}<DistrictPanel source={runtime?null:undefined} variant={districtVariant} onRetry={offline?undefined:retry} onCountySelect={name=>{const point=radonPoints.find(p=>p.id===name);if(!point)return;setLayer('radon');setCompound('overall');setQuarter('latest');changeView({lat:point.lat,lng:point.lng,zoom:8});const url=urlForFilters('radon','overall','latest');url.searchParams.delete('panel');url.searchParams.set('system',name);history.replaceState(history.state,'',url);setSheet({kind:'feature',id:name});}}/></>}
      {sheet.kind==='legend'&&<><div className="halo-map-legend-intro"><h3>{patterns?'Patterns with context':'Every record has a place'}</h3><p>{layer==='air'?'Contours show monitor density, not AQI between stations. Monitors count equally; their symbols retain actual station readings.':layer==='radon'?'Shaded counties use the source radon zones. No household measurements are inferred.':'Soft contours count over-limit water systems or facilities with reported violations. They are not contamination spreading, service areas or exposure. Symbols retain their individual reported categories.'}</p><p>Texture motion is decorative, not wind, pollution movement or a changing reading. Pause it or switch to Locations for a static view.</p></div><Legend layer={layer} compound={compound} assembled={assembledAt} hasHome={hasHome} production={!!runtime}/></>}
      {sheet.kind==='about'&&<div className="halo-map-detail"><h3>One place, four kinds of evidence.</h3><p>Water shows system-level samples. Radon shows county potential. Facilities show selected compliance records. Air shows monitoring stations, not a reading at every address.</p><p>{hasHome?'Your home pin is approximate. ':''}Layer changes keep the same map position. Use the list for a keyboard-accessible alternative.</p><p>Quarter views contain only systems with a sample in that quarter. A missing marker does not mean there was no testing or no concern. Patterns do not show contamination spreading.</p><p>District lines use the 119th Congress, 2023 map. The view does not claim to use the 2026 election boundaries.</p><a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" target="_blank" rel="noreferrer">U.S. Census boundary source</a><button onClick={()=>openSheet({kind:'results'})}>Browse locations as a list</button></div>}
      {sheet.kind==='results'&&<><MapResults records={results} layer={layer} visibleIds={current==='empty'?[]:visibleIds} home={hasHome?sampleHome:null} query={filter} onQuery={setFilter} onSelect={id=>openSheet({kind:'feature',id})} blocked={blocked} loading={loading} focusSearch={searchFirst} onSearchFocused={()=>setSearchFirst(false)}/>{runtime&&!blocked&&!loading&&liveData?.nextCursor&&<button disabled={moreLoading} onClick={()=>void loadMore()}>{moreLoading?'Loading more locations…':'Load more locations'}</button>}{moreError&&<p role="alert">More locations could not load. Your current results are kept.</p>}</>}
      {sheet.kind==='compare'&&(runtime?<LiveMapComparison runtime={runtime} layer={layer} quarter={quarter} ids={results.map(record=>record.id)} records={liveData?.comparisons??[]} firstId={sheet.id} secondId={sheet.second} compound={compound} latest={quarter==='latest'} scenario="ready" blocked={blocked} offline={offline} loading={loading} onSelect={(id,second)=>openSheet({kind:'compare',id,second})} onCompound={setMapCompound} onBack={()=>openSheet({kind:'feature',id:sheet.id})} onClear={closeSheet} onRetry={retry}/>:<MapComparison records={comparisonRecords(layer,visibleWater)} firstId={sheet.id} secondId={sheet.second} compound={compound} latest={quarter==='latest'} scenario={current==='comparison-missing'?'error':comparisonCase} blocked={blocked} offline={offline} loading={loading} onSelect={(id,second)=>openSheet({kind:'compare',id,second})} onCompound={setMapCompound} onBack={()=>openSheet({kind:'feature',id:sheet.id})} onClear={closeSheet} onRetry={()=>{resetComparisonCase();retry();}}/>)}
      {sheet.kind==='feature'&&!publicMode&&!blocked&&!loading&&layer==='water'&&activeWater&&<MapSystemFollow id={activeWater.pwsid} name={activeWater.name} offline={offline}/>}
      {sheet.kind==='feature'&&(blocked?<Callout tone="notice"><p>No readings are available for this location in the current state.</p><p>{offline?'Reconnect to load this layer.':'Load the layer before opening its readings.'}</p>{!offline&&<Button variant="secondary" onClick={retry}>Try again</Button>}</Callout>:loading?<HaloLoading label="Loading location details." />:<FeatureDetails data={liveData??undefined} id={sheet.id} layer={layer} compound={compound} water={activeWater} hasHome={hasHome} onLearn={topic=>openSheet({kind:'learn',topic,id:sheet.id})} todayHref={foundationHref('today')}/>)}
      {sheet.kind==='feature'&&!blocked&&!loading&&sheet.id!=='home'&&<div className="halo-map-focus-record">{layer==='water'||layer==='air'?<button onClick={()=>openSheet({kind:'compare',id:sheet.id})}>{comparisonCopy.entry}</button>:<p>{comparisonCopy.unsupported}</p>}</div>}
      {sheet.kind==='feature'&&!blocked&&!loading&&<div className="halo-map-focus-record"><button disabled={mapFailed||!ready||!(points.some(p=>p.id===sheet.id)||sheet.id==='home'&&hasHome)} onClick={()=>focusRecord(sheet.id)}><LocateFixed size={18}/>Focus on map</button>{!points.some(p=>p.id===sheet.id)&&sheet.id!=='home'&&<p>No mapped location is available for this record. You can still read its evidence and prepare a question.</p>}</div>}
      {sheet.kind==='feature'&&!publicMode&&!blocked&&!loading&&sheet.id!=='home'&&<MapRecordToExplore href={foundationHref('act')+'&destination=observations&exploreView=new'} evidence={{recordId:sheet.id,title:selectedTitle,layer,observedAt:layer==='water'?activeWater?.latest_sample_iso??null:layer==='air'?airStations.find(item=>item.id===sheet.id)?.last_reading_at??null:layer==='facilities'?facilities.find(item=>item.id===sheet.id)?.last_inspection??null:null,scope:layer==='water'?'Public-system sample context, not a tap test.':layer==='radon'?'County potential, not a home measurement.':layer==='air'?'Monitor observation, not personal exposure.':'Public facility record, not a household exposure finding.'}}/>}
      {sheet.kind==='learn'&&<MapLearn topic={sheet.topic} water={blocked||loading?undefined:activeWater} compound={compound} county={sheet.id} onBack={()=>openSheet({kind:'feature',id:sheet.id})} href={publicMode?undefined:factorHref(sheet.topic)}/>}
    </BottomSheet>}
  </div>;
}

function Legend({layer,compound,assembled,hasHome,production=false}:{layer:MapLayer;compound:Compound;assembled:string;hasHome:boolean;production?:boolean}) {
  const levels=layer==='radon'?[['high','Zone 1 · Highest potential'],['elevated','Zone 2 · Moderate potential'],['good','Zone 3 · Lowest potential']]:layer==='facilities'?[['good','No violation reported'],['elevated','Violation'],['high','Significant violation'],['no_data','Unknown']]:[['good','Good'],['moderate','Moderate'],['elevated','Elevated'],['high','High'],['severe','Severe'],['no_data',layer==='water'?'No comparable result':'No data']];
  return <div className="halo-map-detail"><ul className="halo-map-legend-list">{levels.map(([level,label])=><li key={level}><MapSymbol layer={layer} severity={level}/><span>{label}</span></li>)}</ul>
    {layer==='water'&&<><p>Water-symbol size represents people served, not the amount of contamination. Unknown population uses a small marker. {hasHome?'The outlined water symbol is your water system. ':''} Its location is the service-area center, not your tap. An exclamation marks an over-limit result; a slash marks an unavailable comparison.</p><p>No comparable result means the record has no numeric result or documented non-detect to compare with a limit. It is missing information, not a finding that nothing was detected. The supplied dataset retains detections, so comparison counts are not complete testing coverage.</p><p>Detected, no comparison limit: a neutral marker can also mean a reported compound cannot be scored against the supplied limits.</p>{!production&&compound!=='overall'&&compound!=='hazard'&&<p>Supplied comparison limit: {['pfoa','pfos'].includes(compound)?4:10} ppt.</p>}{production&&<p>Each record shows its supplied comparison limit and sample date when available.</p>}{['pfhxs','pfna','genx','hazard'].includes(compound)&&<Callout tone="caution"><p>Supplied comparisons are not a determination of current regulation.</p></Callout>}<p>The count line describes the whole returned statewide dataset, not only the map viewport or NC-08.</p></>}
    {layer==='facilities'&&<><p>Shows major facilities and repeat violators in NC-08, not every regulated site.</p><p>Numbered groups expand as you zoom in. A compliance record is not a measurement of exposure at your home.</p></>}
    {layer==='air'&&<p>Wind symbols mark monitoring stations, not wind speed or direction. Latest hourly readings are observations at those stations, not a continuous air-quality surface.</p>}
    {layer==='radon'&&<p>County zones describe regional potential, not a test of your home. County fills remain translucent so boundaries stay readable.</p>}
    <footer>Data assembled {readingDate(assembled)}. Assembly time is separate from each observation or water sample date.</footer>
  </div>;
}

function FeatureDetails({data,id,layer,compound,water,hasHome,onLearn,todayHref}:{data?:MapLayerSnapshot;id:string;layer:MapLayer;compound:Compound;water?:WaterFeature;hasHome:boolean;onLearn:(topic:'pfas'|'radon')=>void;todayHref:string}) {
  const sampleHome=data?.ownHome??(data?null:reviewHome);
  const radonPoints:readonly MapCounty[]=data?data.radon:reviewRadonPoints;
  const facilities:readonly MapFacility[]=data?data.facilities:reviewFacilities;
  const airStations:readonly MapStation[]=data?data.air:reviewAirStations;
  const assembledAt=data?data.assembledAt:reviewAssembledAt;
  const milesFromHome=(lat:number|null,lng:number|null)=>data?mapDistance(data.ownHome,lat,lng):lat===null||lng===null?null:reviewMilesFromHome(lat,lng);
  if(id==='home'&&sampleHome)return <div className="halo-map-detail"><p>{sampleHome.county} · Approximate location</p><div className="halo-map-reading"><strong>{sampleHome.score??'No data'}</strong><span>Today score</span></div><Link className="halo-primary" href={todayHref} prefetch={false}>Go to Today</Link></div>;
  if(layer==='water'&&water)return <div className="halo-map-detail"><div className="halo-map-detail-meta"><span>{water.pwsid}</span><SeverityPill severity={waterSeverity(water,'overall')}/></div><p>{water.population===null?'Population served: No data':`Serves ${water.population.toLocaleString()} people`}{water.lat===null?' · No mapped location':''}</p>{water.coverage==='unscoreable'&&<Callout tone="notice"><p>Detected, not scored. The reported compounds have no supplied comparison limit.</p></Callout>}{(water.coverage==='no_data'||water.coverage==='excluded_only')&&<Callout tone="notice"><p>No comparable result. This record has no numeric result or documented non-detect for the compounds compared here. The source release keeps detections only, so this is missing information, not a clean result.</p></Callout>}
    <section className="halo-map-selected-reading"><span className="halo-map-eyebrow">{compounds.find(c=>c[0]===compound)?.[1]}</span><strong>{waterMapReading(water,compound)}</strong><span>Sampled {readingDate(waterSampleDate(water,compound))}</span><small>{compound==='hazard'?'A combined comparison index, not a concentration.':compound==='overall'?'Based on reported detections and supplied limits, not a tap test.':'ppt means parts per trillion. Compare with the supplied limit below.'}</small></section>
    <div className="halo-map-thresholds">{Object.entries(water.contaminants).map(([name,r])=><section key={name} data-selected={compound!=='overall'&&compound!=='hazard'&&compoundKey[compound]===name}><div><strong>{name==='HFPO-DA'?'GenX (HFPO-DA)':name}</strong><span>{compoundReadingText(r)}</span></div>{readingResult(r)==='non_detect'&&<p>{r.limit_ppt!==null?`${r.limit_ppt} ppt supplied limit · `:''}{typeof r.reporting_limit_ppt==='number'&&r.limit_ppt!==null&&r.reporting_limit_ppt>r.limit_ppt?'Reporting limit is above the supplied limit, so this cannot show the result is below it · ':''}Sampled {readingDate(r.date_iso)}</p>}{readingResult(r)==='numeric'&&r.value_ppt!==undefined&&r.limit_ppt!==null&&r.ratio!==undefined&&<><div className="halo-map-threshold-track" role="img" aria-label={`${r.value_ppt} ppt, supplied limit ${r.limit_ppt} ppt, ${r.ratio?.toFixed(1)} times the limit`}><span data-severity={r.severity} style={{width:`${Math.min(r.ratio??0,2)*50}%`}}/><i/></div><p>{r.limit_ppt} ppt supplied limit · {r.ratio!.toFixed(1)}×{r.ratio!>2?' (continues beyond scale)':''} · Sampled {readingDate(r.date_iso)}</p></>}{r.proposed_for_rescission&&<small>Check current regulatory status in the official source.</small>}</section>)}</div>
    {water.hazard_index&&<section className="halo-map-hazard"><h3>Combined hazard index <strong>{water.hazard_index.value}</strong></h3><p>{water.hazard_index.exceeds?'At or above':'Below'} the supplied 1.0 comparison. Based on the latest sample, not an annual compliance determination.</p><small>Check current regulatory status in the official source.</small></section>}{water.detected_unregulated.length>0&&<p>Additional detections, not scored: {water.detected_unregulated.join(', ')}.</p>}<footer>Latest sample: {readingDate(water.latest_sample_iso)}. This is system-level evidence, not a test of this home.</footer><button className="halo-map-learn-button" onClick={()=>onLearn('pfas')}>Understand these water results</button></div>;
  if(layer==='radon'){const p=radonPoints.find(p=>p.id===id);return <div className="halo-map-detail"><SeverityPill severity={p?.severity??'no_data'}/><div className="halo-map-reading"><strong>Zone {p?.zone??'unknown'}</strong><span>County-level radon potential</span></div><p>This zone estimates regional potential. It does not measure radon inside any particular building.</p><p>A home test is needed to understand a home’s radon level. A lower-potential county is not a guarantee about an individual home.</p><button className="halo-map-learn-button" onClick={()=>onLearn('radon')}>Understand this radon zone</button><footer>County boundaries: U.S. Census Bureau. Layer assembled {readingDate(assembledAt)}.</footer></div>;}
  if(layer==='facilities'){const f=facilities.find(f=>f.id===id);if(!f)return null;return <div className="halo-map-detail"><SeverityPill severity={f.severity}/><p>{f.compliance_status.replaceAll('_',' ')} · {f.county}</p><div className="halo-map-tags">{f.programs.map(p=><span key={p}>{p}</span>)}</div><dl><div><dt>Quarters with noncompliance, last 3 years</dt><dd>{f.recent_violations===null?'Not reported':`${f.recent_violations} of 12`}</dd></div>{(f.open_violations??0)>0&&<div><dt>Programs currently in violation</dt><dd>{f.open_violations}</dd></div>}{(f.penalties??0)>0&&<div><dt>Penalties, last 5 years</dt><dd>${f.penalties?.toLocaleString()}</dd></div>}<div><dt>Last inspection</dt><dd>{readingDate(f.last_inspection)}</dd></div></dl><p>These are reported compliance records, not a count of individual incidents or a finding of household exposure.</p><a href="https://echo.epa.gov/" target="_blank" rel="noreferrer">About EPA ECHO data</a><footer>Layer assembled {readingDate(assembledAt)}.</footer></div>;}
  const station=airStations.find(a=>a.id===id);if(!station)return null;return <div className="halo-map-detail"><SeverityPill severity={station.severity}/><div className="halo-map-reading"><strong>{station.aqi??'No data'}</strong><span>Air Quality Index</span></div><dl><div><dt>Dominant pollutant</dt><dd>{station.dominant_pollutant}</dd></div>{hasHome&&milesFromHome(station.lat,station.lng)!==null&&<div><dt>Distance from my home</dt><dd>{milesFromHome(station.lat,station.lng)} miles</dd></div>}<div><dt>Observation time</dt><dd>{observationTime(station.last_reading_at)}</dd></div><div><dt>Agency</dt><dd>{station.agency.startsWith('Sample ') ? 'Not verified' : station.agency}</dd></div></dl><p>This reading describes the monitor, not a personal exposure measurement.</p><a href="https://www.airnow.gov/" target="_blank" rel="noreferrer">About AirNow observations</a></div>;
}

function MapLearn({topic,water,compound,county,onBack,href}:{topic:'pfas'|'radon';water?:WaterFeature;compound:Compound;county:string;onBack:()=>void;href?:string}) {
  const preferred=compound!=='overall'&&compound!=='hazard'?compoundKey[compound]:null;
  const reading=water?Object.entries(water.contaminants).filter(([,r])=>r.value_ppt!==undefined).sort((a,b)=>((b[0]===preferred?1000:0)+(b[1].ratio??0))-((a[0]===preferred?1000:0)+(a[1].ratio??0)))[0]:undefined;
  return <div className="halo-map-detail"><button className="halo-map-back" onClick={onBack}><ArrowLeft size={17}/>Back to location</button><p className="halo-map-learning-context">{topic==='pfas'?reading?`${water?.name}: ${reading[0]} ${reading[1].value_ppt} ppt, sampled ${readingDate(reading[1].date_iso)}`:'General explanation. No reading is available for this system.':`${county} · County potential, not a home measurement`}</p><h3>{topic==='pfas'?'Start with the sample, not the marker.':'Regional context is only a starting point.'}</h3><p>{topic==='pfas'?'The location represents a water system’s service-area center. Compare each reported compound with its supplied limit and sample date. Different dates and incomplete reporting can limit comparisons between systems.':'A county zone is a broad estimate. Homes in the same county can have different indoor conditions, so the county color cannot replace testing.'}</p><details><summary>What this information cannot tell you</summary><p>{topic==='pfas'?'It cannot confirm the concentration at your tap, prove personal exposure, or establish that a missing result means no contamination.':'It cannot tell you the radon level in a specific room or building, or show whether a previous mitigation system is working.'}</p></details><h3>A useful next step</h3><p>{topic==='pfas'?'Review the source dates and utility information. For an untested private supply, use the testing guidance in Homeguard rather than a nearby utility’s result.':'Use Homeguard to understand the difference between regional potential and household testing.'}</p>{href&&<Link href={href} prefetch={false}>Explore the {topic==='pfas'?'water':'radon'} guide</Link>}<a href={topic==='pfas'?'https://www.epa.gov/pfas':'https://www.epa.gov/radon'} target="_blank" rel="noreferrer">EPA background information</a></div>;
}
