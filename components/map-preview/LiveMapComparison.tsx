'use client';
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import MapComparison from './MapComparison';
import type {MapRequestRuntime} from './MapPreview';
import {parseMapComparisons} from '@/lib/frontend/map-service';
import type {PublicComparisonRecord} from '@/lib/frontend/map-comparison-preview';
import type {MapLayer} from '@/lib/frontend/map-preview';

export default function LiveMapComparison({runtime,layer,quarter,ids,...props}:ComponentProps<typeof MapComparison>&{runtime:MapRequestRuntime;layer:MapLayer;quarter:string;ids:string[]}){
 const [records,setRecords]=useState<PublicComparisonRecord[]|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 const runtimeRef=useRef(runtime);useEffect(()=>{runtimeRef.current=runtime;},[runtime]);
 const signature=JSON.stringify(ids);
 useEffect(()=>{
  const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted){setLoading(true);setFailed(false);setRecords(null);}});
  void runtimeRef.current.request<{records:unknown}>('map.comparison',{layer,quarter,ids:JSON.parse(signature)},{signal:controller.signal}).then(value=>{if(controller.signal.aborted)return;setRecords(parseMapComparisons(value.records,JSON.parse(signature)));setLoading(false);}).catch(()=>{if(!controller.signal.aborted){setLoading(false);setFailed(true);}});
  return()=>controller.abort();
 },[runtime.scopeKey,layer,quarter,signature,attempt]);
 return <MapComparison {...props} records={records??props.records} scenario="ready" loading={props.loading||loading} blocked={props.blocked||failed} onRetry={()=>setAttempt(value=>value+1)}/>;
}
