'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronUp, Droplets, Factory, Info, List, LocateFixed, Minus, Mountain, Plus, RotateCcw, Settings, Wind, WifiOff } from 'lucide-react';
import AppNavigation from '@/components/ui/AppNavigation';
import { BottomSheet, Callout } from '@/components/ui/Foundation';
import Button from '@/components/ui/Button';
import SeverityPill from '@/components/ui/SeverityPill';
import { SceneProvider } from '@/components/foundation/SceneExperience';
import LunaAssistant from '@/components/foundation/LunaAssistant';
import LunaMark from '@/components/foundation/LunaMark';
import MapCanvas, { type MapPoint, type MapView } from './MapCanvas';
import { DistrictPanel } from './DistrictPanel';
import { AreaBrief, MapInsightCard, MapKey } from './MapInsights';
import { radonPoints } from '@/lib/frontend/map-radon-fixture';
import { airStations, assembledAt, compoundKey, compounds, facilities, mapLayers, mapScenarios, milesFromHome, quarterLabel, quarters, readingDate, readMapQuery, sampleHome, waterFeatures, waterSeverity, type Compound, type MapLayer, type MapScenario, type WaterFeature } from '@/lib/frontend/map-preview';
import '@/components/foundation/refinement.css';
import './map-preview.css';

type Sheet = { kind: 'feature'; id: string } | { kind: 'district' | 'legend' | 'results' | 'assistant' | 'about' | 'brief' } | { kind: 'learn'; topic: 'pfas' | 'radon'; id: string } | null;
const defaultView: MapView = { lng:-80.40, lat:35.15, zoom:8 };
let session: { layer: MapLayer; compound: Compound; quarter: string; view: MapView } | undefined;
const layerIcons = { water:Droplets, radon:Mountain, facilities:Factory, air:Wind };

