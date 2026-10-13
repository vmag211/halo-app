'use client';
import {useEffect,useRef,useState} from 'react';
import {parseMapDistrict} from '@/lib/frontend/map-service';
import type {DistrictPreviewData} from '@/lib/frontend/map-district-preview';
import type {MapRequestRuntime} from './MapPreview';
import {DistrictPanel} from './DistrictPanel';
export default function LiveDistrictPanel({runtime,onCountySelect}:{runtime:MapRequestRuntime;onCountySelect?:(county:string)=>void}){
  const [data,setData]=useState<DistrictPreviewData|null>(null),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
  const request=useRef(runtime.request);useEffect(()=>{request.current=runtime.request;},[runtime.request]);
  useEffect(()=>{const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted){setLoading(true);setData(null);}});void request.current('map.district',{scope:'NC-08'},{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(parseMapDistrict(value));}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[runtime.scopeKey,attempt]);
  return <DistrictPanel source={data} loading={loading} onRetry={()=>setAttempt(value=>value+1)} onCountySelect={onCountySelect}/>;
}