export default function MapPreview() {
  const [scenario,setScenario] = useState<MapScenario>('ready');
  const [appearance,setAppearance] = useState('system');
  const [scale,setScale] = useState('100');
  const [motion,setMotion] = useState(false);
  const [contrast,setContrast] = useState(false);
  const [initialized,setInitialized] = useState(false);
  useEffect(()=>{
    const p = new URLSearchParams(location.search);
    // Browser-only preview URL is read once after hydration; no server state is involved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mapScenarios.some(s=>s[0] === p.get('mapScenario'))) setScenario(p.get('mapScenario') as MapScenario);
    if (['system','light','dark'].includes(p.get('appearance') ?? '')) setAppearance(p.get('appearance')!);
    if (['100','115','130','150'].includes(p.get('scale') ?? '')) setScale(p.get('scale')!);
    setMotion(p.get('motion') === 'reduce'); setContrast(p.get('contrast') === 'true'); setInitialized(true);
  },[]);
  useEffect(()=>{if (!initialized) return; const url=new URL(location.href); url.searchParams.set('appearance',appearance); url.searchParams.set('scale',scale); url.searchParams.set('motion',motion?'reduce':'system'); url.searchParams.set('contrast',String(contrast)); url.searchParams.set('mapScenario',scenario); history.replaceState(history.state,'',url);},[appearance,scale,motion,contrast,scenario,initialized]);
  function changeScenario(next:MapScenario) { const url=new URL(location.href); ['system','panel','learn','mapSheet'].forEach(k=>url.searchParams.delete(k)); history.replaceState({...history.state,_haloMapSheet:false},'',url); setScenario(next); }
  return <div className="halo-f-review halo-map-review" data-mode={appearance}>
    <details className="halo-f-review-tools halo-map-review-tools"><summary>Map design review · Not approved</summary>
      <p>Interactive wireframe with sample observations and a fictional household. No live API, location permission, or account writes. Census boundaries are real. This design remains editable and is not frozen.</p>
      <label>Review state<select aria-label="Review state" value={scenario} onChange={e=>changeScenario(e.target.value as MapScenario)}>{mapScenarios.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <div className="halo-f-tool-grid"><label>Appearance<select value={appearance} onChange={e=>setAppearance(e.target.value)}><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Text size<select value={scale} onChange={e=>setScale(e.target.value)}>{['100','115','130','150'].map(n=><option key={n} value={n}>{n}%</option>)}</select></label></div>
      <div className="halo-f-tool-grid"><label className="halo-f-tool-check"><input type="checkbox" checked={motion} onChange={e=>setMotion(e.target.checked)}/>Reduce motion</label><label className="halo-f-tool-check"><input type="checkbox" checked={contrast} onChange={e=>setContrast(e.target.checked)}/>Higher contrast</label></div>
      <p>The atlas previews map behavior without paid tiles or a token. The production Mapbox renderer and offline storage will be connected only after design approval. Sample values do not describe these communities.</p>
    </details>
    <SceneProvider mode={motion?'reduce':'system'} time="live">{initialized&&<MapExperience key={scenario} scenario={scenario} appearance={appearance} scale={Number(scale)/100} motion={motion} contrast={contrast}/>}</SceneProvider>
  </div>;
}

function MapExperience({scenario,appearance,scale,motion,contrast}:{scenario:MapScenario;appearance:string;scale:number;motion:boolean;contrast:boolean}) {
  const restoredSession=useRef(session);
  const [layer,setLayer]=useState<MapLayer>('water'); const [compound,setCompound]=useState<Compound>('overall');
  const [quarter,setQuarter]=useState('latest'); const [draftQuarter,setDraftQuarter]=useState('latest');
  const [pendingQuarter,setPendingQuarter]=useState<string|null>(null); const [view,setView]=useState<MapView>(defaultView);
  const [sheet,setSheet]=useState<Sheet>(null); const [ready,setReady]=useState(false); const [resolved,setResolved]=useState(false);
  const [rendererFailed,setRendererFailed]=useState(false); const [visibleCount,setVisibleCount]=useState<number|null>(null);
  const [visibleIds,setVisibleIds]=useState<string[]>([]); const [patterns,setPatterns]=useState(true);
  const [layerLoading,setLayerLoading]=useState(false); const [notice,setNotice]=useState(''); const [filter,setFilter]=useState('');
  const timers=useRef<ReturnType<typeof setTimeout>[]>([]); const quarterTimer=useRef<ReturnType<typeof setTimeout>|null>(null); const keyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const draggingQuarter=useRef(false);
  const ownsSheet=useRef(false); const sheetRef=useRef<Sheet>(null); const mapFocus=useRef<HTMLDivElement>(null);
  const liveRef=useRef({layer,compound,quarter,view});
  useEffect(()=>{liveRef.current={layer,compound,quarter,view}; session=liveRef.current;},[layer,compound,quarter,view]);
  useEffect(()=>{sheetRef.current=sheet;},[sheet]);
  const current=resolved?'ready':scenario;
  const offline=current==='offline'||current==='offline-empty';
  const hasHome=!['no-location','outside-nc'].includes(current);
  const noSaved=offline&&(current==='offline-empty'||layer!=='water');
  const layerFailed=(current==='layer-error' && layer==='water')||noSaved;
  const blocked=layerFailed||current==='session-required';
  const loading=['loading','slow'].includes(current)||layerLoading;
  const mapFailed=current==='map-unavailable'||rendererFailed;
  const quarterEmpty=current==='quarter-empty' && quarter!=='latest';
  const water=waterFeatures(quarterEmpty?'latest':quarter).filter(()=>!quarterEmpty);
  const visibleWater=current==='long-text'?water.map((w,i)=>i? w:{...w,name:'Meadow and Eastern Piedmont Regional Community Drinking Water Authority (sample)'}):water;
  const points:MapPoint[]= layer==='water'?visibleWater.filter(w=>w.lat!==null&&w.lng!==null).map(w=>({id:w.pwsid,name:w.name,lat:w.lat!,lng:w.lng!,severity:waterSeverity(w,compound),population:w.population,isOwn:hasHome&&w.pwsid===sampleHome.pwsid,flagged:compound==='overall'?Object.values(w.contaminants).some(r=>(r.ratio??0)>1):compound==='hazard'?!!w.hazard_index?.exceeds:(w.contaminants[compoundKey[compound]]?.ratio??0)>1})) : layer==='facilities'?facilities.map(f=>({...f,flagged:['violation','significant_violation'].includes(f.compliance_status)})) : layer==='air'?airStations.map(a=>({...a})) : radonPoints;
  const featureIds=new Set([...points.map(p=>p.id),...visibleWater.map(w=>w.pwsid),...(hasHome?['home']:[])]);

  const openFromUrl=useCallback(()=>{
    const p=new URLSearchParams(location.search); const next=readMapQuery(p);
    setLayer(next.layer); setCompound(next.compound); setQuarter(next.quarter); setDraftQuarter(next.quarter);
    setPatterns(p.get('presentation')!=='locations');
    if(p.get('panel')==='district') setSheet({kind:'district'});
    else if(p.get('learn')==='pfas'||p.get('learn')==='radon') setSheet({kind:'learn',topic:p.get('learn') as 'pfas'|'radon',id:p.get('system')??''});
    else if(p.has('system')) setSheet({kind:'feature',id:p.get('system')!});
    else if(['legend','results','assistant','about','brief'].includes(p.get('mapSheet')??'')) setSheet({kind:p.get('mapSheet') as 'legend'|'results'|'assistant'|'about'|'brief'});
    else setSheet(null);
    ownsSheet.current=!!history.state?._haloMapSheet;
  },[]);
  useEffect(()=>{
    const p=new URLSearchParams(location.search);
    const pendingTimers=timers.current;
    if(restoredSession.current&&!['layer','contaminant','quarter','system','panel'].some(k=>p.has(k))) {
      // Restore browser-session memory after mounting the isolated preview.
      const saved=restoredSession.current; setLayer(saved.layer);setCompound(saved.compound);setQuarter(saved.quarter);setDraftQuarter(saved.quarter);setView(saved.view);
      const url=new URL(location.href);url.searchParams.set('layer',saved.layer); if(saved.compound!=='overall')url.searchParams.set('contaminant',saved.compound);if(saved.quarter!=='latest')url.searchParams.set('quarter',saved.quarter);history.replaceState(history.state,'',url);
    } else openFromUrl();
    if(!hasHome)setView({lng:-79.9,lat:35.05,zoom:7});
    window.addEventListener('popstate',openFromUrl);
    return ()=>{window.removeEventListener('popstate',openFromUrl);pendingTimers.forEach(clearTimeout);if(quarterTimer.current)clearTimeout(quarterTimer.current);if(keyTimer.current)clearTimeout(keyTimer.current);};
  // Scenario remount intentionally snapshots session state only once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    // An invalid pasted selection must also be removed from the external URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if(sheet?.kind==='feature'&&!featureIds.has(sheet.id)){setSheet(null);const url=new URL(location.href);url.searchParams.delete('system');history.replaceState({...history.state,_haloMapSheet:false},'',url);ownsSheet.current=false;}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sheet,layer,quarter]);
  function urlForFilters(nextLayer=layer,nextCompound=compound,nextQuarter=quarter) {
    const url=new URL(location.href);url.searchParams.set('layer',nextLayer); ['contaminant','quarter'].forEach(k=>url.searchParams.delete(k));
    if(nextLayer==='water'){if(nextCompound!=='overall')url.searchParams.set('contaminant',nextCompound);if(nextQuarter!=='latest')url.searchParams.set('quarter',nextQuarter);}return url;
  }
  function openSheet(next:NonNullable<Sheet>) {
    const url=urlForFilters();['system','panel','learn','mapSheet'].forEach(k=>url.searchParams.delete(k));
    if(next.kind==='feature')url.searchParams.set('system',next.id);
    else if(next.kind==='district')url.searchParams.set('panel','district');
    else if(next.kind==='learn'){url.searchParams.set('learn',next.topic);url.searchParams.set('system',next.id);}
    else url.searchParams.set('mapSheet',next.kind);
    if(sheetRef.current)history.replaceState({...history.state,_haloMapSheet:ownsSheet.current},'',url);
    else{history.pushState({...history.state,_haloMapSheet:true},'',url);ownsSheet.current=true;}
    setSheet(next);setFilter('');
  }
  function closeSheet(){ if(ownsSheet.current)history.back();else{const url=new URL(location.href);['system','panel','learn','mapSheet'].forEach(k=>url.searchParams.delete(k));history.replaceState(history.state,'',url);setSheet(null);} requestAnimationFrame(()=>mapFocus.current?.querySelector<HTMLElement>('[role="application"]')?.focus()); }
  function setMapLayer(next:MapLayer){if(quarterTimer.current)clearTimeout(quarterTimer.current);if(keyTimer.current)clearTimeout(keyTimer.current);setPendingQuarter(null);setDraftQuarter('latest');setLayer(next);setCompound('overall');setQuarter('latest');setNotice('');history.replaceState(history.state,'',urlForFilters(next,'overall','latest'));setLayerLoading(true);timers.current.push(setTimeout(()=>setLayerLoading(false),300));}
  function setMapCompound(next:Compound){setCompound(next);history.replaceState(history.state,'',urlForFilters(layer,next));}
  function loadQuarter(next:string){if(next===quarter&&!pendingQuarter)return;if(quarterTimer.current)clearTimeout(quarterTimer.current);if(keyTimer.current)clearTimeout(keyTimer.current);if(offline && next!=='latest' && next!=='2025Q4'){setDraftQuarter(quarter);setNotice('This quarter is not saved. Reconnect to load it.');return;}
    setDraftQuarter(next);setPendingQuarter(next);setNotice('');quarterTimer.current=setTimeout(()=>{
      if(current==='quarter-error'){setPendingQuarter(null);setDraftQuarter(quarter);setNotice('That quarter could not load. Previous readings are still shown.');return;}
      setQuarter(next);setPendingQuarter(null);history.replaceState(history.state,'',urlForFilters('water',liveRef.current.compound,next));
    },650);
  }
  function retry(){setLayerLoading(true);setNotice('');timers.current.push(setTimeout(()=>{setRendererFailed(false);setResolved(true);setLayerLoading(false);},650));}
  function changeView(next:MapView){setView({...next,zoom:Math.max(6,Math.min(12,next.zoom))});}
  const factorHref=(factor:string)=>`/foundation/preview/factor/${factor}?edition=expanded&appearance=${appearance}&scale=${Math.round(scale*100)}&motion=${motion?'reduce':'system'}&contrast=${contrast}`;
  const foundationHref=(tab:string)=>`/foundation/preview?edition=expanded&tab=${tab}&appearance=${appearance}&scale=${Math.round(scale*100)}&motion=${motion?'reduce':'system'}&contrast=${contrast}`;
  const counts=compound==='overall'?`${water.filter(w=>Object.values(w.contaminants).some(c=>(c.ratio??0)>1)).length} of ${water.length} systems exceed a supplied limit` : compound==='hazard'?`${water.filter(w=>w.hazard_index?.exceeds).length} systems exceed the supplied hazard index` : `${water.filter(w=>(w.contaminants[compoundKey[compound]]?.ratio??0)>1).length} of ${water.filter(w=>w.contaminants[compoundKey[compound]]?.value_ppt!==undefined).length} recorded systems exceed the ${compounds.find(c=>c[0]===compound)?.[1]} limit`;
  const districtVariant= offline||current==='district-error'?'error':current==='district-geography'?'geography-error':current==='district-zero'?'zero':current==='population-missing'?'population-missing':current==='population-partial'?'population-partial':current==='comparison-missing'?'comparison-missing':'full';
  const activeWater=sheet && 'id' in sheet ? visibleWater.find(w=>w.pwsid===sheet.id):undefined;
  const selectedTitle=sheet?.kind==='feature' ? sheet.id==='home'?'Your home':activeWater?.name??points.find(p=>p.id===sheet.id)?.name??'Location details' : sheet?.kind==='district'?'The NC-08 picture':sheet?.kind==='legend'?'Understanding the map':sheet?.kind==='results'?'Locations and readings':sheet?.kind==='learn'?(sheet.topic==='pfas'?'Understanding water results':'Understanding radon zones'):'About this map';
  const banner=hasHome&&current!=='unranked'&&current!=='district-error' ? layer==='water'?'Union County ranks 34th of 96 ranked counties':layer==='radon'?`Union County is Zone ${radonPoints.find(p=>p.id==='Union County')?.zone??3}`:layer==='air'?`Nearest sample monitor: ${Math.min(...airStations.map(a=>Number(milesFromHome(a.lat,a.lng)))).toFixed(1)} miles`:`${facilities.filter(f=>Number(milesFromHome(f.lat,f.lng))<=10&&f.open_violations>0).length} sample facilities within 10 miles report open programs in violation`:null;
  const countN=layer==='water'?water.length:points.length;
  const inView=blocked||loading||current==='empty'?[]:points.filter(p=>visibleIds.includes(p.id));
  return <div className="halo-app halo-f-app halo-map-app" data-testid="map-product" data-wide="true" data-motion={motion?'reduce':'system'} data-contrast={contrast?'high':'normal'} data-text-scale={scale*100} style={{'--halo-text-scale':scale} as CSSProperties}>
    <header className="halo-map-header"><Link className="halo-f-icon" aria-label="Back to Explore" href={foundationHref('act')} prefetch={false}><ArrowLeft size={21}/></Link><div><h1>Map</h1><p>Within Explore</p></div><div className="halo-map-header-tools"><button className="halo-f-icon" aria-label="About this map" onClick={()=>openSheet({kind:'about'})}><Info size={21}/></button><Link href={foundationHref('settings')} className="halo-f-icon" aria-label="Settings" prefetch={false}><Settings size={21}/></Link></div></header>
    {offline&&<div className="halo-map-offline" role="status"><WifiOff size={16}/><span>{noSaved?'This layer is not saved on this device.':'Showing saved map data from Oct 1, 2026.'}</span>{<button onClick={retry}>Simulate reconnect</button>}</div>}
    <main aria-label="Map wireframe" className="halo-map-main">
      {mapFailed?<div className="halo-map-fallback"><Callout tone="notice"><p>The map couldn’t load on this device. The district summary is still available.</p></Callout><DistrictPanel variant={districtVariant} onRetry={retry}/><Button variant="secondary" onClick={retry}>Try the map again</Button></div>:
      <div className="halo-map-stage" data-layer={layer} data-timeline={layer==='water'&&current!=='single-quarter'}>
        <div className="halo-map-top">
          <div className="halo-map-layers" role="radiogroup" aria-label="Map layer">{mapLayers.map((key,index)=>{const Icon=layerIcons[key];return <button key={key} role="radio" aria-checked={layer===key} tabIndex={layer===key?0:-1} onClick={()=>setMapLayer(key)} onKeyDown={e=>{const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(direction){e.preventDefault();const n=(index+direction+4)%4;setMapLayer(mapLayers[n]);e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[n].focus();}}}><Icon size={18}/><span>{key[0].toUpperCase()+key.slice(1)}</span></button>;})}</div>
          {layer==='water'?<><label className="halo-map-compound"><Droplets size={17}/><span className="halo-sr">Water comparison</span><select aria-label="Water comparison" value={compound} disabled={loading} onChange={e=>setMapCompound(e.target.value as Compound)}>{compounds.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{['pfhxs','pfna','genx','hazard'].includes(compound)&&<button aria-label="Standard change information" onClick={()=>openSheet({kind:'legend'})}><Info size={18}/></button>}</label><p className="halo-map-count" aria-live="polite">{blocked?'Water data unavailable':loading?'Loading water data…':counts+'.'}<span>{quarter==='latest'?'Statewide sample dataset':`Samples from ${quarterLabel(quarter)}`} · Not a tap test</span></p></>:<p className="halo-map-count" aria-live="polite">{blocked?'Layer data unavailable':loading?'Loading layer data…':`${countN} ${layer==='air'?'stations':layer==='radon'?'counties':'facilities'} in this sample layer`}<span>{layer==='facilities'?'Selected facilities in NC-08':layer==='air'?'Latest available hourly observations':'County potential, not home measurements'}</span></p>}
        </div>
        <div className="halo-map-right-controls">{hasHome&&<button aria-label="Locate your home" onClick={()=>{changeView({lng:sampleHome.lng,lat:sampleHome.lat,zoom:8});setNotice('Centered on the approximate sample home.');}}><LocateFixed size={20}/></button>}<button aria-label="Zoom in" disabled={view.zoom>=12} onClick={()=>changeView({...view,zoom:view.zoom+1})}><Plus size={20}/></button><button aria-label="Zoom out" disabled={view.zoom<=6} onClick={()=>changeView({...view,zoom:view.zoom-1})}><Minus size={20}/></button></div>
        <div className="halo-map-left-controls"><div className="halo-map-presentation" role="group" aria-label="Map presentation">{[true,false].map(value=><button key={String(value)} aria-pressed={patterns===value} onClick={()=>{setPatterns(value);const url=new URL(location.href);url.searchParams.set('presentation',value?'patterns':'locations');history.replaceState(history.state,'',url);}}>{value?'Patterns':'Locations'}</button>)}</div><button onClick={()=>openSheet({kind:'results'})}><List size={17}/>List</button></div>
        <div className="halo-map-inline-key"><MapKey layer={layer} patterns={patterns} onOpen={()=>openSheet({kind:'legend'})}/></div>
        <div ref={mapFocus} className="halo-map-canvas-host"><MapCanvas layer={layer} points={blocked||loading||current==='empty'||quarterEmpty?[]:points} selectedId={sheet?.kind==='feature'?sheet.id:null} home={hasHome?sampleHome:null} view={view} patterns={patterns} onViewChange={changeView} onSelect={id=>openSheet({kind:'feature',id})} onReady={setReady} onUnavailable={()=>setRendererFailed(true)} onVisibleCountChange={setVisibleCount} onVisibleIdsChange={setVisibleIds} forceEmpty={current==='empty'}/></div>
        {(loading||!ready)&&!blocked&&<div className="halo-map-state" role="status"><span className="halo-spinner"/><strong>Loading map data.</strong>{current==='slow'&&<p>This source is taking longer. Your location stays in view.</p>}{['loading','slow'].includes(current)&&<button onClick={retry}>Finish sample loading</button>}</div>}
        {blocked&&<div className="halo-map-state" role="alert"><Info size={25}/><strong>{current==='session-required'?'Verify your session to load map data.':'This layer’s data couldn’t load.'}</strong><p>{noSaved?'Reconnect to load this layer. Saved water data remains available.':'Other layers and the district summary are still available.'}</p>{!offline&&<Button variant="secondary" onClick={retry}>Try again</Button>}</div>}
        {(current==='empty'||quarterEmpty||visibleCount===0)&&ready&&!loading&&!blocked&&<div className="halo-map-state"><strong>{quarterEmpty?'No samples in this quarter.':'No data for this layer in the area you’re viewing.'}</strong><p>{quarterEmpty?'This does not mean there were no contaminants.':'Try zooming out.'}</p><button onClick={()=>{if(quarterEmpty)loadQuarter('latest');else{setResolved(true);changeView({...defaultView,zoom:6});}}}>{quarterEmpty?'Return to Latest':'Zoom out'}</button></div>}
        <div className="halo-map-bottom">
          {notice&&<p className="halo-map-notice" role="status">{notice}{current==='quarter-error'&&<button onClick={retry}>Try again</button>}</p>}
          {!blocked&&<MapInsightCard points={inView} layer={layer} loading={loading||!ready} onOpen={()=>openSheet({kind:'brief'})}/>}
          {layer==='water'&&current!=='single-quarter'&&<section className="halo-map-timeline" aria-label="Water sample timeline"><div><span>{pendingQuarter?`Loading ${quarterLabel(pendingQuarter)}…`:quarter==='latest'?'Latest available samples':`Samples from ${quarterLabel(quarter)}`}</span><button disabled={quarter==='latest'&&!pendingQuarter} onClick={()=>loadQuarter('latest')} aria-label="Return to latest samples"><RotateCcw size={15}/></button></div><input aria-label="Water sample quarter" type="range" min="0" max={quarters.length} value={draftQuarter==='latest'?quarters.length:quarters.indexOf(draftQuarter)} aria-valuetext={quarterLabel(draftQuarter)} disabled={loading||blocked} onPointerDown={()=>{draggingQuarter.current=true;}} onChange={e=>{const q=quarters[Number(e.target.value)]??'latest';setDraftQuarter(q);if(keyTimer.current)clearTimeout(keyTimer.current);if(!draggingQuarter.current)keyTimer.current=setTimeout(()=>loadQuarter(q),250);}} onPointerUp={e=>{draggingQuarter.current=false;loadQuarter(quarters[Number(e.currentTarget.value)]??'latest');}} onPointerCancel={()=>{draggingQuarter.current=false;setDraftQuarter(quarter);}}/><div className="halo-map-ticks"><span>{quarterLabel(quarters[0])}</span><span>{quarterLabel(quarters[4])}</span><span>{quarterLabel(quarters[8])}</span><span>Latest</span></div></section>}
          <button className="halo-map-district-handle" onClick={()=>openSheet({kind:'district'})} onTouchStart={e=>{e.currentTarget.dataset.start=String(e.touches[0].clientY);}} onTouchEnd={e=>{if(Number(e.currentTarget.dataset.start)-e.changedTouches[0].clientY>30)openSheet({kind:'district'});}}><span/><strong>See the full NC-08 picture</strong><ChevronUp size={18}/></button>
        </div>
      </div>}
    </main>
    <AppNavigation active="act" href={foundationHref} />
    {!sheet&&<button className="halo-map-luna" aria-label="Open Luna" onClick={()=>openSheet({kind:'assistant'})}><LunaMark size={25}/></button>}
    {sheet?.kind==='assistant'?<LunaAssistant onClose={closeSheet} factorHref={factorHref} home={false} offline={offline}/>:sheet&&<BottomSheet id="halo-map-sheet" title={sheet.kind==='brief'?'Your area at a glance':selectedTitle} height={sheet.kind==='feature'?'content':'standard'} onClose={closeSheet}>
      <p className="halo-map-sample-label">Wireframe · Sample data</p>
      {sheet.kind==='brief'&&(blocked||loading?<p>{loading?'Loading this layer’s area brief.':'Load this layer to see its area brief.'}</p>:<AreaBrief points={inView} allPoints={points} layer={layer} compound={compound} quarter={quarter} water={water} hasHome={hasHome} banner={banner} onSelect={id=>openSheet({kind:'feature',id})}/>)}
      {sheet.kind==='district'&&<>{offline&&<Callout tone="notice"><p>No district summary is saved in this sample session. Reconnect to load it.</p></Callout>}<DistrictPanel variant={districtVariant} onRetry={offline?undefined:retry} onCountySelect={name=>{const point=radonPoints.find(p=>p.id===name);if(!point)return;setLayer('radon');setCompound('overall');setQuarter('latest');changeView({lat:point.lat,lng:point.lng,zoom:8});const url=urlForFilters('radon','overall','latest');url.searchParams.delete('panel');url.searchParams.set('system',name);history.replaceState(history.state,'',url);setSheet({kind:'feature',id:name});}}/></>}
      {sheet.kind==='legend'&&<><div className="halo-map-legend-intro"><h3>{patterns?'Patterns with context':'Every record has a place'}</h3><p>{['water','facilities'].includes(layer)?'The soft heat layer shows the density of over-limit water systems or facilities with reported violations, according to the selected layer. It is not contamination spreading or an exposure estimate. Dots retain their individual reported categories. Switch to Locations to hide the heat layer.':layer==='air'?'Station halos are visual emphasis, not an estimate between monitors.':'Shaded counties use the source radon zones. No household measurements are inferred.'}</p></div><Legend layer={layer} compound={compound} assembled={assembledAt}/></>}
      {sheet.kind==='about'&&<div className="halo-map-detail"><h3>One place, four kinds of evidence.</h3><p>Water shows system-level samples. Radon shows county potential. Facilities show selected compliance records. Air shows monitoring stations, not a reading at every address.</p><p>Your home pin is approximate. Layer changes keep the same map position. Use the list for a keyboard-accessible alternative.</p><p>Quarter views contain only systems with a sample in that quarter. A missing marker does not mean there was no testing or no concern. These sample maps do not show contamination spreading.</p><p>District lines use the 119th Congress, 2023 map. The view does not claim to use the 2026 election boundaries.</p><a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" target="_blank" rel="noreferrer">U.S. Census boundary source</a><button onClick={()=>openSheet({kind:'results'})}>Browse locations as a list</button></div>}
      {sheet.kind==='results'&&<div className="halo-map-results"><label>Find a location in this layer<input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Name or system ID"/></label><p>{layer==='water'?'Includes systems without a mapped location. Sample values are statewide.':'This list is an alternative to selecting markers on the map.'}</p>{blocked?<Callout tone="notice"><p>No saved results for this layer.</p></Callout>:<>{(layer==='water'?visibleWater.map(w=>({id:w.pwsid,name:w.name,severity:waterSeverity(w,compound),sub:w.lat===null?'No mapped location':w.pwsid===sampleHome.pwsid&&hasHome?'Your sample water system':'Service-area center'})):points.map(p=>({id:p.id,name:p.name,severity:p.severity,sub:layer==='radon'?`Zone ${p.zone}`:layer==='air'?'Monitoring station':'Selected facility'}))).filter(p=>`${p.name} ${p.id}`.toLowerCase().includes(filter.toLowerCase())).map(p=><button key={p.id} onClick={()=>openSheet({kind:'feature',id:p.id})}><span><strong>{p.name}</strong><small>{p.sub}</small></span><SeverityPill severity={p.severity}/></button>)}{filter&&!(layer==='water'?visibleWater.map(w=>`${w.name} ${w.pwsid}`):points.map(p=>`${p.name} ${p.id}`)).some(s=>s.toLowerCase().includes(filter.toLowerCase()))&&<p role="status">No matching locations. Try a different name.</p>}</>}</div>}
      {sheet.kind==='feature'&&(blocked?<Callout tone="notice"><p>No readings are available for this location in the current state.</p><p>{offline?'Reconnect to load this layer.':'Load the layer before opening its readings.'}</p>{!offline&&<Button variant="secondary" onClick={retry}>Try again</Button>}</Callout>:loading?<p role="status">Loading location details.</p>:<FeatureDetails id={sheet.id} layer={layer} water={activeWater} hasHome={hasHome} onLearn={topic=>openSheet({kind:'learn',topic,id:sheet.id})} todayHref={foundationHref('today')}/>)}
      {sheet.kind==='learn'&&<MapLearn topic={sheet.topic} water={blocked||loading?undefined:activeWater} compound={compound} county={sheet.id} onBack={()=>openSheet({kind:'feature',id:sheet.id})} href={factorHref(sheet.topic)}/>}
    </BottomSheet>}
  </div>;
}

function Legend({layer,compound,assembled}:{layer:MapLayer;compound:Compound;assembled:string}) {
  const levels=layer==='radon'?[['high','Zone 1 · Highest potential'],['elevated','Zone 2 · Moderate potential'],['good','Zone 3 · Lowest potential']]:layer==='facilities'?[['good','No violation reported'],['elevated','Violation'],['high','Significant violation'],['no_data','Unknown']]:[['good','Good'],['moderate','Moderate'],['elevated','Elevated'],['high','High'],['severe','Severe'],['no_data',layer==='water'?'No detection reported':'No data']];
  return <div className="halo-map-detail"><ul className="halo-map-legend-list">{levels.map(([level,label])=><li key={level}><span className="halo-map-legend-symbol" data-severity={level} data-layer={layer}/><span>{label}</span></li>)}</ul>
    {layer==='water'&&<><p>Circle size represents people served, not the amount of contamination. The outlined circle is your sample system. Its location is the service-area center, not your tap.</p><p>No detection reported does not establish whether a system was tested. The supplied dataset retains detections, so comparison counts are not complete testing coverage.</p><p>Detected, no comparison limit: a neutral marker can also mean a reported compound cannot be scored against the supplied limits.</p>{compound!=='overall'&&compound!=='hazard'&&<p>Supplied comparison limit: {['pfoa','pfos'].includes(compound)?4:10} ppt.</p>}{['pfhxs','pfna','genx','hazard'].includes(compound)&&<Callout tone="caution"><p>This sample source flags a proposed change to this standard. Current regulatory status must be verified before launch.</p></Callout>}<p>The count line describes the whole returned statewide sample dataset, not only the map viewport or NC-08.</p></>}
    {layer==='facilities'&&<><p>Shows major facilities and repeat violators in NC-08, not every regulated site.</p><p>Numbered groups expand as you zoom in. A compliance record is not a measurement of exposure at your home.</p></>}
    {layer==='air'&&<p>Diamonds mark monitoring stations. Latest hourly readings are observations at those stations, not a continuous air-quality surface.</p>}
    {layer==='radon'&&<p>County zones describe regional potential, not a test of your home. County fills remain translucent so boundaries stay readable.</p>}
    <footer>Data assembled {readingDate(assembled)}. Sample assembly time is separate from each observation or water sample date.</footer>
  </div>;
}

function FeatureDetails({id,layer,water,hasHome,onLearn,todayHref}:{id:string;layer:MapLayer;water?:WaterFeature;hasHome:boolean;onLearn:(topic:'pfas'|'radon')=>void;todayHref:string}) {
  if(id==='home')return <div className="halo-map-detail"><p>{sampleHome.county} · Approximate location</p><div className="halo-map-reading"><strong>{sampleHome.score}</strong><span>Today score from the sample session</span></div><Link className="halo-primary" href={todayHref} prefetch={false}>Go to Today</Link></div>;
  if(layer==='water'&&water)return <div className="halo-map-detail"><div className="halo-map-detail-meta"><span>{water.pwsid}</span><SeverityPill severity={water.overall_severity}/></div><p>{water.population===null?'Population served: No data':`Serves ${water.population.toLocaleString()} people`}{water.lat===null?' · No mapped location':''}</p>{water.coverage==='unscoreable'&&<Callout tone="notice"><p>Detected, not scored. The reported compounds have no supplied comparison limit.</p></Callout>}
    <div className="halo-map-thresholds">{Object.entries(water.contaminants).map(([name,r])=><section key={name}><div><strong>{name==='HFPO-DA'?'GenX (HFPO-DA)':name}</strong><span>{r.value_ppt===undefined?'No detection reported':`${r.value_ppt} ppt`}</span></div>{r.value_ppt!==undefined&&<><div className="halo-map-threshold-track" role="img" aria-label={`${r.value_ppt} ppt, supplied limit ${r.limit_ppt} ppt, ${r.ratio?.toFixed(1)} times the limit`}><span data-severity={r.severity} style={{width:`${Math.min(r.ratio??0,2)*50}%`}}/><i/></div><p>{r.limit_ppt} ppt supplied limit · {r.ratio!.toFixed(1)}×{r.ratio!>2?' (continues beyond scale)':''} · Sampled {readingDate(r.date_iso)}</p></>}{r.proposed_for_rescission&&<small>Source flags a proposed standard change.</small>}</section>)}</div>
    {water.hazard_index&&<section className="halo-map-hazard"><h3>Combined hazard index <strong>{water.hazard_index.value}</strong></h3><p>{water.hazard_index.exceeds?'At or above':'Below'} the supplied 1.0 comparison. Based on the latest sample, not an annual compliance determination.</p><small>Source flags a proposed standard change.</small></section>}{water.detected_unregulated.length>0&&<p>Additional detections, not scored: {water.detected_unregulated.join(', ')}.</p>}<footer>Latest sample: {readingDate(water.latest_sample_iso)}. This is system-level evidence, not a test of this home.</footer><button className="halo-map-learn-button" onClick={()=>onLearn('pfas')}>Understand these water results</button></div>;
  if(layer==='radon'){const p=radonPoints.find(p=>p.id===id);return <div className="halo-map-detail"><SeverityPill severity={p?.severity??'no_data'}/><div className="halo-map-reading"><strong>Zone {p?.zone??'unknown'}</strong><span>County-level radon potential</span></div><p>This zone estimates regional potential. It does not measure radon inside any particular building.</p><p>A home test is needed to understand a home’s radon level. A lower-potential county is not a guarantee about an individual home.</p><button className="halo-map-learn-button" onClick={()=>onLearn('radon')}>Understand this radon zone</button><footer>County boundaries: U.S. Census Bureau. Layer assembled {readingDate(assembledAt)}.</footer></div>;}
  if(layer==='facilities'){const f=facilities.find(f=>f.id===id);if(!f)return null;return <div className="halo-map-detail"><SeverityPill severity={f.severity}/><p>{f.compliance_status.replaceAll('_',' ')} · {f.county}</p><div className="halo-map-tags">{f.programs.map(p=><span key={p}>{p}</span>)}</div><dl><div><dt>Quarters with noncompliance, last 3 years</dt><dd>{f.recent_violations} of 12</dd></div>{f.open_violations>0&&<div><dt>Programs currently in violation</dt><dd>{f.open_violations}</dd></div>}{f.penalties>0&&<div><dt>Penalties, last 5 years</dt><dd>${f.penalties.toLocaleString()}</dd></div>}<div><dt>Last inspection</dt><dd>{readingDate(f.last_inspection)}</dd></div></dl><p>These are reported compliance records, not a count of individual incidents or a finding of household exposure.</p><a href="https://echo.epa.gov/" target="_blank" rel="noreferrer">About EPA ECHO data</a><footer>Layer assembled {readingDate(assembledAt)}.</footer></div>;}
  const station=airStations.find(a=>a.id===id);if(!station)return null;return <div className="halo-map-detail"><SeverityPill severity={station.severity}/><div className="halo-map-reading"><strong>{station.aqi}</strong><span>Air Quality Index</span></div><dl><div><dt>Dominant pollutant</dt><dd>{station.dominant_pollutant}</dd></div>{hasHome&&<div><dt>Distance from sample home</dt><dd>{milesFromHome(station.lat,station.lng)} miles</dd></div>}<div><dt>Observation time</dt><dd>{new Date(station.last_reading_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</dd></div><div><dt>Agency</dt><dd>{station.agency}</dd></div></dl><p>This reading describes the monitor, not a personal exposure measurement.</p><a href="https://www.airnow.gov/" target="_blank" rel="noreferrer">About AirNow observations</a></div>;
}

function MapLearn({topic,water,compound,county,onBack,href}:{topic:'pfas'|'radon';water?:WaterFeature;compound:Compound;county:string;onBack:()=>void;href:string}) {
  const preferred=compound!=='overall'&&compound!=='hazard'?compoundKey[compound]:null;
  const reading=water?Object.entries(water.contaminants).filter(([,r])=>r.value_ppt!==undefined).sort((a,b)=>((b[0]===preferred?1000:0)+(b[1].ratio??0))-((a[0]===preferred?1000:0)+(a[1].ratio??0)))[0]:undefined;
  return <div className="halo-map-detail"><button className="halo-map-back" onClick={onBack}><ArrowLeft size={17}/>Back to location</button><p className="halo-map-learning-context">{topic==='pfas'?reading?`${water?.name}: ${reading[0]} ${reading[1].value_ppt} ppt, sampled ${readingDate(reading[1].date_iso)}`:'General explanation. No reading is available for this system.':`${county} · County potential, not a home measurement`}</p><h3>{topic==='pfas'?'Start with the sample, not the marker.':'Regional context is only a starting point.'}</h3><p>{topic==='pfas'?'The location represents a water system’s service-area center. Compare each reported compound with its supplied limit and sample date. Different dates and incomplete reporting can limit comparisons between systems.':'A county zone is a broad estimate. Homes in the same county can have different indoor conditions, so the county color cannot replace testing.'}</p><details><summary>What this information cannot tell you</summary><p>{topic==='pfas'?'It cannot confirm the concentration at your tap, prove personal exposure, or establish that a missing result means no contamination.':'It cannot tell you the radon level in a specific room or building, or show whether a previous mitigation system is working.'}</p></details><h3>A useful next step</h3><p>{topic==='pfas'?'Review the source dates and utility information. For an untested private supply, use the testing guidance in Homeguard rather than a nearby utility’s result.':'Use Homeguard to understand the difference between regional potential and household testing.'}</p><Link href={href} prefetch={false}>Explore the {topic==='pfas'?'water':'radon'} guide</Link><a href={topic==='pfas'?'https://www.epa.gov/pfas':'https://www.epa.gov/radon'} target="_blank" rel="noreferrer">EPA background information</a><footer>Sample educational content. In production, the existing Learn response supplies the contextual explanation and citations.</footer></div>;
}
